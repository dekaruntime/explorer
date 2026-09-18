/**
 * One reader: a slice of a repository, parsed on its own thread.
 *
 * The reading is where the time goes — of makepad's hundred and thirty nine
 * seconds, all but a second is this — and it divides, because a file parses on
 * its own. What does not divide is what the parsing is resolved against: a
 * value's provenance routinely crosses a crate boundary, so a reader holding
 * one slice would follow fewer of them and the score would depend on how the
 * work had been split. Hence three phases rather than one, and hence this
 * thread does not finish its own work: it parses, says what it found, is told
 * what every reader found, and only then writes anything down.
 *
 * It also fetches its own slice. The alternative — one thread fetching six
 * thousand files and handing them out — puts every `fetch`, every `text()` and
 * every cache write on one thread, and then copies the result across a
 * postMessage. Fetching where the parsing happens costs neither.
 *
 * The memory is the other half of the point. A single instance reading makepad
 * peaks near the four gigabytes wasm32 can address at all; four instances
 * reading a quarter each peak at a quarter, in four separate address spaces.
 */

import { Analysis } from './cqx';
import { fetchSource, type Tree } from './github';

/** What the coordinator asks of a reader. */
export type ReaderIn =
  /** Start pulling this slice. Nothing here needs the manifests, so it can
   *  begin before the coordinator has read them. */
  | {
      type: 'fetch';
      repo: string;
      sha: string;
      files: { path: string; sha: string }[];
      wasm: string;
      lanes: number;
    }
  /** Everything is in hand: parse, and say what was found. */
  | { type: 'parse'; repo: string; metadata: string; manifests: { path: string; content: string }[] }
  /** Write down what is held, resolved against what every reader found. */
  | { type: 'emit'; shared: ArrayBuffer }
  /** Fill in the source line of any finding pointing into this slice. */
  | { type: 'quote'; report: string };

/** What a reader tells the coordinator. */
export type ReaderOut =
  | { type: 'fetching'; done: number; total: number; cached: number }
  | { type: 'parsing'; total: number }
  | { type: 'parsed'; done: number }
  | { type: 'gathered'; shared: ArrayBuffer; held: number }
  | { type: 'facts'; bytes: ArrayBuffer }
  | { type: 'quoted'; report: string }
  | { type: 'error'; message: string };

let link: MessagePort | null = null;
const tell = (out: ReaderOut, transfer: Transferable[] = []) => link?.postMessage(out, transfer);

/**
 * How far along the parse is, reported no more often than a screen can show.
 *
 * Six thousand messages to draw sixty frames is waste, and the coordinator has
 * to add up every reader's before it can draw anything at all.
 */
let parsed = 0;
let announced = 0;
let expected = 0;
const watch = {
  total: (files: number) => {
    expected = files;
    tell({ type: 'parsing', total: files });
  },
  one: () => {
    parsed += 1;
    if (parsed - announced >= 25 || parsed === expected) {
      announced = parsed;
      tell({ type: 'parsed', done: parsed });
    }
  },
};

/** The slice, and the module, both under way before either is needed. */
let coming: Promise<{ cqx: Analysis; files: { path: string; content: string }[] }> | null = null;
let cqx: Analysis | null = null;

async function collect(ask: Extract<ReaderIn, { type: 'fetch' }>) {
  const tree: Tree = { sha: ask.sha, truncated: false, files: ask.files.map((f) => ({ ...f, type: 'blob' })) };
  const [module, files] = await Promise.all([
    Analysis.load(ask.wasm, watch),
    fetchSource(
      ask.repo,
      tree,
      (p) => tell({ type: 'fetching', done: p.done, total: p.total, cached: p.cached }),
      ask.lanes,
    ),
  ]);
  return { cqx: module, files: files.map((f) => ({ path: f.path, content: f.content })) };
}

async function handle(ask: ReaderIn) {
  switch (ask.type) {
    case 'fetch': {
      coming = collect(ask);
      // A slice that fails to arrive is reported when it fails, not when the
      // coordinator next happens to ask for something.
      coming.catch((e) => tell({ type: 'error', message: e instanceof Error ? e.message : String(e) }));
      return;
    }
    case 'parse': {
      if (!coming) throw new Error('a reader was told to parse before it was given anything to read');
      const ready = await coming;
      cqx = ready.cqx;
      cqx.reset(ask.repo);
      // Every reader holds every manifest, so each describes the same packages.
      // They are small; it is the sources that are not.
      for (const m of ask.manifests) cqx.addFile(m.path, m.content);
      for (const f of ready.files) cqx.addFile(f.path, f.content);
      // Handed over to the module, so the strings can go: holding makepad's
      // slice twice is thirty megabytes of this thread for nothing.
      ready.files.length = 0;
      const shared = cqx.gather(ask.metadata);
      tell({ type: 'gathered', shared: shared.buffer as ArrayBuffer, held: cqx.held }, [
        shared.buffer as ArrayBuffer,
      ]);
      return;
    }
    case 'emit': {
      if (!cqx) throw new Error('a reader was told to emit before it had parsed anything');
      const bytes = cqx.emit(new Uint8Array(ask.shared));
      // Transferred rather than cloned: makepad's readers write ninety-six
      // megabytes between them, and moving the buffer costs nothing.
      tell({ type: 'facts', bytes: bytes.buffer as ArrayBuffer }, [bytes.buffer as ArrayBuffer]);
      return;
    }
    case 'quote': {
      if (!cqx) throw new Error('a reader was asked to quote before it had read anything');
      tell({ type: 'quoted', report: cqx.quote(ask.report) });
      return;
    }
  }
}

self.onmessage = (event: MessageEvent<{ port: MessagePort }>) => {
  link = event.data.port;
  link.onmessage = (m: MessageEvent<ReaderIn>) => {
    handle(m.data).catch((e) =>
      tell({ type: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
  };
  link.start();
};
