import { useEffect, useMemo, useState } from 'react';

import type { Dataset } from '../lib/types';
import { loadCatalog, type Brand, type Catalog } from '../lib/catalog';
import { loadDataset, loadIndex, useStore, type RepoIndex } from '../lib/store';
import { defaultView, parsePath, sameView, toPath, type LevelId, type View } from '../lib/view';
import { ElevationRail, type Elevation } from './ElevationRail';
import { RepoInput } from './RepoInput';
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
 * Milliseconds as seconds, to one place — except below a tenth, where one
 * place would round a real measurement down to nothing.
 */
const seconds = (ms: number): string => (ms / 1000).toFixed(ms < 100 ? 2 : 1);

/**
 * The deployment's own mark. The name carries it only when there is no image —
 * a mark and its wordmark beside each other says the same thing twice.
 *
 * A mark pointing somewhere in this deployment is routed rather than followed:
 * reloading the page to reach a view the page can already render costs a
 * second for nothing. It stays a real link, so opening it in a tab still
 * works — only a plain click is taken over.
 */
function BrandMark({ brand, onHome }: { brand: Brand; onHome: () => void }) {
  const inner = brand.icon ? (
    <img src={brand.icon} alt={brand.name} width={30} height={30} />
  ) : (
    brand.name
  );
  if (!brand.href) return <span className="brand" title={brand.name}>{inner}</span>;
  const local = brand.href.startsWith('/');
  return (
    <a
      className="brand"
      href={brand.href}
      title={brand.name}
      onClick={(e) => {
        if (!local || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onHome();
      }}
    >
      {inner}
    </a>
  );
}

/**
 * The explorer.
 *
 * Scope persists downward: choosing a crate at L2 filters Files, Types and
 * Functions until it is cleared. L4 and L5 are siblings rather than a descent —
 * a file holds both, and what relates them is use, not containment.
 */




export function Explorer() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  // The timeline and the commit are fetched separately on purpose: the timeline
  // is one small file that changes, and a commit is a large one that never
  // does. Moving through the time machine costs one immutable fetch.
  //
  // Held with the repository it describes. Without that, changing repository
  // leaves the old timeline standing for a render, and the head it names gets
  // written into the new repository's address — which then has no dataset.
  const [index, setIndex] = useState<{ of: string; timeline: RepoIndex } | null>(null);
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One object rather than five pieces of state, because the URL describes all
  // of it at once and they have to stay in step.
  const [view, setView] = useState<View>(() => defaultView(''));
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
    let live = true;
    // What exists comes from the deployment, not from this file.
    loadCatalog().then((found) => {
      if (!live) return;
      // Before anything is fetched: where this deployment keeps its own data,
      // if it keeps any.
      useStore(found.store);
      setCatalog(found);
      // The first render has to match the server's, so the URL is read after
      // mounting rather than during it, and replaces that entry instead of
      // adding one — arriving on a link should not take two backs to leave.
      //
      // An address always wins. The manifest says what to open with, not what
      // is allowed: a repository nobody listed is still a repository, and
      // bouncing someone back to a default would make most addresses lies.
      const fromUrl = parsePath(window.location.pathname, '');
      const resolved = fromUrl.repo
        ? fromUrl
        : { ...fromUrl, repo: found.default ?? '' };
      setView(resolved);
      if (resolved.repo) window.history.replaceState(resolved, '', toPath(resolved));
    });

    const onPop = () => setView((current) => parsePath(window.location.pathname, current.repo));
    window.addEventListener('popstate', onPop);
    return () => {
      live = false;
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  useEffect(() => {
    if (!source) return;
    let live = true;
    setIndex(null);
    setData(null);
    setError(null);
    loadIndex(source)
      .then((found) => {
        if (!live) return;
        if (!found) {
          throw new Error(
            `Nothing has been exported for ${source}. ` +
              `Run \`cqx export\` against it, or open one this deployment lists.`,
          );
        }
        setIndex({ of: source, timeline: found });
      })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [source]);

  // Newest first: the first entry is head, each one after it a commit further back.
  const repoIndex = index?.of === source ? index.timeline : null;
  const timeline = useMemo(
    () => (repoIndex ? [...repoIndex.commits].reverse() : []),
    [repoIndex],
  );
  // An address that names a commit is honoured even when the timeline does not
  // list it: the store keeps every commit it has ever been given, and only the
  // five most recent are on the rail. Whether it exists is the fetch's answer,
  // not a guess made here.
  const at = view.ref ?? timeline[0]?.short ?? null;

  useEffect(() => {
    if (!source || !at) return;
    let live = true;
    setData(null);
    loadDataset(source, at)
      .then((found) => {
        if (!live) return;
        if (found) {
          setData(found);
          return;
        }
        // The store keeps every commit it has ever been given, so an address
        // off the rail is usually still there. When it is not — a commit from
        // another repository, a typo, something never exported — the
        // repository itself is still meaningful, so this drops to its head
        // rather than dead-ending. In place, so the bad address does not
        // become somewhere the back button returns to.
        const head = timeline[0]?.short;
        if (head && head !== at) {
          setView((current) => {
            const canonical = { ...current, ref: head };
            window.history.replaceState(canonical, '', toPath(canonical));
            return canonical;
          });
          return;
        }
        throw new Error(
          `${source} has a timeline, but nothing has been exported at ${at}.`,
        );
      })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [source, at, timeline]);

  useEffect(() => {
    // An address without a commit is not a stable address, so once the head is
    // known the URL is completed in place rather than by adding an entry.
    if (!at || view.ref === at) return;
    const canonical = { ...view, ref: at };
    setView(canonical);
    window.history.replaceState(canonical, '', toPath(canonical));
  }, [view, at]);

  /** Which slot on the rail is lit; -1 when looking at a commit off it. */
  const commit = timeline.findIndex((c) => c.short === ref);

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

  return (
    <>
      <header>
        <div className="wrap hdr">
          {/* Whose deployment this is, if it said. The mark is deka's on
              explorer.deka.gg and absent on a directory somebody exported of
              their own repository — which is the whole reason it is declared
              rather than built in. */}
          {catalog?.brand ? (
            <BrandMark
              brand={catalog.brand}
              onHome={() =>
                go({
                  repo: catalog.default ?? source,
                  ref: null,
                  pkg: null,
                  file: null,
                  level: 'L0',
                })
              }
            />
          ) : (
            <span className="brand">c<b>q</b>x</span>
          )}
          <RepoInput
            value={source}
            suggestions={catalog?.entries.map((e) => e.repo) ?? []}
            onOpen={(repo) => go({ repo, pkg: null, file: null, ref: null, level: 'L0' })}
          />
          <span className="tot">
            {data ? (
              <>
                <b>{data.totals.nodes.toLocaleString()}</b> nodes ·{' '}
                <b>{data.totals.edges.toLocaleString()}</b> edges ·{' '}
                <b>{data.totals.lines.toLocaleString()}</b> lines
                {/* Only when something actually timed it. A dataset written
                    before cqx recorded this has no honest number to show. */}
                {typeof data.analysis?.ms === 'number' ? (
                  <>
                    {' · analyzed in '}
                    <b title={`cqx ${data.analysis.cqx}`}>{seconds(data.analysis.ms)}</b>
                    s
                  </>
                ) : null}
              </>
            ) : null}
          </span>
        </div>
      </header>

      <div className="wrap shell">
        <div className="sidebar">
          <ElevationRail levels={levels} current={level} onSelect={(id) => go({ level: id })} />
          {/* Empty slots read as "still arriving". Nothing is arriving for a
              repository that has no timeline to fetch, so the rail goes with
              the elevations rather than sitting there pretending. */}
          <TimeMachine
            commits={timeline}
            slots={error ? 0 : TIME_MACHINE_SLOTS}
            current={commit}
            onSelect={(i) => go({ ref: timeline[i]?.short ?? null, level: 'L0' })}
          />
        </div>

        <main>
          {error ? (
            <div className="empty">{error}</div>
          ) : !source ? (
            <div className="empty">
              Nothing to open. This deployment lists no repository, so name one
              in the address — <code>/{'{owner}'}/{'{repo}'}</code>.
            </div>
          ) : !data ? (
            <div className="empty">Loading {source}{at ? ` at ${at}` : ''}…</div>
          ) : (
            <>
          {level !== 'L0' && level !== 'L1' && level !== 'L2' ? scopeBar : null}

          {level === 'L0' ? (
            <ScoreLevel
              score={data.score}
              commits={timeline}
              viewing={commit}
              at={at}
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
        <a className="cqx" href="https://github.com/samifouad/cqx" target="_blank" rel="noopener">
          c<b>q</b>x
        </a>
        {' '}by{' '}
        <a href="https://samifou.ad" target="_blank" rel="noopener">Sami Fouad</a>
        <ThemePicker />
      </footer>
    </>
  );
}
