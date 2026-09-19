import { useEffect, useMemo, useRef, useState } from 'react';

import type { Dataset } from 'cqx-kit/engine';
import type { View } from 'cqx-kit/engine';
import { buildIndex, search, KIND_LABEL, KIND_ORDER, type Hit } from 'cqx-kit/engine';

/**
 * The way across.
 *
 * The elevations descend — a crate, its files, their types — and that is the
 * right shape for reading a codebase you have never seen. It is the wrong
 * shape for the second visit, when you know the name of the thing and want to
 * be standing on it. Every list is capped, every cap is generous, and none of
 * them will ever contain the one symbol somebody came here for.
 *
 * Deliberately not a filter on the current elevation. A filter can only find
 * what is already in scope, and the reason to search is usually that it isn't.
 */

const SHOWN = 24;

/** What kind of thing a row is, in a column of its own so the names below
 *  each other line up — the names are what is being read down. */
function Chip({ kind }: { kind: Hit['kind'] }) {
  return <span className={`sk ${kind}`}>{kind}</span>;
}

export function Search({
  data,
  open,
  onClose,
  onGo,
}: {
  data: Dataset | null;
  open: boolean;
  onClose: () => void;
  onGo: (patch: Partial<View>) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // Rebuilt when the commit changes, which is the only time it can be wrong.
  // Forty thousand entries take a few milliseconds to lay out and are then
  // scanned in under one, so there is nothing here worth doing incrementally.
  const index = useMemo(() => (data ? buildIndex(data) : null), [data]);
  const hits = useMemo(
    () => (index ? search(index, query, SHOWN) : []),
    [index, query],
  );

  // A new query is a new list, and the old cursor position means nothing in it.
  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    // After the sheet exists. Focusing during the render that creates it is a
    // no-op, and an unfocused search box is a box that swallows the next key.
    const id = requestAnimationFrame(() => box.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Keep the cursor on screen. A palette is twenty-four rows in a box that
  // shows eight, and arrowing past the fold with nothing moving looks broken.
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, hits]);

  if (!open) return null;

  const choose = (hit: Hit) => {
    onClose();
    onGo(hit.go);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      setActive((i) => (hits.length ? (i + 1) % hits.length : 0));
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      setActive((i) => (hits.length ? (i - 1 + hits.length) % hits.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = hits[active];
      if (hit) choose(hit);
    }
  };

  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        // Only the backdrop. A drag that starts on a row and ends out here is
        // a selection, not a dismissal.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search this repository">
        <div className="pq">
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="7" cy="7" r="4.6" />
            <path d="M10.4 10.4 14 14" />
          </svg>
          <input
            ref={box}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={index ? 'crate, file, type, function…' : 'nothing loaded yet'}
            aria-label="Search this repository"
            role="combobox"
            aria-expanded="true"
            aria-controls="cqx-hits"
            aria-activedescendant={hits[active] ? `hit-${active}` : undefined}
            spellCheck={false}
            autoComplete="off"
          />
          <button className="esc" onClick={onClose} aria-label="Close">esc</button>
        </div>

        <div className="phits" id="cqx-hits" role="listbox" ref={list}>
          {!index ? (
            <p className="pnil">Nothing is loaded yet.</p>
          ) : hits.length === 0 ? (
            <p className="pnil">
              Nothing matches <b>{query}</b>.
              {/* The dataset holds the declarations a repository owns and the
                  functions that do something notable, not every symbol that
                  was parsed. A reader who searched for a real name and found
                  nothing deserves to know which of those two happened. */}
              {index.totals.function > index.counts.function ? (
                <span>
                  {' '}Functions are searchable where they carry an effect, return an
                  unstructured error, or take three or more parameters —{' '}
                  {index.counts.function.toLocaleString()} of{' '}
                  {index.totals.function.toLocaleString()}.
                </span>
              ) : null}
            </p>
          ) : (
            <>
              {query ? null : <p className="phead">Largest crates, most-used types</p>}
              {hits.map((hit, i) => (
                <button
                  key={hit.key}
                  id={`hit-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className="phit"
                  // Pointer, not hover: moving the mouse across the list while
                  // arrowing through it should not fight the keyboard.
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(hit)}
                >
                  <Chip kind={hit.kind} />
                  <span className="nm">{hit.name}</span>
                  <span className="wh">{hit.where}</span>
                  <span className="nt">{hit.note}</span>
                </button>
              ))}
            </>
          )}
        </div>

        <div className="pfoot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>↵</kbd> open · <kbd>esc</kbd> close</span>
          {index ? (
            <span className="cts">
              {KIND_ORDER.map((k) => (
                <span key={k}>
                  {index.counts[k].toLocaleString()}
                  {index.totals[k] > index.counts[k] ? ` of ${index.totals[k].toLocaleString()}` : ''}
                  {' '}
                  {KIND_LABEL[k]}
                </span>
              ))}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The shortcut, and the button that says what it is.
 *
 * Slash as well as the modifier: it costs nothing, it is what every code host
 * uses, and someone who has never met a command palette is far likelier to
 * try it. Neither fires while something is already being typed into.
 */
export function useSearchKey(onOpen: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el?.isContentEditable === true;
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpen]);
}

/** Mac says ⌘K and everywhere else says Ctrl K, and guessing wrong is worse
 *  than not saying. The platform is only knowable once there is a window. */
export function SearchButton({ onOpen }: { onOpen: () => void }) {
  const [mac, setMac] = useState<boolean | null>(null);
  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), []);
  return (
    <button className="sbtn" onClick={onOpen} aria-label="Search this repository">
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <circle cx="7" cy="7" r="4.6" />
        <path d="M10.4 10.4 14 14" />
      </svg>
      <span className="lb">Search</span>
      <kbd>{mac === null ? '' : mac ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
  );
}
