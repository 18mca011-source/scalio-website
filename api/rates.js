// Vercel serverless function: India gold & silver rates from IBJA (ibjarates.com),
// the India Bullion and Jewellers Association's published benchmark rates.
// IBJA publishes twice on working days (AM around 12 noon, PM around 5 pm).
// GET /api/rates -> { source, gold: { date, session, per10g }, silver: { date, session, perKg } }

const clean = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const toNum = (s) => Number(String(s).replace(/[^0-9.]/g, ''));
const dateKey = (d) => { const [dd, mm, yy] = d.split('/'); return Number(yy + mm.padStart(2, '0') + dd.padStart(2, '0')); };

function todayIST() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
  return p; // dd/mm/yyyy
}

// Rows of the "Previous Dates Rate" AM / PM tabs: <td data-label="AM"><strong>dd/mm/yyyy</strong></td> ... data-label="Gold 999" ... data-label="Silver 999"
function previousRows(html) {
  const out = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(html))) {
    const row = m[1];
    const sess = row.match(/data-label="(AM|PM)"[^>]*>\s*<strong>\s*(\d{2}\/\d{2}\/\d{4})/);
    const g = row.match(/data-label="Gold 999"[^>]*>([^<]*)</);
    const s = row.match(/data-label="Silver 999"[^>]*>([^<]*)</);
    if (sess && g && s && toNum(g[1]) > 0 && toNum(s[1]) > 0) {
      out.push({ date: sess[2], session: sess[1], gold: toNum(g[1]), silver: toNum(s[1]) });
    }
  }
  return out;
}

// Today's table (shown on working days): rows "Purity | AM | PM". Read 999 gold and silver.
function todayRows(html) {
  const start = html.indexOf('id="TodayRatesTable');
  if (start < 0) return [];
  const end = html.indexOf('</table>', start);
  const table = html.slice(start, end);
  let gold = null, silver = null;
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(table))) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => clean(c[1]));
    if (cells.length < 2) continue;
    const label = cells[0].toLowerCase();
    const nums = cells.slice(1).map(toNum);
    if (/silver/.test(label) && /999/.test(label)) silver = nums;
    else if (/^(gold\s*)?999\b/.test(label)) gold = nums;
  }
  if (!gold || !silver) return [];
  const d = todayIST();
  const out = [];
  if (gold[0] > 0 && silver[0] > 0) out.push({ date: d, session: 'AM', gold: gold[0], silver: silver[0] });
  if (gold[1] > 0 && silver[1] > 0) out.push({ date: d, session: 'PM', gold: gold[1], silver: silver[1] });
  return out;
}

module.exports = async function handler(req, res) {
  try {
    const r = await fetch('https://ibjarates.com/', { headers: { 'User-Agent': 'Mozilla/5.0 (rate widget)' } });
    if (!r.ok) throw new Error('IBJA ' + r.status);
    const html = await r.text();
    const rows = [...todayRows(html), ...previousRows(html)];
    if (!rows.length) throw new Error('parse');
    rows.sort((a, b) => (dateKey(b.date) - dateKey(a.date)) || ((b.session === 'PM') - (a.session === 'PM')));
    const top = rows[0];
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json({
      source: 'IBJA',
      gold: { date: top.date, session: top.session, per10g: top.gold },
      silver: { date: top.date, session: top.session, perKg: top.silver },
    });
  } catch (e) {
    res.status(502).json({ error: 'rates unavailable' });
  }
};
