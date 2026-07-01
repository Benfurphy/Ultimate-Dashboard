// Shared helpers for the Garmin serverless functions (Vercel, Node runtime).
// Garmin has no self-serve developer API like WHOOP/Fitbit, so this logs into
// Garmin Connect directly (via the `garmin-connect` package) using the user's
// own credentials, then stores the resulting session tokens (never the
// password) in an httpOnly cookie — same trust model as the WHOOP/Fitbit
// refresh tokens, just without an OAuth redirect screen.
const { GarminConnect } = require('garmin-connect');

const COOKIE_NAME = 'garmin_tokens';

function isHttps(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  return proto.startsWith('https');
}
function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function cookie(name, val, opts) {
  opts = opts || {};
  let s = name + '=' + encodeURIComponent(val) + '; Path=/; HttpOnly; SameSite=Lax';
  if (opts.secure !== false) s += '; Secure';
  if (opts.maxAge != null) s += '; Max-Age=' + opts.maxAge;
  return s;
}
function clearCookie(name, secure) {
  return name + '=; Path=/; HttpOnly; SameSite=Lax' + (secure !== false ? '; Secure' : '') + '; Max-Age=0';
}

function tokensCookie(tokens, secure) {
  return cookie(COOKIE_NAME, JSON.stringify(tokens), { maxAge: 60 * 60 * 24 * 365, secure });
}
function clearTokensCookie(secure) {
  return clearCookie(COOKIE_NAME, secure);
}

// Reads the stored tokens and returns a logged-in client, or null if nothing's stored.
function clientFromCookies(req) {
  const cookies = parseCookies(req);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return null;
  let tokens;
  try { tokens = JSON.parse(raw); } catch (e) { return null; }
  if (!tokens || !tokens.oauth1 || !tokens.oauth2) return null;
  // The constructor throws synchronously if given no credentials at all, even though
  // we don't need a password here — we're restoring a session, not logging in.
  const client = new GarminConnect({ username: '', password: '' });
  client.loadToken(tokens.oauth1, tokens.oauth2);
  return client;
}

// Turns garmin-connect's raw login errors into a stable reason the frontend can branch on.
// MFA and account-lock detection aren't implemented in the underlying library (it just
// throws a generic "ticket not found" error for both), so treat any login failure as
// "needs the fallback token-paste flow" rather than pretending it's a bad password.
function loginErrorReason(e) {
  const msg = String((e && e.message) || e || '');
  if (/AccountLocked/i.test(msg)) return 'locked';
  if (/Ticket not found or MFA/i.test(msg)) return 'mfa_or_blocked';
  return 'failed';
}

module.exports = { GarminConnect, isHttps, parseCookies, tokensCookie, clearTokensCookie, clientFromCookies, loginErrorReason };
