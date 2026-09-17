import * as THREE from 'three';
import { t } from '../../i18n';
import type { CrtMaterial } from '../crt/crtMaterial';
import { rectToWorld, type Rect, type TerminalLayout } from '../layout';
import type { LampStates } from '../terminalMode';
import { counterTexture, drawCounter, labelTexture, plasticTexture } from '../textures/procedural';

// Terminal housing (TERMINAL.md §3, §7.3): body, top bar with HP LEDs, CRT
// bezel and glass, status lamps, engineering labels and the chip counter.

const HP_LEDS = 10;
/** Left edge and column width of the lamp grid, shares of the body width. */
const LAMP_GRID_X = 0.6;
const LAMP_COL_W = 0.12;
/** World units per plastic texture repeat. */
const TEXTURE_TILE = 3;
/** Control labels sit this share of the deck height below its centre. */
const CONTROL_LABEL_Y = 0.36;

const COLOR = {
  body: 0x6a675f,
  bezel: 0x0c0c0e,
  label: '#d8cfae',
  title: '#e8c872',
  counter: '#ffb347',
  counterBack: '#140c06',
  ledOn: new THREE.Color(0x55ff66),
  ledOff: new THREE.Color(0x1a241a),
  lampOff: new THREE.Color(0x1b1b1b),
};

const LAMPS = [
  { key: 'power', label: 'term.power', color: new THREE.Color(0xffb347) },
  { key: 'sync', label: 'term.sync', color: new THREE.Color(0x6fd3ff) },
  { key: 'link', label: 'term.link', color: new THREE.Color(0x55ff66) },
  { key: 'battle', label: 'term.battle', color: new THREE.Color(0xff5a5a) },
] as const;

export class Housing {
  readonly group = new THREE.Group();
  /** Labels under the deck controls; they slide away with the deck. */
  readonly controlLabels = new THREE.Group();
  private readonly glass: THREE.Mesh;
  private readonly bodyTexture = plasticTexture(1, COLOR.body);
  private readonly bodyMat = new THREE.MeshLambertMaterial({ map: this.bodyTexture });
  private readonly bezelMat = new THREE.MeshLambertMaterial({ color: COLOR.bezel, flatShading: true });
  private readonly ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
  private hpLeds: THREE.InstancedMesh | null = null;
  private lamps: { key: keyof LampStates; mat: THREE.MeshBasicMaterial; color: THREE.Color }[] = [];
  private readonly counter = counterTexture(24, 11);
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpP = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3();
  private readonly noRot = new THREE.Quaternion();
  private readonly owned: { dispose(): void }[] = [];

  constructor(crt: CrtMaterial) {
    this.glass = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), crt);
  }

  /** (Re)creates the housing; `texel` is the world size of one render pixel. */
  build(layout: TerminalLayout, texel: number, crtAspect: number): void {
    this.clear();
    const W = (r: Rect) => rectToWorld(layout, r);

    // Body.
    const body = W(layout.body);
    this.bodyTexture.repeat.set(body.w / TEXTURE_TILE, body.h / TEXTURE_TILE);
    this.addBox(body.cx, body.cy, -0.3, body.w, body.h, 0.6, this.bodyMat);

    // Top bar: model name, subtitle, HP LEDs.
    const top = W(layout.top);
    const left = body.cx - body.w / 2;
    const titleY = top.cy + top.h * 0.18;
    const title = this.addLabel(t('term.model'), COLOR.title, 2, texel, 0, titleY);
    const titleX = left + body.w * 0.06 + title.w / 2;
    title.mesh.position.x = titleX;
    const sub = this.addLabel(t('term.subtitle'), COLOR.label, 1, texel, 0, titleY - texel * 3);
    sub.mesh.position.x = titleX + title.w / 2 + texel * 6 + sub.w / 2;

    const ledY = top.cy - top.h * 0.25;
    const ledStep = (body.w * 0.5) / HP_LEDS;
    const ledX0 = left + body.w * 0.06;
    const im = new THREE.InstancedMesh(this.unitBox, this.ledMat, HP_LEDS);
    for (let i = 0; i < HP_LEDS; i++) {
      this.tmpP.set(ledX0 + ledStep * (i + 0.5), ledY, 0.05);
      this.tmpS.set(ledStep * 0.55, Math.min(top.h * 0.22, ledStep * 0.45), 0.1);
      im.setMatrixAt(i, this.tmpM.compose(this.tmpP, this.noRot, this.tmpS));
      im.setColorAt(i, COLOR.ledOff);
    }
    this.group.add(im);
    this.hpLeds = im;

    // CRT bezel and glass (the glass keeps the render target's aspect).
    const crt = W(layout.crt);
    this.addBox(crt.cx, crt.cy, 0.05, crt.w * 1.02, crt.h * 0.98, 0.3, this.bezelMat);
    const glassH = crt.h * 0.9;
    const glassW = Math.min(crt.w * 0.94, glassH * crtAspect);
    this.glass.scale.set(glassW, glassH, 1);
    this.glass.position.set(crt.cx, crt.cy, 0.21);
    this.group.add(this.glass);

    // Status lamps: a 2×2 grid on the top bar, lamp left of its label.
    const lampSize = texel * 5;
    const gridX = left + body.w * LAMP_GRID_X;
    const colW = body.w * LAMP_COL_W;
    const rowH = top.h * 0.36;
    this.lamps = LAMPS.map((l, i) => {
      const x = gridX + (i % 2) * colW;
      const ly = top.cy + rowH / 2 - Math.floor(i / 2) * rowH;
      const mat = new THREE.MeshBasicMaterial({ color: COLOR.lampOff });
      this.owned.push(mat);
      this.addBox(x + lampSize / 2, ly, 0.05, lampSize, lampSize, 0.1, mat);
      const label = this.addLabel(t(l.label), COLOR.label, 1, texel, 0, ly);
      label.mesh.position.x = x + lampSize + texel * 3 + label.w / 2;
      return { key: l.key, mat, color: l.color };
    });

    // Chip counter right of the rail.
    const rail = W(layout.rail);
    const counterCx = rail.cx + rail.w * 0.415;
    this.addLabel(t('term.chipSlot'), COLOR.label, 1, texel, counterCx, rail.cy + texel * 8);
    const cw = this.counter.canvas.width * texel * 1.5;
    const ch = this.counter.canvas.height * texel * 1.5;
    const counterMat = new THREE.MeshBasicMaterial({ map: this.counter.texture });
    const counterGeo = new THREE.PlaneGeometry(cw, ch);
    this.owned.push(counterMat, counterGeo);
    const counterMesh = new THREE.Mesh(counterGeo, counterMat);
    counterMesh.position.set(counterCx, rail.cy - texel * 6, 0.02);
    this.group.add(counterMesh);

    // Control labels under the controls (clear of the DBG button in the corner).
    const deck = W(layout.deck);
    const labelY = deck.cy - deck.h * CONTROL_LABEL_Y;
    for (const [zone, key] of [
      ['chipSelect', 'term.chipSelect'],
      ['trackball', 'term.navigation'],
      ['execute', 'term.execute'],
    ] as const) {
      this.addLabel(t(key), COLOR.label, 1, texel, W(layout.zones[zone]).cx, labelY, this.controlLabels);
    }
  }

  setHpLeds(lit: number): void {
    const im = this.hpLeds;
    if (!im) return;
    for (let i = 0; i < HP_LEDS; i++) im.setColorAt(i, i < lit ? COLOR.ledOn : COLOR.ledOff);
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }

  setLamps(l: LampStates): void {
    for (const lamp of this.lamps) lamp.mat.color.copy(l[lamp.key] ? lamp.color : COLOR.lampOff);
  }

  setChipCount(n: number, total: number): void {
    drawCounter(this.counter.canvas, `${n}/${total}`, COLOR.counter, COLOR.counterBack);
    this.counter.texture.needsUpdate = true;
  }

  private addBox(x: number, y: number, z: number, w: number, h: number, d: number, m: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(this.unitBox, m);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    this.group.add(mesh);
    return mesh;
  }

  private addLabel(
    text: string,
    color: string,
    scale: number,
    texel: number,
    x: number,
    y: number,
    parent: THREE.Group = this.group,
  ): { mesh: THREE.Mesh; w: number } {
    const label = labelTexture(text, color, scale);
    const w = label.width * texel;
    const mat = new THREE.MeshBasicMaterial({ map: label.texture, transparent: true, depthWrite: false });
    const geo = new THREE.PlaneGeometry(w, label.height * texel);
    this.owned.push(label.texture, mat, geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, 0.01);
    parent.add(mesh);
    return { mesh, w };
  }

  private clear(): void {
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
    this.group.clear();
    this.controlLabels.clear();
    this.hpLeds = null;
    this.lamps = [];
  }
}
