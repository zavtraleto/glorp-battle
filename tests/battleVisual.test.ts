import * as THREE from 'three';
import { DEFAULT_TUNING, mergeTuning, tuning } from '../src/config/tuning';
import { describe, expect, it } from 'vitest';
import { battleSignal, NO_SIGNAL } from '../src/render/battleSignals';
import { cellKey, cellStates, type CellInputs } from '../src/render/cellStates';
import {
  dimSignal,
  paletteColor,
  paletteIndex,
  signal,
  PALETTE,
  PALETTE_COLORS,
  ROLE_INDEX,
  type Role,
} from '../src/render/palette';
import { fitView } from '../src/render/viewCamera';
import { SceneRenderer } from '../src/render/scene';
import { spritePixels } from '../src/render/pixelSprite';
import { cursorGlide, cursorSettle, enemyLook } from '../src/render/telegraphLook';
import * as spriteArtModule from '../src/render/spriteArt';
import { toneForCrt } from '../src/render/spriteArt';
import { PLAYER_ROWS, playerBitmap } from '../src/render/playerSprite';
import type { Panel } from '../src/sim/field';
import { sideOfRow, type Side } from '../src/sim/grid';

describe('palette', () => {
  // The material writes an index, not a role-per-channel (spec §6.1).
  it('reads back every palette index and colour at full brightness', () => {
    for (const [role, index] of Object.entries(ROLE_INDEX)) {
      const c = signal(role as Role, 1);
      expect(paletteIndex(c.r, c.g)).toBe(index);
      expect(paletteColor(c.r, c.g).getHex()).toBe(new THREE.Color(PALETTE_COLORS[index]).getHex());
    }
  });

  it('has six palette entries, background first', () => {
    expect(PALETTE_COLORS).toHaveLength(6);
    expect(PALETTE_COLORS[0]).toBe(PALETTE.bg);
    expect(new Set(Object.values(ROLE_INDEX)).size).toBe(5);
  });

  it('reads zero brightness as background whatever the index', () => {
    const bg = new THREE.Color(PALETTE.bg).getHex();
    for (const index of Object.values(ROLE_INDEX)) {
      expect(paletteIndex(index / 255, 0)).toBe(0);
      expect(paletteColor(index / 255, 0).getHex()).toBe(bg);
    }
  });

  // No dithering (2026-09-19): a faint line is a solid, dimmer line.
  it('draws partial brightness as a dimmer solid colour, not a pattern', () => {
    const c = signal('phosphor', 0.5);
    const half = paletteColor(c.r, c.g);
    const full = new THREE.Color(PALETTE.phosphor);
    const bg = new THREE.Color(PALETTE.bg);
    expect(half.g).toBeCloseTo((full.g + bg.g) / 2, 5);
    expect(half.g).toBeLessThan(full.g);
  });

  // Scaling the whole colour would scale the index too and repaint the pixel.
  it('dims a signal without touching its index', () => {
    const half = dimSignal(signal('purple', 1), 0.5);
    expect(half.r).toBe(ROLE_INDEX.purple / 255);
    expect(half.g).toBeCloseTo(0.5, 6);
    expect(paletteIndex(half.r, half.g)).toBe(ROLE_INDEX.purple);
  });

  it('clamps a dimmed signal to the unit range', () => {
    expect(dimSignal(signal('red', 1), 4).g).toBe(1);
    expect(dimSignal(signal('red', 1), -1).g).toBe(0);
  });

  it('builds signal colours as index and brightness', () => {
    expect(signal('red', 0.5).toArray()).toEqual([ROLE_INDEX.red / 255, 0.5, 0]);
    expect(signal('purple', 2).toArray()).toEqual([ROLE_INDEX.purple / 255, 1, 0]);
    expect(signal('blue', 0).toArray()).toEqual([ROLE_INDEX.blue / 255, 0, 0]);
  });
});

function inputs(over: Partial<CellInputs> = {}): CellInputs {
  return {
    cols: 3,
    rows: 6,
    tick: 100,
    player: { x: 1, y: 4 },
    enemies: [],
    danger: [],
    attacks: new Map(),
    spawns: new Map(),
    overrides: new Map(),
    attackTicks: 9,
    afterTicks: 12,
    spawnTicks: 36,
    panels: Array.from({ length: 18 }, (_, i) => ({ panel: 'NORMAL' as Panel, owner: sideOfRow(Math.floor(i / 3)) as Side, armed: false })),
    objects: [],
    ...over,
  };
}

describe('cellStates', () => {
  const k = (x: number, y: number) => cellKey(x, y, 3);

  it('marks the player cell ACTIVE and the rest NORMAL', () => {
    const s = cellStates(inputs());
    expect(s[k(1, 4)]!.state).toBe('ACTIVE');
    expect(s.filter((c) => c.state === 'NORMAL')).toHaveLength(17);
  });

  it('shows a persistent ARM mark on an otherwise normal cell', () => {
    const panels = inputs().panels.map((panel) => ({ ...panel }));
    panels[k(1, 2)] = { ...panels[k(1, 2)]!, armed: true };
    expect(cellStates(inputs({ panels }))[k(1, 2)]!.state).toBe('ARM');
  });

  it('marks living enemy cells ACTIVE like the player cell', () => {
    const s = cellStates(inputs({ enemies: [{ x: 0, y: 1 }, { x: 2, y: 2 }] }));
    expect(s[k(0, 1)]!.state).toBe('ACTIVE');
    expect(s[k(2, 2)]!.state).toBe('ACTIVE');
    expect(s[k(1, 4)]!.state).toBe('ACTIVE');
  });

  it('shows telegraphs, attacks and their afterglow', () => {
    const s = cellStates(
      inputs({
        danger: [{ x: 0, y: 3 }],
        attacks: new Map([
          [k(1, 1), { tick: 95, tone: 'accent' }],
          [k(2, 1), { tick: 85, tone: 'red' }],
          [k(0, 0), { tick: 50, tone: 'red' }],
        ]),
      }),
    );
    expect(s[k(0, 3)]!.state).toBe('DANGER');
    expect(s[k(1, 1)]).toEqual({ state: 'ATTACK', tone: 'accent', age: 5, owner: 'enemy', cracked: false });
    expect(s[k(2, 1)]).toEqual({ state: 'AFTER', tone: 'red', age: 6, owner: 'enemy', cracked: false });
    expect(s[k(0, 0)]!.state).toBe('NORMAL');
  });

  it('reads panels, owners and objects from the simulation', () => {
    const base = inputs();
    const panels = base.panels.map((p) => ({ ...p }));
    panels[k(0, 3)] = { panel: 'BROKEN', owner: 'player' };
    panels[k(2, 3)] = { panel: 'CRACKED', owner: 'player' };
    panels[k(1, 2)] = { panel: 'NORMAL', owner: 'player' };
    const s = cellStates({ ...base, panels, objects: [{ x: 2, y: 5 }] });
    expect(s[k(0, 3)]!.state).toBe('BROKEN');
    expect(s[k(2, 3)]).toMatchObject({ state: 'NORMAL', cracked: true });
    expect(s[k(1, 2)]!.owner).toBe('player');
    expect(s[k(1, 1)]!.owner).toBe('enemy');
    expect(s[k(2, 5)]!.state).toBe('OBJECT');
  });

  it('applies the priority order', () => {
    const s = cellStates(
      inputs({
        danger: [{ x: 1, y: 4 }, { x: 2, y: 2 }],
        attacks: new Map([[k(2, 2), { tick: 99, tone: 'red' }]]),
        spawns: new Map([[k(0, 0), 10]]),
        overrides: new Map([
          [k(0, 5), 'EMPTY'],
          [k(2, 2), 'BROKEN'],
          [k(1, 3), 'OBJECT'],
        ]),
      }),
    );
    expect(s[k(1, 4)]!.state).toBe('DANGER'); // danger beats the player highlight
    expect(s[k(2, 2)]!.state).toBe('BROKEN'); // debug break beats an attack
    expect(s[k(0, 5)]!.state).toBe('EMPTY');
    expect(s[k(0, 0)]).toMatchObject({ state: 'SPAWN', tone: null, age: 10 });
    expect(s[k(1, 3)]!.state).toBe('OBJECT');
  });

  it('ends spawn markers after their time and ignores future ones', () => {
    expect(cellStates(inputs({ spawns: new Map([[0, 40]]) }))[0]!.state).toBe('NORMAL');
    expect(cellStates(inputs({ spawns: new Map([[0, -1]]) }))[0]!.state).toBe('NORMAL');
  });
});

describe('fitView', () => {
  const box = new THREE.Box3(new THREE.Vector3(-1.6, 0, -2.4), new THREE.Vector3(1.6, 1.1, 2.4));
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));

  for (const pitch of [20, 28, 45]) {
    it(`fits and centres the field at ${pitch}°`, () => {
      const cam = new THREE.PerspectiveCamera();
      fitView(cam, corners, { pitchDeg: pitch, fovDeg: 40, aspect: 0.75, fill: 0.92, offsetY: 0 });
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const c of corners) {
        const p = c.clone().project(cam);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      expect(Math.max(-minX, maxX, -minY, maxY)).toBeLessThanOrEqual(0.93);
      expect(Math.max(maxX - minX, maxY - minY) / 2).toBeGreaterThan(0.85);
      expect(Math.abs(minX + maxX)).toBeLessThan(0.05);
      expect(Math.abs(minY + maxY)).toBeLessThan(0.05);
      // Looking into the field: the near edge (+z) is lower on screen than the far edge.
      const near = new THREE.Vector3(0, 0, 2.4).project(cam);
      const far = new THREE.Vector3(0, 0, -2.4).project(cam);
      expect(near.y).toBeLessThan(far.y);
      // Perspective: the near row is wider than the far row.
      const nearW = new THREE.Vector3(1.6, 0, 2.4).project(cam).x - new THREE.Vector3(-1.6, 0, 2.4).project(cam).x;
      const farW = new THREE.Vector3(1.6, 0, -2.4).project(cam).x - new THREE.Vector3(-1.6, 0, -2.4).project(cam).x;
      expect(nearW).toBeGreaterThan(farW * 1.3);
    });
  }

  // The HUD band lives across the top of the picture, so the field is pushed
  // down by half the band instead of sitting dead centre (spec §8).
  it('drops the field below the HUD band', () => {
    const cam = new THREE.PerspectiveCamera();
    fitView(cam, corners, { pitchDeg: 28, fovDeg: 40, aspect: 0.727, fill: 0.86, offsetY: -0.11 });
    let minY = Infinity;
    let maxY = -Infinity;
    for (const c of corners) {
      const p = c.clone().project(cam);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    expect((minY + maxY) / 2).toBeCloseTo(-0.11, 2);
    expect(maxY).toBeLessThan(0.86);
  });

  it('centres the field when no offset is asked for', () => {
    const cam = new THREE.PerspectiveCamera();
    fitView(cam, corners, { pitchDeg: 28, fovDeg: 40, aspect: 0.727, fill: 0.86, offsetY: 0 });
    let minY = Infinity;
    let maxY = -Infinity;
    for (const c of corners) {
      const p = c.clone().project(cam);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    expect((minY + maxY) / 2).toBeCloseTo(0, 2);
  });

  it('allows an oversized field to be moved freely in the frame', () => {
    const cam = new THREE.PerspectiveCamera();
    fitView(cam, corners, {
      pitchDeg: 28,
      fovDeg: 40,
      aspect: 0.727,
      fill: 1.08,
      offsetX: 0.14,
      offsetY: -0.18,
    });
    const projected = corners.map((corner) => corner.clone().project(cam));
    const minX = Math.min(...projected.map((point) => point.x));
    const maxX = Math.max(...projected.map((point) => point.x));
    const minY = Math.min(...projected.map((point) => point.y));
    const maxY = Math.max(...projected.map((point) => point.y));
    expect((minX + maxX) / 2).toBeCloseTo(0.14, 2);
    expect((minY + maxY) / 2).toBeCloseTo(-0.18, 2);
    expect(Math.max(maxX - minX, maxY - minY) / 2).toBeGreaterThan(1);
  });
});

describe('actor screen anchors', () => {
  it('anchors HP to the visible top of a padded hologram sprite', () => {
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    const sprite = new THREE.Sprite();
    sprite.scale.set(1, 2, 1);
    sprite.center.set(0.5, 0.14);
    const fake = {
      camera,
      playerView: { sprite: new THREE.Sprite() },
      enemyViews: new Map([[2, { sprite }]]),
      projectToTarget: SceneRenderer.prototype.projectToTarget,
    } as unknown as SceneRenderer;

    const actual = SceneRenderer.prototype.actorTopTargetPos.call(fake, 2)!;
    const visibleTop = new THREE.Vector3(0, 1.44, 0).project(camera);
    expect(actual.y).toBeCloseTo((1 - visibleTop.y) / 2, 6);
  });
});

describe('enemy sprite art', () => {
  it('uses shipped art for current enemies and one placeholder for unknown kinds', () => {
    const enemyArtId = (spriteArtModule as unknown as {
      enemyArtId?: (kind: string) => string;
    }).enemyArtId;

    expect(enemyArtId).toBeTypeOf('function');
    expect(['mettik', 'canodron', 'hopzap', 'bladdy', 'punchy'].map((kind) => enemyArtId?.(kind))).toEqual([
      'mettik',
      'canodron',
      'hopzap',
      'bladdy',
      'punchy',
    ]);
    expect(enemyArtId?.('future-enemy')).toBe('placeholder');
  });
});

describe('player sprite and texel scale', () => {
  // Bigger bitmaps for the higher CRT resolution (spec §7).
  it('draws the player as a 36×48 bitmap with feet on the bottom row', () => {
    for (const row of PLAYER_ROWS) expect(row).toMatch(/^[.ov]{36}$/);
    const b = playerBitmap();
    expect([b.w, b.h]).toEqual([36, 48]);
    const bottom = Array.from(b.px.slice((b.h - 1) * b.w));
    expect(bottom.some((p) => p === 1)).toBe(true);
    expect(Array.from(b.px).some((p) => p === 2)).toBe(true);
  });

  // Continuous perspective scaling (2026-09-19): no jumps between rows.
  it('sizes a sprite in proportion to its distance, keeping its aspect', () => {
    const near = spritePixels(1, 100, 128, 160);
    const far = spritePixels(1, 60, 128, 160);
    expect(near).toEqual({ w: 100, h: 125 });
    expect(far).toEqual({ w: 60, h: 75 });
    const steps = [60, 61, 62, 63].map((p) => spritePixels(1, p, 36, 48).w);
    expect(steps).toEqual([60, 61, 62, 63]);
    expect(spritePixels(1, 0.1, 36, 48).w).toBe(1);
  });

  it('tones art down for the CRT: less saturated, a little darker, grey stays grey', () => {
    const [r, g, b] = toneForCrt(255, 40, 40);
    expect(r).toBeLessThan(255);
    expect(g).toBeGreaterThan(40);
    expect(b).toBe(g);
    const grey = toneForCrt(200, 200, 200);
    expect(grey[0]).toBe(grey[1]);
    expect(grey[0]).toBeLessThan(200);
  });
});

describe('battle signals', () => {
  const base = { firstStart: true, player: { x: 1, y: 4 }, introTicks: 48, startTicks: 60, wonTicks: 72, deadTicks: 60 };

  it('draws the grid in from the player edge during the intro', () => {
    const early = battleSignal({ ...base, state: 'BATTLE_INTRO', elapsed: 8 });
    expect(early.reveal(5)).toBeGreaterThan(0);
    expect(early.reveal(0)).toBe(0);
    const done = battleSignal({ ...base, state: 'BATTLE_INTRO', elapsed: 48 });
    for (let y = 0; y < 6; y++) expect(done.reveal(y)).toBe(1);
  });

  it('blinks the enemy side on a win', () => {
    const s = battleSignal({ ...base, state: 'BATTLE_WON', elapsed: 0 });
    expect(s.flash(0, 1)).toBe(1);
    expect(battleSignal({ ...base, state: 'BATTLE_WON', elapsed: 4 }).flash(0, 1)).toBe(0);
  });

  it('breaks the grid outward from the player and fades it in red on defeat', () => {
    const s = battleSignal({ ...base, state: 'PLAYER_DEAD', elapsed: 6 });
    expect(s.red).toBe(true);
    expect(s.broken(1, 4)).toBe(true);
    expect(s.broken(0, 0)).toBe(false);
    const end = battleSignal({ ...base, state: 'PLAYER_DEAD', elapsed: 60 });
    expect(end.broken(0, 0)).toBe(true);
    expect(end.reveal(0)).toBe(0);
  });

  it('shows nothing special in battle', () => {
    expect(battleSignal({ ...base, state: 'ACTION', elapsed: 0 })).toBe(NO_SIGNAL);
  });

  it('keeps the field steady between waves: only the enemies materialize', () => {
    expect(battleSignal({ ...base, state: 'WAVE_INTRO', elapsed: 10 })).toBe(NO_SIGNAL);
  });
});

describe('telegraph look (GDD §8.1)', () => {
  it('winds up in red, opens the counter window in yellow, dims in recovery', () => {
    const times = Array.from({ length: 40 }, (_, i) => i / 97);
    const windup = times.map((s) => enemyLook('LOCK', s));
    expect(windup.every((l) => l.lift === 2 && !l.flash && l.tint !== 'accent')).toBe(true);
    expect(windup.some((l) => l.tint === 'red')).toBe(true);
    expect(windup.some((l) => l.tint === null)).toBe(true);

    const counter = times.map((s) => enemyLook('COUNTER', s));
    expect(counter.every((l) => l.tint === 'accent' && l.tintAmount > 0)).toBe(true);
    expect(new Set(counter.map((l) => l.tintAmount)).size).toBe(2);

    expect(enemyLook('STRIKE', 0)).toMatchObject({ flash: true, tint: null });
    expect(enemyLook('RECOVERY', 0).brightness).toBeLessThan(1);
    expect(enemyLook('IDLE', 0)).toEqual({ lift: 0, flash: false, tint: null, tintAmount: 0, brightness: 1 });
  });
});

describe('Canodron cursor glide', () => {
  it('flies into its new cell within the step', () => {
    const c = { x: 1, y: 3, locked: false, stepTick: 100, stepTicks: 15 };
    expect(cursorGlide(c, 100)).toBe(0);
    const mid = cursorGlide(c, 104);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(cursorGlide(c, 100 + 15)).toBe(1);
  });

  it('homes in on the target only after the glide, over CURSOR_SETTLE_TIME', () => {
    mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING)));
    tuning.battleVisual.CURSOR_SETTLE_TIME = 0.3;
    const c = { x: 1, y: 3, locked: false, stepTick: 100, stepTicks: 15 };
    const glideEnd = 100 + 15 * 0.6;
    expect(cursorSettle(c, glideEnd)).toBe(0);
    const half = cursorSettle(c, glideEnd + 9);
    expect(half).toBeGreaterThan(0.3);
    expect(half).toBeLessThan(0.7);
    expect(cursorSettle({ ...c, locked: true }, glideEnd + 18)).toBe(1);
  });
});
