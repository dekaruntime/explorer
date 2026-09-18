import type { LevelId } from '../lib/view';

export interface Elevation {
  id: LevelId;
  name: string;
  count: string;
}

/**
 * The primary navigation.
 *
 * L0 to L3 narrow a scope; L4 and L5 are two lenses on the same leaf level,
 * related by use rather than containment. The rail does not try to express that
 * — the levels themselves do.
 */
export function ElevationRail({
  levels,
  current,
  onSelect,
}: {
  levels: Elevation[];
  current: LevelId;
  onSelect: (id: LevelId) => void;
}) {
  return (
    <nav className="rail">
      <h3>Elevation</h3>
      {levels.map((l) => (
        <button
          key={l.id}
          className="lvl"
          aria-current={l.id === current}
          onClick={() => onSelect(l.id)}
        >
          <span className="t">{l.id}</span>
          <span>
            <span className="n">{l.name}</span>
            <br />
            <span className="c">{l.count}</span>
          </span>
        </button>
      ))}
    </nav>
  );
}
