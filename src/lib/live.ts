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
 * All of it happens in a worker. Parsing a large repository is seconds of solid
 * CPU, and on the main thread that is a frozen tab — the progress bar stops at
 * the moment it has the most to report.
 *
 * What it costs, measured on a 330-file workspace: one API request for the
 * timeline, one for the tree, then the files from a CDN that neither meters nor
 * checks the origin. Roughly five seconds cold, and almost nothing for a second
 * commit of the same repository — contents are addressed by git object id, so
 * what has not changed is already in the cache.
 */

import { fetchCommits } from './github';
import type { Reply, Request } from './analyse.worker';
import type { Commit, Dataset } from './types';
import type { RepoIndex } from './store';

/** How many commits the rail offers for a repository being analysed here. */
export const LIVE_COMMITS = 5;

/**
 * Which half of the wait this is.
 *
 * They are not the same work and they do not take the same time — deno spends
 * thirteen seconds reading files and seven parsing them — so reporting one
 * number for both tells a reader they waited half as long as they did.
 */
export interface Stage {
  phase: 'listing' | 'fetching' | 'analysing';
  done: number;
  total: number;
  /** Files that were already held, and so cost nothing. */
  cached: number;
}

/**
 * A thread per analysis, and it does not outlive the work.
 *
 * Nothing here accumulates on purpose, but a worker that has read six thousand
 * files holds a wasm instance with gigabytes linear memory cannot give back, a
 * heap the collector will reach when it reaches it, and no way to say it is
 * nearly full. Handing that thread the next repository is how a tab that had
 * read a large one stopped being able to read small ones.
 *
 * Ending it returns all of that at once and definitely, rather than hoping.
 * What is worth keeping was never in the thread: the files and the finished
 * datasets live in the browser's own storage, which outlives every worker.
 *
 * Named, as the tour names its own, so it is identifiable in a profile rather
 * than appearing as an anonymous thread.
 */
function hire(): Worker {
  return new Worker(new URL('./analyse.worker.ts', import.meta.url), {
    type: 'module',
    name: 'cqx-analysis',
  });
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

export function liveDataset(
  repo: string,
  sha: string,
  onStage?: (s: Stage) => void,
): Promise<Dataset> {
  return new Promise((resolve, reject) => {
    const w = hire();
    const done = () => {
      w.removeEventListener('message', listen);
      // Everything it held goes with it: the instance, its memory, the heap.
      w.terminate();
    };
    const listen = (event: MessageEvent<Reply>) => {
      const reply = event.data;
      if (reply.type === 'stage') {
        onStage?.({
          phase: reply.phase,
          done: reply.done,
          total: reply.total,
          cached: reply.cached,
        });
        return;
      }
      done();
      if (reply.type === 'error') {
        reject(new Error(reply.message));
        return;
      }
      const data = JSON.parse(reply.json) as Dataset & { error?: string };
      if (data.error) {
        reject(new Error(data.error));
        return;
      }
      // The module has no clock, and the two halves of the wait are measured
      // separately: the analysis is the span the exporter also measures, and
      // the fetch is what this reader paid on top of it.
      data.analysis = { ms: reply.ms, cqx: data.analysis?.cqx ?? '', fetch: reply.fetch };
      resolve(data);
    };
    // A thread that dies mid-analysis is a failure like any other, and saying
    // so beats a promise that never settles.
    w.addEventListener('error', (event: ErrorEvent) => {
      done();
      reject(new Error(event.message || 'the analysis stopped unexpectedly.'));
    });
    w.addEventListener('message', listen);
    w.postMessage({ repo, sha, wasm: new URL('/cqx.wasm', location.href).href } satisfies Request);
  });
}
