const { chromium } = require('playwright');

1(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', (msg) => console.log(`[console:${msg.type()}]`, msg.text()));

  page.on('response', (res) => {
    if (res.url().includes('trustarc') || res.url().includes('consent-form')) {
      console.log('[response]', res.status(), res.url());
    }x
  });
  await page.goto('https://dev002.privacient.com/hdfc-life/', { waitUntil: 'load', timeout: 30000 });

  // scroll to / wait for the calculator form fields
  await page.waitForSelector('#calcEmail', { timeout: 15000 });
  await page.fill('#calcFullName', 'Pooja Agrawal');
  await page.check('input[name="calcGender"][value="Female"]');
  await page.check('input[name="calcTobacco"][value="Yes"]');
  await page.fill('#calcMobile', '9404115087');
  await page.fill('#calcEmail', 'pooja.t.agrawal@gmail.com');
  await page.selectOption('#calcJurisdiction', 'AS_IN');
  await page.check('#calcConsentMarketing');
  await page.check('#calcConsentKyc');
  await page.check('#calcConsentClaim');

  // Wait a bit to ensure trustarc upm.init() completed before submit
  await page.waitForTimeout(3000);

  await page.click('#external-submit');
  await page.waitForTimeout(4000);

  const message = await page.textContent('#calcFormMessage').catch(() => null);
  console.log('=== FORM MESSAGE AFTER SUBMIT ===');
  console.log(message);

  await page.screenshot({ path: '/tmp/index-submit-result.png' }).catch(() => {});

  await browser.close();
})();
