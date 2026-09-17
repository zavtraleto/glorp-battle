import { describe, expect, it } from 'vitest';
import type { Screen } from '../src/app/session';
import {
  bannerFor,
  gaugeLedCount,
  hpLedCount,
  hudKey,
  hudModel,
  type HudSession,
  type HudWorld,
} from '../src/terminal/crt/hudModel';
import { drawText, glyphRows, measureText, GLYPH_H } from '../src/terminal/crt/pixelFont';
import { lampStates, terminalMode } from '../src/terminal/terminalMode';
import { plasticPattern } from '../src/terminal/textures/procedural';
import type { GameState } from '../src/sim/world';

const session = (screen: Screen = 'BATTLE'): HudSession => ({ screen, battleIndex: 2, battleCount: 4 });

function world(over: Partial<HudWorld> = {}): HudWorld {
  return {
    state: 'ACTION',
    firstStart: false,
    player: { hp: 100, maxHp: 100 },
    gauge: { value: 0.5, full: false },
    chips: { queue: [{ defId: 'cannon', code: 'A' }] },
    ...over,
  };
}

describe('hudModel', () => {
  it('picks the battle banner by state', () => {
    const b = (state: GameState, firstStart = false) => bannerFor(session(), { state, firstStart })?.text ?? null;
    expect(b('BATTLE_INTRO')).toBe('BATTLE 2/4');
    expect(b('BATTLE_START', true)).toBe('BATTLE START!');
    expect(b('BATTLE_START', false)).toBeNull();
    expect(b('BATTLE_WON')).toBe('ENEMY DELETED!');
    expect(b('PLAYER_DEAD')).toBe('GAME OVER');
    expect(b('ACTION')).toBeNull();
    expect(b('CUSTOM')).toBeNull();
    expect(bannerFor(session('PAUSED'), { state: 'BATTLE_WON', firstStart: false })).toBeNull();
    expect(bannerFor(session(), { state: 'PLAYER_DEAD', firstStart: false })?.tone).toBe('lose');
  });

  it('labels the next chip and flags low HP', () => {
    expect(hudModel(session(), world()).chip).toBe('CANNON A');
    expect(hudModel(session(), world({ chips: { queue: [] } })).chip).toBeNull();
    expect(hudModel(session(), world({ player: { hp: 25, maxHp: 100 } })).hpLow).toBe(true);
    expect(hudModel(session(), world({ player: { hp: 26, maxHp: 100 } })).hpLow).toBe(false);
  });

  it('changes the redraw key with content, and with blink only when full', () => {
    const a = hudModel(session(), world());
    expect(hudKey(a, true)).toBe(hudKey(a, false));
    expect(hudKey(a, true)).not.toBe(hudKey(hudModel(session(), world({ player: { hp: 90, maxHp: 100 } })), true));
    const full = hudModel(session(), world({ gauge: { value: 1, full: true } }));
    expect(hudKey(full, true)).not.toBe(hudKey(full, false));
  });

  it('counts LEDs', () => {
    expect(hpLedCount(1, 100, 10)).toBe(1);
    expect(hpLedCount(0, 100, 10)).toBe(0);
    expect(hpLedCount(100, 100, 10)).toBe(10);
    expect(hpLedCount(55, 100, 10)).toBe(6);
    expect(gaugeLedCount(0.99, false, 12)).toBe(11);
    expect(gaugeLedCount(0, false, 12)).toBe(0);
    expect(gaugeLedCount(0.5, true, 12)).toBe(12);
  });
});

describe('terminalMode', () => {
  it('derives the mode from screen and state', () => {
    expect(terminalMode('TITLE', 'ACTION')).toBe('MENU');
    expect(terminalMode('PAUSED', 'PAUSED')).toBe('MENU');
    expect(terminalMode('BATTLE', 'ACTION')).toBe('BATTLE');
    expect(terminalMode('BATTLE', 'CUSTOM')).toBe('CHIP_SELECT');
    expect(terminalMode('BATTLE', 'BATTLE_INTRO')).toBe('TRANSITION');
    expect(terminalMode('BATTLE', 'BATTLE_WON')).toBe('TRANSITION');
  });

  it('drives the status lamps', () => {
    const on = lampStates('BATTLE', 'BATTLE', false, 0);
    expect(on).toEqual({ power: true, sync: false, link: true, battle: true });
    expect(lampStates('BATTLE', 'BATTLE', false, 0.3).battle).toBe(true);
    // Full gauge: the BATTLE lamp blinks at 2 Hz (on 0–0.25 s, off 0.25–0.5 s).
    expect(lampStates('BATTLE', 'BATTLE', true, 0.1).battle).toBe(true);
    expect(lampStates('BATTLE', 'BATTLE', true, 0.3).battle).toBe(false);
    expect(lampStates('TRANSITION', 'BATTLE', false, 0.1).sync).toBe(true);
    expect(lampStates('TRANSITION', 'BATTLE', false, 0.3).sync).toBe(false);
    expect(lampStates('MENU', 'TITLE', false, 0)).toEqual({ power: true, sync: false, link: false, battle: false });
  });
});

describe('pixelFont', () => {
  it('has 5×7 glyphs for letters, digits and punctuation', () => {
    for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!.:/-+%?'* ") {
      const rows = glyphRows(ch);
      expect(rows).toHaveLength(GLYPH_H);
      for (const r of rows) expect(r).toMatch(/^[#.]{5}$/);
    }
  });

  it('upper-cases and falls back to ?', () => {
    expect(glyphRows('a')).toEqual(glyphRows('A'));
    expect(glyphRows('ж')).toEqual(glyphRows('?'));
  });

  it('measures text with a 1px gap', () => {
    expect(measureText('')).toBe(0);
    expect(measureText('A')).toBe(5);
    expect(measureText('AB', 2)).toBe(22);
  });

  it('draws one rect per lit pixel, scaled and offset', () => {
    const rects: number[][] = [];
    const sink = { fillStyle: '', fillRect: (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h]) };
    drawText(sink, 'I', 10, 20, 2, '#fff');
    const lit = glyphRows('I').join('').split('').filter((c) => c === '#').length;
    expect(rects).toHaveLength(lit);
    expect(sink.fillStyle).toBe('#fff');
    expect(rects[0]).toEqual([10 + 1 * 2, 20, 2, 2]); // first row ".###."
  });
});

describe('plasticPattern', () => {
  it('is deterministic, sized and within range', () => {
    const a = plasticPattern(1, 64, 64);
    expect(a).toHaveLength(64 * 64);
    expect(plasticPattern(1, 64, 64)).toEqual(a);
    expect(plasticPattern(2, 64, 64)).not.toEqual(a);
    const mean = a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean).toBeGreaterThan(100);
    expect(mean).toBeLessThan(156);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...a)).toBeLessThanOrEqual(255);
  });
});

describe('hud notice', () => {
  it('is part of the model and the redraw key', () => {
    const a = hudModel(session(), world());
    const b = hudModel(session(), world(), 'NO CHIP');
    expect(a.notice).toBeNull();
    expect(b.notice).toBe('NO CHIP');
    expect(hudKey(a, true)).not.toBe(hudKey(b, true));
  });
});
