import { tuning } from '../../config/tuning';
import { TUTORIAL, TUTORIAL_SEED, type BeatContext, type HintFocus, type TutorialBeat, type TutorialStep } from '../../data/tutorial';
import { t } from '../../i18n';
import type { SimEvent } from '../../sim/events';
import { World, type Cheats } from '../../sim/world';

// Runs the tutorial script (tutorial spec §4.2). Pure: no DOM, no Three.js.
// It reads the world and the tick's events, decides when a beat is passed, and
// reports how loudly to hint. It never touches input.

export interface TutorialHint {
  level: 0 | 1 | 2 | 3;
  focus: HintFocus | null;
  /** Text for the 14-segment display, or null. */
  seg: string | null;
  /** Text for the CRT line, or null. */
  line: string | null;
}

const NO_HINT: TutorialHint = { level: 0, focus: null, seg: null, line: null };

export class TutorialDirector {
  stepIndex = 0;
  private beatIndex = 0;
  private finished = false;
  /** Seconds since the player last did something that counts. */
  private idle = 0;
  private counts = { steps: 0, enemyAttacks: 0, selected: 0, fired: 0 };
  /** Player cell and queue length at the start of the current beat, to spot what changed. Set by `startBeat`. */
  private lastCell = '';
  private lastQueued = 0;
  /** Whether the current beat's `enter` hook has run. */
  private entered = false;

  get step(): TutorialStep {
    return TUTORIAL[Math.min(this.stepIndex, TUTORIAL.length - 1)] as TutorialStep;
  }

  private get beat(): TutorialBeat {
    const beats = this.step.beats;
    return beats[Math.min(this.beatIndex, beats.length - 1)] as TutorialBeat;
  }

  get beatId(): string {
    return this.beat.id;
  }

  get done(): boolean {
    return this.finished;
  }

  /** The world for the current step: exact hand, fixed seed, no KO. */
  newWorld(cheats: Cheats): World {
    const step = this.step;
    this.beatIndex = 0;
    const world = new World({
      seed: TUTORIAL_SEED + this.stepIndex,
      battleIndex: 1,
      encounter: step.encounter,
      cheats: { ...cheats, noKo: true },
      folder: step.folder,
      hand: step.hand,
    });
    // Baseline captured now, at battle start, so the player's very first move
    // is measured against it — not against a snapshot taken during `update`.
    this.startBeat(world);
    return world;
  }

  /** The battle was won: move to the next step, or finish. */
  advanceStep(): void {
    if (this.stepIndex >= TUTORIAL.length - 1) {
      this.finished = true;
      this.stepIndex = TUTORIAL.length;
      return;
    }
    this.stepIndex++;
  }

  /** Resets counters and the change-detector baseline for the (now current) beat. */
  private startBeat(world: World): void {
    this.counts = { steps: 0, enemyAttacks: 0, selected: 0, fired: 0 };
    this.idle = 0;
    this.lastCell = `${world.player.x},${world.player.y}`;
    this.lastQueued = world.chips.attack.length;
    this.entered = false;
  }

  update(world: World, events: readonly SimEvent[], dt: number): void {
    if (this.finished) return;
    // The beat's own `enter` hook runs once, on this first update — never in
    // `newWorld` — so its effect (e.g. a dealt cassette) lands on a real tick.
    if (!this.entered) {
      this.entered = true;
      this.beat.enter?.(world);
    }

    let acted = false;
    const cell = `${world.player.x},${world.player.y}`;
    if (cell !== this.lastCell) {
      this.counts.steps++;
      acted = true;
    }
    this.lastCell = cell;

    const queued = world.chips.attack.length;
    if (queued > this.lastQueued) {
      this.counts.selected += queued - this.lastQueued;
      acted = true;
    }
    this.lastQueued = queued;

    for (const e of events) {
      if (e.type === 'attackSpawned') this.counts.enemyAttacks++;
      if (e.type === 'chipUsed') {
        this.counts.fired++;
        acted = true;
      }
    }

    this.idle = acted ? 0 : this.idle + dt;

    const ctx: BeatContext = { world, ...this.counts };
    if (!this.beat.done(ctx)) return;
    // The last beat of a step ends the battle; that is the caller's job.
    if (this.beatIndex < this.step.beats.length - 1) {
      this.beatIndex++;
      this.startBeat(world);
      // Run the new beat's `enter` right away: this update is its first tick,
      // and the caller does not get another chance before reading `beatId`.
      this.entered = true;
      this.beat.enter?.(world);
      this.lastCell = `${world.player.x},${world.player.y}`;
      this.lastQueued = world.chips.attack.length;
    }
  }

  hint(): TutorialHint {
    if (this.finished) return NO_HINT;
    const beat = this.beat;
    const { TUT_HINT_PULSE, TUT_HINT_SEG, TUT_HINT_LINE } = tuning.tutorial;
    let level: TutorialHint['level'] = 0;
    if (this.idle >= TUT_HINT_LINE) level = 3;
    else if (this.idle >= TUT_HINT_SEG) level = 2;
    else if (this.idle >= TUT_HINT_PULSE) level = 1;
    if (level === 0) return NO_HINT;
    return {
      level,
      focus: beat.focus,
      seg: level >= 2 && beat.seg ? t(beat.seg) : null,
      line: level >= 3 && beat.line ? t(beat.line) : null,
    };
  }
}
