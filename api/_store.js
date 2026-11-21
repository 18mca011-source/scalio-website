// Shared storage helper for the api/ functions (files starting with "_" are not routes on Vercel).
// Uses the Upstash Redis connected in Vercel; for local testing a JSON file path in the given env var.
const fs = require('fs');

function upstash() {
  const env = process.env, keys = Object.keys(env);
  const pick = (re) => { const k = keys.find((n) => re.test(n) && env[n]); return k ? env[k] : ''; };
  let url = pick(/(^|_)KV_REST_API_URL$/) || pick(/UPSTASH_REDIS_REST_URL$/);
  let token = pick(/(^|_)KV_REST_API_TOKEN$/) || pick(/UPSTASH_REDIS_REST_TOKEN$/);
  if (!url || !token) {
    const raw = pick(/(^|_)REDIS_URL$/) || pick(/(^|_)KV_URL$/);
    try {
      const u = new URL(raw);
      if (u.hostname.endsWith('upstash.io') && u.password) { url = 'https://' + u.hostname; token = decodeURIComponent(u.password); }
    } catch (e) {}
  }
  return url && token ? { url, token } : null;
}

// makeStore('mj:invoices:v1', 'INVOICE_FILE') -> { load, save } or null when nothing is connected
function makeStore(key, fileEnv) {
  const up = upstash();
  if (up) {
    const call = async (cmd) => {
      const r = await fetch(up.url, { method: 'POST', headers: { Authorization: 'Bearer ' + up.token, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
      if (!r.ok) throw new Error('storage ' + r.status);
      return (await r.json()).result;
    };
    return {
      load: async () => { const v = await call(['GET', key]); return v ? JSON.parse(v) : null; },
      save: async (doc) => { await call(['SET', key, JSON.stringify(doc)]); },
    };
  }
  const f = process.env[fileEnv];
  if (f) {
    return {
      load: async () => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null),
      save: async (doc) => fs.writeFileSync(f, JSON.stringify(doc, null, 1)),
    };
  }
  return null;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

module.exports = { makeStore, readBody };
