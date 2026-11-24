// FLOPTRACE access list. X handle + Cloudflare Turnstile is a REQUEST,
// not proof of X ownership and never automatic membership.
const {randomBytes,createHash,timingSafeEqual}=require('node:crypto');
const ORIGIN='https://flops-murex.vercel.app';
const COOKIE='__Host-floptrace_access',ADMIN_COOKIE='__Host-floptrace_admin';
const PREFIX='floptrace:access:v1:';
const MEMBER_TTL=7*24*3600,ADMIN_TTL=2*3600,INVITE_TTL=14*24*3600;
function handle(value){
  const v=String(value||'').trim().replace(/^@/,'').toLowerCase();
  if(!/^[a-z0-9_]{1,15}$/.test(v))throw Object.assign(Error('Enter a valid X handle (1–15 letters, digits or underscores).'),{statusCode:400});
  return v;
}
function configured(env=process.env){
  try{
    const u=new URL(env.UPSTASH_REDIS_REST_URL||'');
    return u.protocol==='https:' && !!u.hostname && !!env.UPSTASH_REDIS_REST_TOKEN
      && typeof env.TURNSTILE_SITE_KEY==='string' && env.TURNSTILE_SITE_KEY.length>6
      && typeof env.TURNSTILE_SECRET_KEY==='string' && env.TURNSTILE_SECRET_KEY.length>6
      && typeof env.FLOPTRACE_ADMIN_PASSPHRASE==='string' && env.FLOPTRACE_ADMIN_PASSPHRASE.length>=24;
  }catch{return false;}
}
function required(){if(!configured())throw Object.assign(Error('Access list is not configured. No registrations or member privileges are enabled.'),{statusCode:503});}
function key(type,id=''){return PREFIX+type+id;}
function digest(v){return createHash('sha256').update(v).digest('hex');}
function randomToken(){return randomBytes(32).toString('hex');}
function parse(s){try{return JSON.parse(s);}catch{return null;}}
function inputIp(req){
  const str=String(req.headers?.['x-forwarded-for']||req.headers?.['x-real-ip']||'unknown').split(',')[0].trim();
  return str.slice(0,80)||'unknown';
}
function secureRequest(req){
  return req.headers?.host==='flops-murex.vercel.app' &&
    (!req.headers?.origin||req.headers.origin===ORIGIN) &&
    req.headers?.['sec-fetch-site']!=='cross-site';
}
function cookie(name,token,maxAge){
  return name+'='+token+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+maxAge;
}
function cookieToken(req,name){
  const all=String(req.headers?.cookie||'');
  const match=all.match(new RegExp('(?:^|;\\s*)'+name+'=([a-f0-9]{64})(?:;|$)'));
  return match?.[1]||null;
}
async function redis(...args){
  required();
  const r=await fetch(process.env.UPSTASH_REDIS_REST_URL,{
    method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.UPSTASH_REDIS_REST_TOKEN},
    body:JSON.stringify(args),redirect:'error',signal:AbortSignal.timeout(5500)
  });
  if(!r.ok)throw Error('Membership database unavailable');
  const response=await r.json();
  if(response?.error)throw Error('Membership database rejected request');
  return response.result;
}
async function rateLimit(subject,max,periodSeconds){
  const id=key('limit:',digest(subject+':'+Math.floor(Date.now()/(periodSeconds*1000))));
  const n=Number(await redis('INCR',id));
  if(n===1)await redis('EXPIRE',id,periodSeconds+30);
  if(!Number.isSafeInteger(n)||n>max)throw Object.assign(Error('Too many requests. Try again later.'),{statusCode:429});
}
async function verifyCaptcha(token,action,req){
  required();
  if(typeof token!=='string'||token.length<10||token.length>2048)
    throw Object.assign(Error('Solve the CAPTCHA before continuing.'),{statusCode:400});
  const body=new URLSearchParams({
    secret:process.env.TURNSTILE_SECRET_KEY,
    response:token,
    remoteip:inputIp(req)
  });
  let data;
  try{
    const r=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:body.toString(),redirect:'error',signal:AbortSignal.timeout(7000)
    });
    if(!r.ok)throw Error('CAPTCHA verification unavailable');
    data=await r.json();
  }catch{throw Object.assign(Error('CAPTCHA service unavailable. Please try again.'),{statusCode:503});}
  if(data?.success!==true || data.hostname!=='flops-murex.vercel.app'||data.action!==action)
    throw Object.assign(Error('CAPTCHA failed, expired or was already used. Please try again.'),{statusCode:400});
  return true;
}
async function memberFromRequest(req){
  required();
  const token=cookieToken(req,COOKIE);
  if(!token)return null;
  const record=parse(await redis('GET',key('session:',digest(token))));
  if(!record||record.expires<=Date.now()||!record.handle)return null;
  const member=parse(await redis('GET',key('member:',record.handle)));
  if(!member || member.status!=='ACTIVE'||member.handle!==record.handle)return null;
  return {handle:member.handle,id:member.id};
}
async function adminFromRequest(req){
  required();
  const token=cookieToken(req,ADMIN_COOKIE);
  if(!token)return false;
  const record=parse(await redis('GET',key('admin:',digest(token))));
  return !!record && record.expires>Date.now() && record.role==='ADMIN';
}
async function requireMember(req){
  const member=await memberFromRequest(req);
  if(!member)throw Object.assign(Error('Approved FLOPTRACE membership is required.'),{statusCode:403});
  return member;
}
async function consumeInferenceQuota(id){
  await rateLimit('inference:hour:'+id,12,3600);
  await rateLimit('inference:day:'+id,60,86400);
}
function safeAdminSecret(provided){
  const candidate=typeof provided==='string'?provided:'';
  const expected=process.env.FLOPTRACE_ADMIN_PASSPHRASE||'';
  const a=digest(candidate),b=digest(expected);
  return candidate.length>=24&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
}
const APPLY_LUA=[
 "if redis.call('EXISTS',KEYS[1])==1 then return 0 end",
 "redis.call('SET',KEYS[1],ARGV[1])",
 "redis.call('LPUSH',KEYS[2],ARGV[2])",
 "return 1"
].join('\\n');
const APPROVE_LUA=[
 "local raw=redis.call('GET',KEYS[1])",
 "if not raw then return 0 end",
 "local m=cjson.decode(raw)",
 "if ARGV[1]=='approve' then if m.status~='PENDING' then return 0 end",
 "elseif ARGV[1]=='reissue' then if m.status~='APPROVED' then return 0 end",
 "else return 0 end",
 "m.status='APPROVED';m.inviteHash=ARGV[2];m.updatedAt=ARGV[3]",
 "redis.call('SET',KEYS[1],cjson.encode(m))",
 "redis.call('SET',KEYS[2],ARGV[4],'EX',ARGV[5])",
 "redis.call('LPUSH',KEYS[3],ARGV[6])",
 "return 1"
].join('\\n');
const REDEEM_LUA=[
 "local raw=redis.call('GET',KEYS[1])",
 "if not raw then return 0 end",
 "local m=cjson.decode(raw)",
 "if m.status~='APPROVED' or m.inviteHash~=ARGV[1] then return 0 end",
 "m.status='ACTIVE';m.inviteHash=cjson.null;m.updatedAt=ARGV[2]",
 "redis.call('SET',KEYS[1],cjson.encode(m))",
 "redis.call('SET',KEYS[2],ARGV[3],'EX',ARGV[4])",
 "redis.call('DEL',KEYS[3])",
 "redis.call('LPUSH',KEYS[4],ARGV[5])",
 "return 1"
].join('\\n');
const REVOKE_LUA=[
 "local raw=redis.call('GET',KEYS[1])",
 "if not raw then return 0 end",
 "local m=cjson.decode(raw)",
 "if m.status=='REVOKED' then return 0 end",
 "m.status='REVOKED';m.inviteHash=cjson.null;m.updatedAt=ARGV[1]",
 "redis.call('SET',KEYS[1],cjson.encode(m))",
 "redis.call('LPUSH',KEYS[2],ARGV[2])",
 "return 1"
].join('\\n');
module.exports={ORIGIN,COOKIE,ADMIN_COOKIE,MEMBER_TTL,ADMIN_TTL,INVITE_TTL,handle,configured,required,
  key,digest,randomToken,parse,inputIp,secureRequest,cookie,cookieToken,redis,rateLimit,
  verifyCaptcha,memberFromRequest,adminFromRequest,requireMember,consumeInferenceQuota,
  safeAdminSecret,APPLY_LUA,APPROVE_LUA,REDEEM_LUA,REVOKE_LUA};
