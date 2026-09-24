# Combat Field Physics and Ten-Chip Playtest Design

**Status:** implemented; Mine/Break targeting corrected by user on 2026-09-24
**Date:** 2026-09-23
**Sources:** `EVANGELIE_Combat_Chips_v0.1.md`, `EVANGELIE_Codex_Task_Chip_Prototype_v0.1.md`, current repository code and project documentation

## Goal

Replace the current playable chip catalogue with a focused ten-chip combat prototype built on shared field rules. The result must be suitable for one complete manual playtest of positioning, space control, threat setup, and payoff sequences without changing the existing hand, selection, combo, refill, or cooldown model.

The work is implemented as two consecutive internal milestones. The first establishes field physics and passes automated tests. The second connects exactly ten chips to those rules and produces the build the user playtests. There is no temporary debug-only interaction layer between the milestones.

## Scope

The playable catalogue contains exactly:

1. Cannon
2. Sword
3. Area Grab
4. Mine
5. Block
6. Break
7. AirShot
8. Spreader
9. WideSword
10. Guard

The previous chip definitions are removed from the catalogue, folders, tutorial content, localization, cartridge icon map, tests, and GDD tables. Useful implementation beneath them remains when it serves the new system: lane shots, melee shapes, splash geometry, push, Barrier/Guard absorption, AreaGrab ownership, RockCube objects, broken panels, existing chip events, cartridge rendering, and attack FX.

This change does not add Colors or a final code system, combo slow motion, cooldown redesign, progression, rarity, upgrades, rewards, final balance, new enemies, or a new configuration framework. The ten prototype chips use the existing selection model with a neutral/shared placeholder code so code compatibility does not prevent the combinations under test.

## Architecture

### Shared world rules

Chip definitions describe verbs and parameters. They do not name other chips and do not encode pair-specific bonuses. The simulation owns the resulting state:

- `Field` owns panel topology, ownership, claim layers and ARM hazards.
- `Occupancy` remains the authoritative one-entity-per-cell map.
- `FieldObject` owns timed, damageable OCCUPY objects such as Block.
- A shared movement resolver handles voluntary steps and forced displacement.
- A shared hit resolver enforces Counter, Guard, damage, death, secondary effects, and world reactions in that order.
- Chip execution translates chip data into those general operations.
- Rendering consumes persistent state and `SimEvent`s but never changes combat state.

Existing classes are extended rather than replaced. The fixed 60 Hz simulation, deterministic RNG, event-driven rendering, hand lifecycle, action startup/recovery and input buffering remain intact.

### Cell layers

A cell has independent layers:

- owner: player or enemy;
- topology: normal or temporarily broken;
- optional ARM hazard;
- optional OCCUPY object;
- optional actor in `Occupancy`.

Ownership may pass through broken cells and objects. BREAK and OCCUPY affect passability but do not alter ownership. In v0.1 the old cracked transition is removed from playable rules: topology is `NORMAL -> BROKEN -> NORMAL`.

The placement and replacement matrix is explicit:

| Operation | Empty normal | ARM | OCCUPY | BREAK | Actor |
|---|---:|---:|---:|---:|---:|
| ARM | place | reject | reject | reject | reject |
| OCCUPY | place | remove ARM, place | reject | reject | reject |
| BREAK | break | remove ARM, break | destroy object, break | reject | reject |

Ordinary damage cannot remove ARM. Any damaging effect can damage OCCUPY. A projectile that encounters OCCUPY damages it and terminates even when that hit destroys the object. Impacts resolving on the same simulation tick use the blocker state captured for that tick, so simultaneous hits all collide with the object that existed at resolution start.

### CLAIM ownership

Area Grab claims one complete enemy-side boundary row as a new layer, including cells occupied by enemies and cells whose topology is broken or occupied. Repeated use can claim deeper adjacent rows. Each claimed layer keeps its own expiry tick; adding a layer does not refresh earlier timers.

Claim rollback preserves a connected player territory:

- a supporting outer layer cannot expire while a deeper inner claim remains active;
- an expiring layer stays temporarily claimed when reverting it would strand the player beyond the boundary;
- the deferred rollback is retried every tick and occurs as soon as connectivity permits;
- an enemy already standing on a newly claimed cell may finish its current attack, then its next voluntary move must seek enemy-owned territory;
- forced movement ignores ownership boundaries.

This replaces the current free-cell-only AreaGrab behavior.

### Movement and displacement

Voluntary movement requires a passable cell owned by the mover's side. Forced movement ignores ownership but still rejects the field edge, BREAK, OCCUPY, and occupied actor cells.

Every movement request captures its destination validity and ARM state when the step begins. Two actors never share a cell. A forced displacement received during the player's or an enemy's current movement is queued, then revalidated and resolved immediately after landing. This preserves the current visual interpolation while making the logical ordering explicit.

PUSH in v0.1 attempts one cell directly away from the effect source. A successful damage-plus-push hit resolves damage first. If damage kills the target, gameplay displacement is skipped. A blocked push leaves the target in place and applies collision stagger; pushing into another actor staggers both affected enemies when both are enemies, otherwise it staggers the displaced enemy. Stagger lasts for a tunable 200–300 ms prototype value, pauses the current enemy phase and phase deadline, does not stack, and refreshes only up to the configured full duration.

Entering an ARM cell by voluntary or forced movement triggers it once and removes it. The latched ARM from movement start still resolves if another same-tick world change removes or replaces the visible hazard. Projectiles and attacks passing over the cell do not trigger ARM.

### Hit resolution

All hits use one ordered pipeline:

1. Counter check at the actual impact tick.
2. Guard check.
3. Damage.
4. Death check.
5. Secondary effects such as PUSH.
6. World reactions such as ARM, collision and stagger.

Counter is recorded before Guard, so a guarded damaging hit can still count as a Counter. Guard consumes only on a real positive-damage hit, blocks that hit's damage, does not block utility-only displacement, and blocks only the first hit of a multi-hit attack. AirShot's PUSH requires its damage to be successfully applied; a guarded AirShot does not push. Enemy attacks do not damage other enemies unless a future rule explicitly opts in.

### Projectiles and melee

Normal projectiles stop at the first enemy or OCCUPY object, pass over BREAK, and read object state when they reach each cell. Piercing remains an explicit property rather than a default. Sword reaches only the cell directly ahead. WideSword reaches the three cells across the row directly ahead. BREAK and OCCUPY interrupt melee adjacency through their cell.

Spreader emits a normal lane projectile. Only a hit on a living enemy produces its two side-cell splash hits. An OCCUPY impact ends the projectile without splash. Prototype splash affects enemies only.

## Fixed field target

Mine and Break use the same automatic target convention as the other directional chips: the cell in the player's lane exactly two cells ahead of the activation cell, `(x, y−2)`. There is no manual target mode, cursor, CRT-cell tap or extra input command. Movement during startup does not move this captured activation anchor. If the fixed cell cannot accept the operation, the chip resolves as a normal no-op and follows the ordinary chip lifecycle.

## Ten chips

| Chip | Shared implementation | Prototype-specific behavior |
|---|---|---|
| Cannon | existing lane-shot geometry and tracer | baseline damage, no secondary effect |
| Sword | existing adjacent `near` geometry and slash FX | damage greater than Cannon |
| Area Grab | extended ownership/claim layer system | one timed boundary row, zero damage |
| Mine | ARM placement at the fixed field target | persists until entry, damage greater than Cannon |
| Block | extended RockCube/FieldObject path | adjacent placement, 2 HP, timed, blocks movement/projectiles/melee |
| Break | normal/broken panel rendering at the fixed field target | temporary topology change, destroys ARM/OCCUPY |
| AirShot | existing lane shot and push | damage lower than Cannon, one-cell PUSH after successful damage |
| Spreader | existing lane target plus side offsets | lower left/right splash only after living-enemy impact |
| WideSword | existing three-cell melee shape and slash FX | damage lower than Sword, can hit multiple enemies |
| Guard | existing Barrier charge, events and shield visual | absorbs exactly the next real damage hit, not displacement |

All chip damage, ranges, durations, Block HP, and stagger duration live in `src/config/tuning.ts` and appear through the existing debug tuning mechanism. Relative power rules are enforced by tests; exact values remain prototype values.

## Content replacement

The old 27-chip catalogue is removed rather than hidden. `ChipId`, `CHIPS`, folders, names/descriptions, icons and tests refer only to the new ten. Existing title options may remain, but every playable folder is composed only from these ten chips. The primary playtest folder contains enough repeated copies for the current 30-chip lifecycle and deliberately supports the documented sequences. The debug/all folder also contains only the ten-chip set.

Tutorial scripts are rewritten only as far as needed to use the surviving chips and teach unchanged controls. They do not teach the full field system in this task. Documentation and tests that assert removed content are deleted or replaced; generic tests of selection, hand lifecycle and cooldown remain.

## Visual language and reuse

The implementation reuses current cartridge geometry, ejection, chip face generation, lane tracer, slash, hit flash, explosion/rings, Barrier shell, panel ownership signal, broken-cell rendering, object rendering and event flow.

New art is code-native and follows the current 16x16 cartridge-icon grid and CRT signal palette. Cannon, Sword and WideSword retain their exact existing pictograms; Area Grab, Mine, Block, Break, AirShot, Spreader and Guard each receive a distinct purpose-built pictogram. Persistent field states use the existing indexed battle palette rather than arbitrary Three.js colors:

- the fixed Mine/Break destination uses the established amber action/accent preview;
- hostile ARM uses a compact pulsing hazard mark that remains readable under the CRT effects;
- Block reuses the physical rock/object silhouette with a distinct compact block profile if needed;
- BREAK reuses the empty/broken topology treatment;
- CLAIM reuses ownership coloration and panel-change events;
- Guard reuses the Barrier shell and break event, renamed for the chip;
- PUSH uses the current movement trail/impact language plus a short collision pulse for blocked displacement.

No text is added to the battle scene. New transient visuals are driven by simulation events. New persistent visuals read simulation snapshots. Signal colors use `signal()`/`dimSignal()` conventions, faces remain pixel-aligned, and `FACE_GEN` is incremented if cached cartridge art changes.

## Error handling and determinism

World mutation functions return explicit success/failure values. Expired objects and ownership layers are removed in deterministic tick order. Multiple displacements resolve in impact order and revalidate against the current world before each application. All durations are converted with `secondsToTicks`; no gameplay timer depends on render frames.

The implementation preserves unrelated uncommitted work already present in `src/config/tuning.ts`, `src/data/chips.ts`, `src/data/tutorial.ts`, `src/debug/debugPanel.ts`, `src/i18n/en.ts`, `tests/chips.test.ts`, and `tests/core.test.ts`. Overlapping edits must be integrated rather than overwritten.

## Verification

Milestone one is complete when focused simulation tests prove:

- layered placement/replacement rules;
- independent CLAIM timers and connected rollback;
- voluntary ownership restriction and ownership-agnostic forced movement;
- movement latching and queued mid-move displacement;
- ARM entry triggering for normal and forced movement;
- OCCUPY collision, HP, expiry and same-tick projectile behavior;
- temporary BREAK and projectile pass-through;
- collision stagger and enemy phase freezing;
- the complete hit-resolution order.

Milestone two is complete when:

- only the ten requested chips remain playable;
- every chip uses the shared rules rather than a named synergy;
- Mine and Break resolve on the fixed cell two spaces ahead;
- `Mine -> AirShot`, `Area Grab -> Sword`, `Block -> AirShot`, and `Break -> AirShot` work through world state;
- Guard blocks only the next damaging hit;
- WideSword can hit multiple enemies;
- Spreader splashes only after a living-enemy impact;
- the existing hand, combo, cooldown, refill and touch movement tests remain green;
- all tunables appear in the existing debug configuration path;
- cartridge icons and battle effects are wired through the existing code paths without type or runtime errors;
- `npm test`, `npm run typecheck`, and `npm run build` pass.

No browser, screenshot, or visual QA is part of implementation verification. The user performs the visual review and one manual playtest after both milestones are complete. Balance conclusions, ARM lifetime changes, final ranges, Colors and economy changes are follow-up work based on that playtest.
