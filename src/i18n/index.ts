import { en, type StringKey } from './en';

type Table = Record<StringKey, string>;

let current: Table = en;

export function setStrings(table: Table): void {
  current = table;
}

/** Returns the localized string; `{name}` placeholders are replaced from `params`. */
export function t(key: StringKey, params?: Record<string, string | number>): string {
  let s: string = current[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}
