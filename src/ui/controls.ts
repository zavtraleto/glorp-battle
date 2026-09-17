import type { InputState } from '../core/input/commands';
import { CHIPS } from '../data/chips';
import { chipName, t } from '../i18n';
import type { World } from '../sim/world';
import { chipIconHtml } from './chipIcon';

// On-screen battle buttons (GDD §12.1): CUSTOM and the queue plate on the left,
// CHIP on the right under the thumb. Each button owns its pointer (multi-touch).

export class Controls {
  readonly root: HTMLElement;
  private readonly custom: HTMLButtonElement;
  private readonly chip: HTMLButtonElement;
  private readonly queuePlate: HTMLElement;
  private chipKey = '';

  constructor(parent: HTMLElement, private input: InputState) {
    this.root = document.createElement('div');
    this.root.className = 'controls';

    const left = document.createElement('div');
    left.className = 'ctl-left';
    this.queuePlate = document.createElement('div');
    this.queuePlate.className = 'queue-plate';
    this.custom = document.createElement('button');
    this.custom.className = 'ctl-btn ctl-custom interactive';
    this.custom.textContent = t('btn.custom');
    left.append(this.queuePlate, this.custom);

    this.chip = document.createElement('button');
    this.chip.className = 'ctl-btn ctl-chip interactive';

    this.root.append(left, this.chip);
    parent.appendChild(this.root);

    this.chip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.input.push({ type: 'useChip' });
    });
    this.chip.addEventListener('contextmenu', (e) => e.preventDefault());
    this.custom.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.input.push({ type: 'openCustom' });
    });

    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.target instanceof HTMLInputElement) return;
      // Q / E open the Custom Screen (MMBN1: L / R).
      if (e.code === 'KeyQ' || e.code === 'KeyE') this.input.push({ type: 'openCustom' });
      // F / Space use the next chip (GDD §12.2).
      if (e.code === 'KeyF' || e.code === 'Space') {
        e.preventDefault();
        this.input.push({ type: 'useChip' });
      }
    });
  }

  update(world: World): void {
    this.root.classList.toggle('hidden', world.state !== 'ACTION');

    this.custom.classList.toggle('ready', world.gauge.full);
    this.custom.disabled = !world.gauge.full;

    const queue = world.chips.queue;
    const next = queue[0];
    const chipKey = next ? `${next.uid}` : '';
    if (chipKey !== this.chipKey) {
      this.chipKey = chipKey;
      this.chip.innerHTML = next
        ? `<span class="ctl-chip-icon">${chipIconHtml(next.defId, next.code)}</span><span class="ctl-chip-label">${t('btn.chip')}</span>`
        : '';
    }
    this.chip.classList.toggle('empty', !next);
    this.chip.classList.toggle('busy', world.player.actionTicks > 0 || world.player.flinched);

    const text = next ? `${chipName(next.defId)}${CHIPS[next.defId].power !== null ? ' ' + CHIPS[next.defId].power : ''}` : '';
    const plate = next ? `${text}${queue.length > 1 ? ` <span class="qp-count">+${queue.length - 1}</span>` : ''}` : '';
    if (this.queuePlate.innerHTML !== plate) this.queuePlate.innerHTML = plate;
    this.queuePlate.classList.toggle('empty', !next);
  }
}
