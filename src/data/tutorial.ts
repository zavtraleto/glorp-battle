import type { StringKey } from '../i18n/en';
import type { FolderChip } from '../sim/chips/chipSystem';
import type { World } from '../sim/world';
import type { Encounter } from './encounters';

// The tutorial script (tutorial spec §3): four battles, each split into beats.
// A beat waits until the player has shown it understands, then the next starts.
// Chips are exact — nothing here is shuffled.

export type HintFocus = 'move' | 'chip' | 'fire';

/** Counters the director keeps for the current beat, plus the live world. */
export interface BeatContext {
  world: World;
  /** Panels the player has stepped onto since the beat began. */
  steps: number;
  /** Enemy attacks spawned since the beat began. */
  enemyAttacks: number;
  /** Chips added to the Attack Queue since the beat began. */
  selected: number;
  /** Chips fired since the beat began. */
  fired: number;
}

export interface TutorialBeat {
  id: string;
  focus: HintFocus;
  /** Short hint for the 14-segment display; null = no hint for this beat. */
  seg: StringKey | null;
  /** Long hint for the CRT; null = no hint for this beat. */
  line: StringKey | null;
  /** Runs once when the beat starts. */
  enter?(world: World): void;
  done(ctx: BeatContext): boolean;
}

export interface TutorialStep {
  id: string;
  encounter: Encounter;
  /** Everything this battle can draw, the starting hand included. */
  folder: readonly FolderChip[];
  /** The starting hand by slot; null leaves the slot empty. */
  hand: readonly (FolderChip | null)[];
  beats: readonly TutorialBeat[];
}

/** One fixed seed: the tutorial plays the same way every time. */
export const TUTORIAL_SEED = 20260919;

const chip = (defId: FolderChip['defId'], code: FolderChip['code']): FolderChip => ({ defId, code });

/** The battle is over; the director moves on by itself. */
const WIN: TutorialBeat['done'] = (c) => c.world.enemies.every((e) => !e.alive);

const step1: TutorialStep = {
  id: 'move',
  encounter: { id: 'tut1', tier: 'normal', minDepth: 1, maxDepth: 1, enemies: [{ kind: 'mettik', x: 1, y: 1, level: 1 }] },
  folder: [chip('cannon', '*')],
  hand: [null, null, null, null, null],
  beats: [
    {
      id: 'swipe',
      focus: 'move',
      seg: 'tutorial.seg.move',
      line: 'tutorial.line.move',
      // Three steps and one survived attack: only someone who moves gets through.
      done: (c) => c.steps >= 3 && c.enemyAttacks >= 1,
    },
    {
      id: 'load',
      focus: 'chip',
      seg: 'tutorial.seg.chip',
      line: 'tutorial.line.chip',
      // The first cassette flies into the middle slot.
      enter: (w) => void w.dealChip(2, chip('cannon', '*')),
      done: (c) => c.selected >= 1,
    },
    {
      id: 'fire',
      focus: 'fire',
      seg: 'tutorial.seg.fire',
      line: 'tutorial.line.fire',
      done: WIN,
    },
  ],
};

const step2: TutorialStep = {
  id: 'queue',
  encounter: {
    id: 'tut2', tier: 'normal', minDepth: 1, maxDepth: 1,
    enemies: [{ kind: 'mettik', x: 0, y: 1, level: 1 }, { kind: 'mettik', x: 2, y: 1, level: 1 }],
  },
  // Two identical chips teach queueing without introducing code rules in v0.1.
  folder: [chip('cannon', '*'), chip('cannon', '*')],
  hand: [chip('cannon', '*'), chip('cannon', '*'), null, null, null],
  beats: [{ id: 'two', focus: 'chip', seg: 'tutorial.seg.queue', line: 'tutorial.line.queue', done: WIN }],
};

const step3: TutorialStep = {
  id: 'panel',
  // Row 1 is out of sword reach from the player's own area: the panel has to move.
  encounter: { id: 'tut3', tier: 'normal', minDepth: 1, maxDepth: 1, enemies: [{ kind: 'mettik', x: 1, y: 1, level: 1 }] },
  folder: [chip('areagrab', '*'), chip('sword', '*')],
  hand: [chip('areagrab', '*'), chip('sword', '*'), null, null, null],
  beats: [{ id: 'grab', focus: 'chip', seg: 'tutorial.seg.panel', line: 'tutorial.line.panel', done: WIN }],
};

const step4: TutorialStep = {
  id: 'graduate',
  encounter: {
    id: 'tut4', tier: 'normal', minDepth: 1, maxDepth: 1,
    enemies: [{ kind: 'canodron', x: 1, y: 0, level: 1 }, { kind: 'mettik', x: 0, y: 2, level: 1 }],
  },
  // Cannon (4) does not drop Canodron (6) in one shot, so the hand runs out
  // and spent slots refill on their own — no lesson needed for it.
  folder: [
    chip('cannon', '*'), chip('cannon', '*'), chip('sword', '*'), chip('areagrab', '*'), chip('spreader', '*'),
    chip('cannon', '*'), chip('spreader', '*'),
  ],
  hand: [chip('cannon', '*'), chip('cannon', '*'), chip('sword', '*'), chip('areagrab', '*'), chip('spreader', '*')],
  // The exam: no hints at all.
  beats: [{ id: 'exam', focus: 'fire', seg: null, line: null, done: WIN }],
};

export const TUTORIAL: readonly TutorialStep[] = [step1, step2, step3, step4];
