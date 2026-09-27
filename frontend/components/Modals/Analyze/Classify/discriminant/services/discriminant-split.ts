/**
 * Discriminant Analysis — Training/testing split
 *
 * Selection Variable → "Generate Split..." adds a new variable to the dataset,
 * 1 = training and 0 = testing, and makes it the Selection Variable with Value 1.
 * The analysis then estimates the functions from the training cases only, and the
 * testing cases (the unselected ones) are classified with those functions and
 * reported on their own, as SPSS does with a selection variable.
 *
 * The split is a column, not something hidden inside the analysis, so it can be
 * inspected, reused, and given to SPSS as the same selection variable to compare
 * the output exactly.
 *
 * Reproducible: a seeded Mersenne Twister draws the split, so the same dataset,
 * percentage, seed and stratification always give the same column.
 */

import type { Variable } from "@/types/Variable";
import { compareGroupLabels } from "@/components/Modals/Analyze/Classify/discriminant/services/discriminant-number-format";
import { parseCell } from "@/components/Modals/Analyze/Classify/discriminant/services/discriminant-save";

export type SplitOptions = {
    /** Share of the cases (of each stratum, when stratified) put in training, 1–99. */
    trainingPercent: number;
    /** Seed of the random number generator; the same seed gives the same split. */
    seed: number;
    /** Variable whose values define the strata (the grouping variable), or null. */
    stratifyBy: string | null;
};

export type SplitResult = {
    /** One entry per dataset row: 1 = training, 0 = testing, null for an empty row. */
    values: Array<0 | 1 | null>;
    training: number;
    testing: number;
};

/** Default seed, the same as SPSS's default random number seed. */
export const DEFAULT_SPLIT_SEED = 2000000;
export const DEFAULT_TRAINING_PERCENT = 70;

/** Checks the dialog inputs; returns the message to show, or null when valid. */
export function validateSplitOptions(trainingPercent: unknown, seed: unknown): string | null {
    const percent = Number(trainingPercent);
    if (!Number.isFinite(percent) || percent < 1 || percent > 99) {
        return "Training percentage must be between 1 and 99.";
    }
    const seedNumber = Number(seed);
    if (!Number.isInteger(seedNumber) || seedNumber < 1 || seedNumber > 2000000000) {
        return "Seed must be a whole number between 1 and 2,000,000,000.";
    }
    return null;
}

/** MT19937 (init_genrand / genrand_int32), the generator the bootstrap also uses. */
class MersenneTwister {
    private mt = new Uint32Array(624);
    private index = 624;

    constructor(seed: number) {
        this.mt[0] = seed >>> 0;
        for (let i = 1; i < 624; i++) {
            const prev = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30);
            // 1812433253 * prev + i (mod 2^32), in 16-bit halves to stay exact.
            this.mt[i] =
                ((((prev & 0xffff0000) >>> 16) * 1812433253) << 16) +
                (prev & 0x0000ffff) * 1812433253 +
                i;
        }
    }

    /** Next 32-bit unsigned integer. */
    nextUint32(): number {
        if (this.index >= 624) {
            for (let k = 0; k < 624; k++) {
                const y = (this.mt[k] & 0x80000000) | (this.mt[(k + 1) % 624] & 0x7fffffff);
                this.mt[k] = this.mt[(k + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
            }
            this.index = 0;
        }
        let y = this.mt[this.index++];
        y ^= y >>> 11;
        y ^= (y << 7) & 0x9d2c5680;
        y ^= (y << 15) & 0xefc60000;
        y ^= y >>> 18;
        return y >>> 0;
    }

    /** Uniform integer in [0, n). */
    nextIndex(n: number): number {
        return Math.floor((this.nextUint32() / 4294967296) * n);
    }
}

/**
 * Draw the split. Every non-empty row of the dataset gets 1 or 0; in each stratum
 * (each value of `stratifyBy`, or the whole dataset) exactly
 * round(trainingPercent% × stratum size) rows are training, picked at random.
 * Strata are visited in group-code order and rows in file order, so the result
 * depends only on the data and the options.
 */
export function drawTrainingSplit(
    dataVariables: string[][],
    variables: Variable[],
    options: SplitOptions,
): SplitResult {
    const values: Array<0 | 1 | null> = new Array(dataVariables.length).fill(null);

    const isEmptyRow = (row: string[] | undefined) =>
        !row || row.every((cell) => cell === null || cell === undefined || String(cell).trim() === "");

    // Rows up to the last one holding any data; fully empty rows stay blank.
    let lastRow = dataVariables.length - 1;
    while (lastRow >= 0 && isEmptyRow(dataVariables[lastRow])) lastRow--;

    const strataColumn = options.stratifyBy
        ? variables.find((v) => v.name === options.stratifyBy)?.columnIndex
        : undefined;
    if (options.stratifyBy && strataColumn === undefined) {
        throw new Error(`Variable ${options.stratifyBy} was not found in the dataset.`);
    }

    const MISSING = "(missing)";
    const strata = new Map<string, number[]>();
    for (let row = 0; row <= lastRow; row++) {
        if (isEmptyRow(dataVariables[row])) continue;
        let key = "";
        if (strataColumn !== undefined) {
            const cell = parseCell(dataVariables[row][strataColumn]);
            key = cell === null ? MISSING : String(cell);
        }
        const rows = strata.get(key);
        if (rows) rows.push(row);
        else strata.set(key, [row]);
    }

    const rng = new MersenneTwister(options.seed);
    const fraction = options.trainingPercent / 100;
    let training = 0;
    let testing = 0;

    const keys = [...strata.keys()].sort((a, b) =>
        a === MISSING ? 1 : b === MISSING ? -1 : compareGroupLabels(a, b),
    );
    for (const key of keys) {
        const rows = [...(strata.get(key) ?? [])];
        // Fisher–Yates shuffle; the first nTrain rows of the shuffled order train.
        for (let i = rows.length - 1; i > 0; i--) {
            const j = rng.nextIndex(i + 1);
            [rows[i], rows[j]] = [rows[j], rows[i]];
        }
        const nTrain = Math.round(fraction * rows.length);
        rows.forEach((row, position) => {
            const isTraining = position < nTrain;
            values[row] = isTraining ? 1 : 0;
            if (isTraining) training++;
            else testing++;
        });
    }

    return { values, training, testing };
}

/**
 * Draw the split and add it to the dataset as a new variable (split_1, split_2, …).
 * Returns the name the variable was saved under and the two counts.
 */
export async function createSplitVariable(
    dataVariables: string[][],
    variables: Variable[],
    options: SplitOptions,
): Promise<{ name: string; training: number; testing: number }> {
    const result = drawTrainingSplit(dataVariables, variables, options);
    if (result.training === 0 || result.testing === 0) {
        throw new Error(
            result.training === 0
                ? "The split leaves no training cases. Increase the training percentage."
                : "The split leaves no testing cases. Decrease the training percentage.",
        );
    }

    const taken = new Set(variables.map((v) => v.name.toLowerCase()));
    let k = 1;
    while (taken.has(`split_${k}`)) k++;
    const name = `split_${k}`;

    const columnIndex =
        variables.length > 0 ? Math.max(...variables.map((v) => v.columnIndex)) + 1 : 0;
    const stratification = options.stratifyBy ? `, stratified by ${options.stratifyBy}` : "";
    const label = `Training/testing split (1 = training, 0 = testing): ${options.trainingPercent}% training, seed ${options.seed}${stratification}`;

    const definition: Partial<Variable> = {
        name,
        label,
        type: "NUMERIC",
        width: 8,
        decimals: 0,
        align: "right",
        measure: "nominal",
        role: "input",
        columnIndex,
    };
    const updates = result.values.flatMap((value, row) =>
        value === null ? [] : [{ row, col: columnIndex, value }],
    );

    // Imported lazily, as in discriminant-save.ts, so this module stays usable in tests.
    const { useVariableStore } = await import("@/stores/useVariableStore");
    await useVariableStore.getState().addVariables([definition], updates);

    // addVariables records failures in the store instead of throwing.
    const state = useVariableStore.getState();
    if (state.error) {
        throw new Error(state.error.message || "The split variable could not be added.");
    }
    // The store may adjust the name (e.g. a clash); read back what it saved.
    const saved = state.variables.find((v) => v.columnIndex === columnIndex);
    return { name: saved?.name ?? name, training: result.training, testing: result.testing };
}
