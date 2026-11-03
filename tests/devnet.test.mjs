import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = () => readFile(new URL('../index.html',import.meta.url),'utf8');
const browser = () => readFile(new URL('../js/unified.js',import.meta.url),'utf8');
const api = () => readFile(new URL('../api/infer.js',import.meta.url),'utf8');

test('one unified public app contains discoverable Devnet Hub', async()=>{
  const page = await html();
  assert.match(page,/id="devnet"/);
  assert.match(page,/data-view="devnet"/);
  assert.match(page,/Start on Devnet/);
  assert.match(page,/PUBLIC DEVNET/);
  assert.match(page,/No rewards · No airdrop weight/);
  assert.match(page,/did:key/);
  for (const section of ['home','devnet','identity','inference','community','activity']) {
    assert.match(page,new RegExp('id="'+section+'"'));
  }
});

test('all public developer URLs are official, and affiliate call-to-action is clearly independent',async()=>{
  const page=await html();
  const official=[
    'https://explorer.devnet.flop.network',
    'https://faucet.flop.network',
    'https://api.flop.network/v1/models',
    'https://mcp.flop.network/mcp',
    'https://docs.flop.network/',
    'https://ask.flop.finance',
    'https://flop.finance/official/'
  ];
  for(const url of official) assert.ok(page.includes(url),url);
  assert.match(page,/https:\/\/x\.com\/Bearcrypto2021/);
  assert.match(page,/Not affiliated with FLOP Labs/);
  assert.match(page,/npm install @flop-labs\/client/);
  assert.match(page,/npm install @flop-labs\/sdk/);
  assert.match(page,/Copy endpoint/);
});

test('public model browser and copy actions are safe and functional',async()=>{
  const page=await html(), script=await browser();
  for(const id of ['modelResults','modelSearch','modelCount','copyAddress','devnetAddress','copyFeedback','refreshModels']) {
    assert.ok(page.includes('id="'+id+'"'),id);
  }
  assert.match(script,/publicModels\.filter/);
  assert.match(script,/renderModelCatalogue\(\)/);
  assert.match(script,/navigator\.clipboard\.writeText/);
  assert.match(script,/models\.length/);
  assert.match(script,/source\.textContent\.trim/);
  assert.match(script,/devnet:'Devnet Hub'/);
  assert.doesNotMatch(script,/innerHTML\s*=/);
  // The public tool never asks for a seed phrase to use Faucet or Explorer.
  assert.match(page,/No automatic claim/);
  assert.match(script,/This only checks its appearance/);
});

test('chain actions and PoUI are not misrepresented as implemented',async()=>{
  const page=await html(),script=await browser(),server=await api();
  assert.match(page,/does not create a FLOP chain wallet, submit transactions, attest PoUI/);
  assert.match(page,/does not guarantee an available completion route/);
  assert.match(server,/FLOPTRACE_ENABLE_INFERENCE/);
  assert.match(server,/FLOPTRACE_SPEND_CAP_ACK/);
  assert.match(server,/NOT_VERIFIED/);
  assert.match(script,/checksum or balance/);
});
