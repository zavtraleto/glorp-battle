import type { NextBattle, Screen } from '../../app/session';
import { t } from '../../i18n';
import type { Rect } from '../layout';
import { GLYPH_H, measureText, wrapText } from './pixelFont';

// Session menus drawn inside the CRT (TERMINAL.md §8). Pure: what each screen
// shows, where it goes on the CRT canvas, and cursor movement.

export type MenuAction = 'start:play' | 'start:tutorial' | 'resume' | 'abandon' | 'title' | 'fight';
export type MenuTone = 'title' | 'info' | 'win' | 'lose';

export interface MenuItem {
  label: string;
  action: MenuAction;
}

export interface MenuSpec {
  /** Changes whenever the menu content changes (resets the cursor). */
  key: string;
  tone: MenuTone;
  title: string;
  subtitle: string | null;
  rows: [string, string][];
  items: MenuItem[];
  hint: string[];
}

export interface MenuResult {
  time: number;
  hits: number;
  hpLeft: number;
}

export interface MenuSession {
  screen: Screen;
  depth: number;
  steps: number;
  hp: number;
  maxHp: number;
  folderSize: number;
  next: NextBattle;
  healed: boolean;
  results: readonly MenuResult[];
  lastResult: MenuResult | undefined;
  totalTime: number;
  tutorial: boolean;
}

/** CRT pixels per step of the HUD pixel scale: a 320–400 px wide picture draws text at 2×. */
export const HUD_PX_PER_SCALE = 160;

/** Most menu items shown at once; the list scrolls with the cursor. */
export const MENU_VISIBLE = 5;

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function pathLabel(next: NextBattle): string {
  if (next.kind === 'boss') return t('path.boss');
  return t(next.kind === 'elite' ? 'path.elite' : 'path.normal', { n: next.enemies });
}

export function menuFor(s: MenuSession): MenuSpec | null {
  const step = t('path.title', { n: pad2(s.depth), total: pad2(s.steps) });
  switch (s.screen) {
    case 'TITLE':
      return {
        key: 'title',
        tone: 'title',
        title: t('game.title'),
        subtitle: t('title.subtitle'),
        rows: [],
        items: [
          { label: t('title.play'), action: 'start:play' },
          { label: t('tutorial.title'), action: 'start:tutorial' },
        ],
        hint: [t('title.hintTerminal'), t('title.hintKeys')],
      };
    case 'PATH':
      return {
        key: `path-${s.depth}-${s.results.length}`,
        tone: 'info',
        title: step,
        subtitle: pathLabel(s.next),
        rows: [
          [t('result.hpNow'), `${s.hp}/${s.maxHp}`],
          [t('result.folder'), String(s.folderSize)],
        ],
        items: [{ label: t('path.fight'), action: 'fight' }],
        hint: [],
      };
    case 'PAUSED':
      return {
        key: 'paused',
        tone: 'info',
        title: t('banner.paused'),
        subtitle: step,
        rows: [],
        items: [
          { label: t('btn.resume'), action: 'resume' },
          { label: t('btn.abandon'), action: 'abandon' },
        ],
        hint: [],
      };
    case 'GAME_OVER':
      return {
        key: `gameover-${s.depth}-${s.results.length}`,
        tone: 'lose',
        title: t('banner.gameOver'),
        subtitle: null,
        rows: [
          [t('result.step'), `${pad2(s.depth)}/${pad2(s.steps)}`],
          [t('result.total'), formatTime(s.totalTime)],
          [t('result.hits'), String(s.results.reduce((n, x) => n + x.hits, 0))],
        ],
        items: [{ label: t('btn.title'), action: 'title' }],
        hint: [],
      };
    case 'COMPLETE':
      if (s.tutorial) {
        return {
          key: 'tutorialComplete',
          tone: 'win',
          title: t('tutorial.complete.title'),
          subtitle: null,
          rows: [],
          items: [{ label: t('btn.title'), action: 'title' }],
          hint: [t('tutorial.complete.hint')],
        };
      }
      return {
        key: `complete-${s.results.length}`,
        tone: 'win',
        title: t('banner.runClear'),
        subtitle: null,
        rows: [
          [t('result.battles'), String(s.results.length)],
          [t('result.total'), formatTime(s.totalTime)],
          [t('result.hits'), String(s.results.reduce((n, x) => n + x.hits, 0))],
          [t('result.hp'), String(s.lastResult?.hpLeft ?? 0)],
        ],
        items: [{ label: t('btn.title'), action: 'title' }],
        hint: [],
      };
    case 'BATTLE':
      return null;
  }
}

/** Cursor after an up/down step; stays inside the list. */
export function moveCursor(index: number, dir: 'up' | 'down', count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, index + (dir === 'down' ? 1 : -1)));
}

export interface TextLine {
  text: string;
  x: number;
  y: number;
  scale: number;
}

export interface MenuLayout {
  title: TextLine;
  subtitle: TextLine | null;
  rows: { label: TextLine; value: TextLine }[];
  /** Visible items; `index` points into `spec.items`. */
  items: { rect: Rect; text: TextLine; index: number }[];
  /** "..." marks when the list scrolls past the window. */
  more: TextLine[];
  hint: TextLine[];
  /** Base pixel scale for this canvas size. */
  s: number;
}

/**
 * Positions of everything on a W×H CRT canvas. The whole menu (title, rows,
 * items, hint) is one block centred on the screen, in a large font
 * (decision 2026-09-19); anything too wide steps down a size.
 */
export function menuLayout(spec: MenuSpec, W: number, H: number, cursor = 0): MenuLayout {
  const s = Math.max(1, Math.floor(W / HUD_PX_PER_SCALE));
  const big = s + 1;
  const M = 5 * s;
  const room = W - 2 * M;
  const fit = (text: string, preferred: number) => {
    let scale = preferred;
    while (scale > 1 && measureText(text, scale) > room) scale--;
    return scale;
  };
  const centered = (text: string, y: number, scale: number): TextLine => ({
    text,
    x: Math.round((W - measureText(text, scale)) / 2),
    y,
    scale,
  });

  const titleScale = fit(spec.title, s + 2);
  const subScale = spec.subtitle ? fit(spec.subtitle, big) : big;
  const rowScale = Math.min(...spec.rows.map(([l, v]) => fit(`${l}  ${v}`, big)), big);
  const itemScale = Math.min(...spec.items.map((i) => fit(i.label.toUpperCase(), big)), big);
  const itemH = GLYPH_H * itemScale + 6 * s;
  const itemGap = 3 * s;
  const rowH = GLYPH_H * rowScale + 4 * s;
  const hintScale = big;
  const hintLines = spec.hint.flatMap((h) => wrapText(h.toUpperCase(), Math.floor(room / (6 * hintScale))));
  const hintLineH = GLYPH_H * hintScale + 3 * s;

  const count = spec.items.length;
  const shownCount = Math.min(count, MENU_VISIBLE);
  const heights = [
    GLYPH_H * titleScale,
    spec.subtitle ? 3 * s + GLYPH_H * subScale : 0,
    8 * s,
    spec.rows.length ? spec.rows.length * rowH + 4 * s : 0,
    shownCount ? shownCount * (itemH + itemGap) - itemGap : 0,
    hintLines.length ? 8 * s + hintLines.length * hintLineH : 0,
  ];
  const total = heights.reduce((a, b) => a + b, 0);
  let y = Math.max(M, Math.round((H - total) / 2));

  const title = centered(spec.title, y, titleScale);
  y += GLYPH_H * titleScale;
  let subtitle: TextLine | null = null;
  if (spec.subtitle) {
    y += 3 * s;
    subtitle = centered(spec.subtitle, y, subScale);
    y += GLYPH_H * subScale;
  }
  y += 8 * s;

  const rows = spec.rows.map(([label, value]) => {
    const line = {
      label: { text: label, x: M, y, scale: rowScale },
      value: { text: value, x: W - M - measureText(value, rowScale), y, scale: rowScale },
    };
    y += rowH;
    return line;
  });
  if (rows.length) y += 4 * s;

  const first = Math.max(0, Math.min(count - MENU_VISIBLE, cursor - Math.floor(MENU_VISIBLE / 2)));
  const shown = spec.items.slice(first, first + MENU_VISIBLE);
  const more: TextLine[] = [];
  if (first > 0) more.push(centered('...', y - 3 * s, s));
  const items = shown.map((item, k) => {
    const rect: Rect = { x: M, y, w: room, h: itemH };
    const label = item.label.toUpperCase();
    const text = centered(label, y + Math.round((itemH - GLYPH_H * itemScale) / 2), itemScale);
    y += itemH + itemGap;
    return { rect, text, index: first + k };
  });
  if (first + shown.length < count) more.push(centered('...', y - itemGap, s));

  if (hintLines.length) y += 8 * s - itemGap;
  const hint = hintLines.map((text) => {
    const line = centered(text, y, hintScale);
    y += hintLineH;
    return line;
  });

  return { title, subtitle, rows, items, more, hint, s };
}

/** Index of the item under a CRT-canvas point, or -1. */
export function menuItemAt(layout: MenuLayout, x: number, y: number): number {
  const hit = layout.items.find(({ rect }) => x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h);
  return hit ? hit.index : -1;
}
