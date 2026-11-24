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
function request(method='GET',body=null,headers={},query={}){return {method,body,headers:{host:HOST,...headers},query};}
test('X Handle + CAPTCHA is a request, not authentication, and code contains no wallet signing UI',async()=>{
  assert.equal(access.handle('@FLOP_Builder'),'flop_builder');
  assert.throws(()=>access.handle('@not-a-valid.handle'),/valid X handle/);
  assert.throws(()=>access.handle('@a'.repeat(30)),/valid X handle/);
  assert.equal(access.secureRequest(request('POST',{}, {origin:'https://evil.example'})),false);
  assert.equal(access.secureRequest(request('POST',{}, {origin:'https://flops-murex.vercel.app'})),true);
  assert.match(access.cookie(access.COOKIE,'a'.repeat(64),300),/Secure; HttpOnly; SameSite=Strict/);
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const ui=await readFile(new URL('../js/access-ui.mjs',import.meta.url),'utf8');
  assert.match(html,/Danh sách truy cập FLOPTRACE/);
  assert.match(html,/id="accessHandle"/);
  assert.match(html,/id="accessCaptcha"/);
  assert.match(html,/id="accessInvite"/);
  assert.match(ui,/turnstile\/v0\/api\.js/);
  assert.match(ui,/floptrace_join/);
  assert.doesNotMatch(ui,/eth_requestAccounts|personal_sign|signMessage|window\.ethereum|walletConnect/i);
  assert.doesNotMatch(html,/Kết nối ví & ký đăng nhập/);
});
test('unconfigured signup is visible but never accepts applications or grants member access',async()=>{
  await env(Object.fromEntries(Object.keys(SETTINGS).map(x=>[x,null])),async()=>{
    assert.equal(access.configured(),false);
    const publicResponse=res();await handler(request(),publicResponse);
    assert.equal(publicResponse.code,200);
    assert.equal(publicResponse.body.configured,false);
    assert.equal(publicResponse.body.isMember,false);
    const signup=res();await handler(request('POST',{action:'apply',handle:'member',captchaToken:'not-a-real-token'}),signup);
    assert.equal(signup.code,503);
    assert.equal(signup.body.error.includes('not configured'),true);
    await assert.rejects(()=>access.requireMember(request()),/not configured/);
  });
});
test('captcha is verified against Cloudflare Siteverify, hostname and action on server',async()=>{
  await env(SETTINGS,async()=>{
    let seen;
    const prev=globalThis.fetch;
    globalThis.fetch=async(url,options)=>{
      seen={url,options};
      return{ok:true,json:async()=>({success:true,hostname:HOST,action:'floptrace_join'})};
    };
    try{
      assert.equal(await access.verifyCaptcha('t'.repeat(45),'floptrace_join',request()),true);
      assert.equal(seen.url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');
      assert.ok(String(seen.options.body).includes('response='));
      await assert.rejects(()=>access.verifyCaptcha('fake','floptrace_join',request()),/Solve the CAPTCHA/);
      await assert.rejects(()=>access.verifyCaptcha('t'.repeat(45),'floptrace_admin',request()),/CAPTCHA failed/);
      globalThis.fetch=async()=>({ok:true,json:async()=>({success:true,hostname:'evil.example',action:'floptrace_join'})});
      await assert.rejects(()=>access.verifyCaptcha('t'.repeat(45),'floptrace_join',request()),/CAPTCHA failed/);
      globalThis.fetch=async()=>({ok:true,json:async()=>({success:false,hostname:HOST,action:'floptrace_join'})});
      await assert.rejects(()=>access.verifyCaptcha('t'.repeat(45),'floptrace_join',request()),/CAPTCHA failed/);
    }finally{globalThis.fetch=prev;}
  });
});
test('approved user is required on every API call; revoked membership fails even with session cookie',async()=>{
  await env(SETTINGS,async()=>{
    const token='b'.repeat(64),handle='test_member';
    const prev=globalThis.fetch;
    let recordStatus='ACTIVE';
    globalThis.fetch=async(url,opts)=>{
      const [cmd,k]=JSON.parse(opts.body);
      let result=null;
      if(cmd==='GET'&&String(k).includes('session:'))result=JSON.stringify({handle,expires:Date.now()+60000});
      if(cmd==='GET'&&String(k).includes('member:'))result=JSON.stringify({id:'member-1',handle,status:recordStatus});
      return {ok:true,json:async()=>({result})};
    };
    try{
      const req=request('GET',null,{cookie:access.COOKIE+'='+token});
      assert.equal((await access.requireMember(req)).id,'member-1');
      recordStatus='REVOKED';
      await assert.rejects(()=>access.requireMember(req),/Approved FLOPTRACE membership is required/);
    }finally{globalThis.fetch=prev;}
  });
});
test('admin approval and invite redemption are keyed to server-side records, not a submitted X handle alone',()=>{
  assert.equal(access.safeAdminSecret('guess'),false);
  assert.ok(access.APPLY_LUA.includes('EXISTS'));
  assert.ok(access.APPROVE_LUA.includes('PENDING'));
  assert.ok(access.REDEEM_LUA.includes('inviteHash'));
  assert.ok(access.REDEEM_LUA.includes('ACTIVE'));
  assert.ok(access.REVOKE_LUA.includes('REVOKED'));
  assert.ok(access.REDEEM_LUA.includes("redis.call('DEL',KEYS[3])"));
});
