const {verifyMessage}=require('ethers');
const wl=require('../lib/wl');
const {randomUUID,createHash}=require('node:crypto');
const reject=(res,code,error)=>res.status(code).json({error});
function bodyOf(req){
  const raw=typeof req.body==='string'?JSON.parse(req.body):req.body;
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||JSON.stringify(raw).length>4096)throw Object.assign(Error('Invalid request payload'),{statusCode:400});
  return raw;
}
function actorId(req){
  const ip=String(req.headers['x-forwarded-for']||req.headers['x-real-ip']||'anonymous').split(',')[0].trim();
  return createHash('sha256').update(ip.slice(0,80)).digest('hex');
}
async function adminRows(){
  const wallets=await wl.redis('LRANGE',wl.key('queue'),0,199);
  if(!Array.isArray(wallets)||!wallets.length)return [];
  const unique=[...new Set(wallets)].slice(0,100);
  const raw=await wl.redis('MGET',...unique.map(x=>wl.key('member:',x)));
  return (Array.isArray(raw)?raw:[]).map(wl.parse).filter(Boolean).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
}
async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  if(!['GET','POST'].includes(req.method))return reject(res,405,'GET or POST only');
  if(!wl.configured())return req.method==='GET'
    ?res.status(200).json({configured:false,signedIn:false,approved:false,isAdmin:false,status:'UNAVAILABLE',wallet:null,message:'Access-list service is not configured. No membership is granted.'})
    :reject(res,503,'Membership backend is not configured; enrollment is not available.');
  if(req.method==='POST'&&!wl.strictOrigin(req))return reject(res,403,'Request origin must match the official FLOPTRACE site.');
  try{
    if(req.method==='GET'){
      const me=await wl.viewer(req);
      if(req.query?.view==='applications'){
        if(!me.isAdmin)return reject(res,403,'Administrator signature required.');
        return res.status(200).json({members:await adminRows()});
      }
      return res.status(200).json({configured:true,...me});
    }
    const body=bodyOf(req);
    if(body.action==='challenge'){
      const addr=wl.wallet(body.wallet);
      await wl.limiter('challenge:ip:'+actorId(req),15,3600);
      await wl.limiter('challenge:wallet:'+addr,10,3600);
      const nonce=wl.nonce(),expires=Date.now()+5*60_000;
      const message=wl.challengeMessage(addr,nonce,expires);
      const record=JSON.stringify({wallet:addr,message,expires});
      const result=await wl.redis('SET',wl.key('nonce:',nonce),record,'EX',300,'NX');
      if(result!=='OK')return reject(res,503,'Could not issue a unique login challenge.');
      return res.status(200).json({wallet:addr,nonce,message,expiresAt:new Date(expires).toISOString()});
    }
    if(body.action==='login'){
      const n=String(body.nonce||'');
      const signature=String(body.signature||'');
      if(!/^[a-f0-9]{32}$/.test(n)||!/^0x[0-9a-fA-F]{130}$/.test(signature))
        return reject(res,400,'Invalid signed login proof.');
      await wl.limiter('login:ip:'+actorId(req),30,3600);
      const record=wl.parse(await wl.redis('GETDEL',wl.key('nonce:',n)));
      if(!record||record.expires<Date.now())return reject(res,401,'Challenge expired or already consumed.');
      let signer;
      try{signer=wl.wallet(verifyMessage(record.message,signature));}
      catch{return reject(res,401,'Invalid wallet signature.');}
      if(signer!==record.wallet)return reject(res,401,'Signature belongs to a different wallet.');
      const token=wl.sessionToken(),expires=Date.now()+wl.SESSION_SECONDS*1000;
      const digest=createHash('sha256').update(token).digest('hex');
      await wl.redis('SET',wl.key('session:',digest),JSON.stringify({wallet:signer,expires}),'EX',wl.SESSION_SECONDS);
      res.setHeader('Set-Cookie',wl.secureCookie(token,wl.SESSION_SECONDS));
      const me=await wl.viewer({...req,headers:{...req.headers,cookie:wl.COOKIE+'='+token}});
      return res.status(200).json({configured:true,...me});
    }
    if(body.action==='logout'){
      const raw=String(req.headers.cookie||'').match(/(?:^|;\s*)__Host-floptrace_wl=([a-f0-9]{64})(?:;|$)/);
      if(raw)await wl.redis('DEL',wl.key('session:',createHash('sha256').update(raw[1]).digest('hex')));
      res.setHeader('Set-Cookie',wl.clearCookie());
      return res.status(200).json({signedIn:false,approved:false,status:'GUEST'});
    }
    const me=await wl.viewer(req);
    if(!me.signedIn)return reject(res,401,'Connect your EVM wallet and sign the login message first.');
    if(body.action==='apply'){
      await wl.limiter('apply:wallet:'+me.wallet,5,86400);
      const previous=await wl.membership(me.wallet);
      if(previous)return res.status(200).json({status:previous.status,memberId:previous.id,approved:previous.status==='ACTIVE'});
      const record={id:randomUUID(),wallet:me.wallet,status:'PENDING',createdAt:new Date().toISOString(),
        updatedAt:new Date().toISOString(),displayName:typeof body.displayName==='string'?body.displayName.trim().slice(0,50):''};
      const result=await wl.redis('EVAL',wl.APPLY_SCRIPT,2,wl.key('member:',me.wallet),wl.key('queue'),JSON.stringify(record),me.wallet);
      if(Number(result)!==1){
        const latest=await wl.membership(me.wallet);
        return res.status(200).json({status:latest?.status||'PENDING',memberId:latest?.id||null});
      }
      return res.status(200).json({status:'PENDING',memberId:record.id,approved:false});
    }
    if(body.action==='review'){
      if(!me.isAdmin)return reject(res,403,'Admin wallet signature required.');
      await wl.limiter('admin:review:'+me.wallet,100,3600);
      const operation=String(body.operation||'');
      const now=new Date().toISOString();
      if(operation==='approve'||operation==='revoke'){
        const addr=wl.wallet(body.wallet);
        const audit=JSON.stringify({operation,wallet:addr,by:me.wallet,time:now});
        const result=await wl.redis('EVAL',wl.REVIEW_SCRIPT,2,wl.key('member:',addr),wl.key('audit'),operation,now,audit);
        if(Number(result)!==1)return reject(res,409,'Member status changed or application is not eligible.');
        return res.status(200).json({ok:true,operation,wallet:addr});
      }
      if(operation==='rotate'){
        const old=wl.wallet(body.oldWallet),next=wl.wallet(body.newWallet);
        if(old===next)return reject(res,400,'Replacement wallet must differ.');
        // The replacement wallet must already have signed in and applied for membership.
        const audit=JSON.stringify({operation,oldWallet:old,newWallet:next,by:me.wallet,time:now});
        const result=await wl.redis('EVAL',wl.ROTATE_SCRIPT,3,wl.key('member:',old),wl.key('member:',next),wl.key('audit'),now,audit);
        if(Number(result)!==1)return reject(res,409,'Old membership must be active and new wallet must have a pending signed application.');
        return res.status(200).json({ok:true,operation,oldWallet:old,newWallet:next});
      }
      return reject(res,400,'Unknown admin operation.');
    }
    return reject(res,400,'Unknown action.');
  }catch(error){
    return reject(res,error.statusCode||503,error.statusCode?error.message:'Membership service unavailable. No rights were granted.');
  }
}
module.exports=handler;
