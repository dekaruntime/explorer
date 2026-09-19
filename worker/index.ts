import { answer, type Store } from 'cqx-kit/gh';

/**
 * The only server in this deployment, and it does one thing.
 *
 * Three calls to GitHub are metered — which commits a repository has, which
 * files a commit has, and which releases exist — and sixty an hour per
 * address is enough for a person to exhaust by exploring. Everything
 * expensive is not metered: file contents come from a CDN straight to the
 * browser and never pass through here.
 *
 * What it actually does lives in `cqx-kit/gh`, because cqx.bio answers the
 * same three from a Next route handler and the two must not drift — they are
 * read by the same engine and cache into the same bucket. What is left here
 * is this deployment's own half: which bindings, and that everything else is
 * the site.
 */
interface Env {
  ASSETS: Fetcher;
  /** The bucket the datasets live in, so what is learned about a repository
   *  sits beside what was measured of it. */
  CACHE: R2Bucket;
  /** A fine-grained token with read access to public repositories, and
   *  nothing else. Set with `wrangler secret put GITHUB_TOKEN`; never in the
   *  bundle. Optional — the shared cache is what makes its absence bearable. */
  GITHUB_TOKEN?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await answer(request, {
      // An R2 bucket satisfies the proxy's structural store; it does not need
      // to know what R2 is.
      store: env.CACHE as unknown as Store,
      token: env.GITHUB_TOKEN,
    });
    // Null means the path was not one of ours. Everything else is the site.
    return response ?? env.ASSETS.fetch(request);
  },
};
