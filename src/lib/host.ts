/**
 * What this deployment tells the engine about itself.
 *
 * Three facts cqx-kit cannot work out from inside a package: how to make a
 * worker, where the wasm module is served, and which store of already-analysed
 * datasets to try first. Installed once, before anything asks.
 *
 * The threads are named so they are identifiable in a profile rather than
 * appearing as anonymous ones.
 */
import { install } from 'cqx-kit/engine';

export function installHost(): void {
  install({
    analyse: () =>
      new Worker(new URL('./analyse.worker.ts', import.meta.url), {
        type: 'module',
        name: 'cqx-analysis',
      }),
    read: (i) =>
      new Worker(new URL('./read.worker.ts', import.meta.url), {
        type: 'module',
        name: `cqx-reader-${i}`,
      }),
    wasm: new URL('/cqx.wasm', location.href).href,
    // Where explorer.deka.gg's published datasets live. A build may point
    // somewhere else; an empty value means read everything from source.
    store: import.meta.env.PUBLIC_CQX_STORE ?? 'https://cqxdata.deka.gg',
  });
}
