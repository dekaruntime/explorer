import type { Package } from 'cqx-kit/engine';
import { EffectBadges } from '../EffectBadges';

export function PackagesLevel({
  packages,
  onSelect,
}: {
  packages: Package[];
  onSelect: (id: string) => void;
}) {
  const largest = Math.max(...packages.map((p) => p.lines), 1);
  return (
    <div>
      <h2>{packages.length} crates</h2>
      <p className="lede">
        Sized by lines, badged by what each reaches. Selecting one scopes every elevation below.
      </p>
      <div className="grid">
        {[...packages].sort((a, b) => b.lines - a.lines).map((p) => (
          <button className="card" key={p.id} onClick={() => onSelect(p.id)}>
            <span className="nm">{p.name}</span>
            <span className="mt">
              <span>{p.files.toLocaleString()} files</span>
              <span>{p.lines.toLocaleString()} lines</span>
            </span>
            <span className="bar">
              <i style={{ width: `${Math.max(3, Math.round((p.lines / largest) * 100))}%` }} />
            </span>
            <EffectBadges effects={p.eff} />
          </button>
        ))}
      </div>
    </div>
  );
}
