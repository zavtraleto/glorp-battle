import './ui/styles.css';
import * as THREE from 'three';
import { Session } from './app/session';
import { loadTuningOverrides, tuning } from './config/tuning';
import { events } from './core/events';
import { InputState } from './core/input/commands';
import { attachKeyboard, attachSwipe, blockBrowserGestures, trapBackNavigation } from './core/input/devices';
import { GameLoop } from './core/loop';
import { randomSeed } from './core/rng';
import { BenchAutopilot, formatBench } from './debug/bench';
import { DebugOverlay } from './debug/overlay';
import { DebugPanel } from './debug/debugPanel';
import { parseDebugParams } from './debug/params';
import { PerfProbe } from './debug/perfProbe';
import { t } from './i18n';
import { SceneRenderer } from './render/scene';
import type { Cheats } from './sim/world';
import { bannerFor } from './terminal/crt/hudModel';
import { Terminal } from './terminal/terminal';
import { Banner } from './ui/banner';
import { Controls } from './ui/controls';
import { CustomScreen } from './ui/customScreen';
import { Hud } from './ui/hud';
import { Screens } from './ui/screens';
import { WorldLabels } from './ui/worldLabels';

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
// The physical terminal is the default UI; ?ui=css keeps the legacy HTML UI until T2.
const terminalMode = params.ui === 'terminal';
document.getElementById('app')?.classList.toggle('ui-terminal', terminalMode);

const stage = byId('stage');
const ui = byId('ui');

const cheats: Cheats = { god: params.god, aiEnabled: true };
const session = new Session({ seed: params.seed ?? randomSeed(), cheats, folder: params.folder });
// ?battle=N skips the title and jumps straight into that battle (debug).
if (query.has('battle')) session.debugJump(params.battle);

// ?bench=1: autopilot on battle 1 for the frame budget check (TERMINAL.md §10).
const perf = new PerfProbe();
const bench = params.bench ? new BenchAutopilot(params.seed ?? 1) : null;
let benchReport = '';
if (bench) {
  cheats.god = true;
  session.debugJump(1);
}

const renderer = new THREE.WebGLRenderer({ antialias: !terminalMode, powerPreference: 'high-performance' });
const sceneRenderer = new SceneRenderer(terminalMode ? { renderer } : { renderer, container: stage });
const hud = new Hud(ui);
const labels = new WorldLabels(ui, sceneRenderer);
const input = new InputState();
const controls = new Controls(ui, input);
const customScreen = new CustomScreen(ui, () => session.world);
const banner = new Banner(ui);
attachKeyboard(input);
if (!terminalMode) attachSwipe(input);
blockBrowserGestures();
// A back gesture / button pauses the battle instead of leaving the game.
trapBackNavigation(() => session.pause());

// ---------- Screen wake lock (GDD §12.1) ----------
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

// ---------- Session actions ----------
function afterWorldChange(): void {
  input.clear();
  sceneRenderer.reset();
  terminal?.resetWorld();
  labels.reset();
  banner.hide();
  panel.syncSeed(session.seed, session.battleIndex);
  events.emit('seedChanged', { seed: session.world.seed });
}

let seenWorldVersion = session.worldVersion;
function syncWorld(): void {
  if (seenWorldVersion === session.worldVersion) return;
  seenWorldVersion = session.worldVersion;
  afterWorldChange();
}

const screens = new Screens(ui, {
  start: () => {
    session.start();
    void keepAwake();
  },
  resume: () => session.resume(),
  retry: () => session.retry(),
  restart: () => session.start(),
  next: () => session.next(),
});

function togglePause(): void {
  if (session.screen === 'PAUSED') session.resume();
  else session.pause();
}
hud.pauseButton.addEventListener('click', togglePause);

const terminal = terminalMode
  ? new Terminal({
      renderer,
      container: stage,
      session,
      sceneRenderer,
      perf,
      handlers: {
        move: (dir) => input.push({ type: 'move', dir }),
        menu: (action) => {
          if (action === 'start' || action === 'restart') {
            session.start();
            void keepAwake();
          } else if (action === 'resume') session.resume();
          else if (action === 'retry') session.retry();
          else session.next();
        },
        execute: () => input.push({ type: 'useChip' }),
        chipSelect: () => input.push({ type: 'openCustom' }),
        pause: () => {
          if (session.screen === 'BATTLE' || session.screen === 'PAUSED') togglePause();
        },
      },
    })
  : null;
terminal?.setHitZonesVisible(params.hitzones);

/** Keeps the bench battle running: confirms Custom Screens and restarts finished battles. */
function driveBench(frameSeconds: number): void {
  if (!bench || bench.done) return;
  const w = session.world;
  if (session.screen === 'RESULT' || session.screen === 'DEFEAT') {
    session.debugJump(1);
    return;
  }
  if (w.state === 'CUSTOM') {
    for (let i = 0; i < w.chips.hand.length; i++) w.customSelect(i);
    w.customConfirm();
  }
  if (w.gauge.full) input.push({ type: 'openCustom' });
  for (const c of bench.frame(frameSeconds)) input.push(c);
  if (bench.done) {
    benchReport = formatBench({ seconds: bench.duration, snapshot: perf.snapshot() });
    console.info(benchReport);
    setDebugVisible(true);
  }
}
hud.gauge.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  input.push({ type: 'openCustom' });
});

// Capture phase: menus take Enter/Space before the chip key does; Esc toggles pause.
window.addEventListener(
  'keydown',
  (e) => {
    if (!terminalMode && screens.handleKey(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    } else if (e.code === 'Escape' && !e.repeat && (session.screen === 'BATTLE' || session.screen === 'PAUSED')) {
      togglePause();
      e.preventDefault();
    }
  },
  { capture: true },
);

function updateBanner(): void {
  const b = bannerFor(session, session.world);
  if (b) banner.show(b.key, b.text, b.tone);
  else banner.hide();
}

const loop = new GameLoop(
  { hz: tuning.sim.SIM_HZ, maxFrameTime: tuning.sim.MAX_FRAME_TIME },
  {
    // Commands are handed to the first tick of the frame; later ticks only see the held direction.
    tick: (dt) => {
      const world = session.world;
      world.step(dt, { commands: input.drain(), held: input.heldDir });
      for (const e of world.drainEvents()) {
        sceneRenderer.handleEvent(e, world);
        terminal?.onEvent(e);
        labels.handleEvent(e, world);
        if (events.logEnabled) console.debug('[sim]', world.tick, e);
      }
      session.update();
    },
    render: (alpha, frameSeconds) => {
      syncWorld();
      const world = session.world;
      const dt = loop.clock.dt;
      // A frozen simulation must not be extrapolated between ticks.
      const simAlpha = world.simFrozen ? 0 : alpha;
      driveBench(frameSeconds);
      if (terminal) terminal.render(world, simAlpha, dt);
      else {
        sceneRenderer.render(world, simAlpha, dt);
        labels.update(world, simAlpha);
      }
      // frameMs is the previous frame's tick + render time (written after this callback).
      perf.record(frameSeconds * 1000, loop.stats.frameMs);
      hud.setHp(world.player.hp, world.player.maxHp);
      hud.setGauge(world.gauge.value, world.gauge.full);
      controls.update(world);
      customScreen.update();
      updateBanner();
      screens.update(session);
      const p = world.player;
      overlay.update(frameSeconds, {
        stats: loop.stats,
        state: `${session.screen}/${world.state}`,
        seed: session.seed,
        battle: session.battleIndex,
        timeScale: loop.clock.timeScale,
        paused: loop.clock.paused,
        simTime: world.time,
        perf: terminal && overlay.visible ? perf.snapshot() : undefined,
        extra:
          (benchReport ? `${benchReport}
` : '') +
          `player ${p.x},${p.y} hp ${p.hp} hits ${p.hitsTaken} ${p.flinched ? 'FLINCH ' : ''}${p.invulnerable ? 'IFR' : ''}\n` +
          `gauge ${(world.gauge.value * 100).toFixed(0)}%  turn ${world.chips.turns}  add ${world.chips.addStreak}\n` +
          `folder ${world.chips.folderRemaining} hand ${world.chips.hand.filter(Boolean).length}/${world.chips.hand.length}` +
          ` queue ${world.chips.queue.length} used ${world.chips.count('used')}` +
          ` chip ${world.activeChip ? world.activeChip.def.id : '-'}\n` +
          `attempt ${session.attempt}  hpStart ${session.hpAtBattleStart}\n` +
          world.enemies.map((e) => `${e.kind}#${e.id} ${e.x},${e.y} hp ${e.hp} ${e.state}`).join('\n') +
          `\nattacks ${world.attacks.length}${cheats.god ? '  GOD' : ''}${cheats.aiEnabled ? '' : '  AI OFF'}`,
      });
    },
  },
);
loop.clock.timeScale = tuning.sim.TIME_SCALE;

// ---------- Debug tools ----------
const overlay = new DebugOverlay(ui);
let debugChipUid = 10_000;
const panel = new DebugPanel(loop.clock, {
  getSeed: () => session.seed,
  restart: ({ seed, battle }) => {
    session.debugJump(battle ?? session.battleIndex, seed === 'random' ? randomSeed() : seed);
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
  fillGauge: () => session.world.fillGauge(),
  openCustom: () => {
    session.world.fillGauge();
    input.push({ type: 'openCustom' });
  },
  giveChip: (defId) => {
    // Debug chips get uids outside the folder range and a wildcard code.
    session.world.giveChip({ uid: debugChipUid++, defId, code: '*', state: 'queued' });
  },
  forceAttack: () => {
    const w = session.world;
    for (const e of w.enemies) e.forceAttack(w.tick);
  },
});
panel.syncSeed(session.seed, session.battleIndex);

// Small toggle in the bottom-left corner: debug tools on phones and in the published build.
const debugToggle = document.createElement('button');
debugToggle.className = 'debug-toggle interactive';
debugToggle.textContent = t('btn.debug');
ui.appendChild(debugToggle);
debugToggle.addEventListener('click', () => setDebugVisible(!panel.visible));

function setDebugVisible(v: boolean): void {
  panel.visible = v;
  overlay.visible = v;
  debugToggle.classList.toggle('on', v);
}
setDebugVisible(params.debug || import.meta.env.DEV);
window.addEventListener('keydown', (e) => {
  if (e.key === '`' || e.key === 'F2') setDebugVisible(!panel.visible);
});

// ---------- Layout ----------
function layout(): void {
  if (terminal) terminal.resize();
  else sceneRenderer.setInsets({ top: hud.occupiedTop });
}
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', layout);
new ResizeObserver(layout).observe(stage);
layout();

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
      terminal,
      perf,
      tuning,
      cheats,
      startBattle: (opts: { battle?: number } = {}) => {
        session.debugJump(opts.battle ?? session.battleIndex);
        syncWorld();
      },
    },
  });
}

loop.start();
