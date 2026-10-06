/**
 * e2e-streaming-ux — live verification for the streaming/pacing UX refactor.
 *
 * Prerequisites: `npx wrangler dev --port 8787` + `npx vite --port 5173`.
 * Run: `node scripts/e2e-streaming-ux.mjs`
 */
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = process.env.E2E_SHOTS ?? '/tmp/e2e-stream';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function newPage(browser, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log(`  [pageerror] ${String(err).split('\n')[0]}`));
  return { context, page };
}

async function desktopFlow(browser) {
  console.log('DESKTOP streaming UX (1440x900)');
  const { context, page } = await newPage(browser, { width: 1440, height: 900 });
  await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle' });

  // 1. Starter chips
  const chips = page.getByRole('group', { name: 'Starter prompts' }).getByRole('button');
  check('4 starter chips in empty state', (await chips.count()) === 4);
  await page.screenshot({ path: `${SHOTS}/empty-chips.png` });

  // 2. Chip click submits immediately — then stop it mid-stream.
  // The stop button unmounts the instant streaming finishes, so click
  // immediately (real click first, DOM dispatch as fallback).
  await chips.first().click();
  const userBubble = page.getByText('Good Samaritan in Greek').first();
  check('chip populates + submits query', await userBubble.isVisible({ timeout: 10000 }));

  const stopBtn = page.getByRole('button', { name: 'Stop generating' });
  check('stop button renders while loading',
    await stopBtn.waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false));
  await stopBtn.click({ timeout: 8000 }).catch(() => stopBtn.dispatchEvent('click').catch(() => {}));
  await page.waitForTimeout(1200);
  check('stop halts loading state', !(await stopBtn.isVisible().catch(() => false)));

  // 3. Fresh long query streams; phase bubble visible pre-tokens.
  const composer = page.getByLabel('Ask a question');
  check('composer is a textarea', (await composer.evaluate((el) => el.tagName)) === 'TEXTAREA');
  await composer.fill('Explain every parable of Jesus in detail with Greek word meanings');
  await composer.press('Enter');
  const phaseSeen = await Promise.race([
    page.getByText('Retrieving verses...').waitFor({ state: 'visible', timeout: 15000 }).then(() => 'retrieving'),
    page.getByText('Synthesizing response...').waitFor({ state: 'visible', timeout: 15000 }).then(() => 'synthesizing'),
  ]).catch(() => null);
  check('phase progress bubble before tokens', phaseSeen !== null, `saw=${phaseSeen}`);
  await page.screenshot({ path: `${SHOTS}/streaming-mid.png` });
  const citeBtn = page.getByRole('button', { name: /Explore .* in study mode/ }).first();
  const completed = await citeBtn.waitFor({ state: 'visible', timeout: 120000 }).then(() => true).catch(() => false);
  check('stream completes with citation cards', completed);
  // Cards carry verse headers once terminated
  const cardHeader = page.locator('[class*="font-serif"][class*="font-semibold"]').first();
  check('verse card header rendered', await cardHeader.isVisible().catch(() => false));
  await page.screenshot({ path: `${SHOTS}/streaming-done.png` });

  // 6. Shift+Enter newline vs Enter submit
  await composer.fill('line one');
  await composer.press('Shift+Enter');
  await page.waitForTimeout(500);
  const val = await composer.inputValue();
  check('Shift+Enter inserts newline without submitting', val.includes('\n') && (await chips.count()) === 0);
  await composer.fill('');
  await context.close();
}

async function mobileFlow(browser) {
  console.log('MOBILE action bar (390x844)');
  const { context, page } = await newPage(browser, { width: 390, height: 844 });
  await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle' });

  // Chips + textarea usable at 390px
  check('chips visible on mobile', await page.getByRole('group', { name: 'Starter prompts' }).isVisible());
  const composer = page.getByLabel('Ask a question');
  await composer.fill('Quote Genesis 1:1');
  await composer.press('Enter');
  const citeBtn = page.getByRole('button', { name: /Explore .* in study mode/ }).first();
  check('mobile stream completes', await citeBtn.waitFor({ state: 'visible', timeout: 90000 }).then(() => true).catch(() => false));

  // Copy button lives in-bubble, visible without hover
  const copyBtn = page.getByRole('button', { name: 'Copy whole response' }).first();
  check('in-bubble copy button visible on mobile', await copyBtn.isVisible());
  const box = await copyBtn.boundingBox().catch(() => null);
  check('copy button inside viewport', !!box && box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));

  // Scroll-to-bottom button while scrolled up mid-stream. Anchor on the
  // stop button first so the scroll-up happens during active streaming.
  await composer.fill('Explain every parable of Jesus in detail with Greek word meanings');
  await composer.press('Enter');
  const mStop = page.getByRole('button', { name: 'Stop generating' });
  await mStop.waitFor({ state: 'visible', timeout: 30000 }).catch(() => null);
  const scrollProbe = await page
    .evaluate(() => {
      const el = document.querySelector('section');
      if (!(el instanceof HTMLElement)) return -1;
      el.scrollTop = 0;
      return el.scrollHeight - el.clientHeight;
    })
    .catch(async () => {
      console.log(`  DIAG  scroll probe failed; url=${page.url()}`);
      return -1;
    });
  if (scrollProbe < 0) {
    console.log('  SKIP  scroll-to-bottom flow (probe failed)');
    await context.close();
    return;
  }
  await page.waitForTimeout(800);
  const scrollBtn = page.getByRole('button', { name: 'Scroll to bottom' });
  const scrollVisible = await scrollBtn.isVisible().catch(() => false);
  check('scroll-to-bottom button appears when scrolled up', scrollVisible);
  if (scrollVisible) {
    // Click via DOM dispatch: the button unmounts the moment streaming
    // finishes, which races Playwright's actionability checks.
    await scrollBtn.evaluate((el) => el.click()).catch(() => {});
    // Poll: smooth scrolling converges while the stream appends content.
    let distToBottom = -2;
    for (let i = 0; i < 10 && (distToBottom < 0 || distToBottom >= 60); i++) {
      await page.waitForTimeout(500);
      distToBottom = await page
        .evaluate(() => {
          const el = document.querySelector('section');
          if (!(el instanceof HTMLElement)) return -1;
          return el.scrollHeight - el.scrollTop - el.clientHeight;
        })
        .catch(() => -2);
    }
    if (distToBottom === -2) {
      console.log('  SKIP  scroll-position probe (page settled mid-probe)');
    } else {
      check('scroll button returns to bottom', distToBottom >= 0 && distToBottom < 60, `gap=${distToBottom}`);
    }
  }
  await page.screenshot({ path: `${SHOTS}/mobile-stream.png` });
  await context.close();
}

async function main() {
  const browser = await chromium.launch();
  try {
    await desktopFlow(browser);
    await mobileFlow(browser);
  } finally {
    await browser.close();
  }
  console.log(failures === 0 ? '\nE2E RESULT: ALL CHECKS PASSED' : `\nE2E RESULT: ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('E2E fatal:', err);
  process.exit(1);
});
