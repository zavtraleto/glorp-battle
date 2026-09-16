import { secondsToTicks, tuning } from '../config/tuning';
import type { InputState } from '../core/input/commands';
import { CHIPS } from '../data/chips';
import { t } from '../i18n';
import type { World } from '../sim/world';

// On-screen battle buttons (GDD §12.1). Each button owns its pointer (multi-touch).

export class Controls {
  readonly root: HTMLElement;
  private readonly buster: HTMLButtonElement;
  private readonly custom: HTMLButtonElement;
  private readonly queuePlate: HTMLElement;
  private busterPointer: number | null = null;
  private keyHeld = false;

  constructor(parent: HTMLElement, private input: InputState) {
    this.root = document.createElement('div');
    this.root.className = 'controls';

    this.buster = document.createElement('button');
    this.buster.className = 'ctl-btn ctl-buster interactive';
    this.buster.innerHTML = `<span class="ctl-cooldown"></span><span class="ctl-label">${t('btn.buster')}</span>`;

    const left = document.createElement('div');
    left.className = 'ctl-left';
    this.queuePlate = document.createElement('div');
    this.queuePlate.className = 'queue-plate';
    this.custom = document.createElement('button');
    this.custom.className = 'ctl-btn ctl-custom interactive';
    this.custom.textContent = t('btn.custom');
    left.append(this.queuePlate, this.custom);

    this.root.append(left, this.buster);
    parent.appendChild(this.root);

    this.custom.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.input.push({ type: 'openCustom' });
    });

    this.buster.addEventListener('pointerdown', (e) => {
      if (this.busterPointer !== null) return;
      e.preventDefault();
      this.busterPointer = e.pointerId;
      this.input.push({ type: 'busterDown' });
      try {
        // Keeps receiving pointerup even if the finger slides off the button.
        this.buster.setPointerCapture(e.pointerId);
      } catch {
        // Pointer already gone (or synthetic): pointerup/cancel still release the button.
      }
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.busterPointer) return;
      this.busterPointer = null;
      this.input.push({ type: 'busterUp' });
    };
    this.buster.addEventListener('pointerup', release);
    this.buster.addEventListener('pointercancel', release);
    this.buster.addEventListener('lostpointercapture', release);
    this.buster.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      if (e.repeat || this.keyHeld) return;
      this.keyHeld = true;
      this.input.push({ type: 'busterDown' });
    });
    window.addEventListener('keyup', (e) => {
      if (e.code !== 'Space' || !this.keyHeld) return;
      this.keyHeld = false;
      this.input.push({ type: 'busterUp' });
    });
    window.addEventListener('keydown', (e) => {
      // Q / E open the Custom Screen (MMBN1: L / R).
      if ((e.code === 'KeyQ' || e.code === 'KeyE') && !e.repeat) this.input.push({ type: 'openCustom' });
    });
    window.addEventListener('blur', () => {
      if (this.keyHeld) this.input.push({ type: 'busterUp' });
      this.keyHeld = false;
    });
  }

  /** Clears held state after a battle restart. */
  reset(): void {
    this.busterPointer = null;
    this.keyHeld = false;
  }

  update(world: World): void {
    const b = world.player.buster;
    const total = Math.max(1, secondsToTicks(tuning.buster.BUSTER_COOLDOWN));
    const remaining = b.cooldownRemaining(world.tick) / total;
    const charge = world.chargeDisplay();
    this.buster.style.setProperty('--cooldown', remaining.toFixed(3));
    this.buster.classList.toggle('cooling', remaining > 0);
    this.buster.classList.toggle('pressed', b.held);
    this.buster.dataset.charge = charge.visible ? String(charge.level) : '';
    this.root.classList.toggle('hidden', world.state !== 'ACTION');

    this.custom.classList.toggle('ready', world.gauge.full);
    this.custom.disabled = !world.gauge.full;

    const queue = world.chips.queue;
    const head = queue[0];
    const text = head ? `${CHIPS[head.defId].name}${CHIPS[head.defId].power !== null ? ' ' + CHIPS[head.defId].power : ''}` : '';
    const plate = head ? `${text}${queue.length > 1 ? ` <span class="qp-count">+${queue.length - 1}</span>` : ''}` : '';
    if (this.queuePlate.innerHTML !== plate) this.queuePlate.innerHTML = plate;
    this.queuePlate.classList.toggle('empty', !head);
  }
}
