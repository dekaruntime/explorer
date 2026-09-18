/**
 * Calling the analysis.
 *
 * cqx exports a handful of functions and a length-prefixed buffer; this is the
 * whole of the glue. No bindgen, so there is nothing to install and nothing to
 * keep in step with a generator.
 */

interface Exports {
  memory: WebAssembly.Memory;
  cqx_alloc(len: number): number;
  cqx_free(ptr: number, len: number): void;
  cqx_reset(ptr: number, len: number): void;
  cqx_add_file(p: number, pl: number, c: number, cl: number): void;
  cqx_file_count(): number;
  cqx_facts(): number;
  cqx_score(ptr: number, len: number): number;
  cqx_dataset(r: number, rl: number, c: number, cl: number): number;
  // Reading a workspace in pieces. What the coordinator calls:
  cqx_manifests(): number;
  cqx_merge_reset(): void;
  cqx_merge_add(ptr: number, len: number): number;
  cqx_merge_done(): number;
  cqx_fold_reset(): void;
  cqx_fold_add(ptr: number, len: number): number;
  cqx_fold_done(r: number, rl: number, c: number, cl: number): number;
  // And what a reader calls:
  cqx_gather(ptr: number, len: number): number;
  cqx_emit(ptr: number, len: number): number;
  cqx_quote(ptr: number, len: number): number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** What the module tells the host as it works. */
export interface Watch {
  /** How many files it is about to read. Said once, before any of them. */
  total: (files: number) => void;
  /** One file done. */
  one: () => void;
}

export class Analysis {
  private constructor(private readonly ex: Exports) {}

  /**
   * The compiled module, kept; the instance, not.
   *
   * Linear memory only ever grows. A module that has just read a repository of
   * six thousand files is holding gigabytes it will never give back, and the
   * next repository analysed in the same instance allocates against whatever
   * is left of the four the format allows. That is not a slow failure — the
   * allocator returns nothing and the glue reads a length out of unmapped
   * memory, which is the "offset is out of bounds" a small repository reported
   * after a large one.
   *
   * Compiling is the expensive half and it is cached by the browser, so a new
   * instance per analysis costs little and starts from an empty heap.
   */
  private static compiled: Promise<WebAssembly.Module> | null = null;

  /**
   * Start fetching and compiling, without wanting an instance yet.
   *
   * Two megabytes to download and compile, and none of it depends on which
   * repository is about to be read — so it can overlap the request that finds
   * that out.
   */
  static warm(url: string): Promise<WebAssembly.Module> {
    // Streaming compilation starts before the download finishes, which matters
    // for a two-megabyte module on a slow connection.
    Analysis.compiled ??= WebAssembly.compileStreaming(fetch(url)).catch(async () =>
      WebAssembly.compile(await (await fetch(url)).arrayBuffer()),
    );
    return Analysis.compiled;
  }

  static async load(
    url: string,
    watch: Watch = { total: () => {}, one: () => {} },
  ): Promise<Analysis> {
    const module = await Analysis.warm(url);
    // The module cannot report progress on its own — it holds the thread until
    // it returns — so it is given something to call. Without this it will not
    // instantiate at all, which is the point: a module that silently reported
    // nothing would be worse.
    const instance = await WebAssembly.instantiate(module, {
      cqx: { parsing_total: watch.total, parsed_one: watch.one },
    });
    return new Analysis(instance.exports as unknown as Exports);
  }

  /** Copies a string into the module and returns where it landed. */
  private put(text: string): [number, number] {
    const bytes = encoder.encode(text);
    const ptr = this.ex.cqx_alloc(bytes.length);
    // Nothing is mapped at zero. An allocator that has run out says so this
    // way, and writing there would corrupt the module rather than fail.
    if (ptr === 0 && bytes.length > 0) {
      throw new Error('cqx ran out of memory: this repository is too large to analyse here.');
    }
    new Uint8Array(this.ex.memory.buffer).set(bytes, ptr);
    return [ptr, bytes.length];
  }

  /** Reads a length-prefixed reply and releases it. */
  private take(ptr: number): string {
    const size = this.ex.memory.buffer.byteLength;
    if (ptr === 0 || ptr + 4 > size) {
      throw new Error('cqx returned nothing: it ran out of memory part way through.');
    }
    const len = new DataView(this.ex.memory.buffer).getUint32(ptr, true);
    // A length read out of memory the module never wrote is the shape a failed
    // allocation takes on the way back. Saying so beats a decoder complaining
    // about an offset.
    if (ptr + 4 + len > size) {
      throw new Error('cqx returned a reply longer than its own memory; it ran out part way through.');
    }
    const text = decoder.decode(new Uint8Array(this.ex.memory.buffer, ptr + 4, len));
    this.ex.cqx_free(ptr, 4 + len);
    return text;
  }

  private withString<T>(text: string, use: (ptr: number, len: number) => T): T {
    const [ptr, len] = this.put(text);
    try {
      return use(ptr, len);
    } finally {
      this.ex.cqx_free(ptr, len);
    }
  }

  reset(label: string): void {
    this.withString(label, (p, l) => this.ex.cqx_reset(p, l));
  }

  addFile(path: string, content: string): void {
    const [pp, pl] = this.put(path);
    const [cp, cl] = this.put(content);
    try {
      this.ex.cqx_add_file(pp, pl, cp, cl);
    } finally {
      this.ex.cqx_free(pp, pl);
      this.ex.cqx_free(cp, cl);
    }
  }

  /**
   * How much linear memory this instance has taken, in bytes.
   *
   * The number that matters on wasm32: the address space stops at four
   * gigabytes and memory never shrinks, so this only ever goes up and what it
   * reaches is what decides whether a repository can be read at all.
   */
  get held(): number {
    return this.ex.memory.buffer.byteLength;
  }

  get fileCount(): number {
    return this.ex.cqx_file_count();
  }

  /** The fact stream, as newline-delimited JSON. */
  facts(): string {
    return this.take(this.ex.cqx_facts());
  }

  /** The score, measured against `config` or the built-in defaults. */
  score(config?: string): unknown {
    const reply = config
      ? this.withString(config, (p, l) => this.take(this.ex.cqx_score(p, l)))
      : this.take(this.ex.cqx_score(0, 0));
    return JSON.parse(reply);
  }

  /** Copies bytes into the module and returns where they landed. */
  private putBytes(bytes: Uint8Array): [number, number] {
    const ptr = this.ex.cqx_alloc(bytes.length);
    if (ptr === 0 && bytes.length > 0) {
      throw new Error('cqx ran out of memory: this repository is too large to analyse here.');
    }
    new Uint8Array(this.ex.memory.buffer).set(bytes, ptr);
    return [ptr, bytes.length];
  }

  /**
   * A reply taken as bytes rather than as text.
   *
   * makepad's readers write ninety-six megabytes of facts between them, and
   * that text has no reason to exist as a JavaScript string: it is decoded
   * here, cloned across a postMessage, and encoded again on the other side, to
   * arrive as the bytes it already was. Kept as bytes it is one copy out of the
   * module and then a transfer, which moves the buffer rather than copying it.
   */
  private takeBytes(ptr: number): Uint8Array {
    const size = this.ex.memory.buffer.byteLength;
    if (ptr === 0 || ptr + 4 > size) {
      throw new Error('cqx returned nothing: it ran out of memory part way through.');
    }
    const len = new DataView(this.ex.memory.buffer).getUint32(ptr, true);
    if (ptr + 4 + len > size) {
      throw new Error('cqx returned a reply longer than its own memory; it ran out part way through.');
    }
    const out = new Uint8Array(len);
    out.set(new Uint8Array(this.ex.memory.buffer, ptr + 4, len));
    this.ex.cqx_free(ptr, 4 + len);
    return out;
  }

  // --- reading a workspace in pieces ----------------------------------------
  //
  // Three phases, because what the reading is resolved against does not divide
  // the way the reading does. The coordinator reads the manifests and merges;
  // the readers parse, emit, and answer for the source they hold.

  /** What the workspace contains, read from the manifests alone. */
  manifests(): string {
    return this.take(this.ex.cqx_manifests());
  }

  /**
   * Parses this reader's slice and reports what it found beyond each file.
   *
   * Bytes both ways, like the facts. What a reader found in makepad is tens of
   * megabytes of JSON, and a string would be decoded out of the module here,
   * cloned across a postMessage, and encoded back in on the other side — three
   * passes over it to deliver the bytes it already was. Fourteen of makepad's
   * thirty-three seconds were spent on exactly that.
   */
  gather(metadata: string): Uint8Array {
    return this.withString(metadata, (p, l) => this.takeBytes(this.ex.cqx_gather(p, l)));
  }

  /** Writes down what this reader holds, resolved against what all of them found. */
  emit(shared: Uint8Array): Uint8Array {
    const [ptr, len] = this.putBytes(shared);
    try {
      return this.takeBytes(this.ex.cqx_emit(ptr, len));
    } finally {
      this.ex.cqx_free(ptr, len);
    }
  }

  /**
   * Fills in the source line of every finding whose file this reader holds.
   *
   * The report goes round the readers in turn: one holds a slice of the
   * sources and the coordinator holds none of them.
   */
  quote(report: string): string {
    return this.withString(report, (p, l) => this.take(this.ex.cqx_quote(p, l)));
  }

  /** Starts a fresh union of what the readers found. */
  mergeReset(): void {
    this.ex.cqx_merge_reset();
  }

  /** Adds one reader's report. Call order is reading order: later wins. */
  mergeAdd(shared: Uint8Array): void {
    const [ptr, len] = this.putBytes(shared);
    try {
      const trouble = (JSON.parse(this.take(this.ex.cqx_merge_add(ptr, len))) as { error?: string })
        .error;
      if (trouble) throw new Error(trouble);
    } finally {
      this.ex.cqx_free(ptr, len);
    }
  }

  /** Follows the union to its conclusion. */
  mergeDone(): Uint8Array {
    return this.takeBytes(this.ex.cqx_merge_done());
  }

  /** Starts a fresh collection of facts. */
  foldReset(): void {
    this.ex.cqx_fold_reset();
  }

  /** Adds one reader's facts, as the bytes they arrived as. */
  foldAdd(facts: Uint8Array): void {
    const [ptr, len] = this.putBytes(facts);
    try {
      const reply = this.take(this.ex.cqx_fold_add(ptr, len));
      const trouble = (JSON.parse(reply) as { error?: string }).error;
      if (trouble) throw new Error(trouble);
    } finally {
      this.ex.cqx_free(ptr, len);
    }
  }

  /** Turns everything the readers wrote into one dataset. */
  foldDone(repo: string, config = ''): { json: string; ms: number } {
    const [rp, rl] = this.put(repo);
    const [cp, cl] = this.put(config);
    const started = performance.now();
    const json = this.take(this.ex.cqx_fold_done(rp, rl, cp, cl));
    const ms = Math.round(performance.now() - started);
    this.ex.cqx_free(rp, rl);
    this.ex.cqx_free(cp, cl);
    return { json, ms };
  }

  /**
   * The whole dataset for the snapshot: the score, and the facts folded into
   * what an explorer renders.
   *
   * The same fold the exporter runs, so a commit analysed here and a commit
   * analysed in CI cannot disagree about what the code contains. The module has
   * no clock, so the timing is measured out here across exactly the call.
   */
  dataset(repo: string, config = ''): { json: string; ms: number } {
    const [rp, rl] = this.put(repo);
    const [cp, cl] = this.put(config);
    const started = performance.now();
    const json = this.take(this.ex.cqx_dataset(rp, rl, cp, cl));
    const ms = Math.round(performance.now() - started);
    this.ex.cqx_free(rp, rl);
    this.ex.cqx_free(cp, cl);
    return { json, ms };
  }
}
