import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATEWAY = 'https://api.flop.network/v1';
export const AGENTS = [
  { name: 'Main Agent', did: 'did:key:z6MktYZcwhU44paRoi5AwahUv66jKAMsxXvf2TxaUzLs3yyG' },
  { name: 'Review Agent', did: 'did:key:z6MktbDb2dVYvfm2C8koCMxvREpyCRDD1zFPzGgEdJQ1M2AR' }
];
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function ed25519Did(did) {
  if (typeof did !== 'string' || !did.startsWith('did:key:z') || did.length > 180) return false;
  const value = did.slice(9);
  if (!value || [...value].some(c => !BASE58.includes(c))) return false;
  let n = 0n;
  for (const c of value) n = n * 58n + BigInt(BASE58.indexOf(c));
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of value) { if (c !== '1') break; bytes.unshift(0); }
  return bytes.length === 34 && bytes[0] === 0xed && bytes[1] === 0x01;
}
export const hash = s => createHash('sha256').update(s, 'utf8').digest('hex');
function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('JSON required'), { status: 415 });
  let size = 0; const chunks = [];
  for await (const part of req) {
    size += part.length;
    if (size > 16_384) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(part);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Malformed JSON'), { status: 400 }); }
}
async function officialModels() {
  const r = await fetch(GATEWAY + '/models', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error('FLOP model discovery returned HTTP ' + r.status);
  const v = await r.json();
  if (!Array.isArray(v?.data)) throw new Error('Invalid FLOP model catalogue');
  return v.data.filter(m => typeof m?.id === 'string').slice(0, 100).map(m => ({ id: m.id }));
}
async function officialCompletion({ model, prompt, system, key }) {
  const { FlopClient } = await import('@flop-labs/client');
  const client = new FlopClient({ apiKey: key });
  return client.createChatCompletion({ model, messages: [
    ...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: prompt }
  ] });
}
export function makeHandler({
  models = officialModels,
  completion = officialCompletion,
  key = () => process.env.FLOP_API_KEY || ''
} = {}) {
  return async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const pathname = new URL(req.url || '/', 'http://localhost').pathname;
      if (req.method === 'GET' && pathname === '/api/status') {
        return json(res, 200, { app: 'FLOPTRACE', network: 'devnet', keyConfigured: !!key(), verifiedProof: false });
      }
      if (req.method === 'GET' && pathname === '/api/agents') {
        return json(res, 200, { data: AGENTS.map(a => ({ ...a, ed25519: ed25519Did(a.did) })), ownershipVerified: false, walletLinked: false });
      }
      if (req.method === 'GET' && pathname === '/api/models') {
        return json(res, 200, { data: await models(), gateway: GATEWAY });
      }
      if (req.method === 'POST' && pathname === '/api/infer') {
        const origin = req.headers.origin;
        if (origin) {
          let parsed;
          try { parsed = new URL(origin); }
          catch { return json(res, 403, { error: 'Invalid Origin' }); }
          if (parsed.host !== req.headers.host || !['http:', 'https:'].includes(parsed.protocol)) return json(res, 403, { error: 'Cross-origin inference disabled' });
        }
        const input = await readBody(req);
        const model = input?.model, prompt = input?.prompt, system = input?.system ?? '', did = input?.did ?? null;
        if (typeof model !== 'string' || !/^[a-z0-9._:/@+-]{1,180}$/i.test(model)) return json(res, 400, { error: 'Invalid model' });
        if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 5000) return json(res, 400, { error: 'Prompt must contain 1–5000 characters' });
        if (typeof system !== 'string' || system.length > 1000) return json(res, 400, { error: 'System instruction too long' });
        if (did !== null && !AGENTS.some(a => a.did === did)) return json(res, 400, { error: 'Unknown DID label' });
        const credential = key();
        if (!credential) return json(res, 503, { error: 'Official FLOP_API_KEY not configured' });
        const advertised = await models();
        if (!advertised.some(m => m.id === model)) return json(res, 400, { error: 'Model is not advertised by the gateway' });
        const result = await completion({ model, prompt: prompt.trim(), system, key: credential });
        const answer = result?.choices?.[0]?.message?.content;
        const output = typeof answer === 'string' ? answer : Array.isArray(answer) ? answer.filter(p => p?.type === 'text').map(p => p.text).join('\n') : '';
        if (!output) return json(res, 502, { error: 'No text output from gateway' });
        return json(res, 200, {
          output,
          receipt: {
            schema: 'floptrace.local-receipt.v1',
            createdAt: new Date().toISOString(),
            model,
            did,
            identityVerification: 'NOT_SIGNED',
            gatewayResponseId: typeof result?.id === 'string' ? result.id : null,
            requestSha256: hash(JSON.stringify({ model, prompt: prompt.trim(), system })),
            outputSha256: hash(output),
            proof: 'NOT_VERIFIED',
            proofExplanation: 'Local hashes are not PoUI, TEE, on-chain settlement, or proof of DID ownership.'
          }
        });
      }
      const asset = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'] }[pathname];
      if (req.method === 'GET' && asset) {
        const data = await readFile(join(HERE, 'web', asset[0]));
        res.writeHead(200, { 'content-type': asset[1], 'cache-control': 'no-cache' });
        return res.end(data);
      }
      return json(res, 404, { error: 'Not found' });
    } catch (e) {
      return json(res, Number.isInteger(e?.status) ? e.status : 502, { error: e?.status ? e.message : 'Upstream inference or model discovery failed' });
    }
  };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3030);
  createServer(makeHandler()).listen(port, host, () => console.log('FLOPTRACE listening at http://' + host + ':' + port));
}
