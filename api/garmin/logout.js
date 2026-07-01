// GET /api/garmin/logout — forgets the stored Garmin session tokens (disconnect).
const L = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('content-type', 'application/json');
  res.setHeader('Set-Cookie', L.clearTokensCookie(L.isHttps(req)));
  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true }));
};
