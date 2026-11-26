/**
 * Headless production check against `vite preview` (http://127.0.0.1:4173).
 * One full pass: landing, terms, privacy, support placeholder, every module,
 * SOS urge-surf / TIPP / breathing, then an offline reload.
 * Set SHOTS=1 to write screenshots into /opt/cursor/artifacts.
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const BASE = process.env.ANCHOR_BASE || 'http://127.0.0.1:4173/';
const SHOTS = process.env.SHOTS === '1';
const SHOT_DIR = process.env.SHOT_DIR || '/opt/cursor/artifacts';
const CHROME = process.env.CHROME_PATH || '/usr/local/bin/google-chrome';

const errors = [];

function fail(message) {
  throw new Error(message);
}

async function textOf(page) {
  return page.evaluate(() => document.body.innerText);
}

async function assertText(page, needle) {
  const text = await textOf(page);
  if (!text.includes(needle)) fail('Missing text: ' + needle + '\n---\n' + text.slice(0, 800));
}

async function assertNo(page, needle) {
  const text = await textOf(page);
  if (text.includes(needle)) fail('Unexpected text: ' + needle);
}

async function clickIncludes(page, text) {
  const clicked = await page.evaluate((needle) => {
    const nodes = [...document.querySelectorAll('button, a, [role="button"], div, span')];
    const matches = nodes.filter((node) => (node.innerText || '').includes(needle));
    if (!matches.length) return false;
    matches.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
    const el = matches[0];
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    el.click();
    return true;
  }, text);
  if (!clicked) fail('Could not click element containing: ' + text);
}

async function overlayValue(page, selector) {
  return page.evaluate((selector) => {
    const overlays = [...document.querySelectorAll('.fixed.inset-0')];
    const overlay = overlays[overlays.length - 1];
    if (!overlay) return '';
    const el = overlay.querySelector(selector);
    return el ? el.innerText.trim() : '';
  }, selector);
}

async function shot(page, name, fullPage = false) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, name), fullPage });
}

async function gotoHash(page, hash) {
  const url = BASE.replace(/#.*$/, '') + hash;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#root', { timeout: 15000 });
}

function attach(page) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console: ' + msg.text());
  });
  page.on('pageerror', (err) => {
    errors.push('pageerror: ' + (err && err.message ? err.message : String(err)));
  });
}

function assertClean() {
  if (errors.length) fail('Console or page errors:\n' + errors.join('\n'));
}

async function run() {
  const dist = path.resolve('dist');
  const index = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  if (index.includes('text/babel') || index.includes('vendor/babel')) fail('Production index still uses in-browser Babel');
  const jsFiles = fs.readdirSync(path.join(dist, 'assets')).filter((name) => name.endsWith('.js'));
  if (!jsFiles.length) fail('No built JS');
  const bundle = fs.readFileSync(path.join(dist, 'assets', jsFiles[0]), 'utf8');
  if (bundle.includes('in-browser Babel') || bundle.includes('babel.js')) fail('Bundle still mentions in-browser Babel');
  if (!fs.existsSync(path.join(dist, 'sw.js'))) fail('Missing dist/sw.js');
  if (!fs.existsSync(path.join(dist, 'manifest.webmanifest'))) fail('Missing manifest');

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 420, height: 900, deviceScaleFactor: 1 });
    attach(page);
    await page.evaluateOnNewDocument(() => {
      try { localStorage.clear(); } catch (e) {}
    });

    await gotoHash(page, '#/');
    await page.waitForFunction(() => document.body.innerText.includes('The Anchor'));
    await assertText(page, 'Add to Home screen');
    await assertText(page, 'SOS is never paywalled');
    await assertText(page, '0800 567 567');
    await assertText(page, '0800 12 13 14');
    await assertText(page, 'SMS 32312');
    await assertText(page, '0800 456 789');
    await assertText(page, 'SMS 31393');
    await assertText(page, 'SADAG office, 8am–8pm');
    await assertText(page, '011 234 4837');
    await assertText(page, '112');
    await shot(page, 'landing.png', true);

    await clickIncludes(page, 'Support The Anchor');
    await page.waitForFunction(() => document.body.innerText.includes('No payment is connected'));
    const inputCount = await page.evaluate(() => document.querySelectorAll('input, textarea, form, iframe').length);
    if (inputCount !== 0) fail('Support page has payment-like fields: ' + inputCount);
    await assertText(page, 'placeholder');
    await assertText(page, 'SOS stays free');
    await shot(page, 'support.png', true);

    await gotoHash(page, '#/terms');
    await page.waitForFunction(() => document.querySelector('h1') && document.querySelector('h1').textContent === 'Terms');
    await assertText(page, 'not a medical device');
    await assertText(page, '112');
    await shot(page, 'terms.png', true);

    await gotoHash(page, '#/privacy');
    await page.waitForFunction(() => document.querySelector('h1') && document.querySelector('h1').textContent === 'Privacy');
    await assertText(page, 'localStorage');
    await assertText(page, 'not a medical device');
    await assertText(page, '112');
    await shot(page, 'privacy.png', true);

    await gotoHash(page, '#/app');
    await page.waitForFunction(() => document.body.innerText.includes('Today'));
    await assertNo(page, 'Something glitched');

    await clickIncludes(page, 'Flow');
    await page.waitForFunction(() => document.body.innerText.includes('Pick one'));
    await assertText(page, 'Flow');

    await clickIncludes(page, 'Co-Pilot');
    await page.waitForFunction(() => document.body.innerText.includes("What's the one thing?") || document.body.innerText.includes('Co-Pilot'));
    await assertText(page, 'Co-Pilot');

    await clickIncludes(page, 'Anchor');
    await page.waitForFunction(() => document.body.innerText.includes('How are you, really?'));

    await clickIncludes(page, 'Home');
    await page.waitForFunction(() => document.body.innerText.includes('Today'));

    await clickIncludes(page, 'Show everything');
    await page.waitForFunction(() => document.body.innerText.includes('Full view'));
    await assertNo(page, 'This part hit a snag');
    await assertNo(page, 'Something glitched');

    await clickIncludes(page, 'Ride out an urge');
    await page.waitForFunction(() => document.body.innerText.includes("You're safe here") || document.body.innerText.includes('Something glitched'));
    await assertNo(page, 'Something glitched');
    await assertText(page, "You're safe here");
    await assertText(page, '0800 567 567');
    await assertText(page, '0800 456 789');
    await assertText(page, 'SADAG office, 8am–8pm');
    await assertText(page, '112');
    await shot(page, 'sos.png');
    await page.evaluate(() => {
      const link = document.querySelector('a[href="tel:0800456789"]');
      if (link) link.scrollIntoView({ block: 'center' });
    });
    await shot(page, 'sos-crisis.png');

    await clickIncludes(page, 'Surf an urge');
    await page.waitForFunction(() => document.body.innerText.includes('Start surfing the urge'));
    await clickIncludes(page, 'Start surfing the urge');
    await page.waitForFunction(() => document.body.innerText.includes("I'm okay now"));
    await assertText(page, 'Pause');
    const timerAtStart = await overlayValue(page, '.text-4xl.tabnum');
    await new Promise((resolve) => setTimeout(resolve, 1300));
    const timerAfter = await overlayValue(page, '.text-4xl.tabnum');
    if (!/^\d+:\d\d$/.test(timerAtStart) || timerAtStart === timerAfter) {
      fail('Urge timer did not run (' + timerAtStart + ' -> ' + timerAfter + ')');
    }
    await shot(page, 'urge-surf.png');

    await clickIncludes(page, 'Back');
    await page.waitForFunction(() => document.body.innerText.includes("You're safe here"));
    await clickIncludes(page, 'TIPP skills');
    await page.waitForFunction(() => document.body.innerText.includes('Temperature'));
    await assertText(page, 'Paced breathing');
    await assertText(page, 'Intense exercise');
    // Paced breathing starts open. Switch away and back so the exercise actually runs from a click.
    await clickIncludes(page, 'Temperature');
    await page.waitForFunction(() => document.body.innerText.includes('Cold water'));
    await clickIncludes(page, 'Paced breathing');
    await page.waitForFunction(() => document.body.innerText.includes('Breathe in'));
    const breathAtStart = await overlayValue(page, '.text-3xl.tabnum.text-brand');
    await new Promise((resolve) => setTimeout(resolve, 1300));
    const breathAfter = await overlayValue(page, '.text-3xl.tabnum.text-brand');
    if (!breathAtStart || breathAtStart === breathAfter) {
      fail('Breathing count did not run (' + breathAtStart + ' -> ' + breathAfter + ')');
    }
    await shot(page, 'tipp.png');

    await clickIncludes(page, 'Back');
    await page.waitForFunction(() => document.body.innerText.includes("You're safe here"));
    await clickIncludes(page, 'paced box breathing');
    await page.waitForFunction(() => document.body.innerText.includes('Breathe in'));
    const boxAtStart = await overlayValue(page, '.text-3xl.tabnum.text-brand');
    await new Promise((resolve) => setTimeout(resolve, 1300));
    const boxAfter = await overlayValue(page, '.text-3xl.tabnum.text-brand');
    if (!boxAtStart || boxAtStart === boxAfter) {
      fail('Box breathing did not run (' + boxAtStart + ' -> ' + boxAfter + ')');
    }
    await assertNo(page, 'Something glitched');
    await shot(page, 'breathing.png');

    await page.evaluate(() => {
      const close = document.querySelector('[aria-label="Close"]');
      if (close) close.click();
    });

    await page.waitForFunction(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.ready;
      return !!(reg && reg.active && navigator.serviceWorker.controller);
    }, { timeout: 15000 }).catch(async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => navigator.serviceWorker.controller, { timeout: 15000 });
    });

    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.innerText.includes('Today') || document.body.innerText.includes('The Anchor'), { timeout: 15000 });
    await assertNo(page, 'Something glitched');

    const openedOffline = await page.evaluate(() => {
      const sos = document.querySelector('[aria-label="SOS — cravings & distress help"]');
      if (!sos) return false;
      sos.click();
      return true;
    });
    if (!openedOffline) fail('SOS button missing while offline');
    await page.waitForFunction(() => document.body.innerText.includes("You're safe here"));
    await assertNo(page, 'Something glitched');
    await clickIncludes(page, 'Surf an urge');
    await page.waitForFunction(() => document.body.innerText.includes('Start surfing the urge'));
    await clickIncludes(page, 'Start surfing the urge');
    await page.waitForFunction(() => document.body.innerText.includes('Pause'));
    const offlineStart = await overlayValue(page, '.text-4xl.tabnum');
    await new Promise((resolve) => setTimeout(resolve, 1300));
    const offlineAfter = await overlayValue(page, '.text-4xl.tabnum');
    if (!/^\d+:\d\d$/.test(offlineStart) || offlineStart === offlineAfter) {
      fail('Offline urge timer did not run (' + offlineStart + ' -> ' + offlineAfter + ')');
    }
    await shot(page, 'offline-sos.png');

    assertClean();
    console.log('PASS', BASE);
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('FAIL');
  console.error(err && err.stack ? err.stack : err);
  if (errors.length) console.error(errors.join('\n'));
  process.exit(1);
});
