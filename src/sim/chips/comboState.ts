/** Marker for a manually completed multi-chip chain. */
export class ComboState {
  readonly status = 'active' as const;

  /** `size`: chips in the series; a completed combo shortens the cooldown by it (GDD §5.1). */
  constructor(readonly startedAt: number, readonly size: number) {}
}
