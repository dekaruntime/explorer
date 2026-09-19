/**
 * The palette, against a real repository.
 *
 * The ranker is tested on its own in `rank.mjs`, where what is loaded is known
 * and the orderings can be asserted exactly. This one asks the other question:
 * that it is wired to the dataset, that choosing a result arrives somewhere
 * that shows it, and that the address it leaves behind is real.
 *
 * Nothing here names a symbol. Which types dsc declares is not this test's
 * business and changes under it, so every query is built from what the loaded
 * dataset actually offered.
 *
 *   npx wrangler dev --port 4400        # the built site, with its fallback
 *   node tests/search.mjs
 *
 * Against wrangler rather than `astro dev`: every address here is a path that
 * is not a file, and only the worker's single-page fallback serves those.
 */
import { chromium } from 'playwright';

const BASE = process.env.CQX_BASE ?? 'http://localhost:4400';
const REPO = process.env.CQX_REPO ?? 'dekaruntime/dsc';
let failed = 0;
const fail = (m) => { failed++; console.error('FAIL: ' + m); };
const ok = (m) => console.log('  ok  ' + m);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => fail('page error: ' + e.message));

await page.goto(`${BASE}/${REPO}`, { waitUntil: 'domcontentloaded' });

// The totals line stops saying zero once there is a dataset behind it. Two
// minutes because a repository the store has no CORS grant for — localhost,
// normally — is read and analysed in the browser instead.
await page.waitForFunction(
  () => (document.querySelector('.tot b')?.textContent ?? '0') !== '0',
  null,
  { timeout: 180_000 },
);
ok(`loaded — ${(await page.locator('.tot').innerText()).replace(/\s+/g, ' ')}`);

if ((await page.locator('.sbtn').count()) !== 1) fail('no search button after load');
else ok('search button present');

await page.keyboard.press('ControlOrMeta+k');
await page.waitForSelector('.palette', { timeout: 3000 });
ok('meta+k opened the palette');

// Before anything is typed: a starting point rather than a blank box.
const opening = await page.locator('.phit').count();
if (opening === 0) fail('empty palette shows nothing');
else ok(`empty palette offers ${opening} starting points`);
ok('counts: ' + (await page.locator('.pfoot .cts').innerText()).replace(/\s+/g, ' '));

// A name this dataset really contains, taken from a row the palette drew.
const target = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.phit')];
  const row = rows.find((r) => r.querySelector('.sk')?.textContent === 'type') ?? rows[0];
  return row?.querySelector('.nm')?.textContent ?? null;
});
if (!target) { fail('could not read a name out of the palette'); }
else ok(`working with "${target}"`);

// Typed in full, it is the exact match, and an exact match leads.
await page.fill('.pq input', target);
await page.waitForTimeout(150);
let hits = await page.locator('.phit .nm').allInnerTexts();
if (hits[0] !== target) fail(`exact match did not lead: got "${hits[0]}"`);
else ok(`exact match leads (${hits.length} hits)`);

// Typed as a prefix, it is still there.
const prefix = target.slice(0, Math.max(3, Math.min(6, target.length - 1)));
await page.fill('.pq input', prefix);
await page.waitForTimeout(150);
hits = await page.locator('.phit .nm').allInnerTexts();
if (!hits.includes(target)) fail(`"${prefix}" lost "${target}" — got ${hits.slice(0, 5).join(', ')}`);
else ok(`"${prefix}" → ${hits.length} hits, ${target} at ${hits.indexOf(target) + 1}`);

// Every hit for a prefix must contain it. Anything else is the scattered tier
// answering a question nobody asked, which is what it used to do.
const stray = hits.filter((h) => !h.toLowerCase().includes(prefix.toLowerCase()));
if (stray.length > hits.length / 2) fail(`mostly loose matches: ${stray.slice(0, 3).join(', ')}`);
else ok(`${hits.length - stray.length} of ${hits.length} contain "${prefix}" outright`);

// Back to the exact query, and take it.
await page.fill('.pq input', target);
await page.waitForTimeout(150);
await page.keyboard.press('Enter');
await page.waitForTimeout(700);

if ((await page.locator('.palette').count()) !== 0) fail('palette stayed open after Enter');
else ok('palette closed');

const url = page.url();
if (!url.includes('#')) fail(`no fragment in ${url}`);
else ok(`address carries the symbol: ${decodeURIComponent(url.replace(BASE, ''))}`);

if ((await page.locator('.found').count()) === 0) fail('nothing marked on the destination');
else ok('marked on arrival');

// Pinned, not scrolled to: the row may be four thousandth by use in a list
// that renders a hundred and twenty, and scrolling cannot reach what was
// never drawn.
const firstIsFound = await page.evaluate(() =>
  (document.querySelectorAll('tbody tr, .sig')[0]?.classList.contains('found')) ?? false);
if (!firstIsFound) fail('the found row is not first');
else ok('found row pinned to the top');

// The fragment is state, not decoration.
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.found').length > 0, null, { timeout: 180_000 });
ok('reloading the address restores the focus');

// And it belongs to the thing that asked for it.
await page.click('.lvl:has-text("Packages")');
await page.waitForTimeout(400);
if (page.url().includes('#')) fail(`fragment survived a move: ${page.url()}`);
else ok('moving elevation clears the fragment');

await page.keyboard.press('/');
await page.waitForSelector('.palette', { timeout: 3000 });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
if ((await page.locator('.palette').count()) !== 0) fail('escape did not close');
else ok('slash opens, escape closes');

await browser.close();
console.log(failed ? `\n${failed} failed` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
