import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { AGENTS, ed25519Did, hash, makeHandler } from './server.mjs';

const catalogue = [{ id: 'qwen/qwen2.5-0.5b-instruct' }];
async function serve(options = {}) {
  const server = createServer(makeHandler({
    models: async () => catalogue,
    completion: async () => ({ id: 'mock-gateway-id', choices: [{ message: { content: 'hello from mocked inference' } }] }),
    key: () => 'mock-credential',
    ...options
  }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { url: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(ok => server.close(ok)) };
}
async function post(url, body, headers = {}) {
  return fetch(url + '/api/infer', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}
const input = { model: catalogue[0].id, prompt: 'Explain FLOP', did: AGENTS[0].did };

test('DIDs are two unique Ed25519 public-key identifiers', () => {
  assert.equal(AGENTS.length, 2);
  assert.notEqual(AGENTS[0].did, AGENTS[1].did);
  assert.ok(AGENTS.every(agent => ed25519Did(agent.did)));
  assert.equal(ed25519Did('did:key:zinvalid'), false);
});
test('SHA-256 follows a known digest', () => {
  assert.equal(hash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('discovery and key status never expose secrets', async () => {
  const app = await serve();
  try {
    const status = await (await fetch(app.url + '/api/status')).json();
    assert.equal(status.keyConfigured, true);
    assert.equal(JSON.stringify(status).includes('mock-credential'), false);
    assert.equal(status.verifiedProof, false);
    const models = await (await fetch(app.url + '/api/models')).json();
    assert.equal(models.data[0].id, catalogue[0].id);
    const profiles = await (await fetch(app.url + '/api/agents')).json();
    assert.equal(profiles.ownershipVerified, false);
    assert.equal(profiles.walletLinked, false);
  } finally { await app.close(); }
});
test('without official API credential inference is disabled', async () => {
  const app = await serve({ key: () => '' });
  try {
    const response = await post(app.url, input);
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /API_KEY/);
  } finally { await app.close(); }
});
test('mocked gateway response creates a local unverified receipt', async () => {
  const app = await serve();
  try {
    const response = await post(app.url, input);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.output, 'hello from mocked inference');
    assert.equal(result.receipt.did, input.did);
    assert.equal(result.receipt.identityVerification, 'NOT_SIGNED');
    assert.equal(result.receipt.proof, 'NOT_VERIFIED');
    assert.equal(result.receipt.outputSha256, hash(result.output));
    assert.equal(JSON.stringify(result.receipt).includes(input.prompt), false);
  } finally { await app.close(); }
});
test('only known models and configured DID labels may be submitted', async () => {
  const app = await serve();
  try {
    assert.equal((await post(app.url, { ...input, model: 'unknown' })).status, 400);
    assert.equal((await post(app.url, { ...input, did: 'did:key:zUnknown' })).status, 400);
    assert.equal((await post(app.url, { ...input, prompt: 'x'.repeat(5001) })).status, 400);
  } finally { await app.close(); }
});
test('cross-origin submission is rejected', async () => {
  const app = await serve();
  try {
    assert.equal((await post(app.url, input, { origin: 'https://untrusted.example' })).status, 403);
  } finally { await app.close(); }
});
test('static UI is served without a secret', async () => {
  const app = await serve();
  try {
    const result = await fetch(app.url);
    assert.equal(result.status, 200);
    assert.match(await result.text(), /FLOPTRACE/);
    assert.equal((await fetch(app.url + '/does-not-exist')).status, 404);
  } finally { await app.close(); }
});
