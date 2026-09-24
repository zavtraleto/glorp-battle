import { secondsToTicks, tuning } from '../config/tuning';
import { deriveSeed } from '../core/rng';
import { debugEncounter, encounterById, type Encounter, type EncounterTier } from '../data/encounters';
import type { FolderId } from '../data/folders';
import type { SimEvent } from '../sim/events';
import { folderChips, type FolderChip } from '../sim/chips/chipSystem';
import { World, type Cheats } from '../sim/world';
import { Run, RUN_STEPS, type StartFolder } from './run';
import { TutorialDirector, type TutorialHint } from './tutorial/director';

// Roguelite run and out-of-battle screens (GDD §10–11). Pure: no DOM.
//
// TITLE → PATH → BATTLE → PATH … → BATTLE (boss) → COMPLETE → TITLE
//                  └→ death / abandon → GAME_OVER → TITLE
//
// The tutorial (tutorial spec §2) reuses BATTLE/PAUSED/COMPLETE instead:
// TITLE → BATTLE → … (4 steps, auto-advancing) → COMPLETE → TITLE
//                  └→ abandon → TITLE (never GAME_OVER; the player cannot die)

export type Screen = 'TITLE' | 'PATH' | 'BATTLE' | 'PAUSED' | 'GAME_OVER' | 'COMPLETE';
export type SessionMode = 'run' | 'tutorial';

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
  mode: SessionMode = 'run';
  /** Runs started in this session (each gets its own seed). */
  private runCount = 0;
  /** Debug battles use the debug folder instead of the run folder. */
  private debugFolder: FolderChip[] | null = null;
  private director: TutorialDirector | null = null;

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
    // Only the first wave is announced: the number of waves stays a surprise.
    return { kind: encounter?.tier ?? 'normal', enemies: encounter?.waves[0]?.enemies.length ?? 0 };
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

  /** Title → the first tutorial battle (tutorial spec §2). */
  startTutorial(): void {
    if (this.screen !== 'TITLE') return;
    this.mode = 'tutorial';
    this.run = null;
    this.debugFolder = null;
    this.director = new TutorialDirector();
    this.replaceWorld(this.director.newWorld(this.options.cheats));
    this.screen = 'BATTLE';
  }

  get tutorial(): boolean {
    return this.mode === 'tutorial';
  }

  /** The hint the terminal should show, or null outside the tutorial. */
  tutorialHint(): TutorialHint | null {
    return this.director?.hint() ?? null;
  }

  private startBattle(encounter: Encounter, startWave = 0): void {
    const run = this.run as Run;
    this.replaceWorld(
      new World({
        seed: run.battleSeed(),
        battleIndex: 1,
        encounter,
        startWave,
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

  /** Pause menu: give up the run; it counts as a death (or leaves the tutorial). */
  abandon(): void {
    if (this.screen !== 'PAUSED') return;
    if (this.mode === 'tutorial') {
      this.endTutorial();
      return;
    }
    if (!this.run) return;
    this.run.finishBattle(false, 0);
    this.screen = 'GAME_OVER';
  }

  private endTutorial(): void {
    this.mode = 'run';
    this.director = null;
    this.replaceWorld(this.titleWorld());
    this.screen = 'TITLE';
  }

  /** Called every frame: leaves the battle once the end-of-battle signal has played. */
  update(dt: number, events: readonly SimEvent[]): void {
    if (this.mode === 'tutorial') {
      this.updateTutorial(dt, events);
      return;
    }
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

  /** Runs the director and rolls a won battle into the next step, or COMPLETE. */
  private updateTutorial(dt: number, events: readonly SimEvent[]): void {
    const d = this.director;
    if (!d || this.screen !== 'BATTLE') return;
    const w = this.world;
    d.update(w, events, dt);
    if (w.state !== 'BATTLE_WON' || w.stateElapsed < secondsToTicks(tuning.fx.RESULT_DELAY_WIN)) return;
    d.advanceStep();
    if (d.done) {
      this.screen = 'COMPLETE';
      return;
    }
    this.replaceWorld(d.newWorld(this.options.cheats));
  }

  /** COMPLETE / GAME_OVER → TITLE. */
  toTitle(): void {
    if (this.screen !== 'COMPLETE' && this.screen !== 'GAME_OVER') return;
    if (this.mode === 'tutorial') {
      this.endTutorial();
      return;
    }
    this.run = null;
    this.debugFolder = null;
    this.replaceWorld(this.titleWorld());
    this.screen = 'TITLE';
  }

  // ---------- Debug ----------

  /** A fresh run that jumps straight into an encounter with the debug folder. */
  private debugBattle(encounter: Encounter, seed?: number, wave = 1): void {
    if (seed !== undefined) this.seed = seed >>> 0;
    this.run = this.newRun('basic');
    this.run.encounter = encounter;
    this.debugFolder = folderChips(this.options.folder);
    this.startBattle(encounter, wave - 1);
  }

  /** Jumps into old battle 1–4 with full HP (debug panel / ?battle=). */
  debugJump(index: number, seed?: number): void {
    this.debugBattle(debugEncounter(index), seed);
  }

  /** Jumps into any encounter by id (?encounter=), optionally from a later wave (?wave=, 1-based). */
  debugEncounter(id: string, seed?: number, wave = 1): boolean {
    const enc = encounterById(id);
    if (!enc) return false;
    this.debugBattle(enc, seed, wave);
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
