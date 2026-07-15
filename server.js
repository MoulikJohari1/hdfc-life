require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const {
  sendConsentEmails,
  consentsFromFormFieldIdValues,
  smtpConfigured,
} = require('./lib/consent-emails');
const { createConsentEmailScheduler } = require('./lib/consent-email-scheduler');

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

const PREF_BRAND_ID = '1170da8e-ac0c-4bb0-b4ad-fe9c0322825a';
const PREF_CONSENT_FORM_ID = '2d84def1-2edd-4c35-9fc1-83cf21178d27';
const PREF_EMAIL_FIELD_ID = '349c4854-4370-43f9-bc6b-6705185b9624';
const PREF_CHANNEL = 'Website';
const PREF_LOCALE = 'en';
const PREF_RENDERER_BASE = 'https://cpm-form.trustarc.com/xapi/v1/consent-form-renderer';

const consentScheduler = createConsentEmailScheduler(db, {
  brandId: PREF_BRAND_ID,
  consentFormId: PREF_CONSENT_FORM_ID,
  emailFieldId: PREF_EMAIL_FIELD_ID,
  channel: PREF_CHANNEL,
  locale: PREF_LOCALE,
  rendererBase: PREF_RENDERER_BASE,
  intervalMs: Number(process.env.CONSENT_EMAIL_INTERVAL_MS || 5 * 60 * 1000),
  enabled: String(process.env.CONSENT_EMAIL_CRON_ENABLED || 'true').toLowerCase() !== 'false',
});

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
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------------------------------------------------------------------------
// Preference Center proxy — keeps TrustArc IDs server-side and avoids CORS.
// Mirrors the reference trustarc-preference-center.php load/submit flow.
// ---------------------------------------------------------------------------

function flattenPreferenceMap(latestPreferences) {
  const map = {};
  if (!Array.isArray(latestPreferences)) return map;
  for (const entry of latestPreferences) {
    if (!entry || typeof entry !== 'object') continue;
    for (const [fieldId, values] of Object.entries(entry)) {
      if (Array.isArray(values) && values.length) {
        map[fieldId] = values[0];
      } else if (values != null && values !== '') {
        map[fieldId] = values;
      }
    }
  }
  return map;
}

function normalizeFields(formFields, valueMap) {
  const fields = [];
  if (!Array.isArray(formFields)) return fields;

  for (const field of formFields) {
    if (!field || !field.id) continue;
    const typeId = (field.type && field.type.id) || field.type || 'Text';
    const hidden = !!(field.settings && field.settings.hidden && field.settings.hidden.value);
    if (hidden) continue;

    const required = !!(field.settings && field.settings.required && field.settings.required.value);
    const isEmailField = field.id === PREF_EMAIL_FIELD_ID || typeId === 'Email';
    const readOnly = isEmailField || !!(field.settings && field.settings.readOnly && field.settings.readOnly.value);
    const rawValue = Object.prototype.hasOwnProperty.call(valueMap, field.id)
      ? valueMap[field.id]
      : (field.extras && field.extras.defaultValue && Object.prototype.hasOwnProperty.call(field.extras.defaultValue, 'key')
          ? field.extras.defaultValue.key
          : '');

    const normalized = {
      id: field.id,
      type: typeId,
      label: field.label || field.type?.name || 'Field',
      required,
      readOnly,
      value: rawValue == null ? '' : (typeof rawValue === 'boolean' ? rawValue : String(rawValue)),
      options: [],
    };

    if (typeId === 'Country' || typeId === 'Select' || typeId === 'Dropdown') {
      const options = (field.extras && field.extras.countriesOption) || field.options || [];
      if (Array.isArray(options)) {
        normalized.options = options
          .filter((o) => o && (o.key != null || o.value != null))
          .map((o) => ({
            value: o.key != null ? String(o.key) : String(o.value),
            label: o.value != null ? String(o.value) : String(o.key),
          }));
      }
    }

    if (typeId === 'Checkbox' || typeId === 'ToggleSwitch' || typeId === 'Toggle') {
      const v = String(rawValue).toLowerCase();
      normalized.value = v === 'true' || v === '1' || v === 'yes' || rawValue === true;
    }

    fields.push(normalized);
  }

  return fields;
}

function subjectExists(valueMap) {
  // TrustArc echoes the lookup email even when no prior consent exists.
  // Treat as "found" only when at least one non-email preference is present.
  return Object.keys(valueMap).some((id) => id !== PREF_EMAIL_FIELD_ID);
}

app.post('/api/preference-center', async (req, res) => {
  const action = (req.body && req.body.action) || req.query.action;

  try {
    if (action === 'load') {
      const email = String((req.body && req.body.email) || '').trim();
      if (!email || !isValidEmail(email)) {
        return res.status(400).json({ exists: false, error: 'Please enter a valid email address.' });
      }

      const params = new URLSearchParams({
        brandId: PREF_BRAND_ID,
        channel: PREF_CHANNEL,
        locale: PREF_LOCALE,
        latestPreference: 'true',
        [PREF_EMAIL_FIELD_ID]: email,
      });

      const upstream = await fetch(`${PREF_RENDERER_BASE}/${PREF_CONSENT_FORM_ID}?${params}`, {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': 'hdfc-life-preference-center' },
      });

      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        return res.status(upstream.status).json({
          exists: false,
          error: (data && data.message) || 'Unable to load preferences right now.',
        });
      }

      const valueMap = flattenPreferenceMap(data.latestPreferences);
      const fields = normalizeFields(data.content && data.content.formFields, valueMap);
      const exists = subjectExists(valueMap) && fields.length > 0;

      if (!exists) {
        consentScheduler.rememberEmail(email, 'preference_center_lookup');
        return res.json({
          exists: false,
          error: "We couldn't find any preferences associated with that email address.",
        });
      }

      consentScheduler.rememberEmail(email, 'preference_center');
      return res.json({ exists: true, email, fields });
    }

    if (action === 'submit') {
      let formFieldIdValues = req.body && req.body.formFieldIdValues;
      if (typeof formFieldIdValues === 'string') {
        try {
          formFieldIdValues = JSON.parse(formFieldIdValues);
        } catch (err) {
          return res.status(400).json({ success: false, error: 'Invalid preference payload.' });
        }
      }

      if (!Array.isArray(formFieldIdValues) || !formFieldIdValues.length) {
        return res.status(400).json({ success: false, error: 'No preferences to save.' });
      }

      const payload = {
        brandId: PREF_BRAND_ID,
        consentFormId: PREF_CONSENT_FORM_ID,
        channel: PREF_CHANNEL,
        locale: PREF_LOCALE,
        formFieldIdValues,
      };

      const upstream = await fetch(`${PREF_RENDERER_BASE}/submit`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'hdfc-life-preference-center',
        },
        body: JSON.stringify(payload),
      });

      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        return res.status(upstream.status).json({
          success: false,
          error: (data && data.message) || 'Failed to save preferences.',
        });
      }

      const parsed = consentsFromFormFieldIdValues(formFieldIdValues, PREF_EMAIL_FIELD_ID);
      const email = String((req.body && req.body.email) || parsed.email || '').trim();
      let emails = { sent: [], skipped: ['no_email'] };
      if (email && isValidEmail(email)) {
        consentScheduler.rememberEmail(email, 'preference_center');
    const emails = await sendConsentEmails({
      email,
      consents: {
        marketing: parsed.marketing,
        kyc: parsed.kyc,
        claim: parsed.claim,
      },
      source: 'Preference Center',
    });
    // Only mark types that actually sent (SMTP success or outbox-only demo).
    const notified = {};
    for (const s of emails.sent || []) {
      if (s && s.ok && s.type) notified[s.type] = true;
    }
    if (Object.keys(notified).length) {
      consentScheduler.markGrantedNotified(email, notified);
    }
  }

      return res.json({ success: true, data, emails });
    }

    return res.status(400).json({ error: 'Unknown action. Use action=load or action=submit.' });
  } catch (err) {
    console.error('[Preference Center] failed:', err);
    return res.status(502).json({
      exists: false,
      success: false,
      error: 'Something went wrong. Please try again later.',
    });
  }
});

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

    consentScheduler.rememberEmail(email, 'term_plan_leads');

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

// Consent confirmation emails (marketing / kyc / claim) — only when granted.
app.post('/api/consent-emails', async (req, res) => {
  try {
    const email = String((req.body && req.body.email) || '').trim();
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'A valid email is required.' });
    }

    consentScheduler.rememberEmail(email, 'website_form');

    const consents = {
      marketing: req.body.marketing,
      kyc: req.body.kyc,
      claim: req.body.claim,
    };

    const emails = await sendConsentEmails({
      email,
      consents,
      source: (req.body && req.body.source) || 'Website form',
    });
    const notified = {};
    for (const s of emails.sent || []) {
      if (s && s.ok && s.type) notified[s.type] = true;
    }
    if (Object.keys(notified).length) {
      consentScheduler.markGrantedNotified(email, notified);
    }

    res.json({ success: true, emails });
  } catch (err) {
    console.error('[ConsentEmail] failed:', err);
    res.status(500).json({ success: false, message: 'Failed to queue consent emails.' });
  }
});

// Manual trigger for the 5-min consent email job (ops / testing).
app.post('/api/consent-email-job/run', async (req, res) => {
  try {
    const summary = await consentScheduler.runOnce();
    res.json({ success: true, summary });
  } catch (err) {
    console.error('[ConsentScheduler] manual run failed:', err);
    res.status(500).json({ success: false, message: err.message });
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
  console.log(
    smtpConfigured()
      ? `[ConsentEmail] SMTP ready → ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}`
      : '[ConsentEmail] SMTP not configured — set SMTP_* in .env (see .env.example)'
  );
  consentScheduler.start();
});
