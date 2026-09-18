/**
 * The analysis, off the main thread — and, for a large repository, off several.
 *
 * Parsing takes seconds of solid CPU — seven of them for deno, a hundred and
 * thirty nine for makepad — and on the main thread that is a frozen tab: the
 * progress bar stops at the moment it has the most to report.
 *
 * The fetching moved here too, rather than only the wasm call. It keeps the
 * whole pipeline in one place, and it means the file contents are never copied
 * across a postMessage boundary — a few megabytes of source that would other-
 * wise be cloned twice.
 *
 * Beyond a few thousand files one thread stops being enough, for two reasons
 * and not one. It is slow, and it is also close to the four gigabytes wasm32
 * can address at all: makepad peaks at 2,962 MB in a single instance, and the
 * failure when it runs out is not a message but a pointer into unmapped memory.
 * Past a threshold this thread stops reading and starts coordinating — it reads
 * the manifests, divides the sources, and merges what the readers found — while
 * the reading happens in several instances, each in its own address space.
 *
 * A finished dataset is kept, for the same reason its files are: it is named by
 * a commit and a commit does not change, so it can never be stale.
 */

import { Analysis } from './cqx';
import { fetchSource, fetchTree, type SourceFile, type Tree, type TreeEntry } from './github';
import type { ReaderIn, ReaderOut } from './read.worker';

export interface Request {
  repo: string;
  /** The full sha, which is what the CDN addresses a file by. */
  sha: string;
  /** Where to load the module from; the worker has no notion of the page. */
  wasm: string;
  /**
   * How many readers to use, when the page has been told to insist.
   *
   * Left alone the number comes from the size of the repository and the size
   * of the machine. `?readers=n` overrides it, which is how the two paths get
   * compared on the same commit.
   */
  readers?: number;
}

export type Reply =
  | {
      type: 'stage';
      phase: 'listing' | 'fetching' | 'analysing';
      done: number;
      total: number;
      cached: number;
      /** What is happening when there is no count to give: "merging", "folding". */
      note?: string;
    }
  /** Asking the page for reader threads: a worker cannot be sure it may start one. */
  | { type: 'want'; readers: number }
  | ({ type: 'done' } & Measured)
  | { type: 'error'; message: string };

/** What the page sends: the request, or the threads it was asked for. */
type Incoming = Request | { type: 'readers'; ports: MessagePort[] };

const post = (reply: Reply) => self.postMessage(reply);

/** Bumped when the shape changes, so an old dataset is not read as a new one. */
/**
 * v2 because v1 may hold datasets built while every file in a repository
 * carried the first file's contents — a tree whose entries named their blob
 * `blob` rather than `sha` gave them all one cache key. Those datasets are
 * wrong and cannot be told apart from right ones, so the whole store is left
 * behind rather than trusted.
 */
const DATASETS = 'cqx-datasets-v2';

/** A commit, and the version of cqx that read it. */
const key = (repo: string, sha: string) => `https://cqx.invalid/dataset/${repo}/${sha}`;

async function remembered(repo: string, sha: string): Promise<Reply | null> {
  try {
    const hit = await (await caches.open(DATASETS)).match(key(repo, sha));
    if (!hit) return null;
    const out = (await hit.json()) as Measured;
    return { type: 'done', ...out, fetch: out.fetch ?? 0, readers: out.readers ?? 1, held: out.held ?? 0 };
  } catch {
    // Private windows, blocked storage, a cache that misbehaves: analyse it.
    return null;
  }
}

async function remember(repo: string, sha: string, out: Measured) {
  try {
    await (await caches.open(DATASETS)).put(
      key(repo, sha),
      new Response(JSON.stringify(out), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  } catch {
    // Storage full or unavailable. Nothing here depends on it.
  }
}

/** What a run cost, whichever way it was read. */
interface Measured {
  json: string;
  /** Milliseconds of analysis: everything after the source was in hand. */
  ms: number;
  /** Milliseconds spent getting it there. */
  fetch: number;
  readers: number;
  /** The most linear memory any one reader took. */
  held: number;
  /** What the coordinator itself took, which the fold decides. */
  folding?: number;
  /**
   * Where the analysis went, in milliseconds.
   *
   * The parse divides between the readers; everything after it happens once,
   * here, and is what a fifth reader would not help with.
   */
  steps?: Record<string, number>;
}

/**
 * Where one thread stops being enough.
 *
 * Below this a single reader finishes in about a second and the second thread
 * would spend longer starting than it saved: four instances of a two-megabyte
 * module, a round trip to the page for the threads, and a merge over facts that
 * would not have needed merging. deka is three hundred files and takes 0.7s.
 * makepad is six thousand and takes over two minutes.
 */
const DIVIDE_ABOVE = 1200;

/**
 * How many readers, given the machine.
 *
 * Bounded by cores, because more readers than cores is the same work with more
 * overhead, and bounded by memory, because the readers' peaks are concurrent:
 * makepad's four readers hold about 700 MB each. A machine that reports four
 * gigabytes gets two of them rather than an out-of-memory error.
 */
function howMany(sources: number): number {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency || 4;
  // Browsers round this down and stop reporting at eight, so eight means
  // "eight or more" and four means "four, or a browser being coy".
  const gb = nav.deviceMemory ?? 8;
  const byMemory = gb <= 2 ? 2 : gb <= 4 ? 3 : 4;
  // One file per reader is not a division of labour.
  const useful = Math.max(1, Math.floor(sources / 400));
  // Four, and not more. Eight readers finish makepad in 10.8 seconds against
  // four readers' 11.6, which is not worth four more threads: the parse stopped
  // dividing cleanly well before the thread count ran out. Where eight does win
  // is memory — 583 MB against 860 — and at 860 there is no longer a ceiling
  // worth buying headroom against.
  return Math.max(2, Math.min(byMemory, cores - 1, useful));
}

/** Contiguous slices, so that merging them in order is reading in order. */
function divide<T>(items: T[], ways: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ways; i++) {
    out.push(items.slice(Math.floor((i * items.length) / ways), Math.floor(((i + 1) * items.length) / ways)));
  }
  return out;
}

/** The threads the page was asked for, once it has made them. */
let granted: ((ports: MessagePort[]) => void) | null = null;
function borrow(readers: number): Promise<MessagePort[]> {
  return new Promise((resolve) => {
    granted = resolve;
    post({ type: 'want', readers });
  });
}

/** One reader, seen from here. */
class Reader {
  fetched = 0;
  total = 0;
  cached = 0;
  parseTotal = 0;
  parsed = 0;
  done = false;

  constructor(
    readonly port: MessagePort,
    readonly files: TreeEntry[],
  ) {}

  send(ask: ReaderIn) {
    this.port.postMessage(ask);
  }

  /** The next reply of this kind, or the first error, whichever comes first. */
  await<K extends ReaderOut['type']>(kind: K): Promise<Extract<ReaderOut, { type: K }>> {
    return new Promise((resolve, reject) => {
      const seen = (event: MessageEvent<ReaderOut>) => {
        if (event.data.type === kind) {
          this.port.removeEventListener('message', seen);
          resolve(event.data as Extract<ReaderOut, { type: K }>);
        } else if (event.data.type === 'error') {
          this.port.removeEventListener('message', seen);
          reject(new Error(event.data.message));
        }
      };
      this.port.addEventListener('message', seen);
    });
  }
}

/**
 * Reading a workspace in pieces.
 *
 * Nought: the manifests, read once against every filename. A manifest does not
 * list every target it has — cargo finds `src/bin/*.rs` by looking — so a
 * reader holding part of the sources would discover fewer targets, and a file
 * found under a different target is given a different module path. Only the
 * names are needed for that, not the contents, so this instance holds six
 * thousand empty files and a few hundred real ones.
 *
 * One: everybody parses their slice and says what they found — only the part
 * that means something beyond the file it came from, because aliases are
 * file-scoped and never travel.
 *
 * Two: the union of that, followed once, here.
 *
 * Three: everybody writes down what they hold, resolved against all of it.
 */
async function inPieces(
  repo: string,
  tree: Tree,
  wasm: string,
  ways: number,
  began: number,
): Promise<Measured> {
  const manifests = tree.files.filter((f) => !f.path.endsWith('.rs'));
  const sources = tree.files.filter((f) => f.path.endsWith('.rs'));

  const ports = await borrow(ways);
  const readers = divide(sources, ports.length).map((files, i) => new Reader(ports[i]!, files));

  // Lanes are a property of the connection to the CDN, not of the caller.
  // Twelve saturates it; several readers take a share each.
  const lanes = Math.max(2, Math.round(12 / readers.length));
  const draw = throttle(() => report(readers));
  // Everything up to the moment the last reader has its slice is network and
  // cache; what follows is this machine. The readers overlap the two, so the
  // line is drawn where the slowest of them finishes fetching.
  let fetchedAt = 0;
  for (const r of readers) {
    r.total = r.files.length;
    r.port.addEventListener('message', (event: MessageEvent<ReaderOut>) => {
      const out = event.data;
      if (out.type === 'fetching') {
        r.fetched = out.done;
        r.cached = out.cached;
        if (!fetchedAt && readers.every((one) => one.fetched >= one.total)) {
          fetchedAt = Math.round(performance.now() - began);
        }
        draw();
      } else if (out.type === 'parsing') {
        r.parseTotal = out.total;
        draw();
      } else if (out.type === 'parsed') {
        r.parsed = out.done;
        draw();
      }
    });
    r.port.start();
    // Nothing in the fetch needs the manifests, so it starts before them.
    r.send({ type: 'fetch', repo, sha: tree.sha, files: r.files, wasm, lanes });
  }

  post({ type: 'stage', phase: 'fetching', done: 0, total: sources.length, cached: 0 });

  // The manifests, here, while the readers pull the sources.
  const [cqx, read] = await Promise.all([
    Analysis.load(wasm),
    fetchSource(repo, { sha: tree.sha, truncated: false, files: manifests }, undefined, 4),
  ]);
  cqx.reset(repo);
  for (const m of read) cqx.addFile(m.path, m.content);
  // Names only: what a target is called depends on where its file sits, and
  // nothing here reads a line of it.
  for (const s of sources) cqx.addFile(s.path, '');
  const metadata = cqx.manifests();
  const trouble = safely(metadata)?.error;
  if (trouble) throw new Error(String(trouble));

  const carried = read.map((f: SourceFile) => ({ path: f.path, content: f.content }));
  const gathering = readers.map((r) => r.await('gathered'));
  for (const r of readers) r.send({ type: 'parse', repo, metadata, manifests: carried });

  const gathered = await Promise.all(gathering);
  const parsed = performance.now();
  const fetch = fetchedAt || Math.round(parsed - began);
  // The most any one of them took. Four instances peaking at 700 MB is a very
  // different thing from one peaking at 2,800, even though the sum is the same.
  let held = 0;
  for (const one of gathered) held = Math.max(held, one.held);

  // Later wins, exactly as a later file wins within one pass — so the readers
  // are merged in the order their slices appear in the tree.
  draw.cancel();
  post({ type: 'stage', phase: 'analysing', done: 0, total: 0, cached: 0, note: 'merging' });
  cqx.mergeReset();
  for (const one of gathered) cqx.mergeAdd(new Uint8Array(one.shared));
  const added = performance.now();
  const shared = cqx.mergeDone();

  const merged = performance.now();
  const emitting = readers.map((r) => r.await('facts'));
  // Every reader gets the same answer, so it is copied rather than moved: a
  // transfer would detach it and leave the second reader nothing.
  for (const r of readers) r.send({ type: 'emit', shared: shared.buffer as ArrayBuffer });

  cqx.foldReset();
  let collectedBytes = 0;
  // Awaited in order for the same reason they were merged in order.
  for (let i = 0; i < readers.length; i++) {
    post({
      type: 'stage',
      phase: 'analysing',
      done: i,
      total: readers.length,
      cached: 0,
      note: 'collecting',
    });
    const part = new Uint8Array((await emitting[i]!).bytes);
    collectedBytes += Math.round(part.byteLength / 1024);
    cqx.foldAdd(part);
  }

  const collected = performance.now();
  post({ type: 'stage', phase: 'analysing', done: 0, total: 0, cached: 0, note: 'scoring' });
  const { json } = cqx.foldDone(repo);
  const folded = performance.now();
  const data = JSON.parse(json) as { error?: string; score?: unknown };
  if (data.error) throw new Error(data.error);

  // The findings name a file and a line, and the source is spread across the
  // readers — so the report goes round them and each fills in what it can.
  if (data.score) {
    let quoted = JSON.stringify(data.score);
    for (const r of readers) {
      const quoting = r.await('quoted');
      r.send({ type: 'quote', report: quoted });
      quoted = (await quoting).report;
    }
    data.score = JSON.parse(quoted);
  }

  // Not the fold alone. The parse happened in the readers, and a number that
  // counted only what this thread did would report a hundred and forty seconds
  // of work as two. What is measured is the same span the single reader
  // measures — everything after the source was in hand — so that fetch plus
  // this is the whole wait, however the reading was divided.
  const ended = performance.now();
  return {
    json: JSON.stringify(data),
    ms: Math.max(0, Math.round(ended - began) - fetch),
    fetch,
    readers: readers.length,
    held,
    folding: cqx.held,
    steps: {
      parse: Math.round(parsed - began - fetch),
      union: Math.round(added - parsed),
      resolve: Math.round(merged - added),
      sharedKB: Math.round(shared.byteLength / 1024),
      factsKB: collectedBytes,
      collect: Math.round(collected - merged),
      fold: Math.round(folded - collected),
      quote: Math.round(ended - folded),
    },
  };
}

function report(readers: Reader[]) {
  const fetching = readers.some((r) => r.fetched < r.total);
  if (fetching) {
    post({
      type: 'stage',
      phase: 'fetching',
      done: readers.reduce((n, r) => n + r.fetched, 0),
      total: readers.reduce((n, r) => n + r.total, 0),
      cached: readers.reduce((n, r) => n + r.cached, 0),
    });
    return;
  }
  post({
    type: 'stage',
    phase: 'analysing',
    done: readers.reduce((n, r) => n + r.parsed, 0),
    total: readers.reduce((n, r) => n + r.parseTotal, 0),
    cached: 0,
  });
}

/** No more often than a screen can show: four readers ticking is four times the noise. */
function throttle(run: () => void): (() => void) & { cancel: () => void } {
  let waiting = 0;
  const fire = () => {
    waiting = 0;
    run();
  };
  const call = () => {
    if (!waiting) waiting = self.setTimeout(fire, 60);
  };
  call.cancel = () => {
    if (waiting) self.clearTimeout(waiting);
    waiting = 0;
  };
  return call;
}

function safely(json: string): { error?: unknown } | null {
  try {
    return JSON.parse(json) as { error?: unknown };
  } catch {
    return null;
  }
}

/** One thread, start to finish: everything below the threshold. */
async function whole(
  repo: string,
  tree: Tree,
  wasm: string,
  began: number,
): Promise<Measured> {
  // The module says how many files it will read, because only it knows: a
  // repository holds more .rs files than its crates claim, and counting what
  // was fetched made a finished analysis look stalled at forty-five per cent.
  let parsed = 0;
  let announced = 0;
  let expected = 0;
  const watch = {
    total: (files: number) => {
      expected = files;
      post({ type: 'stage', phase: 'analysing', done: 0, total: files, cached: 0 });
    },
    one: () => {
      parsed += 1;
      if (parsed - announced >= 25 || parsed === expected) {
        announced = parsed;
        post({ type: 'stage', phase: 'analysing', done: parsed, total: expected, cached: 0 });
      }
    },
  };

  const cqx = await Analysis.load(wasm, watch);
  const files = await fetchSource(repo, tree, (p) =>
    post({ type: 'stage', phase: 'fetching', done: p.done, total: p.total, cached: p.cached }),
  );
  const fetch = Math.round(performance.now() - began);

  post({ type: 'stage', phase: 'analysing', done: 0, total: 0, cached: 0 });
  cqx.reset(repo);
  for (const file of files) cqx.addFile(file.path, file.content);
  const { json, ms } = cqx.dataset(repo);
  return { json, ms, fetch, readers: 1, held: cqx.held, steps: { parse: ms } };
}

async function run(ask: Request) {
  const { repo, sha, wasm } = ask;
  // Already analysed in this browser: no tree request, no files, no parsing.
  const known = await remembered(repo, sha);
  if (known) {
    post(known);
    return;
  }

  const began = performance.now();
  post({ type: 'stage', phase: 'listing', done: 0, total: 0, cached: 0 });
  // Two megabytes to download and compile, and nothing about it depends on
  // which repository this is — so it starts now rather than after the tree.
  // A failure here surfaces when an instance is actually wanted.
  void Analysis.warm(wasm).catch(() => {});

  // A new instance each time, and the last one goes. Linear memory never
  // shrinks, so an instance that has read a large repository would hand the
  // next one a heap already spent. The compiled module is kept and reused;
  // it is the expensive half and it holds nothing.
  const tree = await fetchTree(repo, sha);
  if (tree.truncated) {
    throw new Error(`${repo} is too large for GitHub to list in one request.`);
  }
  if (tree.files.length === 0) {
    throw new Error(`${repo} has no Rust to analyse at ${sha.slice(0, 8)}.`);
  }

  const sources = tree.files.filter((f) => f.path.endsWith('.rs')).length;
  const ways = ask.readers ?? (sources > DIVIDE_ABOVE ? howMany(sources) : 1);
  const out =
    ways > 1 ? await inPieces(repo, tree, wasm, ways, began) : await whole(repo, tree, wasm, began);

  // Kept before it is sent, so a second click cannot race the first.
  await remember(repo, sha, out);
  post({ type: 'done', ...out });
}

self.onmessage = (event: MessageEvent<Incoming>) => {
  const message = event.data;
  if ('type' in message && message.type === 'readers') {
    granted?.(message.ports);
    granted = null;
    return;
  }
  run(message as Request).catch((e) =>
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) }),
  );
};
