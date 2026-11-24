// Shared, fail-closed FLOPTRACE membership. Never accept privilege from a client claim.
// Requires a persistent Upstash Redis REST database. No in-process membership or
// browser-only whitelist can grant access to a server resource.
const {createHash,randomBytes}=require('node:crypto');
const PREFIX='floptrace:wl:v1:';
const ORIGIN='https://flops-murex.vercel.app';
const COOKIE='__Host-floptrace_wl';
const SESSION_SECONDS=60*60*24*7;
function wallet(raw){
  if(typeof raw!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(raw))throw Error('Invalid EVM wallet address');
  return raw.toLowerCase();
}
function configured(){
  const u=process.env.UPSTASH_REDIS_REST_URL,token=process.env.UPSTASH_REDIS_REST_TOKEN;
  try{return !!token&&!!u&&new URL(u).protocol==='https:'&&!!new URL(u).hostname&&/^0x[0-9a-fA-F]{40}$/.test(process.env.FLOPTRACE_WL_ADMIN_WALLET||'');}catch{return false;}
}
function required(){
  if(!configured())throw Object.assign(Error('Membership storage is not configured.'),{statusCode:503});
}
async function redis(...args){
  required();
  const r=await fetch(process.env.UPSTASH_REDIS_REST_URL,{
    method:'POST',headers:{'Authorization':'Bearer '+process.env.UPSTASH_REDIS_REST_TOKEN,'Content-Type':'application/json'},
    body:JSON.stringify(args),signal:AbortSignal.timeout(5500),redirect:'error'
  });
  if(!r.ok)throw Error('Membership database unavailable');
  const data=await r.json();
  if(data?.error)throw Error('Membership database rejected the operation');
  return data.result;
}
function key(type,id=''){return PREFIX+type+id;}
function parse(json){try{return JSON.parse(json);}catch{return null;}}
function isAdmin(address){
  try{return wallet(process.env.FLOPTRACE_WL_ADMIN_WALLET||'')===address;}catch{return false;}
}
function strictOrigin(req){
  const origin=req.headers?.origin;
  const host=req.headers?.host;
  // Restrict browser mutation requests to our official Production origin.
  return (!origin||origin===ORIGIN)&&host==='flops-murex.vercel.app';
}
function secureCookie(token,maxAge){
  return COOKIE+'='+token+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+maxAge;
}
function clearCookie(){return secureCookie('',0);}
async function session(req){
  const header=String(req.headers?.cookie||'');
  const match=header.match(/(?:^|;\s*)__Host-floptrace_wl=([a-f0-9]{64})(?:;|$)/);
  if(!match)return null;
  const digest=createHash('sha256').update(match[1]).digest('hex');
  const value=parse(await redis('GET',key('session:',digest)));
  if(!value||!value.wallet||value.expires<=Date.now())return null;
  return value;
}
async function membership(address){
  const raw=await redis('GET',key('member:',address));
  return parse(raw);
}
async function viewer(req){
  required();
  const s=await session(req);
  if(!s)return {signedIn:false,approved:false,isAdmin:false,wallet:null,status:'GUEST'};
  const record=await membership(s.wallet);
  const active=record?.status==='ACTIVE'&&record?.wallet===s.wallet&&typeof record.id==='string'&&record.id.length>0;
  return {signedIn:true,approved:!!active,isAdmin:isAdmin(s.wallet),
    wallet:s.wallet,status:record?.status||'NOT_APPLIED',memberId:record?.id||null};
}
async function requireMember(req){
  const v=await viewer(req);
  if(v.isAdmin)return {...v,memberId:'admin:'+v.wallet};
  if(!v.approved)throw Object.assign(Error('Approved FLOPTRACE membership is required'),{statusCode:403});
  return v;
}
async function limiter(subject,limit,seconds){
  const slot=Math.floor(Date.now()/(seconds*1000));
  const id=key('rate:',createHash('sha256').update(subject+':'+slot).digest('hex'));
  const count=Number(await redis('INCR',id));
  if(count===1)await redis('EXPIRE',id,seconds+30);
  if(!Number.isSafeInteger(count)||count>limit)throw Object.assign(Error('Rate limit reached; try again later.'),{statusCode:429});
}
async function consumeInferenceQuota(memberId){
  // Simple per-member protection; a provider-side hard spending cap remains required.
  await limiter('inference:'+memberId,12,3600);
  await limiter('inference-day:'+memberId,60,86400);
}
function nonce(){return randomBytes(16).toString('hex');}
function sessionToken(){return randomBytes(32).toString('hex');}
function challengeMessage(address,n,expires){
  return ['FLOPTRACE Community Access','Domain: flops-murex.vercel.app',
    'Wallet: '+address,'Nonce: '+n,'Expires: '+new Date(expires).toISOString(),
    'Purpose: Sign in to your FLOPTRACE community access account.',
    'No tokens will be transferred, no FLOP chain action will be signed, and no wallet seed is requested.'].join('\n');
}
const APPLY_SCRIPT=[
  "if redis.call('EXISTS', KEYS[1]) ~= 0 then return 0 end",
  "redis.call('SET',KEYS[1],ARGV[1])",
  "redis.call('LPUSH',KEYS[2],ARGV[2])",
  "return 1"
].join('\n');
const REVIEW_SCRIPT=[
  "local raw=redis.call('GET',KEYS[1])",
  "if not raw then return 0 end",
  "local v=cjson.decode(raw)",
  "if ARGV[1]=='approve' then if v.status~='PENDING' then return 0 end v.status='ACTIVE'",
  "elseif ARGV[1]=='revoke' then if v.status~='ACTIVE' then return 0 end v.status='REVOKED'",
  "else return 0 end",
  "v.updatedAt=ARGV[2]",
  "redis.call('SET',KEYS[1],cjson.encode(v))",
  "redis.call('LPUSH',KEYS[2],ARGV[3])",
  "return 1"
].join('\n');
const ROTATE_SCRIPT=[
  "local a=redis.call('GET',KEYS[1])",
  "local b=redis.call('GET',KEYS[2])",
  "if not a or not b then return 0 end",
  "local old=cjson.decode(a)",
  "local incoming=cjson.decode(b)",
  "if old.status~='ACTIVE' or incoming.status~='PENDING' then return 0 end",
  "if old.wallet==incoming.wallet then return 0 end",
  "old.status='REVOKED'; old.replacedBy=incoming.wallet; old.updatedAt=ARGV[1]",
  "incoming.id=old.id; incoming.status='ACTIVE'; incoming.rotatedFrom=old.wallet; incoming.updatedAt=ARGV[1]",
  "redis.call('SET',KEYS[1],cjson.encode(old))",
  "redis.call('SET',KEYS[2],cjson.encode(incoming))",
  "redis.call('LPUSH',KEYS[3],ARGV[2])",
  "return 1"
].join('\n');
module.exports={ORIGIN,COOKIE,SESSION_SECONDS,wallet,configured,redis,key,parse,isAdmin,
  strictOrigin,secureCookie,clearCookie,session,membership,viewer,requireMember,limiter,
  consumeInferenceQuota,nonce,sessionToken,challengeMessage,APPLY_SCRIPT,REVIEW_SCRIPT,ROTATE_SCRIPT};
