import { tuning } from '../config/tuning';
import type { StringKey } from '../i18n/en';
import type { ChipId } from './chips';
import type { FolderChip } from '../sim/chips/chipSystem';
import type { World } from '../sim/world';
import { e, wave, type Encounter } from './encounters';

// The tutorial script (GDD §10.5): one encounter of four waves, one lesson per
// wave. A lesson is a list of beats. A callout beat freezes the battle until the
// player does what it asks; a wait beat lets the battle run until its condition
// holds. Chips are exact: every lesson brings its own folder and hand.

/** What a callout points at: the trackball or a rail slot. */
export type CalloutTarget = 'trackball' | number;

export interface Callout {
  text: StringKey;
  /** What lifts the callout: a step, an Attack press, or queueing `chips`. */
  gate: 'move' | 'attack' | 'select';
  /** Select gate: the chips to queue, wherever they sit in the rail. */
  chips?: readonly ChipId[];
  /** Select gate: any one of `chips` is enough. */
  any?: boolean;
  /** false: no lines or dots, only the word (the targets still stay out of the dim). */
  arrows?: boolean;
}

/** What a beat can see: the world and a few counters since it began. */
export interface BeatContext {
  world: World;
  /** Simulated seconds since the beat began. */
  elapsed: number;
  /** Chips fired since the beat began. */
  fired: number;
}

export interface TutorialBeat {
  id: string;
  /** Runs once when the beat starts. */
  enter?(world: World): void;
  /** A callout beat holds the battle; it ends when the player has done it. */
  callout?: Callout;
  /** A callout waits for this before it shows; a wait beat ends when it holds. */
  when?(c: BeatContext): boolean;
  /** The beat no longer makes sense: go straight to the next one. */
  skip?(c: BeatContext): boolean;
}

export interface TutorialLesson {
  id: string;
  folder: readonly FolderChip[];
  /** The hand when the wave starts, by slot; null leaves the slot empty. */
  hand: readonly (FolderChip | null)[];
  beats: readonly TutorialBeat[];
  /**
   * Beat to return to when the last beat runs, enemies are alive and the hand
   * refilled with nothing queued (a missed shot). Undefined: no second pass.
   */
  retry?: number;
}

/** One fixed seed: the tutorial plays the same way every time. */
export const TUTORIAL_SEED = 20260919;

const chip = (defId: FolderChip['defId']): FolderChip => ({ defId });
const EMPTY_HAND: readonly (FolderChip | null)[] = [null, null, null, null, null];

/** The player can press Attack right now and the loaded chip would hit someone. */
export function readyToHit(w: World): boolean {
  const p = w.player;
  if (p.flinched || p.paralyzeTicks > 0 || p.actionTicks > 0 || w.activeChip) return false;
  const aim = w.aimPreview();
  return !!aim && aim.cells.some((c) => w.enemies.some((en) => en.alive && en.x === c.x && en.y === c.y));
}

/**
 * The chip the beat waits on is gone: fired on the player's own (a miss) or
 * burned by a broken combo. On to the last beat, where the lesson can retry.
 */
const NOTHING_QUEUED: TutorialBeat['skip'] = (c) => c.world.chips.attack.length === 0;

/** Last beat of a lesson: the battle runs until the wave is deleted. */
const CLEAR: TutorialBeat = { id: 'clear', when: () => false };

const move: TutorialLesson = {
  id: 'move',
  folder: [chip('cannon')],
  hand: EMPTY_HAND,
  beats: [
    { id: 'move', callout: { text: 'tutorial.move', gate: 'move' } },
    // Free movement: the Mettik gets to throw at least one wave at a moving target.
    { id: 'roam', when: (c) => c.elapsed >= tuning.tutorial.TUT_FREE_MOVE },
    {
      id: 'select',
      // The first cassette flies into the leftmost slot.
      enter: (w) => void w.dealChip(0, chip('cannon')),
      callout: { text: 'tutorial.select', gate: 'select', chips: ['cannon'] },
    },
    // The player lines up on their own; the callout waits for a sure hit.
    { id: 'attack', callout: { text: 'tutorial.attack', gate: 'attack' }, when: (c) => readyToHit(c.world), skip: NOTHING_QUEUED },
    CLEAR,
  ],
  retry: 2,
};

const two: TutorialLesson = {
  id: 'two',
  folder: [chip('cannon'), chip('cannon')],
  hand: [chip('cannon'), chip('cannon'), null, null, null],
  beats: [
    { id: 'select', callout: { text: 'tutorial.selectTwo', gate: 'select', chips: ['cannon', 'cannon'] } },
    { id: 'first', when: (c) => c.fired >= 1 },
    {
      id: 'again',
      // Every queued chip needs its own press: said once, when it would hit.
      callout: { text: 'tutorial.again', gate: 'attack' },
      when: (c) => readyToHit(c.world),
      // A hit taken breaks the combo and burns the second cannon (GDD §6.6).
      skip: NOTHING_QUEUED,
    },
    CLEAR,
  ],
};

const grab: TutorialLesson = {
  id: 'grab',
  folder: [chip('areagrab'), chip('sword')],
  hand: [chip('areagrab'), chip('sword'), null, null, null],
  // One nudge, no arrows: any chip lifts it. Grab first, step up, swing — the
  // player works that out alone.
  beats: [
    { id: 'select', callout: { text: 'tutorial.select', gate: 'select', chips: ['areagrab', 'sword'], any: true, arrows: false } },
    CLEAR,
  ],
};

const exam: TutorialLesson = {
  id: 'exam',
  folder: [chip('cannon'), chip('cannon'), chip('sword'), chip('areagrab')],
  hand: [chip('cannon'), chip('cannon'), chip('sword'), chip('areagrab'), null],
  // No callouts: the player puts it all together.
  beats: [CLEAR],
};

/** One lesson per wave of `TUTORIAL_ENCOUNTER`. */
export const TUTORIAL: readonly TutorialLesson[] = [move, two, grab, exam];

export const TUTORIAL_ENCOUNTER: Encounter = {
  id: 'tutorial',
  tier: 'normal',
  minDepth: 1,
  maxDepth: 1,
  waves: [
    wave(e('mettik', 1, 1)),
    // One in the middle of the field, the other behind it on the left.
    wave(e('mettik', 1, 1), e('mettik', 0, 0)),
    // Row 1 is out of sword reach from the player's own area: the row in front has to be taken.
    wave(e('mettik', 1, 1)),
    // Canodron in the middle row, a Mettik in front of it on the left and one behind it on the right.
    wave(e('mettik', 0, 2), e('canodron', 1, 1), e('mettik', 2, 0)),
  ],
};
