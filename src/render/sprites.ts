import * as THREE from 'three';

// Placeholder textures generated in code (GDD §14): no external art files.

export function makeLabelTexture(
  text: string,
  opts: { size?: number; color?: string; background?: string; font?: string } = {},
): THREE.CanvasTexture {
  const size = opts.size ?? 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = opts.color ?? '#ffffff';
  ctx.font = opts.font ?? `bold ${Math.round(size * 0.42)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size / 2 + size * 0.02);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Camera-facing flat sprite (billboard) with a placeholder letter. */
export function makeCharacterSprite(letter: string, color: string, height = 1): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: makeLabelTexture(letter, { background: color, color: '#10131a' }),
    transparent: true,
    // Characters always draw over the field; ordering between them uses renderOrder by row.
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(height, height, 1);
  // Anchor below the sprite center so the figure reads as standing on its own cell
  // under the tilted camera (a bottom anchor makes it look one row further back).
  sprite.center.set(0.5, 0.3);
  return sprite;
}
