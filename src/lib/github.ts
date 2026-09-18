/**
 * Getting a repository's source into the browser.
 *
 * One request per commit, not one per file. GitHub allows sixty unauthenticated
 * requests an hour, and a workspace of three hundred files would spend that on
 * a single repository — so the tarball endpoint, gunzipped by the platform, and
 * a tar reader small enough to read in a sitting.
 *
 * Measured on deka: 1.5 MB compressed, 1.2s to fetch, 38ms to gunzip, 2ms to
 * unpack 703 entries.
 */

export interface SourceFile {
  path: string;
  content: string;
}

/** What is worth carrying: the manifests, the lockfile, and the code. */
export function isInteresting(path: string): boolean {
  return (
    path.endsWith('.rs') ||
    path.endsWith('/Cargo.toml') ||
    path.endsWith('/Cargo.lock')
  );
}

const BLOCK = 512;

/**
 * Reads a tar archive.
 *
 * Only what a source tarball contains: regular files and directories, with
 * GNU long names, which git produces for deeply nested paths.
 */
export function untar(buffer: Uint8Array): SourceFile[] {
  const decoder = new TextDecoder();
  const files: SourceFile[] = [];
  let offset = 0;
  let longName: string | null = null;

  const field = (header: Uint8Array, from: number, to: number): string =>
    decoder.decode(header.subarray(from, to)).replace(/\0.*$/, '').trim();

  while (offset + BLOCK <= buffer.length) {
    const header = buffer.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) break; // two zero blocks end an archive
    const name = longName ?? field(header, 0, 100);
    const size = parseInt(field(header, 124, 136), 8) || 0;
    const type = String.fromCharCode(header[156] ?? 0);
    offset += BLOCK;
    const body = buffer.subarray(offset, offset + size);
    offset += Math.ceil(size / BLOCK) * BLOCK; // records are padded

    if (type === 'L') {
      // GNU long name: the next header's name is this record's contents.
      longName = decoder.decode(body).replace(/\0.*$/, '');
      continue;
    }
    longName = null;
    if (type === '0' || type === '\0') {
      files.push({ path: name, content: decoder.decode(body) });
    }
  }
  return files;
}

/** Strips the single directory a GitHub tarball nests everything under. */
function stripPrefix(path: string): string {
  const cut = path.indexOf('/');
  return cut === -1 ? path : path.slice(cut + 1);
}

export interface FetchProgress {
  stage: 'fetching' | 'unpacking' | 'analysing';
  detail?: string;
}

/**
 * Fetches one commit of a repository as source files.
 *
 * `ref` may be a branch, a tag or a commit — the same endpoint serves all three,
 * which is what lets the time machine cost one request per commit.
 */
export async function fetchSource(
  repo: string,
  ref: string,
  onProgress?: (p: FetchProgress) => void,
): Promise<SourceFile[]> {
  onProgress?.({ stage: 'fetching', detail: repo });
  const response = await fetch(`https://api.github.com/repos/${repo}/tarball/${ref}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) {
    throw new Error(
      response.status === 403
        ? 'GitHub rate limit reached — sixty requests an hour without a token.'
        : `GitHub returned ${response.status} for ${repo}@${ref}`,
    );
  }

  onProgress?.({ stage: 'unpacking' });
  const gzipped = await response.arrayBuffer();
  const stream = new Blob([gzipped]).stream().pipeThrough(new DecompressionStream('gzip'));
  const tar = new Uint8Array(await new Response(stream).arrayBuffer());

  return untar(tar)
    .filter((f) => isInteresting(stripPrefix(f.path)))
    .map((f) => ({ ...f, path: stripPrefix(f.path) }));
}

/** The commits a time machine offers, newest first. */
export async function fetchCommits(repo: string, count: number): Promise<
  { sha: string; short: string; subject: string; author: string; date: string }[]
> {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/commits?per_page=${count}`,
    { headers: { Accept: 'application/vnd.github+json' } },
  );
  if (!response.ok) throw new Error(`GitHub returned ${response.status} listing commits`);
  const commits = (await response.json()) as {
    sha: string;
    commit: { message: string; author: { name: string; date: string } };
  }[];
  return commits.map((c) => ({
    sha: c.sha,
    short: c.sha.slice(0, 8),
    subject: c.commit.message.split('\n')[0] ?? '',
    author: c.commit.author.name,
    date: c.commit.author.date,
  }));
}
