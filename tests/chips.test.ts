import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { Command } from '../src/core/input/commands';
import { CHIPS, type ChipId } from '../src/data/chips';
import { FOLDERS, FOLDER_SIZE } from '../src/data/folders';
import { isValidSelection, type ChipKey } from '../src/sim/chips/selection';
import { Mettik } from '../src/sim/enemies/mettik';
import { World } from '../src/sim/world';
import { chipDesc, chipName } from '../src/i18n';
import { CHIP_ICONS } from '../src/terminal/chips/chipIcons';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => {
  mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING)));
});

const k = (defId: ChipKey['defId'], code: ChipKey['code']): ChipKey => ({ defId, code });

describe('folders', () => {
  it('the starting folders contain exactly 30 chips', () => {
    for (const id of ['basic', 'field'] as const) {
      expect(FOLDERS[id].reduce((n, e) => n + e.count, 0)).toBe(FOLDER_SIZE);
    }
  });

  it('use codes the chip can have', () => {
    for (const folder of Object.values(FOLDERS)) {
      for (const e of folder) expect(CHIPS[e.chip].codes, `${e.chip} ${e.code}`).toContain(e.code);
    }
  });
});

describe('chip catalogue (MMBN3)', () => {
  it.each([
    ['cannon', 40], ['hicannon', 60], ['mcannon', 80], ['longsword', 80], ['minibomb', 50], ['shockwave', 60], ['zapring', 20],
  ] as const)('%s deals %i (MMBN3)', (id, power) => {
    expect(CHIPS[id].power).toBe(power);
  });

  it('every chip has a name, a description and an icon', () => {
    for (const id of Object.keys(CHIPS) as ChipId[]) {
      expect(chipName(id).length).toBeLessThanOrEqual(9);
      expect(chipDesc(id).length).toBeGreaterThan(0);
      expect(CHIP_ICONS[id]).toBeDefined();
    }
  });
});

describe('selection rule', () => {
  it('accepts same name with different codes', () => {
    expect(isValidSelection([k('cannon', 'A'), k('cannon', 'B'), k('cannon', 'C')])).toBe(true);
  });

  it('accepts same code with different names', () => {
    expect(isValidSelection([k('cannon', 'A'), k('recover50', 'A')])).toBe(true);
    expect(isValidSelection([k('sword', 'S'), k('widesword', 'S'), k('longsword', 'S')])).toBe(true);
  });

  it('does not mix the two rules', () => {
    expect(isValidSelection([k('cannon', 'A'), k('cannon', 'F'), k('recover50', 'A')])).toBe(false);
    expect(isValidSelection([k('cannon', 'A'), k('sword', 'S')])).toBe(false);
  });

  it('treats * as a wildcard code', () => {
    expect(isValidSelection([k('cannon', '*'), k('sword', 'S')])).toBe(true);
    expect(isValidSelection([k('cannon', 'A'), k('sword', '*'), k('recover50', 'A')])).toBe(true);
    expect(isValidSelection([k('cannon', 'A'), k('sword', '*'), k('widesword', 'S')])).toBe(false);
  });
});

function step(w: World, commands: Command[] = []): void {
  w.step(DT, { commands, held: null });
}

function run(w: World, n: number): void {
  for (let i = 0; i < n; i++) step(w);
}

describe('battle flow', () => {
  it('goes straight from the intro into ACTION with a dealt hand', () => {
    const w = new World({ seed: 1, battleIndex: 1 });
    expect(w.state).toBe('BATTLE_INTRO');
    run(w, T(tuning.fx.INTRO_TIME));
    expect(w.state).toBe('ACTION');
    expect(w.chips.hand).toHaveLength(tuning.chips.HAND_SIZE);
    expect(w.chips.hand.every((c) => c !== null)).toBe(true);
    expect(w.tick).toBe(0);
  });

  it('freezes the battle only during the intro', () => {
    const w = new World({ seed: 1, battleIndex: 1 });
    run(w, T(tuning.fx.INTRO_TIME) - 1);
    const m = w.enemies[0] as Mettik;
    expect(w.state).toBe('BATTLE_INTRO');
    expect(w.tick).toBe(0);
    expect(m.state).toBe('IDLE');
  });

  it('never stops the battle again once it runs', () => {
    const w = new World({ seed: 1, battleIndex: 1, skipIntro: true, cheats: { god: true, aiEnabled: false } });
    // The battle must outlive the chips being fired at it.
    for (const e of w.enemies) e.hp = 100_000;
    for (let i = 0; i < 600; i++) {
      step(w, [{ type: 'selectChip', slot: i % tuning.chips.HAND_SIZE }, { type: 'useChip' }]);
      expect(w.state).toBe('ACTION');
    }
    expect(w.tick).toBe(600);
  });

  it('builds the Attack Queue from a command and fires it', () => {
    const w = new World({ seed: 1, battleIndex: 1, skipIntro: true, cheats: { god: true, aiEnabled: false } });
    const slot = w.chips.hand.findIndex((c) => c !== null);
    step(w, [{ type: 'selectChip', slot }]);
    expect(w.chips.attack).toEqual([slot]);
    step(w, [{ type: 'useChip' }]);
    expect(w.chips.attack).toHaveLength(0);
    expect(w.chips.hand[slot]).toBeNull();
  });

  it('refreshes the hand after REFRESH_AT chips, without leaving ACTION', () => {
    const w = new World({ seed: 1, battleIndex: 1, skipIntro: true, cheats: { god: true, aiEnabled: false } });
    let fired = 0;
    for (let i = 0; i < 400 && fired < tuning.chips.REFRESH_AT; i++) {
      const slot = w.chips.hand.findIndex((c, j) => c !== null && w.chips.canSelect(j));
      if (slot >= 0 && w.chips.attack.length === 0) step(w, [{ type: 'selectChip', slot }]);
      const before = w.chips.count('used');
      step(w, [{ type: 'useChip' }]);
      if (w.chips.count('used') > before) fired++;
    }
    expect(fired).toBe(tuning.chips.REFRESH_AT);
    run(w, 1);
    expect(w.state).toBe('ACTION');
    expect(w.chips.usedSinceRefresh).toBe(0);
    expect(w.chips.hand.every((c) => c !== null)).toBe(true);
  });

  it('reshuffles spent chips and emits drawReshuffled once the draw pile runs dry', () => {
    // Small folder so a couple of Refreshes exhaust the draw pile.
    const smallFolder = Array.from({ length: 8 }, () => ({ defId: 'cannon' as const, code: 'A' as const }));
    const w = new World({
      seed: 1,
      battleIndex: 1,
      folder: smallFolder,
      skipIntro: true,
      cheats: { god: true, aiEnabled: false },
    });
    for (const e of w.enemies) e.hp = 100_000;
    let seenReshuffled = false;
    for (let i = 0; i < 2000 && w.chips.reshuffles === 0; i++) {
      const slot = w.chips.hand.findIndex((c, j) => c !== null && w.chips.canSelect(j));
      if (slot >= 0 && w.chips.attack.length === 0) step(w, [{ type: 'selectChip', slot }]);
      step(w, [{ type: 'useChip' }]);
      for (const e of w.drainEvents()) if (e.type === 'drawReshuffled') seenReshuffled = true;
    }
    expect(w.chips.reshuffles).toBe(1);
    expect(seenReshuffled).toBe(true);
    expect(w.chips.hand.every((c) => c !== null)).toBe(true);
  });

  it('ignores chip selection outside ACTION', () => {
    const w = new World({ seed: 1, battleIndex: 1 });
    expect(w.state).toBe('BATTLE_INTRO');
    expect(w.selectChip(0)).toBe(false);
  });
});
