// GET /api/garmin/data — restores the stored Garmin session (no re-login), pulls
// last night's sleep (HRV, resting HR, sleep score/hours, bed/wake times) plus
// today's Body Battery, and returns a vitals payload shaped like the WHOOP/Fitbit
// ones so the shared hub UI doesn't need to know which source it's talking to.
const L = require('./_lib');

function toDateStr(d) { return d.toISOString().slice(0, 10); }
// Garmin's "*Local" epoch fields encode local wall-clock time as if it were UTC.
function toHHMM(msLocal) {
  if (msLocal == null) return null;
  const d = new Date(msLocal);
  return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
}

// Body Battery has no named helper in the client library — hit the same
// undocumented endpoint the Garmin Connect web app itself uses, and parse
// defensively since the response shape isn't officially specified anywhere.
async function currentBodyBattery(client, dateStr) {
  try {
    const rows = await client.get('/wellness-service/wellness/bodyBattery/reports/daily?startDate=' + dateStr + '&endDate=' + dateStr);
    const today = Array.isArray(rows) ? rows[rows.length - 1] : rows;
    const series = today && today.bodyBatteryValuesArray;
    if (!Array.isArray(series) || !series.length) return null;
    const last = series[series.length - 1];
    const val = Array.isArray(last) ? last[last.length - 1] : (last && last.value);
    return typeof val === 'number' ? Math.round(val) : null;
  } catch (e) { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('content-type', 'application/json');
  const client = L.clientFromCookies(req);
  if (!client) { res.statusCode = 200; res.end(JSON.stringify({ connected: false })); return; }

  const dateStr = toDateStr(new Date());
  let sleep;
  try {
    sleep = await client.getSleepData();
  } catch (e) {
    // Stored session no longer valid — drop it so the UI re-prompts to connect.
    res.statusCode = 200;
    res.setHeader('Set-Cookie', L.clearTokensCookie(L.isHttps(req)));
    res.end(JSON.stringify({ connected: false, error: 'expired' }));
    return;
  }

  const dto = sleep && sleep.dailySleepDTO;
  const recovery = await currentBodyBattery(client, dateStr);
  const hrv = sleep && sleep.avgOvernightHrv != null ? Math.round(sleep.avgOvernightHrv) : null;
  const rhr = sleep && sleep.restingHeartRate != null ? Math.round(sleep.restingHeartRate) : null;
  const sleepHours = dto && dto.sleepTimeSeconds != null ? Math.round((dto.sleepTimeSeconds / 3600) * 10) / 10 : null;
  const sleepPerf = dto && dto.sleepScores && dto.sleepScores.overall ? Math.round(dto.sleepScores.overall.value) : null;
  const bedtime = toHHMM(dto && dto.sleepStartTimestampLocal);
  const wakeTime = toHHMM(dto && dto.sleepEndTimestampLocal);

  res.statusCode = 200;
  res.end(JSON.stringify({
    connected: true, source: 'garmin', ts: Date.now(),
    recovery, hrv, rhr, sleepPerf, sleepHours, sleepTargetHours: 8, bedtime, wakeTime,
  }));
};
