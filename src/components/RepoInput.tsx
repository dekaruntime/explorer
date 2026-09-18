import { useEffect, useState } from 'react';

/**
 * Which repository to look at.
 *
 * A list of repositories this deployment happens to know is not the set of
 * repositories that exist, so this takes any `owner/name` rather than offering
 * a choice between two. The deployment's own list stays, as completions — a
 * suggestion rather than a gate.
 *
 * It also accepts what a person actually has in hand, which is usually a URL
 * copied from the address bar rather than a tidy slug.
 */

/** The GitHub mark, as deka.gg draws it. */
function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" width="15" height="15" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/**
 * Whatever names a repository, reduced to `owner/name`.
 *
 * A pasted URL, an ssh remote, a trailing `.git`, a path that goes on into a
 * file — all of them name a repository, and refusing them would be pedantry.
 * Anything that does not resolve to exactly two segments is not one.
 */
export function asRepo(typed: string): string | null {
  let text = typed.trim();
  if (!text) return null;
  text = text.replace(/^git@github\.com:/, '').replace(/^[a-z]+:\/\/[^/]+\//, '');
  text = text.replace(/\.git$/, '').replace(/^\/+|\/+$/g, '');
  const parts = text.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, name] = parts;
  // GitHub's own rule, near enough: letters, digits, dot, dash, underscore.
  if (!/^[\w.-]+$/.test(owner!) || !/^[\w.-]+$/.test(name!)) return null;
  return `${owner}/${name}`;
}

export function RepoInput({
  value,
  suggestions,
  onOpen,
}: {
  value: string;
  suggestions: string[];
  onOpen: (repo: string) => void;
}) {
  const [typed, setTyped] = useState(value);
  // Following a link changes the repository without going through here, and the
  // box has to say what is actually on screen.
  useEffect(() => setTyped(value), [value]);

  const repo = asRepo(typed);
  const submit = () => {
    if (repo && repo !== value) onOpen(repo);
    else setTyped(value);
  };

  return (
    <form
      className="picker"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <span className="gh" aria-hidden="true"><GitHubMark /></span>
      <input
        list="cqx-repos"
        value={typed}
        spellCheck={false}
        autoComplete="off"
        aria-label="repository"
        placeholder="owner/repo"
        size={22}
        onChange={(e) => setTyped(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setTyped(value);
        }}
      />
      <datalist id="cqx-repos">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </form>
  );
}
