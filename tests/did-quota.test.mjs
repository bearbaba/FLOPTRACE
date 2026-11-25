import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import quota from '../lib/did-ip-quota.js';
import handler from '../api/did-quota.js';

const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes){
  let n=0n;for(const b of bytes)n=n*256n+BigInt(b);
  let s='';while(n>0n){s=alphabet[Number(n%58n)]+s;n/=58n;}
  for(const b of bytes){if(b!==0)break;s='1'+s;}
  return s;
}
function identity(){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const publicRaw=publicKey.export({format:'der',type:'spki'}).subarray(-32);
  const did='did:key:z'+base58(Buffer.concat([Buffer.from([0xed,0x01]),publicRaw]));
  return {did,privateKey};
}
function response(){
  return {code:200,headers:{},setHeader(k,v){this.headers[k]=v;return this;},
    status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
}
function req(method,body,ip='198.51.100.42',query={}){
  return {method,headers:{host:'flops-murex.vercel.app','x-forwarded-for':ip},
    body,query};
}
async function invoke(r){const out=response();await handler(r,out);return out;}
async function withEnv(values,fn){
  const before=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));
  for(const [k,v] of Object.entries(values)){if(v==null)delete process.env[k];else process.env[k]=v;}
  try{return await fn();}finally{
    for(const [k,v] of Object.entries(before)){if(v==null)delete process.env[k];else process.env[k]=v;}
  }
}
function mockRedis(){
  const values=new Map(),sets=new Map();
  return async (_url,opts)=>{
    const [cmd,...params]=JSON.parse(opts.body);
    let value;
    if(cmd==='SMEMBERS') value=[...(sets.get(params[0])||new Set())];
    else if(cmd==='SET'){values.set(params[0],params[1]);value='OK';}
    else if(cmd==='EVAL'&&params[0]===quota.RATE_SCRIPT){
      const key=params[2],next=(values.get(key)||0)+1;values.set(key,next);value=next;
    }else if(cmd==='EVAL'&&params[0]===quota.CLAIM_SCRIPT){
      const slots=params[2],challengeKey=params[3],nonce=params[4],did=params[5];
      const set=sets.get(slots)||new Set();
      if(values.get(challengeKey)!==nonce)value=['STALE',set.size];
      else{
        values.delete(challengeKey);
        if(set.has(did))value=['EXISTS',set.size];
        else if(set.size>=2)value=['FULL',set.size];
        else{set.add(did);sets.set(slots,set);value=['ADDED',set.size];}
      }
    }else throw Error('Unexpected Redis command: '+JSON.stringify([cmd,...params]).slice(0,200));
    return {ok:true,async json(){return{result:value};}};
  };
}
const configured={
  UPSTASH_REDIS_REST_URL:'https://quota-unit-test.upstash.io',
  UPSTASH_REDIS_REST_TOKEN:'test-only-token',
  FLOPTRACE_DID_QUOTA_SALT:'not-a-secret-in-test-0123456789abcdef'
};

test('no persistent config never claims a per-IP limit is active',async()=>{
  await withEnv({
    UPSTASH_REDIS_REST_URL:null,UPSTASH_REDIS_REST_TOKEN:null,FLOPTRACE_DID_QUOTA_SALT:null
  },async()=>{
    const status=await invoke(req('GET',null));
    assert.equal(status.code,200);
    assert.equal(status.body.mode,'browser_only');
    assert.equal(status.body.enforced,false);
    assert.equal(status.body.limit,2);
    const denied=await invoke(req('POST',{action:'challenge',did:identity().did}));
    assert.equal(denied.code,503);
  });
});

test('valid Ed25519 DID signature passes and mismatched key fails',()=>{
  const a=identity(),b=identity(),nonce=randomBytes(24).toString('hex');
  assert.ok(quota.publicKeyFromDid(a.did));
  assert.equal(quota.validProof(a.did,nonce,sign(null,Buffer.from(quota.proofMessage(a.did,nonce)),a.privateKey).toString('base64url')),true);
  assert.equal(quota.validProof(a.did,nonce,sign(null,Buffer.from(quota.proofMessage(a.did,nonce)),b.privateKey).toString('base64url')),false);
  assert.equal(quota.publicKeyFromDid('did:key:z6MktBad'),null);
  assert.equal(quota.clientIp(req('GET',null,'198.51.100.42')), '198.51.100.42');
  assert.equal(quota.clientIp(req('GET',null,'bad-ip')),null);
  assert.notEqual(quota.hashIp('198.51.100.42',configured.FLOPTRACE_DID_QUOTA_SALT),'198.51.100.42');
});

test('atomic quota admits just two different signed DIDs for one public IP',async()=>{
  const prior=globalThis.fetch;globalThis.fetch=mockRedis();
  try{await withEnv(configured,async()=>{
    const people=[identity(),identity(),identity()];
    const status=await invoke(req('GET',null));assert.equal(status.body.mode,'enforced');
    const challenges=await Promise.all(people.map(p=>invoke(req('POST',{action:'challenge',did:p.did}))));
    assert.ok(challenges.every(c=>c.code===200));
    const admitted=await Promise.all(people.map((p,i)=>{
      const {nonce,message}=challenges[i].body;
      return invoke(req('POST',{action:'register',did:p.did,nonce,
        signature:sign(null,Buffer.from(message),p.privateKey).toString('base64url')}));
    }));
    assert.deepEqual(admitted.map(x=>x.code).sort((a,b)=>a-b),[200,200,429]);
    const current=await invoke(req('GET',null));
    assert.equal(current.body.used,2);
    assert.equal(current.body.remaining,0);
    const otherIp=await invoke(req('GET',null,'203.0.113.90'));
    assert.equal(otherIp.body.used,0);
    // The server does not return other people's full DID lists to anyone on this IP.
    assert.equal('dids' in current.body,false);
  });}finally{globalThis.fetch=prior;}
});

test('replay fails, invalid signatures cannot register and IP quota cannot be reset by browser storage',async()=>{
  const prior=globalThis.fetch;globalThis.fetch=mockRedis();
  try{await withEnv(configured,async()=>{
    const p=identity(),wrong=identity();
    const ch=(await invoke(req('POST',{action:'challenge',did:p.did}))).body;
    const invalid=await invoke(req('POST',{action:'register',did:p.did,
      nonce:ch.nonce,signature:sign(null,Buffer.from(ch.message),wrong.privateKey).toString('base64url')}));
    assert.equal(invalid.code,403);
    const proof=sign(null,Buffer.from(ch.message),p.privateKey).toString('base64url');
    assert.equal((await invoke(req('POST',{action:'register',did:p.did,nonce:ch.nonce,signature:proof}))).code,200);
    assert.equal((await invoke(req('POST',{action:'register',did:p.did,nonce:ch.nonce,signature:proof}))).code,409);
    const info=(await invoke(req('GET',null,'198.51.100.42',{did:p.did}))).body;
    assert.equal(info.registered,true);
  });}finally{globalThis.fetch=prior;}
});

test('open public onboarding has no invite gate, signs locally and marks fallback clearly',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../js/unified.js',import.meta.url),'utf8');
  assert.match(html,/Open to everyone/);
  assert.match(html,/No invite required/);
  assert.match(html,/id="didQuotaStatus"/);
  assert.doesNotMatch(html,/id="accessInvite"/);
  assert.match(js,/MAX_LOCAL_DIDS=2/);
  assert.match(js,/DID_PROFILES\.slice\(0,MAX_LOCAL_DIDS\)/);
  assert.match(js,/async function ensureRegisteredDid\(/);
  assert.match(js,/await ensureRegisteredDid\(activeDid,signingKey\)/);
  assert.match(js,/await assertDidUsage\(did\)/);
  assert.match(js,/Browser limit active/);
  assert.match(js,/IP limit active/);
  assert.match(js,/crypto\.subtle\.sign\('Ed25519'/);
  assert.match(js,/say-signed/);
});
