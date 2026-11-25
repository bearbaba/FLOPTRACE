module.exports = function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET') return res.status(405).json({error:'GET only'});
  return res.status(200).json({
    app:'FLOPTRACE',network:'devnet',inferenceEnabled:false,identityMode:'LOCAL_ONLY',
    proofVerification:false,apiKeyExposed:false,
    message:'Model discovery only; hosted inference forwarding is retired'
  });
};