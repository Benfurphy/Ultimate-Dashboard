// GET /api/vald/data — pulls ForceDecks (CMJ / Drop Jump / IMTP) test history for
// the configured athlete from VALD Hub and reduces each test session down to the
// metrics the Testing & Monitoring page tracks. Same-origin, no CORS, no secrets
// reach the browser.
//
// Per test session we take the "best" trial (highest jump height for CMJ, highest
// RSI for Drop Jump, highest peak force for IMTP) rather than averaging reps —
// that's the standard reporting convention and keeps asymmetry figures internally
// consistent with the reported jump/force values.
//
// RSI and RSI-modified come back from VALD scaled by 0.01 (their internal unit is
// cm/s, displayed unit m/s) — this is documented on the resultdefinition endpoint
// and is stable, so it's hardcoded rather than fetched per-request.
const L = require('./_lib');

const RSI_SCALE = 0.01;

function resultsByName(trial) {
  const out = {};
  for (const r of trial.results) out[r.definition.result + ':' + r.limb] = r.value;
  return out;
}

async function trialsFor(id, secret, host, teamId, testId) {
  const trials = await L.valdGet(id, secret, host, '/v2019q3/teams/' + teamId + '/tests/' + testId + '/trials');
  return trials || [];
}

function bestTrial(trials, metricName) {
  let best = null, bestVal = -Infinity;
  for (const t of trials) {
    const v = resultsByName(t)[metricName + ':Trial'];
    if (v == null) continue;
    if (v > bestVal) { best = t; bestVal = v; }
  }
  return best;
}

async function summarizeCmj(id, secret, host, teamId, test) {
  const trial = bestTrial(await trialsFor(id, secret, host, teamId, test.testId), 'JUMP_HEIGHT');
  if (!trial) return null;
  const m = resultsByName(trial);
  return {
    testId: test.testId,
    date: test.recordedDateUtc,
    jumpHeightCm: m['JUMP_HEIGHT:Trial'] ?? null,
    rsiModified: m['RSI_MODIFIED:Trial'] != null ? m['RSI_MODIFIED:Trial'] * RSI_SCALE : null,
    concentricImpulseAsymPct: m['CONCENTRIC_IMPULSE:Asym'] ?? null,
  };
}

async function summarizeDj(id, secret, host, teamId, test) {
  const trial = bestTrial(await trialsFor(id, secret, host, teamId, test.testId), 'RSI');
  if (!trial) return null;
  const m = resultsByName(trial);
  return {
    testId: test.testId,
    date: test.recordedDateUtc,
    rsi: m['RSI:Trial'] != null ? m['RSI:Trial'] * RSI_SCALE : null,
    contactTimeS: m['CONTACT_TIME:Trial'] ?? null,
  };
}

async function summarizeImtp(id, secret, host, teamId, test) {
  const trial = bestTrial(await trialsFor(id, secret, host, teamId, test.testId), 'PEAK_VERTICAL_FORCE');
  if (!trial) return null;
  const m = resultsByName(trial);
  return {
    testId: test.testId,
    date: test.recordedDateUtc,
    peakVerticalForceN: m['PEAK_VERTICAL_FORCE:Trial'] ?? null,
    peakForceAsymPct: m['PEAK_VERTICAL_FORCE:Asym'] ?? null,
  };
}

module.exports = async (req, res) => {
  res.setHeader('content-type', 'application/json');

  let c;
  try { c = L.creds(); }
  catch (e) { res.statusCode = 200; res.end(JSON.stringify({ configured: false })); return; }

  const { id, secret, tenantId, profileId, hosts } = c;
  try {
    const testsResp = await L.valdGet(id, secret, hosts.forcedecks,
      '/tests?tenantId=' + tenantId + '&modifiedFromUtc=2000-01-01T00:00:00.000Z&profileId=' + profileId);
    const tests = (testsResp && testsResp.tests) || [];

    const cmjTests = tests.filter(t => t.testType === 'CMJ');
    const djTests = tests.filter(t => t.testType === 'DJ');
    const imtpTests = tests.filter(t => t.testType === 'IMTP');

    const [cmj, dj, imtp] = await Promise.all([
      Promise.all(cmjTests.map(t => summarizeCmj(id, secret, hosts.forcedecks, tenantId, t))),
      Promise.all(djTests.map(t => summarizeDj(id, secret, hosts.forcedecks, tenantId, t))),
      Promise.all(imtpTests.map(t => summarizeImtp(id, secret, hosts.forcedecks, tenantId, t))),
    ]);

    const byDate = (a, b) => new Date(a.date) - new Date(b.date);
    res.statusCode = 200;
    res.setHeader('cache-control', 'private, max-age=300');
    res.end(JSON.stringify({
      configured: true,
      updatedAt: new Date().toISOString(),
      cmj: cmj.filter(Boolean).sort(byDate),
      dj: dj.filter(Boolean).sort(byDate),
      imtp: imtp.filter(Boolean).sort(byDate),
    }));
  } catch (e) {
    res.statusCode = 502;
    res.end(JSON.stringify({ configured: true, error: String((e && e.message) || e) }));
  }
};
