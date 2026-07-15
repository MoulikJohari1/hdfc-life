const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const FIELD_IDS = {
  marketing: '8cef8b0b-fe5b-4df9-85a5-a063319815fa',
  kyc: 'cf6d3110-80e3-4f4b-b07c-f57326f9f211',
  claim: '3f069fb4-12b0-454c-ac5a-d068eab6d6f6',
};

const TEMPLATES = {
  marketing: {
    subject: 'Horizon — Marketing consent confirmation',
    file: 'consent-marketing.html',
  },
  kyc: {
    subject: 'Horizon — KYC consent confirmation',
    file: 'consent-kyc.html',
  },
  claim: {
    subject: 'Horizon — Claims & verification consent confirmation',
    file: 'consent-claim.html',
  },
};

const templatesDir = path.join(__dirname, '..', 'email-templates');
const outboxDir = path.join(__dirname, '..', 'data', 'outbox');

let transporter = null;

function ensureOutbox() {
  if (!fs.existsSync(outboxDir)) {
    fs.mkdirSync(outboxDir, { recursive: true });
  }
}

function isTruthy(value) {
  if (typeof value === 'boolean') return value;
  const v = String(value == null ? '' : value).toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTemplate(type, vars) {
  const meta = TEMPLATES[type];
  if (!meta) throw new Error(`Unknown consent email type: ${type}`);
  const templatePath = path.join(templatesDir, meta.file);
  let html = fs.readFileSync(templatePath, 'utf8');
  for (const [key, value] of Object.entries(vars)) {
    html = html.split(`{{${key}}}`).join(escapeHtml(value));
  }
  return { subject: meta.subject, html };
}

function safeFilenamePart(value) {
  return String(value).replace(/[^a-zA-Z0-9._@-]+/g, '_').slice(0, 80);
}

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (transporter) return transporter;
  if (!smtpConfigured()) return null;

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 15000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 15000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 20000),
  });

  return transporter;
}

function saveOutboxCopy({ to, type, subject, html }) {
  ensureOutbox();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${stamp}-${type}-${safeFilenamePart(to)}.html`;
  const filepath = path.join(outboxDir, filename);
  const envelope = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `X-Consent-Type: ${type}`,
    `Date: ${new Date().toUTCString()}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
    '',
    html,
  ].join('\n');
  fs.writeFileSync(filepath, envelope, 'utf8');
  return filepath;
}

async function sendOneEmail({ to, type, subject, html }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const saveOutbox = String(process.env.SMTP_SAVE_OUTBOX || 'true').toLowerCase() !== 'false';
  let filepath = null;

  if (saveOutbox) {
    filepath = saveOutboxCopy({ to, type, subject, html });
  }

  const tx = getTransporter();
  if (!tx) {
    console.warn(`[ConsentEmail] SMTP not configured — saved outbox only for ${type} → ${to}`);
    return {
      ok: true,
      demo: true,
      filepath,
      subject,
      type,
      to,
      warning: 'SMTP not configured; email written to outbox only.',
    };
  }

  const info = await tx.sendMail({
    from,
    to,
    subject,
    html,
  });

  console.log(`[ConsentEmail] SMTP sent ${type} → ${to} (messageId=${info.messageId})`);
  return {
    ok: true,
    demo: false,
    messageId: info.messageId,
    filepath,
    subject,
    type,
    to,
  };
}

/**
 * Send one confirmation email per consent type present in `consents`.
 */
async function sendConsentEmails({ email, consents = {}, source = 'Website' }) {
  if (!email) return { sent: [], skipped: ['missing_email'], errors: [] };

  const timestamp = new Date().toISOString();
  const results = { sent: [], skipped: [], errors: [] };

  for (const type of ['marketing', 'kyc', 'claim']) {
    if (!Object.prototype.hasOwnProperty.call(consents, type)) {
      results.skipped.push(type);
      continue;
    }

    // Only email when consent is granted (not withdrawn / unchecked).
    if (!isTruthy(consents[type])) {
      results.skipped.push(`${type}:not_granted`);
      continue;
    }

    const { subject, html } = renderTemplate(type, {
      EMAIL: email,
      SOURCE: source,
      TIMESTAMP: timestamp,
      STATUS_LABEL: 'GRANTED',
      STATUS_COLOR: '#1a8d4c',
    });

    try {
      const result = await sendOneEmail({ to: email, type, subject, html });
      results.sent.push(result);
    } catch (err) {
      console.error(`[ConsentEmail] failed ${type} → ${email}:`, err.message);
      results.errors.push({ type, to: email, error: err.message });
    }
  }

  return results;
}

function consentsFromFormFieldIdValues(formFieldIdValues, emailFieldId) {
  const map = {};
  if (!Array.isArray(formFieldIdValues)) return map;

  for (const entry of formFieldIdValues) {
    if (!entry || typeof entry !== 'object') continue;
    for (const [id, values] of Object.entries(entry)) {
      const value = Array.isArray(values) ? values[0] : values;
      if (id === FIELD_IDS.marketing) map.marketing = value;
      else if (id === FIELD_IDS.kyc) map.kyc = value;
      else if (id === FIELD_IDS.claim) map.claim = value;
      else if (emailFieldId && id === emailFieldId) map.email = value;
    }
  }
  return map;
}

module.exports = {
  FIELD_IDS,
  sendConsentEmails,
  consentsFromFormFieldIdValues,
  smtpConfigured,
  outboxDir,
};
