/**
 * Analysing a repository nobody has exported.
 *
 * The store answers for anything CI has published. Everything else is analysed
 * here, in the tab, from the repository itself — which is what makes the
 * explorer worth pointing at an address rather than a list.
 *
 * It is the same analysis: `cqx_dataset` runs the fold the exporter runs, over
 * a snapshot assembled in memory instead of on disk. A commit analysed here and
 * the same commit analysed in CI produce the same bytes.
 *
 * What it costs, measured on a 330-file workspace: one API request for the
 * timeline, one for the tree, then the files from a CDN that neither meters nor
 * checks the origin. Roughly five seconds cold, and almost nothing for a second
 * commit of the same repository — contents are addressed by git object id, so
 * what has not changed is already in the cache.
 */

import { Analysis } from './cqx';
import { fetchCommits, fetchSource, fetchTree, type Progress } from './github';
import type { Commit, Dataset } from './types';
import type { RepoIndex } from './store';

/** How many commits the rail offers for a repository being analysed here. */
export const LIVE_COMMITS = 5;

export interface Stage {
  /** What is happening, for someone watching a progress line. */
  note: string;
  done: number;
  total: number;
}

let module: Promise<Analysis> | null = null;

/** One module per tab, compiled once however many repositories are looked at. */
function analysis(): Promise<Analysis> {
  module ??= Analysis.load('/cqx.wasm');
  return module;
}

/**
 * The commits a repository offers, without analysing any of them.
 *
 * Cheap — one request — so the rail can be populated before the first dataset
 * exists, and each slot analysed only when someone asks for it.
 */
export async function liveIndex(repo: string): Promise<RepoIndex> {
  const commits = await fetchCommits(repo, LIVE_COMMITS);
  if (commits.length === 0) throw new Error(`${repo} has no commits.`);
  return {
    repo,
    branch: '',
    remote: `https://github.com/${repo}`,
    commits_url: `https://github.com/${repo}/commits/`,
    generated: new Date().toISOString(),
    // Oldest first, as the store's own indexes are written.
    commits: commits
      .map(
        (c): Commit => ({
          sha: c.sha,
          short: c.short,
          subject: c.subject,
          author: c.author,
          date: c.date,
          lines: 0,
          // Nothing is known until it is analysed, and an invented score is
          // worse than an empty one.
          scores: {},
          delta: {},
        }),
      )
      .reverse(),
  };
}

export async function liveDataset(
  repo: string,
  ref: string,
  onStage?: (s: Stage) => void,
): Promise<Dataset> {
  onStage?.({ note: 'reading the file list', done: 0, total: 0 });
  const [cqx, tree] = await Promise.all([analysis(), fetchTree(repo, ref)]);
  if (tree.files.length === 0) {
    throw new Error(`${repo} has no Rust to analyse at ${ref.slice(0, 8)}.`);
  }
  if (tree.truncated) {
    throw new Error(`${repo} is too large for GitHub to list in one request.`);
  }

  const report = (p: Progress) =>
    onStage?.({
      note: p.cached ? `fetching files · ${p.cached} already cached` : 'fetching files',
      done: p.done,
      total: p.total,
    });
  const files = await fetchSource(repo, tree, report);

  onStage?.({ note: 'analysing', done: tree.files.length, total: tree.files.length });
  cqx.reset(repo);
  for (const file of files) cqx.addFile(file.path, file.content);

  const { json, ms } = cqx.dataset(repo);
  const data = JSON.parse(json) as Dataset & { error?: string };
  if (data.error) throw new Error(data.error);
  // The module has no clock; the timing belongs to the same span the exporter
  // measures, so it is filled in from out here.
  data.analysis = { ms, cqx: data.analysis?.cqx ?? '' };
  return data;
}
