import { useEffect, useMemo, useState } from 'react';

import type { Dataset } from '../lib/types';
import { ElevationRail, type Elevation } from './ElevationRail';
import { TimeMachine } from './TimeMachine';
import { ScoreLevel } from './levels/Score';
import { SystemLevel } from './levels/System';
import { PackagesLevel } from './levels/Packages';
import { FilesLevel } from './levels/Files';
import { TypesLevel } from './levels/Types';
import { FunctionsLevel } from './levels/Functions';

export type LevelId = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

const TIME_MACHINE_SLOTS = 5;

/**
 * The explorer.
 *
 * Scope persists downward: choosing a crate at L2 filters Files, Types and
 * Functions until it is cleared. L4 and L5 are siblings rather than a descent —
 * a file holds both, and what relates them is use, not containment.
 */
/** Datasets committed alongside the site, analysed ahead of time. */
const PREBAKED = [
  { id: 'deka', label: 'dekaruntime/deka' },
  { id: 'dsc', label: 'dekaruntime/dsc' },
] as const;

export function Explorer() {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string>(PREBAKED[0].id);
  const [level, setLevel] = useState<LevelId>('L0');
  const [pkg, setPkg] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [commit, setCommit] = useState(0);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    fetch(`${import.meta.env.BASE_URL}data/${source}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} fetching ${source}`))))
      .then((d: Dataset) => { if (live) setData(d); })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [source]);

  // Newest first: L0 is head, each step down is a commit further back.
  const timeline = useMemo(() => (data ? [...data.history].reverse() : []), [data]);

  const packageName = (id: string | null) =>
    id && data ? (data.packages.find((p) => p.id === id)?.name ?? null) : null;
  const filePath = file && data ? (data.files.find((f) => f.id === file)?.path ?? null) : null;

  const files = useMemo(
    () => (!data ? [] : pkg ? data.files.filter((f) => f.pkg === pkg) : data.files),
    [data, pkg],
  );
  const types = useMemo(() => {
    if (!data) return [];
    if (filePath) return data.types.filter((t) => t.file === filePath);
    if (pkg) return data.types.filter((t) => t.pkg === packageName(pkg));
    return data.types;
  }, [data, pkg, filePath]);
  const functions = useMemo(() => {
    if (!data) return [];
    if (filePath) return data.functions.filter((f) => f.file === filePath);
    if (pkg) return data.functions.filter((f) => f.pkg === packageName(pkg));
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
        scope: {pkg ? <b>{packageName(pkg)}</b> : null}
        {file ? <> / <b>{filePath}</b></> : null}
        <button onClick={() => { setPkg(null); setFile(null); }}>clear</button>
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
            <select value={source} onChange={(e) => { setSource(e.target.value); setPkg(null); setFile(null); setCommit(0); setLevel('L0'); }}>
              {PREBAKED.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
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
          <ElevationRail levels={levels} current={level} onSelect={setLevel} />
          <TimeMachine
            commits={timeline}
            slots={TIME_MACHINE_SLOTS}
            current={commit}
            onSelect={(i) => { setCommit(i); setLevel('L0'); }}
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
              onBackToHead={() => setCommit(0)}
              onJump={(l) => setLevel(l as LevelId)}
            />
          ) : level === 'L1' ? (
            <SystemLevel effects={data.effects} />
          ) : level === 'L2' ? (
            <PackagesLevel
              packages={data.packages}
              onSelect={(id) => { setPkg(id); setFile(null); setLevel('L3'); }}
            />
          ) : level === 'L3' ? (
            <FilesLevel
              files={files}
              scopeName={packageName(pkg)}
              onSelect={(id) => { setFile(id); setLevel('L4'); }}
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
    </>
  );
}
