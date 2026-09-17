import type { ChipId, ShapeKind } from '../data/chips';
import type { Panel } from './field';
import type { ObjectKind } from './fieldObject';
import type { Cell, Side } from './grid';
import type { EntityId } from './occupancy';

// Events produced by the simulation during a tick. The app drains them each
// frame and forwards them to FX, HUD, audio and the debug log.

export type SimEvent =
  | { type: 'damaged'; targetId: EntityId; amount: number; x: number; y: number; hpLeft: number }
  | { type: 'enemyKilled'; id: EntityId; x: number; y: number }
  | { type: 'enemyRemoved'; id: EntityId }
  | { type: 'attackSpawned'; id: number; kind: string; x: number; y: number }
  | { type: 'stateChanged'; from: string; to: string }
  | { type: 'chipUsed'; defId: ChipId; x: number; y: number }
  | { type: 'chipInterrupted'; defId: ChipId }
  /** Visual footprint of a resolved chip; `cells` are the panels it swept or hit. */
  | { type: 'chipEffect'; defId: ChipId; shape: ShapeKind; x: number; fromY: number; cells: Cell[]; toY: number }
  | { type: 'healed'; amount: number; x: number; y: number }
  | { type: 'bombThrown'; id: number }
  | { type: 'bombLanded'; id: number; x: number; y: number; cells: Cell[] }
  /** Instant enemy shot along a lane (Canodron); toY = row where it stopped, or ROWS if it left the field. */
  | { type: 'enemyShot'; x: number; fromY: number; toY: number }
  | { type: 'panelChanged'; x: number; y: number; panel: Panel; owner: Side }
  | { type: 'objectPlaced'; id: EntityId; kind: ObjectKind; x: number; y: number }
  | { type: 'objectBroken'; id: EntityId; x: number; y: number }
  /** A hit bounced off a guarded enemy. */
  | { type: 'guarded'; id: EntityId; x: number; y: number }
  /** Auto Buster shot down lane x; toY = row of the target hit, or -1 on a miss. */
  | { type: 'busterShot'; x: number; fromY: number; toY: number }
  | { type: 'enemyWarped'; id: EntityId; fromX: number; fromY: number; x: number; y: number }
  /** HeatShot burst: the hit panel plus the panel behind it. */
  | { type: 'explosion'; cells: Cell[] };
