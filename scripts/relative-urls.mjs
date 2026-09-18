/**
 * Rewrites the built page's absolute asset URLs to relative ones.
 *
 * Astro emits `/assets/…`, which is correct only when the site owns the root of
 * its origin. Served from a subpath — a preview, a pull-request deployment, a
 * documentation site mounted under a path — every one of them is a 404, and the
 * page renders as unstyled markup with no data.
 *
 * Relative URLs are correct in both cases, so there is no reason to prefer the
 * absolute ones — but they must be written `./assets/…` rather than `assets/…`.
 * Astro hydrates an island with `import(component-url)`, and a specifier with no
 * leading `./` is a bare specifier: the browser looks for a package by that name
 * and the island never hydrates. The page still styles itself, which is what
 * makes it easy to miss.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';

function pages(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name.endsWith('.html') ? [path] : [];
  });
}

let rewritten = 0;
for (const page of pages(dist)) {
  const before = readFileSync(page, 'utf8');
  // Depth of this page below dist decides how far back relative URLs reach.
  const depth = page.split('/').length - 2;
  const prefix = depth > 0 ? '../'.repeat(depth) : './';
  const after = before.replace(/(["'(])\/(assets|data)\//g, `$1${prefix}$2/`);
  if (after !== before) {
    writeFileSync(page, after);
    rewritten++;
  }
}
console.log(`relative-urls: rewrote ${rewritten} page(s)`);
