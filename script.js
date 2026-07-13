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
        const payload = {
          fullName:   document.getElementById('calcFullName').value.trim(),
          gender:     termPlanForm.querySelector('input[name="calcGender"]:checked')?.value || '',
          tobacco:    termPlanForm.querySelector('input[name="calcTobacco"]:checked')?.value || '',
          dob:        document.getElementById('calcDob').value.trim(),
          mobile:     document.getElementById('calcMobile').value.trim(),
          email,
          consent:    document.getElementById('calcConsent').checked,
        };
        fetch('api/term-plan-leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).catch(() => {});

        // Reset form
        termPlanForm.reset();
        document.getElementById('calcDob').value = '01/01/1985';
        document.querySelector('input[name="calcGender"][value="Male"]').checked = true;
        document.querySelector('input[name="calcTobacco"][value="No"]').checked = true;
        document.getElementById('calcConsent').checked = true;

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
  const preferenceModal = document.getElementById('preferenceModal');

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

  document.querySelectorAll('.ck-open-preference').forEach((btn) => {
    btn.addEventListener('click', () => openModal(preferenceModal));
  });

  // Close on overlay / close button
  document.querySelectorAll('[data-ck-close]').forEach((el) => {
    el.addEventListener('click', () => {
      closeModal(el.closest('.ck-modal'));
    });
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal(cookieModal);
      closeModal(preferenceModal);
    }
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

    // Restore any previously saved preferences
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

  // Preference Center email step
  const preferenceEmailForm = document.getElementById('preferenceEmailForm');
  if (preferenceEmailForm) {
    const preferenceMessage = document.getElementById('preferenceMessage');
    const preferenceEmail = document.getElementById('preferenceEmail');

    function setPreferenceMessage(text, type) {
      if (!preferenceMessage) return;
      preferenceMessage.textContent = text;
      preferenceMessage.className = 'ck-modal-message';
      if (type) preferenceMessage.classList.add(`ck-${type}`);
    }

    preferenceEmailForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = preferenceEmail.value.trim();

      if (!email) {
        setPreferenceMessage('Email is required.', 'error');
        preferenceEmail.focus();
        return;
      }

      if (!preferenceEmail.checkValidity()) {
        setPreferenceMessage('Please enter a valid email address.', 'error');
        preferenceEmail.focus();
        return;
      }

      setPreferenceMessage(`Thanks. We'll use ${email} to load your consent preferences.`, 'success');
    });
  }
});
