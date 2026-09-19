// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  // Static output: the whole site is four files on a CDN, and the analysis runs
  // in the visitor's browser rather than on a server.
  output: 'static',
  build: {
    // Not the default `_astro`: hosts reserve underscore-prefixed paths for
    // their own use — Cloudflare Pages has _headers, _redirects and _worker.js —
    // and a bundle directory should not be arguing with them.
    assets: 'assets',
  },
  integrations: [react()],
  vite: {
    plugins: [tailwind()],
    // The wasm module is an asset, not a dependency to be bundled.
    assetsInclude: ['**/*.wasm'],
  },
});
