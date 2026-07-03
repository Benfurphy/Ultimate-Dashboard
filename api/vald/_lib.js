// Shared helpers for the VALD ForceDecks integration (Vercel, Node runtime).
// VALD's external API uses server-to-server OAuth2 client-credentials (no user
// login/redirect) — the client secret lives only here, read from env vars.
const TOKEN_URL = 'https://auth.prd.vald.com/oauth/token';
const AUDIENCE = 'vald-api-external';

// Region -> API hostnames. VALD splits each product onto its own subdomain,
// and a tenant's data only lives behind its own region's hosts.
const REGION_HOSTS = {
  aue: { tenants: 'prd-aue-api-externaltenants', forcedecks: 'prd-aue-api-extforcedecks' },
  use: { tenants: 'prd-use-api-externaltenants', forcedecks: 'prd-use-api-extforcedecks' },
  euw: { tenants: 'prd-euw-api-externaltenants', forcedecks: 'prd-euw-api-extforcedecks' },
};

let tokenCache = { token: null, expiresAt: 0 };

function creds() {
  const id = process.env.VALD_CLIENT_ID;
  const secret = process.env.VALD_CLIENT_SECRET;
  const tenantId = process.env.VALD_TENANT_ID;
  const profileId = process.env.VALD_PROFILE_ID;
  const region = process.env.VALD_REGION || 'aue';
  if (!id || !secret || !tenantId || !profileId) {
    const e = new Error('VALD_NOT_CONFIGURED');
    e.code = 'VALD_NOT_CONFIGURED';
    throw e;
  }
  if (!REGION_HOSTS[region]) {
    const e = new Error('VALD_BAD_REGION: ' + region);
    throw e;
  }
  return { id, secret, tenantId, profileId, region, hosts: REGION_HOSTS[region] };
}

async function getToken(id, secret) {
  if (tokenCache.token && tokenCache.expiresAt > Date.now() + 60000) return tokenCache.token;
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: id,
      client_secret: secret,
      audience: AUDIENCE,
    }).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error('vald token ' + r.status + ' ' + (j.error_description || j.error || '')); e.status = r.status; throw e; }
  tokenCache = { token: j.access_token, expiresAt: Date.now() + (j.expires_in || 3600) * 1000 };
  return tokenCache.token;
}

async function valdGet(id, secret, host, path) {
  const token = await getToken(id, secret);
  const r = await fetch('https://' + host + '.valdperformance.com' + path, {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => null);
  if (!r.ok) { const e = new Error('vald api ' + r.status + ' ' + path); e.status = r.status; throw e; }
  return j;
}

module.exports = { creds, valdGet, REGION_HOSTS };
