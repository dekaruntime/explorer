import type { TypeDecl } from '../../lib/types';

/**
 * Type declarations this repository owns.
 *
 * Ordering by use and showing everything would put `str`, `Path` and `Result`
 * at the top, which says nothing about this codebase. Restricted to what the
 * repository declares, the ordering becomes informative — and it surfaces that
 * most declarations appear in no signature at all.
 */
export function TypesLevel({ types, limit = 120 }: { types: TypeDecl[]; limit?: number }) {
  const shown = types.slice(0, limit);
  return (
    <div>
      <h2>Types</h2>
      <p className="lede">
        Declarations this repository owns, ordered by how often they appear in a signature. A
        type used nowhere is not necessarily dead, but it is not part of any contract.
      </p>
      <div className="tbl">
        <table>
          <thead>
            <tr><th>type</th><th>kind</th><th>crate</th><th>used in</th><th>fields</th></tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td colSpan={5} className="dim">No types in scope.</td></tr>
            ) : (
              shown.map((t) => (
                <tr key={t.id}>
                  <td><b>{t.name}</b></td>
                  <td className="dim">{t.k}</td>
                  <td className="acc">{t.pkg ?? ''}</td>
                  <td>{t.uses > 0 ? t.uses : <span className="dim">0</span>}</td>
                  <td className="dim">
                    {t.fields.length
                      ? t.fields.slice(0, 4).map(([n, ty]) => `${n}: ${ty}`).join(', ')
                      : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="lede" style={{ marginTop: 10 }}>
        {types.length.toLocaleString()} shown{types.length > limit ? ` (first ${limit})` : ''}.
      </p>
    </div>
  );
}
