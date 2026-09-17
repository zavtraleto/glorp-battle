import { tuning } from '../config/tuning';
import { deriveSeed, Rng } from '../core/rng';
import { CHIPS, type ChipDef, type ChipId, type Rarity } from '../data/chips';
import { ENCOUNTERS, type Encounter, type EncounterTier } from '../data/encounters';
import { STARTER_FOLDER } from '../data/starterFolder';
import type { FolderChip } from '../sim/chips/chipSystem';
import type { LegacyChip } from './legacyStore';

// One roguelite run (roguelite spec §6.1–6.3): ten steps, a choice of 2–3
// battles per step, a boss at the end, a chip reward after each win. HP and
// the folder carry over. Pure and deterministic from the seed.

export const RUN_STEPS = 10;
/** Elite battles show up from this step on. [оценка] */
export const ELITE_FROM = 3;
/** Chance of an elite option once allowed. [оценка] */
export const ELITE_CHANCE = 0.35;

const WEIGHTS: Record<'normal' | 'elite', Record<Rarity, number>> = {
  normal: { common: 70, uncommon: 25, rare: 5 },
  elite: { common: 0, uncommon: 75, rare: 25 },
};

export interface PathOption {
  kind: EncounterTier;
  encounter: Encounter;
}

export interface RunStep {
  id: string;
  kind: EncounterTier;
  won: boolean;
}

export class Run {
  depth = 1;
  hp: number;
  readonly maxHp: number;
  readonly folder: FolderChip[];
  options: PathOption[] = [];
  current: PathOption | null = null;
  readonly history: RunStep[] = [];

  constructor(
    readonly seed: number,
    readonly generation: number,
    legacy: LegacyChip | null,
  ) {
    this.maxHp = tuning.player.PLAYER_MAX_HP;
    this.hp = this.maxHp;
    this.folder = STARTER_FOLDER.map((c) => ({ ...c }));
    if (legacy) this.folder.push({ defId: legacy.defId, code: legacy.code, legacyGen: legacy.gen });
    this.options = this.makeOptions();
  }

  get complete(): boolean {
    return this.history.some((s) => s.kind === 'boss' && s.won);
  }

  private rng(stream: string): Rng {
    return new Rng(deriveSeed(this.seed, `${stream}/${this.depth}`));
  }

  /** Encounters for a tier at this depth, never one already offered now; unplayed ones first. */
  private pool(tier: EncounterTier, offered: ReadonlySet<string>): Encounter[] {
    const played = new Set(this.history.map((s) => s.id));
    const fits = ENCOUNTERS.filter(
      (e) => e.tier === tier && e.minDepth <= this.depth && this.depth <= e.maxDepth && !offered.has(e.id),
    );
    const fresh = fits.filter((e) => !played.has(e.id));
    return fresh.length > 0 ? fresh : fits;
  }

  private makeOptions(): PathOption[] {
    if (this.depth >= RUN_STEPS) return this.pool('boss', new Set()).slice(0, 1).map((encounter) => ({ kind: 'boss', encounter }));
    const rng = this.rng('path');
    const offered = new Set<string>();
    const count = rng.int(2, 3);
    const options: PathOption[] = [];
    for (let i = 0; i < count; i++) {
      let kind: EncounterTier = this.depth >= ELITE_FROM && rng.next() < ELITE_CHANCE ? 'elite' : 'normal';
      let pool = this.pool(kind, offered);
      if (pool.length === 0 && kind === 'elite') {
        kind = 'normal';
        pool = this.pool(kind, offered);
      }
      if (pool.length === 0) continue;
      const encounter = rng.pick(pool);
      offered.add(encounter.id);
      options.push({ kind, encounter });
    }
    return options;
  }

  choose(index: number): PathOption {
    const option = this.options[Math.max(0, Math.min(this.options.length - 1, index))] as PathOption;
    this.current = option;
    return option;
  }

  battleSeed(): number {
    return deriveSeed(this.seed, `battle/${this.depth}`);
  }

  /** Three different chips for the current step's reward. */
  rewardChoices(): FolderChip[] {
    const rng = this.rng('reward');
    const elite = this.current?.kind === 'elite';
    const all = Object.values(CHIPS);
    const picked: ChipDef[] = [];
    for (let i = 0; i < 3; i++) {
      const weights = WEIGHTS[elite && i === 0 ? 'elite' : 'normal'];
      const pool = all.filter((d) => !picked.includes(d));
      const total = pool.reduce((s, d) => s + weights[d.rarity], 0);
      let roll = rng.next() * total;
      let chosen = pool[pool.length - 1] as ChipDef;
      for (const d of pool) {
        roll -= weights[d.rarity];
        if (roll < 0) {
          chosen = d;
          break;
        }
      }
      picked.push(chosen);
    }
    return picked.map((d) => ({ defId: d.id, code: rng.pick(d.codes) }));
  }

  addChip(chip: FolderChip): void {
    this.folder.push({ ...chip });
  }

  /** Records the battle; a win moves on to the next step. */
  finishBattle(won: boolean, hpLeft: number): void {
    if (!this.current) return;
    this.history.push({ id: this.current.encounter.id, kind: this.current.kind, won });
    this.hp = Math.max(0, Math.min(this.maxHp, hpLeft));
    this.current = null;
    if (!won || this.complete) return;
    this.depth++;
    this.options = this.makeOptions();
  }

  /** Debug: jump to a step with fresh options. */
  jumpTo(depth: number): void {
    this.depth = Math.max(1, Math.min(RUN_STEPS, Math.floor(depth)));
    this.current = null;
    this.options = this.makeOptions();
  }

  /** Folder chips grouped for display: id, code, count, legacy mark. */
  folderSummary(): { defId: ChipId; code: FolderChip['code']; count: number; legacyGen?: number; index: number }[] {
    const out: { defId: ChipId; code: FolderChip['code']; count: number; legacyGen?: number; index: number }[] = [];
    this.folder.forEach((c, index) => {
      const same = out.find((o) => o.defId === c.defId && o.code === c.code && o.legacyGen === c.legacyGen);
      if (same) same.count++;
      else out.push({ defId: c.defId, code: c.code, count: 1, legacyGen: c.legacyGen, index });
    });
    return out;
  }
}
