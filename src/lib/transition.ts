/**
 * Fading one view into the next.
 *
 * Astro's ClientRouter does this for document navigations. The explorer never
 * performs one — a commit or an elevation is a pushState inside an island — so
 * it reaches for the same browser API the router is built on.
 *
 * React is told to flush synchronously inside the callback, because the browser
 * takes its "after" snapshot as soon as that callback returns; an update still
 * sitting in a queue would be captured as no change at all.
 */

import { flushSync } from 'react-dom';

/** What the browser hands back. Each promise rejects if the transition is
 *  interrupted, which is ordinary here — people click faster than 140ms. */
type Transition = {
  finished: Promise<void>;
  ready: Promise<void>;
  updateCallbackDone: Promise<void>;
};
type Starter = (callback: () => void) => Transition;

export function transition(apply: () => void): void {
  const start = (document as Document & { startViewTransition?: Starter }).startViewTransition;
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  // Not every browser has it, and someone who asked for less motion has asked
  // for exactly this. Both cases just do the work.
  if (!start || still) {
    apply();
    return;
  }
  const running = start.call(document, () => flushSync(apply));
  // Clicking again before the fade ends rejects these. That is the interruption
  // working as intended, not a failure — but unhandled it reaches the page as
  // an uncaught AbortError.
  for (const settled of [running.finished, running.ready, running.updateCallbackDone]) {
    settled?.catch(() => {});
  }
}
