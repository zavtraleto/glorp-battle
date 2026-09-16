import { secondsToTicks, tuning } from '../config/tuning';
import { deriveSeed } from '../core/rng';
import { BATTLES } from '../data/battles';
import type { FolderId } from '../data/folders';
import { World, type Cheats } from '../sim/world';

// Battle sequence and out-of-battle screens (GDD §10, §11). Pure: no DOM.

export type Screen = 'TITLE' | 'BATTLE' | 'PAUSED' | 'RESULT' | 'DEFEAT' | 'COMPLETE';

export interface BattleResult {
  battle: number;
  /** Simulated battle time in seconds. */
  time: number;
  hits: number;
  hpLeft: number;
}

export interface SessionOptions {
  seed: number;
  cheats: Cheats;
  folder: FolderId;
}

export class Session {
  screen: Screen = 'TITLE';
  /** 1-based index of the current battle. */
  battleIndex = 1;
  /** Player HP at the start of the current battle (Retry restores it, GDD §10.2). */
  hpAtBattleStart: number;
  /** Retries of the current battle; each attempt reshuffles the folder. */
  attempt = 0;
  results: BattleResult[] = [];
  world: World;
  seed: number;
  /** Bumped whenever `world` is replaced, so views can reset. */
  worldVersion = 0;

  constructor(private options: SessionOptions) {
    this.seed = options.seed;
    this.hpAtBattleStart = tuning.player.PLAYER_MAX_HP;
    this.world = this.makeWorld();
    this.world.state = 'TITLE';
  }

  get battleCount(): number {
    return BATTLES.length;
  }

  /** Seed of the current battle attempt: independent per battle and per retry. */
  get battleSeed(): number {
    return deriveSeed(this.seed, `battle${this.battleIndex}/attempt${this.attempt}`);
  }

  private makeWorld(): World {
    return new World({
      seed: this.battleSeed,
      battleIndex: this.battleIndex,
      playerHp: this.hpAtBattleStart,
      cheats: this.options.cheats,
      folder: this.options.folder,
    });
  }

  private startBattle(): void {
    this.world = this.makeWorld();
    this.worldVersion++;
    this.screen = 'BATTLE';
  }

  /** Title → battle 1 with full HP. Also used by Restart. */
  start(): void {
    this.battleIndex = 1;
    this.attempt = 0;
    this.hpAtBattleStart = tuning.player.PLAYER_MAX_HP;
    this.results = [];
    this.startBattle();
  }

  retry(): void {
    this.attempt++;
    this.startBattle();
  }

  /** RESULT → next battle (HP carries over) or the final screen. */
  next(): void {
    if (this.screen !== 'RESULT') return;
    if (this.battleIndex >= this.battleCount) {
      this.screen = 'COMPLETE';
      return;
    }
    this.hpAtBattleStart = this.world.player.hp;
    this.battleIndex++;
    this.attempt = 0;
    this.startBattle();
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

  /** Called every frame: moves to RESULT / DEFEAT once the end-of-battle banner has shown. */
  update(): void {
    if (this.screen !== 'BATTLE') return;
    const w = this.world;
    if (w.state === 'BATTLE_WON' && w.stateElapsed >= secondsToTicks(tuning.fx.RESULT_DELAY_WIN)) {
      this.results.push({ battle: this.battleIndex, time: w.time, hits: w.player.hitsTaken, hpLeft: w.player.hp });
      this.screen = 'RESULT';
    } else if (w.state === 'PLAYER_DEAD' && w.stateElapsed >= secondsToTicks(tuning.fx.RESULT_DELAY_LOSE)) {
      this.screen = 'DEFEAT';
    }
  }

  get lastResult(): BattleResult | undefined {
    return this.results[this.results.length - 1];
  }

  get totalTime(): number {
    return this.results.reduce((t, r) => t + r.time, 0);
  }

  // ---------- Debug ----------

  /** Jumps straight into battle `index` with full HP (debug panel / ?battle=). */
  debugJump(index: number, seed?: number): void {
    if (seed !== undefined) this.seed = seed >>> 0;
    this.battleIndex = Math.min(this.battleCount, Math.max(1, Math.floor(index)));
    this.attempt = 0;
    this.hpAtBattleStart = tuning.player.PLAYER_MAX_HP;
    this.results = [];
    this.startBattle();
  }
}
