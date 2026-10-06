import type { Table } from "@/types/Table";
import type { StwvConfig } from "../config";
import { FORMULA_STANDARDS, type FormulaOption } from "../constants/formula-standards";
import type { VectorizerOutput } from "../types";
import {
    describeStwvProcessingSummary,
    describeStwvSettings,
    describeStwvVocabulary,
    describeStwvSummary,
    type StwvDescribeInput,
} from "./describeStwvOutput";

/** Batas baris tabel kosakata di Output Viewer (kolom dataset tetap lengkap). */
export const MAX_VOCABULARY_ROWS = 200;

export interface StwvOutputInput {
    /** Nama variabel teks sumber (label bila ada). */
    variableName: string;
    config: StwvConfig;
    result: VectorizerOutput;
    /** Awalan yang dimasukkan pengguna. */
    columnPrefix: string;
    /** Nama final kolom yang ditambahkan, sejajar dengan result.vocabulary. */
    columnNames: readonly string[];
    /** Lama proses vektorisasi (ms); opsional. */
    durationMs?: number;
}

export interface StwvOutput {
    /** Teks untuk log di Output Viewer. */
    logText: string;
    /** Kalimat ringkasan (komponen "Executed"). */
    summaryText: string;
    /** Interpretasi HTML untuk statistic "Executed" (PLAN_V3 §3.4). */
    summaryDescription: string;
    /** Interpretasi HTML per tabel, kunci = `Table.key`. */
    tableDescriptions: Record<string, string>;
    tables: Table[];
}

function optionLabel<T extends string>(options: readonly FormulaOption<T>[], value: T): string {
    return options.find((o) => o.value === value)?.label ?? value;
}

function describeStopwords(config: StwvConfig): string {
    switch (config.stopwords.method) {
        case "indonesian":
            return "Indonesian";
        case "english":
            return "English";
        case "custom": {
            const n = config.stopwords.customList.split("\n").map((s) => s.trim()).filter(Boolean).length;
            return `Custom (${n} ${n === 1 ? "word" : "words"})`;
        }
        default:
            return "None";
    }
}

function describeStemming(config: StwvConfig): string {
    switch (config.stemming.method) {
        case "indonesian":
            return "Indonesian";
        case "english":
            return "English";
        default:
            return "None";
    }
}

function describeTokenizer(config: StwvConfig): string {
    const { type, minSize, maxSize } = config.tokenizer;
    return type === "ngram" ? `N-gram (min ${minSize}, max ${maxSize})` : "Word (unigram)";
}

/** Jumlah baris yang seluruh nilainya 0 (dokumen kosong / semua token terbuang). */
export function countZeroRows(matrix: readonly (readonly number[])[]): number {
    return matrix.filter((row) => row.every((v) => v === 0)).length;
}

/** Jumlah dokumen dengan nilai ≠ 0 untuk kolom `col`. */
function countNonZero(matrix: readonly (readonly number[])[], col: number): number {
    let n = 0;
    for (const row of matrix) if ((row[col] ?? 0) !== 0) n++;
    return n;
}

/**
 * Menyusun isi Output Viewer untuk satu kali proses STWV (murni, tanpa store).
 * Tabel: Processing Summary, Settings, Vocabulary (maks. MAX_VOCABULARY_ROWS baris).
 */
export function buildStwvOutput(input: StwvOutputInput): StwvOutput {
    const { variableName, config, result, columnPrefix, columnNames, durationMs } = input;
    const total = result.matrix.length;
    const zeroRows = countZeroRows(result.matrix);
    const vocabSize = result.vocabulary.length;
    const first = columnNames[0];
    const last = columnNames[columnNames.length - 1];
    const std = FORMULA_STANDARDS[config.formulaStandard];

    const summaryRows: Table["rows"] = [
        { rowHeader: ["Source Variable"], value: variableName },
        { rowHeader: ["Documents (Rows)"], value: total },
        { rowHeader: ["Documents with Zero Vector"], value: zeroRows },
        { rowHeader: ["Vocabulary Size"], value: vocabSize },
        { rowHeader: ["Columns Added to Dataset"], value: columnNames.length },
        { rowHeader: ["Column Name Prefix"], value: columnPrefix },
        { rowHeader: ["First – Last Column"], value: first ? `${first} – ${last}` : "-" },
    ];
    if (durationMs !== undefined) {
        summaryRows.push({ rowHeader: ["Processing Time (ms)"], value: Math.round(durationMs) });
    }

    const summary: Table = {
        key: "stwv_processing_summary",
        title: "Processing Summary",
        columnHeaders: [
            { header: "", key: "label" },
            { header: "Value", key: "value" },
        ],
        rows: summaryRows,
        note:
            "Zero-vector documents are empty or whitespace-only texts, or texts whose tokens were all removed. " +
            "Rows stay aligned with the dataset. The vocabulary and any IDF or normalization values were " +
            "computed from the whole dataset, and String to Word Vector does not save them for use on new data.",
    };

    const settings: Table = {
        key: "stwv_settings",
        title: "Settings",
        columnHeaders: [
            { header: "", key: "label" },
            { header: "Value", key: "value" },
        ],
        rows: [
            { rowHeader: ["Formula Standard"], value: std.label },
            { rowHeader: ["Term Frequency (TF)"], value: optionLabel(std.tfOptions, config.vectorization.tfMethod) },
            { rowHeader: ["Inverse Document Frequency (IDF)"], value: optionLabel(std.idfOptions, config.vectorization.idfMethod) },
            { rowHeader: ["Normalization"], value: optionLabel(std.normOptions, config.vectorization.normalization) },
            { rowHeader: ["Convert to Lowercase"], value: config.lowercase ? "Yes" : "No" },
            { rowHeader: ["Stopwords"], value: describeStopwords(config) },
            { rowHeader: ["Stemming"], value: describeStemming(config) },
            { rowHeader: ["Tokenizer"], value: describeTokenizer(config) },
            { rowHeader: ["Delimiters (Regex)"], value: config.delimiters },
            { rowHeader: ["Words to Keep"], value: config.wordsToKeep === 0 ? "All" : config.wordsToKeep },
            { rowHeader: ["Minimum Term Frequency"], value: config.minTermFreq },
        ],
    };

    const shown = Math.min(vocabSize, MAX_VOCABULARY_ROWS);
    const vocabRows: Table["rows"] = [];
    for (let i = 0; i < shown; i++) {
        vocabRows.push({
            rowHeader: [String(i + 1)],
            term: result.vocabulary[i],
            column: columnNames[i] ?? "",
            documents: countNonZero(result.matrix, i),
        });
    }
    const vocabulary: Table = {
        key: "stwv_vocabulary",
        title: "Vocabulary",
        columnHeaders: [
            { header: "No", key: "no" },
            { header: "Term", key: "term" },
            { header: "Dataset Column", key: "column" },
            { header: "Documents (Non-zero)", key: "documents" },
        ],
        rows: vocabRows,
        note:
            vocabSize > shown
                ? `Showing the first ${shown} of ${vocabSize} terms (alphabetical, same order as the dataset columns).`
                : undefined,
    };

    const describeInput: StwvDescribeInput = {
        variableName,
        config,
        vocabulary: result.vocabulary,
        matrix: result.matrix,
        columnPrefix,
        columnNames,
        durationMs,
    };

    const tables: Table[] = [summary, settings];
    if (vocabSize > 0) tables.push(vocabulary);

    return {
        logText: `STRING TO WORD VECTOR ${variableName} /PREFIX=${columnPrefix}`,
        summaryText:
            `${columnNames.length === 1 ? "1 vector column was" : `${columnNames.length} vector columns were`} ` +
            `created from variable \`${variableName}\` and added as the last variables in the dataset ` +
            `(${total} documents, ${zeroRows} with a zero vector).`,
        summaryDescription: describeStwvSummary(describeInput),
        tableDescriptions: {
            stwv_processing_summary: describeStwvProcessingSummary(describeInput),
            stwv_settings: describeStwvSettings(describeInput),
            stwv_vocabulary: describeStwvVocabulary(describeInput, MAX_VOCABULARY_ROWS),
        },
        tables,
    };
}
