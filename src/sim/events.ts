import type { ChipId, ShapeKind } from '../data/chips';
import type { Panel } from './field';
import type { ObjectKind } from './fieldObject';
import type { Cell, Side } from './grid';
import type { EntityId } from './occupancy';

// Events produced by the simulation during a tick. The app drains them each
// frame and forwards them to FX, HUD, audio and the debug log.

export type SimEvent =
  | { type: 'damaged'; targetId: EntityId; amount: number; x: number; y: number; hpLeft: number }
  | { type: 'comboStarted'; size: number }
  | { type: 'comboEnded'; reason: 'complete' }
  | { type: 'comboBroken' }
  /** A completed combo brought these cooling slots `ticks` closer to their next chip (GDD §5). */
  | { type: 'slotCooldownCut'; slots: number[]; ticks: number }
  | { type: 'enemyKilled'; id: EntityId; x: number; y: number }
  | { type: 'enemyCountered'; id: EntityId; x: number; y: number }
  | { type: 'enemyRemoved'; id: EntityId }
  | { type: 'attackSpawned'; id: number; kind: string; x: number; y: number }
  | { type: 'stateChanged'; from: string; to: string }
  | { type: 'chipUsed'; defId: ChipId; x: number; y: number }
  | { type: 'chipInterrupted'; defId: ChipId }
  /** Frozen-chain cartridges that did not resolve and returned to ready. */
  | { type: 'chipChainCancelled'; chips: { slot: number; deal: number }[] }
  /** Visual footprint of a resolved chip; `cells` are the panels it swept or hit. */
  | { type: 'chipEffect'; defId: ChipId; shape: ShapeKind; x: number; fromY: number; cells: Cell[]; toY: number }
  | { type: 'barrierSet'; x: number; y: number }
  | { type: 'barrierBroken'; x: number; y: number }
  /** Instant enemy shot along a lane (Canodron); toY = row where it stopped, or ROWS if it left the field. */
  | { type: 'enemyShot'; x: number; fromY: number; toY: number }
  | { type: 'panelChanged'; x: number; y: number; panel: Panel; owner: Side }
  | { type: 'hazardChanged'; x: number; y: number; armed: boolean }
  | { type: 'claimChanged'; row: number; claimed: boolean }
  | { type: 'objectPlaced'; id: EntityId; kind: ObjectKind; x: number; y: number }
  | { type: 'objectBroken'; id: EntityId; x: number; y: number }
  /** Enemy melee swing over these panels (Bladdy). */
  | { type: 'enemySlash'; cells: Cell[] }
  | { type: 'enemyWarped'; id: EntityId; fromX: number; fromY: number; x: number; y: number }
  /** Every enemy of a wave that is not the last is deleted (GDD §10.4); `wave` is 1-based. */
  | { type: 'waveCleared'; wave: number }
  /** The field reset in place for the next wave (GDD §10.4). */
  | { type: 'waveField'; wave: number }
  /** The enemies of a wave appeared; they act once the spawn animation ends. */
  | { type: 'waveSpawned'; wave: number; count: number }
  /** The draw pile ran dry and the spent chips shuffled back in (decision 2026-09-18 А). */
  | { type: 'drawReshuffled'; count: number };
