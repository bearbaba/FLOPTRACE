const MODEL_URL='https://api.flop.network/v1/models';
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET') return res.status(405).json({error:'GET only'});
  try{
    const response=await fetch(MODEL_URL,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(8500),redirect:'error'});
    if(!response.ok) return res.status(502).json({error:'FLOP model catalogue is unavailable',status:response.status});
    const body=await response.json();
    if(!Array.isArray(body?.data)) return res.status(502).json({error:'Unexpected model catalogue response'});
    return res.status(200).json({data:body.data.filter(m=>typeof m?.id==='string').slice(0,100).map(m=>({id:m.id})),source:'official FLOP gateway'});
  }catch{
    return res.status(502).json({error:'Could not reach the official FLOP gateway'});
  }
};