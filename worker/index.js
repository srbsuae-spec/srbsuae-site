// Anonymous survey API: POST /vote, GET /results. Stores only answers, time
// and a keyed hash of the IP (never the IP itself).

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const YN = ['yes', 'no'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (!cors) return json({ error: 'forbidden' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === '/vote' && request.method === 'POST') return withCors(await vote(request, env), cors);
      if (url.pathname === '/results' && request.method === 'GET') return withCors(await results(env), cors);
      if (url.pathname === '/subscribe' && request.method === 'POST') return withCors(await subscribe(request, env), cors);
      if (url.pathname === '/status' && request.method === 'GET') return withCors(await status(request, env), cors);
    } catch (error) {
      console.error(error);
      return withCors(json({ error: 'server' }, 500), cors);
    }
    return withCors(json({ error: 'not_found' }, 404), cors);
  }
};

async function vote(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';

  // 1. Cheap checks first: size and type.
  if (!(request.headers.get('content-type') || '').includes('application/json')) return json({ error: 'bad_request' }, 415);
  const raw = await request.text();
  if (raw.length > 1024) return json({ error: 'bad_request' }, 413);

  // 2. Per-IP rate limit.
  const { success } = await env.RATE_LIMIT.limit({ key: ip });
  if (!success) return json({ error: 'rate_limited' }, 429);

  // 3. Strict validation of fields.
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'bad_request' }, 400); }
  const { applied, confirmed = null, token } = body ?? {};
  if (!YN.includes(applied)) return json({ error: 'bad_request' }, 400);
  if (applied === 'yes' && !YN.includes(confirmed)) return json({ error: 'bad_request' }, 400);
  if (applied === 'no' && confirmed !== null) return json({ error: 'bad_request' }, 400);
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return json({ error: 'captcha' }, 400);

  // 4. Cooldown: one response per network every COOLDOWN_SECONDS.
  const voter = await hmac(env.VOTER_SALT, ip);
  const cooldownMs = (Number(env.COOLDOWN_SECONDS) || 300) * 1000;
  const last = await env.DB.prepare('SELECT MAX(ts) AS ts FROM votes WHERE voter = ?').bind(voter).first();
  if (last.ts && Date.now() - last.ts < cooldownMs) return json({ error: 'too_soon' }, 429);

  // 5. Turnstile verification (external call, so after the cheap checks).
  const check = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip })
  });
  const verdict = await check.json().catch(() => ({}));
  if (!verdict.success) return json({ error: 'captcha' }, 400);

  // 6. Global hourly cap, protects against distributed floods.
  const hourlyCap = Number(env.HOURLY_CAP) || 200;
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM votes WHERE ts > ?')
    .bind(Date.now() - 3600_000).first();
  if (recent.n >= hourlyCap) return json({ error: 'busy' }, 503);

  // 7. Total limit per keyed hash of the IP.
  const maxPerVoter = Number(env.MAX_PER_VOTER) || 3;
  const mine = await env.DB.prepare('SELECT COUNT(*) AS n FROM votes WHERE voter = ?').bind(voter).first();
  if (mine.n >= maxPerVoter) return json({ error: 'already_voted' }, 409);

  await env.DB.prepare('INSERT INTO votes (ts, applied, confirmed, voter) VALUES (?, ?, ?, ?)')
    .bind(Date.now(), applied, confirmed, voter).run();
  return json({ ok: true }, 201);
}

// Newsletter signup. Email goes straight to MailerLite (double opt-in is on
// in the account) and is never stored here or linked to survey answers.
const EMAIL_RE = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,255}\.[^\s@<>"',;]{2,}$/;

async function subscribe(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!(request.headers.get('content-type') || '').includes('application/json')) return json({ error: 'bad_request' }, 415);
  const raw = await request.text();
  if (raw.length > 1024) return json({ error: 'bad_request' }, 413);

  const { success } = await env.RATE_LIMIT.limit({ key: `subscribe:${ip}` });
  if (!success) return json({ error: 'rate_limited' }, 429);

  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'bad_request' }, 400); }
  const { email, lang, token } = body ?? {};
  const group = { sr: env.ML_GROUP_SR, en: env.ML_GROUP_EN }[lang];
  if (typeof email !== 'string' || email.length > 254 || !EMAIL_RE.test(email) || !group) return json({ error: 'bad_email' }, 400);
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return json({ error: 'captcha' }, 400);

  const check = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip })
  });
  const verdict = await check.json().catch(() => ({}));
  if (!verdict.success) return json({ error: 'captcha' }, 400);

  const response = await fetch('https://connect.mailerlite.com/api/subscribers', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${env.MAILERLITE_API_KEY}`,
      'content-type': 'application/json',
      'accept': 'application/json'
    },
    body: JSON.stringify({ email: email.trim(), groups: [group] })
  });
  if (response.status === 200 || response.status === 201) return json({ ok: true }, 200);
  if (response.status === 422) return json({ error: 'bad_email' }, 400);
  console.error('mailerlite', response.status);
  return json({ error: 'server' }, 502);
}

// Tells a visitor whether their own network has already used all its responses.
async function status(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const { success } = await env.RATE_LIMIT.limit({ key: `status:${ip}` });
  if (!success) return json({ voted: false }, 200, { 'cache-control': 'no-store' });
  const voter = await hmac(env.VOTER_SALT, ip);
  const mine = await env.DB.prepare('SELECT COUNT(*) AS n FROM votes WHERE voter = ?').bind(voter).first();
  const maxPerVoter = Number(env.MAX_PER_VOTER) || 3;
  return json({ voted: mine.n >= maxPerVoter }, 200, { 'cache-control': 'no-store' });
}

async function results(env) {
  const minPublic = Number(env.MIN_PUBLIC) || 30;
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(applied = 'yes'), 0) AS applied,
           COALESCE(SUM(applied = 'yes' AND confirmed = 'yes'), 0) AS confirmed
    FROM votes WHERE hidden = 0`).first();
  const body = row.total < minPublic
    ? { visible: false }
    : { visible: true, total: row.total, applied: row.applied, confirmed: row.confirmed };
  return json(body, 200, { 'cache-control': 'public, max-age=60' });
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Returns CORS headers, or null when a browser Origin is present but not allowed.
function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (origin && !allowed.includes(origin)) return null;
  return {
    'access-control-allow-origin': origin || allowed[0] || '',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'vary': 'origin'
  };
}

function withCors(response, cors) {
  Object.entries(cors).forEach(([k, v]) => response.headers.set(k, v));
  return response;
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });
}
