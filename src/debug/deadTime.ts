import { secondsToTicks, tuning } from '../config/tuning';
import type { EnemyState } from '../sim/enemies/enemyBase';
import type { World } from '../sim/world';

// Playtest metric (plan 2026-09-25, task 1): battle time with nothing to answer
// and nothing being done. Real seconds at TIME_SCALE 1; pauses and tutorial
// holds are not counted.

/** Enemy phases that already threaten the player. */
const THREAT_PHASES: ReadonlySet<EnemyState> = new Set(['INTENTION', 'LOCK', 'COUNTER', 'STRIKE']);

export interface DeadTimeStats {
  /** Counted battle time, s. */
  total: number;
  /** Dead time inside ACTION, s. */
  fight: number;
  /** Battle intro and wave transitions, s (all dead). */
  transition: number;
  /** Longest unbroken dead stretch, s. */
  longest: number;
}

/** An enemy telegraphs or strikes, or an enemy attack is on the field. */
export function threatActive(world: World): boolean {
  return world.attacks.length > 0 || world.enemies.some((e) => e.alive && THREAT_PHASES.has(e.state));
}

/** The player steps, uses a chip or has chips queued. */
export function playerActing(world: World): boolean {
  const p = world.player;
  return world.activeChip !== null ||
    world.chips.attack.length > 0 ||
    world.playerTick - p.lastMoveTick < secondsToTicks(tuning.player.CELL_MOVE_TIME);
}

/** Observes a world once per simulation tick; starts over when the battle changes. */
export class DeadTimeMeter {
  private world: World | null = null;
  // Tick counts; seconds are derived so sums stay exact.
  private totalTicks = 0;
  private fightTicks = 0;
  private transitionTicks = 0;
  private stretchTicks = 0;
  private longestTicks = 0;

  get stats(): DeadTimeStats {
    const s = (ticks: number) => ticks / tuning.sim.SIM_HZ;
    return {
      total: s(this.totalTicks),
      fight: s(this.fightTicks),
      transition: s(this.transitionTicks),
      longest: s(this.longestTicks),
    };
  }

  observe(world: World): void {
    if (world !== this.world) {
      this.world = world;
      this.totalTicks = this.fightTicks = this.transitionTicks = this.stretchTicks = this.longestTicks = 0;
    }
    let dead: boolean;
    if (world.state === 'BATTLE_INTRO' || world.state === 'WAVE_CLEAR' || world.state === 'WAVE_INTRO') {
      this.transitionTicks++;
      dead = true;
    } else if (world.state === 'ACTION' && !world.simFrozen) {
      dead = !threatActive(world) && !playerActing(world);
      if (dead) this.fightTicks++;
    } else {
      return;
    }
    this.totalTicks++;
    this.stretchTicks = dead ? this.stretchTicks + 1 : 0;
    this.longestTicks = Math.max(this.longestTicks, this.stretchTicks);
  }
}

export function formatDeadTime(s: DeadTimeStats): string {
  const dead = s.fight + s.transition;
  const share = s.total > 0 ? Math.round((dead / s.total) * 100) : 0;
  return `dead ${dead.toFixed(1)}s ${share}% (fight ${s.fight.toFixed(1)} + trans ${s.transition.toFixed(1)})` +
    ` max ${s.longest.toFixed(1)}s / ${s.total.toFixed(1)}s`;
}
