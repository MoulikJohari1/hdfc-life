const { chromium } = require('playwright');

const REGIONS = [
  'Other',
  'Australia',
  'Canada',
  'Europa Island',
  'Germany',
  'India',
  'Singapore',
  'United Arab Emirates',
  'United Kingdom',
  'United States',
];

async function resolveOne(browser, name) {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:3000/cpm-debug.html', { waitUntil: 'networkidle', timeout: 30000 });
  const sel = 'input[id="00000000-0000-0000-0000-100000000000"]';
  await page.waitForSelector(sel, { timeout: 15000 });
  await page.click(sel);
  await page.type(sel, name, { delay: 60 });
  await page.waitForTimeout(1200);

  const focused = await page.$$eval('[role="option"].ta-upm-select__option--is-focused, [class*="option--is-focused"]', (els) =>
    els.map((el) => el.textContent.trim())
  ).catch(() => []);

  await page.keyboard.press('Enter').catch(() => {});
  await page.waitForTimeout(800);

  const code = await page.$eval('input[name="00000000-0000-0000-0000-100000000000"][type="hidden"]', (el) => el.value).catch((e) => 'ERROR:' + e.message);
  await page.close();
  return { name, focusedOptionText: focused[0] || null, code };
}

(async () => {
  const browser = await chromium.launch();
  const results = [];
  for (const name of REGIONS) {
    const r = await resolveOne(browser, name);
    results.push(r);
    console.log(JSON.stringify(r));
  }
  await browser.close();
  console.log('=== SUMMARY ===');
  console.log(JSON.stringify(results, null, 2));
})();
