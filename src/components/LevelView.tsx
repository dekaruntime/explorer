import type { Commit, Dataset, FileNode, FunctionDecl, TypeDecl } from '../lib/types';
import type { LevelId, View } from '../lib/view';
import { ScoreLevel } from './levels/Score';
import { SystemLevel } from './levels/System';
import { PackagesLevel } from './levels/Packages';
import { FilesLevel } from './levels/Files';
import { TypesLevel } from './levels/Types';
import { FunctionsLevel } from './levels/Functions';

/**
 * Which elevation is on screen.
 *
 * One place that knows how a level maps to a view, rather than a ternary chain
 * inside the explorer's own render — where it sat between the loading states
 * and the layout, and grew every time one of those changed.
 *
 * The scoped collections are passed in rather than derived here: the explorer
 * memoises them, and recomputing a filter over every file on each render of a
 * large repository is work nobody asked for.
 */
export function LevelView({
  level,
  data,
  timeline,
  viewing,
  at,
  scopeName,
  focus,
  files,
  types,
  functions,
  onGo,
}: {
  level: LevelId;
  data: Dataset;
  timeline: Commit[];
  /** Which slot on the rail, or -1 for a commit it does not list. */
  viewing: number;
  at: string | null;
  /** The package in scope, if one is. */
  scopeName: string | null;
  /** A symbol search asked to be shown, if one did. */
  focus: string | null;
  files: FileNode[];
  types: TypeDecl[];
  functions: FunctionDecl[];
  onGo: (patch: Partial<View>) => void;
}) {
  switch (level) {
    case 'L0':
      return (
        <ScoreLevel
          score={data.score}
          commits={timeline}
          viewing={viewing}
          at={at}
          onBackToHead={() => onGo({ ref: timeline[0]?.short ?? null })}
          onJump={(l) => onGo({ level: l as LevelId })}
        />
      );
    case 'L1':
      return <SystemLevel effects={data.effects} />;
    case 'L2':
      return (
        <PackagesLevel
          packages={data.packages}
          onSelect={(id) =>
            onGo({
              pkg: data.packages.find((p) => p.id === id)?.name ?? null,
              file: null,
              level: 'L3',
            })
          }
        />
      );
    case 'L3':
      return (
        <FilesLevel
          files={files}
          scopeName={scopeName}
          onSelect={(id) =>
            onGo({ file: data.files.find((f) => f.id === id)?.path ?? null, level: 'L4' })
          }
        />
      );
    case 'L4':
      return <TypesLevel types={types} focus={focus} />;
    default:
      return (
        <FunctionsLevel
          functions={functions}
          focus={focus}
          notable={data.totals.notable}
          total={data.totals.functions}
        />
      );
  }
}
