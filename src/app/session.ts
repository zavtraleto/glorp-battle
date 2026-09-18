import { secondsToTicks, tuning } from '../config/tuning';
import { deriveSeed } from '../core/rng';
import { debugEncounter, encounterById, type Encounter, type EncounterTier } from '../data/encounters';
import type { FolderId } from '../data/folders';
import { folderChips, type FolderChip } from '../sim/chips/chipSystem';
import { World, type Cheats } from '../sim/world';
import { Run, RUN_STEPS, type StartFolder } from './run';

// Roguelite run and out-of-battle screens (GDD §10–11). Pure: no DOM.
//
// TITLE → PATH → BATTLE → PATH … → BATTLE (boss) → COMPLETE → TITLE
//                  └→ death / abandon → GAME_OVER → TITLE

export type Screen = 'TITLE' | 'PATH' | 'BATTLE' | 'PAUSED' | 'GAME_OVER' | 'COMPLETE';

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
}

export interface NextBattle {
  kind: EncounterTier;
  enemies: number;
}

export class Session {
  screen: Screen = 'TITLE';
  world: World;
  seed: number;
  /** Bumped whenever `world` is replaced, so views can reset. */
  worldVersion = 0;
  run: Run | null = null;
  results: BattleResult[] = [];
  /** Runs started in this session (each gets its own seed). */
  private runCount = 0;
  /** Debug battles use the debug folder instead of the run folder. */
  private debugFolder: FolderChip[] | null = null;

  constructor(private options: SessionOptions) {
    this.seed = options.seed;
    this.world = this.titleWorld();
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

  /** Size of the folder the next fight uses (the debug folder after a debug jump). */
  get folderSize(): number {
    return (this.debugFolder ?? this.run?.folder)?.length ?? 0;
  }

  get next(): NextBattle {
    const encounter = this.run?.encounter;
    return { kind: encounter?.tier ?? 'normal', enemies: encounter?.enemies.length ?? 0 };
  }

  get healed(): boolean {
    return this.run?.healed ?? false;
  }

  get lastResult(): BattleResult | undefined {
    return this.results[this.results.length - 1];
  }

  get totalTime(): number {
    return this.results.reduce((t, r) => t + r.time, 0);
  }

  // ---------- Flow ----------

  private newRun(folder: StartFolder): Run {
    const run = new Run(deriveSeed(this.seed, `run/${this.runCount++}`), folder);
    this.results = [];
    return run;
  }

  /** Title → path screen of a new run. */
  start(folder: StartFolder): void {
    if (this.screen !== 'TITLE') return;
    this.run = this.newRun(folder);
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

  fight(): void {
    if (this.screen !== 'PATH' || !this.run) return;
    this.startBattle(this.run.encounter);
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
    this.screen = 'GAME_OVER';
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
      this.screen = 'PATH';
    } else if (w.state === 'PLAYER_DEAD' && w.stateElapsed >= secondsToTicks(tuning.fx.RESULT_DELAY_LOSE)) {
      this.run.finishBattle(false, 0);
      this.screen = 'GAME_OVER';
    }
  }

  /** COMPLETE / GAME_OVER → TITLE. */
  toTitle(): void {
    if (this.screen !== 'COMPLETE' && this.screen !== 'GAME_OVER') return;
    this.run = null;
    this.debugFolder = null;
    this.replaceWorld(this.titleWorld());
    this.screen = 'TITLE';
  }

  // ---------- Debug ----------

  /** A fresh run that jumps straight into an encounter with the debug folder. */
  private debugBattle(encounter: Encounter, seed?: number): void {
    if (seed !== undefined) this.seed = seed >>> 0;
    this.run = this.newRun('basic');
    this.run.encounter = encounter;
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
    if (!this.run) this.start('basic');
    if (!this.run) return;
    this.run.jumpTo(depth);
    this.screen = 'PATH';
  }
}
