import { useEffect, useMemo, useRef, useState } from 'react';

import type { Dataset } from '../lib/types';
import { loadCatalog, type Brand, type Catalog } from '../lib/catalog';
import { loadDataset, loadIndex, useStore, type RepoIndex } from '../lib/store';
import { liveDataset, liveIndex, type Stage } from '../lib/live';
import { defaultView, parsePath, sameView, toPath, type LevelId, type View } from '../lib/view';
import { transition } from '../lib/transition';
import { ElevationRail, type Elevation } from './ElevationRail';
import { RepoInput } from './RepoInput';
import { ThemePicker } from './ThemePicker';
import { TimeMachine } from './TimeMachine';
import { LevelView } from './LevelView';
import { Analysing, Working } from './Loading';

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
  // Which commit the report on screen is of. Not the same as the commit being
  // asked for: the address changes the moment it is clicked and the report
  // arrives afterwards, and anything derived from the address while the old
  // report is still up describes neither of them.
  const [shownAt, setShownAt] = useState<string | null>(null);
  // Changing repository is the one case where the report genuinely has to go:
  // it is about something else. Letting the page collapse to fetch the next one
  // pulls the colophon two thousand pixels up the screen and drops it back, so
  // the space it occupied is held until there is something to put in it.
  const main = useRef<HTMLElement>(null);
  const [held, setHeld] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // What the analysis running in this tab is doing, when one is.
  const [stage, setStage] = useState<Stage | null>(null);
  // One object rather than five pieces of state, because the URL describes all
  // of it at once and they have to stay in step.
  const [view, setView] = useState<View>(() => defaultView(''));
  const { repo: source, level, ref } = view;

  /** Changes the view and records it, so back returns here. */
  const go = (patch: Partial<View>) => {
    // Faded, because an elevation swaps its whole contents at once and a hard
    // cut reads as a flash. A commit fades later instead, when its report
    // arrives — that is the swap worth softening.
    transition(() =>
      setView((current) => {
        const next = { ...current, ...patch };
        if (sameView(current, next)) return current;
        window.history.pushState(next, '', toPath(next));
        // A different elevation or a different scope is a different view, and
        // it starts at its beginning. Landing partway down it — or wherever
        // the browser clamps a scroll when the new view is shorter — loses the
        // reader's place without giving them another one.
        //
        // A commit is not a different view. It is the same one a moment
        // earlier, which is the whole point of stepping through them, so the
        // page stays exactly where it is.
        const moved =
          next.level !== current.level || next.pkg !== current.pkg || next.file !== current.file;
        if (moved) window.scrollTo({ top: 0 });
        return next;
      }),
    );
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
    // Read before anything is cleared, while the previous report is still up.
    setHeld(main.current?.offsetHeight ?? null);
    setIndex(null);
    setData(null);
    setShownAt(null);
    setError(null);
    // Published first, because it is already analysed. A repository nobody has
    // exported still has commits, and they cost one request to list.
    loadIndex(source)
      .then((found) => found ?? liveIndex(source))
      .then((found) => { if (live) setIndex({ of: source, timeline: found }); })
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
    // Deliberately not clearing the report: the commit is changing, not the
    // repository, and a page that empties itself to fetch its replacement
    // flashes the whole of its content on every click. What is on screen stays
    // there, marked as busy, until there is something to put in its place.
    // Changing repository does clear it — that is the effect above.
    setStage(null);
    loadDataset(source, at)
      .then(async (found) => {
        if (!live) return found;
        if (found) return found;
        // Nothing published for this commit. It may be off the rail, or the
        // repository may simply never have been exported — either way the
        // source is still there to read.
        const sha = timeline.find((c) => c.short === at)?.sha ?? at;
        try {
          return await liveDataset(source, sha, (s) => { if (live) setStage(s); });
        } finally {
          if (live) setStage(null);
        }
      })
      .then((found) => {
        if (!live) return;
        if (found) {
          // The report on screen is the previous commit's. This is the moment
          // it becomes another's, so it is the moment worth fading — and the
          // moment the two agree again.
          transition(() => {
            setData(found);
            setShownAt(at);
            setHeld(null);
          });
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

  /**
   * Which slot the rail lights, and which commit the report describes. They
   * differ while one is arriving: the rail answers the click immediately,
   * because a menu that does not respond for a second feels broken, and the
   * report goes on describing itself truthfully until it is replaced.
   */
  const selected = timeline.findIndex((c) => c.short === ref);
  const commit = timeline.findIndex((c) => c.short === shownAt);

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

  // The elevations exist whether or not their contents have arrived, and they
  // keep their size while they wait. An empty count collapsed the line under
  // each name, taking 16px off every button and 96px off the rail — so the
  // page lost its left-hand side and put it back on every commit. Nothing is
  // known yet, and nothing is what zero says.
  const levels: Elevation[] = !source || error ? [] : [
    { id: 'L0', name: 'Score', count: `${data ? Object.keys(data.score.scores).length : 0} categories` },
    { id: 'L1', name: 'System', count: `${data ? data.effects.filter((e) => e.k === 'spawns').length : 0} spawns` },
    { id: 'L2', name: 'Packages', count: `${data ? data.packages.length : 0} crates` },
    { id: 'L3', name: 'Files', count: (data ? data.files.length : 0).toLocaleString() },
    { id: 'L4', name: 'Types', count: (data ? data.totals.types : 0).toLocaleString() },
    { id: 'L5', name: 'Functions', count: (data ? data.totals.functions : 0).toLocaleString() },
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
          {/* Always present, so the top of the page does not appear and
              disappear on every click. Zero is what is known so far. */}
          <span className="tot">
            <b>{(data?.totals.nodes ?? 0).toLocaleString()}</b> nodes ·{' '}
            <b>{(data?.totals.edges ?? 0).toLocaleString()}</b> edges ·{' '}
            <b>{(data?.totals.lines ?? 0).toLocaleString()}</b> lines
            {' · analyzed in '}
            <b title={data?.analysis?.cqx ? `cqx ${data.analysis.cqx}` : undefined}>
              {typeof data?.analysis?.ms === 'number' ? seconds(data.analysis.ms) : '0.0'}
            </b>
            s
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
            current={selected}
            // Only the commit. Stepping back while reading the functions of a
            // crate should show that crate's functions a commit earlier —
            // being returned to the score each time is what makes comparing
            // two commits impossible.
            onSelect={(i) => go({ ref: timeline[i]?.short ?? null })}
          />
        </div>

        <main ref={main} style={held && !data ? { minHeight: held } : undefined}>
          {error ? (
            <div className="empty">{error}</div>
          ) : !source ? (
            <div className="empty">
              Nothing to open. This deployment lists no repository, so name one
              in the address — <code>/{'{owner}'}/{'{repo}'}</code>.
            </div>
          ) : !data ? (
            stage ? (
              <Analysing repo={source} at={at} stage={stage} />
            ) : (
              <div className="empty">Loading {source}{at ? ` at ${at}` : ''}…</div>
            )
          ) : (
            // A report is up. Whatever is coming replaces it when it arrives,
            // in place — the page does not empty itself to fetch its successor.
            <div className={stage ? 'busy' : undefined}>
              {stage ? <Working at={at} stage={stage} /> : null}
              {level !== 'L0' && level !== 'L1' && level !== 'L2' ? scopeBar : null}
              <LevelView
                level={level}
                data={data}
                timeline={timeline}
                viewing={commit}
                at={shownAt}
                scopeName={packageName}
                files={files}
                types={types}
                functions={functions}
                onGo={go}
              />
            </div>
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
