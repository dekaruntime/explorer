import { Explorer } from 'cqx-kit/ui';

/**
 * This deployment's half of the explorer.
 *
 * The explorer is cqx-kit's — its layout, its elevations, how the menu
 * behaves on a phone. Two deployments that disagree about any of that are
 * two tools, so none of it is decided here.
 *
 * What is decided here is what it looks like, in `styles/theme.css`, and how
 * to reach things: which worker, where the wasm is served from, which store
 * of published datasets to try. Only this deployment can answer those, and
 * `new URL('./analyse.worker.ts', import.meta.url)` in particular is a
 * literal Vite rewrites at build time — no bundler can rewrite one that
 * lives inside a dependency, which is why the two entry files stay here and
 * the bodies come from the package.
 */
export function DekaExplorer() {
  return (
    <Explorer
      host={() => ({
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
        store: import.meta.env.PUBLIC_CQX_STORE ?? 'https://cqxdata.deka.gg',
      })}
    />
  );
}
