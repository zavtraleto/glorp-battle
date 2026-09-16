import { secondsToTicks, tuning } from '../config/tuning';
import type { InputState } from '../core/input/commands';
import { t } from '../i18n';
import type { World } from '../sim/world';

// On-screen battle buttons (GDD §12.1). Each button owns its pointer (multi-touch).

export class Controls {
  readonly root: HTMLElement;
  private readonly buster: HTMLButtonElement;
  private busterPointer: number | null = null;
  private keyHeld = false;

  constructor(parent: HTMLElement, private input: InputState) {
    this.root = document.createElement('div');
    this.root.className = 'controls';

    this.buster = document.createElement('button');
    this.buster.className = 'ctl-btn ctl-buster interactive';
    this.buster.innerHTML = `<span class="ctl-cooldown"></span><span class="ctl-label">${t('btn.buster')}</span>`;
    this.root.appendChild(this.buster);
    parent.appendChild(this.root);

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
  }
}
