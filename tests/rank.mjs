/**
 * The ranker, on its own.
 *
 * The browser test proves the palette is wired up; it cannot prove that the
 * right thing is at the top, because what a real repository contains changes
 * under it. These are the orderings that have to hold whatever is loaded.
 *
 * Run with `node tests/rank.mjs` — Node strips the types, and the module has
 * no runtime imports to resolve.
 */
import { buildIndex, search } from '../src/lib/search.ts';

let failed = 0;
const check = (what, cond, detail = '') => {
  if (cond) console.log('  ok  ' + what);
  else { failed++; console.error('FAIL: ' + what + (detail ? ' — ' + detail : '')); }
};

/** A dataset with only the fields the index reads. */
function dataset({ crates = [], files = [], types = [], functions = [] }) {
  return {
    packages: crates.map((name, i) => ({ id: `pkg:${name}`, name, files: 1, lines: 100 + i, eff: {}, deps: [], ext: 0, bins: [] })),
    files: files.map((path, i) => ({ id: `f${i}`, path, lines: 50, pkg: `pkg:${crates[0] ?? 'x'}`, n: 1, eff: {} })),
    types: types.map((name, i) => ({ id: `t${i}`, name, k: 'struct', pkg: crates[0] ?? null, file: null, lines: 10, fields: [], uses: 1 })),
    functions: functions.map((name, i) => ({ id: `fn${i}`, name, k: 'fn', pkg: crates[0] ?? null, file: null, lines: 10, p: [], r: null, eff: [] })),
    totals: { types: types.length, functions: functions.length, notable: 0, nodes: 0, edges: 0, lines: 0 },
  };
}

const names = (hits) => hits.map((h) => h.name);

// 1. The tiers, in order, all matching the same query.
{
  const index = buildIndex(dataset({
    functions: ['parse', 'parse_expr', 'try_parse', 'reparse_all_sources', 'plan_and_retry_soon'],
  }));
  const got = names(search(index, 'parse'));
  check('exact leads', got[0] === 'parse', got.join(' > '));
  check('prefix before substring', got.indexOf('parse_expr') < got.indexOf('try_parse'), got.join(' > '));
  check('boundary before mid-word', got.indexOf('try_parse') < got.indexOf('reparse_all_sources'), got.join(' > '));
}

// 2. Shorter wins within a tier: two prefixes, the tighter one first.
{
  const index = buildIndex(dataset({ types: ['Config', 'ConfigurationBuilderOptions'] }));
  const got = names(search(index, 'conf'));
  check('the tighter prefix leads', got[0] === 'Config', got.join(' > '));
}

// 3. Abbreviations people actually type.
{
  const index = buildIndex(dataset({
    functions: ['read_to_string', 'resolve_target_symbol'],
    types: ['HashMap'],
    crates: ['deka_http'],
  }));
  check('rts finds read_to_string', names(search(index, 'rts')).includes('read_to_string'));
  check('hm finds HashMap', names(search(index, 'hm')).includes('HashMap'));
  check('two words find one name', names(search(index, 'deka http')).includes('deka_http'));
}

// 4. The coincidence this test exists for. Every letter of `enforce` appears
//    in order in this name and it is not a match; a real repository with
//    nothing better to offer put it at the top of the palette.
{
  const index = buildIndex(dataset({
    functions: ['self_contained_inlines_prelude_for_separate_scopes'],
  }));
  check('scattered letters mid-word are not a match', search(index, 'enforce').length === 0,
    names(search(index, 'enforce')).join(', '));
}

// 5. Nothing matching means nothing, not everything.
{
  const index = buildIndex(dataset({ types: ['Alpha', 'Beta'], functions: ['run'] }));
  check('a miss is empty', search(index, 'zzzz').length === 0);
}

// 6. An empty query suggests rather than sits blank.
{
  const index = buildIndex(dataset({ crates: ['a', 'b'], types: ['T'] }));
  check('empty query offers a starting point', search(index, '').length > 0);
}

// 7. A crate leads a function of the same name — coarser, and rarer.
{
  const index = buildIndex(dataset({ crates: ['render'], functions: ['render'] }));
  const got = search(index, 'render');
  check('crate leads a same-named function', got[0]?.kind === 'crate', got.map((h) => h.kind).join(' > '));
}

// 8. What search hands the explorer has to be somewhere it can go.
{
  const index = buildIndex(dataset({ crates: ['cli'], files: ['crates/cli/src/main.rs'], types: ['Args'], functions: ['run'] }));
  const every = search(index, '');
  const all = [...every, ...search(index, 'a'), ...search(index, 'r')];
  check('every hit names a level', all.every((h) => /^L[0-5]$/.test(h.go.level ?? '')));
  check('a type hit carries its focus', search(index, 'Args').every((h) => h.kind !== 'type' || h.go.focus === h.name));
  check('a file hit names its crate, not its id',
    search(index, 'main.rs').every((h) => h.kind !== 'file' || h.go.pkg === 'cli'));
}

// 9. Letters-in-order matches fill a corner of the list, not the rest of it.
//    A path has a word boundary every few characters, so a three-letter query
//    anchors somewhere in half the files in a repository — and those used to
//    pad twenty-four rows under four real answers.
{
  const index = buildIndex(dataset({
    types: ['Span', 'Spanned'],
    files: Array.from({ length: 40 }, (_, i) => `crates/deka_syntax/src/parse/part${i}.rs`),
  }));
  const got = search(index, 'spa', 24);
  const solid = got.filter((h) => h.name.toLowerCase().includes('spa'));
  check('what contains the query leads', got[0]?.name === 'Span', names(got).slice(0, 3).join(' > '));
  check('loose matches take a corner, not the list',
    got.length - solid.length <= 6, `${got.length - solid.length} loose of ${got.length}`);
}

// 10. Except when they are the only answer worth having.
{
  const index = buildIndex(dataset({ functions: ['read_to_string'] }));
  check('a lone abbreviation still answers', names(search(index, 'rts')).includes('read_to_string'));
}

console.log(failed ? `\n${failed} failed` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
