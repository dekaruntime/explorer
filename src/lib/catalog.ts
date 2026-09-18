/**
 * What this deployment has to show.
 *
 * The explorer knows how to render a report; it does not know whose. Which
 * repositories exist is content, not code — a manifest beside the data, written
 * by whoever built the deployment. That is what lets the same build serve
 * explorer.deka.gg and a report a developer generated of their own repository
 * five minutes ago.
 */

export interface CatalogEntry {
  /** `owner/name`, as the host spells it. */
  repo: string;
  /** The dataset file, without extension, relative to `data/`. */
  file: string;
}

export interface Catalog {
  entries: CatalogEntry[];
  /** Which repository to open with; the first entry when unstated. */
  default: string | null;
}

/** A single report with no manifest is the shape a CLI would write. */
const LONE_REPORT = 'report';

const EMPTY: Catalog = { entries: [], default: null };

export async function loadCatalog(): Promise<Catalog> {
  try {
    const response = await fetch('/data/index.json');
    // A single-page-application fallback answers an unmatched path with the page
    // itself, so a missing manifest is 200 with HTML. Content type is what tells
    // the difference.
    if (response.ok && (response.headers.get('content-type') ?? '').includes('json')) {
      const raw = (await response.json()) as Partial<Catalog> & { datasets?: CatalogEntry[] };
      const entries = raw.entries ?? raw.datasets ?? [];
      if (entries.length > 0) {
        return { entries, default: raw.default ?? entries[0]!.repo };
      }
    }
  } catch {
    // No manifest is not an error: a lone report is a valid deployment.
  }

  // Fall back to one unnamed report, so `cqx report` need only write a file.
  try {
    const response = await fetch(`/data/${LONE_REPORT}.json`);
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) {
      return EMPTY;
    }
    const report = (await response.json()) as { repo?: string };
    const repo = report.repo ?? LONE_REPORT;
    return { entries: [{ repo, file: LONE_REPORT }], default: repo };
  } catch {
    return EMPTY;
  }
}

export const fileFor = (catalog: Catalog, repo: string): string | null =>
  catalog.entries.find((e) => e.repo === repo)?.file ?? null;
