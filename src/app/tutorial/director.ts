import {
  TUTORIAL,
  TUTORIAL_ENCOUNTER,
  TUTORIAL_SEED,
  type BeatContext,
  type Callout,
  type CalloutTarget,
  type TutorialBeat,
  type TutorialLesson,
} from '../../data/tutorial';
import type { ChipId } from '../../data/chips';
import { secondsToTicks, tuning } from '../../config/tuning';
import { t } from '../../i18n';
import type { SimEvent } from '../../sim/events';
import { World, type Cheats, type Hold } from '../../sim/world';

// Runs the tutorial script (GDD §10.5). Pure: no DOM, no Three.js. Each wave of
// the tutorial encounter is one lesson; the director deals the lesson's chips,
// walks its beats and holds the battle while a callout is up (`World.hold`).

/** What the terminal draws: a big word and the controls it points at. */
export interface CalloutView {
  text: string;
  targets: readonly CalloutTarget[];
  /** Draw lines and dots to the targets. */
  arrows: boolean;
}

export class TutorialDirector {
  /** Lesson in play: the world's wave once its ACTION began; -1 before that. */
  lessonIndex = -1;
  private beatIndex = 0;
  /** `world.time` when the beat began. */
  private beatStart = 0;
  private fired = 0;
  private entered = false;
  /** The current beat's callout is up and the battle is held. */
  private showing = false;
  /** `world.uiTick` when the last callout closed. */
  private closedAt = -Infinity;

  /** The whole tutorial as one battle, from lesson `start` (0-based); the player cannot die. */
  newWorld(cheats: Cheats, start = 0): World {
    this.lessonIndex = -1;
    return new World({
      seed: TUTORIAL_SEED,
      battleIndex: 1,
      encounter: TUTORIAL_ENCOUNTER,
      startWave: start,
      cheats: { ...cheats, noKo: true },
      // Each lesson deals its own chips when its wave starts.
      folder: [],
      hand: [],
    });
  }

  get lesson(): TutorialLesson | null {
    return TUTORIAL[this.lessonIndex] ?? null;
  }

  private get beat(): TutorialBeat | null {
    return this.lesson?.beats[this.beatIndex] ?? null;
  }

  get beatId(): string | null {
    return this.beat?.id ?? null;
  }

  update(world: World, events: readonly SimEvent[]): void {
    // The next lesson's chips load mid-flight, while the field is swapped.
    if (events.some((e) => e.type === 'waveField')) this.startLesson(world, world.waveIndex);
    if (world.state !== 'ACTION') return;
    if (world.waveIndex !== this.lessonIndex) this.startLesson(world, world.waveIndex);
    for (const e of events) if (e.type === 'chipUsed') this.fired++;
    this.advance(world);
  }

  /** The callout on screen, or null. */
  callout(world: World): CalloutView | null {
    const c = this.showing ? this.beat?.callout : undefined;
    if (!c) return null;
    return {
      text: t(c.text),
      targets: c.gate === 'select' ? this.openSlots(c, world) : ['trackball'],
      arrows: c.arrows !== false,
    };
  }

  /**
   * Debug: get past the current beat. A callout is done for the player (a
   * select callout queues its chips); the last beat deletes the wave.
   */
  skip(world: World): void {
    const beat = this.beat;
    if (!beat || world.state !== 'ACTION') return;
    if (this.beatIndex === (this.lesson?.beats.length ?? 0) - 1) {
      world.killAllEnemies();
      return;
    }
    if (this.showing) this.closedAt = world.uiTick;
    world.hold = null;
    const c = beat.callout;
    if (c?.gate === 'select') {
      for (let slots = this.openSlots(c, world); slots.length > 0; slots = this.openSlots(c, world)) {
        if (!world.selectChip(slots[0] as number)) break;
      }
    }
    this.next(world);
    this.advance(world);
  }

  private startLesson(world: World, index: number): void {
    this.lessonIndex = index;
    const lesson = TUTORIAL[index];
    if (lesson) world.setFolder(lesson.folder, lesson.hand);
    world.hold = null;
    this.goTo(world, 0);
  }

  private goTo(world: World, index: number): void {
    this.beatIndex = index;
    this.beatStart = world.time;
    this.fired = 0;
    this.entered = false;
    this.showing = false;
  }

  private next(world: World): void {
    this.goTo(world, this.beatIndex + 1);
  }

  /** Walks the beats as far as this tick allows. */
  private advance(world: World): void {
    for (let guard = 0; guard < 16; guard++) {
      const beat = this.beat;
      if (!beat) return;
      if (!this.entered) {
        this.entered = true;
        beat.enter?.(world);
      }
      const ctx: BeatContext = { world, elapsed: world.time - this.beatStart, fired: this.fired };
      if (!this.showing && beat.skip?.(ctx)) {
        this.next(world);
        continue;
      }
      const c = beat.callout;
      if (!c) {
        if (beat.when && !beat.when(ctx)) {
          this.retry(world);
          return;
        }
        this.next(world);
        continue;
      }
      if (!this.showing) {
        if (beat.when && !beat.when(ctx)) return;
        if (!this.canShow(world)) return;
        this.showing = true;
        world.hold = this.holdFor(c, world);
        return;
      }
      if (!this.calloutDone(c, world)) {
        // Slots follow the chips as they are tapped.
        if (c.gate === 'select') world.hold = this.holdFor(c, world);
        return;
      }
      world.hold = null;
      this.closedAt = world.uiTick;
      this.next(world);
    }
  }

  /**
   * A callout waits for a quiet moment: the last one closed at least
   * `TUT_CALLOUT_GAP` ago, and nobody is still sliding between cells on screen.
   */
  private canShow(world: World): boolean {
    if (world.uiTick - this.closedAt < secondsToTicks(tuning.tutorial.TUT_CALLOUT_GAP)) return false;
    return settled(world);
  }

  private calloutDone(c: Callout, world: World): boolean {
    // Move and Attack lift the hold inside the world, on the very tick they happen.
    if (c.gate !== 'select') return world.hold === null;
    return this.leftToSelect(c, world).length === 0;
  }

  private holdFor(c: Callout, world: World): Hold {
    if (c.gate === 'move') return { move: true };
    if (c.gate === 'attack') return { attack: true };
    return { slots: this.openSlots(c, world) };
  }

  /** Select callout: the chips not queued yet (none once one is, for `any`). */
  private leftToSelect(c: Callout, world: World): ChipId[] {
    const left = [...(c.chips ?? [])];
    const queued = world.chips.attackChips();
    if (c.any) return queued.some((q) => left.includes(q.defId)) ? [] : left;
    for (const q of queued) {
      const i = left.indexOf(q.defId);
      if (i >= 0) left.splice(i, 1);
    }
    return left;
  }

  /** Select callout: rail slots holding the chips still to tap. */
  private openSlots(c: Callout, world: World): number[] {
    const chips = world.chips;
    const left = this.leftToSelect(c, world);
    const slots: number[] = [];
    for (const id of left) {
      const slot = chips.hand.findIndex((h, i) => h?.defId === id && chips.queueIndexOf(i) < 0 && !slots.includes(i));
      if (slot >= 0) slots.push(slot);
    }
    return slots;
  }

  /** A missed shot: once the hand has refilled, the lesson goes round again. */
  private retry(world: World): void {
    const lesson = this.lesson;
    if (lesson?.retry === undefined || this.beatIndex !== lesson.beats.length - 1) return;
    const chips = world.chips;
    const refilled = chips.phase === 'selecting' && chips.attack.length === 0 && chips.hand.some((c) => c !== null);
    if (refilled && !world.activeChip && world.enemies.some((e) => e.alive)) this.goTo(world, lesson.retry);
  }
}

/**
 * Everyone stands in their cell on screen: a step is instant in the sim but the
 * view slides over `CELL_MOVE_TIME` (player) or the enemy's move time (`render/actors.ts`).
 */
export function settled(world: World): boolean {
  const hz = tuning.sim.SIM_HZ;
  const p = world.player;
  if (world.playerTick - p.lastMoveTick < tuning.player.CELL_MOVE_TIME * hz) return false;
  return world.enemies.every((e) => !e.alive || world.tick - e.lastMoveTick >= e.moveDurationSeconds() * hz);
}
