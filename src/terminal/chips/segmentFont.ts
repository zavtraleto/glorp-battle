// 14-segment font and text of the queue display above the CRT (TERMINAL.md §3.1). Pure.
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
  _: ['d'],
};

/** Character cells of the display over the CRT, as wide as the glass (decision 2026-09-28). */
export const DISPLAY_CHARS = 34;

export interface SegmentDisplayModel {
  /** Exactly DISPLAY_CHARS characters, left-aligned. */
  text: string;
  /** Cells [from, to) that breathe: the next empty queue slot. */
  pulse: readonly [number, number] | null;
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
}

/** An empty Attack Queue slot and the mark between entries (decision 2026-09-28). */
export const QUEUE_SLOT = '____';
export const QUEUE_SEP = ' + ';

function entryText(e: ChipDisplayEntry): string {
  const power = e.power ?? null;
  return (power === null ? e.name : `${e.name} ${power}`).toUpperCase();
}

/**
 * The Attack Queue on the display (GDD §7.2): the active chip first, then the
 * queued ones as `BRIEF POWER`, then `slots` empty slots, the first of which
 * breathes. Chip text is clipped before the slots, so the next slot always shows.
 */
export function queueDisplayModel(entries: readonly ChipDisplayEntry[], slots: number, width = DISPLAY_CHARS): SegmentDisplayModel {
  const chips = entries.map(entryText).join(QUEUE_SEP);
  if (slots <= 0) return { text: chips.slice(0, width).padEnd(width, ' '), pulse: null };
  const sep = chips ? QUEUE_SEP : '';
  const head = chips.slice(0, Math.max(0, width - QUEUE_SLOT.length - sep.length));
  const prefix = head + sep;
  const tail = Array.from({ length: slots }, () => QUEUE_SLOT).join(QUEUE_SEP);
  const text = (prefix + tail).slice(0, width).padEnd(width, ' ');
  return { text, pulse: [prefix.length, Math.min(width, prefix.length + QUEUE_SLOT.length)] };
}
