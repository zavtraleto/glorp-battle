import './ui/styles.css';
import { loadTuningOverrides, secondsToTicks, tuning } from './config/tuning';
import { events } from './core/events';
import { InputState } from './core/input/commands';
import { attachKeyboard, attachSwipe } from './core/input/devices';
import { GameLoop } from './core/loop';
import { randomSeed } from './core/rng';
import { DebugOverlay } from './debug/overlay';
import { DebugPanel } from './debug/debugPanel';
import { parseDebugParams } from './debug/params';
import { t } from './i18n';
import { SceneRenderer } from './render/scene';
import { Mettik } from './sim/enemies/mettik';
import { World, type Cheats } from './sim/world';
import { Banner } from './ui/banner';
import { Controls } from './ui/controls';
import { CustomScreen } from './ui/customScreen';
import { Hud } from './ui/hud';
import { WorldLabels } from './ui/worldLabels';

function byId(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e;
}

loadTuningOverrides();
const params = parseDebugParams(window.location.search);
if (params.timescale !== 1) tuning.sim.TIME_SCALE = params.timescale;

const stage = byId('stage');
const ui = byId('ui');

const cheats: Cheats = { god: params.god, aiEnabled: true };
const folder = params.folder;
let world = new World({ seed: params.seed ?? randomSeed(), battleIndex: params.battle, cheats, folder });

const sceneRenderer = new SceneRenderer(stage);
const hud = new Hud(ui);
const labels = new WorldLabels(ui, sceneRenderer);
const input = new InputState();
const controls = new Controls(ui, input);
const customScreen = new CustomScreen(ui, () => world);
const banner = new Banner(ui);
hud.gauge.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  input.push({ type: 'openCustom' });
});
attachKeyboard(input);
attachSwipe(input);

/** Replaces the current battle. Omitted fields keep their value; `seed: 'random'` rolls a new one. */
function startBattle(opts: { seed?: number | 'random'; battle?: number } = {}): void {
  world = new World({
    seed: opts.seed === 'random' ? randomSeed() : (opts.seed ?? world.seed),
    battleIndex: opts.battle ?? world.battleIndex,
    cheats,
    folder,
  });
  input.clear();
  controls.reset();
  sceneRenderer.reset();
  labels.reset();
  banner.hide();
  panel.syncSeed(world.seed, world.battleIndex);
  events.emit('seedChanged', { seed: world.seed });
  events.emit('debugRestart', {});
}

// TODO(M7): replace with the full RESULT / DEFEAT screens and the battle sequence.
function updateBanner(): void {
  const resultReady = world.stateElapsed >= secondsToTicks(tuning.fx.RESULT_BANNER_DELAY);
  if (world.state === 'BATTLE_START' && world.firstStart) {
    banner.show('battle-start', t('banner.battleStart'), 'info');
  } else if (world.state === 'BATTLE_WON') {
    const buttons = resultReady
      ? [
          { label: t('btn.retry'), onClick: () => startBattle() },
          { label: t('btn.next'), onClick: () => startBattle({ battle: (world.battleIndex % 4) + 1 }) },
        ]
      : [];
    banner.show(`won-${resultReady}`, t('banner.enemyDeleted'), 'win', buttons);
  } else if (world.state === 'PLAYER_DEAD') {
    const buttons = resultReady ? [{ label: t('btn.retry'), onClick: () => startBattle() }] : [];
    banner.show(`dead-${resultReady}`, t('banner.gameOver'), 'lose', buttons);
  } else {
    banner.hide();
  }
}

const loop = new GameLoop(
  { hz: tuning.sim.SIM_HZ, maxFrameTime: tuning.sim.MAX_FRAME_TIME },
  {
    // Commands are handed to the first tick of the frame; later ticks only see the held direction.
    tick: (dt) => {
      world.step(dt, { commands: input.drain(), held: input.heldDir });
      for (const e of world.drainEvents()) {
        sceneRenderer.handleEvent(e, world);
        labels.handleEvent(e, world);
        if (events.logEnabled) console.debug('[sim]', world.tick, e);
      }
    },
    render: (alpha, frameSeconds) => {
      const dt = loop.clock.dt;
      // A frozen simulation must not be extrapolated between ticks.
      const simAlpha = world.simFrozen ? 0 : alpha;
      sceneRenderer.render(world, simAlpha, dt);
      labels.update(world, simAlpha);
      hud.setHp(world.player.hp, world.player.maxHp);
      hud.setGauge(world.gauge.value, world.gauge.full);
      controls.update(world);
      customScreen.update();
      updateBanner();
      const p = world.player;
      const b = p.buster;
      overlay.update(frameSeconds, {
        stats: loop.stats,
        state: world.state,
        seed: world.seed,
        battle: world.battleIndex,
        timeScale: loop.clock.timeScale,
        paused: loop.clock.paused,
        simTime: world.time,
        extra:
          `player ${p.x},${p.y} hp ${p.hp} hits ${p.hitsTaken} ${p.flinched ? 'FLINCH ' : ''}${p.invulnerable ? 'IFR' : ''}\n` +
          `buster cd ${b.cooldownRemaining(world.tick)} chg ${b.chargeLevel(world.tick)} shots ${b.shots}\n` +
          `gauge ${(world.gauge.value * 100).toFixed(0)}%  turn ${world.chips.turns}  add ${world.chips.addStreak}\n` +
          `folder ${world.chips.folderRemaining} hand ${world.chips.hand.filter(Boolean).length}/${world.chips.hand.length}` +
          ` queue ${world.chips.queue.length} used ${world.chips.count('used')}` +
          ` chip ${world.activeChip ? world.activeChip.def.id : '-'}\n` +
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
  getSeed: () => world.seed,
  restart: startBattle,
  setCoordsVisible: (v) => sceneRenderer.field.setCoordsVisible(v),
  setOverlayVisible: (v) => (overlay.visible = v),
  cheats,
  killAll: () => world.killAllEnemies(),
  setPlayerHp: (hp) => {
    world.player.hp = Math.max(0, Math.min(world.player.maxHp, Math.round(hp)));
  },
  fillGauge: () => world.fillGauge(),
  openCustom: () => {
    world.fillGauge();
    input.push({ type: 'openCustom' });
  },
  giveChip: (defId) => {
    // Debug chips get uids outside the folder range and a wildcard code.
    world.giveChip({ uid: debugChipUid++, defId, code: '*', state: 'queued' });
  },
  forceAttack: () => {
    for (const e of world.enemies) if (e instanceof Mettik) e.forceAttack(world.tick);
  },
});
panel.syncSeed(world.seed, world.battleIndex);

function setDebugVisible(v: boolean): void {
  panel.visible = v;
  overlay.visible = v;
}
setDebugVisible(params.debug || import.meta.env.DEV);

// Triple tap in the top-left corner (over the HP box) toggles debug tools on devices without a keyboard.
const hotspot = document.createElement('div');
hotspot.className = 'debug-hotspot';
ui.appendChild(hotspot);
let taps: number[] = [];
hotspot.addEventListener('pointerdown', () => {
  const now = performance.now();
  taps = [...taps.filter((ts) => now - ts < 600), now];
  if (taps.length >= 3) {
    taps = [];
    setDebugVisible(!panel.visible);
  }
});
window.addEventListener('keydown', (e) => {
  if (e.key === '`' || e.key === 'F2') setDebugVisible(!panel.visible);
});

// ---------- Layout ----------
function layout(): void {
  sceneRenderer.setInsets({ top: hud.occupiedTop });
}
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', layout);
new ResizeObserver(layout).observe(stage);
layout();

// Losing visibility must never cause a burst of catch-up ticks (clock also clamps long frames).
document.addEventListener('visibilitychange', () => {
  if (document.hidden) loop.stop();
  else loop.start();
});

// Dev-only handle for console debugging and automated checks.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __glorp: {
      get world() {
        return world;
      },
      input,
      loop,
      sceneRenderer,
      tuning,
      cheats,
      startBattle,
    },
  });
}

loop.start();
