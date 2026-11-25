import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import './identity-create.test.mjs'; // Keep real Ed25519 onboarding tests inside the existing CI test command.
import {LAUNCH_UTC,getLaunchCountdown} from '../js/launch-clock.mjs';
import statusHandler from '../api/status.js';
import modelsHandler from '../api/models.js';
import inferHandler from '../api/infer.js';
import readinessHandler from '../api/testnet-readiness.js';

function res(){
  return {code:200,headers:{},setHeader(name,value){this.headers[name]=value;return this;},
    status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
}
function req(method='GET',body=null,headers={}){
  return {method,body,headers:{host:'flops-murex.vercel.app',...headers}};
}
function withEnv(values,action){
  const before={};
  for(const [k,v] of Object.entries(values)){before[k]=process.env[k];if(v===null)delete process.env[k];else process.env[k]=v;}
  return Promise.resolve().then(action).finally(()=>{for(const [k,v] of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
}
test('web contains all five unified views and no external crypto script',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  for(const id of ['home','identity','inference','community','activity'])assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/js\/unified\.js/);assert.match(html,/js\/crypto\.js/);
  assert.doesNotMatch(html,/cdn\.jsdelivr/);
  const legacy=await readFile(new URL('../legacy/index.html',import.meta.url),'utf8');
  assert.match(legacy,/Technocore Studio/);
});
test('status stays disabled until all hard safety gates are configured',async()=>{
  await withEnv({FLOPTRACE_ENABLE_INFERENCE:'1',FLOPTRACE_SPEND_CAP_ACK:null,FLOP_API_KEY:'test-only',FLOPTRACE_ACCESS_TOKEN:'test-only'},async()=>{
    const response=res();statusHandler(req(),response);
    assert.equal(response.body.inferenceEnabled,false);
    assert.equal(JSON.stringify(response.body).includes('test-only'),false);
  });
});
test('public models proxy filters IDs without leaking upstream details',async()=>{
  const before=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,json:async()=>({data:[{id:'sample/model',secret:'ignore'},{bad:'skip'}]})});
  try{
    const response=res();await modelsHandler(req(),response);
    assert.equal(response.code,200);assert.deepEqual(response.body.data,[{id:'sample/model'}]);
  }finally{globalThis.fetch=before;}
});
test('configured credentials cannot enable hosted inference or trigger upstream traffic',async()=>{
  await withEnv({FLOPTRACE_ENABLE_INFERENCE:'1',FLOPTRACE_SPEND_CAP_ACK:'1',FLOP_API_KEY:'test',FLOPTRACE_ACCESS_TOKEN:'test'},async()=>{
    const previous=globalThis.fetch;
    let calls=0;
    globalThis.fetch=()=>{calls++;throw new Error('Unexpected upstream call');};
    try{
      const response=res();
      await inferHandler(req('POST',{model:'sample/model',prompt:'test'},{authorization:'Bearer test'}),response);
      assert.equal(response.code,410);
      assert.equal(calls,0);
      const status=res();statusHandler(req(),status);
      assert.equal(status.body.inferenceEnabled,false);
    }finally{globalThis.fetch=previous;}
  });
});

test('Testnet launch guide is explicit, timezone-safe and never claims live status',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../js/unified.js',import.meta.url),'utf8');
  const css=await readFile(new URL('../css/unified.css',import.meta.url),'utf8');
  assert.match(html,/id="launchGuideTitle"/);
  assert.match(html,/id="testnetLocalTime"/);
  assert.match(html,/id="testnetCountdown"/);
  for(const id of ['testnetCountdownPanel','testnetCountdownClock','clockDays','clockHours','clockMinutes','clockSeconds']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(html,/role="timer"/);
  assert.match(html,/aria-live="off"/);
  assert.match(js,/setInterval\(updateLaunchTarget,1000\)/);
  assert.match(html,/2026-11-24T07:00:00Z/);
  assert.match(html,/EARLY TESTNET ANNOUNCED · RPC CHECK PENDING/);
  assert.match(html,/https:\/\/docs\.flop\.network\/docs\/network-testnet/);
  assert.match(html,/Import my DID/);
  assert.match(html,/Devnet tokens and activity carry no airdrop weight/);
  assert.match(html,/DID creation alone earns nothing/);
  assert.match(html,/A <code>did:key<\/code> is an agent identity, not an SS58 wallet address/);
  assert.match(js,/new Date\(LAUNCH_UTC\)/);
  assert.match(js,/Intl\.DateTimeFormat/);
  assert.match(js,/FLOP has announced an early, unscored Testnet opening/);
  assert.match(css,/\.launch-guide\{/);
  assert.match(css,/@media\(max-width:610px\)/);
  assert.doesNotMatch(html,/did:key:z6MktYZcwhU44paRoi5AwahUv66jKAMsxXvf2TxaUzLs3yyG/);
  assert.doesNotMatch(html,/did:key:z6MktbDb2dVYvfm2C8koCMxvREpyCRDD1zFPzGgEdJQ1M2AR/);
});

test('UTC countdown calculates days, hours, minutes and seconds correctly across launch boundary',()=>{
  assert.equal(LAUNCH_UTC,'2026-11-24T07:00:00Z');
  const target=Date.parse(LAUNCH_UTC);
  const delta=((2*86400)+(3*3600)+(4*60)+5)*1000;
  assert.deepEqual(getLaunchCountdown(target-delta,target),{
    elapsed:false,totalSeconds:183845,days:2,hours:3,minutes:4,seconds:5
  });
  assert.equal(getLaunchCountdown(target-1,target).totalSeconds,1);
  assert.deepEqual(getLaunchCountdown(target,target),{
    elapsed:true,totalSeconds:0,days:0,hours:0,minutes:0,seconds:0
  });
  assert.equal(getLaunchCountdown(target+60000,target).elapsed,true);
  assert.equal(getLaunchCountdown(target+60000,target).totalSeconds,0);
  assert.throws(()=>getLaunchCountdown(NaN,target),/finite timestamps/);
});

test('launch email voucher guidance is visible without promising automatic claims',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const css=await readFile(new URL('../css/unified.css',import.meta.url),'utf8');
  for(const phrase of [
    'How your agent earns after activation.',
    '1</strong> TESTNET FLOP SPENT',
    '1</strong> AGENT VOUCHER',
    'daily testnet faucet funds',
    'eligible inference',
    'DID creation alone earns nothing.',
    '14-day grace period',
    '1.2M FLOP stake seats',
    'No mainnet FLOP token or legitimate claim is live today.',
    'does not claim vouchers on your behalf'
  ]){
    assert.ok(html.includes(phrase),phrase);
  }
  assert.match(html,/<details class="testnet-more">/);
  assert.match(html,/MINERS · GPU REQUIRED/);
  assert.match(html,/VALIDATORS · NO GPU REQUIRED/);
  assert.match(css,/\.reward-explainer\{/);
  assert.match(css,/\.testnet-more-grid\{/);
  assert.match(html,/href="https:\/\/docs\.flop\.network\/docs\/network-testnet"/);
  assert.doesNotMatch(html,/did:key:z6MktYZcwhU44paRoi5AwahUv66jKAMsxXvf2TxaUzLs3yyG/);
});

test('home onboarding distinguishes Devnet from the official Testnet launch',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const css=await readFile(new URL('../css/unified.css',import.meta.url),'utf8');
  const hero=html.split('<div class="home-actions">')[1]?.split('</div>')[0] || '';
  const claim=html.split('<strong>3 · Claim, then spend (later)</strong>')[1]?.split('</li>')[0] || '';
  assert.match(hero,/Create or import DID/);
  assert.match(hero,/Check Testnet launch/);
  assert.match(hero,/Explore Devnet/);
  assert.doesNotMatch(hero,/Explore the network/);
  assert.match(hero,/href="https:\/\/flop\.finance\/"/);
  assert.match(claim,/View network announcement/);
  assert.match(claim,/href="https:\/\/flop\.finance\/"/);
  assert.match(claim,/rel="noopener noreferrer"/);
  assert.match(css,/\.launch-steps li>a\.link-button/);
  assert.match(html,/EARLY TESTNET ANNOUNCED · RPC CHECK PENDING/);
});

test('Testnet stays planned without all verified official inputs, regardless of date',async()=>{
  const {verifyTestnet,safeRpcUrl}=readinessHandler;
  const expected='0x'+'a'.repeat(64);
  const config={FLOPTRACE_TESTNET_RELEASE_VERIFIED:'1',
    FLOPTRACE_TESTNET_EXPECTED_GENESIS:expected,
    FLOPTRACE_TESTNET_RPC_URL:'https://rpc.testnet.flop.network/',
    FLOPTRACE_TESTNET_ANNOUNCEMENT_URL:'https://flop.finance/testnet/'};
  assert.equal((await verifyTestnet({})).testnetVerified,false);
  assert.equal((await verifyTestnet({...config,FLOPTRACE_TESTNET_RELEASE_VERIFIED:'0'})).testnetVerified,false);
  assert.equal((await verifyTestnet({...config,FLOPTRACE_TESTNET_ANNOUNCEMENT_URL:'https://scam.example/'})).testnetVerified,false);
  assert.equal((await verifyTestnet({...config,FLOPTRACE_TESTNET_EXPECTED_GENESIS:'0x123'})).testnetVerified,false);
  assert.equal((await verifyTestnet({...config,FLOPTRACE_TESTNET_EXPECTED_GENESIS:'0x99c172c095340ace980631f9123544c6bebd4839f3437e463533422d8be2d631'})).testnetVerified,false);
  assert.equal(safeRpcUrl('https://localhost:9944'),null);
  assert.equal(safeRpcUrl('http://rpc.testnet.flop.network'),null);
  assert.equal(safeRpcUrl('https://rpc.devnet.flop.network'),null);
  assert.equal(safeRpcUrl('wss://rpc.testnet.flop.network/'),'wss://rpc.testnet.flop.network/');
});

test('Testnet switches only if pinned official genesis matches block zero over live RPC',async()=>{
  const expected='0x'+'a'.repeat(64);
  const config={FLOPTRACE_TESTNET_RELEASE_VERIFIED:'1',
    FLOPTRACE_TESTNET_EXPECTED_GENESIS:expected,
    FLOPTRACE_TESTNET_RPC_URL:'https://rpc.testnet.flop.network/',
    FLOPTRACE_TESTNET_ANNOUNCEMENT_URL:'https://flop.finance/testnet/'};
  const original=globalThis.fetch;
  const seen=[];
  try{
    globalThis.fetch=async(url,options)=>{
      seen.push({url,options});
      return {ok:true,json:async()=>({jsonrpc:'2.0',id:1,result:expected})};
    };
    const ready=await readinessHandler.verifyTestnet(config);
    assert.equal(ready.testnetVerified,true);
    assert.equal(ready.status,'GENESIS_VERIFIED');
    assert.equal(ready.network,'testnet');
    assert.equal(ready.genesisHash,expected);
    assert.equal(ready.startUrl,'https://ask.flop.finance/networks/testnet');
    assert.equal(ready.rewardsActive,false);
    assert.equal(ready.rewardStatus,'UNSCORED');
    assert.equal(seen.length,1);
    assert.equal(JSON.parse(seen[0].options.body).method,'chain_getBlockHash');
    assert.deepEqual(JSON.parse(seen[0].options.body).params,[0]);
    assert.equal(seen[0].options.method,'POST');
    globalThis.fetch=async()=>({ok:true,json:async()=>({id:1,result:'0x'+'b'.repeat(64)})});
    const mismatch=await readinessHandler.verifyTestnet(config);
    assert.equal(mismatch.testnetVerified,false);
    assert.equal(mismatch.status,'GENESIS_MISMATCH');
    globalThis.fetch=async()=>{throw Error('Unavailable');};
    const offline=await readinessHandler.verifyTestnet(config);
    assert.equal(offline.testnetVerified,false);
    assert.equal(offline.status,'RPC_UNAVAILABLE');
  }finally{globalThis.fetch=original;}
});

test('Testnet home switches, yet Devnet keeps dedicated /devnet URL and no fake chain proof',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../js/unified.js',import.meta.url),'utf8');
  const css=await readFile(new URL('../css/unified.css',import.meta.url),'utf8');
  const vercel=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  assert.ok(vercel.rewrites.some(x=>x.source==='/devnet'&&x.destination==='/index.html'));
  for(const id of ['testnetStartHero','testnetReadyPanel','verifiedGenesisHash','navDevnet','homeDevnetCTA','homeDevnetCard','devnetHomeDisclaimer']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(html,/href="https:\/\/ask\.flop\.finance\/networks\/testnet"/);
  assert.match(html,/Browse Devnet AI models/);
  assert.match(html,/This archive is always accessible/);
  assert.match(js,/testnetVerified===true/);
  assert.match(js,/status==='GENESIS_VERIFIED'/);
  assert.match(js,/genesisHash/);
  assert.match(js,/function currentRouteView/);
  assert.match(js,/go\(currentRouteView\(\),false\)/);
  assert.match(js,/setInterval\(loadTestnetReadiness,60_000\)/);
  assert.match(js,/applyTestnetReadiness\(null\)/);
  assert.match(css,/\[hidden\]\{display:none!important\}/);
  assert.doesNotMatch(js,/innerHTML\s*=/);
  assert.doesNotMatch(html,/did:key:z6MktYZcwhU44paRoi5AwahUv66jKAMsxXvf2TxaUzLs3yyG/);
});

test('24 November official opening is explicitly unscored, independent from RPC verification',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../js/unified.js',import.meta.url),'utf8');
  const css=await readFile(new URL('../css/unified.css',import.meta.url),'utf8');
  const readiness=await readFile(new URL('../api/testnet-readiness.js',import.meta.url),'utf8');
  assert.match(html,/id="testnetOpeningNotice"/);
  assert.match(html,/LIVE · UNSCORED/);
  assert.match(html,/zero vouchers, with no retroactive credit/);
  assert.match(html,/https:\/\/ask\.flop\.finance\/networks\/testnet/);
  assert.match(html,/0x918abd58fb16306b30ef3886514cfaebffecb4de43e82b6f8ec4795c43cfd800/);
  assert.match(html,/This voucher rule is NOT ACTIVE/);
  assert.match(html,/Check the official Testnet faucet status first/);
  assert.match(html,/Scoring is not active|scoring is not active|rewards are not counting yet/i);
  assert.match(js,/GENESIS_VERIFIED/);
  assert.match(js,/UNSCORED/);
  assert.match(js,/no vouchers are earned yet/);
  assert.match(readiness,/rewardsActive:false/);
  assert.match(readiness,/GENESIS_MISMATCH/);
  assert.match(css,/\.testnet-opening-notice/);
});

test('verified FLOP Testnet home has three transparent public actions and no legacy entry',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../js/unified.js',import.meta.url),'utf8');
  const css=await readFile(new URL('../css/unified.css',import.meta.url),'utf8');
  const readme=await readFile(new URL('../README.md',import.meta.url),'utf8');
  assert.match(html,/id="testnetStartHero"[^>]*href="https:\/\/testnet\.flopscan\.io\/"/);
  assert.match(html,/id="bringMyDidCTA"[^>]*data-view="identity"[^>]*>Create or import DID/);
  assert.match(html,/Testnet live · Rewards not active/);
  assert.match(html,/Verified genesis: <code id="verifiedGenesisHash">/);
  assert.match(html,/id="identityNextStep" hidden/);
  assert.match(html,/id="identityNextText"/);
  assert.match(html,/id="sideNetworkBadge"/);
  assert.doesNotMatch(html,/href="\/legacy\//);
  assert.match(js,/testnetVerified===true/);
  assert.match(js,/readiness\?\.status==='GENESIS_VERIFIED'/);
  assert.match(js,/sideNetworkBadge/);
  assert.match(js,/optionalSelectors/);
  assert.match(js,/#home \.reward-explainer/);
  assert.match(js,/if\(nextStep\)nextStep\.hidden=!activeDid/);
  assert.match(js,/localStorage\.setItem\(KEY_PROFILES,JSON\.stringify\(next\)\)/);
  assert.match(css,/\.identity-next-step/);
  assert.match(readme,/FLOPTRACE_TESTNET_EXPECTED_GENESIS=0x918abd58/);
  assert.match(readme,/UNSCORED/);
});


test('English DID-first homepage keeps optional faucet and no false claim action',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../js/unified.js',import.meta.url),'utf8');
  const css=await readFile(new URL('../css/unified.css',import.meta.url),'utf8');
  assert.match(html,/<html lang="en">/);
  assert.match(html,/id="mainJourney"/);
  for(const id of ['journeyDidStatus','journeyChatStatus','journeyFaucetStatus',
    'journeyFaucetLink','communityState','chatNext','postForm','testnetFaucetState']){
    assert.match(html,new RegExp('id="'+id+'"'));
  }
  assert.match(html,/Create or import DID/);
  assert.match(html,/Chat TechnoCore/);
  assert.match(html,/03 · OPTIONAL/);
  assert.match(html,/No wallet connection required|not required/i);
  assert.match(html,/does not earn airdrop points/i);
  assert.match(html,/id="subwalletFaucetHero"[^>]*href="https:\/\/faucet\.flop\.network\/"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  assert.match(html,/id="journeyFaucetLink"[^>]*target="_blank"[^>]*rel="noopener noreferrer">Open FLOP Faucet/);
  assert.match(html,/id="testnetFaucetDirect"[^>]*href="https:\/\/faucet\.flop\.network\/"[^>]*target="_blank"/);
  assert.doesNotMatch(html,/id="journeyFaucetLink"[^>]*hidden/);
  assert.match(html,/href="https:\/\/faucet\.flop\.network\/"/);
  assert.match(js,/function updateJourney\(/);
  assert.match(js,/updateJourney\(\)/);
  assert.match(js,/testnetVerified/);
  assert.match(js,/const verified=network==='testnet'&&testnetVerified/);
  assert.doesNotMatch(js,/journeyFaucetLink'\)\)\.hidden=true/);
  assert.match(js,/Grants still depend on eligibility and balance/);
  assert.match(js,/Faucet low balance/);
  assert.match(js,/journeyFaucetLink/);
  assert.match(css,/\.journey-grid\{display:grid/);
  assert.match(css,/\.journey-card\.support/);
  assert.match(css,/@media\(max-width:620px\)/);
  assert.match(css,/body\.testnet-verified #legacyQuickGrid/);
  assert.doesNotMatch(js,/fetch\([^)]*\/fund/i);
});

test('TechnoCore signatures continue to be client-side and no hosted inference forwarding',async()=>{
  const js=await readFile(new URL('../js/unified.js',import.meta.url),'utf8');
  const infer=await readFile(new URL('../api/infer.js',import.meta.url),'utf8');
  assert.match(js,/crypto\.subtle\.sign\('Ed25519'/);
  assert.match(js,/TECH\+'\/r\/'/);
  assert.match(js,/say-signed/);
  assert.match(js,/function openSigner\(/);
  assert.match(js,/if\(unlocked\.has\(activeDid\)\)/);
  assert.match(infer,/status\(410\)/);
  assert.doesNotMatch(infer,/fetch\s*\(/);
});
