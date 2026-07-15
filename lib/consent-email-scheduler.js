const {
  FIELD_IDS,
  sendConsentEmails,
} = require('./consent-emails');

function isTruthy(value) {
  if (typeof value === 'boolean') return value;
  const v = String(value == null ? '' : value).toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

/**
 * Periodic TrustArc consent check → send marketing/kyc/claim emails only when granted.
 * Dedupes via consent_email_sent so we don't re-mail the same grant every cycle.
 */
function createConsentEmailScheduler(db, config) {
  const {
    brandId,
    consentFormId,
    emailFieldId,
    channel = 'Website',
    locale = 'en',
    rendererBase = 'https://cpm-form.trustarc.com/xapi/v1/consent-form-renderer',
    intervalMs = 5 * 60 * 1000,
    enabled = true,
  } = config;

  db.exec(`
    CREATE TABLE IF NOT EXISTS known_emails (
      email TEXT PRIMARY KEY,
      source TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS consent_email_sent (
      email TEXT NOT NULL,
      consent_type TEXT NOT NULL,
      last_status TEXT NOT NULL,
      last_sent_at TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (email, consent_type)
    );
  `);

  const upsertKnownEmail = db.prepare(`
    INSERT INTO known_emails (email, source, created_at, updated_at)
    VALUES (?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(email) DO UPDATE SET
      source = COALESCE(excluded.source, known_emails.source),
      updated_at = datetime('now')
  `);

  const listKnownEmails = db.prepare(`
    SELECT email FROM known_emails ORDER BY updated_at DESC
  `);

  const getSentRow = db.prepare(`
    SELECT last_status, last_sent_at FROM consent_email_sent
    WHERE email = ? AND consent_type = ?
  `);

  const upsertSent = db.prepare(`
    INSERT INTO consent_email_sent (email, consent_type, last_status, last_sent_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(email, consent_type) DO UPDATE SET
      last_status = excluded.last_status,
      last_sent_at = COALESCE(excluded.last_sent_at, consent_email_sent.last_sent_at),
      updated_at = datetime('now')
  `);

  function rememberEmail(email, source) {
    const e = String(email || '').trim().toLowerCase();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return;
    upsertKnownEmail.run(e, source || null);
  }

  function syncEmailsFromLeads() {
    const rows = db.prepare(`
      SELECT DISTINCT lower(trim(email)) AS email
      FROM term_plan_leads
      WHERE email IS NOT NULL AND trim(email) != ''
    `).all();
    for (const row of rows) rememberEmail(row.email, 'term_plan_leads');
  }

  function flattenPreferenceMap(latestPreferences) {
    const map = {};
    if (!Array.isArray(latestPreferences)) return map;
    for (const entry of latestPreferences) {
      if (!entry || typeof entry !== 'object') continue;
      for (const [fieldId, values] of Object.entries(entry)) {
        if (Array.isArray(values) && values.length) map[fieldId] = values[0];
        else if (values != null && values !== '') map[fieldId] = values;
      }
    }
    return map;
  }

  async function fetchConsentsForEmail(email) {
    const params = new URLSearchParams({
      brandId,
      channel,
      locale,
      latestPreference: 'true',
      [emailFieldId]: email,
    });

    const upstream = await fetch(`${rendererBase}/${consentFormId}?${params}`, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'hdfc-life-consent-scheduler' },
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      throw new Error((data && data.message) || `TrustArc HTTP ${upstream.status}`);
    }

    const valueMap = flattenPreferenceMap(data.latestPreferences);
    return {
      marketing: isTruthy(valueMap[FIELD_IDS.marketing]),
      kyc: isTruthy(valueMap[FIELD_IDS.kyc]),
      claim: isTruthy(valueMap[FIELD_IDS.claim]),
      hasRecord: Object.keys(valueMap).some((id) => id !== emailFieldId),
    };
  }

  /**
   * Mark that we already notified for granted consents (e.g. immediate send on form submit).
   * Prevents the 5-min job from duplicate-sending the same grant.
   */
  function markGrantedNotified(email, consents = {}) {
    const e = String(email || '').trim().toLowerCase();
    if (!e) return;
    const now = new Date().toISOString();
    for (const type of ['marketing', 'kyc', 'claim']) {
      if (!Object.prototype.hasOwnProperty.call(consents, type)) continue;
      if (isTruthy(consents[type])) {
        upsertSent.run(e, type, 'granted', now);
      } else {
        upsertSent.run(e, type, 'withdrawn', null);
      }
    }
  }

  function shouldSendGranted(email, type) {
    const row = getSentRow.get(email, type);
    // Send only when granted and we have not already notified for a granted state.
    return !row || row.last_status !== 'granted';
  }

  let running = false;

  async function runOnce() {
    if (running) {
      console.log('[ConsentScheduler] previous run still in progress — skip');
      return { skipped: true };
    }
    running = true;
    const summary = {
      emails: 0,
      checked: 0,
      sent: [],
      errors: [],
    };

    try {
      syncEmailsFromLeads();
      const emails = listKnownEmails.all().map((r) => r.email);
      summary.emails = emails.length;
      console.log(`[ConsentScheduler] checking ${emails.length} email(s)`);

      for (const email of emails) {
        try {
          const consents = await fetchConsentsForEmail(email);
          summary.checked += 1;

          if (!consents.hasRecord) {
            // No TrustArc prefs beyond echoed email — nothing to mail.
            continue;
          }

          const toSend = {};
          for (const type of ['marketing', 'kyc', 'claim']) {
            if (consents[type] && shouldSendGranted(email, type)) {
              toSend[type] = true;
            } else if (!consents[type]) {
              // Keep withdrawn state so a future re-grant will mail again.
              upsertSent.run(email, type, 'withdrawn', null);
            }
          }

          if (!Object.keys(toSend).length) continue;

          const result = await sendConsentEmails({
            email,
            consents: toSend,
            source: 'Consent scheduler (5 min)',
          });

          // Only mark types that actually sent without error.
          const sentTypes = (result.sent || []).map((s) => s.type);
          const now = new Date().toISOString();
          for (const type of sentTypes) {
            upsertSent.run(email, type, 'granted', now);
            summary.sent.push({ email, type });
          }
          for (const err of result.errors || []) {
            summary.errors.push({ email, type: err.type, error: err.error });
          }
        } catch (err) {
          console.error(`[ConsentScheduler] failed for ${email}:`, err.message);
          summary.errors.push({ email, error: err.message });
        }
      }
    } finally {
      running = false;
    }

    console.log(
      `[ConsentScheduler] done — checked=${summary.checked} sent=${summary.sent.length} errors=${summary.errors.length}`
    );
    return summary;
  }

  let timer = null;

  function start() {
    if (!enabled) {
      console.log('[ConsentScheduler] disabled (CONSENT_EMAIL_CRON_ENABLED=false)');
      return;
    }
    if (timer) return;
    console.log(`[ConsentScheduler] started — every ${Math.round(intervalMs / 1000)}s`);
    // First run shortly after boot, then on interval.
    setTimeout(() => {
      runOnce().catch((err) => console.error('[ConsentScheduler] run failed:', err));
    }, 15 * 1000);
    timer = setInterval(() => {
      runOnce().catch((err) => console.error('[ConsentScheduler] run failed:', err));
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    start,
    stop,
    runOnce,
    rememberEmail,
    markGrantedNotified,
    syncEmailsFromLeads,
  };
}

module.exports = { createConsentEmailScheduler };
