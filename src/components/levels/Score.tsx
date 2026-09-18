import type { Commit, Score } from "../../lib/types";
import { band } from "../../lib/types";
import { useEased } from "../../lib/animate";

const CATEGORY_MEANING: Record<string, string> = {
  quality:
    "Reinvention and silencing: the same thing written twice, and the compiler told not to mention it. These are the shapes code takes when it is written fast by many hands.",
  containment:
    "Whether an effect stays in the crate that should own it. A library reaching for the process is the clearest case — it takes a decision away from every caller.",
  security:
    "Reach that somebody else could steer. Not how much the code can do, but how much of what it does is decided at runtime by something outside it.",
  legibility:
    "How much of this codebase could be proved rather than guessed at. A measurement of certainty, not a judgement — but what a parser cannot follow, the next author cannot either.",
  modularity:
    "House standards rather than facts about good code. Measured across ripgrep, tokio and deno, file length tracks a project's habits, so these defaults are deliberately lenient and the thresholds are yours to set.",
};

function Ring({
  category,
  value,
  delta,
  since,
  onSelect,
}: {
  category: string;
  value: number;
  delta: number | null;
  since: string | null;
  onSelect: () => void;
}) {
  const r = 26;
  const circumference = 2 * Math.PI * r;
  // The arc and the figure both follow the sweep; the colour follows the score
  // itself, so a ring crossing a band changes colour when it earns it rather
  // than when the animation happens to pass the threshold.
  const swept = useEased(value);
  const colour = `var(--${band(value)})`;
  return (
    <button className="ring" onClick={onSelect}>
      <svg viewBox="0 0 62 62">
        {/* A wash of the band colour, so the score reads before the number does. */}
        <circle cx="31" cy="31" r="28" fill={`var(--${band(value)}-bg)`} />
        <circle className="tr" cx="31" cy="31" r={r} stroke={colour} />
        <circle
          className="ar"
          cx="31"
          cy="31"
          r={r}
          stroke={colour}
          strokeDasharray={circumference.toFixed(1)}
          strokeDashoffset={(circumference * (1 - swept / 100)).toFixed(2)}
        />
        <text className="nm" x="31" y="31" fill={colour}>
          {Math.round(swept)}
        </text>
      </svg>
      <span className="cap">
        {category[0]?.toUpperCase()}
        {category.slice(1)}
      </span>
      {/* Silent when nothing moved: an unchanged score is the common case. */}
      {delta !== null && delta !== 0 && since ? (
        <span className={`dl ${delta > 0 ? "up" : "dn"}`}>
          {delta > 0 ? "+" : ""}
          {delta} since commit {since}
        </span>
      ) : null}
    </button>
  );
}

export function ScoreLevel({
  score,
  commits,
  viewing,
  at,
  onBackToHead,
  onJump,
}: {
  score: Score;
  commits: Commit[];
  /** Which slot on the rail, or -1 for a commit the rail does not list. */
  viewing: number;
  /** The commit being looked at, which is the only name an off-rail one has. */
  at: string | null;
  onBackToHead: () => void;
  onJump: (level: string) => void;
}) {
  const head = viewing === 0;
  const commit = commits[viewing] ?? null;
  // Off the rail there is no predecessor to compare against — the store holds
  // the commit, not what came before it — so no movement is claimed.
  const previous = viewing < 0 ? null : (commits[viewing + 1] ?? null);
  // Every score on this page comes from the report, because the report is of
  // the commit being shown. The timeline is only consulted for what came
  // before it.
  const scores = score.scores;

  return (
    <div>
      <h2>CodeQuality Score</h2>
      {!head && (commit || at) ? (
        <div className="scope">
          viewing <b>{commit?.short ?? at}</b>
          {commit
            ? ` · ${commit.subject}`
            : " · not among the commits on the rail"}
          <button onClick={onBackToHead}>back to head</button>
        </div>
      ) : (
        <p className="lede">
          Every category starts at 100 and is degraded only by a named rule with
          a published weight and a cap. Each section below says what was
          measured, why it counts, and what to do about it.
        </p>
      )}

      <div className="rings">
        {Object.entries(scores).map(([category, value]) => (
          <Ring
            key={category}
            category={category}
            value={value}
            delta={
              previous ? value - (previous.scores[category] ?? value) : null
            }
            since={previous?.short ?? null}
            onSelect={() =>
              document
                .getElementById(`cat-${category}`)
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          />
        ))}
      </div>

      {Object.entries(scores).map(([category, value]) => {
        const rules = score.rules
          .filter((r) => r.category === category)
          .sort((a, b) => b.deducted - a.deducted);
        const lost = rules.reduce((a, r) => a + r.deducted, 0);
        return (
          <section className="cat" id={`cat-${category}`} key={category}>
            <div className="ch">
              <span className="cs" style={{ color: `var(--${band(value)})` }}>
                {value}
              </span>
              <h3>
                {category[0]?.toUpperCase()}
                {category.slice(1)}
              </h3>
              <span className="cl">
                100 {lost > 0 ? `− ${lost.toFixed(1)}` : ""} ·{" "}
                {rules.filter((r) => r.deducted > 0).length} of {rules.length}{" "}
                rules degraded
              </span>
            </div>
            <p className="cd">{CATEGORY_MEANING[category] ?? ""}</p>
            {rules.map((rule) => {
              const cfg = score.config.rules[rule.rule];
              const hit = rule.deducted > 0;
              return (
                <div className={`rule ${hit ? "hit" : "ok"}`} key={rule.rule}>
                  <div className="rh">
                    <span className="rn">{rule.rule}</span>
                    <span className="rv">
                      measured {rule.value.toFixed(2)}
                      {cfg
                        ? ` · free below ${cfg.free} · full at ${cfg.full}`
                        : ""}{" "}
                      · max {rule.weight}
                    </span>
                    <span className={`rd ${hit ? "hot" : "none"}`}>
                      {hit
                        ? `−${rule.deducted.toFixed(1)}${rule.capped ? " capped" : ""}`
                        : "no deduction"}
                    </span>
                  </div>
                  <p className="rw">{rule.describes}</p>
                  {hit && rule.remedy ? (
                    <p className="rx">{rule.remedy}</p>
                  ) : null}
                  {rule.findings.length > 0 ? (
                    <details>
                      <summary>
                        {rule.total_findings.toLocaleString()} finding
                        {rule.total_findings === 1 ? "" : "s"}
                        {" · "}
                        <span
                          onClick={(e) => {
                            e.preventDefault();
                            onJump(rule.level);
                          }}
                        >
                          {rule.level} →
                        </span>
                      </summary>
                      <div className="flist">
                        {rule.findings.map((f, i) => (
                          <div key={i}>
                            <span className="f">
                              {f.file}
                              {f.line ? `:${f.line}` : ""}
                            </span>
                            <span className="w">{f.what}</span>
                          </div>
                        ))}
                        {rule.total_findings > rule.findings.length ? (
                          <div>
                            <span className="f">…</span>
                            <span className="w">
                              {(
                                rule.total_findings - rule.findings.length
                              ).toLocaleString()}{" "}
                              more
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </details>
                  ) : null}
                </div>
              );
            })}
          </section>
        );
      })}

      <div className="legend">
        <span>
          <i className="f" />
          0–49
        </span>
        <span>
          <i className="w" />
          50–89
        </span>
        <span>
          <i className="p" />
          90–100
        </span>
      </div>
    </div>
  );
}
