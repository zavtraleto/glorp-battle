import { tuning } from '../config/tuning';
import { ENCOUNTERS, STAGES, type Encounter } from '../data/encounters';
import type { EnemyLevel } from '../data/enemies';
import type { FolderId } from '../data/folders';
import { ENEMY_KINDS } from '../sim/enemies/enemyBase';
import { COLS, ROWS, sideOfRow } from '../sim/grid';
import {
  cellContent,
  draftFromEncounter,
  emptyDraft,
  exportTs,
  paint,
  parseDraft,
  toEncounter,
  validateDraft,
  type LabBrush,
  type LabDraft,
} from './lab';

// Encounter Lab view (GDD §15.5): palette brush + field grid per wave, run
// from the chosen wave, copy the TS fragment. The draft survives reloads.

const STORAGE_KEY = 'glorp.lab.v1';

export interface LabActions {
  run(encounter: Encounter, folder: FolderId, wave: number): void;
}

function load(): LabDraft {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return (raw && parseDraft(raw)) || emptyDraft();
  } catch {
    return emptyDraft();
  }
}

const abbrev = (kind: string) => kind.slice(0, 3).replace(/^./, (c) => c.toUpperCase());

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class LabView {
  readonly root = el('div', 'lab');
  private draft = load();
  private wave = 0;
  private brush: LabBrush = { type: 'enemy', kind: 'mettik', level: 1 };
  private level: EnemyLevel = 1;
  /** Encounter picked in the load list. */
  private pick = 's1';
  private readonly body = el('div');

  constructor(private readonly actions: LabActions) {
    this.root.append(this.body);
    this.render();
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.draft));
    } catch {
      // storage unavailable
    }
  }

  private changed(): void {
    this.save();
    this.render();
  }

  private button(label: string, onClick: () => void, on = false, cls = ''): HTMLButtonElement {
    const b = el('button', `lab-btn${on ? ' on' : ''}${cls ? ` ${cls}` : ''}`, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  private select<T extends string>(value: T, options: readonly T[], onChange: (v: T) => void): HTMLSelectElement {
    const s = el('select', 'lab-input');
    for (const o of options) s.append(new Option(o, o, false, o === value));
    s.addEventListener('change', () => onChange(s.value as T));
    return s;
  }

  private render(): void {
    const d = this.draft;
    this.wave = Math.min(this.wave, d.waves.length - 1);
    const rows: HTMLElement[] = [];

    // Load an existing encounter or start over.
    const ids = [...STAGES, ...ENCOUNTERS].map((x) => x.id);
    const pick = this.select(this.pick, ids, (v) => (this.pick = v));
    rows.push(
      this.row(
        pick,
        this.button('load', () => {
          const enc = [...STAGES, ...ENCOUNTERS].find((x) => x.id === pick.value);
          if (!enc) return;
          this.draft = { ...draftFromEncounter(enc), folder: d.folder };
          this.wave = 0;
          this.changed();
        }),
        this.button('new', () => {
          this.draft = { ...emptyDraft(), folder: d.folder };
          this.wave = 0;
          this.changed();
        }),
      ),
    );

    const id = el('input', 'lab-input lab-id');
    id.value = d.id;
    id.addEventListener('change', () => {
      d.id = id.value.trim() || 'lab1';
      this.save();
    });
    const depth = el('input', 'lab-input lab-depth');
    depth.type = 'number';
    depth.min = '1';
    depth.value = String(d.depth);
    depth.addEventListener('change', () => {
      d.depth = Math.max(1, Math.floor(Number(depth.value)) || 1);
      this.save();
    });
    rows.push(
      this.row(
        id,
        this.select(d.tier, ['normal', 'elite'] as const, (v) => ((d.tier = v), this.save())),
        depth,
        this.select(d.folder, ['starter', 'all'] as const, (v) => ((d.folder = v), this.save())),
      ),
    );

    // Waves.
    const waves = d.waves.map((_, i) => this.button(String(i + 1), () => ((this.wave = i), this.render()), i === this.wave));
    rows.push(
      this.row(
        el('span', 'lab-label', 'wave'),
        ...waves,
        this.button('+', () => {
          d.waves.push({ enemies: [], panels: [] });
          this.wave = d.waves.length - 1;
          this.changed();
        }),
        this.button('dup', () => {
          d.waves.splice(this.wave + 1, 0, JSON.parse(JSON.stringify(d.waves[this.wave])));
          this.wave++;
          this.changed();
        }),
        this.button('del', () => {
          if (d.waves.length > 1) d.waves.splice(this.wave, 1);
          else d.waves[0] = { enemies: [], panels: [] };
          this.changed();
        }),
      ),
    );

    // Run and export sit above the grid: on a phone they stay in view.
    const problems = validateDraft(d);
    const status = el('div', 'lab-status', problems.length ? problems.join(' · ') : 'ready · saved');
    status.classList.toggle('bad', problems.length > 0);
    const run = (wave: number) => {
      if (problems.length === 0) this.actions.run(toEncounter(d), d.folder, wave);
    };
    const copy = this.button('copy TS', () => {
      const text = exportTs(d);
      console.info('[lab]\n' + text);
      navigator.clipboard?.writeText(text).catch(() => undefined);
      copy.textContent = 'copied';
      setTimeout(() => (copy.textContent = 'copy TS'), 1200);
    });
    rows.push(
      this.row(
        this.button(`▶ wave ${this.wave + 1}`, () => run(this.wave + 1), false, 'go'),
        this.button('▶ all', () => run(1), false, 'go'),
        copy,
      ),
      status,
    );

    // Palette: kind, level, panels, eraser.
    const b = this.brush;
    rows.push(
      this.row(
        ...ENEMY_KINDS.map((kind) =>
          this.button(abbrev(kind), () => ((this.brush = { type: 'enemy', kind, level: this.level }), this.render()), b.type === 'enemy' && b.kind === kind),
        ),
      ),
      this.row(
        ...([1, 2, 3] as const).map((lv) =>
          this.button(`L${lv}`, () => {
            this.level = lv;
            if (this.brush.type === 'enemy') this.brush = { ...this.brush, level: lv };
            this.render();
          }, this.level === lv),
        ),
        this.button('crack', () => ((this.brush = { type: 'panel', panel: 'CRACKED' }), this.render()), b.type === 'panel' && b.panel === 'CRACKED'),
        this.button('hole', () => ((this.brush = { type: 'panel', panel: 'BROKEN' }), this.render()), b.type === 'panel' && b.panel === 'BROKEN'),
        this.button('erase', () => ((this.brush = { type: 'erase' }), this.render()), b.type === 'erase'),
      ),
    );

    // The field as the CRT shows it: enemy rows on top.
    const grid = el('div', 'lab-grid');
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = cellContent(d, this.wave, x, y);
        const cell = el('button', `lab-cell ${sideOfRow(y)}${c.panel ? ` ${c.panel.toLowerCase()}` : ''}`);
        cell.type = 'button';
        const player = x === tuning.player.PLAYER_START_X && y === tuning.player.PLAYER_START_Y;
        if (c.enemy) {
          cell.textContent = abbrev(c.enemy.kind);
          if ((c.enemy.level ?? 1) > 1) cell.append(el('sup', undefined, String(c.enemy.level)));
        } else if (player) {
          cell.textContent = '@';
        }
        cell.addEventListener('click', () => {
          paint(d, this.wave, x, y, this.brush);
          this.changed();
        });
        grid.append(cell);
      }
    }
    rows.push(grid);

    this.body.replaceChildren(...rows);
  }

  private row(...children: HTMLElement[]): HTMLElement {
    const r = el('div', 'lab-row');
    r.append(...children);
    return r;
  }
}
