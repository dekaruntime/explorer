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
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

  static async load(url: string): Promise<Analysis> {
    // Streaming compilation starts before the download finishes, which matters
    // for a two-megabyte module on a slow connection.
    Analysis.compiled ??= WebAssembly.compileStreaming(fetch(url)).catch(async () =>
      WebAssembly.compile(await (await fetch(url)).arrayBuffer()),
    );
    const instance = await WebAssembly.instantiate(await Analysis.compiled, {});
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
