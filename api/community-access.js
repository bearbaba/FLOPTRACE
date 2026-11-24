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
  const handles=await a.redis('LRANGE',a.key('queue'),0,199);
  if(!Array.isArray(handles)||!handles.length)return [];
  const unique=[...new Set(handles)].slice(0,100);
  const rows=await a.redis('MGET',...unique.map(x=>a.key('member:',x)));
  return (Array.isArray(rows)?rows:[]).map(a.parse).filter(Boolean).map(m=>({
    handle:m.handle,status:m.status,id:m.id,createdAt:m.createdAt,updatedAt:m.updatedAt
  })).sort((x,y)=>String(y.createdAt).localeCompare(String(x.createdAt)));
}
async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  if(!['GET','POST'].includes(req.method))return fail(res,405,'GET or POST only.');
  if(req.method==='GET'&&req.query?.view!=='applications'){
    if(!a.configured())return res.status(200).json({configured:false,siteKey:null,isMember:false,isAdmin:false,handle:null,
      message:'Registration is not enabled until CAPTCHA and durable WL storage are configured.'});
    try{
      const [member,isAdmin]=await Promise.all([a.memberFromRequest(req),a.adminFromRequest(req)]);
      return res.status(200).json({configured:true,siteKey:process.env.TURNSTILE_SITE_KEY,
        isMember:!!member,isAdmin,handle:member?.handle||null});
    }catch{return fail(res,503,'Membership database unavailable. Privileges remain disabled.');}
  }
  if(!a.configured())return fail(res,503,'Registration and member access are not configured.');
  if(req.method==='POST'&&!a.secureRequest(req))return fail(res,403,'Use the official FLOPTRACE website.');
  try{
    if(req.method==='GET'){
      if(!await a.adminFromRequest(req))return fail(res,403,'Administrator authentication required.');
      return res.status(200).json({members:await listMembers()});
    }
    const b=parseBody(req),action=b.action;
    const ip=a.digest(a.inputIp(req));
    if(action==='apply'){
      await a.rateLimit('application:'+ip,5,86400);
      const handle=a.handle(b.handle);
      await a.verifyCaptcha(b.captchaToken,'floptrace_join',req);
      const now=new Date().toISOString();
      const record={id:randomUUID(),handle,status:'PENDING',createdAt:now,updatedAt:now};
      const result=await a.redis('EVAL',a.APPLY_LUA,2,a.key('member:',handle),a.key('queue'),JSON.stringify(record),handle);
      return res.status(200).json({status:Number(result)===1?'PENDING':'REQUEST_EXISTS',
        message:'If this handle is eligible, the administrator will review it. CAPTCHA does not prove X account ownership.'});
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
    if(action==='redeem'){
      await a.rateLimit('redeem:'+ip,10,3600);
      const code=String(b.inviteCode||'').trim().toLowerCase();
      if(!/^[a-f0-9]{64}$/.test(code))return fail(res,400,'Invalid private invitation code.');
      const hash=a.digest(code),invitation=a.parse(await a.redis('GET',a.key('invite:',hash)));
      if(!invitation||!invitation.handle)return fail(res,401,'Invitation is invalid or expired.');
      const token=a.randomToken(),expires=Date.now()+a.MEMBER_TTL*1000,now=new Date().toISOString();
      const session=JSON.stringify({handle:invitation.handle,expires});
      const audit=JSON.stringify({action:'redeem',handle:invitation.handle,time:now});
      const result=await a.redis('EVAL',a.REDEEM_LUA,4,
        a.key('member:',invitation.handle),a.key('session:',a.digest(token)),
        a.key('invite:',hash),a.key('audit'),hash,now,session,a.MEMBER_TTL,audit);
      if(Number(result)!==1)return fail(res,401,'Invitation is invalid or has been replaced.');
      res.setHeader('Set-Cookie',a.cookie(a.COOKIE,token,a.MEMBER_TTL));
      return res.status(200).json({isMember:true,handle:invitation.handle});
    }
    if(action==='logout'){
      const token=a.cookieToken(req,a.COOKIE),admin=a.cookieToken(req,a.ADMIN_COOKIE);
      if(token)await a.redis('DEL',a.key('session:',a.digest(token)));
      if(admin)await a.redis('DEL',a.key('admin:',a.digest(admin)));
      res.setHeader('Set-Cookie',[a.cookie(a.COOKIE,'',0),a.cookie(a.ADMIN_COOKIE,'',0)]);
      return res.status(200).json({isMember:false,isAdmin:false});
    }
    if(action==='approve'||action==='reissue'||action==='revoke'){
      if(!await a.adminFromRequest(req))return fail(res,403,'Administrator authentication required.');
      await a.rateLimit('admin-actions:'+ip,100,3600);
      const handle=a.handle(b.handle);
      const now=new Date().toISOString();
      if(action==='revoke'){
        const audit=JSON.stringify({action,handle,time:now});
        const result=await a.redis('EVAL',a.REVOKE_LUA,2,
          a.key('member:',handle),a.key('audit'),now,audit);
        if(Number(result)!==1)return fail(res,409,'Member is unavailable or already revoked.');
        return res.status(200).json({ok:true,status:'REVOKED',handle});
      }
      const inviteCode=a.randomToken(),hash=a.digest(inviteCode);
      const invitation=JSON.stringify({handle,issuedAt:now});
      const audit=JSON.stringify({action,handle,time:now});
      const result=await a.redis('EVAL',a.APPROVE_LUA,3,
        a.key('member:',handle),a.key('invite:',hash),a.key('audit'),
        action,hash,now,invitation,a.INVITE_TTL,audit);
      if(Number(result)!==1)return fail(res,409,'Application is not eligible for this operation.');
      return res.status(200).json({ok:true,status:'APPROVED',handle,
        inviteCode,expiresInDays:a.INVITE_TTL/86400,
        note:'Send this code PRIVATELY to the account owner after independently verifying control of the X handle. Never post the code publicly. It is shown only now.'});
    }
    return fail(res,400,'Unknown action.');
  }catch(error){
    return fail(res,error.statusCode||503,error.statusCode?error.message:'Membership service unavailable; no access granted.');
  }
}
module.exports=handler;
