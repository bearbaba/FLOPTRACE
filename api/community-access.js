// Wallet-free FLOPTRACE membership: 100 unique invitation links per batch.
// Each link grants at most ONE membership, only after Turnstile succeeds.
// All seat counting, consumption, and revocation happen atomically in Redis.
const {randomUUID}=require('node:crypto');
const a=require('../lib/community-access');
const fail=(res,status,message)=>res.status(status).json({error:message});
function parseBody(req){
  try{
    const b=typeof req.body==='string'?JSON.parse(req.body):req.body;
    if(!b||typeof b!=='object'||Array.isArray(b)||JSON.stringify(b).length>4096)
      throw Error('invalid');
    return b;
  }catch{throw Object.assign(Error('Invalid request body.'),{statusCode:400});}
}
async function listMembers(){
  const handles=await a.redis('LRANGE',a.key('members'),0,399);
  if(!Array.isArray(handles)||!handles.length)return [];
  const unique=[...new Set(handles)].slice(0,300);
  const raw=await a.redis('MGET',...unique.map(h=>a.key('member:',h)));
  return (Array.isArray(raw)?raw:[]).map(a.parse).filter(Boolean).map(m=>({
    handle:m.handle,status:m.status,id:m.id,joinedAt:m.joinedAt,updatedAt:m.updatedAt,batchId:m.batchId
  })).sort((x,y)=>String(y.joinedAt).localeCompare(String(x.joinedAt)));
}
async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  if(!['GET','POST'].includes(req.method))return fail(res,405,'GET or POST only.');
  if(!a.configured()){
    return req.method==='GET'&&req.query?.view!=='members'
      ?res.status(200).json({configured:false,siteKey:null,isMember:false,isAdmin:false,handle:null,
        slots:{active:false,capacity:100,claimed:0,remaining:0},
        message:'Invitations are not available until CAPTCHA, storage and admin security are configured.'})
      :fail(res,503,'Invite system is not configured. No membership is granted.');
  }
  if(req.method==='POST'&&!a.secureRequest(req))return fail(res,403,'Use the official FLOPTRACE website.');
  try{
    if(req.method==='GET'){
      if(req.query?.view==='members'){
        if(!await a.adminFromRequest(req))return fail(res,403,'Administrator authentication required.');
        return res.status(200).json({members:await listMembers()});
      }
      const [member,isAdmin,slots]=await Promise.all([
        a.memberFromRequest(req),a.adminFromRequest(req),a.batchStatus()
      ]);
      return res.status(200).json({configured:true,siteKey:process.env.TURNSTILE_SITE_KEY,
        isMember:!!member,isAdmin,handle:member?.handle||null,slots});
    }
    const b=parseBody(req),action=b.action;
    const ip=a.digest(a.inputIp(req));
    if(action==='join'){
      await a.rateLimit('join-ip:'+ip,8,3600);
      const handle=a.handle(b.handle);
      await a.rateLimit('join-handle:'+handle,6,3600);
      const code=String(b.inviteCode||'').trim().toLowerCase();
      if(!/^[a-f0-9]{64}$/.test(code))return fail(res,400,'Valid private invitation link or code required.');
      await a.verifyCaptcha(b.captchaToken,'floptrace_join',req);
      const hash=a.digest(code),batchId=await a.redis('GET',a.key('invite:',hash));
      if(!batchId)return fail(res,401,'This invite link is used, expired or invalid.');
      const now=new Date().toISOString(),token=a.randomToken(),expires=Date.now()+a.MEMBER_TTL*1000;
      const member={id:randomUUID(),handle,status:'ACTIVE',batchId,joinedAt:now,updatedAt:now};
      const session=JSON.stringify({handle,expires});
      const audit=JSON.stringify({action:'join',handle,batchId,time:now});
      const count=Number(await a.redis('EVAL',a.CLAIM_LUA,7,
        a.key('invite:',hash),a.key('member:',handle),a.key('batch:',batchId),
        a.key('session:',a.digest(token)),a.key('audit'),a.key('current-batch'),a.key('members'),
        batchId,JSON.stringify(member),session,a.MEMBER_TTL,audit,handle));
      if(count===2)return fail(res,409,'This X handle is already registered. Request an administrator review.');
      if(!Number.isSafeInteger(count)||count<1||count>100)
        return fail(res,409,'Invitation no longer has an available seat.');
      res.setHeader('Set-Cookie',a.cookie(a.COOKIE,token,a.MEMBER_TTL));
      return res.status(200).json({isMember:true,handle,claimed:count,capacity:100,
        message:'Your FLOPTRACE member access is active. This is not an FLOP airdrop whitelist.'});
    }
    if(action==='admin-login'){
      await a.rateLimit('admin-login:'+ip,5,3600);
      await a.verifyCaptcha(b.captchaToken,'floptrace_admin',req);
      if(!a.safeAdminSecret(b.passphrase))return fail(res,401,'Incorrect administrator passphrase.');
      const token=a.randomToken(),expires=Date.now()+a.ADMIN_TTL*1000;
      await a.redis('SET',a.key('admin:',a.digest(token)),JSON.stringify({role:'ADMIN',expires}),'EX',a.ADMIN_TTL);
      res.setHeader('Set-Cookie',a.cookie(a.ADMIN_COOKIE,token,a.ADMIN_TTL));
      return res.status(200).json({isAdmin:true});
    }
    if(action==='logout'){
      const token=a.cookieToken(req,a.COOKIE),admin=a.cookieToken(req,a.ADMIN_COOKIE);
      if(token)await a.redis('DEL',a.key('session:',a.digest(token)));
      if(admin)await a.redis('DEL',a.key('admin:',a.digest(admin)));
      res.setHeader('Set-Cookie',[a.cookie(a.COOKIE,'',0),a.cookie(a.ADMIN_COOKIE,'',0)]);
      return res.status(200).json({isMember:false,isAdmin:false});
    }
    if(!['issue-batch','close-batch','revoke'].includes(action))return fail(res,400,'Unknown action.');
    if(!await a.adminFromRequest(req))return fail(res,403,'Administrator authentication required.');
    await a.rateLimit('admin-actions:'+ip,25,3600);
    if(action==='issue-batch'){
      const id=randomUUID(),codes=Array.from({length:a.BATCH_SIZE},()=>a.randomToken());
      const now=new Date().toISOString(),expiresAt=new Date(Date.now()+a.INVITE_TTL*1000).toISOString();
      const result=Number(await a.redis('EVAL',a.BATCH_LUA,2,
        a.key('current-batch'),a.key('batch:',id),id,a.BATCH_SIZE,a.INVITE_TTL,now,expiresAt,
        ...codes.map(a.digest)));
      if(result!==1)return fail(res,409,'Current 100-seat batch still has unused slots. Close it or wait until all 100 seats are claimed.');
      // Fragment is never sent to the website as part of an HTTP request or referrer.
      const links=codes.map(code=>a.ORIGIN+'/?view=access#invite='+code);
      return res.status(200).json({batchId:id,capacity:a.BATCH_SIZE,expiresAt,links,
        warning:'Copy and store these 100 one-use links now. Plaintext codes are never stored by the server. Share privately.'});
    }
    const current=await a.batchStatus();
    if(action==='close-batch'){
      if(!current.active)return fail(res,409,'There is no open invitation batch.');
      await a.redis('HSET',a.key('batch:',current.batchId),'closed','1');
      return res.status(200).json({closed:true,batchId:current.batchId});
    }
    if(action==='revoke'){
      const handle=a.handle(b.handle),now=new Date().toISOString();
      const audit=JSON.stringify({action:'revoke',handle,time:now});
      const result=Number(await a.redis('EVAL',a.REVOKE_LUA,2,
        a.key('member:',handle),a.key('audit'),now,audit));
      if(result!==1)return fail(res,409,'Membership not found or already revoked.');
      return res.status(200).json({revoked:true,handle});
    }
    return fail(res,400,'Unknown action.');
  }catch(error){
    return fail(res,error.statusCode||503,error.statusCode?error.message:'Membership service unavailable; no access granted.');
  }
}
module.exports=handler;
