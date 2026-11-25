'use strict';
const {createHash, createHmac, createPublicKey, randomBytes, verify}=require('node:crypto');
const {isIP}=require('node:net');

const LIMIT=2;
const PREFIX='floptrace:did-ip-quota:v1:';
const SIGN_PREFIX='FLOPTRACE DID quota v1';
const B58='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const SPKI_PREFIX=Buffer.from('302a300506032b6570032100','hex');

// Vercel overwrites X-Forwarded-For at its edge. Never trust a client-supplied
// IP from JSON or a browser header when this route is hosted outside Vercel.
function clientIp(req){
  const value=String(req.headers?.['x-forwarded-for']||'').split(',')[0].trim();
  return isIP(value)?value:null;
}
function configured(env=process.env){
  try{
    const url=new URL(env.UPSTASH_REDIS_REST_URL||'');
    return url.protocol==='https:'&&url.username===''&&url.password===''&&
      !!env.UPSTASH_REDIS_REST_TOKEN&&
      typeof env.FLOPTRACE_DID_QUOTA_SALT==='string'&&
      env.FLOPTRACE_DID_QUOTA_SALT.length>=32;
  }catch{return false;}
}
function hashIp(ip,secret){
  return createHmac('sha256',secret).update('floptrace-visitor-ip-v1|'+ip).digest('hex');
}
function shortDidHash(did){return createHash('sha256').update(did).digest('hex').slice(0,28);}
function slotKey(ipHash){return PREFIX+'ip:'+ipHash;}
function challengeKey(ipHash,did){return PREFIX+'challenge:'+ipHash+':'+shortDidHash(did);}
function rateKey(ipHash){return PREFIX+'rate:'+ipHash;}

function decode58(input){
  let n=0n;
  for(const c of input){
    const digit=B58.indexOf(c);
    if(digit<0)throw Error('Invalid Base58 DID');
    n=n*58n+BigInt(digit);
  }
  const bytes=[];
  while(n>0n){bytes.push(Number(n&255n));n>>=8n;}
  bytes.reverse();
  for(const c of input){if(c!=='1')break;bytes.unshift(0);}
  return Buffer.from(bytes);
}
function publicKeyFromDid(did){
  if(typeof did!=='string'||!/^did:key:z[1-9A-HJ-NP-Za-km-z]{45,55}$/.test(did))return null;
  try{
    const bytes=decode58(did.slice('did:key:z'.length));
    if(bytes.length!==34||bytes[0]!==0xed||bytes[1]!==0x01)return null;
    return createPublicKey({key:Buffer.concat([SPKI_PREFIX,bytes.subarray(2)]),format:'der',type:'spki'});
  }catch{return null;}
}
function proofMessage(did,nonce){return SIGN_PREFIX+'\n'+did+'\n'+nonce;}
function validProof(did,nonce,signature){
  const key=publicKeyFromDid(did);
  if(!key||typeof nonce!=='string'||! /^[a-f0-9]{48}$/.test(nonce)||
     typeof signature!=='string'||! /^[A-Za-z0-9_-]{85,88}$/.test(signature))return false;
  try{
    const sig=Buffer.from(signature,'base64url');
    return sig.length===64&&verify(null,Buffer.from(proofMessage(did,nonce)),key,sig);
  }catch{return false;}
}

async function redis(command,env=process.env){
  const response=await fetch(env.UPSTASH_REDIS_REST_URL,{
    method:'POST',
    headers:{authorization:'Bearer '+env.UPSTASH_REDIS_REST_TOKEN,'content-type':'application/json'},
    body:JSON.stringify(command),
    redirect:'error',
    signal:AbortSignal.timeout(5000)
  });
  if(!response.ok)throw Error('Persistent quota store unavailable');
  const data=await response.json();
  if(data?.error||!Object.hasOwn(data,'result'))throw Error('Persistent quota command failed');
  return data.result;
}
const RATE_SCRIPT="local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],60) end;return n";
const CLAIM_SCRIPT="local ch=redis.call('GET',KEYS[2]);if ch~=ARGV[1] then return {'STALE',redis.call('SCARD',KEYS[1])} end;redis.call('DEL',KEYS[2]);local count=redis.call('SCARD',KEYS[1]);if redis.call('SISMEMBER',KEYS[1],ARGV[2])==1 then return {'EXISTS',count} end;if count>=2 then return {'FULL',count} end;redis.call('SADD',KEYS[1],ARGV[2]);return {'ADDED',count+1}";

function response(res,code,body){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  return res.status(code).json(body);
}
module.exports={
  LIMIT,configured,clientIp,hashIp,slotKey,challengeKey,publicKeyFromDid,
  proofMessage,validProof,redis,RATE_SCRIPT,CLAIM_SCRIPT,response,rateKey
};
