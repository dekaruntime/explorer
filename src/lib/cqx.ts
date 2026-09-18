/**
 * Calling the analysis.
 *
 * cqx exports four functions and a length-prefixed buffer; this is the whole of
 * the glue. No bindgen, so there is nothing to install and nothing to keep in
 * step with a generator.
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
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class Analysis {
  private constructor(private readonly ex: Exports) {}

  static async load(url: string): Promise<Analysis> {
    const source = fetch(url);
    // Streaming compilation starts before the download finishes, which matters
    // for a two-megabyte module on a slow connection.
    const { instance } = await WebAssembly.instantiateStreaming(source, {}).catch(
      async () => WebAssembly.instantiate(await (await fetch(url)).arrayBuffer(), {}),
    );
    return new Analysis(instance.exports as unknown as Exports);
  }

  /** Copies a string into the module and returns where it landed. */
  private put(text: string): [number, number] {
    const bytes = encoder.encode(text);
    const ptr = this.ex.cqx_alloc(bytes.length);
    new Uint8Array(this.ex.memory.buffer).set(bytes, ptr);
    return [ptr, bytes.length];
  }

  /** Reads a length-prefixed reply and releases it. */
  private take(ptr: number): string {
    const view = new DataView(this.ex.memory.buffer);
    const len = view.getUint32(ptr, true);
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
}
