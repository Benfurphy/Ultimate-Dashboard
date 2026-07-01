// POST /api/garmin/tokens — fallback connect path for when /api/garmin/login gets
// blocked by Garmin's cloud-IP verification challenge. Accepts the token JSON
// printed by `scripts/garmin-get-tokens.js` (run once from a trusted network) and
// stores it the same way a successful direct login would. See GARMIN_SETUP.md.
const L = require('./_lib');

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); } });
  });
}

module.exports = async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' })); return; }

  const body = await readBody(req);
  const tokens = body && body.tokens;
  if (!tokens || !tokens.oauth1 || !tokens.oauth2) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: 'invalid_tokens' })); return; }

  res.statusCode = 200;
  res.setHeader('Set-Cookie', L.tokensCookie(tokens, L.isHttps(req)));
  res.end(JSON.stringify({ ok: true }));
};
