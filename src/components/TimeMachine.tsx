import type { Commit } from '../lib/types';

const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.valueOf())
    ? ''
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/**
 * Which snapshot is being looked at.
 *
 * L0 is head and each step down is a commit further back. Scoring one means
 * fetching and extracting it, so a slot that has not arrived says so rather
 * than the rail withholding itself until the last one lands.
 */
export function TimeMachine({
  commits,
  slots,
  current,
  onSelect,
}: {
  commits: Commit[];
  slots: number;
  current: number;
  onSelect: (index: number) => void;
}) {
  return (
    <nav className="rail tm">
      <h3>Time machine</h3>
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
            aria-current={i === current}
            onClick={() => onSelect(i)}
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
        <div className="tmnote">scoring {slots} commits…</div>
      ) : null}
    </nav>
  );
}
