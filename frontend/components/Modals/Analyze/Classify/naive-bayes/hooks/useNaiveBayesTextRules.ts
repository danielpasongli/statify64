import { useMemo } from "react";
import {
    getEffectivePredictors,
    getEffectiveTextSource,
} from "@/components/Modals/Analyze/Classify/naive-bayes/hooks/useNaiveBayesValidation";
import type {
    NaiveBayesTextSource,
    NaiveBayesType,
} from "@/components/Modals/Analyze/Classify/naive-bayes/types/naive-bayes";
import type { Variable } from "@/types/Variable";

/**
 * Peringatan NON-BLOKIR Naive Bayes v2 (AGENTS_V2 §3.4): W-VEC, W-STR, W-LEAK.
 * Semua fungsi di sini murni (tanpa efek samping) dan membaca data baris-demi-
 * baris seperti `useDataStore.data` (`data[row][variable.columnIndex]`).
 * Peringatan tidak pernah menghalangi tombol OK.
 */

/** Sampel maksimal baris untuk W-VEC (AGENTS_V2 §3.4). */
export const VEC_SAMPLE_MAX_ROWS = 1000;
/** Jumlah kolom "mirip vektor kata" minimal agar W-VEC muncul. */
export const VEC_MIN_COLUMNS = 20;
/** Sampel maksimal baris untuk W-STR (AGENTS_V2 §3.4). */
export const STR_SAMPLE_MAX_ROWS = 5000;
/** Rasio nilai unik minimal (terhadap nilai non-missing) agar W-STR muncul. */
export const STR_UNIQUE_RATIO = 0.5;

/**
 * Teks peringatan kanonik (PLAN_V3_UI_EN §3.1). Identik dengan teks di Rust
 * (`case_summary.rs`) sehingga UI dan hasil analisis memakai kalimat yang sama.
 */
export const WARNING_VEC_LIKE = (count: number): string =>
    `${count} numeric columns look like word vectors. Move them to Text Features to use a text likelihood such as Multinomial.`;
export const WARNING_FREE_TEXT = (name: string): string =>
    `Column '${name}' looks like free text or an ID. Exclude it or move it to Text Features.`;
export const WARNING_LEAKAGE =
    "The vocabulary and IDF of these vector columns were computed outside Naive Bayes on all rows, so evaluation results may be slightly optimistic.";
/** Catatan Complement NB (tidak memakai prior kelas); dipakai pemanggil lain bila perlu. */
export const NOTE_NO_PRIOR =
    "Complement Naive Bayes does not use class priors; class scores come from the text features only.";

/** Data dataset dalam bentuk baris-demi-baris (sel bisa string/angka/null). */
export type NaiveBayesTextRulesData = ReadonlyArray<ReadonlyArray<unknown>>;

export type VectorLikeDetection = {
    /** Nama kolom Numeric efektif yang tampak seperti vektor kata. */
    columns: string[];
    /** Pesan W-VEC bila jumlah kolom >= 20; selain itu null. */
    message: string | null;
};

export type FreeTextDetection = {
    /** Nama variabel STRING yang tampak seperti teks bebas atau ID. */
    columns: string[];
    /** Satu pesan W-STR per kolom (urutan sama dengan `columns`). */
    messages: string[];
};

/** Mengubah sel menjadi angka hingga; null bila kosong/tidak numerik. */
function toFiniteNumber(cell: unknown): number | null {
    if (cell === null || cell === undefined || cell === "") return null;
    if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
    const parsed = Number.parseFloat(String(cell).replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
}

/** Mengubah sel menjadi teks ter-trim; null bila kosong. */
function toTrimmedText(cell: unknown): string | null {
    if (cell === null || cell === undefined) return null;
    const text = String(cell).trim();
    return text === "" ? null : text;
}

/**
 * W-VEC: hitung kolom Numeric efektif (measure `scale`, bukan STRING) yang
 * "mirip vektor kata": semua nilai non-missing >= 0 DAN > 50% nilai non-missing
 * = 0, pada sampel `sampleMaxRows` baris pertama. Pesan hanya muncul bila
 * jumlahnya >= `minColumns` (default 20).
 */
export function detectVectorLikeColumns(
    predictorNames: string[],
    variables: Variable[],
    data: NaiveBayesTextRulesData,
    sampleMaxRows: number = VEC_SAMPLE_MAX_ROWS,
    minColumns: number = VEC_MIN_COLUMNS
): VectorLikeDetection {
    const byName = new Map(variables.map((v) => [v.name, v]));
    const rowCount = Math.min(data.length, sampleMaxRows);
    const columns: string[] = [];

    for (const name of predictorNames) {
        const variable = byName.get(name);
        if (!variable || variable.measure !== "scale" || variable.type === "STRING") continue;

        let nonMissing = 0;
        let zeros = 0;
        let hasNegative = false;
        for (let i = 0; i < rowCount; i++) {
            const value = toFiniteNumber(data[i]?.[variable.columnIndex]);
            if (value === null) continue;
            if (value < 0) {
                hasNegative = true;
                break;
            }
            nonMissing++;
            if (value === 0) zeros++;
        }
        if (!hasNegative && nonMissing > 0 && zeros / nonMissing > 0.5) {
            columns.push(name);
        }
    }

    const message =
        columns.length >= minColumns
            ? WARNING_VEC_LIKE(columns.length)
            : null;
    return { columns, message };
}

/**
 * W-STR: untuk tiap variabel STRING di predictor efektif (Categorical), pada
 * sampel `sampleMaxRows` baris, tandai bila jumlah nilai unik non-missing
 * >= 50% dari jumlah baris non-missing.
 */
export function detectFreeTextStrings(
    predictorNames: string[],
    variables: Variable[],
    data: NaiveBayesTextRulesData,
    sampleMaxRows: number = STR_SAMPLE_MAX_ROWS
): FreeTextDetection {
    const byName = new Map(variables.map((v) => [v.name, v]));
    const rowCount = Math.min(data.length, sampleMaxRows);
    const columns: string[] = [];
    const messages: string[] = [];

    for (const name of predictorNames) {
        const variable = byName.get(name);
        if (!variable || variable.type !== "STRING") continue;

        const unique = new Set<string>();
        let nonMissing = 0;
        for (let i = 0; i < rowCount; i++) {
            const text = toTrimmedText(data[i]?.[variable.columnIndex]);
            if (text === null) continue;
            nonMissing++;
            unique.add(text);
        }
        if (nonMissing > 0 && unique.size / nonMissing >= STR_UNIQUE_RATIO) {
            columns.push(name);
            messages.push(WARNING_FREE_TEXT(name));
        }
    }

    return { columns, messages };
}

/** W-LEAK: catatan bila sumber Text = vector; selain itu null. */
export function getLeakageNote(textSource: NaiveBayesTextSource): string | null {
    return textSource === "vector" ? WARNING_LEAKAGE : null;
}

/**
 * Hook pembungkus `useMemo` (AGENTS_V2 §3.4): peringatan dihitung ulang hanya
 * bila isi slot variabel, daftar variabel, atau data berubah. Mengembalikan
 * semua pesan peringatan dalam satu daftar (W-VEC, W-STR, W-LEAK).
 */
export function useNaiveBayesTextWarnings(
    main: NaiveBayesType["main"],
    variables: Variable[],
    data: NaiveBayesTextRulesData
): string[] {
    return useMemo(() => {
        const predictors = getEffectivePredictors(main, variables);
        const warnings: string[] = [];

        const vec = detectVectorLikeColumns(predictors, variables, data);
        if (vec.message) warnings.push(vec.message);

        warnings.push(...detectFreeTextStrings(predictors, variables, data).messages);

        const leak = getLeakageNote(getEffectiveTextSource(main));
        if (leak) warnings.push(leak);

        return warnings;
    }, [main, variables, data]);
}
