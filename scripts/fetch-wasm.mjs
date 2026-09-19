/**
 * Puts the cqx wasm module where the page can load it.
 *
 * It is code rather than data, so it belongs beside the app: same origin, no
 * CORS to negotiate, and versioned with the deployment. It cannot be fetched
 * from its release at run time — GitHub serves release assets without CORS
 * headers, the same reason the explorer cannot read a tarball.
 *
 * Downloaded here instead of committed, because 2.4 MB of build output in a
 * source tree is 2.4 MB in every clone and every diff for the life of the
 * repository. The bytes are checked against the release's own SHA256SUMS, so a
 * build is reproducible and a substituted artefact fails loudly.
 *
 * Which version is `cqx-kit`'s to say. It was pinned here as well until the
 * kit existed, and two places that must agree about a version are two places
 * that can disagree about one — the shapes this page reads are the shapes that
 * module writes, so whoever owns the shapes owns the module.
 */

import { CQX_VERSION as version } from 'cqx-kit/engine';

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'public', 'cqx.wasm');

const release = `https://github.com/samifouad/cqx/releases/download/${version}`;

async function get(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${url} → ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const [wasm, sums] = await Promise.all([
  get(`${release}/cqx_wasm.wasm`),
  get(`${release}/SHA256SUMS`).then((b) => b.toString('utf8')),
]);

const expected = sums
  .split('\n')
  .map((line) => line.trim().split(/\s+/))
  .find(([, name]) => name === 'cqx_wasm.wasm')?.[0];
if (!expected) throw new Error(`${version} publishes no checksum for cqx_wasm.wasm`);

const actual = createHash('sha256').update(wasm).digest('hex');
if (actual !== expected) {
  throw new Error(`cqx_wasm.wasm does not match its published checksum\n  want ${expected}\n  got  ${actual}`);
}

await mkdir(dirname(target), { recursive: true });
await writeFile(target, wasm);
console.log(`cqx ${version} · ${(wasm.length / 1e6).toFixed(2)} MB · sha256 ok → public/cqx.wasm`);
