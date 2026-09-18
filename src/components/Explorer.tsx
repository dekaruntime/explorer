import { useEffect, useMemo, useState } from 'react';

import type { Dataset } from '../lib/types';
import { defaultView, parsePath, sameView, toPath, type LevelId, type View } from '../lib/view';
import { ElevationRail, type Elevation } from './ElevationRail';
import { ThemePicker } from './ThemePicker';
import { TimeMachine } from './TimeMachine';
import { ScoreLevel } from './levels/Score';
import { SystemLevel } from './levels/System';
import { PackagesLevel } from './levels/Packages';
import { FilesLevel } from './levels/Files';
import { TypesLevel } from './levels/Types';
import { FunctionsLevel } from './levels/Functions';

const TIME_MACHINE_SLOTS = 5;

/**
 * The explorer.
 *
 * Scope persists downward: choosing a crate at L2 filters Files, Types and
 * Functions until it is cleared. L4 and L5 are siblings rather than a descent —
 * a file holds both, and what relates them is use, not containment.
 */
/**
 * Datasets committed alongside the site, analysed ahead of time.
 *
 * `repo` is the address; `file` is where the analysis of it lives.
 */
const PREBAKED = [
  { repo: 'dekaruntime/deka', file: 'deka' },
  { repo: 'dekaruntime/dsc', file: 'dsc' },
] as const;

const datasetFor = (repo: string): string =>
  PREBAKED.find((p) => p.repo === repo)?.file ?? PREBAKED[0].file;

const DEFAULT_REPO = PREBAKED[0].repo;

export function Explorer() {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One object rather than five pieces of state, because the URL describes all
  // of it at once and they have to stay in step.
  const [view, setView] = useState<View>(() => defaultView(DEFAULT_REPO));
  const { repo: source, level, ref } = view;

  /** Changes the view and records it, so back returns here. */
  const go = (patch: Partial<View>) => {
    setView((current) => {
      const next = { ...current, ...patch };
      if (sameView(current, next)) return current;
      window.history.pushState(next, '', toPath(next));
      return next;
    });
  };

  useEffect(() => {
    // The first render has to match the server's, so the URL is read after
    // mounting rather than during it, and replaces the entry instead of adding
    // one — arriving on a link should not need two backs to leave.
    const fromUrl = parsePath(window.location.pathname, DEFAULT_REPO);
    setView(fromUrl);
    window.history.replaceState(fromUrl, '', toPath(fromUrl));

    const onPop = () => setView(parsePath(window.location.pathname, DEFAULT_REPO));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    // Relative to the document, not to the origin: the site has to work when
    // it is served from a subpath as well as from a domain root.
    fetch(`/data/${datasetFor(source)}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} fetching ${source}`))))
      .then((d: Dataset) => { if (live) setData(d); })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [source]);

  // Newest first: the first entry is head, each one after it a commit further back.
  const timeline = useMemo(() => (data ? [...data.history].reverse() : []), [data]);
  const commit = Math.max(0, timeline.findIndex((c) => c.short === ref));

  useEffect(() => {
    // An address without a commit is not a stable address, so once the head is
    // known the URL is completed in place rather than by adding an entry.
    if (!data || view.ref || timeline.length === 0) return;
    const canonical = { ...view, ref: timeline[0]!.short };
    setView(canonical);
    window.history.replaceState(canonical, '', toPath(canonical));
  }, [data, view, timeline]);

  const packageName = view.pkg;
  const packageId =
    data && view.pkg ? (data.packages.find((p) => p.name === view.pkg)?.id ?? null) : null;
  const filePath = view.file;
  const pkg = packageId;
  const file = filePath;

  const files = useMemo(
    () => (!data ? [] : pkg ? data.files.filter((f) => f.pkg === pkg) : data.files),
    [data, pkg],
  );
  const types = useMemo(() => {
    if (!data) return [];
    if (filePath) return data.types.filter((t) => t.file === filePath);
    if (pkg) return data.types.filter((t) => t.pkg === packageName);
    return data.types;
  }, [data, pkg, filePath]);
  const functions = useMemo(() => {
    if (!data) return [];
    if (filePath) return data.functions.filter((f) => f.file === filePath);
    if (pkg) return data.functions.filter((f) => f.pkg === packageName);
    return data.functions;
  }, [data, pkg, filePath]);

  const levels: Elevation[] = !data ? [] : [
    { id: 'L0', name: 'Score', count: `${Object.keys(data.score.scores).length} categories` },
    { id: 'L1', name: 'System', count: `${data.effects.filter((e) => e.k === 'spawns').length} spawns` },
    { id: 'L2', name: 'Packages', count: `${data.packages.length} crates` },
    { id: 'L3', name: 'Files', count: data.files.length.toLocaleString() },
    { id: 'L4', name: 'Types', count: data.totals.types.toLocaleString() },
    { id: 'L5', name: 'Functions', count: data.totals.functions.toLocaleString() },
  ];

  const scopeBar =
    data && (pkg || file) ? (
      <div className="scope">
        scope: {packageName ? <b>{packageName}</b> : null}
        {file ? <> / <b>{filePath}</b></> : null}
        <button onClick={() => go({ pkg: null, file: null, level: 'L2' })}>clear</button>
      </div>
    ) : null;

  if (error) {
    return (
      <div className="wrap" style={{ paddingBlock: 40 }}>
        <div className="empty">Could not load the dataset: {error}</div>
      </div>
    );
  }

  return (
    <>
      <header>
        <div className="wrap hdr">
          <span className="brand">c<b>q</b>x</span>
          <span className="repo">
            {data?.commits_url ? (
              <a className="tmlink" href={data.commits_url} target="_blank" rel="noopener">
                {data.repo} ↗
              </a>
            ) : (
              data?.repo ?? 'loading…'
            )}
          </span>
          <label className="picker">
            <span className="dim">repo</span>
            <select
              value={source}
              onChange={(e) =>
                go({ repo: e.target.value, pkg: null, file: null, ref: null, level: 'L0' })
              }
            >
              {PREBAKED.map((p) => (
                <option key={p.repo} value={p.repo}>{p.repo}</option>
              ))}
            </select>
          </label>
          <span className="tot">
            {data ? (
              <>
                <b>{data.totals.nodes.toLocaleString()}</b> nodes ·{' '}
                <b>{data.totals.edges.toLocaleString()}</b> edges ·{' '}
                <b>{data.totals.lines.toLocaleString()}</b> lines
              </>
            ) : null}
          </span>
        </div>
      </header>

      <div className="wrap shell">
        <div className="sidebar">
          <ElevationRail levels={levels} current={level} onSelect={(id) => go({ level: id })} />
          <TimeMachine
            commits={timeline}
            slots={TIME_MACHINE_SLOTS}
            current={commit}
            onSelect={(i) => go({ ref: timeline[i]?.short ?? null, level: 'L0' })}
          />
        </div>

        <main>
          {!data ? (
            <div className="empty">Loading {source}…</div>
          ) : (
            <>
          {level !== 'L0' && level !== 'L1' && level !== 'L2' ? scopeBar : null}

          {level === 'L0' ? (
            <ScoreLevel
              score={data.score}
              commits={timeline}
              viewing={commit}
              onBackToHead={() => go({ ref: timeline[0]?.short ?? null })}
              onJump={(l) => go({ level: l as LevelId })}
            />
          ) : level === 'L1' ? (
            <SystemLevel effects={data.effects} />
          ) : level === 'L2' ? (
            <PackagesLevel
              packages={data.packages}
              onSelect={(id) =>
                go({
                  pkg: data.packages.find((p) => p.id === id)?.name ?? null,
                  file: null,
                  level: 'L3',
                })
              }
            />
          ) : level === 'L3' ? (
            <FilesLevel
              files={files}
              scopeName={packageName}
              onSelect={(id) =>
                go({ file: data.files.find((f) => f.id === id)?.path ?? null, level: 'L4' })
              }
            />
          ) : level === 'L4' ? (
            <TypesLevel types={types} />
          ) : (
            <FunctionsLevel
              functions={functions}
              notable={data.totals.notable}
              total={data.totals.functions}
            />
          )}
            </>
          )}
        </main>
      </div>

      <footer className="colophon">
        powered by{' '}
        <a href="https://github.com/samifouad/cqx" target="_blank" rel="noopener">cqx</a>
        {' '}by{' '}
        <a href="https://samifou.ad" target="_blank" rel="noopener">Sami Fouad</a>
        <ThemePicker />
      </footer>
    </>
  );
}
