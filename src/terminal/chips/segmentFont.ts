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

/** Character cells on the wider display in the CRT's lower frame. */
export const DISPLAY_CHARS = 14;
/** Extra character cells on each side of the fixed centre label. */
export const TIMER_BANK_CHARS = 8;
export const DISPLAY_TOTAL_CHARS = DISPLAY_CHARS + TIMER_BANK_CHARS * 2;

export interface SegmentDisplayModel {
  /** Fixed-width centre label. */
  text: string;
  /** Lit cells, counted from the outside edge toward the label. */
  leftLit: number;
  rightLit: number;
}

export function hasGlyph(ch: string): boolean {
  return ch.toUpperCase() in GLYPHS;
}

/** Lit segments of a character; unknown characters stay dark. */
export function glyph(ch: string): readonly Segment[] {
  return GLYPHS[ch.toUpperCase()] ?? [];
}

export interface ChipDisplayEntry {
  name: string;
  power?: number | null;
  heal?: number;
  hits?: number;
}

function centre(text: string, width: number): string {
  const clipped = text.toUpperCase().slice(0, width);
  const left = Math.floor((width - clipped.length) / 2);
  return `${' '.repeat(left)}${clipped}`.padEnd(width, ' ');
}

/** The first Attack Queue chip, with damage/healing, centred without a queue count. */
export function chipDisplayText(queued: readonly ChipDisplayEntry[], noChip: string, width = DISPLAY_CHARS): string {
  const first = queued[0];
  if (first === undefined) return centre(noChip, width);
  let value = '';
  if (first.power !== null && first.power !== undefined) {
    value = `${first.power}${(first.hits ?? 1) > 1 ? `X${first.hits}` : ''}`;
  } else if (first.heal !== undefined) {
    value = String(first.heal);
  }
  return centre(value ? `${first.name} ${value}` : first.name, width);
}

/** Fixed centre label plus symmetric character-cell banks for Combo Time. */
export function comboDisplayModel(
  entry: ChipDisplayEntry | null,
  noChip: string,
  active: boolean,
): SegmentDisplayModel {
  const text = chipDisplayText(entry ? [entry] : [], noChip);
  const lit = active ? TIMER_BANK_CHARS : 0;
  return { text, leftLit: lit, rightLit: lit };
}
