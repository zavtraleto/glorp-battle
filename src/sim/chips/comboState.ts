/** Marker for a manually completed multi-chip chain. */
export class ComboState {
  readonly status = 'active' as const;

  /** `slots`: the hand slots of the chain in firing order; they share the bonus (GDD §5). */
  constructor(readonly startedAt: number, readonly slots: readonly number[]) {}
}
