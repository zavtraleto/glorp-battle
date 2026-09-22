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

export type ZoneId = 'pause' | 'rail' | 'trackball';

export interface TerminalLayout {
  viewport: { w: number; h: number };
  body: Rect;
  crt: Rect;
  /** Lower CRT frame occupied by the centred 14-segment display. */
  display: Rect;
  rail: Rect;
  deck: Rect;
  zones: Record<ZoneId, Rect>;
  worldWidth: number;
  worldHeight: number;
}

export const TERMINAL_WORLD_WIDTH = 9;

/** Minimum short side of a pointer zone, CSS px (TERMINAL.md §3). */
const MIN_ZONE_PX = 56;

/**
 * How far the rail's tap zone reaches past the cartridges, in shares of the
 * rail height. It grows mostly upward, into the gap under the CRT: growing
 * downward would take the top of the trackball and steal its gestures.
 */
const RAIL_ZONE_PAD_UP = 0.12;
const RAIL_ZONE_PAD_DOWN = 0.12;

/** Slots the chip rail is divided into. */
export const RAIL_ZONE_SLOTS = 5;


export const ZONE_ORDER: readonly ZoneId[] = ['pause', 'rail', 'trackball'];

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

  const sum = t.LAYOUT_CRT + t.LAYOUT_DISPLAY + t.LAYOUT_RAIL + t.LAYOUT_DECK;
  const share = (v: number) => (sum > 0 ? v / sum : 0.25) * body.h;
  const row = (y: number, h: number): Rect => ({ x: body.x, y, w: body.w, h });
  const crtRow = row(body.y, share(t.LAYOUT_CRT));
  const display = row(crtRow.y + crtRow.h, share(t.LAYOUT_DISPLAY));
  const rail = row(display.y + display.h, share(t.LAYOUT_RAIL));
  const deck = row(rail.y + rail.h, body.y + body.h - (rail.y + rail.h));

  const margin = body.w * t.CRT_MARGIN_X;
  const crt: Rect = { x: body.x + margin, y: crtRow.y, w: body.w - 2 * margin, h: crtRow.h };

  const pauseW = Math.min(Math.max(body.w * t.PAUSE_ZONE_W, MIN_ZONE_PX), deck.h);
  const zones: Record<ZoneId, Rect> = {
    // A square in the bottom-left corner of the control panel, clear of the
    // trackball ring; it is tested before the trackball, so it wins its corner.
    pause: { x: body.x, y: deck.y + deck.h - pauseW, w: pauseW, h: pauseW },
    // The chip rail is tapped while dodging, so its zone is taller than the
    // cartridges and reaches into the gaps around them (spec §11.2).
    rail: {
      x: body.x,
      y: rail.y - rail.h * RAIL_ZONE_PAD_UP,
      w: body.w,
      h: rail.h * (1 + RAIL_ZONE_PAD_UP + RAIL_ZONE_PAD_DOWN),
    },
    // The trackball is the only other battle organ and owns the whole deck: a
    // gesture steps, a tap shoots (spec §10.2).
    trackball: { ...deck },
  };

  return {
    viewport: { w: vw, h: vh },
    body,
    crt,
    display,
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

/** Share of the CRT row height the glass may use; the rest is the frame. */
const GLASS_FILL = 0.97;

/**
 * CRT glass rect in CSS px, `aspect` = w/h of the CRT image. The aspect is
 * always kept: a stretched picture would break the square texel the whole
 * pixel look depends on, so the glass shrinks instead.
 */
export function glassRect(layout: TerminalLayout, aspect: number): Rect {
  const c = layout.crt;
  const w = Math.min(c.w, c.h * GLASS_FILL * aspect);
  const h = w / aspect;
  return { x: c.x + (c.w - w) / 2, y: c.y + (c.h - h) / 2, w, h };
}


/** The rail zone split into per-slot tap targets, left to right. */
export function railZoneSlots(layout: TerminalLayout): Rect[] {
  const z = layout.zones.rail;
  const w = z.w / RAIL_ZONE_SLOTS;
  return Array.from({ length: RAIL_ZONE_SLOTS }, (_, i) => ({ x: z.x + i * w, y: z.y, w, h: z.h }));
}
