import { t } from '../i18n';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Battle HUD skeleton (GDD §13). Values are wired to the simulation in later milestones. */
export class Hud {
  readonly root: HTMLElement;
  private readonly hp: HTMLElement;
  private readonly gaugeFill: HTMLElement;
  readonly pauseButton: HTMLButtonElement;
  /** Tapping the gauge opens the Custom Screen when it is full (GDD §12.1). */
  readonly gauge: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud-top');
    this.hp = el('div', 'hud-hp');
    const gauge = el('div', 'hud-gauge interactive');
    this.gauge = gauge;
    this.gaugeFill = el('div', 'hud-gauge-fill');
    gauge.append(this.gaugeFill, el('div', 'hud-gauge-label', t('btn.custom')));
    this.pauseButton = el('button', 'hud-pause interactive');
    this.pauseButton.append(el('span', 'bar'), el('span', 'bar'));
    this.pauseButton.setAttribute('aria-label', t('banner.paused'));
    this.root.append(this.hp, gauge, this.pauseButton);
    parent.appendChild(this.root);
    this.setHp(100);
    this.setGauge(0);
  }

  /** Height in CSS px occupied at the top of the screen, used to fit the field below it. */
  get occupiedTop(): number {
    const r = this.root.getBoundingClientRect();
    return r.bottom + 4;
  }

  setHp(hp: number, maxHp = 100): void {
    const text = String(hp);
    if (this.hp.textContent !== text) this.hp.textContent = text;
    this.hp.classList.toggle('low', hp <= maxHp * 0.25);
  }

  setGauge(fraction: number, full = false): void {
    const width = `${(Math.min(1, Math.max(0, fraction)) * 100).toFixed(1)}%`;
    if (this.gaugeFill.style.width !== width) this.gaugeFill.style.width = width;
    this.gauge.classList.toggle('full', full);
  }
}
