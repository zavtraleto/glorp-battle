// Heavy geometric display face for the "Wave N" banner and the tutorial
// callouts (TERMINAL.md §8.1): wide cast blocks, chamfers and diagonal cuts, no
// curves. Only the glyphs those words need; y is up, units are arbitrary (cap height 7).

export type Point = readonly [number, number];

export interface BannerGlyph {
  width: number;
  /** Outer contours; each may carry holes. */
  shapes: readonly { outline: readonly Point[]; holes?: readonly (readonly Point[])[] }[];
}

export const BANNER_CAP = 7;
export const BANNER_GAP = 1.1;
export const BANNER_SPACE = 3;

const G: Record<string, BannerGlyph> = {
  W: {
    width: 8.4,
    shapes: [{ outline: [[0, 7], [2, 7], [2.6, 3], [3.4, 5.2], [5, 5.2], [5.8, 3], [6.4, 7], [8.4, 7], [7, 0], [5, 0], [4.2, 2.2], [3.4, 0], [1.4, 0]] }],
  },
  A: {
    width: 6.4,
    shapes: [{
      outline: [[0, 0], [0, 4.8], [2.2, 7], [4.2, 7], [6.4, 4.8], [6.4, 0], [4.3, 0], [4.3, 1.8], [2.1, 1.8], [2.1, 0]],
      holes: [[[2.1, 3.4], [4.3, 3.4], [4.3, 4.4], [3.6, 5.1], [2.8, 5.1], [2.1, 4.4]]],
    }],
  },
  V: {
    width: 6.6,
    shapes: [{ outline: [[0, 7], [2.1, 7], [3.3, 2.8], [4.5, 7], [6.6, 7], [4.6, 0], [2, 0]] }],
  },
  E: {
    width: 5.8,
    shapes: [{
      outline: [[0, 0], [5.8, 0], [5.8, 1.9], [2.1, 1.9], [2.1, 2.7], [5, 2.7], [5, 4.3], [2.1, 4.3], [2.1, 5.1], [5.8, 5.1], [5.8, 7], [1.2, 7], [0, 5.8]],
    }],
  },
  C: {
    width: 6,
    shapes: [{ outline: [[1.2, 0], [6, 0], [6, 1.9], [2.1, 1.9], [2.1, 5.1], [6, 5.1], [6, 7], [1.2, 7], [0, 5.8], [0, 1.2]] }],
  },
  G: {
    width: 6.2,
    shapes: [{
      outline: [[1.2, 0], [6.2, 0], [6.2, 3.9], [3.4, 3.9], [3.4, 2.3], [4.1, 2.3], [4.1, 1.9], [2.1, 1.9], [2.1, 5.1], [6.2, 5.1], [6.2, 7], [1.2, 7], [0, 5.8], [0, 1.2]],
    }],
  },
  I: {
    width: 2.2,
    shapes: [{ outline: [[0, 0], [2.2, 0], [2.2, 7], [0, 7]] }],
  },
  K: {
    width: 6.6,
    shapes: [{ outline: [[0, 0], [0, 7], [2.1, 7], [2.1, 4.4], [4.2, 7], [6.6, 7], [3.9, 3.5], [6.6, 0], [4.2, 0], [2.1, 2.6], [2.1, 0]] }],
  },
  L: {
    width: 5.4,
    shapes: [{ outline: [[0, 0], [5.4, 0], [5.4, 1.9], [2.1, 1.9], [2.1, 7], [0, 7]] }],
  },
  M: {
    width: 8.4,
    shapes: [{ outline: [[0, 0], [0, 7], [2.2, 7], [4.2, 4.6], [6.2, 7], [8.4, 7], [8.4, 0], [6.3, 0], [6.3, 3.9], [4.2, 1.6], [2.1, 3.9], [2.1, 0]] }],
  },
  N: {
    width: 6.6,
    shapes: [{ outline: [[0, 0], [0, 7], [2.1, 7], [4.5, 3.2], [4.5, 7], [6.6, 7], [6.6, 0], [4.5, 0], [2.1, 3.8], [2.1, 0]] }],
  },
  O: {
    width: 6.4,
    shapes: [{
      outline: [[1.2, 0], [5.2, 0], [6.4, 1.2], [6.4, 5.8], [5.2, 7], [1.2, 7], [0, 5.8], [0, 1.2]],
      holes: [[[2.1, 1.9], [4.3, 1.9], [4.3, 5.1], [2.1, 5.1]]],
    }],
  },
  S: {
    width: 6,
    shapes: [{
      outline: [[0, 0], [4.8, 0], [6, 1.2], [6, 3.3], [4.9, 4.4], [2.1, 4.4], [2.1, 5.1], [6, 5.1], [6, 7], [1.2, 7], [0, 5.8], [0, 3.7], [1.1, 2.6], [3.9, 2.6], [3.9, 1.9], [0, 1.9]],
    }],
  },
  T: {
    width: 6.4,
    shapes: [{ outline: [[2.15, 0], [4.25, 0], [4.25, 5.1], [6.4, 5.1], [6.4, 7], [0, 7], [0, 5.1], [2.15, 5.1]] }],
  },
  '0': {
    width: 6,
    shapes: [{
      outline: [[1.2, 0], [4.8, 0], [6, 1.2], [6, 5.8], [4.8, 7], [1.2, 7], [0, 5.8], [0, 1.2]],
      holes: [[[2.1, 1.9], [3.9, 1.9], [3.9, 5.1], [2.1, 5.1]]],
    }],
  },
  '1': {
    width: 5.6,
    shapes: [{ outline: [[0.4, 0], [5.6, 0], [5.6, 1.9], [4, 1.9], [4, 7], [2.2, 7], [0.6, 5.4], [1.9, 4.6], [1.9, 1.9], [0.4, 1.9]] }],
  },
  '2': {
    width: 6,
    shapes: [{
      outline: [[0, 0], [6, 0], [6, 1.9], [3.3, 1.9], [6, 4.3], [6, 5.8], [4.8, 7], [1.2, 7], [0, 5.8], [0, 4.9], [2.1, 4.9], [2.1, 5.1], [3.9, 5.1], [3.9, 4.7], [0, 1.6]],
    }],
  },
  '3': {
    width: 6,
    shapes: [{
      outline: [[0, 0], [4.8, 0], [6, 1.2], [6, 2.9], [5.4, 3.5], [6, 4.1], [6, 5.8], [4.8, 7], [0, 7], [0, 5.1], [3.9, 5.1], [3.9, 4.4], [1.6, 4.4], [1.6, 2.6], [3.9, 2.6], [3.9, 1.9], [0, 1.9]],
    }],
  },
  '4': {
    width: 6,
    shapes: [{
      outline: [[3.8, 0], [5.8, 0], [5.8, 7], [3.4, 7], [0, 3.2], [0, 1.6], [3.8, 1.6]],
      holes: [[[3.8, 3.2], [3.8, 4.9], [2.3, 3.2]]],
    }],
  },
  '5': {
    width: 6,
    shapes: [{
      outline: [[0, 0], [4.8, 0], [6, 1.2], [6, 3.4], [4.8, 4.6], [2.1, 4.6], [2.1, 5.1], [6, 5.1], [6, 7], [0, 7], [0, 2.9], [3.9, 2.9], [3.9, 1.9], [0, 1.9]],
    }],
  },
  '6': {
    width: 6,
    shapes: [{
      outline: [[1.2, 0], [4.8, 0], [6, 1.2], [6, 3.4], [4.8, 4.6], [2.1, 4.6], [2.1, 5.1], [6, 5.1], [6, 7], [1.2, 7], [0, 5.8], [0, 1.2]],
      holes: [[[2.1, 1.9], [3.9, 1.9], [3.9, 2.9], [2.1, 2.9]]],
    }],
  },
  '7': {
    width: 6,
    shapes: [{ outline: [[0, 7], [6, 7], [6, 5.4], [3.6, 0], [1.4, 0], [3.7, 5.1], [0, 5.1]] }],
  },
  '8': {
    width: 6,
    shapes: [{
      outline: [[1.2, 0], [4.8, 0], [6, 1.2], [6, 2.9], [5.4, 3.5], [6, 4.1], [6, 5.8], [4.8, 7], [1.2, 7], [0, 5.8], [0, 4.1], [0.6, 3.5], [0, 2.9], [0, 1.2]],
      holes: [
        [[2.1, 1.8], [3.9, 1.8], [3.9, 2.7], [2.1, 2.7]],
        [[2.1, 4.3], [3.9, 4.3], [3.9, 5.2], [2.1, 5.2]],
      ],
    }],
  },
  '9': {
    width: 6,
    shapes: [{
      outline: [[0, 0], [4.8, 0], [6, 1.2], [6, 5.8], [4.8, 7], [1.2, 7], [0, 5.8], [0, 3.6], [1.2, 2.4], [3.9, 2.4], [3.9, 1.9], [0, 1.9]],
      holes: [[[2.1, 4.1], [3.9, 4.1], [3.9, 5.1], [2.1, 5.1]]],
    }],
  },
};

/** Glyph for a character (lowercase maps to uppercase); null for a space or a missing glyph. */
export function bannerGlyph(ch: string): BannerGlyph | null {
  return G[ch.toUpperCase()] ?? null;
}

/** Whether every non-space character of `text` has a glyph. */
export function bannerCovers(text: string): boolean {
  return [...text].every((ch) => ch === ' ' || bannerGlyph(ch) !== null);
}

/** Glyphs of `text` with their x offsets; the whole line is `width` wide. */
export function layoutBanner(text: string): { width: number; glyphs: { glyph: BannerGlyph; x: number }[] } {
  const glyphs: { glyph: BannerGlyph; x: number }[] = [];
  let x = 0;
  for (const ch of text) {
    const glyph = bannerGlyph(ch);
    if (!glyph) {
      x += BANNER_SPACE;
      continue;
    }
    glyphs.push({ glyph, x });
    x += glyph.width + BANNER_GAP;
  }
  return { width: Math.max(0, x - BANNER_GAP), glyphs };
}
