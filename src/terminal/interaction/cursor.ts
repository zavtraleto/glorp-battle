import type { CursorKind } from '../controlRules';

// Pixel hand cursors for mouse play (TERMINAL.md §5.5). '#' outline, 'o' fill.

const POINT = [
  '.....##.........',
  '....#oo#........',
  '....#oo#........',
  '....#oo#........',
  '....#oo###......',
  '....#oo#oo##....',
  '.##.#oo#oo#o##..',
  '#oo##oooooo#oo#.',
  '#ooo#oooooooooo#',
  '.#oooooooooooo#.',
  '..#ooooooooooo#.',
  '..#oooooooooo#..',
  '...#ooooooooo#..',
  '....#ooooooo#...',
  '.....#oooooo#...',
  '.....########...',
];

/** Finger bent: the tip is lower. */
const PRESS = ['................', '................', '................', '.....##.........', ...POINT.slice(4)];

const SCALE = 2;
const HOTSPOT = { x: 6 * SCALE, y: 1 * SCALE };

function toCss(rows: readonly string[]): string {
  const canvas = document.createElement('canvas');
  canvas.width = 16 * SCALE;
  canvas.height = 16 * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return 'auto';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (c === '.') continue;
      ctx.fillStyle = c === '#' ? '#16130e' : '#e8dfc4';
      ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
    }
  });
  return `url(${canvas.toDataURL()}) ${HOTSPOT.x} ${HOTSPOT.y}, pointer`;
}

let cache: Record<Exclude<CursorKind, 'default'>, string> | null = null;

export function cursorCss(kind: CursorKind): string {
  if (kind === 'default') return 'default';
  cache ??= { point: toCss(POINT), press: toCss(PRESS) };
  return cache[kind];
}
