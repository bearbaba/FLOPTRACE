const {createHash}=require('node:crypto');
const {configured:wlConfigured,requireMember,consumeInferenceQuota}=require('../lib/wl');
const GATEWAY='https://api.flop.network/v1/chat/completions';
// Validate any public Ed25519 did:key. No community member has a privileged preset DID.
const BASE58='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function validDid(did) {
  if(typeof did!=='string'||!did.startsWith('did:key:z')||did.length>128)return false;
  const raw=did.slice(9);
  if(!raw||[...raw].some(c=>!BASE58.includes(c)))return false;
  let n=0n;for(const c of raw)n=n*58n+BigInt(BASE58.indexOf(c));
  const bytes=[];
  while(n>0n){bytes.unshift(Number(n%256n));n/=256n;}
  for(const c of raw){if(c!=='1')break;bytes.unshift(0);}
  return bytes.length===34&&bytes[0]===0xed&&bytes[1]===0x01;
}
const digest=x=>createHash('sha256').update(x,'utf8').digest('hex');
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  if(req.method!=='POST') return res.status(405).json({error:'POST only'});
  const key=process.env.FLOP_API_KEY||'';
  const enabled=process.env.FLOPTRACE_ENABLE_INFERENCE==='1'&&process.env.FLOPTRACE_SPEND_CAP_ACK==='1'&&!!key;
  if(!enabled) return res.status(503).json({error:'Private inference is disabled by the site owner. Model browsing remains available.'});
  const origin=req.headers.origin;
  if(origin){
    try{
      const u=new URL(origin);
      if(!['http:','https:'].includes(u.protocol)||u.host!==req.headers.host) return res.status(403).json({error:'Cross-origin requests blocked'});
    }catch{return res.status(403).json({error:'Invalid origin'});}
  }
  if(!wlConfigured())return res.status(503).json({error:'FLOPTRACE community access storage is not configured. Inference stays closed.'});
  let member;
  try{
    member=await requireMember(req);
    await consumeInferenceQuota(member.memberId);
  }catch(error){
    return res.status(error.statusCode||503).json({error:error.statusCode?error.message:'Membership verification unavailable. No inference was sent.'});
  }
  const body=typeof req.body==='string'?(()=>{try{return JSON.parse(req.body);}catch{return null;}})():req.body;
  if(!body||typeof body!=='object'||Array.isArray(body)) return res.status(400).json({error:'Invalid JSON request'});
  const {did=null,model,prompt,system=''}=body;
  if(typeof model!=='string'||!(/^[a-z0-9._:/@+-]{1,180}$/i.test(model)))return res.status(400).json({error:'Invalid model'});
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>5000)return res.status(400).json({error:'Prompt must be 1–5000 characters'});
  if(typeof system!=='string'||system.length>1000)return res.status(400).json({error:'System prompt too long'});
  if(did!==null&&!validDid(did))return res.status(400).json({error:'Unknown DID label'});
  try{
    const payload={model,messages:[...(system?[{role:'system',content:system}]:[]),{role:'user',content:prompt.trim()}],max_tokens:512,stream:false};
    const response=await fetch(GATEWAY,{
      method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+key,'accept':'application/json'},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(25000),redirect:'error'
    });
    if(!response.ok){
      const code=response.status===401||response.status===403?502:response.status===429?429:502;
      return res.status(code).json({error:response.status===429?'FLOP Gateway rate limit reached':'FLOP Gateway could not complete inference',gatewayStatus:response.status});
    }
    const data=await response.json();
    const msg=data?.choices?.[0]?.message?.content;
    const output=typeof msg==='string'?msg:Array.isArray(msg)?msg.filter(x=>x?.type==='text').map(x=>x.text).join('\n'):'';
    if(!output)return res.status(502).json({error:'Gateway returned no text response'});
    return res.status(200).json({
      output,
      receipt:{schema:'floptrace.receipt.v3',kind:'inference',createdAt:new Date().toISOString(),
        model,did,requestSha256:digest(JSON.stringify({did,model,system,prompt:prompt.trim()})),
        outputSha256:digest(output),gatewayResponseId:typeof data?.id==='string'?data.id:null,
        status:'GATEWAY_RESPONSE',proofStatus:'NOT_VERIFIED',signatureStatus:'NOT_SIGNED',
        note:'Hash is a local receipt; not a PoUI/TEE/chain proof.'}
    });
  }catch{return res.status(502).json({error:'FLOP Gateway unreachable or timed out'});}
};