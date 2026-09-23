/** Palette bitmap used by code-defined sprites. */
export type Pixel = 0 | 1 | 2;

export interface SpriteBitmap {
  w: number;
  h: number;
  px: Uint8Array;
}

const PLACEHOLDER_ROWS = [
  '............',
  '....oooo....',
  '...oooooo...',
  '..oo....oo..',
  '.......oo...',
  '......oo....',
  '......oo....',
  '............',
  '......vv....',
  '......vv....',
  '............',
  '............',
] as const;

/** The sole fallback sprite for enemy kinds that do not have shipped art yet. */
export function enemyPlaceholderBitmap(): SpriteBitmap {
  const h = PLACEHOLDER_ROWS.length;
  const w = PLACEHOLDER_ROWS[0].length;
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = PLACEHOLDER_ROWS[y]![x];
      px[y * w + x] = c === 'o' ? 1 : c === 'v' ? 2 : 0;
    }
  }
  return { w, h, px };
}
