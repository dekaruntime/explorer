import type { EffectKind } from '../lib/types';
import { EFFECT_LABEL, EFFECT_ORDER } from '../lib/types';

/**
 * Effects a node carries, dangerous ones first.
 *
 * Structural facts are numerous and quiet; these are few and worth reading, so
 * they are what a card shows.
 */
export function EffectBadges({
  effects,
  extra,
}: {
  effects: Partial<Record<EffectKind, number>>;
  extra?: React.ReactNode;
}) {
  const shown = EFFECT_ORDER.filter((k) => effects[k]);
  return (
    <div className="bg">
      {shown.length === 0 && !extra ? <span className="b">no effects</span> : null}
      {shown.map((k) => (
        <span key={k} className={`b ${k}`}>
          {EFFECT_LABEL[k]} {effects[k]}
        </span>
      ))}
      {extra}
    </div>
  );
}
