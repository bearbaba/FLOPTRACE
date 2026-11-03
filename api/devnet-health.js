// Read-only diagnostics. NEVER POST to /fund or infer grant readiness from /health.
async function readHealth(url) {
  try {
    const response=await fetch(url,{method:'GET',headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(5000)});
    if(!response.ok) return null;
    return await response.json();
  } catch {return null;}
}
module.exports=async function handler(req,res) {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','public, s-maxage=50, stale-while-revalidate=100');
  if(req.method!=='GET') return res.status(405).json({error:'GET only'});
  const [faucet,explorer]=await Promise.all([
    readHealth('https://faucet.flop.network/health'),
    readHealth('https://explorer.devnet.flop.network/api/health')
  ]);
  const service=faucet?.status==='ok'&&faucet?.connected===true?'reachable':faucet?'degraded':'unknown';
  const lag=Number.isSafeInteger(explorer?.headLag)&&explorer.headLag>=0?explorer.headLag:null;
  const indexer=explorer?.phase==='live'&&explorer?.status==='ok'?'live':
    explorer?.status==='catching_up'||explorer?.phase==='catching_up'?'catching_up':'unknown';
  return res.status(200).json({
    checkedAt:new Date().toISOString(),
    faucetService:service,
    explorerIndexer:indexer,
    headLag:lag,
    grantAvailability:'NOT_VERIFIED',
    note:'Service health and explorer progress do not prove that faucet /fund succeeds. Check the official faucet for actual grants.',
    officialFaucet:'https://faucet.flop.network'
  });
};
