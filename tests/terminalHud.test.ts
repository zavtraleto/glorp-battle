import { describe, expect, it } from 'vitest';
import { EMPTY_HUD, hudKey, type HudStatus } from '../src/terminal/crt/hudModel';
import { drawText, glyphRows, measureText, GLYPH_H } from '../src/terminal/crt/pixelFont';
import { terminalMode } from '../src/terminal/terminalMode';
import { plasticPattern } from '../src/terminal/textures/procedural';

describe('hud model', () => {
  it('changes the redraw key with content, and with blink only in menus', () => {
    const a = { ...EMPTY_HUD, bars: [{ x: 10, y: 20, filled: 3, total: 8, level: 1 }] };
    const b = { ...EMPTY_HUD, bars: [{ x: 10, y: 20, filled: 2, total: 8, level: 1 }] };
    expect(hudKey(a, true)).toBe(hudKey(a, false));
    expect(hudKey(a, true)).not.toBe(hudKey(b, true));
    const c = { ...EMPTY_HUD, labels: [{ text: '40', x: 5, y: 5, tone: 'damage' as const }] };
    expect(hudKey(c, true)).not.toBe(hudKey(EMPTY_HUD, true));
  });
});

describe('battle status', () => {
  const status = (over: Partial<HudStatus> = {}): HudStatus => ({ hp: 100, hpLow: false, hpHit: false, ...over });

  it('redraws when HP changes or runs low', () => {
    const base = { ...EMPTY_HUD, status: status() };
    for (const over of [{ hp: 90 }, { hpLow: true }] as Partial<HudStatus>[]) {
      expect(hudKey({ ...base, status: status(over) }, true)).not.toBe(hudKey(base, true));
    }
  });

  it('blinks the HP number after a hit, and only then', () => {
    const hit = { ...EMPTY_HUD, status: status({ hpHit: true }) };
    expect(hudKey(hit, true)).not.toBe(hudKey(hit, false));
    const calm = { ...EMPTY_HUD, status: status() };
    expect(hudKey(calm, true)).toBe(hudKey(calm, false));
  });
});

describe('terminalMode', () => {
  it('derives the mode from screen and state', () => {
    expect(terminalMode('TITLE', 'ACTION')).toBe('MENU');
    expect(terminalMode('PAUSED', 'PAUSED')).toBe('MENU');
    expect(terminalMode('BATTLE', 'ACTION')).toBe('BATTLE');
    expect(terminalMode('PATH', 'ACTION')).toBe('MENU');
    expect(terminalMode('BATTLE', 'BATTLE_INTRO')).toBe('TRANSITION');
    expect(terminalMode('BATTLE', 'BATTLE_WON')).toBe('TRANSITION');
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
