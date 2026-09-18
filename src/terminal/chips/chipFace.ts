import * as THREE from 'three';
import { CHIPS, type ChipCode, type ChipId, type UseTimeGroup } from '../../data/chips';
import { chipName } from '../../i18n';
import { drawText, measureText, type PixelSink } from '../crt/pixelFont';
import { codeColor } from './codeColor';
import { CHIP_ICONS, ICON_PALETTE } from './chipIcons';

// Chip cartridge face (spec §9.1): 64×88 texels, drawn once per chip id and
// code — frame in the chip family colour, big icon, name, power and a code
// letter in its own colour. The top-right corner is cut like an SD card: those
// texels are left transparent so the body's cut silhouette shows through.

export const FACE_W = 64;
export const FACE_H = 88;
/** Side of the cut corner, texels. Shared with the cartridge geometry. */
export const FACE_CUT = 12;
/** Bumped whenever the face design changes, so cached textures are not reused. */
const FACE_GEN = 3;

const GROUP_COLOR: Record<UseTimeGroup, { frame: string; backdrop: string }> = {
  CANNON: { frame: '#5f86ff', backdrop: '#1d2a4d' },
  SWORD: { frame: '#ffb347', backdrop: '#4a3317' },
  BOMB: { frame: '#9a6bff', backdrop: '#2c1f4a' },
  RECOVER: { frame: '#3fcf6a', backdrop: '#173d24' },
  FIELD: { frame: '#c9b98a', backdrop: '#3a3326' },
};

const COLOR = {
  card: '#141619',
  name: '#e8dfc4',
  power: '#ffd166',
  contact: '#c9a24a',
  contactShade: '#6b5424',
};

const ICON_SCALE = 2;
const cache = new Map<string, THREE.CanvasTexture>();

export function chipFaceTexture(defId: ChipId, code: ChipCode): THREE.CanvasTexture {
  const key = `${defId}:${code}:${FACE_GEN}`;
  let tex = cache.get(key);
  if (tex) return tex;

  const canvas = document.createElement('canvas');
  canvas.width = FACE_W;
  canvas.height = FACE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const sink = ctx as unknown as PixelSink;
  const def = CHIPS[defId];
  const group = GROUP_COLOR[def.useTime];

  ctx.fillStyle = COLOR.card;
  ctx.fillRect(0, 0, FACE_W, FACE_H);
  ctx.fillStyle = group.frame;
  ctx.fillRect(0, 0, FACE_W, 2);
  ctx.fillRect(0, FACE_H - 2, FACE_W, 2);
  ctx.fillRect(0, 0, 2, FACE_H);
  ctx.fillRect(FACE_W - 2, 0, 2, FACE_H);
  // The cut corner: clear the square, then put back what stays left of the
  // diagonal and run the frame along it.
  ctx.clearRect(FACE_W - FACE_CUT, 0, FACE_CUT, FACE_CUT);
  for (let y = 0; y < FACE_CUT; y++) {
    if (y === 0) continue;
    ctx.fillStyle = COLOR.card;
    ctx.fillRect(FACE_W - FACE_CUT, y, y, 1);
    ctx.fillStyle = group.frame;
    ctx.fillRect(FACE_W - FACE_CUT + Math.max(0, y - 2), y, Math.min(2, y), 1);
  }

  const name = chipName(defId).toUpperCase();
  drawText(sink, name, Math.round((FACE_W - measureText(name)) / 2), 5, 1, COLOR.name);

  // Icon on a tinted backdrop.
  const iconSize = 16 * ICON_SCALE;
  const ix = Math.round((FACE_W - iconSize) / 2);
  const iy = 18;
  ctx.fillStyle = group.backdrop;
  ctx.fillRect(ix - 2, iy - 2, iconSize + 4, iconSize + 4);
  CHIP_ICONS[defId].forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = ICON_PALETTE[row[x] as string];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(ix + x * ICON_SCALE, iy + y * ICON_SCALE, ICON_SCALE, ICON_SCALE);
    }
  });

  // Power (bottom-left) and code plaque (bottom-right).
  const rowY = 64;
  if (def.power !== null) drawText(sink, String(def.power), 5, rowY + 3, 1, COLOR.power);
  const plaque = codeColor(code);
  ctx.fillStyle = plaque;
  ctx.fillRect(FACE_W - 19, rowY, 14, 14);
  ctx.fillStyle = COLOR.card;
  ctx.fillRect(FACE_W - 18, rowY + 1, 12, 12);
  drawText(sink, code, FACE_W - 15, rowY + 4, 1, plaque);

  // Gold contacts.
  for (let i = 0; i < 7; i++) {
    const x = 4 + i * 8;
    ctx.fillStyle = COLOR.contact;
    ctx.fillRect(x, FACE_H - 8, 5, 5);
    ctx.fillStyle = COLOR.contactShade;
    ctx.fillRect(x, FACE_H - 4, 5, 1);
  }

  tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  cache.set(key, tex);
  return tex;
}
