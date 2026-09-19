// 14-segment font for the chip display under the rail (TERMINAL.md §3.1). Pure.
//
//  ─── a ───
// │\   │   /│
// f h  i  j b
// │  \ │ /  │
//  ─g1─ ─g2─
// │  / │ \  │
// e k  l  m c
// │/   │   \│
//  ─── d ───

export type Segment = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g1' | 'g2' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm';

export const SEGMENTS: readonly Segment[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g1', 'g2', 'h', 'i', 'j', 'k', 'l', 'm'];

/** Characters the display has in its segments table (upper case). */
const GLYPHS: Record<string, readonly Segment[]> = {
  ' ': [],
  '0': ['a', 'b', 'c', 'd', 'e', 'f', 'j', 'k'],
  '1': ['b', 'c', 'j'],
  '2': ['a', 'b', 'd', 'e', 'g1', 'g2'],
  '3': ['a', 'b', 'c', 'd', 'g2'],
  '4': ['b', 'c', 'f', 'g1', 'g2'],
  '5': ['a', 'd', 'f', 'g1', 'm'],
  '6': ['a', 'c', 'd', 'e', 'f', 'g1', 'g2'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g1', 'g2'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g1', 'g2'],
  A: ['a', 'b', 'c', 'e', 'f', 'g1', 'g2'],
  B: ['a', 'b', 'c', 'd', 'g2', 'i', 'l'],
  C: ['a', 'd', 'e', 'f'],
  D: ['a', 'b', 'c', 'd', 'i', 'l'],
  E: ['a', 'd', 'e', 'f', 'g1'],
  F: ['a', 'e', 'f', 'g1'],
  G: ['a', 'c', 'd', 'e', 'f', 'g2'],
  H: ['b', 'c', 'e', 'f', 'g1', 'g2'],
  I: ['a', 'd', 'i', 'l'],
  J: ['b', 'c', 'd', 'e'],
  K: ['e', 'f', 'g1', 'j', 'm'],
  L: ['d', 'e', 'f'],
  M: ['b', 'c', 'e', 'f', 'h', 'j'],
  N: ['b', 'c', 'e', 'f', 'h', 'm'],
  O: ['a', 'b', 'c', 'd', 'e', 'f'],
  P: ['a', 'b', 'e', 'f', 'g1', 'g2'],
  Q: ['a', 'b', 'c', 'd', 'e', 'f', 'm'],
  R: ['a', 'b', 'e', 'f', 'g1', 'g2', 'm'],
  S: ['a', 'c', 'd', 'f', 'g1', 'g2'],
  T: ['a', 'i', 'l'],
  U: ['b', 'c', 'd', 'e', 'f'],
  V: ['e', 'f', 'j', 'k'],
  W: ['b', 'c', 'e', 'f', 'k', 'm'],
  X: ['h', 'j', 'k', 'm'],
  Y: ['h', 'j', 'l'],
  Z: ['a', 'd', 'j', 'k'],
  '-': ['g1', 'g2'],
  '+': ['g1', 'g2', 'i', 'l'],
};

/** Character cells on the display. */
export const DISPLAY_CHARS = 12;

export function hasGlyph(ch: string): boolean {
  return ch.toUpperCase() in GLYPHS;
}

/** Lit segments of a character; unknown characters stay dark. */
export function glyph(ch: string): readonly Segment[] {
  return GLYPHS[ch.toUpperCase()] ?? [];
}

/**
 * What the display shows for the Attack Queue: the first chip's name, plus how
 * many more are loaded behind it; `noChip` when the queue is empty.
 */
export function chipDisplayText(queued: readonly string[], noChip: string, width = DISPLAY_CHARS): string {
  const first = queued[0];
  if (first === undefined) return noChip.toUpperCase().slice(0, width);
  const name = first.toUpperCase();
  if (queued.length === 1) return name.slice(0, width);
  const more = `+${queued.length - 1}`;
  const spaced = `${name} ${more}`;
  if (spaced.length <= width) return spaced;
  return `${name.slice(0, Math.max(0, width - more.length))}${more}`;
}
