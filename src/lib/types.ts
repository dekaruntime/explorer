/**
 * The shapes cqx emits.
 *
 * Hand-written against the Rust schema rather than generated. That is a
 * duplication with a cost: when `cqx-schema` changes these must follow, and
 * nothing enforces it yet. Generating them from the schema crate is the right
 * answer once the shapes settle.
 */

export type Band = 'fail' | 'warn' | 'pass';

export interface Finding {
  what: string;
  file: string;
  line: number;
  /** Which part of the line, `[start, end)`. Absent when the finding is about
   *  a whole file or crate and has no part to point at. */
  col?: [number, number];
  /** The line itself, so the code can be shown rather than described. */
  text?: string;
}

export interface Rule {
  rule: string;
  category: string;
  describes: string;
  /** What to do about it. Absent means the rule deducted nothing. */
  remedy: string;
  value: number;
  weight: number;
  deducted: number;
  capped: boolean;
  total_findings: number;
  findings: Finding[];
  /** The elevation this rule's findings live at, e.g. `L3`. */
  level: string;
}

export interface RuleConfig {
  category: string;
  describes: string;
  weight: number;
  free: number;
  full: number;
  enabled: boolean;
  params: Record<string, number>;
  source: 'default' | 'config' | 'env';
}

export interface Score {
  lines: number;
  scores: Record<string, number>;
  rules: Rule[];
  config: {
    version: number;
    config_path: string | null;
    min_score: number | null;
    exclude: string[];
    rules: Record<string, RuleConfig>;
  };
}

export interface Commit {
  sha: string;
  short: string;
  subject: string;
  author: string;
  date: string;
  lines: number;
  scores: Record<string, number>;
  delta: Record<string, number>;
}

export type EffectKind =
  | 'spawns'
  | 'reads_env'
  | 'effect_fs'
  | 'effect_net'
  | 'effect_exec'
  | 'unsafe_at';

export interface Package {
  id: string;
  name: string;
  files: number;
  lines: number;
  eff: Partial<Record<EffectKind, number>>;
  deps: string[];
  ext: number;
  bins: string[];
}

export interface FileNode {
  id: string;
  path: string;
  lines: number;
  pkg: string;
  n: number;
  eff: Partial<Record<EffectKind, number>>;
}

export interface TypeDecl {
  id: string;
  name: string;
  k: string;
  pkg: string | null;
  file: string | null;
  lines: number;
  /** `[field name, declared type]`. */
  fields: [string, string][];
  uses: number;
}

/** `[base name, owning crate or null, depth in the generic]`. */
export type TypePart = [string, string | null, number];

export interface FunctionDecl {
  id: string;
  name: string;
  k: string;
  pkg: string | null;
  file: string | null;
  lines: number;
  /** `[parameter name, type as written, its parts]`. */
  p: [string, string, TypePart[]][];
  r: [string, TypePart[]] | null;
  eff: EffectKind[];
}

export interface EffectRow {
  k: EffectKind;
  pkg: string | null;
  sym: string;
  to: string;
  file: string;
  line: number;
  via?: string;
  src?: string;
  env?: string;
  form?: string;
}

/** What producing this dataset cost, and what produced it. */
export interface Analysis {
  /**
   * Milliseconds from source in memory to finished dataset. Null when nothing
   * timed it — a wasm build has no clock, so the page fills this in.
   */
  ms: number | null;
  /** The version of cqx that wrote it. */
  cqx: string;
  /**
   * Milliseconds spent reading the source before any of it was parsed. Only
   * set when the reading happened here — a dataset from the store was fetched
   * by whoever published it, and that is not this reader's wait.
   */
  fetch?: number;
  /**
   * How many threads read it. One for anything small enough that a second
   * would cost more than it saved; more for a repository that needs dividing.
   * Absent on a dataset from the store, which was read by a checkout.
   */
  readers?: number;
  /**
   * The most linear memory any one reader took, in bytes. The number that
   * decides whether a repository can be read at all: wasm32 stops at four
   * gigabytes and never gives any of it back.
   */
  held?: number;
}

export interface Dataset {
  repo: string;
  branch: string;
  remote: string | null;
  commits_url: string | null;
  score: Score;
  /** Absent in datasets written before cqx recorded it. */
  analysis?: Analysis;
  /** Filled from the index rather than from here: a dataset describes one commit. */
  history?: Commit[];
  packages: Package[];
  files: FileNode[];
  types: TypeDecl[];
  functions: FunctionDecl[];
  effects: EffectRow[];
  totals: {
    types: number;
    functions: number;
    notable: number;
    nodes: number;
    edges: number;
    lines: number;
  };
}

export const band = (v: number): Band => (v >= 90 ? 'pass' : v >= 50 ? 'warn' : 'fail');

export const EFFECT_LABEL: Record<EffectKind, string> = {
  spawns: 'spawn',
  reads_env: 'env',
  effect_exec: 'exit',
  unsafe_at: 'unsafe',
  effect_fs: 'fs',
  effect_net: 'net',
};

/** Ordered so the dangerous ones lead, which is how they should read. */
export const EFFECT_ORDER: EffectKind[] = [
  'spawns',
  'reads_env',
  'effect_exec',
  'unsafe_at',
  'effect_fs',
  'effect_net',
];
