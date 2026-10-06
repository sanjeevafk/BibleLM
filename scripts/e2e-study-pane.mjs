/**
 * e2e-study-pane — live end-to-end verification for the Side-by-Side
 * Study Pane against a running dev stack:
 *
 *   1. `npx wrangler dev --port 8787`   (worker API; optional for study pane)
 *   2. `npx vite --port 5173`           (serves UI + public/data static assets)
 *   3. `node scripts/e2e-study-pane.mjs`
 *
 * Covers: deep-link open, pericope map, parallel columns, interlinear
 * tooltip, pericope click-to-scroll, chapter navigation, translation
 * switch, mobile drawer, and the chat "Study" citation button (best-effort;
 * skipped if the chat backend is unreachable).
 */
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = process.env.E2E_SHOTS ?? '/tmp/e2e-study';

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
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
  console.log('DESKTOP (1440x900)');
  const { context, page } = await newPage(browser, { width: 1440, height: 900 });

  await page.goto(`${BASE}/chat?study=LUK.10.25&pericope=parable-good-samaritan`, { waitUntil: 'networkidle' });

  const pane = page.getByRole('complementary', { name: 'Side-by-side study pane' });
  check('study pane opens from ?study= deep-link', await pane.isVisible());

  const header = pane.getByText('LUK 10', { exact: false });
  check('pane header shows LUK 10', await header.first().isVisible());

  const map = pane.locator('[aria-label="Chapter pericope story map"]');
  check('pericope story map renders', await map.isVisible());
  const samaritan = map.getByRole('listitem', { name: /Good Samaritan/ });
  check('Good Samaritan segment present', await samaritan.isVisible());
  check('active pericope marked selected', (await samaritan.getAttribute('aria-pressed')) === 'true');

  // Focused citation verse is highlighted and scrolled into view.
  const verse25 = pane.locator('[data-verse="25"]');
  await verse25.scrollIntoViewIfNeeded();
  const verseText = (await verse25.innerText()).slice(0, 200);
  check('verse 25 primary text (BSB)', /expert in the law/i.test(verseText), verseText.slice(0, 80));
  check('verse 25 comparison text (KJV)', /lawyer/i.test(verseText), verseText.slice(0, 80));
  check('verse 25 marked current', (await verse25.getAttribute('aria-current')) === 'true');

  // Interlinear Greek tokens with Strong's tooltip.
  const tokens = verse25.locator('button[aria-label*="G"]');
  const tokenCount = await tokens.count();
  check('interlinear Greek tokens rendered', tokenCount > 5, `count=${tokenCount}`);
  await tokens.first().click();
  const dialog = pane.getByRole('dialog').first();
  check('Strong\'s tooltip opens', await dialog.isVisible());
  const dialogText = await dialog.innerText();
  check('tooltip shows Strong\'s + definition', /G\d+/.test(dialogText) && dialogText.length > 20, dialogText.slice(0, 100));
  await page.keyboard.press('Escape');
  check('Escape dismisses tooltip but keeps pane open',
    !(await dialog.isVisible().catch(() => false)) && await pane.isVisible());

  // Pericope click scrolls to that passage.
  await map.getByRole('listitem', { name: /Martha/i }).click().catch(() => {});
  const marthaVisible = await pane.locator('[data-verse="38"]').isVisible().catch(() => false);
  check('pericope click navigates grid (v38 visible)', marthaVisible);
  await page.screenshot({ path: `${SHOTS}/desktop-pane.png` });

  // Chapter navigation.
  await pane.getByRole('button', { name: 'Next chapter' }).click();
  check('next chapter navigates to LUK 11', await pane.getByText('LUK 11').first().isVisible({ timeout: 15000 }));
  const v1 = await pane.locator('[data-verse="1"]').innerText().catch(() => '');
  check('LUK 11:1 text loads', v1.length > 20, v1.slice(0, 80));

  // Translation switch updates the comparison column.
  await pane.getByLabel('Comparison translation').selectOption('WEB');
  await page.waitForTimeout(1500);
  const v1After = await pane.locator('[data-verse="1"]').innerText();
  check('comparison column label switches to WEB', /WEB/.test(v1After), v1After.slice(0, 120));

  // URL stays shareable.
  check('URL keeps ?study= param', /study=LUK\.11\.1/.test(page.url()), page.url());
  await page.screenshot({ path: `${SHOTS}/desktop-luk11.png` });

  // Close button dismisses the pane and clears params.
  await pane.getByRole('button', { name: 'Close study pane' }).click();
  check('pane closes', !(await pane.isVisible().catch(() => false)));
  check('URL params cleared on close', !page.url().includes('study='), page.url());

  await context.close();
}

async function mobileFlow(browser) {
  console.log('MOBILE DRAWER (700x844, drawer mode <1024px)');
  const { context, page } = await newPage(browser, { width: 700, height: 844 });
  await page.goto(`${BASE}/chat?study=GEN.1.1`, { waitUntil: 'networkidle' });

  const dialog = page.getByRole('dialog', { name: 'Side-by-side study pane' });
  check('drawer opens as modal dialog', await dialog.isVisible());
  check('drawer header shows GEN 1', await dialog.getByText('GEN 1').first().isVisible());

  const verse1 = dialog.locator('[data-verse="1"]');
  const text = await verse1.innerText().catch(() => '');
  check('GEN 1:1 text + Hebrew tokens', /beginning/i.test(text), text.slice(0, 100));
  const hebTokens = await verse1.locator('button[aria-label*="H"]').count().catch(() => 0);
  check('Hebrew interlinear tokens (H-numbers)', hebTokens > 2, `count=${hebTokens}`);
  await page.screenshot({ path: `${SHOTS}/mobile-drawer.png` });

  // Backdrop tap closes (drawer is 440px, so x=20 hits the backdrop).
  await page.mouse.click(20, 420);
  check('backdrop tap closes drawer', !(await dialog.isVisible().catch(() => false)));

  // Full-width phone screenshot for the record.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/chat?study=LUK.10.25`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/mobile-390.png` });
  await context.close();
}

async function chatCitationFlow(browser) {
  console.log('CHAT CITATION BUTTON (best-effort)');
  const { context, page } = await newPage(browser, { width: 1440, height: 900 });
  await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle' });

  const input = page.getByPlaceholder('Ask a question...');
  await input.fill('Quote Luke 10:25-28');
  await page.getByRole('button', { name: 'Send message' }).click();

  const studyBtn = page.getByRole('button', { name: /Explore .* in study mode/ }).first();
  // NB: isVisible() does not auto-wait — use an explicit wait instead.
  const appeared = await studyBtn.waitFor({ state: 'visible', timeout: 90000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) {
    console.log('  SKIP  chat backend unreachable — citation button not exercised');
    await context.close();
    return;
  }
  check('Study button appears on citation card', true);
  const label = await studyBtn.getAttribute('aria-label');
  await studyBtn.click();
  const pane = page.getByRole('complementary', { name: 'Side-by-side study pane' });
  check(`citation opens study pane (${label})`, await pane.isVisible({ timeout: 15000 }));
  check('URL deep-link set from citation', /study=/.test(page.url()), page.url());
  await page.screenshot({ path: `${SHOTS}/desktop-from-chat.png` });
  await context.close();
}

async function main() {
  const browser = await chromium.launch();
  try {
    await desktopFlow(browser);
    await mobileFlow(browser);
    await chatCitationFlow(browser);
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
