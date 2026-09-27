// discriminant-number-format.ts
//
// Cell formatting for the discriminant output tables, following SPSS pivot-table
// conventions. These are for display only: never parse the strings back into a
// calculation. The Rust engine, Save and the XML export all keep full precision.

type Cell = number | string | null | undefined;

const STAT_DECIMALS = 3;
const PERCENT_DECIMALS = 1;
const SIG_FLOOR = 0.001;

/**
 * Precision mode, for checking agreement with SPSS beyond the displayed digits:
 * after `localStorage.setItem("discriminant.decimals", "10")` in the browser
 * console, every statistic, significance and percentage prints with that many
 * decimals (1–15). Significance is then printed in full instead of "<.001", and a nonzero
 * value that would round to zero prints in E notation with as many significant
 * digits. `localStorage.removeItem("discriminant.decimals")` restores the SPSS
 * layout. The key is read on every call, so it applies from the next analysis.
 */
const DECIMALS_KEY = "discriminant.decimals";

export function comparisonDecimals(): number | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(DECIMALS_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= 15 ? n : null;
  } catch {
    return null;
  }
}

/** Precision-mode text: fixed decimals, or E notation when that would show zero. */
function precise(value: number, decimals: number): string {
  if (value !== 0 && Math.abs(value) < 0.5 * 10 ** -decimals) {
    return value.toExponential(decimals - 1).replace("e", "E");
  }
  return fixed(value, decimals);
}

/** Strings pass through, missing values are blank, infinities are spelled out. */
function nonNumericCell(value: Cell): string | null {
  if (typeof value === "string") return value;
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  if (!Number.isFinite(value)) return value > 0 ? "Infinity" : "-Infinity";
  return null;
}

/**
 * Round to nearest and drop the zero before the decimal point, as SPSS prints
 * it: 0.1234 -> ".123", -0.5 -> "-.500".
 */
function fixed(value: number, decimals: number): string {
  // toFixed rounds the exact stored double to nearest (ties away from zero).
  let text = value.toFixed(decimals);
  // A tiny negative that rounds to zero would print as "-0.000".
  if (/^-0\.0*$/.test(text)) text = text.slice(1);
  return text.replace(/^(-?)0\./, "$1.");
}

/** Continuous statistics: means, coefficients, lambdas, F, tolerances, … */
export function formatStat(value: Cell): string {
  const text = nonNumericCell(value);
  if (text !== null) return text;
  const decimals = comparisonDecimals();
  return decimals ? precise(value as number, decimals) : fixed(value as number, STAT_DECIMALS);
}

/** Significance: SPSS prints anything below .001 as "<.001". */
export function formatSig(value: Cell): string {
  const text = nonNumericCell(value);
  if (text !== null) return text;
  const p = value as number;
  const decimals = comparisonDecimals();
  if (decimals) return precise(p, decimals);
  return p < SIG_FLOOR ? "<.001" : fixed(p, STAT_DECIMALS);
}

/** Percentages (case summaries, % of variance, classification): one decimal. */
export function formatPercent(value: Cell): string {
  const text = nonNumericCell(value);
  if (text !== null) return text;
  const decimals = comparisonDecimals();
  return decimals ? precise(value as number, decimals) : fixed(value as number, PERCENT_DECIMALS);
}

/**
 * Counts, steps, ranks and degrees of freedom print as whole numbers. An
 * approximate df that is genuinely fractional (Box's M df2, Rao's F df2) keeps
 * three decimals rather than being rounded to a misleading integer.
 */
export function formatCount(value: Cell): string {
  const text = nonNumericCell(value);
  if (text !== null) return text;
  const n = value as number;
  if (Number.isInteger(n)) return String(n);
  const decimals = comparisonDecimals();
  return decimals ? precise(n, decimals) : fixed(n, STAT_DECIMALS);
}

/**
 * Order of group codes in every table and saved column set, matching the Rust
 * engine (compare_group_labels in common.rs): numeric codes ascending by value,
 * so 10 follows 2 as in SPSS, then non-numeric codes as text.
 */
export function compareGroupLabels(a: string, b: string): number {
  // Same inputs as Rust's `parse::<f64>` accepts for finite numbers (no spaces,
  // no hex), which JS `Number` would otherwise also take.
  const key = (g: string): [number, number] =>
    /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(g) ? [0, Number(g)] : [1, 0];
  const [ka, kb] = [key(a), key(b)];
  if (ka[0] !== kb[0]) return ka[0] - kb[0];
  if (ka[1] !== kb[1]) return ka[1] - kb[1];
  return a < b ? -1 : a > b ? 1 : 0;
}
