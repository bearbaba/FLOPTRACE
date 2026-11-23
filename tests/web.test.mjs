import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {LAUNCH_UTC,getLaunchCountdown} from '../js/launch-clock.mjs';
import statusHandler from '../api/status.js';
import modelsHandler from '../api/models.js';
import inferHandler from '../api/infer.js';

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
test('inference blocks unauthenticated and cross-origin requests',async()=>{
  await withEnv({FLOPTRACE_ENABLE_INFERENCE:'1',FLOPTRACE_SPEND_CAP_ACK:'1',FLOP_API_KEY:'upstream-key',FLOPTRACE_ACCESS_TOKEN:'my-passcode'},async()=>{
    const body={model:'sample/model',prompt:'Hello'};
    const a=res();await inferHandler(req('POST',body),a);assert.equal(a.code,401);
    const b=res();await inferHandler(req('POST',body,{authorization:'Bearer my-passcode',origin:'https://evil.example'}),b);assert.equal(b.code,403);
    const c=res();await inferHandler(req('POST',{...body,did:'did:key:zBogus'},{authorization:'Bearer my-passcode'}),c);assert.equal(c.code,400);
  });
});
test('successful mocked gateway response is explicitly NOT VERIFIED',async()=>{
  await withEnv({FLOPTRACE_ENABLE_INFERENCE:'1',FLOPTRACE_SPEND_CAP_ACK:'1',FLOP_API_KEY:'upstream-key',FLOPTRACE_ACCESS_TOKEN:'my-passcode'},async()=>{
    const before=globalThis.fetch;let sent;
    globalThis.fetch=async(url,options)=>{sent={url,options};return {ok:true,json:async()=>({id:'test-inference',choices:[{message:{content:'Mocked answer'}}]})};};
    try{
      const response=res();
      await inferHandler(req('POST',{model:'sample/model',prompt:'Hello',did:'did:key:z6MktYZcwhU44paRoi5AwahUv66jKAMsxXvf2TxaUzLs3yyG'},{authorization:'Bearer my-passcode',origin:'https://flops-murex.vercel.app'}),response);
      assert.equal(response.code,200);
      assert.equal(response.body.output,'Mocked answer');
      assert.equal(response.body.receipt.proofStatus,'NOT_VERIFIED');
      assert.equal(response.body.receipt.signatureStatus,'NOT_SIGNED');
      assert.equal(response.body.receipt.outputSha256.length,64);
      assert.ok(sent.url.endsWith('/chat/completions'));
      assert.equal(JSON.stringify(response.body).includes('upstream-key'),false);
      assert.equal(JSON.stringify(response.body.receipt).includes('Hello'),false);
      const requestBody=JSON.parse(sent.options.body);assert.equal(requestBody.max_tokens,512);
    }finally{globalThis.fetch=before;}
  });
});
test('no public inference when owner has not enabled private access',async()=>{
  await withEnv({FLOPTRACE_ENABLE_INFERENCE:null,FLOPTRACE_SPEND_CAP_ACK:null,FLOP_API_KEY:null,FLOPTRACE_ACCESS_TOKEN:null},async()=>{
    const response=res();await inferHandler(req('POST',{model:'sample/model',prompt:'Hello'}),response);
    assert.equal(response.code,503);
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
  assert.match(html,/TARGET ONLY · LIVE NOT VERIFIED/);
  assert.match(html,/https:\/\/docs\.flop\.network\/docs\/network-testnet/);
  assert.match(html,/Import my DID/);
  assert.match(html,/Devnet tokens and activity carry no airdrop weight/);
  assert.match(html,/DID creation alone earns nothing/);
  assert.match(html,/A <code>did:key<\/code> is an agent identity, not an SS58 wallet address/);
  assert.match(js,/new Date\(LAUNCH_UTC\)/);
  assert.match(js,/Intl\.DateTimeFormat/);
  assert.match(js,/Await official confirmation that Testnet is live/);
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
    'Your agent earns by actually using AI.',
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
