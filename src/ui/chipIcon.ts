import { CHIPS, type ChipCode, type ChipId } from '../data/chips';

// Placeholder chip art (GDD §14): colored tile, short name, code letter, power.

export function chipIconHtml(defId: ChipId, code: ChipCode, opts: { showPower?: boolean } = {}): string {
  const def = CHIPS[defId];
  const power = opts.showPower !== false && def.power !== null ? `<span class="ci-power">${def.power}</span>` : '';
  return (
    `<span class="chip-icon" style="--chip-color:${def.color}">` +
    `<span class="ci-abbr">${def.abbr}</span>` +
    `${power}<span class="ci-code">${code}</span>` +
    `</span>`
  );
}
