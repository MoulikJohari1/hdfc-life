// Visual-only interactions — no real form/data logic, just UI polish.

document.addEventListener('DOMContentLoaded', () => {
  // Term plan lead form (SEC 08)
  const termPlanForm = document.getElementById('termPlanForm');
  const calcFormMessage = document.getElementById('calcFormMessage');

  if (termPlanForm) {
    termPlanForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const emailInput = document.getElementById('calcEmail');
      const submitBtn = termPlanForm.querySelector('.calc-submit');

      if (!emailInput.value.trim()) {
        showCalcMessage('Email is required.', 'error');
        emailInput.focus();
        return;
      }

      if (!emailInput.checkValidity()) {
        showCalcMessage('Please enter a valid email address.', 'error');
        emailInput.focus();
        return;
      }

      const payload = {
        fullName: document.getElementById('calcFullName').value.trim(),
        gender: termPlanForm.querySelector('input[name="calcGender"]:checked')?.value || '',
        tobacco: termPlanForm.querySelector('input[name="calcTobacco"]:checked')?.value || '',
        dob: document.getElementById('calcDob').value.trim(),
        mobile: document.getElementById('calcMobile').value.trim(),
        email: emailInput.value.trim(),
        consent: document.getElementById('calcConsent').checked,
      };

      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';
      showCalcMessage('', '');

      try {
        const res = await fetch('/api/term-plan-leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.message || 'Submission failed. Please try again.');
        }

        showCalcMessage(data.message || 'Thank you! We will connect with you soon.', 'success');
        termPlanForm.reset();
        document.getElementById('calcDob').value = '01/01/1985';
        document.querySelector('input[name="calcGender"][value="Male"]').checked = true;
        document.querySelector('input[name="calcTobacco"][value="No"]').checked = true;
        document.getElementById('calcConsent').checked = true;
      } catch (err) {
        showCalcMessage(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Connect with us now';
      }
    });
  }

  function showCalcMessage(text, type) {
    if (!calcFormMessage) return;
    calcFormMessage.textContent = text;
    calcFormMessage.className = 'calc-form-message';
    if (type) calcFormMessage.classList.add(`calc-form-message--${type}`);
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
});
