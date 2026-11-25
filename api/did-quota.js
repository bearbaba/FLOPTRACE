'use strict';
// Public endpoint. Persistent 2-DID/public-IP admission is active ONLY when
// UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN and a private 32+-char
// FLOPTRACE_DID_QUOTA_SALT are configured. Until then the site uses the
// explicitly labelled two-DID-per-browser fallback.
const q=require('../lib/did-ip-quota');

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'GET or POST only'});
  if(!q.configured())return res.status(req.method==='GET'?200:503).json({
    mode:'browser_only',limit:q.LIMIT,enforced:false,
    ...(req.method==='POST'?{error:'Persistent IP quota is not configured'}:{})
  });
  const ip=q.clientIp(req);
  if(!ip)return res.status(503).json({error:'Trusted visitor IP unavailable'});
  const ipHash=q.hashIp(ip,process.env.FLOPTRACE_DID_QUOTA_SALT);
  const slots=q.slotKey(ipHash);
  try{
    if(req.method==='GET'){
      const did=typeof req.query?.did==='string'?req.query.did:'';
      if(did&&!q.publicKeyFromDid(did))return res.status(400).json({error:'Invalid Ed25519 DID'});
      const entries=await q.redis(['SMEMBERS',slots]);
      const dids=Array.isArray(entries)?entries:[];
      return res.status(200).json({
        mode:'enforced',limit:q.LIMIT,enforced:true,
        used:dids.length,remaining:Math.max(0,q.LIMIT-dids.length),
        registered:did?dids.includes(did):null
      });
    }
    const b=typeof req.body==='string'?JSON.parse(req.body):req.body;
    if(!b||typeof b!=='object'||Array.isArray(b)||JSON.stringify(b).length>1200)
      return res.status(400).json({error:'Invalid JSON body'});
    const did=typeof b.did==='string'?b.did:'';
    if(!q.publicKeyFromDid(did))return res.status(400).json({error:'Valid Ed25519 DID required'});
    const key=q.challengeKey(ipHash,did);
    if(b.action==='challenge'){
      const rate=Number(await q.redis(['EVAL',q.RATE_SCRIPT,'1',q.rateKey(ipHash)]));
      if(rate>12)return res.status(429).json({error:'Too many signing attempts. Try later.'});
      const nonce=require('node:crypto').randomBytes(24).toString('hex');
      await q.redis(['SET',key,nonce,'EX','180']);
      return res.status(200).json({mode:'enforced',did,nonce,message:q.proofMessage(did,nonce),expiresSeconds:180});
    }
    if(b.action!=='register')return res.status(400).json({error:'Unknown action'});
    if(!q.validProof(did,b.nonce,b.signature))return res.status(403).json({error:'DID ownership signature invalid'});
    const result=await q.redis(['EVAL',q.CLAIM_SCRIPT,'2',slots,key,b.nonce,did]);
    if(!Array.isArray(result)||typeof result[0]!=='string')throw Error('Unexpected quota result');
    const [state,total]=result;
    if(state==='STALE')return res.status(409).json({error:'Signing challenge expired or already used'});
    if(state==='FULL')return res.status(429).json({error:'This public IP already has two registered DIDs. Shared networks may hit the limit.',limit:q.LIMIT,used:Number(total)});
    if(!['ADDED','EXISTS'].includes(state))throw Error('Unexpected quota state');
    return res.status(200).json({mode:'enforced',registered:true,limit:q.LIMIT,used:Number(total),remaining:Math.max(0,q.LIMIT-Number(total))});
  }catch(error){
    return res.status(503).json({error:'Persistent IP quota currently unavailable. Please try later.'});
  }
};
