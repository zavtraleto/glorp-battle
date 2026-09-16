import type { Session } from '../app/session';
import { t } from '../i18n';

// Full-screen menus (GDD §11): title, pause, result, defeat, sequence complete.

export interface ScreenActions {
  start(): void;
  resume(): void;
  retry(): void;
  restart(): void;
  next(): void;
}

interface ScreenSpec {
  key: string;
  variant: 'title' | 'info' | 'win' | 'lose';
  title: string;
  subtitle?: string;
  rows?: [string, string][];
  hint?: string[];
  buttons: { label: string; action: () => void; primary?: boolean }[];
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

export class Screens {
  private readonly root: HTMLElement;
  private currentKey = '';

  constructor(parent: HTMLElement, private actions: ScreenActions) {
    this.root = document.createElement('div');
    this.root.className = 'screen hidden';
    parent.appendChild(this.root);
  }

  private spec(session: Session): ScreenSpec | null {
    const a = this.actions;
    const r = session.lastResult;
    switch (session.screen) {
      case 'TITLE':
        return {
          key: 'title',
          variant: 'title',
          title: t('game.title'),
          subtitle: t('title.subtitle'),
          hint: [t('title.hintTouch'), t('title.hintKeys')],
          buttons: [{ label: t('title.start'), action: a.start, primary: true }],
        };
      case 'PAUSED':
        return {
          key: 'paused',
          variant: 'info',
          title: t('banner.paused'),
          buttons: [
            { label: t('btn.resume'), action: a.resume, primary: true },
            { label: t('btn.retry'), action: a.retry },
            { label: t('btn.restart'), action: a.restart },
          ],
        };
      case 'RESULT':
        return {
          key: `result-${session.battleIndex}-${session.results.length}`,
          variant: 'win',
          title: t('banner.enemyDeleted'),
          subtitle: t('banner.battle', { n: session.battleIndex, total: session.battleCount }),
          rows: r
            ? [
                [t('result.time'), formatTime(r.time)],
                [t('result.hits'), String(r.hits)],
                [t('result.hp'), String(r.hpLeft)],
              ]
            : [],
          buttons: [{ label: t('btn.next'), action: a.next, primary: true }],
        };
      case 'DEFEAT':
        return {
          key: `defeat-${session.battleIndex}-${session.attempt}`,
          variant: 'lose',
          title: t('banner.gameOver'),
          subtitle: t('banner.battle', { n: session.battleIndex, total: session.battleCount }),
          buttons: [
            { label: t('btn.retry'), action: a.retry, primary: true },
            { label: t('btn.restart'), action: a.restart },
          ],
        };
      case 'COMPLETE':
        return {
          key: 'complete',
          variant: 'win',
          title: t('banner.allClear'),
          rows: [
            [t('result.battles'), String(session.results.length)],
            [t('result.total'), formatTime(session.totalTime)],
            [t('result.hits'), String(session.results.reduce((n, x) => n + x.hits, 0))],
            [t('result.hp'), String(session.lastResult?.hpLeft ?? 0)],
          ],
          buttons: [{ label: t('btn.restart'), action: a.restart, primary: true }],
        };
      case 'BATTLE':
        return null;
    }
  }

  get visible(): boolean {
    return this.currentKey !== '';
  }

  update(session: Session): void {
    const spec = this.spec(session);
    const key = spec?.key ?? '';
    if (key === this.currentKey) return;
    this.currentKey = key;
    this.root.classList.toggle('hidden', !spec);
    if (!spec) {
      this.root.replaceChildren();
      return;
    }
    this.root.dataset.variant = spec.variant;
    const rows = (spec.rows ?? [])
      .map(([k, v]) => `<div class="scr-row"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`)
      .join('');
    const hint = (spec.hint ?? []).map((h) => `<p>${escapeHtml(h)}</p>`).join('');
    this.root.innerHTML =
      `<div class="scr-card">` +
      `<div class="scr-title">${escapeHtml(spec.title)}</div>` +
      (spec.subtitle ? `<div class="scr-subtitle">${escapeHtml(spec.subtitle)}</div>` : '') +
      (rows ? `<div class="scr-rows">${rows}</div>` : '') +
      `<div class="scr-buttons"></div>` +
      (hint ? `<div class="scr-hint">${hint}</div>` : '') +
      `</div>`;
    const box = this.root.querySelector('.scr-buttons') as HTMLElement;
    for (const b of spec.buttons) {
      const el = document.createElement('button');
      el.className = `scr-btn interactive${b.primary ? ' primary' : ''}`;
      el.textContent = b.label;
      el.addEventListener('click', b.action);
      box.appendChild(el);
    }
  }

  /** Enter / Space trigger the primary button while a screen is shown. */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.visible || (e.code !== 'Enter' && e.code !== 'Space') || e.repeat) return false;
    const primary = this.root.querySelector('.scr-btn.primary') as HTMLButtonElement | null;
    if (!primary) return false;
    primary.click();
    return true;
  }
}
