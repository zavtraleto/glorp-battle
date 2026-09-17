import { describe, expect, it } from 'vitest';
import type { Screen } from '../src/app/session';
import { en } from '../src/i18n/en';
import { formatTime, menuFor, menuItemAt, menuLayout, moveCursor, type MenuSession } from '../src/terminal/crt/menuModel';
import { glyphRows, measureText, wrapText } from '../src/terminal/crt/pixelFont';

function session(screen: Screen, over: Partial<MenuSession> = {}): MenuSession {
  const results = [
    { time: 12.5, hits: 2, hpLeft: 80 },
    { time: 30, hits: 1, hpLeft: 60 },
  ];
  return {
    screen,
    battleIndex: 2,
    battleCount: 4,
    attempt: 0,
    results,
    lastResult: results[1],
    totalTime: 42.5,
    ...over,
  };
}

describe('menuFor', () => {
  it('has no menu in battle', () => {
    expect(menuFor(session('BATTLE'))).toBeNull();
  });

  it('builds each screen with its actions', () => {
    expect(menuFor(session('TITLE'))!.items.map((i) => i.action)).toEqual(['start']);
    expect(menuFor(session('PAUSED'))!.items.map((i) => i.action)).toEqual(['resume', 'retry', 'restart']);
    expect(menuFor(session('RESULT'))!.items.map((i) => i.action)).toEqual(['next']);
    expect(menuFor(session('DEFEAT'))!.items.map((i) => i.action)).toEqual(['retry', 'restart']);
    expect(menuFor(session('COMPLETE'))!.items.map((i) => i.action)).toEqual(['restart']);
  });

  it('shows battle results and totals', () => {
    expect(menuFor(session('RESULT'))!.rows).toEqual([
      ['Time', '0:30.00'],
      ['Hits taken', '1'],
      ['HP left', '60'],
    ]);
    expect(menuFor(session('COMPLETE'))!.rows).toEqual([
      ['Battles', '2'],
      ['Total time', '0:42.50'],
      ['Hits taken', '3'],
      ['HP left', '60'],
    ]);
  });

  it('changes the key when the content changes', () => {
    expect(menuFor(session('DEFEAT'))!.key).not.toBe(menuFor(session('DEFEAT', { attempt: 1 }))!.key);
  });

  it('formats time', () => {
    expect(formatTime(0)).toBe('0:00.00');
    expect(formatTime(75.256)).toBe('1:15.26');
  });
});

describe('menu cursor and layout', () => {
  it('moves the cursor inside the list', () => {
    expect(moveCursor(0, 'up', 3)).toBe(0);
    expect(moveCursor(0, 'down', 3)).toBe(1);
    expect(moveCursor(2, 'down', 3)).toBe(2);
    expect(moveCursor(5, 'down', 0)).toBe(0);
  });

  it('fits every screen on a 240×320 CRT without overlaps', () => {
    for (const screen of ['TITLE', 'PAUSED', 'RESULT', 'DEFEAT', 'COMPLETE'] as const) {
      const spec = menuFor(session(screen))!;
      const l = menuLayout(spec, 240, 320);
      expect(l.title.x, screen).toBeGreaterThanOrEqual(0);
      expect(l.title.x + measureText(l.title.text, l.title.scale), screen).toBeLessThanOrEqual(240);
      let prevBottom = 0;
      for (const { rect } of l.items) {
        expect(rect.y, screen).toBeGreaterThanOrEqual(prevBottom);
        prevBottom = rect.y + rect.h;
      }
      const hintTop = l.hint[0]?.y ?? 320;
      expect(prevBottom, screen).toBeLessThanOrEqual(hintTop);
      for (const h of l.hint) expect(h.x + measureText(h.text, h.scale), screen).toBeLessThanOrEqual(240);
    }
  });

  it('finds the item under a point', () => {
    const l = menuLayout(menuFor(session('PAUSED'))!, 240, 320);
    const r = l.items[1]!.rect;
    expect(menuItemAt(l, r.x + 5, r.y + 5)).toBe(1);
    expect(menuItemAt(l, 1, 1)).toBe(-1);
  });
});

describe('pixel font coverage', () => {
  it('draws every character of the menu and HUD strings', () => {
    const fallback = glyphRows('?');
    for (const [key, value] of Object.entries(en)) {
      // `{n}` placeholders are replaced before drawing.
      for (const ch of value.replace(/\{\w+\}/g, '')) {
        if (ch === '?') continue;
        expect(glyphRows(ch) === fallback ? `${key}: "${ch}"` : 'ok').toBe('ok');
      }
    }
  });

  it('wraps words', () => {
    expect(wrapText('ONE TWO THREE', 7)).toEqual(['ONE TWO', 'THREE']);
    expect(wrapText('', 5)).toEqual([]);
  });
});
