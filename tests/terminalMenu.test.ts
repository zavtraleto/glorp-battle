import { describe, expect, it } from 'vitest';
import type { Screen } from '../src/app/session';
import { en } from '../src/i18n/en';
import { FloaterList, floaterFromEvent } from '../src/terminal/crt/floaters';
import { PLAYER_ID } from '../src/sim/player';
import { formatTime, menuFor, menuItemAt, menuLayout, moveCursor, type MenuSession } from '../src/terminal/crt/menuModel';
import { glyphRows, measureText, wrapText } from '../src/terminal/crt/pixelFont';

function session(screen: Screen, over: Partial<MenuSession> = {}): MenuSession {
  const results = [
    { time: 12.5, hits: 2, hpLeft: 80 },
    { time: 30, hits: 1, hpLeft: 60 },
  ];
  return {
    screen,
    generation: 7,
    depth: 4,
    steps: 10,
    hp: 60,
    maxHp: 100,
    folderSize: 21,
    path: [
      { kind: 'normal', enemies: 2 },
      { kind: 'elite', enemies: 3 },
    ],
    legacyChoices: [
      { defId: 'cannon', code: 'A', count: 3 },
      { defId: 'mcannon', code: 'K', count: 1, legacyGen: 6 },
    ],
    results,
    lastResult: results[1],
    totalTime: 42.5,
    ...over,
  };
}

const manyChoices = Array.from({ length: 12 }, (_, i) => ({ defId: 'recover50' as const, code: 'A' as const, count: i + 1 }));

describe('menuFor', () => {
  it('has no menu in battle or on the reward tray', () => {
    expect(menuFor(session('BATTLE'))).toBeNull();
    expect(menuFor(session('REWARD'))).toBeNull();
  });

  it('builds each screen with its actions', () => {
    expect(menuFor(session('TITLE'))!.items.map((i) => i.action)).toEqual(['start']);
    expect(menuFor(session('PATH'))!.items.map((i) => i.action)).toEqual(['path:0', 'path:1']);
    expect(menuFor(session('PAUSED'))!.items.map((i) => i.action)).toEqual(['resume', 'abandon']);
    expect(menuFor(session('LEGACY'))!.items.map((i) => i.action)).toEqual(['legacy:0', 'legacy:1']);
    expect(menuFor(session('COMPLETE'))!.items.map((i) => i.action)).toEqual(['title']);
  });

  it('shows the step, the generation and the path', () => {
    expect(menuFor(session('TITLE'))!.subtitle).toBe('Generation 07');
    const path = menuFor(session('PATH'))!;
    expect(path.title).toBe('STEP 04/10');
    expect(path.rows).toEqual([
      ['HP', '60/100'],
      ['Folder', '21'],
    ]);
    expect(path.items.map((i) => i.label)).toEqual(['Battle x2', 'Elite x3']);
    expect(menuFor(session('PATH', { path: [{ kind: 'boss', enemies: 2 }] }))!.items[0]!.label).toBe('Boss');
    expect(menuFor(session('LEGACY'))!.items.map((i) => i.label)).toEqual(['Cannon A x3', 'M-Cannon K G06']);
    expect(menuFor(session('COMPLETE'))!.rows).toEqual([
      ['Battles', '2'],
      ['Total time', '0:42.50'],
      ['Hits taken', '3'],
      ['HP left', '60'],
    ]);
  });

  it('changes the key when the content changes', () => {
    expect(menuFor(session('PATH'))!.key).not.toBe(menuFor(session('PATH', { depth: 5 }))!.key);
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
    const specs = (['TITLE', 'PATH', 'PAUSED', 'LEGACY', 'COMPLETE'] as const).map((screen) => ({
      screen,
      spec: menuFor(session(screen, screen === 'LEGACY' ? { legacyChoices: manyChoices } : {}))!,
    }));
    for (const { screen, spec } of specs) {
      const l = menuLayout(spec, 240, 320, spec.items.length - 1);
      expect(l.title.x, screen).toBeGreaterThanOrEqual(0);
      expect(l.title.x + measureText(l.title.text, l.title.scale), screen).toBeLessThanOrEqual(240);
      let prevBottom = 0;
      for (const { rect, text } of l.items) {
        expect(rect.y, screen).toBeGreaterThanOrEqual(prevBottom);
        expect(text.x + measureText(text.text, text.scale), screen).toBeLessThanOrEqual(240);
        prevBottom = rect.y + rect.h;
      }
      expect(prevBottom, screen).toBeLessThanOrEqual(320);
      const hintTop = l.hint[0]?.y ?? 320;
      expect(prevBottom, screen).toBeLessThanOrEqual(hintTop);
      for (const h of l.hint) expect(h.x + measureText(h.text, h.scale), screen).toBeLessThanOrEqual(240);
    }
  });

  it('scrolls a long list with the cursor', () => {
    const spec = menuFor(session('LEGACY', { legacyChoices: manyChoices }))!;
    expect(menuLayout(spec, 240, 320, 0).items.map((i) => i.index)).toEqual([0, 1, 2, 3, 4]);
    const mid = menuLayout(spec, 240, 320, 7);
    expect(mid.items.map((i) => i.index)).toContain(7);
    expect(mid.more).toHaveLength(2);
    expect(menuLayout(spec, 240, 320, 11).items.map((i) => i.index)).toEqual([7, 8, 9, 10, 11]);
  });

  it('finds the item under a point', () => {
    const l = menuLayout(menuFor(session('PAUSED'))!, 240, 320);
    const r = l.items[1]!.rect;
    expect(menuItemAt(l, r.x + 5, r.y + 5)).toBe(1);
    expect(menuItemAt(l, 1, 1)).toBe(-1);
    const spec = menuFor(session('LEGACY', { legacyChoices: manyChoices }))!;
    const scrolled = menuLayout(spec, 240, 320, 11);
    const first = scrolled.items[0]!.rect;
    expect(menuItemAt(scrolled, first.x + 5, first.y + 5)).toBe(7);
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

describe('FloaterList', () => {
  it('turns damage and heal events into numbers', () => {
    expect(floaterFromEvent({ type: 'damaged', targetId: 100, amount: 40, x: 1, y: 1, hpLeft: 0 })).toEqual({
      kind: 'damage',
      text: '40',
      x: 1,
      y: 1,
    });
    expect(floaterFromEvent({ type: 'damaged', targetId: PLAYER_ID, amount: 10, x: 1, y: 4, hpLeft: 90 })?.kind).toBe('playerDamage');
    expect(floaterFromEvent({ type: 'healed', amount: 50, x: 1, y: 4 })?.text).toBe('+50');
    expect(floaterFromEvent({ type: 'damaged', targetId: 100, amount: 0, x: 1, y: 1, hpLeft: 5 })).toBeNull();
    expect(floaterFromEvent({ type: 'bombThrown', id: 1 })).toBeNull();
  });

  it('ages and drops floaters', () => {
    const list = new FloaterList();
    list.add({ kind: 'damage', text: '40', x: 0, y: 0 }, 10);
    expect(list.live(10, 0, 20)[0]!.k).toBe(0);
    expect(list.live(20, 0.5, 20)[0]!.k).toBeCloseTo(10.5 / 20, 6);
    expect(list.live(30, 0, 20)).toEqual([]);
    expect(list.size).toBe(0);
  });
});
