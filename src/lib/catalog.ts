/**
 * Which repositories this deployment opens with.
 *
 * The explorer knows how to render a repository; it does not know whose. The
 * list is content, not code — a manifest beside the data, written by whoever
 * built the deployment — which is what lets one build serve explorer.deka.gg
 * and a directory a developer exported of their own repository five minutes
 * ago. Anything not listed is still reachable by typing its address.
 */

export interface Catalog {
  /** `owner/name`, as the host spells it. */
  entries: { repo: string }[];
  /** Which to open with; the first entry when unstated. */
  default: string | null;
}

const EMPTY: Catalog = { entries: [], default: null };

export async function loadCatalog(): Promise<Catalog> {
  try {
    const response = await fetch('/data/index.json');
    // An unmatched path is answered with the page itself, so a missing manifest
    // is 200 with HTML. Content type is what tells the difference.
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) {
      return EMPTY;
    }
    const raw = (await response.json()) as Partial<Catalog>;
    const entries = (raw.entries ?? []).filter((e) => e && typeof e.repo === 'string');
    if (entries.length === 0) return EMPTY;
    return { entries, default: raw.default ?? entries[0]!.repo };
  } catch {
    return EMPTY;
  }
}
