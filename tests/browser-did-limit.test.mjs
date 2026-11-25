import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {addProfile,removeProfile,normalizedProfiles,isValidEd25519Did} from '../js/did-utils.mjs';

const source=()=>readFile(new URL('../js/unified.js',import.meta.url),'utf8');
const page=()=>readFile(new URL('../index.html',import.meta.url),'utf8');

function did(seed){
  const bytes=Buffer.from('ed01'+createHash('sha256').update(seed).digest('hex'),'hex');
  const abc='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n=0n;for(const byte of bytes)n=n*256n+BigInt(byte);
  let encoded='';while(n){encoded=abc[Number(n%58n)]+encoded;n/=58n;}
  return 'did:key:z'+encoded;
}

test('two independent DID profiles can be saved, and removal frees a local slot',()=>{
  const d1=did('one'),d2=did('two'),d3=did('three');
  assert.ok([d1,d2,d3].every(isValidEd25519Did));
  let profiles=normalizedProfiles([]);
  profiles=addProfile(profiles,{did:d1,name:'first'});
  profiles=addProfile(profiles,{did:d2,name:'second'});
  const limit=2;
  assert.equal(profiles.length,limit);
  assert.equal(profiles.length>=limit,true);
  assert.deepEqual(profiles.map(p=>p.did),[d1,d2]);
  profiles=removeProfile(profiles,d1);
  assert.equal(profiles.length,1);
  profiles=addProfile(profiles,{did:d3,name:'third'});
  assert.deepEqual(profiles.map(p=>p.did),[d2,d3]);
});

test('browser UI enforces two profiles on create, import, restore and signed chat',async()=>{
  const html=await page(),js=await source();
  assert.match(js,/const MAX_LOCAL_DIDS=2/);
  assert.match(js,/function ensureNewDidCapacity\(\)/);
  assert.match(js,/if\(DID_PROFILES\.length>=MAX_LOCAL_DIDS\)/);
  assert.match(js,/function registerProfile\(did,name\)/);
  assert.match(js,/DID_PROFILES\.length>=MAX_LOCAL_DIDS/);
  assert.match(js,/function allowedLocalDid\(did\)/);
  assert.match(js,/DID_PROFILES\.slice\(0,MAX_LOCAL_DIDS\)/);
  assert.match(js,/function assertDidUsage\(did\)/);
  assert.match(js,/assertDidUsage\(activeDid\)/);
  assert.match(js,/assertDidUsage\(did\)/);
  assert.match(js,/ensureNewDidCapacity\(\)/);
  assert.match(js,/DID_PROFILES=removeProfile\(DID_PROFILES,item\.did\)/);
  assert.match(js,/refreshDidQuotaStatus\(\)/);
  assert.match(html,/id="didCreateLimit"/);
  assert.match(html,/id="didQuotaStatus"/);
  assert.match(html,/Back up an existing DID before removing/);
  assert.match(html,/Open to everyone/);
  assert.match(html,/No invite required/);
  assert.match(html,/no IP-wide restriction/);
  assert.match(js,/Browser|browser/);
  assert.match(js,/crypto\.subtle\.sign\('Ed25519'/);
  assert.match(js,/\/say-signed\//);
});

test('no IP or Redis quota remains in the public execution path',async()=>{
  const html=await page(),js=await source();
  for(const content of [html,js]){
    assert.doesNotMatch(content,/\/api\/did-quota/);
    assert.doesNotMatch(content,/FLOPTRACE_DID_QUOTA_SALT/);
    assert.doesNotMatch(content,/UPSTASH_REDIS_REST_TOKEN/);
  }
  assert.doesNotMatch(js,/x-forwarded-for|ipHash|HMAC|ensureRegisteredDid|\bquotaStatus\(/i);
  assert.doesNotMatch(js,/fetch\([^)]*\/fund/i);
  assert.match(html,/<html lang="en">/);
  assert.match(html,/href="https:\/\/faucet\.flop\.network\/"/);
  assert.match(js,/const TECH='https:\/\/technocore\.chat'/);
});
