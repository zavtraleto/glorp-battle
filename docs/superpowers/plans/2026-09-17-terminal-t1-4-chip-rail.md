# Terminal T1.4 — Chip Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The chip rail shows real cartridges: pixel icon, name, power and code on the face; the active (next) chip is raised and glowing; a used chip ejects toward the camera leaving an empty slot with contacts; unused chips are thrown out when the Custom Screen opens; newly confirmed chips snap into the slots.

**Architecture:** Pure `railPlan` decides which slots eject/burn/load by diffing slot uids against `world.chips.queue`; pure `chipIcons` holds 16×16 pixel icons. `chipFace` draws a 56×72 face canvas (cached per chip id + code). `ChipRail` owns slot frames, contact pads and cartridge animations (tweens, no physics). `Greybox` shrinks to the hit-zone debug overlay (`hitZones.ts`). The terminal calls `rail.sync(queue, burning)` every frame and `rail.reset()` when a new World starts.

**Spec:** `docs/TERMINAL.md` §6.1–6.3, §6.5, §11 (T1.4), §17.

## Global Constraints

- `src/sim`, `src/app` unchanged; the rail only reads `world.chips.queue` (`uid`, `defId`, `code`) and `world.state`.
- Chip names via `chipName()`; icons are original pixel art (no Capcom likeness).
- Animation never delays the attack: ejection starts from the queue change, which happens in the same tick as `chipUsed`.
- Tunables in `tuning.terminal`: `CHIP_ACTIVE_LIFT` 0.18 (world), `EJECT_LIFT_TIME` 0.06, `EJECT_TIME` 0.34, `BURN_STAGGER` 0.04, `BURN_TIME` 0.6, `LOAD_TIME` 0.18, `LOAD_STAGGER` 0.05, `CONTACT_FLASH_TIME` 0.2 (s).
- Commit per task, push at the end.

## Tasks

1. **`src/terminal/chips/railPlan.ts`** — `planRail(slots: (number|null)[], queue: readonly number[], burning: boolean): { remove: { slot: number; how: 'eject' | 'burn' }[]; add: { slot: number; uid: number }[] }` and `activeSlot(slots)`. Removed = slot uid not in queue (`burn` when `burning`). Added = queue uids not in slots, in queue order, into empty slots starting after the last kept chip (or slot 0 if none kept); overflow is not shown. Tests: use from the front, burn on custom, load after OK, load after ADD (nothing), debug chip appended, overflow, active slot.
2. **`src/terminal/chips/chipIcons.ts`** — `CHIP_ICONS: Record<ChipId, string[]>` (16 rows × 16 chars), `ICON_PALETTE`. Tests: every ChipId has a 16×16 icon using only palette characters.
3. **`src/terminal/chips/chipFace.ts`** — `chipFaceTexture(defId, code): THREE.CanvasTexture` (cached), 56×72: dark card, 2-px frame in the use-time group colour, name (scale 1), icon ×2 on a tinted backdrop, power bottom-left, code plaque bottom-right, gold contacts at the bottom. `FACE_W`, `FACE_H`.
4. **`src/terminal/parts/chipRail.ts`** — slots (frame + contact pad plane that flashes), cartridges (rounded body + face + metal clip + active glow frame), `build(layout, texel)`, `sync(queue, burning)`, `reset()`, `update(dt)`. Animations: idle/active lift spring, eject (lift then toward camera and down with growing scale and spin, removed at the end), burn (hop then fall with spin, staggered), load (drop-in with scale, staggered, contact flash on landing).
5. **Wiring** — `hitZones.ts` replaces the greybox; `Terminal` uses `ChipRail` and exposes `resetWorld()`; `main.ts#afterWorldChange` calls it. Browser check (use, burn on CHIP SELECT, load after OK, ADD), bench, docs, commit, push.
