import { secondsToTicks, tuning } from '../config/tuning';
import { deriveSeed } from '../core/rng';
import type { ChipCode, ChipId } from '../data/chips';
import { debugEncounter, encounterById, type Encounter, type EncounterTier } from '../data/encounters';
import type { FolderId } from '../data/folders';
import { folderChips, type FolderChip } from '../sim/chips/chipSystem';
import { World, type Cheats } from '../sim/world';
import { clearLegacy, loadLegacy, saveLegacy, type LegacyState, type LegacyStorage } from './legacyStore';
import { RewardPick } from './reward';
import { Run, RUN_STEPS } from './run';

// Roguelite run and out-of-battle screens (GDD §10–11, roguelite spec §6).
// Pure: no DOM.
//
// TITLE → PATH → BATTLE → REWARD → PATH … → BATTLE (boss) → COMPLETE → TITLE
//                  └→ death / abandon → LEGACY → TITLE

export type Screen = 'TITLE' | 'PATH' | 'BATTLE' | 'PAUSED' | 'REWARD' | 'LEGACY' | 'COMPLETE';

export interface BattleResult {
  /** Run step of the battle. */
  battle: number;
  /** Simulated battle time in seconds. */
  time: number;
  hits: number;
  hpLeft: number;
}

export interface SessionOptions {
  seed: number;
  cheats: Cheats;
  /** Debug folder used by debug jumps (`?battle=`, `?encounter=`). */
  folder: FolderId;
  /** Legacy store; defaults to localStorage, null disables it (tests). */
  storage?: LegacyStorage | null;
}

export interface PathChoice {
  kind: EncounterTier;
  enemies: number;
}

export interface LegacyChoice {
  defId: ChipId;
  code: ChipCode;
  count: number;
  legacyGen?: number;
}

export class Session {
  screen: Screen = 'TITLE';
  world: World;
  seed: number;
  /** Bumped whenever `world` is replaced, so views can reset. */
  worldVersion = 0;
  run: Run | null = null;
  legacy: LegacyState;
  reward: RewardPick | null = null;
  results: BattleResult[] = [];
  /** Runs started in this session (each gets its own seed). */
  private runCount = 0;
  /** Debug battles use the debug folder instead of the run folder. */
  private debugFolder: FolderChip[] | null = null;

  constructor(private options: SessionOptions) {
    this.seed = options.seed;
    this.legacy = loadLegacy(this.storage);
    this.world = this.titleWorld();
  }

  private get storage(): LegacyStorage | null | undefined {
    return this.options.storage;
  }

  private titleWorld(): World {
    const w = new World({ seed: this.seed, battleIndex: 1, cheats: this.options.cheats, folder: this.options.folder });
    w.state = 'TITLE';
    return w;
  }

  private replaceWorld(world: World): void {
    this.world = world;
    this.worldVersion++;
  }

  // ---------- Menu data ----------

  get generation(): number {
    return this.run?.generation ?? this.legacy.generation;
  }

  get depth(): number {
    return this.run?.depth ?? 1;
  }

  /** Debug panel / overlay: the current step. */
  get battleIndex(): number {
    return this.depth;
  }

  get steps(): number {
    return RUN_STEPS;
  }

  get hp(): number {
    return this.run?.hp ?? this.world.player.hp;
  }

  get maxHp(): number {
    return this.run?.maxHp ?? tuning.player.PLAYER_MAX_HP;
  }

  get folderSize(): number {
    return this.run?.folder.length ?? 0;
  }

  get path(): PathChoice[] {
    return (this.run?.options ?? []).map((o) => ({ kind: o.kind, enemies: o.encounter.enemies.length }));
  }

  get legacyChoices(): LegacyChoice[] {
    return (this.run?.folderSummary() ?? []).map(({ defId, code, count, legacyGen }) => ({ defId, code, count, legacyGen }));
  }

  get lastResult(): BattleResult | undefined {
    return this.results[this.results.length - 1];
  }

  get totalTime(): number {
    return this.results.reduce((t, r) => t + r.time, 0);
  }

  // ---------- Flow ----------

  private newRun(consumeLegacy: boolean): Run {
    this.legacy = loadLegacy(this.storage);
    const chip = consumeLegacy ? this.legacy.chip : null;
    const run = new Run(deriveSeed(this.seed, `run/${this.runCount++}`), this.legacy.generation, chip);
    if (chip) {
      this.legacy = { generation: this.legacy.generation, chip: null };
      saveLegacy(this.legacy, this.storage);
    }
    this.results = [];
    this.reward = null;
    return run;
  }

  /** Title → path choice of a new run; the legacy chip joins its folder. */
  start(): void {
    if (this.screen !== 'TITLE') return;
    this.run = this.newRun(true);
    this.debugFolder = null;
    this.screen = 'PATH';
  }

  private startBattle(encounter: Encounter): void {
    const run = this.run as Run;
    this.replaceWorld(
      new World({
        seed: run.battleSeed(),
        battleIndex: 1,
        encounter,
        playerHp: run.hp,
        cheats: this.options.cheats,
        folder: this.debugFolder ?? run.folder,
      }),
    );
    this.screen = 'BATTLE';
  }

  choosePath(index: number): void {
    if (this.screen !== 'PATH' || !this.run) return;
    const option = this.run.choose(index);
    this.startBattle(option.encounter);
  }

  pause(): void {
    if (this.screen !== 'BATTLE' || !this.world.pause()) return;
    this.screen = 'PAUSED';
  }

  resume(): void {
    if (this.screen !== 'PAUSED') return;
    this.world.resume();
    this.screen = 'BATTLE';
  }

  /** Pause menu: give up the run; it counts as a death. */
  abandon(): void {
    if (this.screen !== 'PAUSED' || !this.run) return;
    this.run.finishBattle(false, 0);
    this.screen = 'LEGACY';
  }

  /** Called every frame: leaves the battle once the end-of-battle signal has played. */
  update(): void {
    if (this.screen !== 'BATTLE' || !this.run) return;
    const w = this.world;
    if (w.state === 'BATTLE_WON' && w.stateElapsed >= secondsToTicks(tuning.fx.RESULT_DELAY_WIN)) {
      this.results.push({ battle: this.run.depth, time: w.time, hits: w.player.hitsTaken, hpLeft: w.player.hp });
      this.run.finishBattle(true, w.player.hp);
      if (this.run.complete) {
        this.screen = 'COMPLETE';
        return;
      }
      this.reward = new RewardPick(this.run.rewardChoices(), () => this.finishReward());
      this.screen = 'REWARD';
    } else if (w.state === 'PLAYER_DEAD' && w.stateElapsed >= secondsToTicks(tuning.fx.RESULT_DELAY_LOSE)) {
      this.run.finishBattle(false, 0);
      this.screen = 'LEGACY';
    }
  }

  private finishReward(): void {
    const r = this.reward;
    if (this.screen !== 'REWARD' || !r || !this.run) return;
    if (r.taken) this.run.addChip(r.taken);
    this.reward = null;
    this.screen = 'PATH';
  }

  /** REWARD: take the picked cassette (tray OK). */
  takeReward(): void {
    this.reward?.confirm();
  }

  /** REWARD: skip (tray SKIP). */
  skipReward(): void {
    this.reward?.add();
  }

  /** LEGACY: leave a chip for the next player; the generation moves on. */
  chooseLegacy(index: number): void {
    if (this.screen !== 'LEGACY' || !this.run) return;
    const pick = this.legacyChoices[index];
    this.legacy = {
      generation: this.run.generation + 1,
      chip: pick ? { defId: pick.defId, code: pick.code, gen: pick.legacyGen ?? this.run.generation } : null,
    };
    saveLegacy(this.legacy, this.storage);
    this.toTitle(true);
  }

  /** COMPLETE → TITLE (a cleared run leaves no legacy). */
  toTitle(force = false): void {
    if (!force && this.screen !== 'COMPLETE') return;
    this.run = null;
    this.reward = null;
    this.debugFolder = null;
    this.replaceWorld(this.titleWorld());
    this.screen = 'TITLE';
  }

  // ---------- Debug ----------

  /** A fresh run that jumps straight into an encounter with the debug folder. */
  private debugBattle(encounter: Encounter, seed?: number): void {
    if (seed !== undefined) this.seed = seed >>> 0;
    this.run = this.newRun(false);
    this.run.current = { kind: encounter.tier, encounter };
    this.debugFolder = folderChips(this.options.folder);
    this.startBattle(encounter);
  }

  /** Jumps into old battle 1–4 with full HP (debug panel / ?battle=). */
  debugJump(index: number, seed?: number): void {
    this.debugBattle(debugEncounter(index), seed);
  }

  /** Jumps into any encounter by id (?encounter=). */
  debugEncounter(id: string, seed?: number): boolean {
    const enc = encounterById(id);
    if (!enc) return false;
    this.debugBattle(enc, seed);
    return true;
  }

  /** Moves the run to another step (PATH screen). */
  debugDepth(depth: number): void {
    if (!this.run) this.start();
    if (!this.run) return;
    this.run.jumpTo(depth);
    this.reward = null;
    this.screen = 'PATH';
  }

  debugClearLegacy(): void {
    clearLegacy(this.storage);
    this.legacy = loadLegacy(this.storage);
  }

  debugSetGeneration(generation: number): void {
    this.legacy = { ...this.legacy, generation: Math.max(1, Math.floor(generation)) };
    saveLegacy(this.legacy, this.storage);
  }
}
