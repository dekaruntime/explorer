import type { EffectRow } from '../../lib/types';

/**
 * What the binaries touch outside themselves.
 *
 * The only elevation small enough to read whole, which is why it leads with a
 * table rather than a grid.
 */
export function SystemLevel({ effects }: { effects: EffectRow[] }) {
  const spawns = new Map<string, EffectRow[]>();
  const envs = new Map<string, number>();
  for (const e of effects) {
    if (e.k === 'spawns') spawns.set(e.to, [...(spawns.get(e.to) ?? []), e]);
    if (e.k === 'reads_env') envs.set(e.to, (envs.get(e.to) ?? 0) + 1);
  }

  const provenance = (row: EffectRow) => {
    if (row.via === 'env')
      return (
        <>
          <span className="acc">{row.src}()</span> <span className="dim">←</span>{' '}
          <span className="hot">${row.env?.split(',')[0]}</span>
        </>
      );
    if (row.via === 'fn') return <><span className="dim">from</span> {row.src}()</>;
    if (row.via === 'unresolved') return <span className="dim">unresolved</span>;
    return <span className="dim">literal</span>;
  };

  return (
    <div>
      <h2>What it touches outside itself</h2>
      <p className="lede">
        Every process, variable and capability the binaries can reach. The only elevation small
        enough to read whole.
      </p>

      <div className="sect">Processes it can start</div>
      <div className="tbl">
        <table>
          <thead>
            <tr><th>target</th><th>sites</th><th>how the name is decided</th><th>first site</th></tr>
          </thead>
          <tbody>
            {[...spawns.entries()]
              .sort((a, b) => b[1].length - a[1].length)
              .map(([name, rows]) => {
                const first = rows[0]!;
                return (
                  <tr key={name}>
                    <td>{name === '<dynamic>' ? <span className="dim">&lt;dynamic&gt;</span> : <b>{name}</b>}</td>
                    <td>{rows.length}</td>
                    <td>{provenance(first)}</td>
                    <td className="loc">{first.file}:{first.line}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <div className="sect">Environment variables read</div>
      <div className="bg">
        {[...envs.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([name, count]) => (
            <span key={name} className={`b ${name === '<dynamic>' ? '' : 'reads_env'}`}>
              {name} {count}
            </span>
          ))}
      </div>
    </div>
  );
}
