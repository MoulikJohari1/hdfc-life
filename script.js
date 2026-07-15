// Visual-only interactions — no real form/data logic, just UI polish.

document.addEventListener('DOMContentLoaded', () => {
  // TrustArc CPM field UIDs
  const CPM_FIELDS = {
    marketing: '8cef8b0b-fe5b-4df9-85a5-a063319815fa',
    kyc:       'cf6d3110-80e3-4f4b-b07c-f57326f9f211',
    claim:     '3f069fb4-12b0-454c-ac5a-d068eab6d6f6',
    email:     '349c4854-4370-43f9-bc6b-6705185b9624',
    jurisdiction: '00000000-0000-0000-0000-100000000000',
  };

  const calcFormMessage = document.getElementById('calcFormMessage');
  const externalSubmitBtn = document.getElementById('external-submit');

  function showCalcMessage(text, type) {
    if (!calcFormMessage) return;
    calcFormMessage.textContent = text;
    calcFormMessage.className = 'calc-form-message';
    if (type) calcFormMessage.classList.add(`calc-form-message--${type}`);
  }

  function validateForm() {
    const emailInput = document.getElementById('calcEmail');
    const jurisdiction = document.getElementById('calcJurisdiction');

    if (!emailInput.value.trim()) {
      showCalcMessage('Email is required.', 'error');
      emailInput.focus();
      return false;
    }
    if (!emailInput.checkValidity()) {
      showCalcMessage('Please enter a valid email address.', 'error');
      emailInput.focus();
      return false;
    }
    if (!jurisdiction.value) {
      showCalcMessage('Please select a region.', 'error');
      jurisdiction.focus();
      return false;
    }
    return true;
  }

  if (externalSubmitBtn) {
    externalSubmitBtn.addEventListener('click', async () => {
      if (!validateForm()) return;

      const email        = document.getElementById('calcEmail').value.trim();
      const jurisdiction = document.getElementById('calcJurisdiction').value;
      const marketing    = document.getElementById('calcConsentMarketing').checked;
      const kyc          = document.getElementById('calcConsentKyc').checked;
      const claim        = document.getElementById('calcConsentClaim').checked;

      externalSubmitBtn.disabled = true;
      externalSubmitBtn.textContent = 'Submitting...';
      showCalcMessage('', '');

      const cpmPayload = {
        [CPM_FIELDS.marketing]:    marketing,
        [CPM_FIELDS.kyc]:          kyc,
        [CPM_FIELDS.claim]:        claim,
        [CPM_FIELDS.email]:        email,
        [CPM_FIELDS.jurisdiction]: jurisdiction,
      };
      console.log('[CPM] Submitting payload', cpmPayload);

      try {
        const response = await window.trustarc.upm.externalSubmit()(cpmPayload);

        showCalcMessage('Thank you! Your consent has been recorded and we will connect with you soon.', 'success');

        // Also persist the lead to the local backend
        const termPlanForm = document.getElementById('termPlanForm');
        const calcConsent = document.getElementById('calcConsent');
        const payload = {
          fullName:   document.getElementById('calcFullName').value.trim(),
          gender:     termPlanForm.querySelector('input[name="calcGender"]:checked')?.value || '',
          tobacco:    termPlanForm.querySelector('input[name="calcTobacco"]:checked')?.value || '',
          dob:        document.getElementById('calcDob').value.trim(),
          mobile:     document.getElementById('calcMobile').value.trim(),
          email,
          consent:    calcConsent ? calcConsent.checked : marketing,
        };
        fetch('api/term-plan-leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).catch(() => {});

        // Demo: send one confirmation email per consent type
        fetch('api/consent-emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            marketing,
            kyc,
            claim,
            source: 'Website form',
          }),
        }).catch((err) => console.warn('[ConsentEmail] request failed', err));

        // Reset form
        termPlanForm.reset();
        document.querySelector('input[name="calcGender"][value="Male"]').checked = true;
        document.querySelector('input[name="calcTobacco"][value="No"]').checked = true;
        if (calcConsent) calcConsent.checked = true;

        console.log('[CPM] Submission success', response);
      } catch (error) {
        console.error('[CPM] Submission error', error);

        if (error && error.errorType === 'form') {
          showCalcMessage(error.message || 'Please check your entries and try again.', 'error');
        } else if (error && error.errorType === 'server') {
          showCalcMessage(error.message || 'A server error occurred. Please try again later.', 'error');
        } else {
          showCalcMessage('Submission failed. Please try again.', 'error');
        }
      } finally {
        externalSubmitBtn.disabled = false;
        externalSubmitBtn.textContent = 'Connect with us now';
      }
    });
  }

  // Date of Birth: keep DD/MM/YYYY as the user types
  const calcDob = document.getElementById('calcDob');
  if (calcDob) {
    calcDob.addEventListener('input', () => {
      const digits = calcDob.value.replace(/\D/g, '').slice(0, 8);
      let formatted = digits;
      if (digits.length > 4) {
        formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
      } else if (digits.length > 2) {
        formatted = `${digits.slice(0, 2)}/${digits.slice(2)}`;
      }
      calcDob.value = formatted;
    });
  }

  // Mobile hamburger toggle
  const hamburger = document.querySelector('.hamburger-btn');
  const mobileNav = document.querySelector('.mobile-nav-panel');
  if (hamburger && mobileNav) {
    hamburger.addEventListener('click', () => {
      mobileNav.classList.toggle('open');
      hamburger.classList.toggle('active');
    });
  }

  // Tap-to-open dropdowns (desktop already uses CSS :hover; this just
  // makes the same menus tappable on touch devices).
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      if (window.matchMedia('(hover: none)').matches) {
        e.preventDefault();
        item.classList.toggle('open');
      }
    });
  });

  // Accordion-style sections (FAQ, glossary): first item open by default,
  // clicking a header just toggles a visual "open" class.
  document.querySelectorAll('.accordion-item .accordion-header').forEach((header) => {
    header.addEventListener('click', () => {
      header.closest('.accordion-item').classList.toggle('open');
    });
  });

  // Carousel dot indicators: purely cosmetic active-state switching,
  // no real slide content change.
  document.querySelectorAll('.carousel-dots').forEach((dotsWrap) => {
    const dots = dotsWrap.querySelectorAll('.dot');
    dots.forEach((dot) => {
      dot.addEventListener('click', () => {
        dots.forEach((d) => d.classList.remove('active'));
        dot.classList.add('active');
      });
    });
  });

  // ---- Cookie Settings + Preference Center ----
  const cookieModal = document.getElementById('cookieModal');

  function openModal(modal) {
    if (!modal) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  document.querySelectorAll('.ck-open-cookies').forEach((btn) => {
    btn.addEventListener('click', () => openModal(cookieModal));
  });

  // Close on overlay / close button (cookie modal)
  document.querySelectorAll('[data-ck-close]').forEach((el) => {
    el.addEventListener('click', () => {
      closeModal(el.closest('.ck-modal'));
    });
  });

  // Cookie preference toggles
  if (cookieModal) {
    const cookieToggles = cookieModal.querySelectorAll('input[data-cookie]');
    const cookieMessage = document.getElementById('cookieMessage');

    function setCookieMessage(text, type) {
      if (!cookieMessage) return;
      cookieMessage.textContent = text;
      cookieMessage.className = 'ck-modal-message';
      if (type) cookieMessage.classList.add(`ck-${type}`);
    }

    cookieModal.querySelector('.ck-accept-all')?.addEventListener('click', () => {
      cookieToggles.forEach((t) => { t.checked = true; });
    });

    cookieModal.querySelector('.ck-reject-all')?.addEventListener('click', () => {
      cookieToggles.forEach((t) => { t.checked = false; });
    });

    cookieModal.querySelector('.ck-save-cookies')?.addEventListener('click', () => {
      const prefs = {};
      cookieToggles.forEach((t) => { prefs[t.dataset.cookie] = t.checked; });
      try {
        localStorage.setItem('hdfc_cookie_prefs', JSON.stringify(prefs));
      } catch (err) {
        /* storage may be unavailable; ignore */
      }
      setCookieMessage('Your cookie preferences have been saved.', 'success');
    });

    try {
      const saved = JSON.parse(localStorage.getItem('hdfc_cookie_prefs') || 'null');
      if (saved) {
        cookieToggles.forEach((t) => {
          if (typeof saved[t.dataset.cookie] === 'boolean') t.checked = saved[t.dataset.cookie];
        });
      }
    } catch (err) {
      /* ignore malformed storage */
    }
  }

  // ---- Preference Center controller (TrustArc via /api/preference-center) ----
  (function initPreferenceCenter() {
    // Relative path so this works under /hdfc-life/ (and any other subpath deploy).
    const ENDPOINT = 'api/preference-center';
    const overlay = document.getElementById('prefCenterOverlay');
    if (!overlay) return;

    const emailView = document.getElementById('prefEmailView');
    const loadingView = document.getElementById('prefLoadingView');
    const notFoundView = document.getElementById('prefNotFoundView');
    const formView = document.getElementById('prefFormView');
    const successView = document.getElementById('prefSuccessView');
    const emailForm = document.getElementById('prefEmailForm');
    const editForm = document.getElementById('prefEditForm');
    const emailInput = document.getElementById('prefEmailInput');
    const errorEl = document.getElementById('prefError');
    const formErrorEl = document.getElementById('prefFormError');
    const notFoundMsg = document.getElementById('prefNotFoundMsg');
    const fieldsWrap = document.getElementById('prefFields');
    const saveBtn = document.getElementById('prefSaveBtn');
    const closeBtn = document.getElementById('prefCloseBtn');

    let currentEmail = '';
    let currentFields = [];

    const views = [emailView, loadingView, notFoundView, formView, successView];

    function showView(view) {
      views.forEach((v) => {
        if (!v) return;
        v.classList.toggle('pref-hidden', v !== view);
      });
    }

    function openPrefCenter() {
      if (errorEl) errorEl.textContent = '';
      if (formErrorEl) formErrorEl.textContent = '';
      if (emailInput) emailInput.value = '';
      currentEmail = '';
      currentFields = [];
      showView(emailView);
      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
      setTimeout(() => emailInput && emailInput.focus(), 50);
    }

    function closePrefCenter() {
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
    }

    document.querySelectorAll('.ck-open-preference').forEach((btn) => {
      btn.addEventListener('click', openPrefCenter);
    });

    closeBtn?.addEventListener('click', closePrefCenter);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closePrefCenter();
    });

    document.getElementById('prefTryAgainBtn')?.addEventListener('click', () => {
      if (errorEl) errorEl.textContent = '';
      showView(emailView);
      emailInput?.focus();
    });

    document.getElementById('prefDoneBtn')?.addEventListener('click', closePrefCenter);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeModal(cookieModal);
        if (overlay.classList.contains('open')) closePrefCenter();
      }
    });

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function isToggleType(type) {
      return type === 'Checkbox' || type === 'ToggleSwitch' || type === 'Toggle';
    }

    function isSelectType(type) {
      return type === 'Country' || type === 'Select' || type === 'Dropdown';
    }

    // Prefer the same consent copy shown on the homepage form.
    const CONSENT_LABELS = {
      [CPM_FIELDS.marketing]:
        'I authorize Horizon and its representatives to contact me through Call, Email, SMS or WhatsApp. This consent overrides my registration under DNC / NDNC (this would mean we would contact you even if you are registered on any Do Not Disturb list).',
      [CPM_FIELDS.kyc]:
        'I consent to the collection and processing of my personal identifiers and contact details for mandatory KYC checks, identity verification, and issuance, renewal, claims, and servicing of insurance policies as per applicable regulations.',
      [CPM_FIELDS.claim]:
        'I consent to verification of my personal information through authorized sources or service providers for KYC, fraud prevention, regulatory compliance, policy servicing, and claims processing.',
    };

    function displayLabel(field) {
      return CONSENT_LABELS[field.id] || field.label || 'Field';
    }

    function renderForm(data) {
      currentFields = Array.isArray(data.fields) ? data.fields : [];
      fieldsWrap.innerHTML = '';

      currentFields.forEach((field) => {
        const wrap = document.createElement('div');
        wrap.className = 'pref-field';
        wrap.dataset.fieldId = field.id;
        wrap.dataset.fieldType = field.type;
        // Keep email identifier read-only in the preference editor.
        if (field.type === 'Email') field.readOnly = true;
        const label = displayLabel(field);

        if (isToggleType(field.type)) {
          wrap.classList.add('pref-field--consent');
          wrap.innerHTML =
            '<div class="pref-field-row">' +
              '<span class="pref-field-label">' + escapeHtml(label) + '</span>' +
              '<label class="pref-toggle">' +
                '<input type="checkbox" data-pref-field="' + escapeHtml(field.id) + '"' +
                  (field.value ? ' checked' : '') +
                  (field.readOnly ? ' disabled' : '') + '>' +
                '<span class="pref-toggle-slider"></span>' +
              '</label>' +
            '</div>';
        } else if (isSelectType(field.type)) {
          const options = (field.options || []).map((opt) => {
            const selected = String(opt.value) === String(field.value) ? ' selected' : '';
            return '<option value="' + escapeHtml(opt.value) + '"' + selected + '>' +
              escapeHtml(opt.label) + '</option>';
          }).join('');
          wrap.innerHTML =
            '<label class="pref-field-label" for="pref-field-' + escapeHtml(field.id) + '">' +
              escapeHtml(label) +
            '</label>' +
            '<select id="pref-field-' + escapeHtml(field.id) + '" class="pref-input" data-pref-field="' +
              escapeHtml(field.id) + '"' + (field.readOnly ? ' disabled' : '') + '>' +
              options +
            '</select>';
        } else {
          const inputType = field.type === 'Email' ? 'email'
            : (field.type === 'Phone' || field.type === 'Telephone' ? 'tel' : 'text');
          wrap.innerHTML =
            '<label class="pref-field-label" for="pref-field-' + escapeHtml(field.id) + '">' +
              escapeHtml(label) +
            '</label>' +
            '<input type="' + inputType + '" id="pref-field-' + escapeHtml(field.id) +
              '" class="pref-input" data-pref-field="' + escapeHtml(field.id) +
              '" value="' + escapeHtml(field.value || '') + '"' +
              (field.readOnly ? ' readonly' : '') +
              (field.required ? ' required' : '') + '>';
        }

        fieldsWrap.appendChild(wrap);
      });

      if (formErrorEl) formErrorEl.textContent = '';
      showView(formView);
    }

    function collectFormFieldIdValues() {
      const values = [];
      fieldsWrap.querySelectorAll('[data-pref-field]').forEach((el) => {
        const id = el.getAttribute('data-pref-field');
        let value;
        if (el.type === 'checkbox') {
          value = el.checked ? 'true' : 'false';
        } else {
          value = el.value;
        }
        values.push({ [id]: [String(value)] });
      });
      return values;
    }

    emailForm?.addEventListener('submit', function (e) {
      e.preventDefault();
      if (errorEl) errorEl.textContent = '';

      const email = (emailInput?.value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (errorEl) errorEl.textContent = 'Please enter a valid email address.';
        return;
      }

      currentEmail = email;
      showView(loadingView);

      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'load', email }),
      })
        .then((res) => {
          const ct = res.headers.get('content-type') || '';
          if (!ct.includes('application/json')) {
            throw new Error('Preference Center API returned a non-JSON response (' + res.status + ').');
          }
          return res.json();
        })
        .then((data) => {
          if (data && data.exists && data.fields && data.fields.length) {
            renderForm(data);
          } else {
            if (notFoundMsg) {
              notFoundMsg.textContent = (data && data.error)
                ? data.error
                : "We couldn't find any preferences associated with that email address.";
            }
            showView(notFoundView);
          }
        })
        .catch((err) => {
          console.error('[Preference Center] load failed', err);
          if (notFoundMsg) notFoundMsg.textContent = 'Something went wrong. Please try again later.';
          showView(notFoundView);
        });
    });

    editForm?.addEventListener('submit', function (e) {
      e.preventDefault();
      if (formErrorEl) formErrorEl.textContent = '';

      const formFieldIdValues = collectFormFieldIdValues();
      if (!formFieldIdValues.length) {
        if (formErrorEl) formErrorEl.textContent = 'No preferences to save.';
        return;
      }

      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
      }
      showView(loadingView);

      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit',
          email: currentEmail,
          formFieldIdValues,
        }),
      })
        .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
        .then(({ ok, data }) => {
          if (ok && data && data.success) {
            showView(successView);
          } else {
            if (formErrorEl) {
              formErrorEl.textContent = (data && data.error) || 'Failed to save preferences.';
            }
            showView(formView);
          }
        })
        .catch(() => {
          if (formErrorEl) formErrorEl.textContent = 'Something went wrong. Please try again later.';
          showView(formView);
        })
        .finally(() => {
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Preferences';
          }
        });
    });
  })();
});
