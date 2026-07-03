// Visual-only interactions — no real form/data logic, just UI polish.

document.addEventListener('DOMContentLoaded', () => {
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
