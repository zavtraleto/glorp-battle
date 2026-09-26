import type { BindingApi } from '@tweakpane/core';
import { Pane, type FolderApi, type TabPageApi } from 'tweakpane';
import {
  DEFAULT_TUNING,
  resetTuning,
  saveTuningOverrides,
  tuning,
} from '../config/tuning';
import { events } from '../core/events';
import type { FixedStepClock } from '../core/loop';
import { CHIPS, type ChipId } from '../data/chips';
import { FOLDERS } from '../data/folders';
import type { DebugCellState } from '../render/cellStates';
import type { Cheats } from '../sim/world';
import type { Encounter } from '../data/encounters';
import type { FolderId } from '../data/folders';
import { LabView } from './labView';
import {
  TUNE_LAYOUT,
  changedValues,
  formatChanges,
  layoutGroups,
  matchesFilter,
  resetGroups,
  sliderRange,
  tuningControlKind,
  type GroupKey,
  type TuneFolder,
} from './tuningLayout';

export interface DebugActions {
  getSeed(): number;
  /** Omitted fields keep their current value; `seed: 'random'` rolls a new seed. */
  restart(opts: { seed?: number | 'random'; battle?: number }): void;
  setCoordsVisible(v: boolean): void;
  setOverlayVisible(v: boolean): void;
  cheats: Cheats;
  killAll(): void;
  setPlayerHp(hp: number): void;
  forceAttack(): void;
  giveChip(id: ChipId): void;
  /** Battle field look (BATTLE_VISUAL.md §10). */
  setCellState(x: number, y: number, state: DebugCellState | 'NONE'): void;
  clearCellStates(): void;
  demoCellStates(): void;
  /** Run (GDD §10–11). */
  runDepth(depth: number): void;
  /** Tutorial (GDD §10.5): start from lesson 1–4, get past the current beat. */
  tutorial(lesson: number): void;
  skipTutorialBeat(): void;
  /** Encounter Lab (GDD §15.5): play a drafted encounter from `wave` (1-based). */
  runLab(encounter: Encounter, folder: FolderId, wave: number): void;
  /** Changes the real panels (roguelite spec §3). */
  simPanel(x: number, y: number, action: 'crack' | 'break' | 'repair' | 'grab' | 'rock'): void;
}

/** Folder expansion, panel expansion and the selected tab survive reloads. */
const UI_STORAGE_KEY = 'glorp.debug.ui.v1';

interface UiState {
  folds: Record<string, boolean>;
  expanded: boolean;
  tab: number;
}

function loadUi(): UiState {
  const fallback: UiState = { folds: {}, expanded: window.innerWidth >= 600, tab: 0 };
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<UiState>) } : fallback;
  } catch {
    return fallback;
  }
}

type Groups = Record<string, Record<string, number | boolean | string>>;

/** One tunable on screen. */
interface Entry {
  group: GroupKey;
  key: string;
  title: string;
  binding: BindingApi;
  folders: readonly FolderNode[];
}

interface FolderNode {
  path: string;
  api: FolderApi;
}

/** Tweakpane debug panel (GDD §15.5): Tune (every tunable, live and persisted) and Tools. */
export class DebugPanel {
  private readonly root: HTMLElement;
  private readonly pane: Pane;
  private readonly ui = loadUi();
  private readonly entries: Entry[] = [];
  private readonly folders: FolderNode[] = [];
  private readonly filterInput: HTMLInputElement;
  private readonly changedButton: HTMLButtonElement;
  private readonly copyButton: HTMLButtonElement;
  private onlyChanged = false;
  /** Folder expansion is being set by the panel, not the user: do not remember it. */
  private folding = false;
  /** The game is writing its state into the bindings: their change handlers must not act. */
  private syncing = false;
  private readonly state = { seed: 0, battle: 1, timeScale: 1, paused: false, showCoords: false, showOverlay: true, logEvents: false };

  constructor(private clock: FixedStepClock, private actions: DebugActions) {
    this.root = document.createElement('div');
    this.root.className = 'debug-panel';
    document.body.appendChild(this.root);
    this.pane = new Pane({ container: this.root, title: 'Debug', expanded: this.ui.expanded });
    this.pane.on('fold', (ev) => {
      if (ev.target !== (this.pane as unknown)) return;
      this.ui.expanded = ev.expanded;
      this.saveUi();
    });

    const bar = document.createElement('div');
    bar.className = 'debug-panel-bar';
    this.filterInput = document.createElement('input');
    this.filterInput.type = 'search';
    this.filterInput.placeholder = 'filter: cano recov';
    this.filterInput.addEventListener('input', () => this.refreshVisibility());
    this.changedButton = this.barButton('changed', () => {
      this.onlyChanged = !this.onlyChanged;
      this.refreshVisibility();
    });
    this.copyButton = this.barButton('copy', () => this.copyChanges());
    const reset = this.barButton('reset all', () => this.resetAll());
    bar.append(this.filterInput, this.changedButton, this.copyButton, reset);

    this.state.seed = actions.getSeed();
    this.state.timeScale = tuning.sim.TIME_SCALE;
    const tab = this.pane.addTab({ pages: [{ title: 'Tune' }, { title: 'Tools' }, { title: 'Lab' }] });
    tab.pages[Math.min(2, Math.max(0, this.ui.tab))]!.selected = true;
    // The filter bar only serves the Tune tab.
    const showBar = (index: number) => (bar.style.display = index === 0 ? '' : 'none');
    tab.on('select', (ev) => {
      this.ui.tab = ev.index;
      showBar(ev.index);
      this.saveUi();
    });
    for (const f of TUNE_LAYOUT) this.buildTune(tab.pages[0]!, f, []);
    this.buildTools(tab.pages[1]!);
    // Tab pages expose no element: the Lab's DOM lives inside a separator blade.
    const labBlade = tab.pages[2]!.addBlade({ view: 'separator' });
    labBlade.element.replaceChildren(new LabView({ run: (enc, folder, wave) => actions.runLab(enc, folder, wave) }).root);
    // After the blades: Tweakpane inserts its own blades at the start of the content.
    (this.pane.element.querySelector('.tp-rotv_c') ?? this.pane.element).prepend(bar);
    showBar(Math.min(2, Math.max(0, this.ui.tab)));
    this.refreshVisibility();
  }

  set visible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  /**
   * Mirrors the running session. Tweakpane fires `change` on refresh, so the
   * battle picker would otherwise restart the run every time a step advanced.
   */
  syncSeed(seed: number, battle: number): void {
    this.state.seed = seed;
    this.state.battle = battle;
    this.syncing = true;
    try {
      this.pane.refresh();
    } finally {
      this.syncing = false;
    }
  }

  // ---------- Tune ----------

  /** `parentPath` keys the remembered expansion: `Chips/Cannon`, `Tools/Cheats`. */
  private addFolder(parent: FolderApi | TabPageApi, title: string, parentPath: string): FolderNode {
    const path = parentPath ? `${parentPath}/${title}` : title;
    const api = parent.addFolder({ title, expanded: this.ui.folds[path] ?? false });
    const node = { path, api };
    api.on('fold', (ev) => {
      if (ev.target !== api || this.folding) return;
      this.ui.folds[path] = ev.expanded;
      this.saveUi();
    });
    this.folders.push(node);
    return node;
  }

  private buildTune(parent: FolderApi | TabPageApi, folder: TuneFolder, trail: readonly FolderNode[]): void {
    const node = this.addFolder(parent, folder.title, trail.at(-1)?.path ?? '');
    const chain = [...trail, node];
    const groups = layoutGroups([folder]);
    node.api.addButton({ title: `reset ${folder.title}` }).on('click', () => this.resetFolder(groups));
    for (const group of folder.groups ?? []) this.bindGroup(node.api, group, folder.title, chain);
    for (const child of folder.children ?? []) this.buildTune(node.api, child, chain);
  }

  private bindGroup(folder: FolderApi, group: GroupKey, title: string, chain: readonly FolderNode[]): void {
    const values = (tuning as unknown as Groups)[group]!;
    const defaults = (DEFAULT_TUNING as unknown as Groups)[group]!;
    for (const key of Object.keys(defaults)) {
      const def = defaults[key]!;
      const kind = tuningControlKind(def);
      let binding: BindingApi;
      if (kind === 'number') {
        const [min, max, step] = sliderRange(key, def as number);
        binding = folder.addBinding(values, key, { min, max, step });
      } else if (kind === 'color') {
        binding = folder.addBinding(values, key, { view: 'color' });
      } else {
        binding = folder.addBinding(values, key);
      }
      binding.on('change', (ev) => {
        if (!ev.last) return;
        this.applyClock(key);
        saveTuningOverrides();
        this.refreshVisibility();
      });
      this.entries.push({ group, key, title, binding, folders: chain });
    }
  }

  private applyClock(key?: string): void {
    if (!key || key === 'TIME_SCALE') {
      this.clock.timeScale = tuning.sim.TIME_SCALE;
      this.state.timeScale = tuning.sim.TIME_SCALE;
    }
    if (!key || key === 'SIM_HZ') this.clock.options.hz = tuning.sim.SIM_HZ;
  }

  /** Filter and "changed only" hide bindings and empty folders; changed values are marked. */
  private refreshVisibility(): void {
    const query = this.filterInput.value.trim();
    const narrowing = query !== '' || this.onlyChanged;
    const changed = new Set(changedValues(tuning, DEFAULT_TUNING).map((c) => `${c.group}.${c.key}`));
    const shown = new Set<FolderNode>();
    for (const e of this.entries) {
      const isChanged = changed.has(`${e.group}.${e.key}`);
      e.binding.element.classList.toggle('debug-changed', isChanged);
      const visible = matchesFilter(query, e.group, e.key, e.title) && (!this.onlyChanged || isChanged);
      e.binding.hidden = !visible;
      if (visible) for (const f of e.folders) shown.add(f);
    }
    this.folding = true;
    for (const f of this.folders) {
      // A narrowed view opens every folder with a match and hides the rest.
      f.api.hidden = narrowing && !shown.has(f);
      f.api.expanded = narrowing ? shown.has(f) : this.ui.folds[f.path] ?? false;
    }
    this.folding = false;
    this.changedButton.classList.toggle('on', this.onlyChanged);
    this.changedButton.textContent = `changed ${changed.size}`;
  }

  private resetFolder(groups: readonly GroupKey[]): void {
    resetGroups(tuning, DEFAULT_TUNING, groups);
    saveTuningOverrides();
    this.afterReset();
  }

  private resetAll(): void {
    resetTuning();
    this.afterReset();
  }

  private afterReset(): void {
    this.applyClock();
    this.pane.refresh();
    this.refreshVisibility();
  }

  private copyChanges(): void {
    const changes = changedValues(tuning, DEFAULT_TUNING);
    const text = formatChanges(changes);
    console.info('[tuning]\n' + text);
    navigator.clipboard?.writeText(text).catch(() => undefined);
    this.copyButton.textContent = `copied ${changes.length}`;
    setTimeout(() => (this.copyButton.textContent = 'copy'), 1200);
  }

  private barButton(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  private saveUi(): void {
    try {
      localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(this.ui));
    } catch {
      // storage unavailable
    }
  }

  // ---------- Tools ----------

  private buildTools(page: TabPageApi): void {
    const s = this.state;
    const a = this.actions;
    const folder = (title: string) => this.addFolder(page, title, 'Tools').api;

    const f = folder('Session');
    const folderParam = { folder: new URLSearchParams(location.search).get('folder') ?? 'starter' };
    f.addBinding(folderParam, 'folder', { label: 'folder (reloads)', options: Object.fromEntries(Object.keys(FOLDERS).map((k) => [k, k])) })
      .on('change', (ev) => {
        const url = new URL(location.href);
        url.searchParams.set('folder', String(ev.value));
        location.href = url.toString();
      });
    f.addBinding(s, 'battle', { options: { 1: 1, 2: 2, 3: 3, 4: 4 } }).on('change', (ev) => {
      if (!this.syncing) a.restart({ battle: ev.value });
    });
    f.addBinding(s, 'seed', { step: 1 });
    f.addButton({ title: 'restart with seed' }).on('click', () => a.restart({ seed: s.seed >>> 0 }));
    f.addButton({ title: 'restart random seed' }).on('click', () => a.restart({ seed: 'random' }));
    f.addButton({ title: 'restart battle' }).on('click', () => a.restart({}));
    f.addButton({ title: 'copy repro link' }).on('click', () => this.copyLink());
    const run = { step: 1 };
    f.addBinding(run, 'step', { label: 'run step', min: 1, max: 10, step: 1 });
    f.addButton({ title: 'go to run step' }).on('click', () => a.runDepth(run.step));

    const tf = folder('Time');
    tf.addBinding(s, 'timeScale', { label: 'time scale', options: { '0.25×': 0.25, '0.5×': 0.5, '1×': 1, '2×': 2 } })
      .on('change', (ev) => {
        tuning.sim.TIME_SCALE = ev.value;
        this.clock.timeScale = ev.value;
        saveTuningOverrides();
        this.pane.refresh();
        this.refreshVisibility();
      });
    tf.addBinding(s, 'paused', { label: 'pause sim' }).on('change', (ev) => (this.clock.paused = ev.value));
    tf.addButton({ title: 'step 1 tick' }).on('click', () => this.clock.stepOnce(1));
    tf.addButton({ title: 'step 1 second' }).on('click', () => this.clock.stepOnce(tuning.sim.SIM_HZ));

    const vf = folder('View');
    vf.addBinding(s, 'showCoords', { label: 'cell coords' }).on('change', (ev) => a.setCoordsVisible(ev.value));
    vf.addBinding(s, 'showOverlay', { label: 'stats overlay' }).on('change', (ev) => a.setOverlayVisible(ev.value));
    vf.addBinding(s, 'logEvents', { label: 'log events' }).on('change', (ev) => (events.logEnabled = ev.value));

    const cf = folder('Cheats');
    cf.addBinding(a.cheats, 'god', { label: 'god mode' });
    cf.addBinding(a.cheats, 'aiEnabled', { label: 'enemy AI' });
    cf.addButton({ title: 'kill wave' }).on('click', () => a.killAll());
    cf.addButton({ title: 'force enemy attack' }).on('click', () => a.forceAttack());
    const give = { chip: 'cannon' as ChipId };
    cf.addBinding(give, 'chip', { label: 'chip', options: Object.fromEntries(Object.keys(CHIPS).map((k) => [k, k])) });
    cf.addButton({ title: 'add chip to queue' }).on('click', () => a.giveChip(give.chip));
    const hp = { hp: tuning.player.PLAYER_MAX_HP };
    cf.addBinding(hp, 'hp', { label: 'player HP', min: 0, max: tuning.player.PLAYER_MAX_HP, step: 1 });
    cf.addButton({ title: 'set player HP' }).on('click', () => a.setPlayerHp(hp.hp));

    const tutNode = this.addFolder(page, 'Tutorial', 'Tools');
    const lesson = { lesson: 1 };
    tutNode.api.addBinding(lesson, 'lesson', { options: { '1 move + cannon': 1, '2 two cannons': 2, '3 grab + sword': 3, '4 final': 4 } });
    tutNode.api.addButton({ title: 'start from lesson' }).on('click', () => a.tutorial(lesson.lesson));
    tutNode.api.addButton({ title: 'skip current step' }).on('click', () => a.skipTutorialBeat());
    this.bindGroup(tutNode.api, 'tutorial', 'Tutorial', [tutNode]);

    const ff = folder('Field debug');
    const cell = { x: 1, y: 1, state: 'BROKEN' as DebugCellState | 'NONE' };
    ff.addBinding(cell, 'x', { min: 0, max: 2, step: 1 });
    ff.addBinding(cell, 'y', { min: 0, max: 5, step: 1 });
    ff.addBinding(cell, 'state', { options: { BROKEN: 'BROKEN', EMPTY: 'EMPTY', OBJECT: 'OBJECT', NONE: 'NONE' } });
    ff.addButton({ title: 'apply look to cell' }).on('click', () => a.setCellState(cell.x, cell.y, cell.state));
    const sim = { action: 'crack' as 'crack' | 'break' | 'repair' | 'grab' | 'rock' };
    ff.addBinding(sim, 'action', { label: 'sim action', options: { crack: 'crack', break: 'break', repair: 'repair', grab: 'grab', rock: 'rock' } });
    ff.addButton({ title: 'apply to sim' }).on('click', () => a.simPanel(cell.x, cell.y, sim.action));
    ff.addButton({ title: 'clear cell looks' }).on('click', () => a.clearCellStates());
    ff.addButton({ title: 'demo all looks' }).on('click', () => a.demoCellStates());
  }

  private copyLink(): void {
    const url = new URL(window.location.href);
    url.searchParams.set('debug', '1');
    url.searchParams.set('seed', String(this.state.seed));
    url.searchParams.set('battle', String(this.state.battle));
    const link = url.toString();
    console.info('[repro]', link);
    navigator.clipboard?.writeText(link).catch(() => undefined);
  }
}
