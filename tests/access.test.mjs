import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import access from '../lib/community-access.js';
import handler from '../api/community-access.js';
const HOST='flops-murex.vercel.app';
const SETTINGS={
  UPSTASH_REDIS_REST_URL:'https://example.upstash.io',
  UPSTASH_REDIS_REST_TOKEN:'fake-test-token',
  TURNSTILE_SITE_KEY:'fake-public-sitekey',
  TURNSTILE_SECRET_KEY:'fake-private-secret',
  FLOPTRACE_ADMIN_PASSPHRASE:'strong-dev-only-password-1234567890'
};
function res(){return{code:200,headers:{},setHeader(k,v){this.headers[k]=v;return this;},status(n){this.code=n;return this;},json(o){this.body=o;return this;}};}
async function env(values,fn){
  const before={};for(const [k,v] of Object.entries(values)){before[k]=process.env[k];if(v===null)delete process.env[k];else process.env[k]=v;}
  try{return await fn();}finally{for(const [k,v] of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}
function request(method='GET',body=null,headers={},query={}){return{method,body,headers:{host:HOST,...headers},query};}
function mockFetch(command){
  return async(url,options)=>{
    if(String(url).includes('challenges.cloudflare.com')){
      const action=new URLSearchParams(options.body).get('response')?.startsWith('return')?'floptrace_return':
        new URLSearchParams(options.body).get('response')?.startsWith('admin')?'floptrace_admin':'floptrace_join';
      return{ok:true,json:async()=>({success:true,hostname:HOST,action})};
    }
    const args=JSON.parse(options.body);
    return{ok:true,json:async()=>({result:await command(args)})};
  };
}
test('100 single-use invite links: X handle + CAPTCHA without EVM or SS58 signatures',async()=>{
  assert.equal(access.handle('@FLOP_Builder'),'flop_builder');
  assert.throws(()=>access.handle('@not-valid.name'),/valid X handle/);
  assert.throws(()=>access.handle('@'+('x'.repeat(16))),/valid X handle/);
  assert.equal(access.BATCH_SIZE,100);
  assert.equal(access.secureRequest(request('POST',{}, {origin:'https://evil.example'})),false);
  assert.equal(access.secureRequest(request('POST',{}, {origin:'https://flops-murex.vercel.app'})),true);
  assert.match(access.cookie(access.COOKIE,'a'.repeat(64),300),/Secure; HttpOnly; SameSite=Strict/);
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const ui=await readFile(new URL('../js/access-ui.mjs',import.meta.url),'utf8');
  for(const id of ['accessHandle','accessInvite','accessJoin','accessSlotsText','accessIssueBatch','accessCloseBatch','accessRecoveryValue','accessReturnLogin'])
    assert.ok(html.includes('id="'+id+'"'),id);
  assert.match(ui,/readPrivateInviteFromLink/);
  assert.match(ui,/history\.replaceState/);
  assert.match(ui,/floptrace_join/);
  assert.match(ui,/floptrace_return/);
  assert.doesNotMatch(ui,/eth_requestAccounts|personal_sign|signMessage|window\.ethereum|walletConnect/i);
  assert.doesNotMatch(html,/Kết nối ví & ký đăng nhập/);
});
test('unconfigured signup and wallet-less access fail closed, public status still works',async()=>{
  await env(Object.fromEntries(Object.keys(SETTINGS).map(x=>[x,null])),async()=>{
    assert.equal(access.configured(),false);
    const publicResponse=res();await handler(request(),publicResponse);
    assert.equal(publicResponse.code,200);
    assert.equal(publicResponse.body.isMember,false);
    assert.equal(publicResponse.body.configured,false);
    const join=res();await handler(request('POST',{action:'join',handle:'member',inviteCode:'a'.repeat(64)}),join);
    assert.equal(join.code,503);
    await assert.rejects(()=>access.requireMember(request()),/not configured/);
  });
});
test('Cloudflare CAPTCHA is checked server side with hostname and exact action',async()=>{
  await env(SETTINGS,async()=>{
    const previous=globalThis.fetch;
    globalThis.fetch=async()=>({ok:true,json:async()=>({success:true,hostname:HOST,action:'floptrace_join'})});
    try{
      assert.equal(await access.verifyCaptcha('a'.repeat(64),'floptrace_join',request()),true);
      await assert.rejects(()=>access.verifyCaptcha('invalid','floptrace_join',request()),/Solve the CAPTCHA/);
      await assert.rejects(()=>access.verifyCaptcha('a'.repeat(64),'floptrace_return',request()),/CAPTCHA failed/);
      globalThis.fetch=async()=>({ok:true,json:async()=>({success:true,hostname:'evil.example',action:'floptrace_join'})});
      await assert.rejects(()=>access.verifyCaptcha('a'.repeat(64),'floptrace_join',request()),/CAPTCHA failed/);
    }finally{globalThis.fetch=previous;}
  });
});
test('admin creates exactly 100 unique private one-seat links, and cannot start new open batch',async()=>{
  await env(SETTINGS,async()=>{
    const adminCookie=access.ADMIN_COOKIE+'='+'a'.repeat(64),previous=globalThis.fetch;
    let scriptArgs=[], scriptResult=1;
    globalThis.fetch=mockFetch(async args=>{
      const [command,key,...rest]=args;
      if(command==='GET'&&String(key).includes('admin:'))return JSON.stringify({role:'ADMIN',expires:Date.now()+3600000});
      if(command==='INCR')return 1;
      if(command==='EXPIRE')return 1;
      if(command==='EVAL'){scriptArgs=args;return scriptResult;}
      return null;
    });
    try{
      const response=res();await handler(request('POST',{action:'issue-batch'},{cookie:adminCookie}),response);
      assert.equal(response.code,200);
      assert.equal(response.body.links.length,100);
      assert.equal(new Set(response.body.links).size,100);
      assert.ok(response.body.links.every(x=>/^https:\/\/flops-murex\.vercel\.app\/\?view=access#invite=[a-f0-9]{64}$/.test(x)));
      assert.equal(scriptArgs[0],'EVAL');
      assert.equal(scriptArgs[2],2);
      for(const link of response.body.links)assert.equal(JSON.stringify(scriptArgs).includes(link.slice(-64)),false,
        'do not persist plain invitation tokens');
      scriptResult=0;
      const full=res();await handler(request('POST',{action:'issue-batch'},{cookie:adminCookie}),full);
      assert.equal(full.code,409);
    }finally{globalThis.fetch=previous;}
  });
});
test('claim uses atomic server-side LUA for one seat and never trusts the browser count',async()=>{
  await env(SETTINGS,async()=>{
    const old=globalThis.fetch;
    let claimResult=1,callArgs=[];
    globalThis.fetch=mockFetch(async args=>{
      const [cmd,key]=args;
      if(cmd==='INCR')return 1;
      if(cmd==='EXPIRE')return 1;
      if(cmd==='GET'&&String(key).includes('invite:'))return 'test-batch';
      if(cmd==='EVAL'){callArgs=args;return claimResult;}
      return null;
    });
    try{
      const input=request('POST',{action:'join',handle:'@builder',inviteCode:'d'.repeat(64),captchaToken:'testcaptcha1234567890123'});
      const success=res();await handler(input,success);
      assert.equal(success.code,200);
      assert.equal(success.body.claimed,1);
      assert.match(success.body.recoveryCode,/^[a-f0-9]{64}$/);
      assert.match(success.headers['Set-Cookie'],/HttpOnly/);
      assert.equal(callArgs[0],'EVAL');
      assert.equal(callArgs[2],7);
      assert.ok(JSON.stringify(callArgs).includes('test-batch'));
      assert.ok(!JSON.stringify(callArgs).includes(success.body.recoveryCode),'server persists only recovery hash');
      claimResult=-2;
      const duplicate=res();await handler(input,duplicate);assert.equal(duplicate.code,409);
      claimResult=-3;
      const full=res();await handler(input,full);assert.equal(full.code,409);
      claimResult=-1;
      const reused=res();await handler(input,reused);assert.equal(reused.code,409);
    }finally{globalThis.fetch=old;}
  });
});
test('members can sign in later with private recovery code without consuming another slot',async()=>{
  await env(SETTINGS,async()=>{
    const previous=globalThis.fetch,code='c'.repeat(64);
    let calls=[];
    globalThis.fetch=mockFetch(async args=>{
      calls.push(args);
      const [cmd,key]=args;
      if(cmd==='INCR'||cmd==='EXPIRE')return 1;
      if(cmd==='GET'&&String(key).includes('member:'))return JSON.stringify({id:'member1',handle:'builder',status:'ACTIVE',recoveryHash:access.digest(code)});
      return 'OK';
    });
    try{
      const result=res();await handler(request('POST',{action:'return-login',handle:'builder',recoveryCode:code,captchaToken:'returncaptcha1234567890'}),result);
      assert.equal(result.code,200);
      assert.equal(result.body.isMember,true);
      assert.match(result.headers['Set-Cookie'],/HttpOnly/);
      assert.ok(!calls.some(x=>x[0]==='EVAL'),'returning member should not consume a second seat');
      const bad=res();await handler(request('POST',{action:'return-login',handle:'builder',recoveryCode:'b'.repeat(64),captchaToken:'returncaptcha1234567890'}),bad);
      assert.equal(bad.code,401);
    }finally{globalThis.fetch=previous;}
  });
});
test('active membership checked on each protected call, revocation invalidates existing session',async()=>{
  await env(SETTINGS,async()=>{
    const token='b'.repeat(64),handle='test_member',previous=globalThis.fetch;
    let current='ACTIVE';
    globalThis.fetch=mockFetch(async args=>{
      const [cmd,key]=args;
      if(cmd==='GET'&&String(key).includes('session:'))return JSON.stringify({handle,expires:Date.now()+60000});
      if(cmd==='GET'&&String(key).includes('member:'))return JSON.stringify({id:'member-1',handle,status:current});
      return null;
    });
    try{
      const req=request('GET',null,{cookie:access.COOKIE+'='+token});
      assert.equal((await access.requireMember(req)).id,'member-1');
      current='REVOKED';
      await assert.rejects(()=>access.requireMember(req),/Approved FLOPTRACE membership is required/);
    }finally{globalThis.fetch=previous;}
  });
});
test('Lua atomically consumes invitation, increments claimed, rejects duplicates, full batches and closed batches',()=>{
  assert.match(access.BATCH_LUA,/claimed<limit/);
  assert.match(access.BATCH_LUA,/closed/);
  assert.match(access.CLAIM_LUA,/EXISTS/);
  assert.match(access.CLAIM_LUA,/claimed>=lim/);
  assert.match(access.CLAIM_LUA,/KEYS\[6\]/);
  assert.match(access.CLAIM_LUA,/HINCRBY/);
  assert.match(access.CLAIM_LUA,/redis\.call\('DEL',KEYS\[1\]\)/);
  assert.match(access.REVOKE_LUA,/REVOKED/);
});
