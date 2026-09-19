/**
 * Bringing one row to the top of a list that is capped.
 *
 * Search can land on a type that is 4,000th by use in a repository whose Types
 * elevation shows 120. Scrolling to it is not an option — it was never
 * rendered. So the list is reordered rather than scrolled: what was asked for
 * goes first, and everything else keeps the order it had.
 *
 * Names, not ids, and every match rather than the first. Two crates may well
 * declare a `Config`, and showing one of them because it sorted earlier would
 * be answering a different question than the one that was asked.
 */
export function pinned<T extends { name: string }>(
  list: T[],
  focus: string | null,
): { list: T[]; marked: Set<T> } {
  if (!focus) return { list, marked: new Set() };
  const marked = new Set(list.filter((item) => item.name === focus));
  if (marked.size === 0) return { list, marked };
  return { list: [...marked, ...list.filter((item) => !marked.has(item))], marked };
}
