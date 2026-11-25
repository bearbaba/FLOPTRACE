const FAUCET = 'https://faucet.flop.network';
const GENESIS = '0x918abd58fb16306b30ef3886514cfaebffecb4de43e82b6f8ec4795c43cfd800';

async function read(path) {
  const response = await fetch(FAUCET + path, {redirect: 'error', signal: AbortSignal.timeout(6000)});
  if (!response.ok) throw new Error('Faucet status unavailable');
  return response.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=45');
  if (req.method !== 'GET') return res.status(405).json({error: 'GET only'});
  try {
    const [chain, limits] = await Promise.all([read('/chain'), read('/limits')]);
    if (chain.network !== 'testnet' || chain.genesisHash !== GENESIS || limits.network !== 'testnet') {
      return res.status(503).json({status: 'unverified'});
    }
    const status = limits.faucet?.status;
    return res.status(200).json({status: ['open', 'low_balance'].includes(status) ? status : 'unavailable', network: 'testnet'});
  } catch {
    return res.status(503).json({status: 'unavailable'});
  }
};
