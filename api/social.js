// GET /api/social?platform=tiktok|youtube&handle=<handle>
//
// Combines the TikTok and YouTube profile-stat lookups into one function —
// Vercel's Hobby plan caps a deployment at 12 Serverless Functions, so two
// small, stateless GET proxies with an identical response shape got merged
// rather than each taking their own slot.
//
// tiktok: scrapes the public profile page (no API key — TikTok has no public
// stats API). Brittle by nature: if TikTok restructures their page the parse
// misses (parse_failed), and they rate-limit/block by IP (rate_limited).
//
// youtube: the official YouTube Data API v3 (channels.list). Needs
// YOUTUBE_API_KEY set on the host (one key, set once by the deployer).

const TIKTOK_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const YOUTUBE_KEY = process.env.YOUTUBE_API_KEY;
const YOUTUBE_BASE = 'https://www.googleapis.com/youtube/v3';

function cleanTiktokHandle(raw) {
  if (!raw) return '';
  let h = String(raw).trim();
  const m = h.match(/tiktok\.com\/@?([^/?#]+)/i); // accept a full profile URL
  if (m) h = m[1];
  return h.replace(/^@+/, '').trim();
}

// The rehydration JSON nests userInfo at a known path, but TikTok moves it
// around between layouts — so fall back to a recursive search for stats.followerCount.
function findTiktokUserInfo(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.userInfo && obj.userInfo.stats && obj.userInfo.stats.followerCount != null) return obj.userInfo;
  for (const k in obj) {
    const v = obj[k];
    if (v && typeof v === 'object') { const f = findTiktokUserInfo(v); if (f) return f; }
  }
  return null;
}

async function tiktok(handleRaw, res) {
  const handle = cleanTiktokHandle(handleRaw);
  if (!handle) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: 'no_handle' })); return; }

  let html;
  try {
    const r = await fetch('https://www.tiktok.com/@' + encodeURIComponent(handle), {
      headers: {
        'user-agent': TIKTOK_UA,
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
    });
    if (r.status === 429) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'rate_limited' })); return; }
    if (!r.ok) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'not_found', status: r.status })); return; }
    html = await r.text();
  } catch (e) {
    res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'fetch_failed' })); return;
  }

  let followers = null, hearts = null, videos = null, avatar = null, nickname = null;

  const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (m) {
    try {
      const data = JSON.parse(m[1]);
      const scope = data && data.__DEFAULT_SCOPE__;
      let info = scope && scope['webapp.user-detail'] && scope['webapp.user-detail'].userInfo;
      if (!info || !info.stats) info = findTiktokUserInfo(data);
      if (info && info.stats) {
        followers = info.stats.followerCount;
        hearts = info.stats.heartCount != null ? info.stats.heartCount : info.stats.heart;
        videos = info.stats.videoCount;
      }
      if (info && info.user) {
        avatar = info.user.avatarLarger || info.user.avatarMedium || info.user.avatarThumb || null;
        nickname = info.user.nickname || null;
      }
    } catch (e) { /* fall through to regex */ }
  }

  const grab = (re) => { const x = html.match(re); return x ? Number(x[1]) : null; };
  if (followers == null) followers = grab(/"followerCount":(\d+)/);
  if (hearts == null) hearts = grab(/"heartCount":(\d+)/);
  if (videos == null) videos = grab(/"videoCount":(\d+)/);
  if (!avatar) { const a = html.match(/"avatar(?:Larger|Medium|Thumb)":"([^"]+)"/); if (a) avatar = a[1].replace(/\\u002F/gi, '/').replace(/\\\//g, '/'); }

  if (followers == null) {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: false, error: 'parse_failed', message: "Couldn't read the follower count. TikTok may have changed their page." }));
    return;
  }

  res.statusCode = 200;
  res.end(JSON.stringify({
    ok: true, platform: 'tiktok', handle: '@' + handle, nickname,
    followers, lifetimeViews: hearts, videoCount: videos, avatarUrl: avatar, ts: Date.now(),
  }));
}

async function youtube(handleRaw, res) {
  if (!YOUTUBE_KEY) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'not_configured' })); return; }

  let handle = (handleRaw || '').trim();
  if (!handle) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: 'no_handle' })); return; }
  const um = handle.match(/youtube\.com\/(?:channel\/([\w-]+)|(@[\w.-]+))/i); // accept a full URL
  if (um) handle = um[1] || um[2];

  try {
    const isId = /^UC[\w-]{20,}$/.test(handle);
    const q = isId
      ? '?part=statistics,snippet&id=' + encodeURIComponent(handle)
      : '?part=statistics,snippet&forHandle=' + encodeURIComponent(handle.replace(/^@/, ''));
    let j = await (await fetch(YOUTUBE_BASE + '/channels' + q + '&key=' + YOUTUBE_KEY)).json();
    let item = j && j.items && j.items[0];

    if (!item) {
      const sj = await (await fetch(YOUTUBE_BASE + '/search?part=snippet&type=channel&maxResults=1&q=' + encodeURIComponent(handle.replace(/^@/, '')) + '&key=' + YOUTUBE_KEY)).json();
      const cid = sj && sj.items && sj.items[0] && sj.items[0].id && sj.items[0].id.channelId;
      if (cid) { const j2 = await (await fetch(YOUTUBE_BASE + '/channels?part=statistics,snippet&id=' + cid + '&key=' + YOUTUBE_KEY)).json(); item = j2 && j2.items && j2.items[0]; }
    }
    if (!item) { res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'not_found' })); return; }

    const st = item.statistics || {}, sn = item.snippet || {};
    const num = (x) => x != null ? Number(x) : null;
    res.statusCode = 200;
    res.end(JSON.stringify({
      ok: true, platform: 'youtube',
      handle: sn.customUrl ? ('@' + String(sn.customUrl).replace(/^@/, '')) : handle,
      nickname: sn.title || null,
      followers: num(st.subscriberCount),
      lifetimeViews: num(st.viewCount),
      videoCount: num(st.videoCount),
      avatarUrl: (sn.thumbnails && sn.thumbnails.default && sn.thumbnails.default.url) || null,
      ts: Date.now(),
    }));
  } catch (e) {
    res.statusCode = 200; res.end(JSON.stringify({ ok: false, error: 'fetch_failed' }));
  }
}

module.exports = async (req, res) => {
  res.setHeader('content-type', 'application/json');
  const url = new URL(req.url, 'http://x');
  const platform = url.searchParams.get('platform');
  const handle = url.searchParams.get('handle');
  if (platform === 'tiktok') return tiktok(handle, res);
  if (platform === 'youtube') return youtube(handle, res);
  res.statusCode = 400;
  res.end(JSON.stringify({ ok: false, error: 'unknown_platform' }));
};
