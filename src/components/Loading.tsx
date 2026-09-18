import type { Stage } from '../lib/live';

/**
 * Saying that something is happening, without taking the page away to say it.
 *
 * Two states, because there are two situations. With nothing on screen yet
 * there is room to explain what is going on and why. With a report already up,
 * replacing it would flash the whole of the page's content on every click — so
 * the report stays, and the notice sits above it.
 */

export function Bar({ stage }: { stage: Stage }) {
  return (
    <div className="bar">
      <i style={{ width: `${stage.total ? (stage.done / stage.total) * 100 : 8}%` }} />
    </div>
  );
}

const detail = (stage: Stage) =>
  `${stage.note}${stage.total ? ` · ${stage.done} of ${stage.total}` : ''}`;

/** The first commit of a repository nobody has published: nothing to keep. */
export function Analysing({ repo, at, stage }: { repo: string; at: string | null; stage: Stage }) {
  return (
    <div className="empty">
      <div>
        Analysing <b>{repo}</b>
        {at ? (
          <>
            {' '}at <b>{at}</b>
          </>
        ) : null}{' '}
        — {detail(stage)}
      </div>
      <Bar stage={stage} />
      <div className="dim">
        Nobody has published this one, so it is being read from GitHub and analysed here.
      </div>
    </div>
  );
}

/** A report is already up and a different commit is on its way. */
export function Working({ at, stage }: { at: string | null; stage: Stage }) {
  return (
    <div className="working" role="status" aria-live="polite">
      <Bar stage={stage} />
      <span>
        {at ? `${at} — ` : ''}
        {detail(stage)}
      </span>
    </div>
  );
}
