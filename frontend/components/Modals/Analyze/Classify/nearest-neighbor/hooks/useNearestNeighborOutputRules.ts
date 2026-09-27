import type { CheckedState } from "@radix-ui/react-checkbox";

/**
 * Aturan menu tab Output: status checkbox yang "indeterminate" atau belum
 * terdefinisi selalu dianggap tidak dicentang (false).
 */
export function normalizeOutputCheckboxValue(
  value: CheckedState | undefined | boolean | string | null,
): boolean | string | null {
  if (value === "indeterminate" || typeof value === "undefined") return false;
  return value;
}
