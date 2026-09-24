# Combo State Design

**Date:** 2026-09-24

## Goal

Add a manual combo state to the existing EVANGELIE chip flow without replacing the combat, selection, hand, or fixed-step architecture. A committed chain of two to five chips starts Combo State only when its first chip successfully begins. The player keeps normal speed while enemy- and world-owned combat systems run at a reduced time scale.

## Agreed Behaviour

- One selected chip uses the existing non-combo flow.
- Two to five selected chips form a fixed-order manual combo.
- Combo State begins after the first chip successfully starts, never on selection or a refused input.
- Combo State has no time limit; the player may execute the selected chain at any pace.
- Startup, recovery, player movement, player statuses, player projectiles/effects, and UI stay unscaled.
- Enemy AI, movement, attack phases, statuses, projectiles, hazards, death timing, and world-owned effects use the scaled world timeline.
- Player-owned Area Grab, Break, Block, Bomb, Wave, and future player-owned effects remain unscaled.
- Every next chip requires a new input and may be buffered for 0.1 seconds before the current recovery ends.
- A normally started chip is consumed even when it misses or has no target.
- Using the final chip lets its action finish, then exits immediately without preserving spare slow motion.
- Actual player HP reduction immediately breaks the combo and burns its unstarted tail. Guard, invulnerability, Invis, god mode, and any other zero-HP-loss result do not break it.
- The active action on damage follows the existing interruption rules; Combo State adds no special cancel rule.
- Combo cooldown starts only when Combo State actually finishes. Single-chip cooldown keeps its current start-on-use behaviour.

## Time Domains

The game keeps one fixed-step loop. Existing unscaled ACTION time is the source for player/combo timing. The existing combat tick becomes the scaled world tick, advanced through a fractional accumulator using the current combo world scale. UI timing remains on `uiTick`.

Each timed combat object has an explicit owner/time domain where necessary. Player-owned attacks and field effects update from unscaled ACTION time; enemy/world-owned entities update from the scaled world tick. Rendering selects the matching timeline for interpolation.

Slow motion transitions deterministically in fixed steps:

- enter: 1.0 to 0.7 over 0.10 seconds;
- normal exit: current scale to 1.0 over 0.15 seconds;
- break exit: current scale to 1.0 over 0.08 seconds.

Slow motion remains active until the final chip finishes or Combo Break occurs.

## Chip and Cooldown Integration

`ChipSystem` retains its current selection, compatibility, slot, and hand phases. Committing a charge is separated from starting the shared refill cooldown. A single-chip charge starts cooldown immediately. A combo starts cooldown only on normal completion or Combo Break.

Burning the tail removes each unstarted committed chip from its hand slot and marks the slot spent. Replacements are reserved when delayed cooldown begins. Existing refill activation still requires both charge completion and cooldown readiness.

## Damage Integration

`World.resolveHit` compares player HP before and after applying the hit. Combo Break is triggered only if HP decreased. The existing chip interruption path still decides whether an unresolved active chip returns to its slot. The tail is burned before that path can treat it as a normal cancelled selection.

## Segment Display

The physical 14-segment module expands across the available display row. The central fixed-width label keeps the existing `NAME VALUE` format. While an action runs it shows that chip; between actions it shows the next committed chip.

Additional 14-segment character cells form equal left and right state banks. All cells remain lit while Combo State is active, and turn off immediately on normal completion or Combo Break. The label never moves. Cooldown remains exclusively on the chip cartridges.

## Configuration

Add a `combo` tuning group with:

- `WORLD_TIME_SCALE = 0.7`
- `SLOW_MO_ENTER = 0.10`
- `SLOW_MO_EXIT = 0.15`
- `COMBO_BREAK_EXIT = 0.08`
- `CHIP_INPUT_BUFFER = 0.10`

The existing debug tuning UI exposes these values with explicit practical ranges.

## Verification

Automated tests cover single-chip compatibility, two- and five-chip combos, manual order, movement, buffered input, miss behaviour, unlimited idle time between chips, normal completion, actual-damage break, prevented damage, delayed cooldown, time-domain ownership, transitions, and pure display layout/model behaviour. Final verification is `npm test`, `npm run typecheck`, and `npm run build`. No browser, screenshot, or other visual verification is performed.
