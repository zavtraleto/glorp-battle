import type { Screen } from '../../app/session';
import type { LegacyChoice, PathChoice } from '../../app/session';
import { chipName, t } from '../../i18n';
import type { Rect } from '../layout';
import { GLYPH_H, measureText, wrapText } from './pixelFont';

// Session menus drawn inside the CRT (TERMINAL.md §8). Pure: what each screen
// shows, where it goes on the CRT canvas, and cursor movement.

export type MenuAction = 'start' | 'resume' | 'abandon' | 'title' | `path:${number}` | `legacy:${number}`;
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
  generation: number;
  depth: number;
  steps: number;
  hp: number;
  maxHp: number;
  folderSize: number;
  path: readonly PathChoice[];
  legacyChoices: readonly LegacyChoice[];
  results: readonly MenuResult[];
  lastResult: MenuResult | undefined;
  totalTime: number;
}

/** Most menu items shown at once; the list scrolls with the cursor. */
export const MENU_VISIBLE = 5;

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function pathLabel(p: PathChoice): string {
  if (p.kind === 'boss') return t('path.boss');
  return t(p.kind === 'elite' ? 'path.elite' : 'path.normal', { n: p.enemies });
}

function legacyLabel(c: LegacyChoice): string {
  const tail = c.legacyGen !== undefined ? t('legacy.gen', { n: pad2(c.legacyGen) }) : `x${c.count}`;
  return `${chipName(c.defId)} ${c.code} ${tail}`;
}

export function menuFor(s: MenuSession): MenuSpec | null {
  const step = t('path.title', { n: pad2(s.depth), total: pad2(s.steps) });
  switch (s.screen) {
    case 'TITLE':
      return {
        key: `title-${s.generation}`,
        tone: 'title',
        title: t('game.title'),
        subtitle: t('title.generation', { n: pad2(s.generation) }),
        rows: [],
        items: [{ label: t('title.start'), action: 'start' }],
        hint: [t('title.hintTerminal'), t('title.hintKeys')],
      };
    case 'PATH':
      return {
        key: `path-${s.generation}-${s.depth}-${s.results.length}`,
        tone: 'info',
        title: step,
        subtitle: t('path.subtitle'),
        rows: [
          [t('result.hpNow'), `${s.hp}/${s.maxHp}`],
          [t('result.folder'), String(s.folderSize)],
        ],
        items: s.path.map((p, i) => ({ label: pathLabel(p), action: `path:${i}` as const })),
        hint: [t('path.hint')],
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
    case 'LEGACY':
      return {
        key: `legacy-${s.generation}-${s.depth}-${s.results.length}`,
        tone: 'lose',
        title: t('banner.gameOver'),
        subtitle: t('legacy.subtitle'),
        rows: [],
        items: s.legacyChoices.map((c, i) => ({ label: legacyLabel(c), action: `legacy:${i}` as const })),
        hint: [],
      };
    case 'COMPLETE':
      return {
        key: `complete-${s.generation}`,
        tone: 'win',
        title: t('banner.runClear'),
        subtitle: t('title.generation', { n: pad2(s.generation) }),
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
    case 'REWARD':
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

/** Positions of everything on a W×H CRT canvas. */
export function menuLayout(spec: MenuSpec, W: number, H: number, cursor = 0): MenuLayout {
  const s = Math.max(1, Math.floor(W / 120));
  const M = 6 * s;
  const centered = (text: string, y: number, scale: number): TextLine => ({
    text,
    x: Math.round((W - measureText(text, scale)) / 2),
    y,
    scale,
  });
  const fit = (text: string, preferred: number) => (measureText(text, preferred) <= W - 2 * M ? preferred : s);

  let y = Math.round(H * 0.16);
  const title = centered(spec.title, y, fit(spec.title, s + 1));
  y += GLYPH_H * title.scale + 4 * s;
  let subtitle: TextLine | null = null;
  if (spec.subtitle) {
    subtitle = centered(spec.subtitle, y, s);
    y += GLYPH_H * s;
  }
  y += 10 * s;

  const rows = spec.rows.map(([label, value]) => {
    const line = {
      label: { text: label, x: M, y, scale: s },
      value: { text: value, x: W - M - measureText(value, s), y, scale: s },
    };
    y += 11 * s;
    return line;
  });
  if (rows.length) y += 6 * s;

  const itemH = 13 * s;
  const count = spec.items.length;
  const first = Math.max(0, Math.min(count - MENU_VISIBLE, cursor - Math.floor(MENU_VISIBLE / 2)));
  const shown = spec.items.slice(first, first + MENU_VISIBLE);
  const more: TextLine[] = [];
  if (first > 0) more.push(centered('...', y - 4 * s, s));
  const items = shown.map((item, k) => {
    const rect: Rect = { x: M, y, w: W - 2 * M, h: itemH };
    const label = item.label.toUpperCase();
    const text = centered(label, y + Math.round((itemH - GLYPH_H * s) / 2), fit(label, s));
    y += itemH + 3 * s;
    return { rect, text, index: first + k };
  });
  if (first + shown.length < count) more.push(centered('...', y - 2 * s, s));

  const hintScale = Math.max(1, s - 1);
  const lines = spec.hint.flatMap((h) => wrapText(h.toUpperCase(), Math.floor((W - 2 * M) / (6 * hintScale))));
  let hy = H - M - lines.length * 10 * hintScale;
  const hint = lines.map((text) => {
    const line = centered(text, hy, hintScale);
    hy += 10 * hintScale;
    return line;
  });

  return { title, subtitle, rows, items, more, hint, s };
}

/** Index of the item under a CRT-canvas point, or -1. */
export function menuItemAt(layout: MenuLayout, x: number, y: number): number {
  const hit = layout.items.find(({ rect }) => x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h);
  return hit ? hit.index : -1;
}
