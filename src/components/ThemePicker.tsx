import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'cqx-theme';

/** Reading storage throws in a private window; no preference is not an error. */
function stored(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function systemPrefers(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/* The lucide icons deka.gg uses, so the control reads as the same one. */
const MOON = 'M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401';
const SUN_RAYS = [
  'M12 2v2', 'M12 20v2', 'm4.93 4.93 1.41 1.41', 'm17.66 17.66 1.41 1.41',
  'M2 12h2', 'M20 12h2', 'm6.34 17.66-1.41 1.41', 'm19.07 4.93-1.41 1.41',
];

/**
 * Light and dark, toggled — the same control deka.gg carries in its footer.
 *
 * The icon shows what a click does rather than what is current: a moon on a
 * light page, a sun on a dark one.
 */
export function ThemePicker() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => setTheme(stored() ?? systemPrefers()), []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice still holds for this visit.
    }
  };

  const goingDark = theme !== 'dark';
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label="Toggle theme"
      title={goingDark ? 'Dark' : 'Light'}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      >
        {goingDark ? (
          <path d={MOON} />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            {SUN_RAYS.map((d) => <path key={d} d={d} />)}
          </>
        )}
      </svg>
    </button>
  );
}
