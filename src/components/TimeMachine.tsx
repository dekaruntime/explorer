import type { Commit } from '../lib/types';
import type { ReleaseRef } from '../lib/github';

const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.valueOf())
    ? ''
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export type TimeMachineTab = 'releases' | 'commits';

/**
 * Which snapshot is being looked at, and which list it is being chosen from.
 *
 * Releases are the default view: a tag is a deliberate moment, and toggling
 * scores between two of them — rather than between two commits a minute
 * apart — is the comparison that actually shows something. Commits are the
 * fallback every repository has, tagged or not.
 *
 * L0 is head and each step down is a commit further back. Scoring one means
 * fetching and extracting it, so a slot that has not arrived says so rather
 * than the rail withholding itself until the last one lands.
 */
export function TimeMachine({
  commits,
  releases,
  releasesTrouble,
  trouble,
  slots,
  active,
  tab,
  onTabChange,
  onSelectCommit,
  onSelectRelease,
}: {
  commits: Commit[];
  /** Null while the list is still being asked for. */
  releases: ReleaseRef[] | null;
  /** Why the release list is empty, when it is empty for a reason. */
  releasesTrouble?: string;
  /** Why the rail has nothing to show, when that is not the repository's fault. */
  trouble?: string | null;
  slots: number;
  /** The short sha currently addressed, however this view was reached. */
  active: string | null;
  tab: TimeMachineTab;
  onTabChange: (tab: TimeMachineTab) => void;
  onSelectCommit: (index: number) => void;
  onSelectRelease: (release: ReleaseRef) => void;
}) {
  const showingReleases = tab === 'releases';

  return (
    <nav className="rail tm">
      <h3>Time machine</h3>
      <div className="tmtabs" role="tablist" aria-label="Time machine source">
        <button
          type="button"
          role="tab"
          aria-selected={showingReleases}
          className="tmtab"
          onClick={() => onTabChange('releases')}
        >
          releases
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!showingReleases}
          className="tmtab"
          onClick={() => onTabChange('commits')}
        >
          commits
        </button>
      </div>

      <div className="tmlist">
        {showingReleases ? (
          releases === null ? (
            <div className="tmnote">loading releases…</div>
          ) : releases.length === 0 ? (
            // Empty for a reason and empty because there are none are different
            // things, and only one of them is about the repository.
            <div className="tmnote">{releasesTrouble ?? 'no releases published.'}</div>
          ) : (
            releases.map((r) => (
              <button
                key={r.tag}
                className="lvl"
                aria-current={!!r.sha && !!active && r.sha.startsWith(active)}
                disabled={!r.sha}
                onClick={() => r.sha && onSelectRelease(r)}
                title={r.name}
              >
                <span className="t">tag</span>
                <span>
                  <span className="n">{r.tag}</span>
                  <br />
                  <span className="c">{when(r.publishedAt)}</span>
                </span>
              </button>
            ))
          )
        ) : (
          <>
            {Array.from({ length: slots }, (_, i) => {
              const commit = commits[i];
              if (!commit) {
                return (
                  <button key={i} className="lvl pending" disabled>
                    <span className="t">L{i}</span>
                    <span>
                      <span className="n">········</span>
                      <br />
                      <span className="c">·····</span>
                    </span>
                  </button>
                );
              }
              return (
                <button
                  key={commit.sha}
                  className="lvl"
                  aria-current={commit.short === active}
                  onClick={() => onSelectCommit(i)}
                  title={commit.subject}
                >
                  <span className="t">L{i}</span>
                  <span>
                    <span className="n">{commit.short}</span>
                    <br />
                    <span className="c">{when(commit.date)}</span>
                  </span>
                </button>
              );
            })}
            {commits.length < slots ? (
              <div className="tmnote">{trouble ?? `scoring ${slots} commits…`}</div>
            ) : null}
          </>
        )}
      </div>
    </nav>
  );
}
