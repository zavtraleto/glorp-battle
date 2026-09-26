import { tuning } from '../config/tuning';
import { deriveSeed, Rng } from '../core/rng';
import { e, STAGES, wave, type Encounter, type EncounterTier } from '../data/encounters';
import { folderChips, type FolderChip } from '../sim/chips/chipSystem';
import type { EnemyKind } from '../sim/enemies/enemyBase';

// Player-facing Play run (GDD §10.2): five fixed stages and a seeded final one,
// no path choice and no automatic healing. HP and the starter folder carry over
// between battles; every stage is two or three waves.

export const RUN_STEPS = 6;

/** Enemy kinds the seeded final stage draws from. */
export const PLAY_ENEMIES: readonly EnemyKind[] = ['mettik', 'canodron', 'bladdy', 'hopzap', 'punchy'];

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
    const kinds = rng.shuffle([...PLAY_ENEMIES]).slice(0, cells.length);
    return wave(...kinds.map((kind, i) => e(kind, cells[i]!.x, cells[i]!.y)));
  });
  return { id: `s${depth}`, tier: 'elite', minDepth: depth, maxDepth: depth, waves };
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
  readonly history: RunStep[] = [];

  constructor(readonly seed: number) {
    this.hp = this.maxHp;
    this.folder = folderChips('starter');
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
    if (!won || this.complete) return;
    this.depth++;
    this.encounter = playEncounter(this.seed, this.depth);
  }

  /** Debug: jump to a step with a freshly picked encounter. */
  jumpTo(depth: number): void {
    this.depth = Math.max(1, Math.min(RUN_STEPS, Math.floor(depth)));
    this.encounter = playEncounter(this.seed, this.depth);
  }
}
