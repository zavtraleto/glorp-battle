import type { CreatureBitmap, Pixel } from './creatureGen';

// The player's hand-drawn silhouette (BATTLE_VISUAL.md §5.2): 'o' phosphor body,
// 'v' accent visor and hand lights. Feet on the bottom row.

const ROWS = [
  '........................',
  '........................',
  '........................',
  '........................',
  '..........oooo..........',
  '........oooooooo........',
  '.......oooooooooo.......',
  '......oooooooooooo......',
  '......oovvvvvvvvoo......',
  '......oovvvvvvvvoo......',
  '......oooooooooooo......',
  '.......oooooooooo.......',
  '........oooooooo........',
  '.........oooooo.........',
  '......oooooooooooo......',
  '....oooooooooooooooo....',
  '...ooooo.oooooo.ooooo...',
  '..oooo...oooooo...oooo..',
  '..ooo....oovvoo....ooo..',
  '..oo.....oovvoo.....oo..',
  '..v......oooooo......v..',
  '.........oooooo.........',
  '........oooooooo........',
  '........oooooooo........',
  '.......oooo..oooo.......',
  '.......ooo....ooo.......',
  '......ooo......ooo......',
  '......ooo......ooo......',
  '.....ooo........ooo.....',
  '.....ooo........ooo.....',
  '....oooo........oooo....',
  '....oooo........oooo....',
];

export const PLAYER_ROWS: readonly string[] = ROWS;

export function playerBitmap(): CreatureBitmap {
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
  return { w, h, px, elements: ['visor'] };
}
