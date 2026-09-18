import * as THREE from 'three';
import type { CrtMaterial } from '../crt/crtMaterial';
import { glassRect, rectToWorld, type Rect, type TerminalLayout } from '../layout';
import { plasticTexture } from '../textures/procedural';

// Terminal housing (spec §4, §5.1): body and the CRT's thin black frame with
// its glass. The top bar with the model name, the HP LEDs, the status lamps,
// the chip counter and the control labels are gone — in full darkness only what
// is lit by the screen is visible at all.

/** World units per plastic texture repeat. */
const TEXTURE_TILE = 3;

const COLOR = {
  /** Charcoal: the body reads only where the screen's light falls on it. */
  body: 0x14151a,
  bezel: 0x08080a,
};

/** Thickness of the black frame around the glass, world units. */
const BEZEL = 0.09;
/** Centre depth of the backing panel; its front face must clear the tilted CRT and the top of the control panel. */
const BODY_Z = -3;

export class Housing {
  readonly group = new THREE.Group();
  /** Frame and glass; they live on the CRT mount and tilt with it (spec §3.1). */
  readonly crtGroup = new THREE.Group();
  private readonly glass: THREE.Mesh;
  private readonly bodyTexture = plasticTexture(1, COLOR.body);
  private readonly bodyMat = new THREE.MeshLambertMaterial({ map: this.bodyTexture });
  private readonly bezelMat = new THREE.MeshLambertMaterial({ color: COLOR.bezel, flatShading: true });
  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
  private readonly owned: { dispose(): void }[] = [];

  constructor(crt: CrtMaterial) {
    this.glass = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), crt);
  }

  /** (Re)creates the housing; `texel` is the world size of one render pixel. */
  build(layout: TerminalLayout, texel: number, crtAspect: number): void {
    this.clear();
    const W = (r: Rect) => rectToWorld(layout, r);

    // Body. It sits well back: the CRT leans away from the player and its upper
    // edge would otherwise sink into this box and be occluded by it.
    const body = W(layout.body);
    this.bodyTexture.repeat.set(body.w / TEXTURE_TILE, body.h / TEXTURE_TILE);
    this.addBox(body.cx, body.cy, BODY_Z, body.w, body.h, 0.6, this.bodyMat);

    // CRT frame and glass (the glass keeps the render target's aspect).
    const glass = W(glassRect(layout, crtAspect));
    this.addBox(glass.cx, glass.cy, 0.05, glass.w + BEZEL * 2, glass.h + BEZEL * 2, 0.3, this.bezelMat, this.crtGroup);
    this.glass.scale.set(glass.w, glass.h, 1);
    this.glass.position.set(glass.cx, glass.cy, 0.21);
    this.crtGroup.add(this.glass);
    void texel;
  }

  private addBox(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    m: THREE.Material,
    parent: THREE.Group = this.group,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.unitBox, m);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    parent.add(mesh);
    return mesh;
  }

  private clear(): void {
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
    this.group.clear();
    this.crtGroup.clear();
  }
}
