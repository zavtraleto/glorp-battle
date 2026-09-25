import { en, type StringKey } from './en';

type Table = Record<StringKey, string>;

let current: Table = en;

export function setStrings(table: Table): void {
  current = table;
}

/** Localized chip name / description. */
export function chipName(id: string): string {
  return t(`chip.${id}.name` as StringKey);
}

export function chipDesc(id: string): string {
  return t(`chip.${id}.desc` as StringKey);
}

/** What the chip does, short enough for the 14-segment display with its power. */
export function chipBrief(id: string): string {
  return t(`chip.${id}.brief` as StringKey);
}

export function enemyName(kind: string): string {
  return t(`enemy.${kind}` as StringKey);
}

/** Returns the localized string; `{name}` placeholders are replaced from `params`. */
export function t(key: StringKey, params?: Record<string, string | number>): string {
  let s: string = current[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}
