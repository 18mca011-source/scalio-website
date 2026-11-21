// Vercel serverless function: printed bills (invoices), numbered MJ-0001, MJ-0002, …
// GET  /api/invoices                          -> { seq, invoices }
// POST /api/invoices { action: 'add', invoice } -> { seq, invoices, saved }
//   invoice: { type: 'gold'|'silver'|'exchange'|'sexchange', client, address, product,
//              sections: [{ title, rows: [[label, value]], total: [label, value] }], amount, amountLabel }
// The site password (middleware.js) also guards this route.
const { makeStore, readBody } = require('./_store');

const TYPES = ['gold', 'silver', 'exchange', 'sexchange'];
const txt = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const s = makeStore('mj:invoices:v1', 'INVOICE_FILE');
  if (!s) return res.status(503).json({ error: 'storage-not-connected' });
  try {
    const doc = (await s.load()) || { seq: 0, invoices: [] };
    if (req.method === 'POST') {
      const a = await readBody(req);
      if (a.action !== 'add' || !a.invoice) return res.status(400).json({ error: 'Unknown action' });
      const i = a.invoice;
      const client = txt(i.client, 80);
      if (!client) return res.status(400).json({ error: 'Client name is required' });
      const sections = (Array.isArray(i.sections) ? i.sections : []).slice(0, 4).map((sec) => ({
        title: txt(sec.title, 60),
        rows: (Array.isArray(sec.rows) ? sec.rows : []).slice(0, 20).map((r) => [txt(r[0], 120), txt(r[1], 40)]),
        total: Array.isArray(sec.total) ? [txt(sec.total[0], 60), txt(sec.total[1], 40)] : null,
      }));
      doc.seq += 1;
      const saved = {
        no: 'MJ-' + String(doc.seq).padStart(4, '0'),
        at: new Date().toISOString(),
        type: TYPES.includes(i.type) ? i.type : 'gold',
        client, address: txt(i.address, 200), product: txt(i.product, 100),
        sections, amount: Math.round(Number(i.amount) || 0), amountLabel: txt(i.amountLabel, 40),
      };
      doc.invoices.push(saved);
      await s.save(doc);
      return res.status(200).json(Object.assign({}, doc, { saved }));
    }
    res.status(200).json(doc);
  } catch (e) {
    res.status(500).json({ error: 'Could not save, try again' });
  }
};
