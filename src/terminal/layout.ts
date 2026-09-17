import { tuning } from '../config/tuning';

// Terminal layout (TERMINAL.md §3). Pure functions over CSS pixels.
// The terminal face lies on the z=0 plane and the camera looks straight at it,
// so CSS px on the face map linearly to world units.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ZoneId = 'pause' | 'chipSelect' | 'trackball' | 'execute';

export interface TerminalLayout {
  viewport: { w: number; h: number };
  body: Rect;
  top: Rect;
  crt: Rect;
  rail: Rect;
  deck: Rect;
  zones: Record<ZoneId, Rect>;
  worldWidth: number;
  worldHeight: number;
}

export const TERMINAL_WORLD_WIDTH = 9;

/** Minimum short side of a pointer zone, CSS px (TERMINAL.md §3). */
const MIN_ZONE_PX = 56;

const ZONE_ORDER: readonly ZoneId[] = ['pause', 'chipSelect', 'trackball', 'execute'];

export function computeLayout(viewportW: number, viewportH: number): TerminalLayout {
  const t = tuning.terminal;
  const vw = Math.max(1, viewportW);
  const vh = Math.max(1, viewportH);
  const aspect = vw / vh;

  let body: Rect;
  if (aspect > t.TERMINAL_ASPECT_MAX) {
    const w = vh * t.TERMINAL_ASPECT_MAX;
    body = { x: (vw - w) / 2, y: 0, w, h: vh };
  } else if (aspect < t.TERMINAL_ASPECT_MIN) {
    const h = vw / t.TERMINAL_ASPECT_MIN;
    body = { x: 0, y: (vh - h) / 2, w: vw, h };
  } else {
    body = { x: 0, y: 0, w: vw, h: vh };
  }

  const sum = t.LAYOUT_TOP + t.LAYOUT_CRT + t.LAYOUT_RAIL + t.LAYOUT_DECK;
  const share = (v: number) => (sum > 0 ? v / sum : 0.25) * body.h;
  const row = (y: number, h: number): Rect => ({ x: body.x, y, w: body.w, h });
  const top = row(body.y, share(t.LAYOUT_TOP));
  const crtRow = row(top.y + top.h, share(t.LAYOUT_CRT));
  const rail = row(crtRow.y + crtRow.h, share(t.LAYOUT_RAIL));
  const deck = row(rail.y + rail.h, body.y + body.h - (rail.y + rail.h));

  const margin = body.w * t.CRT_MARGIN_X;
  const crt: Rect = { x: body.x + margin, y: crtRow.y, w: body.w - 2 * margin, h: crtRow.h };

  const xL = body.x + body.w * t.DECK_SPLIT_LEFT;
  const xR = body.x + body.w * t.DECK_SPLIT_RIGHT;
  const pauseW = Math.max(body.w * t.PAUSE_ZONE_W, MIN_ZONE_PX);
  const zones: Record<ZoneId, Rect> = {
    // Clamped so the key stays tappable on a thin top bar; it may overlap the
    // top of the CRT row, which has no zone.
    pause: { x: body.x + body.w - pauseW, y: top.y, w: pauseW, h: Math.max(top.h, MIN_ZONE_PX) },
    chipSelect: { x: body.x, y: deck.y, w: xL - body.x, h: deck.h },
    trackball: { x: xL, y: deck.y, w: xR - xL, h: deck.h },
    execute: { x: xR, y: deck.y, w: body.x + body.w - xR, h: deck.h },
  };

  return {
    viewport: { w: vw, h: vh },
    body,
    top,
    crt,
    rail,
    deck,
    zones,
    worldWidth: TERMINAL_WORLD_WIDTH,
    worldHeight: (TERMINAL_WORLD_WIDTH * body.h) / body.w,
  };
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

export function zoneAt(layout: TerminalLayout, x: number, y: number): ZoneId | null {
  for (const id of ZONE_ORDER) if (rectContains(layout.zones[id], x, y)) return id;
  return null;
}

/** CSS px rect → world-space center/size on the z=0 face (y up, origin at the body center). */
export function rectToWorld(layout: TerminalLayout, r: Rect): { cx: number; cy: number; w: number; h: number } {
  const k = layout.worldWidth / layout.body.w;
  const bodyCx = layout.body.x + layout.body.w / 2;
  const bodyCy = layout.body.y + layout.body.h / 2;
  return {
    cx: (r.x + r.w / 2 - bodyCx) * k,
    cy: -(r.y + r.h / 2 - bodyCy) * k,
    w: r.w * k,
    h: r.h * k,
  };
}

/** CSS px point → world point on the z=0 face (inverse of rectToWorld). */
export function cssToWorld(layout: TerminalLayout, x: number, y: number): { x: number; y: number } {
  const k = layout.worldWidth / layout.body.w;
  return {
    x: (x - (layout.body.x + layout.body.w / 2)) * k,
    y: -(y - (layout.body.y + layout.body.h / 2)) * k,
  };
}
