import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks, tuning } from '../src/config/tuning';
import type { Command } from '../src/core/input/commands';
import { CHIPS, type ChipId } from '../src/data/chips';
import { canAddToSelection } from '../src/sim/chips/selection';
import { Mettik } from '../src/sim/enemies/mettik';
import { World } from '../src/sim/world';
import { chipDesc, chipName } from '../src/i18n';
import { CHIP_ICONS } from '../src/terminal/chips/chipIcons';

const DT = 1 / 60;
const T = (s: number) => secondsToTicks(s);

beforeEach(() => {
  mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING)));
});

describe('chip catalogue (compact MMBN3 scale)', () => {
  it('contains exactly the ten v0.1 playtest chips', () => {
    expect(Object.keys(CHIPS)).toEqual([
      'cannon', 'sword', 'areagrab', 'mine', 'block',
      'break', 'airshot', 'spreader', 'widesword', 'guard',
    ]);
  });

  it('keeps the required relative power relationships', () => {
    expect(CHIPS.sword.power).toBeGreaterThan(CHIPS.cannon.power!);
    expect(CHIPS.mine.power).toBeGreaterThan(CHIPS.cannon.power!);
    expect(CHIPS.airshot.power).toBeLessThan(CHIPS.cannon.power!);
    expect(CHIPS.widesword.power).toBeLessThan(CHIPS.sword.power!);
    expect(CHIPS.spreader.splashPower).toBeLessThan(CHIPS.spreader.power!);
  });

  it('every chip has a name, a description and an icon', () => {
    for (const id of Object.keys(CHIPS) as ChipId[]) {
      expect(chipName(id).length).toBeLessThanOrEqual(9);
      expect(chipDesc(id).length).toBeGreaterThan(0);
      expect(CHIP_ICONS[id]).toBeDefined();
    }
  });

  it('uses the approved full player-facing names', () => {
    expect(Object.fromEntries((Object.keys(CHIPS) as ChipId[]).map((id) => [id, chipName(id)]))).toEqual({
      cannon: 'Cannon',
      sword: 'Sword',
      areagrab: 'Area Grab',
      mine: 'Mine',
      block: 'Block',
      break: 'Break',
      airshot: 'AirShot',
      spreader: 'Spreader',
      widesword: 'WideSword',
      guard: 'Guard',
    });
    expect(chipDesc('mine')).toContain('three cells ahead');
    expect(chipDesc('break')).toContain('three cells ahead');
  });

  it('defines Guard as a one-charge support chip', () => {
    expect(CHIPS.guard).toMatchObject({
      id: 'guard',
      power: null,
      kind: 'support',
      guard: true,
      shape: { t: 'self' },
    });
  });
});

describe('selection rule', () => {
  it('combines any of the ten chips up to the cap', () => {
    const max = tuning.hand.SIZE;
    expect(canAddToSelection([{ defId: 'cannon' }, { defId: 'mine' }], { defId: 'airshot' }, max)).toBe(true);
    expect(canAddToSelection([{ defId: 'areagrab' }, { defId: 'break' }], { defId: 'sword' }, max)).toBe(true);
    const full = Array.from({ length: max }, () => ({ defId: 'cannon' as const }));
    expect(canAddToSelection(full, { defId: 'sword' }, max)).toBe(false);
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
    run(w, T(tuning.flow.INTRO_TIME));
    expect(w.state).toBe('ACTION');
    expect(w.chips.hand).toHaveLength(tuning.hand.SIZE);
    expect(w.chips.hand.every((c) => c !== null)).toBe(true);
    expect(w.tick).toBe(0);
  });

  it('freezes the battle only during the intro', () => {
    const w = new World({ seed: 1, battleIndex: 1 });
    run(w, T(tuning.flow.INTRO_TIME) - 1);
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
      step(w, [{ type: 'selectChip', slot: i % tuning.hand.SIZE }, { type: 'useChip' }]);
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

  it('refills a spent slot after its cooldown without leaving ACTION', () => {
    const folder = Array.from({ length: 8 }, () => ({ defId: 'cannon' as const }));
    const w = new World({ seed: 1, battleIndex: 1, folder, skipIntro: true, cheats: { god: true, aiEnabled: false } });
    for (const enemy of w.enemies) enemy.hp = 100_000;
    const slot = w.chips.hand.findIndex((c) => c !== null);
    step(w, [{ type: 'selectChip', slot }, { type: 'useChip' }]);
    expect(w.chips.hand[slot]).toBeNull();
    run(w, T(tuning.hand.REFILL_COOLDOWN) - 1);
    expect(w.chips.hand[slot]).toBeNull();
    run(w, 1);
    expect(w.state).toBe('ACTION');
    expect(w.chips.hand[slot]).not.toBeNull();
  });

  it('reshuffles spent chips and emits drawReshuffled once the draw pile runs dry', () => {
    // Small folder so several slot refills exhaust the draw pile.
    const smallFolder = Array.from({ length: 8 }, () => ({ defId: 'cannon' as const }));
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
    run(w, T(tuning.hand.REFILL_COOLDOWN));
    expect(w.chips.hand.every((c) => c !== null)).toBe(true);
  });

  it('ignores chip selection outside ACTION', () => {
    const w = new World({ seed: 1, battleIndex: 1 });
    expect(w.state).toBe('BATTLE_INTRO');
    expect(w.selectChip(0)).toBe(false);
  });
});
