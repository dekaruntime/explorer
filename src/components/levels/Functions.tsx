import type { FunctionDecl, TypePart } from 'cqx-kit/engine';
import { EFFECT_LABEL } from 'cqx-kit/engine';
import { pinned } from '../../lib/focus';

/**
 * One row per component of a type, with the crate that owns it.
 *
 * `—` means the extractor cannot say rather than "primitive": a name defined in
 * two crates is ambiguous without resolution, and guessing is what made another
 * metric non-deterministic.
 */
function Annotation({ label, written, parts }: { label: string; written: string; parts: TypePart[] }) {
  return (
    <>
      {parts.map(([base, owner, depth], i) => (
        <div key={i} style={{ display: 'contents' }} className={depth ? 'd1' : ''}>
          <div className={`k${depth ? ' d1' : ''}`}>{depth ? `└ ${base}` : label}</div>
          <div className="ty">{depth ? base : written}</div>
          <div className={`o ${owner ? (owner === '~' ? 'am' : '') : 'un'}`}>
            {owner === '~' ? 'ambiguous' : (owner ?? '—')}
          </div>
        </div>
      ))}
    </>
  );
}

export function FunctionsLevel({
  functions,
  focus,
  notable,
  total,
  limit = 40,
}: {
  functions: FunctionDecl[];
  focus: string | null;
  notable: number;
  total: number;
  limit?: number;
}) {
  const { list, marked } = pinned(functions, focus);
  const shown = list.slice(0, limit);
  return (
    <div>
      <h2>Functions</h2>
      <p className="lede">
        Signatures with the crate that owns each type underneath. Showing those that carry an
        effect, return an unstructured error, or take three or more parameters —{' '}
        {notable.toLocaleString()} of {total.toLocaleString()}.
      </p>
      {shown.length === 0 ? (
        <div className="empty">No notable functions in scope.</div>
      ) : (
        shown.map((f) => {
          const params = f.p.map(([name, written]) => `${name}: ${written}`).join(', ');
          return (
            <div className={marked.has(f) ? 'sig found' : 'sig'} key={f.id}>
              <div className="hd">
                <span className="fn">{f.name}</span>
                <span className="bg">
                  {f.eff.map((k) => (
                    <span key={k} className={`b ${k}`}>{EFFECT_LABEL[k]}</span>
                  ))}
                </span>
                <span className="wh">{f.file ?? ''}</span>
              </div>
              <code>
                fn {f.name}({params}){f.r ? ` -> ${f.r[0]}` : ''}
              </code>
              <div className="ann">
                {f.p.map(([name, written, parts], i) => (
                  <Annotation key={i} label={name} written={written} parts={parts} />
                ))}
                {f.r ? <Annotation label="→" written={f.r[0]} parts={f.r[1]} /> : null}
              </div>
            </div>
          );
        })
      )}
      <p className="lede" style={{ marginTop: 10 }}>
        {functions.length.toLocaleString()} in scope
        {functions.length > limit ? `, first ${limit} shown` : ''}.
      </p>
    </div>
  );
}
