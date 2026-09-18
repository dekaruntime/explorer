import type { Finding as One } from '../lib/types';

/**
 * One finding, shown the way a compiler shows one.
 *
 * A path and a line number is an index: it says a problem exists and leaves
 * the reader to go and find it. What a Rust developer expects instead is the
 * code, the part of it that is wrong, and what to do — so that is what this
 * shows, in the order rustc shows them.
 *
 * Not every rule points at a place. A file that is too long, a crate drawing
 * on too many others: those are true of the whole thing, and carry no span.
 * Rather than mark a column that means nothing, such a finding is just its
 * path and what was measured.
 */
export function Finding({ finding, remedy }: { finding: One; remedy?: string }) {
  // Shown without the indentation it happens to sit at. A line forty columns
  // deep would push its own code off the side of the card, and the span moves
  // with it so the marking still lands on the right characters.
  const lead = finding.text ? finding.text.length - finding.text.trimStart().length : 0;
  const code = finding.text?.slice(lead) ?? '';
  const [rawFrom, rawTo] = finding.col ?? [0, 0];
  const from = Math.max(0, rawFrom - lead);
  const to = Math.max(from, rawTo - lead);
  const span = Boolean(code) && to > from;

  return (
    <div className="dg">
      <div className="dgl">
        {/* One element: a gap between the path and its line number would read
            as two separate facts, and a reader copies the whole thing. */}
        <span className="p">
          {finding.file}
          {finding.line ? (
            <span className="ln">
              :{finding.line}
              {span ? `:${rawFrom + 1}` : ''}
            </span>
          ) : null}
        </span>
        {!finding.text ? <span className="w">{finding.what}</span> : null}
      </div>

      {finding.text ? (
        <pre className="dgc">
          <code>
            {/* Split so the part being complained about can be marked in
                place, rather than described underneath. */}
            {span ? (
              <>
                {code.slice(0, from)}
                <mark>{code.slice(from, to)}</mark>
                {code.slice(to)}
              </>
            ) : (
              code
            )}
          </code>
          <span className="dgw">{finding.what}</span>
        </pre>
      ) : null}
    </div>
  );
}
