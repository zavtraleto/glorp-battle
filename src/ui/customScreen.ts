import { CHIPS } from '../data/chips';
import { ENEMY_LOOKS } from '../data/enemies';
import { t } from '../i18n';
import type { World } from '../sim/world';
import { chipIconHtml } from './chipIcon';

// Custom Screen (GDD §7.6): preview, selected strip, hand grid, CANCEL / ADD / OK.
// Touch: tap a chip to add it, tap the last selected chip (or CANCEL) to remove it.
// Keyboard: arrows/WASD move the cursor, Enter/Space/J activate, Backspace/K cancel,
// Q/E/Tab jump to OK.

const COLS = 5;
type ButtonId = 'cancel' | 'add' | 'ok';
const BUTTONS: ButtonId[] = ['cancel', 'add', 'ok'];

export class CustomScreen {
  private readonly root: HTMLElement;
  private readonly backdrop: HTMLElement;
  private readonly enemiesEl: HTMLElement;
  private readonly previewEl: HTMLElement;
  private readonly selectedEl: HTMLElement;
  private readonly handEl: HTMLElement;
  private readonly buttons: Record<ButtonId, HTMLButtonElement>;
  private visible = false;
  /** 0..hand-1 = hand slot, hand..hand+2 = buttons. */
  private cursor = 0;
  private previewSlot: number | null = null;
  private lastSignature = '';

  constructor(parent: HTMLElement, private getWorld: () => World) {
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'cs-backdrop hidden';

    this.root = document.createElement('div');
    this.root.className = 'custom-screen hidden';
    this.root.innerHTML =
      `<div class="cs-enemies"></div>` +
      `<div class="cs-preview"></div>` +
      `<div class="cs-section-label">${t('custom.selected')}</div>` +
      `<div class="cs-selected interactive"></div>` +
      `<div class="cs-section-label">${t('custom.hand')}</div>` +
      `<div class="cs-hand interactive"></div>` +
      `<div class="cs-buttons">` +
      `<button class="cs-btn interactive" data-btn="cancel">${t('custom.cancel')}</button>` +
      `<button class="cs-btn interactive" data-btn="add">${t('custom.add')}</button>` +
      `<button class="cs-btn cs-ok interactive" data-btn="ok">${t('custom.ok')}</button>` +
      `</div>`;
    parent.append(this.backdrop, this.root);

    const q = (sel: string) => this.root.querySelector(sel) as HTMLElement;
    this.enemiesEl = q('.cs-enemies');
    this.previewEl = q('.cs-preview');
    this.selectedEl = q('.cs-selected');
    this.handEl = q('.cs-hand');
    this.buttons = {
      cancel: q('[data-btn="cancel"]') as HTMLButtonElement,
      add: q('[data-btn="add"]') as HTMLButtonElement,
      ok: q('[data-btn="ok"]') as HTMLButtonElement,
    };

    for (const id of BUTTONS) {
      this.buttons[id].addEventListener('click', () => this.activateButton(id));
    }
    this.handEl.addEventListener('click', (e) => {
      const slot = this.slotFromEvent(e);
      if (slot === null) return;
      this.cursor = slot;
      this.activateSlot(slot);
    });
    this.handEl.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'mouse') return;
      const slot = this.slotFromEvent(e);
      // No forced re-render here: replacing the DOM under the cursor would swallow clicks.
      if (slot !== null && slot !== this.previewSlot && this.getWorld().chips.hand[slot]) {
        this.previewSlot = slot;
        this.render(false);
      }
    });
    this.selectedEl.addEventListener('click', (e) => {
      const target = (e.target as Element).closest('[data-sel]');
      if (!target) return;
      const world = this.getWorld();
      // Only the last selected chip can be removed (MMBN1).
      if (Number((target as HTMLElement).dataset.sel) === world.chips.selection.length - 1) this.activateButton('cancel');
    });

    window.addEventListener('keydown', (e) => this.onKey(e), { capture: true });
  }

  private slotFromEvent(e: Event): number | null {
    const target = (e.target as Element).closest('[data-slot]');
    return target ? Number((target as HTMLElement).dataset.slot) : null;
  }

  private get handLength(): number {
    return this.getWorld().chips.hand.length;
  }

  private activateSlot(slot: number): void {
    const world = this.getWorld();
    if (world.customSelect(slot)) this.previewSlot = slot;
    else if (world.chips.hand[slot]) this.previewSlot = slot;
    this.render(true);
  }

  private activateButton(id: ButtonId): void {
    const world = this.getWorld();
    if (id === 'cancel') world.customCancel();
    else if (id === 'add') world.customAdd();
    else world.customConfirm();
    this.render(true);
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.visible || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const n = this.handLength;
    const inHand = this.cursor < n;
    let handled = true;
    switch (e.code) {
      case 'ArrowLeft':
      case 'KeyA':
        this.cursor = Math.max(0, this.cursor - 1);
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.cursor = Math.min(n + BUTTONS.length - 1, this.cursor + 1);
        break;
      case 'ArrowUp':
      case 'KeyW':
        if (inHand) this.cursor = Math.max(0, this.cursor - COLS);
        else this.cursor = Math.max(0, Math.min(n - 1, (Math.ceil(n / COLS) - 1) * COLS + (this.cursor - n)));
        break;
      case 'ArrowDown':
      case 'KeyS':
        if (inHand) this.cursor = this.cursor + COLS < n ? this.cursor + COLS : n + BUTTONS.length - 1;
        break;
      case 'Enter':
      case 'Space':
      case 'KeyJ':
        if (e.repeat) break;
        if (inHand) this.activateSlot(this.cursor);
        else this.activateButton(BUTTONS[this.cursor - n] as ButtonId);
        break;
      case 'Backspace':
      case 'Escape':
      case 'KeyK':
        this.activateButton('cancel');
        break;
      case 'KeyQ':
      case 'KeyE':
      case 'Tab':
        this.cursor = n + BUTTONS.indexOf('ok');
        break;
      default:
        handled = false;
    }
    if (!handled) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (this.cursor < n) this.previewSlot = this.cursor;
    this.render(true);
  }

  private onOpen(): void {
    const chips = this.getWorld().chips;
    const first = chips.hand.findIndex((_, i) => chips.canSelect(i));
    this.cursor = first >= 0 ? first : chips.hand.length + BUTTONS.indexOf('ok');
    this.previewSlot = first >= 0 ? first : null;
  }

  update(): void {
    const world = this.getWorld();
    const visible = world.state === 'CUSTOM';
    if (visible !== this.visible) {
      this.visible = visible;
      this.root.classList.toggle('hidden', !visible);
      this.backdrop.classList.toggle('hidden', !visible);
      if (visible) this.onOpen();
      this.lastSignature = '';
    }
    if (visible) this.render(false);
  }

  private render(force: boolean): void {
    const world = this.getWorld();
    const chips = world.chips;
    const signature = [
      chips.hand.map((c) => c?.uid ?? 0).join(','),
      chips.selection.join(','),
      this.cursor,
      this.previewSlot,
      chips.addStreak,
      world.enemies.length,
    ].join('|');
    if (!force && signature === this.lastSignature) return;
    this.lastSignature = signature;

    // Enemies of this battle (MMBN1 lists them on the Custom Screen).
    const counts = new Map<string, number>();
    for (const e of world.enemies) {
      if (!e.alive) continue;
      const name = ENEMY_LOOKS[e.kind].name;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    this.enemiesEl.textContent = [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join('  ·  ');

    // Preview.
    const preview = this.previewSlot !== null ? chips.hand[this.previewSlot] : null;
    if (preview) {
      const def = CHIPS[preview.defId];
      this.previewEl.innerHTML =
        `<div class="cs-preview-icon">${chipIconHtml(preview.defId, preview.code, { showPower: false })}</div>` +
        `<div class="cs-preview-text">` +
        `<div class="cs-preview-name">${def.name} <span class="cs-preview-code">${preview.code}</span></div>` +
        `<div class="cs-preview-power">${def.power !== null ? def.power : '—'}</div>` +
        `<div class="cs-preview-desc">${def.description}</div>` +
        `</div>`;
    } else {
      this.previewEl.innerHTML = '<div class="cs-preview-empty"></div>';
    }

    // Selected strip: always 5 slots.
    const selected = chips.selectedChips();
    let sel = '';
    for (let i = 0; i < 5; i++) {
      const c = selected[i];
      const last = i === selected.length - 1;
      sel += c
        ? `<div class="cs-sel filled${last ? ' last' : ''}" data-sel="${i}">${chipIconHtml(c.defId, c.code)}</div>`
        : `<div class="cs-sel"></div>`;
    }
    this.selectedEl.innerHTML = sel;

    // Hand grid.
    let hand = '';
    chips.hand.forEach((c, i) => {
      const cls = ['cs-slot'];
      if (i === this.cursor) cls.push('cursor');
      if (!c) cls.push('empty');
      else if (chips.isSelected(i)) cls.push('selected');
      else if (!chips.canSelect(i)) cls.push('disabled');
      const order = chips.selection.indexOf(i);
      const badge = order >= 0 ? `<span class="cs-order">${order + 1}</span>` : '';
      hand += `<div class="${cls.join(' ')}" data-slot="${i}">${c ? chipIconHtml(c.defId, c.code) : ''}${badge}</div>`;
    });
    this.handEl.innerHTML = hand;

    const n = chips.hand.length;
    BUTTONS.forEach((id, k) => this.buttons[id].classList.toggle('cursor', this.cursor === n + k));
    this.buttons.cancel.disabled = chips.selection.length === 0;
  }
}
