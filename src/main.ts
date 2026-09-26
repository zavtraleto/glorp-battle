import './styles.css';
import * as THREE from 'three';
import { Session } from './app/session';
import { loadTuningOverrides, tuning } from './config/tuning';
import { events } from './core/events';
import { InputState } from './core/input/commands';
import { attachKeyboard, blockBrowserGestures, trapBackNavigation } from './core/input/devices';
import { GameLoop } from './core/loop';
import { randomSeed } from './core/rng';
import { BenchAutopilot, formatBench } from './debug/bench';
import { DebugOverlay, enemyTimingLines, gestureLines } from './debug/overlay';
import { DeadTimeMeter, formatDeadTime } from './debug/deadTime';
import type { DebugActions, DebugPanel } from './debug/debugPanel';
import { parseDebugParams } from './debug/params';
import { PerfProbe } from './debug/perfProbe';
import { t } from './i18n';
import { SceneRenderer } from './render/scene';
import type { Cheats } from './sim/world';
import { Terminal } from './terminal/terminal';
import { loadSpriteArt } from './render/spriteArt';
import { cellKey } from './render/cellStates';
import { COLS } from './sim/grid';

function byId(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e;
}

loadTuningOverrides();
const params = parseDebugParams(window.location.search);
const query = new URLSearchParams(window.location.search);
if (params.timescale !== 1) tuning.sim.TIME_SCALE = params.timescale;
if (params.rscale !== null) tuning.terminal.RENDER_SCALE_SHORT = params.rscale;
if (params.crtres) [tuning.terminal.CRT_RES_W, tuning.terminal.CRT_RES_H] = params.crtres;

const stage = byId('stage');
const ui = byId('ui');

const cheats: Cheats = { god: params.god, aiEnabled: true };
const session = new Session({ seed: params.seed ?? randomSeed(), cheats, folder: params.folder });
// ?tutorial=N / ?battle=N / ?encounter=<id>[&wave=N] skip the title and jump straight into a battle (debug).
if (params.tutorial) session.debugTutorial(params.tutorial);
else if (params.encounter) session.debugEncounter(params.encounter, undefined, params.wave);
else if (query.has('battle')) session.debugJump(params.battle);

// ?bench=1: autopilot on battle 1 for the frame budget check (TERMINAL.md §10).
const perf = new PerfProbe();
const deadTime = new DeadTimeMeter();
const bench = params.bench ? new BenchAutopilot(params.seed ?? 1) : null;
let benchReport = '';
if (bench) {
  cheats.god = true;
  session.debugJump(1);
}

const input = new InputState();
attachKeyboard(input);
blockBrowserGestures();
// A back gesture / button pauses the battle instead of leaving the game.
trapBackNavigation(() => session.pause());

// ---------- Screen wake lock (GDD §12) ----------
type WakeLockLike = { release(): Promise<void> };
let wakeLock: WakeLockLike | null = null;
async function keepAwake(): Promise<void> {
  const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockLike> } };
  if (!nav.wakeLock || wakeLock || document.hidden) return;
  try {
    wakeLock = await nav.wakeLock.request('screen');
  } catch {
    wakeLock = null;
  }
}

// ---------- Terminal ----------
function togglePause(): void {
  if (session.screen === 'PAUSED') session.resume();
  else session.pause();
}

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const sceneRenderer = new SceneRenderer({ renderer });
// Hand-drawn sprites load in the background; until then the static placeholder stands in.
void loadSpriteArt().then(() => sceneRenderer.refreshArt());
const terminal = new Terminal({
  renderer,
  container: stage,
  session,
  sceneRenderer,
  perf,
  handlers: {
    move: (dir) => input.push({ type: 'move', dir }),
    execute: () => input.push({ type: 'useChip' }),
    selectChip: (slot) => input.push({ type: 'selectChip', slot }),
    pause: () => {
      if (session.screen === 'BATTLE' || session.screen === 'PAUSED') togglePause();
    },
    menu: (action) => {
      if (action === 'start:play') {
        session.start();
        void keepAwake();
        return;
      }
      if (action === 'start:tutorial') {
        session.startTutorial();
        void keepAwake();
        return;
      }
      const [kind] = action.split(':');
      if (kind === 'resume') session.resume();
      else if (kind === 'abandon') session.abandon();
      else if (kind === 'title') session.toTitle();
      else if (kind === 'fight') session.fight();
    },
  },
});
terminal.setHitZonesVisible(params.hitzones);

// ---------- Session → views ----------
function afterWorldChange(): void {
  input.clear();
  sceneRenderer.reset();
  terminal.resetWorld();
  panel?.syncSeed(session.seed, Math.min(4, session.battleIndex));
  events.emit('seedChanged', { seed: session.world.seed });
}

let seenWorldVersion = session.worldVersion;
function syncWorld(): void {
  if (seenWorldVersion === session.worldVersion) return;
  seenWorldVersion = session.worldVersion;
  afterWorldChange();
}

// Esc toggles pause.
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && !e.repeat && (session.screen === 'BATTLE' || session.screen === 'PAUSED')) {
    togglePause();
    e.preventDefault();
  }
});

/** Keeps the bench battle running: confirms Custom Screens and restarts finished battles. */
function driveBench(frameSeconds: number): void {
  if (!bench || bench.done) return;
  const w = session.world;
  if (session.screen !== 'BATTLE' && session.screen !== 'PAUSED') {
    session.debugJump(1);
    return;
  }
  // The autopilot keeps the Attack Queue stocked; there is no screen to confirm.
  for (let i = 0; i < w.chips.hand.length; i++) w.selectChip(i);
  for (const c of bench.frame(frameSeconds)) input.push(c);
  if (bench.done) {
    benchReport = formatBench({ seconds: bench.duration, snapshot: perf.snapshot() });
    console.info(benchReport);
    setDebugVisible(true);
  }
}

const loop = new GameLoop(
  { hz: tuning.sim.SIM_HZ, maxFrameTime: tuning.sim.MAX_FRAME_TIME },
  {
    // Commands are handed to the first tick of the frame; later ticks only see the held direction.
    tick: (dt) => {
      const world = session.world;
      world.step(dt, { commands: input.drain(), held: input.heldDir });
      deadTime.observe(world);
      const drained = world.drainEvents();
      for (const e of drained) {
        sceneRenderer.handleEvent(e, world);
        terminal.onEvent(e, world);
        if (events.logEnabled) console.debug('[sim]', world.tick, e);
      }
      session.update(drained);
    },
    render: (alpha, frameSeconds) => {
      syncWorld();
      const world = session.world;
      // A frozen simulation must not be extrapolated between ticks.
      const simAlpha = world.simFrozen ? 0 : alpha;
      driveBench(frameSeconds);
      terminal.render(world, simAlpha, loop.clock.dt);
      // frameMs is the previous frame's tick + render time (written after this callback).
      perf.record(frameSeconds * 1000, loop.stats.frameMs);
      if (!overlay.visible) return;
      const p = world.player;
      overlay.update(frameSeconds, {
        stats: loop.stats,
        state: `${session.screen}/${world.state}`,
        seed: session.seed,
        battle: session.battleIndex,
        timeScale: loop.clock.timeScale,
        paused: loop.clock.paused,
        simTime: world.time,
        perf: perf.snapshot(),
        deadTime: formatDeadTime(deadTime.stats),
        extra:
          (benchReport ? `${benchReport}\n` : '') +
          `player ${p.x},${p.y} hp ${p.hp} hits ${p.hitsTaken} ${p.flinched ? 'FLINCH ' : ''}${p.invulnerable ? 'IFR' : ''}\n` +
          `cooling ${world.chips.coolingCount}\n` +
          `draw ${world.chips.drawRemaining} hand ${world.chips.hand.filter(Boolean).length}/${world.chips.hand.length}` +
          ` attack ${world.chips.attack.length} used ${world.chips.count('used')}` +
          ` chip ${world.activeChip ? world.activeChip.def.id : '-'}\n` +
          `step ${session.depth}/${session.steps}  folder ${session.folderSize}` +
          (session.tutorialBeat ? `  tut ${session.tutorialBeat}` : '') + '\n' +
          gestureLines(terminal.gestures, p.moves) + '\n' +
          enemyTimingLines(world.enemies, world.tick, tuning.sim.SIM_HZ) +
          `\nattacks ${world.attacks.length}${cheats.god ? '  GOD' : ''}${cheats.aiEnabled ? '' : '  AI OFF'}`,
      });
    },
  },
);
loop.clock.timeScale = tuning.sim.TIME_SCALE;
terminal.movesProbe = () => session.world.player.moves;

// ---------- Debug tools ----------
const overlay = new DebugOverlay(ui);
let debugChipUid = 10_000;
const debugActions: DebugActions = {
  getSeed: () => session.seed,
  restart: ({ seed, battle }) => {
    session.debugJump(battle ?? 1, seed === 'random' ? randomSeed() : seed);
    syncWorld();
  },
  setCoordsVisible: (v) => sceneRenderer.field.setCoordsVisible(v),
  setOverlayVisible: (v) => (overlay.visible = v),
  cheats,
  killAll: () => session.world.killAllEnemies(),
  setPlayerHp: (hp) => {
    const p = session.world.player;
    p.hp = Math.max(0, Math.min(p.maxHp, Math.round(hp)));
  },
  giveChip: (defId) => {
    // Debug chips get uids outside the folder range.
    session.world.giveChip({ uid: debugChipUid++, defId, state: 'queued', deal: 0 });
  },
  forceAttack: () => {
    const w = session.world;
    for (const e of w.enemies) e.forceAttack(w.tick);
  },
  setCellState: (x, y, state) => {
    const key = cellKey(x, y, COLS);
    if (state === 'NONE') sceneRenderer.field.overrides.delete(key);
    else sceneRenderer.field.overrides.set(key, state);
  },
  runDepth: (depth) => session.debugDepth(depth),
  runLab: (encounter, folder, wave) => {
    session.debugCustom(encounter, folder, wave);
    syncWorld();
    // On a phone the panel covers the field: straight into the fight, DBG brings the Lab back.
    // With a mouse it stays open for the next edit.
    if (window.matchMedia('(pointer: coarse)').matches) setDebugVisible(false);
  },
  tutorial: (lesson) => {
    session.debugTutorial(lesson);
    syncWorld();
  },
  skipTutorialBeat: () => session.debugSkipTutorialBeat(),
  simPanel: (x, y, action) => {
    const w = session.world;
    const occupied = !w.occupancy.isFree(x, y);
    if (action === 'crack') w.field.crack(x, y);
    else if (action === 'break') w.field.breakPanel(x, y, w.tick, occupied);
    else if (action === 'repair') w.field.repair(x, y);
    else if (action === 'grab') w.field.setOwner(x, y, w.field.owner(x, y) === 'enemy' ? 'player' : 'enemy', w.tick);
    else w.placeObject('rock', x, y, w.field.owner(x, y) ?? 'player');
  },
  clearCellStates: () => sceneRenderer.field.overrides.clear(),
  demoCellStates: () => {
    const f = sceneRenderer.field;
    f.overrides.clear();
    f.overrides.set(cellKey(0, 0, COLS), 'BROKEN');
    f.overrides.set(cellKey(2, 0, COLS), 'EMPTY');
    f.overrides.set(cellKey(1, 2, COLS), 'OBJECT');
    f.overrides.set(cellKey(0, 5, COLS), 'BROKEN');
    const w = session.world;
    f.markAttack([{ x: 2, y: 3 }], w.tick, 'accent');
    f.markAttack([{ x: 0, y: 3 }], w.tick, 'red');
  },
};
// Tweakpane loads on the first DBG press, off the startup path (GDD §15.5).
let panel: DebugPanel | null = null;
let panelLoad: Promise<DebugPanel> | null = null;
let debugVisible = false;
function loadPanel(): Promise<DebugPanel> {
  panelLoad ??= import('./debug/debugPanel').then(({ DebugPanel }) => {
    panel = new DebugPanel(loop.clock, debugActions);
    panel.syncSeed(session.seed, Math.min(4, session.battleIndex));
    return panel;
  });
  // A failed chunk load (offline, a dev-server restart) retries on the next press.
  panelLoad.catch(() => (panelLoad = null));
  return panelLoad;
}

// Small toggle in the bottom-left corner: debug tools on phones and in the published build.
const debugToggle = document.createElement('button');
debugToggle.className = 'debug-toggle';
debugToggle.textContent = t('btn.debug');
ui.appendChild(debugToggle);
debugToggle.addEventListener('click', () => setDebugVisible(!debugVisible));

function setDebugVisible(v: boolean): void {
  debugVisible = v;
  overlay.visible = v;
  debugToggle.classList.toggle('on', v);
  if (panel) panel.visible = v;
  else if (v) void loadPanel().then((p) => (p.visible = debugVisible));
}
setDebugVisible(params.debug || import.meta.env.DEV);
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === '`' || e.key === 'F2') setDebugVisible(!debugVisible);
});

// ---------- Layout ----------
const layout = () => terminal.resize();
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', layout);
new ResizeObserver(layout).observe(stage);

// Hiding the tab pauses the battle (GDD §11) and stops the loop, so nothing
// happens while the player is away and no catch-up ticks run on return.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    session.pause();
    loop.stop();
    wakeLock = null;
  } else {
    loop.start();
    if (session.screen !== 'TITLE') void keepAwake();
  }
});

// Dev-only handle for console debugging and automated checks.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __glorp: {
      get world() {
        return session.world;
      },
      session,
      input,
      loop,
      sceneRenderer,
      battleView: sceneRenderer,
      terminal,
      perf,
      tuning,
      cheats,
      startBattle: (opts: { battle?: number } = {}) => {
        session.debugJump(opts.battle ?? 1);
        syncWorld();
      },
    },
  });
}

loop.start();
