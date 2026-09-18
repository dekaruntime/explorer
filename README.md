# cqx-web

The web explorer for [cqx](https://github.com/samifouad/cqx): a CodeQuality Score
and a navigable map of a codebase.

Astro with React islands and TypeScript. Static output — the whole site is a few
files on a CDN, and the analysis runs in the visitor's browser rather than on a
server.

## Why these choices

**Islands, not a single page application.** The shell is static HTML; only the
explorer hydrates. It is also the model deka uses, so moving this onto deka later
is mostly moving files.

**The dataset is fetched, not inlined.** Inlining it put 890KB of JSON into the
document. As an asset it caches separately, and it is the same path a repository
analysed live will take.

**One request per commit.** GitHub allows sixty unauthenticated requests an hour,
so fetching three hundred files individually is not an option. `lib/github.ts`
pulls a tarball, gunzips it with the platform's own `DecompressionStream` and
unpacks it — measured on deka at 1.5MB compressed, 1.2s to fetch, 38ms to
decompress and 2ms to unpack 703 entries.

**No bindgen.** `lib/cqx.ts` is the whole of the glue to the wasm module: four
exported functions and a length-prefixed buffer.

## Layout

```
src/
  components/         the explorer and its six elevations
  lib/cqx.ts          calling the wasm analysis
  lib/github.ts       fetching and unpacking a repository
  lib/types.ts        the shapes cqx emits
  styles/theme.css    deka.gg's palette
public/data/          pre-analysed datasets, so first paint needs no network
```

## Developing

```
npm install
npm run dev
npm run check      # astro check + tsc --noEmit
npm run build
```

## Licence

Apache-2.0.

## Deploying

Cloudflare Pages builds this on a push to `main`, the same way
`samifouad/website` is set up — the git integration, not a workflow, so there is
no deploy token in this repository.

Pages project settings:

| | |
|---|---|
| build command | `npm run build` |
| output directory | `dist` |
| node version | 22 |

`public/_headers` handles caching: assets carry a content hash and are immutable,
a dataset keeps its name when re-analysed so it is revalidated.

CI here typechecks and builds every pull request. Pages builds `main` regardless,
so the point is to catch a break before it has already deployed.
