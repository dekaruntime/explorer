/**
 * Easing a number toward a target.
 *
 * A score arriving is the one moment this page has something to say, and a
 * number that simply appears says it in no time at all. PageSpeed sweeps its
 * rings for the same reason: the motion is what makes 31 read differently from
 * 100 before anybody has read either.
 *
 * Driven in JavaScript rather than by a CSS transition because the arc and the
 * figure inside it have to agree. Two independent transitions on the same
 * duration drift, and a ring that says 68 while its arc is three quarters round
 * is worse than no animation.
 */

import { useEffect, useRef, useState } from 'react';

const still = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Fast at first, settling at the end — the shape a dial has when it lands. */
const ease = (t: number) => 1 - (1 - t) ** 3;

export function useEased(target: number, ms = 800): number {
  // Starts at nothing, so the first paint is a sweep rather than a jump.
  const [shown, setShown] = useState(still() ? target : 0);
  // Where this run began, which is wherever the last one was interrupted —
  // clicking through commits should not restart the sweep from zero each time.
  const live = useRef(shown);

  useEffect(() => {
    if (still()) {
      live.current = target;
      setShown(target);
      return;
    }
    const from = live.current;
    if (from === target) return;
    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / ms);
      const value = from + (target - from) * ease(t);
      live.current = value;
      setShown(value);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);

  return shown;
}
