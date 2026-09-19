import { useEffect, useMemo, useRef, useState } from 'react';

import {
  policy,
  type Commit,
  type Dataset,
  loadCatalog,
  type Brand,
  type Catalog,
  loadDataset,
  loadIndex,
  useStore,
  type RepoIndex,
  liveDataset,
  liveIndex,
  type Stage,
  fetchCommits,
  fetchReleases,
  type ReleaseRef,
  defaultView,
  parsePath,
  sameView,
  toPath,
  type LevelId,
  type View,
} from 'cqx-kit/engine';
import { transition } from '../lib/transition';
import { installHost } from '../lib/host';
import { ElevationRail, type Elevation } from './ElevationRail';
import { RepoInput } from './RepoInput';
import { ThemePicker } from './ThemePicker';
import { TimeMachine, type TimeMachineTab } from './TimeMachine';
import { LevelView } from './LevelView';
import { Search, SearchButton, useSearchKey } from './Search';
import { Analysing, Working } from './Loading';

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
function BrandMark({ brand, onHome }: { brand: Brand; onHome: (() => void) | null }) {
  const inner = brand.icon ? (
    <img src={brand.icon} alt={brand.name} width={30} height={30} />
  ) : (
    brand.name
  );
  if (!brand.href) return <span className="brand" title={brand.name}>{inner}</span>;
  // Routed only when there is something here to route to. A local href used
  // to be proof of that, back when the explorer was the whole deployment and
  // `/` could only mean a repository. On a site whose front page is somebody
  // else's — cqx.bio's is marketing — `/` is a different page and taking the
  // click over just moved the reader nowhere.
  const routed = onHome !== null && brand.href.startsWith('/');
  return (
    <a
      className="brand"
      href={brand.href}
      title={brand.name}
      onClick={(e) => {
        if (!routed || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
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
  // Releases, held separately from the timeline: they always come from the API
  // — a published repository's own store knows nothing about tags — and a
  // repository that has never released anything still has a timeline. Null
  // means "asked for, not answered yet", which is what lets the tab default
  // to commits only once the answer is known to be "none" rather than on
  // every render before it arrives.
  const [releases, setReleases] = useState<{
    of: string;
    list: ReleaseRef[];
    /** Why the list is empty, when it is empty for a reason. */
    trouble?: string;
  } | null>(null);
  // Null until the reader picks one. Until then the effective tab follows the
  // data: releases, unless the repository turns out to have none.
  const [tab, setTab] = useState<TimeMachineTab | null>(null);
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
  /** Why the rail is empty, when the report beside it is not. */
  const [timelineTrouble, setTimelineTrouble] = useState<string | null>(null);
  // One object rather than five pieces of state, because the URL describes all
  // of it at once and they have to stay in step.
  const [view, setView] = useState<View>(() => defaultView(''));
  const { repo: source, level, ref } = view;
  const [searching, setSearching] = useState(false);
  useSearchKey(() => setSearching(true));

  /** Changes the view and records it, so back returns here. */
  const go = (patch: Partial<View>) => {
    // Faded, because an elevation swaps its whole contents at once and a hard
    // cut reads as a flash. A commit fades later instead, when its report
    // arrives — that is the swap worth softening.
    transition(() =>
      setView((current) => {
        // Focus belongs to the thing that asked for it. Any other move — an
        // elevation, a scope, a commit — leaves it behind, or a row stays
        // pinned to the top of a list nobody searched.
        const next = { ...current, focus: null, ...patch };
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
    // Before anything asks the engine for anything. Here rather than at module
    // scope because it reads `location`, and this component is rendered on the
    // server too — where there is none.
    installHost();
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
      const fromUrl = parsePath(window.location.pathname, window.location.hash, '');
      const resolved = fromUrl.repo
        ? fromUrl
        : { ...fromUrl, repo: found.default ?? '' };
      setView(resolved);
      if (resolved.repo) window.history.replaceState(resolved, '', toPath(resolved));
    });

    const onPop = () =>
      setView((current) => parsePath(window.location.pathname, window.location.hash, current.repo));
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
    setTimelineTrouble(null);
    setReleases(null);
    setTab(null);
    // Published first, because it is already analysed. A repository nobody has
    // exported still has commits, and they cost one request to list.
    loadIndex(source)
      .then((found) => found ?? liveIndex(source))
      .then((found) => { if (live) setIndex({ of: source, timeline: found }); })
      .catch((e: Error) => {
        if (!live) return;
        // An address that names a commit does not need the timeline to show
        // that commit: the dataset may well be held already, and the rail is
        // the only part that cannot be drawn. Losing the whole report because
        // the list of its neighbours was refused helps nobody.
        if (view.ref) setTimelineTrouble(e.message);
        else setError(e.message);
      });
    // Independent of the timeline above: a published repository's store has no
    // idea what its tags are, and an unpublished one is worth listing releases
    // for before anything has been analysed. A repository with no releases —
    // most of them — answers with an empty list, not an error.
    fetchReleases(source, policy.releases)
      .then((list) => { if (live) setReleases({ of: source, list }); })
      // A refused request is not an absence of releases, and saying so would
      // be telling the reader something untrue about their repository.
      .catch((e: Error) => {
        if (live) setReleases({ of: source, list: [], trouble: e.message });
      });
    return () => { live = false; };
  }, [source]);

  // Newest first: the first entry is head, each one after it a commit further back.
  const repoIndex = index?.of === source ? index.timeline : null;
  const published = useMemo(
    () => (repoIndex ? [...repoIndex.commits].reverse() : []),
    [repoIndex],
  );
  // A published repository's index carries the five commits its CI exported,
  // and the rail asks for twenty. Filling the difference with empty slots said
  // fifteen commits were still arriving when nothing was: they had simply
  // never been published. The rest of the list is asked for separately — one
  // request, cached — and the store still answers for the five it holds, so
  // those open instantly and the others are read here.
  const [extra, setExtra] = useState<{ of: string; commits: Commit[] } | null>(null);
  useEffect(() => {
    if (!source || published.length === 0 || published.length >= policy.commits) return;
    let live = true;
    fetchCommits(source, policy.commits)
      .then((found) => {
        if (!live) return;
        setExtra({
          of: source,
          commits: found.map((c) => ({ ...c, lines: 0, scores: {}, delta: {} })),
        });
      })
      // The rail is worth having with five entries; a refused request is not
      // worth an error over.
      .catch(() => {});
    return () => { live = false; };
  }, [source, published.length]);

  const timeline = useMemo(() => {
    if (extra?.of !== source) return published;
    // What is published wins where it exists: it carries the scores.
    const known = new Map(published.map((c) => [c.short, c]));
    return extra.commits.map((c) => known.get(c.short) ?? c);
  }, [published, extra, source]);
  // An address that names a commit is honoured even when the timeline does not
  // list it: the store keeps every commit it has ever been given, and only the
  // five most recent are on the rail. Whether it exists is the fetch's answer,
  // not a guess made here.
  // Releases are fetched independently of the timeline above (see the effect
  // that clears them), so they can lag a render behind a repository change —
  // the guard keeps the previous repository's list from flashing under the
  // new one's tabs for a frame.
  const releaseList = releases?.of === source ? releases.list : null;
  const releaseTrouble = releases?.of === source ? releases.trouble : undefined;
  //
  // `policy.opensAt` said `release` and only the tab listened: the rail opened
  // on releases while the report underneath was of the newest commit, so the
  // highlighted release and the thing being read were two different commits.
  //
  // `undefined` is the third answer and the one that matters — releases have
  // been asked for and not answered. Reading head in the meantime would load
  // a large file, show it, and then replace it a moment later with the one
  // that was wanted.
  const opening = useMemo((): string | null | undefined => {
    if (policy.opensAt !== 'release') return null;
    if (!releaseList) return releaseTrouble ? null : undefined;
    // The newest release whose commit could be resolved. A tag GitHub did not
    // return in the bulk lookup names no sha and cannot be opened.
    return releaseList.find((r) => r.sha)?.sha?.slice(0, 8) ?? null;
  }, [releaseList, releaseTrouble]);

  const at =
    view.ref ?? (opening === undefined ? null : (opening ?? timeline[0]?.short ?? null));

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
   * Which commit the report describes. Differs from `ref` while one is
   * arriving: the rail answers the click immediately, because a menu that
   * does not respond for a second feels broken, and the report goes on
   * describing itself truthfully until it is replaced.
   */
  const commit = timeline.findIndex((c) => c.short === shownAt);

  // Null (still asked for) reads as the default, releases. Only once the
  // answer is known to be empty does the fallback to commits apply — and only
  // until the reader picks a tab themselves, which is remembered from there.
  const effectiveTab: TimeMachineTab =
    tab ?? (releaseList && releaseList.length === 0 ? 'commits' : policy.opensAt === 'release' ? 'releases' : 'commits');

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
      <Search
        data={data}
        open={searching}
        onClose={() => setSearching(false)}
        onGo={go}
      />
      <header>
        <div className="wrap hdr">
          {/* Whose deployment this is, if it said. The mark is deka's on
              explorer.deka.gg and absent on a directory somebody exported of
              their own repository — which is the whole reason it is declared
              rather than built in. */}
          {catalog?.brand ? (
            <BrandMark
              brand={catalog.brand}
              onHome={
                catalog.default
                  ? () =>
                      go({
                        repo: catalog.default as string,
                        ref: null,
                        pkg: null,
                        file: null,
                        level: 'L0',
                      })
                  : null
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
          {/* Only once there is something to search. An empty palette over an
              empty page is chrome pretending to be a feature. */}
          {data ? <SearchButton onOpen={() => setSearching(true)} /> : null}
          {/* Always present, so the top of the page does not appear and
              disappear on every click. Zero is what is known so far. */}
          <span className="tot">
            <b>{(data?.totals.nodes ?? 0).toLocaleString()}</b> nodes ·{' '}
            <b>{(data?.totals.edges ?? 0).toLocaleString()}</b> edges ·{' '}
            <b>{(data?.totals.lines ?? 0).toLocaleString()}</b> lines
            {/* One number, and it is the whole wait. Nothing can be parsed
                before it has been read, so reporting only the parse tells a
                reader they waited a third of what they did. A dataset from the
                store carries no fetch of its own — the reading happened in CI,
                which is why the published repositories are quick. The split is
                on the hover. */}
            {' · analyzed in '}
            <b
              title={
                data?.analysis
                  ? [
                      data.analysis.fetch ? `${seconds(data.analysis.fetch)}s fetching` : null,
                      typeof data.analysis.ms === 'number'
                        ? `${seconds(data.analysis.ms)}s analysing${
                            (data.analysis.readers ?? 1) > 1
                              ? ` across ${data.analysis.readers} threads`
                              : ''
                          }`
                        : null,
                      data.analysis.held
                        ? `${Math.round(data.analysis.held / 1e6).toLocaleString()} MB per reader`
                        : null,
                      data.analysis.cqx ? `cqx ${data.analysis.cqx}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : undefined
              }
            >
              {typeof data?.analysis?.ms === 'number'
                ? seconds(data.analysis.ms + (data.analysis.fetch ?? 0))
                : '0.0'}
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
            releases={error ? [] : releaseList}
            releasesTrouble={releaseTrouble}
            trouble={timelineTrouble}
            // Only as many as there are. An empty slot means "still arriving",
            // and nothing is arriving for a commit nobody has heard of.
            slots={error ? 0 : Math.min(policy.commits, Math.max(timeline.length, 1))}
            active={ref}
            tab={effectiveTab}
            onTabChange={setTab}
            // Only the commit. Stepping back while reading the functions of a
            // crate should show that crate's functions a commit earlier —
            // being returned to the score each time is what makes comparing
            // two commits impossible.
            onSelectCommit={(i) => go({ ref: timeline[i]?.short ?? null })}
            onSelectRelease={(release) => go({ ref: release.sha?.slice(0, 8) ?? null })}
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
                focus={view.focus}
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
