/**
 * Which repositories this deployment opens with.
 *
 * The explorer knows how to render a repository; it does not know whose. The
 * list is content, not code — a manifest beside the data, written by whoever
 * built the deployment — which is what lets one build serve explorer.deka.gg
 * and a directory a developer exported of their own repository five minutes
 * ago. Anything not listed is still reachable by typing its address.
 */

/** Whose deployment this is. Absent leaves the header unbranded. */
export interface Brand {
  /** What the mark is called: its alt text, and the mark itself without one. */
  name: string;
  /** A square image, served by this deployment. */
  icon?: string;
  /** Where the mark links to. */
  href?: string;
}

export interface Catalog {
  /** `owner/name`, as the host spells it. */
  entries: { repo: string }[];
  /** Which to open with; the first entry when unstated. */
  default: string | null;
  /**
   * Whose deployment this is. Declared rather than built in, for the same
   * reason the repository list is: one build serves explorer.deka.gg and a
   * directory somebody exported of their own repository, and only one of those
   * is deka's.
   */
  brand: Brand | null;
  /**
   * Datasets this deployment serves itself, as a base path — what
   * `cqx export --out public/data` produces. Absent means it serves none, and
   * the shared store answers for everything. A deployment with no manifest at
   * all is a different case: nothing has said either way, so `data/` is tried.
   */
  store: string | null;
}

/** No manifest: nothing has been declared, so look locally before giving up. */
const UNDECLARED: Catalog = { entries: [], default: null, store: '/data', brand: null };

export async function loadCatalog(): Promise<Catalog> {
  try {
    const response = await fetch('/data/index.json');
    // An unmatched path is answered with the page itself, so a missing manifest
    // is 200 with HTML. Content type is what tells the difference.
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) {
      return UNDECLARED;
    }
    const raw = (await response.json()) as Partial<Catalog>;
    const entries = (raw.entries ?? []).filter((e) => e && typeof e.repo === 'string');
    return {
      entries,
      default: raw.default ?? entries[0]?.repo ?? null,
      store: raw.store ?? null,
      brand: raw.brand ?? null,
    };
  } catch {
    return UNDECLARED;
  }
}
