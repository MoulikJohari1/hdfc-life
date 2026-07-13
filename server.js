const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'leads.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS term_plan_leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT,
    gender TEXT,
    tobacco TEXT,
    dob TEXT,
    mobile TEXT,
    email TEXT NOT NULL,
    consent INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// ---------------------------------------------------------------------------
// TrustArc CPM reverse proxy (dev only).
// The browser cannot POST directly to cpm-form.trustarc.com from localhost
// because that origin is not in TrustArc's CORS allow-list. We forward the
// request server-side (no browser CORS applies) and relay the response back.
// Mounted BEFORE express.json() so the raw request body is preserved.
// ---------------------------------------------------------------------------
const TRUSTARC_HOST = 'https://cpm-form.trustarc.com';

app.use('/trustarc-proxy', express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  const targetUrl = TRUSTARC_HOST + req.originalUrl.replace(/^\/trustarc-proxy/, '');

  try {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const key = k.toLowerCase();
      if (['host', 'content-length', 'connection', 'origin', 'referer'].includes(key)) continue;
      headers[k] = v;
    }

    const hasBody = !['GET', 'HEAD'].includes(req.method);
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: hasBody && req.body && req.body.length ? req.body : undefined,
    });

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    upstream.headers.forEach((value, name) => {
      const n = name.toLowerCase();
      if (['content-encoding', 'transfer-encoding', 'content-length', 'connection'].includes(n)) return;
      res.setHeader(name, value);
    });
    res.send(buf);
  } catch (err) {
    console.error('[TrustArc proxy] failed:', err);
    res.status(502).json({ error: 'proxy_failed', message: err.message });
  }
});

app.use(express.json());
app.use(express.static(__dirname));

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

app.post('/api/term-plan-leads', (req, res) => {
  const { fullName, gender, tobacco, dob, mobile, email, consent } = req.body;

  if (!email || !String(email).trim()) {
    return res.status(400).json({ success: false, message: 'Email is required.' });
  }

  if (!isValidEmail(String(email).trim())) {
    return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
  }

  try {
    const insert = db.prepare(`
      INSERT INTO term_plan_leads (full_name, gender, tobacco, dob, mobile, email, consent)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insert.run(
      fullName ? String(fullName).trim() : '',
      gender || '',
      tobacco || '',
      dob || '',
      mobile ? String(mobile).trim() : '',
      String(email).trim(),
      consent ? 1 : 0
    );

    res.status(201).json({
      success: true,
      message: 'Thank you! We will connect with you soon.',
      id: result.lastInsertRowid,
    });
  } catch (err) {
    console.error('Failed to save lead:', err);
    res.status(500).json({ success: false, message: 'Failed to save your details. Please try again.' });
  }
});

app.get('/api/term-plan-leads', (req, res) => {
  try {
    const leads = db.prepare(`
      SELECT id, full_name, gender, tobacco, dob, mobile, email, consent, created_at
      FROM term_plan_leads
      ORDER BY created_at DESC
    `).all();

    res.json({ success: true, leads });
  } catch (err) {
    console.error('Failed to fetch leads:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch leads.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`View form submissions at http://localhost:${PORT}/admin.html`);
});
