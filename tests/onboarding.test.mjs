import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {validateSs58} from '../js/ss58-utils.mjs';
import handler from '../api/devnet-health.js';
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes){
  let x=0n;for(const b of bytes)x=x*256n+BigInt(b);
  let s='';while(x>0n){s=alphabet[Number(x%58n)]+s;x/=58n;}
  for(const b of bytes){if(b!==0)break;s='1'+s;}return s;
}
function address(){
  const payload=Uint8Array.from([42,...Array.from({length:32},(_,i)=>i)]);
  const sum=createHash('sha512').update(Buffer.from('SS58PRE')).update(payload).digest();
  return base58([...payload,sum[0],sum[1]]);
}
function response(){return{code:200,headers:{},setHeader(k,v){this.headers[k]=v;return this;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};}
test('SS58 checksum rejects DID, garbled and altered wallet addresses',async()=>{
  const value=address();
  assert.equal((await validateSs58(value,webcrypto.subtle)).valid,true);
  assert.equal((await validateSs58(value.slice(0,-1)+'1',webcrypto.subtle)).valid,false);
  assert.equal((await validateSs58('did:key:z6MkBad',webcrypto.subtle)).valid,false);
  assert.equal((await validateSs58('not an address',webcrypto.subtle)).valid,false);
});
test('read-only Faucet diagnostics are never proof of grant availability',async()=>{
  const saved=globalThis.fetch;
  const seen=[];
  globalThis.fetch=async url=>{
    seen.push(url);
    return{ok:true,async json(){
      return url.includes('explorer')?{status:'ok',phase:'live',headLag:2}:{status:'ok',connected:true};
    }};
  };
  try{
    const res=response();await handler({method:'GET'},res);
    assert.equal(res.code,200);
    assert.equal(res.body.faucetService,'reachable');
    assert.equal(res.body.explorerIndexer,'live');
    assert.equal(res.body.headLag,2);
    assert.equal(res.body.grantAvailability,'NOT_VERIFIED');
    assert.equal(seen.length,2);
    assert.ok(seen.every(x=>x.endsWith('/health')&&!x.includes('/fund')));
    assert.match(res.headers['Cache-Control'],/s-maxage/);
  }finally{globalThis.fetch=saved;}
});
test('diagnostics fail safely without claiming Faucet is ready',async()=>{
  const saved=globalThis.fetch;
  globalThis.fetch=async()=>{throw Error('temporarily offline');};
  try{
    const res=response();await handler({method:'GET'},res);
    assert.equal(res.code,200);
    assert.equal(res.body.faucetService,'unknown');
    assert.equal(res.body.grantAvailability,'NOT_VERIFIED');
  }finally{globalThis.fetch=saved;}
});
test('the page gives beginners simple actions and collapses advanced controls',async()=>{
  const page=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../js/unified.js',import.meta.url),'utf8');
  for(const line of ['Explore without a wallet','Get test FLOP','Build your agent','Developer tools, API, MCP & SDK','Grants not verified','id="faucetService"','id="faucetIndexer"','id="refreshFaucet"'])
    assert.ok(page.includes(line),line);
  assert.match(page,/advanced-tools identity-advanced/);
  assert.match(js,/validateSs58\(address\)/);
  assert.match(js,/loadDevnetHealth/);
  assert.match(js,/grant availability remains unknown/i);
  assert.doesNotMatch(js,/fetch\([^)]*\/fund/);
});
