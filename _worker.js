// 檢討點題：後端。Cloudflare Pages 的單檔模式（advanced mode）。
// /api/* 由這個檔案處理，其他網址交給網頁檔案。
// 資料存在 Cloudflare D1（綁定名稱 DB），老師密碼放在環境變數 TEACHER_PASSWORD。

const MAX_VOTES = 300;      // 一場最多收幾份回覆，避免資料庫被灌爆
const MAX_GROUPS = 6;       // 最多幾種題型
const MAX_LABELS = 100;     // 每種題型最多幾題
const MAX_TOTAL = 300;      // 一份考卷最多幾題

let ready = null;

function init(db) {
  if (!ready) {
    ready = db.batch([
      db.prepare('CREATE TABLE IF NOT EXISTS session (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, open INTEGER NOT NULL, groups TEXT NOT NULL)'),
      db.prepare('CREATE TABLE IF NOT EXISTS votes (client TEXT PRIMARY KEY, version INTEGER NOT NULL, payload TEXT NOT NULL)'),
      db.prepare("INSERT OR IGNORE INTO session (id, version, open, groups) VALUES (1, 0, 0, '[]')")
    ]).catch((e) => { ready = null; throw e; });
  }
  return ready;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

function safeEqual(a, b) {
  const A = new TextEncoder().encode(a);
  const B = new TextEncoder().encode(b);
  let diff = A.length ^ B.length;
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) diff |= (A[i] || 0) ^ (B[i] || 0);
  return diff === 0;
}

// 回傳 null 代表通過；否則回傳要送出的錯誤回應
function checkTeacher(request, env) {
  const expected = env.TEACHER_PASSWORD;
  if (!expected) return json({ error: 'no_password' }, 500);
  let given = '';
  try { given = decodeURIComponent(request.headers.get('x-teacher-password') || ''); } catch (e) { given = ''; }
  return safeEqual(given, String(expected)) ? null : json({ error: 'bad_password' }, 401);
}

async function getSession(db) {
  const row = await db.prepare('SELECT version, open, groups FROM session WHERE id = 1').first();
  let groups = [];
  try { groups = JSON.parse(row.groups); } catch (e) { groups = []; }
  return { version: row.version, open: row.open === 1, groups };
}

function validIds(groups) {
  const ids = new Set();
  groups.forEach((g, gi) => g.labels.forEach((_, k) => ids.add(gi + '-' + k)));
  return ids;
}

function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function cleanGroups(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_GROUPS) return null;
  const out = [];
  let total = 0;
  for (const g of input) {
    if (!g || !Array.isArray(g.labels)) return null;
    const name = cleanText(g.name, 12);
    if (!name) return null;
    const seen = new Set();
    const labels = [];
    for (const l of g.labels) {
      const t = cleanText(String(l), 6);
      if (t && !seen.has(t)) { seen.add(t); labels.push(t); }
    }
    if (labels.length < 1 || labels.length > MAX_LABELS) return null;
    total += labels.length;
    out.push({ name, labels });
  }
  return total <= MAX_TOTAL ? out : null;
}

async function readJson(request) {
  try { return await request.json(); } catch (e) { return null; }
}

async function handleState(env) {
  const s = await getSession(env.DB);
  return json({ open: s.open, version: s.version, groups: s.open ? s.groups : [] });
}

async function handleVote(request, env) {
  const b = await readJson(request);
  if (!b) return json({ error: 'bad_json' }, 400);
  const s = await getSession(env.DB);
  if (!s.open || b.version !== s.version) return json({ error: 'stale' }, 409);

  const client = typeof b.client === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(b.client) ? b.client : null;
  if (!client) return json({ error: 'bad_client' }, 400);

  let payload;
  if (b.all === true) {
    payload = { all: 1 };
  } else {
    const valid = validIds(s.groups);
    const picks = Array.isArray(b.picks) ? [...new Set(b.picks.filter((id) => typeof id === 'string' && valid.has(id)))] : [];
    if (!picks.length) return json({ error: 'empty' }, 400);
    payload = { picks };
  }

  const existing = await env.DB.prepare('SELECT 1 AS x FROM votes WHERE client = ?').bind(client).first();
  if (!existing) {
    const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM votes').first();
    if (c && c.n >= MAX_VOTES) return json({ error: 'full' }, 429);
  }
  await env.DB.prepare(
    'INSERT INTO votes (client, version, payload) VALUES (?, ?, ?) ON CONFLICT(client) DO UPDATE SET version = excluded.version, payload = excluded.payload'
  ).bind(client, s.version, JSON.stringify(payload)).run();
  return json({ ok: true });
}

async function handleResults(env) {
  const s = await getSession(env.DB);
  const { results } = await env.DB.prepare('SELECT payload FROM votes WHERE version = ?').bind(s.version).all();
  let N = 0;
  let good = 0;
  const counts = {};
  for (const row of results || []) {
    let p;
    try { p = JSON.parse(row.payload); } catch (e) { continue; }
    N++;
    if (p.all) { good++; continue; }
    for (const id of p.picks || []) counts[id] = (counts[id] || 0) + 1;
  }
  return json({ open: s.open, version: s.version, groups: s.groups, N, good, counts });
}

async function handleSetup(request, env) {
  const b = await readJson(request);
  const groups = b ? cleanGroups(b.groups) : null;
  if (!groups) return json({ error: 'bad_groups' }, 400);
  await env.DB.batch([
    env.DB.prepare('UPDATE session SET version = version + 1, open = 1, groups = ? WHERE id = 1').bind(JSON.stringify(groups)),
    env.DB.prepare('DELETE FROM votes')
  ]);
  return json({ ok: true });
}

async function handleEnd(env) {
  await env.DB.batch([
    env.DB.prepare("UPDATE session SET version = version + 1, open = 0, groups = '[]' WHERE id = 1"),
    env.DB.prepare('DELETE FROM votes')
  ]);
  return json({ ok: true });
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  const method = request.method;

  if (!env.DB) return json({ error: 'no_database' }, 500);

  try {
    await init(env.DB);

    if (route === 'state' && method === 'GET') return await handleState(env);
    if (route === 'vote' && method === 'POST') return await handleVote(request, env);

    const teacherRoutes = { login: 'POST', results: 'GET', setup: 'POST', end: 'POST' };
    if (teacherRoutes[route] === method) {
      const denied = checkTeacher(request, env);
      if (denied) return denied;
      if (route === 'login') return json({ ok: true });
      if (route === 'results') return await handleResults(env);
      if (route === 'setup') return await handleSetup(request, env);
      return await handleEnd(env);
    }
    return json({ error: 'not_found' }, 404);
  } catch (e) {
    console.error('api error', route, e && e.message);
    return json({ error: 'server' }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return handleApi(request, env);
    // 老師頁網址不帶斜線；有人多打了斜線就轉過去
    if (url.pathname === '/teacher/') { url.pathname = '/teacher'; return Response.redirect(url.toString(), 308); }
    return env.ASSETS.fetch(request);
  }
};
