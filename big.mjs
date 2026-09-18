import { chromium } from 'playwright';
const b = await chromium.launch(); const p = await (await b.newContext()).newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,110)));
p.on('console', m => m.type()==='error' && errs.push('console: '+m.text().slice(0,110)));
let cdn=0, fails=0, bytes=0;
p.on('response', async r => { if (r.url().startsWith('https://raw.')) { cdn++; if(!r.ok()) fails++;
  try { bytes += (await r.body()).length; } catch {} } });
const t0=Date.now();
await p.goto('https://explorer.deka.gg/makepad/makepad',{waitUntil:'commit'});
// settled = a report, or a failure that is not the pre-hydration placeholder
const settled = () => p.waitForFunction(() => {
  if (document.querySelectorAll('section.cat').length) return true;
  const e = document.querySelector('main .empty');
  if (!e || e.classList.contains('waiting-room')) return false;
  return !e.textContent.includes('Nothing to open');
}, null, { timeout: 900000 });
let last='';
const tick = setInterval(async () => {
  try {
    const s = await p.evaluate(() => {
      const ph=[...document.querySelectorAll('.phase')].map(x=>`${x.querySelector('.lb')?.textContent}:${x.className.replace('phase ','')}`);
      const dt=[...document.querySelectorAll('.phase .dt')].map(x=>x.textContent).join(' ');
      return ph.length ? `${ph.join(' | ')}  ${dt}` : null; });
    if (s && s!==last) { console.log(`  ${String(((Date.now()-t0)/1000).toFixed(0)).padStart(4)}s  ${s}`); last=s; }
  } catch {}
}, 3000);
try {
  await settled(); clearInterval(tick);
  const done=((Date.now()-t0)/1000).toFixed(1);
  if (await p.$('section.cat')) {
    console.log(`  FINISHED in ${done}s · ${cdn} files (${fails} failed) · ${(bytes/1e6).toFixed(1)} MB fetched`);
    console.log('  header:', (await p.textContent('.tot')).trim().replace(/\s+/g,' '));
    console.log('  hover :', await p.$eval('.tot b:last-of-type', e=>e.getAttribute('title')));
    console.log('  levels:', await p.$$eval('.rail:not(.tm) button', e=>e.map(x=>x.textContent.replace(/\s+/g,' ')).join(' | ')));
  } else console.log(`  FAILED after ${done}s:`, (await p.textContent('main')).trim().replace(/\s+/g,' ').slice(0,140));
} catch { clearInterval(tick); console.log('  TIMED OUT ·', cdn, 'files fetched'); }
console.log('  errors:', errs.length?errs.slice(0,3):'none');
await b.close();
