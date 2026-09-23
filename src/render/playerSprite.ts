import type { Pixel, SpriteBitmap } from './spriteBitmap';

// The player's hand-drawn silhouette (spec §7): 36×48, 'o' phosphor body,
// 'v' accent visor and hand lights. Feet on the bottom row.

const ROWS = [
  '....................................',
  '....................................',
  '....................................',
  '....................................',
  '....................................',
  '...............oooooo...............',
  '.............oooooooooo.............',
  '............oooooooooooo............',
  '...........oooooooooooooo...........',
  '...........oooooooooooooo...........',
  '...........oovvvvvvvvvvoo...........',
  '...........oovvvvvvvvvvoo...........',
  '...........oovvvvvvvvvvoo...........',
  '...........oooooooooooooo...........',
  '............oooooooooooo............',
  '.............oooooooooo.............',
  '..............oooooooo..............',
  '...............oooooo...............',
  '.........oooooooooooooooooo.........',
  '......oooooooooooooooooooooooo......',
  '....oooooooooooooooooooooooooooo....',
  '...oooooo...oooooooooooo...oooooo...',
  '..oooooo....oooooooooooo....oooooo..',
  '..ooooo......oooooooooo......ooooo..',
  '..oooo.......oooovvoooo.......oooo..',
  '..ooo........oooovvoooo........ooo..',
  '..vv.........oooooooooo.........vv..',
  '.............oooooooooo.............',
  '............oooooooooooo............',
  '............oooooooooooo............',
  '...........oooooooooooooo...........',
  '...........oooooooooooooo...........',
  '...........oooooo..oooooo...........',
  '...........ooooo....ooooo...........',
  '..........ooooo......ooooo..........',
  '..........ooooo......ooooo..........',
  '.........ooooo........ooooo.........',
  '.........ooooo........ooooo.........',
  '........ooooo..........ooooo........',
  '........ooooo..........ooooo........',
  '........ooooo..........ooooo........',
  '.......oooooo..........oooooo.......',
  '.......oooooo..........oooooo.......',
  '......ooooooo..........ooooooo......',
  '......ooooooo..........ooooooo......',
  '......ooooooo..........ooooooo......',
  '.....oooooooo..........oooooooo.....',
  '.....oooooooo..........oooooooo.....',
];

export const PLAYER_ROWS: readonly string[] = ROWS;

export function playerBitmap(): SpriteBitmap {
  const h = ROWS.length;
  const w = (ROWS[0] as string).length;
  const px = new Uint8Array(w * h);
  ROWS.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      const v: Pixel = ch === 'o' ? 1 : ch === 'v' ? 2 : 0;
      px[y * w + x] = v;
    }
  });
  return { w, h, px };
}
