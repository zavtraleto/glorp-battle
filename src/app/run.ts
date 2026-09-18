import { tuning } from '../config/tuning';
import { deriveSeed, Rng } from '../core/rng';
import { randomFolder } from './randomFolder';
import { ENCOUNTERS, type Encounter, type EncounterTier } from '../data/encounters';
import { folderChips, type FolderChip } from '../sim/chips/chipSystem';

// One roguelite run (roguelite spec §6.1–6.3, decision Д): ten battles in a
// fixed linear order, no path choice, a boss at the end. HP and the folder
// carry over between battles; HP fully restores after winning steps 3, 6 and
// 9 (decision Г). Pure and deterministic from the seed.

export const RUN_STEPS = 10;
/** Full heal after every this many won steps (decision 2026-09-18). */
export const HEAL_EVERY = 3;
/** Steps that are elite battles. [оценка] */
export const ELITE_STEPS: readonly number[] = [5, 8];

/** Starting folder choice (roguelite spec §4.4); the title offers three buttons. */
export type StartFolder = 'basic' | 'field' | 'random';

/** Chips for a starting folder id: BASIC and FIELD are fixed data, RANDOM is rolled. */
export function startFolder(id: StartFolder, rng: Rng): FolderChip[] {
  return id === 'random' ? randomFolder(rng) : folderChips(id);
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
  /** True right after a heal step (PATH screen line), cleared on the next `finishBattle`. */
  healed = false;
  readonly history: RunStep[] = [];

  constructor(
    readonly seed: number,
    readonly folderId: StartFolder,
  ) {
    this.hp = this.maxHp;
    this.folder = startFolder(folderId, new Rng(deriveSeed(seed, 'folder')));
    this.encounter = this.pick();
  }

  get complete(): boolean {
    return this.history.some((s) => s.kind === 'boss' && s.won);
  }

  private tierAt(depth: number): EncounterTier {
    if (depth >= RUN_STEPS) return 'boss';
    return ELITE_STEPS.includes(depth) ? 'elite' : 'normal';
  }

  /**
   * Seeded pick from the encounters that fit this step's tier and depth;
   * unplayed ones first. Falls back to the other non-boss tier, then to any
   * non-boss encounter that fits, so thin encounter data never crashes.
   */
  private pick(): Encounter {
    const tier = this.tierAt(this.depth);
    const played = new Set(this.history.map((s) => s.id));
    const fitsTier = (t: EncounterTier) =>
      ENCOUNTERS.filter((e) => e.tier === t && e.minDepth <= this.depth && this.depth <= e.maxDepth);
    let fits = fitsTier(tier);
    if (fits.length === 0 && tier !== 'boss') {
      fits = fitsTier(tier === 'elite' ? 'normal' : 'elite');
    }
    if (fits.length === 0) {
      fits = ENCOUNTERS.filter((e) => e.tier !== 'boss' && e.minDepth <= this.depth && this.depth <= e.maxDepth);
    }
    const fresh = fits.filter((e) => !played.has(e.id));
    const rng = new Rng(deriveSeed(this.seed, `path/${this.depth}`));
    return rng.pick(fresh.length > 0 ? fresh : fits);
  }

  battleSeed(): number {
    return deriveSeed(this.seed, `battle/${this.depth}`);
  }

  /** Records the battle; a win moves to the next step and heals every HEAL_EVERY steps. */
  finishBattle(won: boolean, hpLeft: number): void {
    this.history.push({ id: this.encounter.id, kind: this.encounter.tier, won });
    this.hp = Math.max(0, Math.min(this.maxHp, hpLeft));
    this.healed = false;
    if (!won || this.complete) return;
    if (this.depth % HEAL_EVERY === 0) {
      this.hp = this.maxHp;
      this.healed = true;
    }
    this.depth++;
    this.encounter = this.pick();
  }

  /** Debug: jump to a step with a freshly picked encounter. */
  jumpTo(depth: number): void {
    this.depth = Math.max(1, Math.min(RUN_STEPS, Math.floor(depth)));
    this.healed = false;
    this.encounter = this.pick();
  }
}
