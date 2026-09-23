import { tuning } from '../config/tuning';
import { deriveSeed, Rng } from '../core/rng';
import type { Encounter, EncounterTier, EnemySpawn } from '../data/encounters';
import type { ChipCode, ChipId } from '../data/chips';
import type { FolderChip } from '../sim/chips/chipSystem';
import type { EnemyKind } from '../sim/enemies/enemyBase';

// Player-facing Play run: eight fixed stages, no path choice and no automatic
// healing. HP and the 20-card Play folder carry over between battles.

export const RUN_STEPS = 8;

interface PlayChip {
  defId: ChipId;
  code: ChipCode;
}

/** Content exposed by the player-facing Play mode. Tutorial and debug do not use this filter. */
export const PLAY_CONTENT = {
  chips: [
    { defId: 'cannon', code: 'A' },
    { defId: 'vulcan', code: 'A' },
    { defId: 'barrier', code: 'A' },
    { defId: 'panlgrab', code: 'A' },
    { defId: 'sword', code: 'L' },
    { defId: 'widesword', code: 'L' },
    { defId: 'minibomb', code: 'L' },
    { defId: 'areagrab', code: 'L' },
    { defId: 'recover50', code: '*' },
  ] satisfies readonly PlayChip[],
  enemies: ['mettik', 'canodron', 'bladdy', 'hopzap'] satisfies readonly EnemyKind[],
} as const;

/** Two of every Play chip plus two independent seeded bonus draws. */
export function createPlayFolder(rng: Pick<Rng, 'pick'>): FolderChip[] {
  const folder = PLAY_CONTENT.chips.flatMap((chip) => [{ ...chip }, { ...chip }]);
  for (let i = 0; i < 2; i++) folder.push({ ...rng.pick(PLAY_CONTENT.chips) });
  return folder;
}

const spawn = (kind: EnemyKind, x: number, y: number): EnemySpawn => ({ kind, x, y, level: 1 });

const PLAY_STAGES: readonly (readonly EnemySpawn[])[] = [
  [spawn('mettik', 1, 1)],
  [spawn('canodron', 0, 0), spawn('canodron', 2, 0)],
  [spawn('mettik', 0, 2), spawn('canodron', 2, 0)],
  [spawn('bladdy', 1, 0)],
  [spawn('bladdy', 0, 0), spawn('canodron', 2, 1)],
  [spawn('hopzap', 1, 1)],
  [spawn('mettik', 0, 2), spawn('hopzap', 2, 0)],
];

const FINAL_CELLS = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }] as const;

function playEncounter(seed: number, depth: number): Encounter {
  const fixed = PLAY_STAGES[depth - 1];
  const enemies = fixed
    ? fixed.map((enemy) => ({ ...enemy }))
    : new Rng(deriveSeed(seed, 'path/8'))
        .shuffle([...PLAY_CONTENT.enemies])
        .slice(0, 3)
        .map((kind, i) => spawn(kind, FINAL_CELLS[i]!.x, FINAL_CELLS[i]!.y));
  return { id: `play${depth}`, tier: 'normal', minDepth: depth, maxDepth: depth, enemies };
}

/** Starting folder choice (roguelite spec §4.4); the title offers three buttons. */
export type StartFolder = 'basic' | 'field' | 'random';

/** Legacy menu choices all start the same player-facing Play folder. */
export function startFolder(_id: StartFolder, rng: Rng): FolderChip[] {
  return createPlayFolder(rng);
}

export interface RunStep {
  id: string;
  kind: EncounterTier;
  won: boolean;
}

export class Run {
  depth = 1;
  hp: number;
  readonly maxHp = tuning.player.PLAYER_MAX_HP;
  readonly folder: FolderChip[];
  encounter: Encounter;
  /** Kept for the menu/session interface; Play never heals automatically. */
  healed = false;
  readonly history: RunStep[] = [];

  constructor(
    readonly seed: number,
    readonly folderId: StartFolder,
  ) {
    this.hp = this.maxHp;
    this.folder = startFolder(folderId, new Rng(deriveSeed(seed, 'folder')));
    this.encounter = playEncounter(this.seed, this.depth);
  }

  get complete(): boolean {
    return this.history.length >= RUN_STEPS && this.history[RUN_STEPS - 1]?.won === true;
  }

  battleSeed(): number {
    return deriveSeed(this.seed, `battle/${this.depth}`);
  }

  /** Records the battle; a win moves to the next step without restoring HP. */
  finishBattle(won: boolean, hpLeft: number): void {
    this.history.push({ id: this.encounter.id, kind: this.encounter.tier, won });
    this.hp = Math.max(0, Math.min(this.maxHp, hpLeft));
    this.healed = false;
    if (!won || this.complete) return;
    this.depth++;
    this.encounter = playEncounter(this.seed, this.depth);
  }

  /** Debug: jump to a step with a freshly picked encounter. */
  jumpTo(depth: number): void {
    this.depth = Math.max(1, Math.min(RUN_STEPS, Math.floor(depth)));
    this.healed = false;
    this.encounter = playEncounter(this.seed, this.depth);
  }
}
