// FLOPTRACE Testnet cutover gate: NOT a launch detector by clock/date alone.
// The operator must review FLOP's official announcement and independently pin the
// published block-0 genesis hash. A live RPC response must match that pinned hash.
// Never accept an RPC URL, genesis expectation or switch flag from the request.
const HASH=/^0x[0-9a-fA-F]{64}$/;
const DEVNET_GENESIS='0x99c172c095340ace980631f9123544c6bebd4839f3437e463533422d8be2d631';
function safeRpcUrl(raw){
  try{
    const u=new URL(raw);
    if(!['https:','wss:'].includes(u.protocol)||u.username||u.password||u.hash)return null;
    if(!u.hostname||u.hostname==='localhost'||u.hostname.endsWith('.local')
      ||/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(u.hostname)
      ||u.hostname.includes('devnet'))return null;
    return u.toString();
  }catch{return null;}
}
function safeAnnouncementUrl(raw){
  try{
    const u=new URL(raw);
    if(u.protocol!=='https:'||u.username||u.password)return null;
    if(!['flop.finance','www.flop.finance','docs.flop.network','ask.flop.finance'].includes(u.hostname))return null;
    return u.toString();
  }catch{return null;}
}
async function genesisOverHttp(url) {
  const response=await fetch(url,{
    method:'POST',
    headers:{'Content-Type':'application/json','Accept':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'chain_getBlockHash',params:[0]}),
    redirect:'error',signal:AbortSignal.timeout(4500)
  });
  if(!response.ok)throw Error('RPC request rejected');
  const body=await response.json();
  if(body?.id!==1||body?.error||!HASH.test(body?.result||''))throw Error('Invalid RPC genesis result');
  return body.result;
}
function genesisOverWss(url){
  return new Promise((resolve,reject)=>{
    if(typeof WebSocket!=='function'){reject(Error('Secure WebSocket unavailable'));return;}
    const socket=new WebSocket(url);
    let completed=false;
    const finish=(error,value)=>{
      if(completed)return;
      completed=true;clearTimeout(timer);
      try{socket.close();}catch{}
      if(error)reject(error);else resolve(value);
    };
    const timer=setTimeout(()=>finish(Error('RPC timeout')),4500);
    socket.addEventListener('open',()=>{
      try{socket.send(JSON.stringify({jsonrpc:'2.0',id:1,method:'chain_getBlockHash',params:[0]}));}
      catch{finish(Error('RPC request failed'));}
    });
    socket.addEventListener('message',event=>{
      let body;
      try{body=JSON.parse(String(event.data));}catch{return;}
      if(body?.id!==1)return;
      if(body.error||!HASH.test(body.result||''))finish(Error('Invalid RPC genesis result'));
      else finish(null,body.result);
    });
    socket.addEventListener('error',()=>finish(Error('RPC unavailable')));
    socket.addEventListener('close',()=>finish(Error('RPC closed')));
  });
}
async function verifyTestnet(env=process.env){
  // All three explicit inputs MUST exist. This cannot be activated by passing time.
  const expected=env.FLOPTRACE_TESTNET_EXPECTED_GENESIS;
  const rpc=safeRpcUrl(env.FLOPTRACE_TESTNET_RPC_URL||'');
  const announcement=safeAnnouncementUrl(env.FLOPTRACE_TESTNET_ANNOUNCEMENT_URL||'');
  const base={testnetVerified:false,network:'devnet',status:'AWAITING_VERIFIED_LAUNCH',
    officialAnnouncement:'https://flop.finance/',
    startUrl:null,genesisHash:null,
    message:'Testnet not verified. Keep using the public launch guide; Devnet activity does not count.'};
  if(env.FLOPTRACE_TESTNET_RELEASE_VERIFIED!=='1'||!HASH.test(expected||'')
    ||String(expected).toLowerCase()===DEVNET_GENESIS||!rpc||!announcement){
    return base;
  }
  try{
    const actual=rpc.startsWith('wss:')?await genesisOverWss(rpc):await genesisOverHttp(rpc);
    if(actual.toLowerCase()!==expected.toLowerCase())return {...base,status:'GENESIS_MISMATCH',
      message:'Official Testnet identity does not match the RPC block-0 hash. Do not connect.'};
    return {testnetVerified:true,network:'testnet',status:'GENESIS_VERIFIED',
      genesisHash:actual.toLowerCase(),officialAnnouncement:announcement,
      startUrl:'https://technocore.chat/',
      message:'Official release reviewed and block-0 genesis verified via the configured RPC. FLOPTRACE does not execute inference or verify vouchers.'};
  }catch{
    return {...base,status:'RPC_UNAVAILABLE',message:'Testnet genesis could not be independently verified through the configured RPC.'};
  }
}
async function handler(req,res){
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','public, s-maxage=45, stale-while-revalidate=45');
  if(req.method!=='GET')return res.status(405).json({error:'GET only'});
  return res.status(200).json(await verifyTestnet());
}
module.exports=handler;
module.exports.verifyTestnet=verifyTestnet;
module.exports.safeRpcUrl=safeRpcUrl;
