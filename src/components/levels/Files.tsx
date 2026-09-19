import type { FileNode } from 'cqx-kit/engine';
import { EffectBadges } from '../EffectBadges';

export function FilesLevel({
  files,
  scopeName,
  onSelect,
}: {
  files: FileNode[];
  scopeName: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <h2>{files.length.toLocaleString()} files</h2>
      <p className="lede">
        {scopeName ? `In ${scopeName}. ` : ''}
        Ordered by size. Selecting one scopes Types and Functions.
      </p>
      <div className="grid">
        {files.length === 0 ? (
          <div className="empty">No files in scope.</div>
        ) : (
          [...files].sort((a, b) => b.lines - a.lines).map((f) => (
            <button className="card" key={f.id} onClick={() => onSelect(f.id)}>
              <span className="nm">{f.path.split('/').slice(2).join('/') || f.path}</span>
              <span className="mt">
                <span>{f.lines.toLocaleString()} lines</span>
                <span>{f.n.toLocaleString()} symbols</span>
              </span>
              <EffectBadges effects={f.eff} />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
