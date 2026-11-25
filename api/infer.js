module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(410).json({error: 'Hosted inference forwarding has been retired. Public model discovery remains available.'});
};
