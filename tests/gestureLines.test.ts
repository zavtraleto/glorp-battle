import { describe, expect, it } from 'vitest';
import { gestureLines } from '../src/debug/overlay';
import type { GestureStats } from '../src/terminal/interaction/pointerRouter';

function gesture(movesAtStart: number, steps: GestureStats['steps'], active = false): GestureStats {
  return { startedAt: 0, net: 100.4, path: 120.6, duration: 0.15, steps, active, movesAtStart };
}

describe('overlay swipe lines', () => {
  it('counts each gesture\'s moves up to the start of the next one', () => {
    // Newest first: the older gesture moved 2 cells (3 → 5), the newer one 1 so far.
    const lines = gestureLines([gesture(5, ['up'], true), gesture(3, ['down', 'down', 'down'])], 6).split('\n');
    expect(lines).toEqual([
      '>swipe 100px path 121 150ms cmd 1 U moved 1',
      ' swipe 100px path 121 150ms cmd 3 DDD moved 2',
    ]);
  });
});
