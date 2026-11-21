// Vercel serverless function: stock boxes (dabba) out / in weights and sales entries.
// Storage: Upstash Redis connected in Vercel (env KV_REST_API_URL + KV_REST_API_TOKEN,
// or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN). For local testing only, STOCK_FILE
// points to a JSON file instead. The site password (middleware.js) also guards this route.
//
// GET  /api/stock                     -> { boxes, trips }
// POST /api/stock { action, ... }     -> { boxes, trips }
//   addBox      { name, metal }                  metal: 'gold' | 'silver'
//   renameBox   { id, name }
//   deleteBox   { id }                           only when the box is in the store room
//   takeOut     { boxId, weight }                box leaves the store room (weighed)
//   addSale     { tripId, weight, note }         sold item written in the diary
//   removeSale  { tripId, saleId }
//   returnIn    { tripId, weight }               box comes back (weighed) -> difference
//   cancelTrip  { tripId }                       undo a take-out entered by mistake

const KEY = 'mj:stock:v1';
const fs = require('fs');

const R = (n) => Math.round(Number(n) * 1000) / 1000; // grams, 3 decimals
const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Finds the Upstash REST address/token whatever prefix Vercel gave them (KV_*, UPSTASH_*, STORAGE_KV_*, …),
// or works them out from an Upstash REDIS_URL / KV_URL (rediss://default:TOKEN@host.upstash.io:6379).
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

function store() {
  const up = upstash();
  if (up) {
    const { url, token } = up;
    const call = async (cmd) => {
      const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
      if (!r.ok) throw new Error('storage ' + r.status);
      return (await r.json()).result;
    };
    return {
      load: async () => { const v = await call(['GET', KEY]); return v ? JSON.parse(v) : null; },
      save: async (doc) => { await call(['SET', KEY, JSON.stringify(doc)]); },
    };
  }
  if (process.env.STOCK_FILE) {
    const f = process.env.STOCK_FILE;
    return {
      load: async () => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null),
      save: async (doc) => fs.writeFileSync(f, JSON.stringify(doc, null, 1)),
    };
  }
  return null;
}

// Names only (never values) of storage-looking settings, to see what Vercel connected
const storageNames = () => Object.keys(process.env).filter((n) => /KV|REDIS|UPSTASH/i.test(n)).sort();

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

function apply(doc, a) {
  const now = new Date().toISOString();
  const box = (bid) => doc.boxes.find((b) => b.id === bid);
  const trip = (tid) => doc.trips.find((t) => t.id === tid);
  const openTrip = (bid) => doc.trips.find((t) => t.boxId === bid && !t.inAt);
  const need = (cond, msg) => { if (!cond) { const e = new Error(msg); e.user = true; throw e; } };

  switch (a.action) {
    case 'addBox': {
      const name = String(a.name || '').trim().slice(0, 60);
      need(name, 'Box name is required');
      need(!doc.boxes.some((b) => b.name.toLowerCase() === name.toLowerCase()), 'A box with this name already exists');
      doc.boxes.push({ id: id(), name, metal: a.metal === 'silver' ? 'silver' : 'gold', createdAt: now });
      break;
    }
    case 'renameBox': {
      const b = box(a.id); need(b, 'Box not found');
      const name = String(a.name || '').trim().slice(0, 60); need(name, 'Box name is required');
      b.name = name; break;
    }
    case 'deleteBox': {
      need(box(a.id), 'Box not found'); need(!openTrip(a.id), 'Return the box before deleting it');
      doc.boxes = doc.boxes.filter((b) => b.id !== a.id); break; // past trips stay in the report
    }
    case 'takeOut': {
      const b = box(a.boxId); need(b, 'Box not found'); need(!openTrip(b.id), 'This box is already out');
      const w = R(a.weight); need(w > 0, 'Enter the box weight');
      doc.trips.push({ id: id(), boxId: b.id, boxName: b.name, metal: b.metal, outWeight: w, outAt: now, sales: [] });
      break;
    }
    case 'addSale': {
      const t = trip(a.tripId); need(t && !t.inAt, 'This box is not out');
      const w = R(a.weight); need(w > 0, 'Enter the sold weight');
      t.sales.push({ id: id(), weight: w, note: String(a.note || '').trim().slice(0, 80), at: now }); break;
    }
    case 'removeSale': {
      const t = trip(a.tripId); need(t && !t.inAt, 'This box is not out');
      t.sales = t.sales.filter((s) => s.id !== a.saleId); break;
    }
    case 'returnIn': {
      const t = trip(a.tripId); need(t && !t.inAt, 'This box is not out');
      const w = R(a.weight); need(w >= 0 && a.weight !== '' && a.weight != null, 'Enter the return weight');
      const sold = R(t.sales.reduce((s, x) => s + x.weight, 0));
      t.sold = sold; t.expected = R(t.outWeight - sold); t.inWeight = w; t.diff = R(w - t.expected); t.inAt = now;
      break;
    }
    case 'cancelTrip': {
      const t = trip(a.tripId); need(t && !t.inAt, 'This box is not out');
      doc.trips = doc.trips.filter((x) => x.id !== t.id); break;
    }
    default: need(false, 'Unknown action');
  }
  return doc;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const s = store();
  if (!s) return res.status(503).json({ error: 'storage-not-connected', found: storageNames() });
  try {
    let doc = (await s.load()) || { boxes: [], trips: [] };
    if (req.method === 'POST') {
      doc = apply(doc, await readBody(req));
      await s.save(doc);
    }
    res.status(200).json(doc);
  } catch (e) {
    res.status(e.user ? 400 : 500).json({ error: e.user ? e.message : 'Could not save, try again' });
  }
};
