const {configured:wlConfigured}=require('../lib/wl');
module.exports = function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET') return res.status(405).json({error:'GET only'});
  const ready = process.env.FLOPTRACE_ENABLE_INFERENCE==='1'
    && process.env.FLOPTRACE_SPEND_CAP_ACK==='1'
    && !!process.env.FLOP_API_KEY
    && wlConfigured();
  return res.status(200).json({
    app:'FLOPTRACE',network:'devnet',inferenceEnabled:ready,identityMode:'LOCAL_ONLY',
    proofVerification:false,apiKeyExposed:false,accessListConfigured:wlConfigured(),
    message:ready?'Authenticated inference available':'Model discovery only; private inference is disabled'
  });
};