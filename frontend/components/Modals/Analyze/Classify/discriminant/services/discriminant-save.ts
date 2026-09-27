/**
 * Discriminant Analysis — Save Service
 *
 * Writes the per-case results the Save dialog asks for back into the dataset as
 * new variables, the way SPSS's DISCRIMINANT /SAVE subcommand does:
 *
 *   Dis_1   Predicted Group for Analysis 1
 *   Dis1_1  Discriminant Scores from Function 1 for Analysis 1
 *   Dis1_2  Probabilities of Group 1 Membership for Analysis 1
 *
 * Why the per-case values are recomputed here instead of being read out of the
 * WASM result: the result carries per-case values only for the Casewise Statistics
 * table, which is computed only when Display → Casewise results is checked and can
 * be limited to the first n cases, while Save needs every dataset row. Walking the
 * raw rows here covers all of them. The arithmetic below mirrors `classify_case_safe`
 * in rust/src/stats/classification_result.rs (and `fit_groups` in
 * separate_covariance.rs for the Separate-groups option) exactly, so the saved
 * columns agree with the Classification Results and Casewise Statistics tables.
 */

import type { Variable } from "@/types/Variable";
import type { DiscriminantType } from "@/components/Modals/Analyze/Classify/discriminant/types/discriminant";
import { compareGroupLabels } from "@/components/Modals/Analyze/Classify/discriminant/services/discriminant-number-format";

/** The slice of the WASM `get_formatted_results()` payload this service needs. */
export type DiscriminantModelInfo = {
    canonical_functions?: {
        coefficients?: Array<{ variable: string; values: number[] }>;
        function_at_centroids?: Array<{ group: string; values: number[] }>;
    } | null;
    /** Present only for Classify → Use Covariance Matrix → Separate-groups. */
    separate_groups_classification?: {
        groups?: Array<{ group: string; inverse: number[][]; log_determinant: number }>;
    } | null;
};

/** One dataset row's classification, or `null` when the row is not in the analysis. */
export type CaseResult = {
    /** Group label the case is assigned to (highest posterior probability). */
    predictedGroup: string;
    /** Canonical discriminant scores, one per function. */
    scores: number[];
    /** Posterior probability of membership, one per group, in `groupLabels` order. */
    probabilities: number[];
};

export type CaseResults = {
    /** Group labels in the same order Rust uses (numeric codes by value). */
    groupLabels: string[];
    /** Number of canonical discriminant functions. */
    numFunctions: number;
    /** One entry per dataset row; `null` for rows excluded from the analysis. */
    rows: Array<CaseResult | null>;
};

/** Mirrors `parseCellValue` in hooks/useVariable.ts so both read cells alike. */
export function parseCell(raw: unknown): string | number | null {
    if (raw === null || raw === undefined || raw === "") return null;
    const text = String(raw);
    const parsed = Number.parseFloat(text.replace(",", "."));
    return Number.isNaN(parsed) ? text : parsed;
}

/**
 * Rust builds its group label with `f64::to_string()`. `String(n)` in JS agrees
 * with that for every value this path sees (integers print without a trailing
 * ".0" on both sides), so the labels line up with the ones in the result tables.
 */
function groupLabelOf(value: string | number): string {
    return typeof value === "number" ? String(value) : value;
}

/**
 * Recompute each dataset row's predicted group, discriminant scores, and
 * posterior probabilities from the fitted model.
 *
 * A row is classified when every analyzed predictor holds a number — the same
 * listwise rule the analysis itself applies. With "Replace missing values with
 * mean", a row missing a predictor is still classified, with that predictor's mean
 * over the analysis rows substituted (as Rust does). A row whose group code is
 * missing or outside the defined range is classified too (an ungrouped case, as in
 * SPSS), but never counts as an analysis row. Everything else comes back as `null`
 * and is left blank in the saved columns.
 */
export function computeDiscriminantCaseResults(
    dataVariables: string[][],
    variables: Variable[],
    model: DiscriminantModelInfo,
    config: DiscriminantType,
): CaseResults | null {
    const canonical = model.canonical_functions;
    const coefficientRows = canonical?.coefficients ?? [];
    const centroidRows = canonical?.function_at_centroids ?? [];

    if (coefficientRows.length === 0 || centroidRows.length === 0) return null;

    const groupingName = config.main.GroupingVariable;
    if (!groupingName) return null;

    // The coefficient table already reflects stepwise selection, so it is the
    // authority on which predictors the fitted model actually uses.
    const predictors = coefficientRows.filter((c) => c.variable !== "(Constant)");
    const constants = coefficientRows.find((c) => c.variable === "(Constant)")?.values ?? [];
    if (predictors.length === 0) return null;

    const numFunctions = Math.min(
        ...predictors.map((p) => p.values.length),
        ...centroidRows.map((c) => c.values.length),
    );
    if (!Number.isFinite(numFunctions) || numFunctions < 1) return null;

    // Same group order as Rust (compare_group_labels: numeric codes by value), so
    // the probability columns follow the result tables' group columns.
    const groupLabels = centroidRows.map((c) => c.group).slice().sort(compareGroupLabels);
    const centroidOf = new Map(centroidRows.map((c) => [c.group, c.values]));

    const columnOf = new Map<string, number>();
    for (const v of variables) columnOf.set(v.name, v.columnIndex);

    const groupingColumn = columnOf.get(groupingName);
    if (groupingColumn === undefined) return null;

    const predictorColumns: number[] = [];
    for (const p of predictors) {
        const col = columnOf.get(p.variable);
        if (col === undefined) return null;
        predictorColumns.push(col);
    }

    const { minRange, maxRange } = config.defineRange;

    // Selection variable, applied exactly like filter_valid_cases in common.rs: only
    // when both a selection variable and a value are set; a numeric cell matches
    // within 1e-10, a text cell matches the value's string form, a blank never
    // matches. Unselected rows are still classified (as SPSS does), but only selected
    // rows count toward "Compute from group sizes" priors, because Rust estimates
    // those priors from the analysis sample.
    const selectionName = config.main.SelectionVariable;
    const selectionValue = config.setValue.Value;
    const selectionColumn =
        selectionName && selectionValue !== null ? columnOf.get(selectionName) : undefined;
    const isSelected = (row: string[]): boolean => {
        if (selectionColumn === undefined || selectionValue === null) return true;
        const cell = parseCell(row[selectionColumn]);
        if (typeof cell === "number") return Math.abs(cell - selectionValue) < 1e-10;
        if (typeof cell === "string") return cell === String(selectionValue);
        return false;
    };

    // The rows the engine receives as cases: up to the last row holding a value in
    // the grouping, independent or selection variables (the rule of getSlicedData,
    // whose slices the discriminant hook pads to that common length). Rows after it
    // are empty, not cases, and must not be classified as ungrouped ones.
    const caseColumns = [
        groupingColumn,
        ...(config.main.IndependentVariables ?? []).map((name) => columnOf.get(name)),
        selectionName ? columnOf.get(selectionName) : undefined,
    ].filter((col): col is number => col !== undefined);
    let lastRow = -1;
    dataVariables.forEach((row, rowIndex) => {
        if (row && caseColumns.some((col) => row[col] !== undefined && row[col] !== null && row[col] !== "")) {
            lastRow = rowIndex;
        }
    });

    // Pass 1a — collect the rows, with each predictor cell read as a number or `null`
    // when missing. `label` is `null` for an ungrouped row (missing or out-of-range
    // group code).
    type Candidate = {
        rowIndex: number;
        label: string | null;
        cells: Array<number | null>;
        selected: boolean;
    };
    const candidates: Candidate[] = [];

    for (let rowIndex = 0; rowIndex <= lastRow; rowIndex++) {
        const row = dataVariables[rowIndex];
        if (!row) continue;

        const groupValue = parseCell(row[groupingColumn]);
        const inRange =
            groupValue !== null &&
            !(
                typeof groupValue === "number" &&
                ((minRange !== null && groupValue < minRange) ||
                    (maxRange !== null && groupValue > maxRange))
            );
        let label: string | null = null;
        if (inRange) {
            label = groupLabelOf(groupValue as string | number);
            if (!centroidOf.has(label)) continue;
        }

        const cells = predictorColumns.map((col) => {
            const cell = parseCell(row[col]);
            return typeof cell === "number" && Number.isFinite(cell) ? cell : null;
        });

        candidates.push({ rowIndex, label, cells, selected: isSelected(row) });
    }

    // Analysis rows are the selected, complete ones with a valid group code — the
    // cases Rust estimates the functions, the priors and the substituted means from.
    const isComplete = (c: Candidate) => c.cells.every((v) => v !== null);
    const isAnalysisRow = (c: Candidate) => c.label !== null && c.selected && isComplete(c);

    const predictorMeans = predictors.map((_, v) => {
        let sum = 0;
        let n = 0;
        for (const c of candidates) {
            if (!isAnalysisRow(c)) continue;
            sum += c.cells[v] as number;
            n++;
        }
        return n > 0 ? sum / n : Number.NaN;
    });

    // Pass 1b — score the rows. Incomplete rows are scored only with "Replace
    // missing values with mean", each missing predictor replaced by its mean.
    type Scored = { rowIndex: number; label: string | null; scores: number[]; analysis: boolean };
    const scored: Scored[] = [];

    for (const c of candidates) {
        if (!isComplete(c) && !config.classify.Replace) continue;

        const values = c.cells.map((v, i) => v ?? predictorMeans[i]);
        if (values.some((v) => !Number.isFinite(v))) continue;

        // Discriminant scores fⱼ = a₀ⱼ + Σᵢ aᵢⱼ xᵢ (unstandardized coefficients).
        const scores = new Array<number>(numFunctions).fill(0);
        for (let f = 0; f < numFunctions; f++) {
            let s = constants[f] ?? 0;
            for (let v = 0; v < predictors.length; v++) {
                s += values[v] * (predictors[v].values[f] ?? 0);
            }
            scores[f] = s;
        }

        scored.push({ rowIndex: c.rowIndex, label: c.label, scores, analysis: isAnalysisRow(c) });
    }

    if (scored.length === 0) return null;

    // Priors πₖ = 1/g or nₖ/n, following the Prior Probabilities table
    // (prior_probabilities.rs), which every Rust classification path uses: group sizes
    // are counted over the analysis sample (selected, complete rows), with equal priors
    // if it is empty.
    const priors: number[] = [];
    if (config.classify.AllGroupEqual) {
        priors.push(...new Array<number>(groupLabels.length).fill(1 / groupLabels.length));
    } else {
        const counts = new Map<string, number>(groupLabels.map((g) => [g, 0]));
        let analysisCases = 0;
        for (const c of scored) {
            if (!c.analysis || c.label === null) continue;
            counts.set(c.label, (counts.get(c.label) ?? 0) + 1);
            analysisCases++;
        }
        for (const g of groupLabels) {
            priors.push(
                analysisCases > 0 ? (counts.get(g) ?? 0) / analysisCases : 1 / groupLabels.length
            );
        }
    }

    // Separate-groups: each group's inverse covariance matrix of the functions and
    // its log determinant, as computed by separate_covariance.rs.
    const separateOf = new Map(
        (model.separate_groups_classification?.groups ?? []).map((g) => [g.group, g]),
    );
    const useSeparate = config.classify.SepGroup && separateOf.size > 0;

    // Pass 2 — distances, posterior probabilities, predicted group.
    const rows: Array<CaseResult | null> = new Array(dataVariables.length).fill(null);

    for (const c of scored) {
        // ℓₖ = ln πₖ − ½ ln|Σₖ| − ½ D²ₖ, the log posterior up to a shared constant.
        // D²ₖ is the squared distance of the scores to group k's centroid: Euclidean in
        // function space, or (f − f̄ₖ)ᵀ Σₖ⁻¹ (f − f̄ₖ) with the group's own covariance
        // matrix Σₖ under Separate-groups (ln|Σₖ| = 0 otherwise).
        const logProbs = groupLabels.map((g, gIdx) => {
            const centroid = centroidOf.get(g) ?? [];
            const diff = new Array<number>(numFunctions);
            for (let f = 0; f < numFunctions; f++) diff[f] = c.scores[f] - (centroid[f] ?? 0);

            let d2 = 0;
            let logDet = 0;
            const sep = useSeparate ? separateOf.get(g) : undefined;
            if (sep) {
                for (let i = 0; i < numFunctions; i++) {
                    for (let j = 0; j < numFunctions; j++) {
                        d2 += diff[i] * (sep.inverse[i]?.[j] ?? 0) * diff[j];
                    }
                }
                logDet = sep.log_determinant;
            } else {
                for (let f = 0; f < numFunctions; f++) d2 += diff[f] * diff[f];
            }
            if (Number.isNaN(d2)) d2 = Number.MAX_VALUE;
            const prior = priors[gIdx];
            return prior > 0 ? Math.log(prior) - 0.5 * logDet - 0.5 * d2 : -Infinity;
        });

        // P(G=k | x) = exp(ℓₖ − max ℓ) / Σⱼ exp(ℓⱼ − max ℓ); subtracting the largest ℓ
        // keeps the exponentials from underflowing, as in Rust.
        const maxLog = Math.max(...logProbs);
        const exps = logProbs.map((lp) => Math.exp(lp - maxLog));
        const sumExp = exps.reduce((a, b) => a + b, 0);
        const probabilities = sumExp > 0 ? exps.map((e) => e / sumExp) : exps;

        let bestIdx = 0;
        for (let g = 1; g < logProbs.length; g++) {
            if (logProbs[g] > logProbs[bestIdx]) bestIdx = g;
        }

        rows[c.rowIndex] = {
            predictedGroup: groupLabels[bestIdx],
            scores: c.scores,
            probabilities,
        };
    }

    return { groupLabels, numFunctions, rows };
}

/** A variable to create plus the column of values that goes with it. */
export type PreparedSaveVariable = {
    definition: Partial<Variable>;
    /** One entry per dataset row; `null` leaves the cell blank. */
    values: Array<number | string | null>;
};

function numericVariable(name: string, label: string, decimals: number): Partial<Variable> {
    return {
        name,
        label,
        type: "NUMERIC",
        width: 8,
        decimals,
        align: "right",
        measure: decimals === 0 ? "nominal" : "scale",
        role: "input",
    };
}

/**
 * Pick the SPSS suffix set for this run.
 *
 * SPSS numbers the saved columns per set: the predicted group and the
 * discriminant scores share one suffix (Dis_1, Dis1_1, Dis2_1) and the
 * probabilities take the next (Dis1_2, Dis2_2). The lowest starting suffix
 * whose whole name set is still free is used, so re-running the analysis
 * appends rather than colliding.
 */
function allocateNames(
    save: DiscriminantType["save"],
    numFunctions: number,
    numGroups: number,
    taken: Set<string>,
): { predicted: string | null; scores: string[]; probabilities: string[]; analysis: number } {
    for (let start = 1; start < 1000; start++) {
        let set = start;
        const predicted = save.Predicted ? `Dis_${set}` : null;

        const scores: string[] = [];
        if (save.Discriminant) {
            for (let k = 1; k <= numFunctions; k++) scores.push(`Dis${k}_${set}`);
            set += 1;
        }

        const probabilities: string[] = [];
        if (save.Probabilities) {
            for (let k = 1; k <= numGroups; k++) probabilities.push(`Dis${k}_${set}`);
        }

        const all = [...(predicted ? [predicted] : []), ...scores, ...probabilities];
        if (all.every((n) => !taken.has(n))) {
            return { predicted, scores, probabilities, analysis: start };
        }
    }
    throw new Error("Could not find free variable names for the saved discriminant columns.");
}

/**
 * Turn the per-case results into the variables the Save dialog asked for.
 * Returns an empty list when nothing is selected.
 */
export function prepareDiscriminantSaveVariables(
    results: CaseResults,
    save: DiscriminantType["save"],
    existingNames: Set<string>,
): PreparedSaveVariable[] {
    const { groupLabels, numFunctions, rows } = results;
    const names = allocateNames(save, numFunctions, groupLabels.length, existingNames);
    const prepared: PreparedSaveVariable[] = [];

    if (names.predicted) {
        prepared.push({
            definition: numericVariable(
                names.predicted,
                `Predicted Group for Analysis ${names.analysis}`,
                0,
            ),
            // The label is the grouping variable's own code, so a numeric code
            // goes back in as a number and a string code stays a string.
            values: rows.map((r) => {
                if (!r) return null;
                const asNumber = Number(r.predictedGroup);
                return Number.isNaN(asNumber) ? r.predictedGroup : asNumber;
            }),
        });
    }

    names.scores.forEach((name, f) => {
        prepared.push({
            definition: numericVariable(
                name,
                `Discriminant Scores from Function ${f + 1} for Analysis ${names.analysis}`,
                5,
            ),
            values: rows.map((r) => (r ? r.scores[f] ?? null : null)),
        });
    });

    names.probabilities.forEach((name, g) => {
        prepared.push({
            definition: numericVariable(
                name,
                // The group's own code, not its position (codes need not be 1..k).
                `Probabilities of Group ${groupLabels[g]} Membership for Analysis ${names.analysis}`,
                5,
            ),
            values: rows.map((r) => (r ? r.probabilities[g] ?? null : null)),
        });
    });

    return prepared;
}

/**
 * Compute, build, and commit the saved columns in one go.
 *
 * Returns the names of the variables it created; an empty array means nothing
 * was requested or the model could not produce per-case results.
 */
export async function saveDiscriminantVariables(
    dataVariables: string[][],
    variables: Variable[],
    model: DiscriminantModelInfo,
    config: DiscriminantType,
): Promise<string[]> {
    const { save } = config;
    if (!save.Predicted && !save.Discriminant && !save.Probabilities) return [];

    const results = computeDiscriminantCaseResults(dataVariables, variables, model, config);
    if (!results) {
        throw new Error(
            "The analysis did not return canonical discriminant functions, so there is nothing to save.",
        );
    }

    // Imported lazily so this module stays usable from tests and workers, which
    // have no Zustand store to talk to.
    const { useVariableStore } = await import("@/stores/useVariableStore");

    const existing = useVariableStore.getState().variables;
    const existingNames = new Set(existing.map((v) => v.name));
    const prepared = prepareDiscriminantSaveVariables(results, save, existingNames);
    if (prepared.length === 0) return [];

    const nextColumnIndex =
        existing.length > 0 ? Math.max(...existing.map((v) => v.columnIndex)) + 1 : 0;

    const definitions = prepared.map((p, idx) => ({
        ...p.definition,
        columnIndex: nextColumnIndex + idx,
    }));

    const updates = prepared.flatMap((p, idx) =>
        p.values.flatMap((value, row) =>
            value === null ? [] : [{ row, col: nextColumnIndex + idx, value }],
        ),
    );

    await useVariableStore.getState().addVariables(definitions as Variable[], updates);

    return definitions.map((d) => d.name as string);
}
