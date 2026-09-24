/** Marker for a manually completed multi-chip chain. */
export class ComboState {
  readonly status = 'active' as const;

  constructor(readonly startedAt: number) {}
}
