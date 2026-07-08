// Shared helpers for the TickTick OAuth serverless functions (Vercel, Node runtime).
// Same shape as api/whoop/_lib.js — client secret lives only here (server-side,
// from env). Tokens are kept in httpOnly cookies, never exposed to the browser.
const crypto = require('crypto');

const AUTH_URL = 'https://ticktick.com/oauth/authorize';
const TOKEN_URL = 'https://ticktick.com/oauth/token';
const API_BASE = 'https://api.ticktick.com/open/v1';
const SCOPE = 'tasks:read tasks:write';

function getOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return proto + '://' + host;
}
// Everything still lives in one function file (index.js), to stay inside
// Vercel's Hobby-plan 12-function cap — see the note at the top of index.js.
// The redirect URI itself is a clean path with no query string, though:
// TickTick's app-registration form doesn't reliably accept (or silently
// drops) a "?action=callback" suffix on a registered redirect URI. A
// vercel.json rewrite maps this clean path back to /api/ticktick?action=callback
// under the hood, so it's still one function — just a normal-looking URL
// to register on TickTick's side.
//
// The origin itself is NOT derived from the incoming request by default.
// Every Vercel deployment gets its own unique preview URL
// (my-app-<hash>-<team>.vercel.app) in addition to the stable production
// domain — if you click through from a preview URL, the dynamically-built
// redirect_uri won't match whatever's registered with TickTick (that's
// exactly what happened: registered for ultimate-dashboard-black.vercel.app,
// but visited via ultimate-dashboard-dpe0dshqn-ben-furphy.vercel.app).
// Set TICKTICK_BASE_URL to your stable domain to pin this regardless of
// which URL you're browsing from; falls back to the request's own host
// (fine for local `vercel dev`) if unset.
function redirectUri(req) {
  const base = String(process.env.TICKTICK_BASE_URL || '').trim().replace(/\/+$/, '');
  return (base || getOrigin(req)) + '/api/ticktick/callback';
}
function isHttps(req) { return getOrigin(req).startsWith('https'); }

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

function creds() {
  const id = process.env.TICKTICK_CLIENT_ID, secret = process.env.TICKTICK_CLIENT_SECRET;
  if (!id || !secret) { const e = new Error('TICKTICK_NOT_CONFIGURED'); e.code = 'TICKTICK_NOT_CONFIGURED'; throw e; }
  return { id, secret };
}
// TickTick expects the client credentials as HTTP Basic auth on the token
// request (not just as body params) — see developer.ticktick.com.
async function tokenRequest(params, id, secret) {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'),
    },
    body: new URLSearchParams(params).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error('token ' + r.status + ' ' + (j.error_description || j.error || '')); e.status = r.status; throw e; }
  return j;
}
async function api(path, token, opts) {
  opts = opts || {};
  const r = await fetch(API_BASE + path, {
    method: opts.method || 'GET',
    headers: Object.assign({ Authorization: 'Bearer ' + token }, opts.body ? { 'content-type': 'application/json' } : {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!r.ok) { const e = new Error('ticktick api ' + r.status + ' ' + path); e.status = r.status; throw e; }
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

// Resolves a usable access token from whichever cookie the callback set —
// refreshes if we have a refresh token, otherwise uses the long-lived access
// token as-is. Returns { token, setCookies } (setCookies may be empty).
async function resolveToken(req) {
  const cookies = parseCookies(req);
  const secure = isHttps(req);
  if (cookies.ticktick_refresh) {
    const { id, secret } = creds();
    const tok = await tokenRequest({ grant_type: 'refresh_token', refresh_token: cookies.ticktick_refresh, scope: SCOPE }, id, secret);
    const setCookies = [];
    if (tok.refresh_token && tok.refresh_token !== cookies.ticktick_refresh) {
      setCookies.push(cookie('ticktick_refresh', tok.refresh_token, { maxAge: 60 * 60 * 24 * 365, secure }));
    }
    return { token: tok.access_token, setCookies };
  }
  if (cookies.ticktick_access) return { token: cookies.ticktick_access, setCookies: [] };
  return { token: null, setCookies: [] };
}

module.exports = { crypto, AUTH_URL, TOKEN_URL, API_BASE, SCOPE, getOrigin, redirectUri, isHttps, parseCookies, cookie, clearCookie, creds, tokenRequest, api, resolveToken };
