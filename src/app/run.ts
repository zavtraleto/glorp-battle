import { tuning } from '../config/tuning';
import { deriveSeed, Rng } from '../core/rng';
import { e, STAGES, wave, type Encounter, type EncounterTier } from '../data/encounters';
import type { ChipId } from '../data/chips';
import type { FolderChip } from '../sim/chips/chipSystem';
import type { EnemyKind } from '../sim/enemies/enemyBase';

// Player-facing Play run (GDD §10.2): five fixed stages and a seeded final one,
// no path choice and no automatic healing. HP and the 8-chip starter folder carry
// over between battles; every stage is two or three waves.

export const RUN_STEPS = 6;

interface PlayChip {
  defId: ChipId;
}

/** Content exposed by the player-facing Play mode. Tutorial and debug do not use this filter. */
export const PLAY_CONTENT = {
  chips: [
    { defId: 'cannon' },
    { defId: 'sword' },
    { defId: 'areagrab' },
    { defId: 'mine' },
    { defId: 'block' },
    { defId: 'break' },
    { defId: 'airshot' },
    { defId: 'spreader' },
    { defId: 'widesword' },
    { defId: 'guard' },
  ] satisfies readonly PlayChip[],
  enemies: ['mettik', 'canodron', 'bladdy', 'hopzap'] satisfies readonly EnemyKind[],
} as const;

/**
 * The run's folder for now (GDD §6.3): eight chips for a short, readable
 * rotation. The rest of PLAY_CONTENT stays in the game but is not dealt yet.
 */
export const STARTER_FOLDER: readonly { defId: ChipId; count: number }[] = [
  { defId: 'cannon', count: 3 },
  { defId: 'sword', count: 2 },
  { defId: 'areagrab', count: 2 },
  { defId: 'guard', count: 1 },
];

/** The deterministic starter folder. */
export function createPlayFolder(_rng: Pick<Rng, 'pick'>): FolderChip[] {
  return STARTER_FOLDER.flatMap(({ defId, count }) => Array.from({ length: count }, () => ({ defId })));
}

/** Final-stage waves: how many random kinds each one takes, and where they stand. */
const FINAL_WAVES = [
  [{ x: 0, y: 1 }, { x: 2, y: 1 }],
  [{ x: 0, y: 0 }, { x: 2, y: 2 }],
  [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }],
] as const;

function playEncounter(seed: number, depth: number): Encounter {
  const fixed = STAGES[depth - 1];
  if (fixed) return { ...fixed, waves: fixed.waves.map((w) => ({ ...w, enemies: w.enemies.map((en) => ({ ...en })) })) };
  const rng = new Rng(deriveSeed(seed, `path/${RUN_STEPS}`));
  const waves = FINAL_WAVES.map((cells) => {
    const kinds = rng.shuffle([...PLAY_CONTENT.enemies]).slice(0, cells.length);
    return wave(...kinds.map((kind, i) => e(kind, cells[i]!.x, cells[i]!.y)));
  });
  return { id: `s${depth}`, tier: 'elite', minDepth: depth, maxDepth: depth, waves };
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
