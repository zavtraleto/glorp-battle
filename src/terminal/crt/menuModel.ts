import type { Screen } from '../../app/session';
import { t } from '../../i18n';
import type { Rect } from '../layout';
import { GLYPH_H, measureText, wrapText } from './pixelFont';

// Session menus drawn inside the CRT (TERMINAL.md §8). Pure: what each screen
// shows, where it goes on the CRT canvas, and cursor movement.

export type MenuAction = 'start' | 'resume' | 'retry' | 'restart' | 'next';
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
  battleIndex: number;
  battleCount: number;
  attempt: number;
  results: readonly MenuResult[];
  lastResult: MenuResult | undefined;
  totalTime: number;
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export function menuFor(s: MenuSession): MenuSpec | null {
  const battle = t('banner.battle', { n: s.battleIndex, total: s.battleCount });
  const r = s.lastResult;
  switch (s.screen) {
    case 'TITLE':
      return {
        key: 'title',
        tone: 'title',
        title: t('game.title'),
        subtitle: t('title.subtitle'),
        rows: [],
        items: [{ label: t('title.start'), action: 'start' }],
        hint: [t('title.hintTerminal'), t('title.hintKeys')],
      };
    case 'PAUSED':
      return {
        key: 'paused',
        tone: 'info',
        title: t('banner.paused'),
        subtitle: battle,
        rows: [],
        items: [
          { label: t('btn.resume'), action: 'resume' },
          { label: t('btn.retry'), action: 'retry' },
          { label: t('btn.restart'), action: 'restart' },
        ],
        hint: [],
      };
    case 'RESULT':
      return {
        key: `result-${s.battleIndex}-${s.results.length}`,
        tone: 'win',
        title: t('banner.enemyDeleted'),
        subtitle: battle,
        rows: r
          ? [
              [t('result.time'), formatTime(r.time)],
              [t('result.hits'), String(r.hits)],
              [t('result.hp'), String(r.hpLeft)],
            ]
          : [],
        items: [{ label: t('btn.next'), action: 'next' }],
        hint: [],
      };
    case 'DEFEAT':
      return {
        key: `defeat-${s.battleIndex}-${s.attempt}`,
        tone: 'lose',
        title: t('banner.gameOver'),
        subtitle: battle,
        rows: [],
        items: [
          { label: t('btn.retry'), action: 'retry' },
          { label: t('btn.restart'), action: 'restart' },
        ],
        hint: [],
      };
    case 'COMPLETE':
      return {
        key: 'complete',
        tone: 'win',
        title: t('banner.allClear'),
        subtitle: null,
        rows: [
          [t('result.battles'), String(s.results.length)],
          [t('result.total'), formatTime(s.totalTime)],
          [t('result.hits'), String(s.results.reduce((n, x) => n + x.hits, 0))],
          [t('result.hp'), String(s.lastResult?.hpLeft ?? 0)],
        ],
        items: [{ label: t('btn.restart'), action: 'restart' }],
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
  items: { rect: Rect; text: TextLine }[];
  hint: TextLine[];
  /** Base pixel scale for this canvas size. */
  s: number;
}

/** Positions of everything on a W×H CRT canvas. */
export function menuLayout(spec: MenuSpec, W: number, H: number): MenuLayout {
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
  const items = spec.items.map((item) => {
    const rect: Rect = { x: M, y, w: W - 2 * M, h: itemH };
    const text = centered(item.label.toUpperCase(), y + Math.round((itemH - GLYPH_H * s) / 2), s);
    y += itemH + 3 * s;
    return { rect, text };
  });

  const hintScale = Math.max(1, s - 1);
  const lines = spec.hint.flatMap((h) => wrapText(h.toUpperCase(), Math.floor((W - 2 * M) / (6 * hintScale))));
  let hy = H - M - lines.length * 10 * hintScale;
  const hint = lines.map((text) => {
    const line = centered(text, hy, hintScale);
    hy += 10 * hintScale;
    return line;
  });

  return { title, subtitle, rows, items, hint, s };
}

/** Index of the item under a CRT-canvas point, or -1. */
export function menuItemAt(layout: MenuLayout, x: number, y: number): number {
  return layout.items.findIndex(({ rect }) => x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h);
}
