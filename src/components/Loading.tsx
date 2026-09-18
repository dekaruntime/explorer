import { useEffect, useRef, useState } from 'react';

import type { Stage } from '../lib/live';

/**
 * Seconds since a phase began.
 *
 * A bar that cannot say how far along it is can at least say how long it has
 * been going. makepad takes over two minutes to parse, and for all of it the
 * only honest thing to report is the clock.
 */
function useElapsed(running: boolean): number {
  const [seconds, setSeconds] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (!running) {
      setSeconds(0);
      return;
    }
    from.current = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - from.current) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return seconds;
}

/**
 * Saying that something is happening, without taking the page away to say it.
 *
 * Two states, because there are two situations. With nothing on screen yet
 * there is room to explain what is going on and why. With a report already up,
 * replacing it would flash the whole of the page's content on every click — so
 * the report stays, and the notice sits above it.
 */

/** Done, and the tick that says so. */
function Tick() {
  return (
    <svg className="tick" viewBox="0 0 16 16" aria-hidden="true" width="13" height="13">
      <path d="M2 8.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.2"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * One row per phase.
 *
 * Reading the files and parsing them are different work taking different time
 * — deno spends thirteen seconds on the first and seven on the second — and a
 * single bar covering both says the wait is half what it is. The parse has no
 * progress to report, because it is one call into the module, so its bar says
 * that rather than inventing a number.
 */
function Phase({
  label,
  state,
  fraction,
  detail,
}: {
  label: string;
  state: 'waiting' | 'running' | 'done';
  fraction?: number;
  detail?: string;
}) {
  return (
    <div className={`phase ${state}`}>
      <span className="lb">{label}</span>
      {state === 'done' ? (
        <Tick />
      ) : (
        // Three cases, and the widths must not fight. A measured phase sets
        // its own; a running phase of unknown length leaves it to the stylesheet
        // to animate — an inline width of zero here made that bar invisible,
        // which is what a hundred and thirty nine seconds of makepad looked
        // like; and a phase that has not started shows an empty track.
        <div className={`bar${fraction === undefined && state === 'running' ? ' unknown' : ''}`}>
          {fraction !== undefined ? (
            <i style={{ width: `${fraction * 100}%` }} />
          ) : state === 'running' ? (
            <i />
          ) : (
            <i style={{ width: 0 }} />
          )}
        </div>
      )}
      {detail ? <span className="dt">{detail}</span> : null}
    </div>
  );
}

export function Phases({ stage }: { stage: Stage }) {
  const fetched = stage.phase === 'analysing';
  const reading: 'waiting' | 'running' | 'done' =
    stage.phase === 'listing' ? 'running' : fetched ? 'done' : 'running';
  return (
    <div className="phases">
      <Phase
        label="fetching files"
        state={reading}
        fraction={stage.phase === 'fetching' && stage.total ? stage.done / stage.total : undefined}
        detail={
          stage.phase === 'fetching'
            ? `${stage.done} of ${stage.total}${stage.cached ? ` · ${stage.cached} cached` : ''}`
            : stage.phase === 'listing'
              ? 'reading the file list'
              : `${stage.total} files`
        }
      />
      <Analysis running={fetched} total={stage.total} />
    </div>
  );
}

/**
 * The parse. It has no progress to report — it is one call into the module —
 * so it reports the clock instead, which after the first few seconds is the
 * thing a reader actually wants to know.
 */
function Analysis({ running, total }: { running: boolean; total: number }) {
  const seconds = useElapsed(running);
  return (
    <Phase
      label="running analysis"
      state={running ? 'running' : 'waiting'}
      detail={running ? (seconds > 2 ? `${seconds}s · ${total} files` : `${total} files`) : undefined}
    />
  );
}

/** The first commit of a repository nobody has published: nothing to keep. */
export function Analysing({ repo, at, stage }: { repo: string; at: string | null; stage: Stage }) {
  return (
    <div className="empty waiting-room">
      <div className="ttl">One moment while we generate a report</div>
      <Phases stage={stage} />
    </div>
  );
}

/** A report is already up and a different commit is on its way. */
export function Working({ at, stage }: { at: string | null; stage: Stage }) {
  return (
    <div className="working" role="status" aria-live="polite">
      {at ? <span className="at">{at}</span> : null}
      <Phases stage={stage} />
    </div>
  );
}
