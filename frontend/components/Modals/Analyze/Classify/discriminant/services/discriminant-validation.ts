/**
 * Discriminant Analysis — Input Validation
 *
 * Checks run before any data is posted to the worker. SPSS will not run
 * DISCRIMINANT until the grouping variable has a range (`/GROUPS=var(min max)`
 * is mandatory), so an unset range is an error here rather than "use every
 * group code" as the Rust engine would otherwise do.
 */

import type { Variable } from "@/types/Variable";
import type { DiscriminantType } from "@/components/Modals/Analyze/Classify/discriminant/types/discriminant";
import { parseCell } from "@/components/Modals/Analyze/Classify/discriminant/services/discriminant-save";

export const RANGE_MISSING_MESSAGE = "Define Range must be set for the grouping variable.";
export const RANGE_NOT_INTEGER_MESSAGE = "Minimum and maximum must be integers.";
export const RANGE_ORDER_MESSAGE = "Maximum must be greater than minimum.";
export const TOO_FEW_GROUPS_MESSAGE =
    "At least two non-empty groups are required within the defined range.";
export const SELECTION_VALUE_MISSING_MESSAGE =
    "Set a Value for the Selection Variable (Value...), or remove the Selection Variable.";

/**
 * Validate a Define Range entry. Accepts raw input values (the text fields) as
 * well as stored numbers; returns the first failing rule's message, or `null`.
 */
export function validateDefineRange(
    minRange: number | string | null | undefined,
    maxRange: number | string | null | undefined,
): string | null {
    const isBlank = (v: unknown) =>
        v === null || v === undefined || (typeof v === "string" && v.trim() === "");
    if (isBlank(minRange) || isBlank(maxRange)) return RANGE_MISSING_MESSAGE;

    const min = Number(minRange);
    const max = Number(maxRange);
    if (!Number.isInteger(min) || !Number.isInteger(max)) return RANGE_NOT_INTEGER_MESSAGE;
    if (max <= min) return RANGE_ORDER_MESSAGE;
    return null;
}

/**
 * Count the groups inside the defined range that hold at least one analysis
 * case: grouping code within [min, max], passing the selection variable (same
 * rule as filter_valid_cases in common.rs), and a number in every independent.
 */
export function countNonEmptyGroups(
    dataVariables: string[][],
    variables: Variable[],
    config: DiscriminantType,
): number {
    const { GroupingVariable, IndependentVariables, SelectionVariable } = config.main;
    const { minRange, maxRange } = config.defineRange;
    if (!GroupingVariable || minRange === null || maxRange === null) return 0;

    const columnOf = new Map<string, number>();
    for (const v of variables) columnOf.set(v.name, v.columnIndex);

    const groupingColumn = columnOf.get(GroupingVariable);
    if (groupingColumn === undefined) return 0;

    const predictorColumns = (IndependentVariables ?? [])
        .map((name) => columnOf.get(name))
        .filter((col): col is number => col !== undefined);

    const selectionValue = config.setValue.Value;
    const selectionColumn =
        SelectionVariable && selectionValue !== null ? columnOf.get(SelectionVariable) : undefined;

    const groups = new Set<number>();
    for (const row of dataVariables) {
        if (!row) continue;

        const group = parseCell(row[groupingColumn]);
        if (typeof group !== "number" || group < minRange || group > maxRange) continue;

        if (selectionColumn !== undefined && selectionValue !== null) {
            const cell = parseCell(row[selectionColumn]);
            const selected =
                typeof cell === "number"
                    ? Math.abs(cell - selectionValue) < 1e-10
                    : typeof cell === "string" && cell === String(selectionValue);
            if (!selected) continue;
        }

        const complete = predictorColumns.every((col) => {
            const cell = parseCell(row[col]);
            return typeof cell === "number" && Number.isFinite(cell);
        });
        if (!complete) continue;

        groups.add(group);
        if (groups.size >= 2) return groups.size;
    }
    return groups.size;
}

/**
 * Full pre-run validation. Returns the message to show the user, or `null`
 * when the analysis may be sent to the worker.
 */
export function validateDiscriminantInput(
    dataVariables: string[][],
    variables: Variable[],
    config: DiscriminantType,
): string | null {
    const { GroupingVariable, IndependentVariables } = config.main;
    if (!GroupingVariable) return "Please select a Grouping Variable.";
    if (!IndependentVariables || IndependentVariables.length === 0) {
        return "Please select at least one Independent Variable.";
    }

    const rangeError = validateDefineRange(config.defineRange.minRange, config.defineRange.maxRange);
    if (rangeError) return rangeError;

    // Like SPSS, a selection variable needs its value. Without one the engine would
    // ignore the selection and silently analyse every case.
    const selectionValue = config.setValue.Value;
    if (config.main.SelectionVariable && (selectionValue === null || selectionValue === undefined)) {
        return SELECTION_VALUE_MISSING_MESSAGE;
    }

    if (countNonEmptyGroups(dataVariables, variables, config) < 2) return TOO_FEW_GROUPS_MESSAGE;
    return null;
}
