import type { StwvConfig } from "../config";
import { FORMULA_STANDARDS } from "../constants/formula-standards";

/**
 * Interpretasi otomatis (HTML, bahasa Inggris) untuk setiap item Output Viewer STWV.
 * Semua fungsi murni dan deterministik (templat + angka hasil run), tanpa AI/LLM saat runtime
 * (PLAN_V3 §0 E4, §3.4). Hanya tag <p>, <strong>, <em>, <ul>, <li> yang dihasilkan.
 * Nilai dari data di-escape; data hilang/NaN menghasilkan kalimat generik tanpa angka.
 */

/** Data minimum yang dibutuhkan untuk menyusun semua interpretasi. */
export interface StwvDescribeInput {
    /** Nama variabel teks sumber. */
    variableName: string;
    config: StwvConfig;
    vocabulary: readonly string[];
    /** Matriks dokumen × term (dense), sejajar dengan baris dataset. */
    matrix: readonly (readonly number[])[];
    /** Awalan nama kolom yang dimasukkan pengguna. */
    columnPrefix: string;
    /** Nama final kolom yang ditambahkan, sejajar dengan vocabulary. */
    columnNames: readonly string[];
    /** Lama proses vektorisasi (ms); opsional. */
    durationMs?: number;
}

/** Ambang proporsi dokumen bervektor nol yang memicu saran melonggarkan opsi (ditulis apa adanya di teks). */
export const ZERO_VECTOR_WARNING_SHARE = 0.1;

/** Jumlah term teratas yang disebut pada interpretasi Vocabulary. */
const TOP_TERMS = 5;

// ──────────────────────────────────────────────────────────────────────────────
// Helper kecil
// ──────────────────────────────────────────────────────────────────────────────

function escapeHtml(value: unknown): string {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

const strong = (value: unknown): string => `<strong>${escapeHtml(value)}</strong>`;

/** Satu paragraf berjudul pola §3.4. */
const section = (title: string, body: string): string => `<p><strong>${title}.</strong> ${body}</p>`;

/** Bilangan bulat tak negatif yang terbatas, atau null bila tidak sah. */
function toCount(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function plural(count: number, singular: string, pluralForm: string = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Persentase 1 desimal (PLAN §2), mis. 0.333 → "33.3%". */
function formatPercent(share: number): string {
    return `${(share * 100).toFixed(1)}%`;
}

function safeMatrix(matrix: unknown): readonly (readonly number[])[] {
    return Array.isArray(matrix) ? (matrix as readonly (readonly number[])[]) : [];
}

function safeVocabulary(vocabulary: unknown): readonly string[] {
    return Array.isArray(vocabulary) ? (vocabulary as readonly string[]) : [];
}

/** Jumlah dokumen (baris) yang seluruh nilainya 0; baris yang bukan array dianggap nol. */
export function countZeroVectorDocuments(matrix: readonly (readonly number[])[]): number {
    let zero = 0;
    for (const row of safeMatrix(matrix)) {
        if (!Array.isArray(row) || row.every((v) => v === 0)) zero++;
    }
    return zero;
}

/** Jumlah dokumen dengan nilai ≠ 0 untuk setiap kolom (satu lintasan atas matriks). */
export function countNonZeroByColumn(
    matrix: readonly (readonly number[])[],
    columnCount: number
): number[] {
    const counts: number[] = new Array<number>(Math.max(0, columnCount)).fill(0);
    for (const row of safeMatrix(matrix)) {
        if (!Array.isArray(row)) continue;
        for (let j = 0; j < counts.length; j++) {
            if ((row[j] ?? 0) !== 0) counts[j]++;
        }
    }
    return counts;
}

// ──────────────────────────────────────────────────────────────────────────────
// Frasa pengaturan (dipakai di Settings)
// ──────────────────────────────────────────────────────────────────────────────

const TF_PHRASE: Record<StwvConfig["vectorization"]["tfMethod"], string> = {
    binary: "term presence (1 if the term occurs in the document, otherwise 0)",
    raw: "word counts",
    log1p: "log-scaled word counts, ln(1 + f)",
    sublinear: "sublinear word counts, 1 + ln(f)",
    normalized: "word counts divided by the number of tokens in the document",
};

const IDF_PHRASE: Record<StwvConfig["vectorization"]["idfMethod"], string> = {
    none: "without IDF weighting",
    standard: "weighted by IDF = ln(N / df)",
    smooth: "weighted by smoothed IDF = ln((1 + N) / (1 + df)) + 1",
    plus1: "weighted by IDF = ln(N / df) + 1",
};

const NORM_PHRASE: Record<StwvConfig["vectorization"]["normalization"], string> = {
    none: "without row normalization",
    l2: "with each document vector scaled to unit L2 length",
    l1: "with each document vector scaled so its absolute values sum to 1",
    doc_length: "with each document vector rescaled by the average vector length (document-length normalization)",
};

function stopwordPhrase(config: StwvConfig): string {
    switch (config.stopwords.method) {
        case "indonesian":
            return "the built-in Indonesian stopword list is removed";
        case "english":
            return "the built-in English stopword list is removed";
        case "custom": {
            const n = config.stopwords.customList.split("\n").map((s) => s.trim()).filter(Boolean).length;
            return `a custom list of ${plural(n, "stopword")} is removed`;
        }
        default:
            return "no stopwords are removed";
    }
}

function stemmingPhrase(config: StwvConfig): string {
    switch (config.stemming.method) {
        case "indonesian":
            return "Indonesian stemming (Sastrawi) is applied";
        case "english":
            return "English stemming (Porter) is applied";
        default:
            return "no stemming is applied";
    }
}

function tokenizerPhrase(config: StwvConfig): string {
    const { type, minSize, maxSize } = config.tokenizer;
    if (type !== "ngram") return "single words (unigrams)";
    return minSize === maxSize ? `n-grams of size ${minSize}` : `n-grams of size ${minSize} to ${maxSize}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Interpretasi per output
// ──────────────────────────────────────────────────────────────────────────────

/** Ringkasan (komponen "Executed"). */
export function describeStwvSummary(input: StwvDescribeInput): string {
    const matrix = safeMatrix(input.matrix);
    const documents = matrix.length;
    const vocabSize = safeVocabulary(input.vocabulary).length;
    const columns = Array.isArray(input.columnNames) ? input.columnNames.length : vocabSize;
    const zero = countZeroVectorDocuments(matrix);

    const what =
        `A confirmation that String to Word Vector converted the text in ${strong(input.variableName)} ` +
        "into numeric columns and added them to the dataset.";
    const how =
        "Each term kept in the vocabulary became one numeric column and each dataset row is one document. " +
        "A cell holds the weight of that term in that document under the selected formula.";

    let findings: string;
    if (documents === 0 && vocabSize === 0) {
        findings = "The result contains no documents or terms.";
    } else {
        const first = input.columnNames?.[0];
        const last = input.columnNames?.[columns - 1];
        const range =
            first !== undefined && last !== undefined
                ? ` (from ${strong(first)} to ${strong(last)})`
                : "";
        findings =
            `${plural(documents, "document")} ${documents === 1 ? "was" : "were"} processed. ` +
            `The vocabulary has ${plural(vocabSize, "term")}, so ${plural(columns, "column")} ` +
            `${columns === 1 ? "was" : "were"} added with the prefix ${strong(input.columnPrefix)}${range}.`;
    }

    const parts = [section("What this shows", what), section("How to read it", how), section("Key findings", findings)];
    if (documents > 0 && zero > 0) {
        parts.push(
            section(
                "Note",
                `${plural(zero, "document")} ${zero === 1 ? "has" : "have"} a zero vector, so ` +
                    `${zero === 1 ? "its row contains" : "their rows contain"} only zeros. See Processing Summary for details.`
            )
        );
    }
    return parts.join("\n");
}

/** Tabel Processing Summary. */
export function describeStwvProcessingSummary(input: StwvDescribeInput): string {
    const matrix = safeMatrix(input.matrix);
    const documents = matrix.length;
    const zero = countZeroVectorDocuments(matrix);
    const duration = toCount(input.durationMs);

    const what =
        "Counts the documents, how many of them ended up with no features, the vocabulary size, " +
        "the columns added to the dataset and the processing time.";
    const how =
        "A zero-vector document is an empty or whitespace-only text, or a text whose tokens were all removed by " +
        "stopwords, Min term frequency or Words to Keep. Such rows are kept so the new columns stay aligned with the dataset rows.";

    let findings: string;
    if (documents === 0) {
        findings = "The result contains no documents.";
    } else {
        findings =
            `${zero} of ${plural(documents, "document")} (${formatPercent(zero / documents)}) ` +
            `${zero === 1 ? "has" : "have"} a zero vector.`;
        if (zero / documents > ZERO_VECTOR_WARNING_SHARE) {
            findings +=
                ` This is more than ${formatPercent(ZERO_VECTOR_WARNING_SHARE)} of the rows; ` +
                "consider relaxing the stopword, Min term frequency or Words to Keep settings.";
        }
    }
    if (duration !== null) findings += ` Processing took ${duration} ms.`;

    const note =
        "The vocabulary and any IDF or normalization values were computed from the whole dataset, " +
        "and String to Word Vector does not save a reusable recipe for new data. " +
        "Evaluating a model on these columns may therefore give slightly optimistic results.";

    return [
        section("What this shows", what),
        section("How to read it", how),
        section("Key findings", findings),
        section("Note", note),
    ].join("\n");
}

/** Tabel Settings. */
export function describeStwvSettings(input: StwvDescribeInput): string {
    const { config } = input;
    const standard = FORMULA_STANDARDS[config.formulaStandard];
    const v = config.vectorization;

    const what = "Lists the preprocessing and weighting options that were used to build the word vectors.";
    const how =
        "TF is the term frequency inside one document, IDF down-weights terms that occur in many documents, " +
        "and normalization rescales each document vector.";

    const weights =
        `With the ${standard.label} standard, cell values are ${TF_PHRASE[v.tfMethod]}, ` +
        `${IDF_PHRASE[v.idfMethod]} and ${NORM_PHRASE[v.normalization]}.`;
    const ranking =
        config.formulaStandard === "custom" ? "the sum of TF × IDF" : "total word count across all documents";
    const wordsToKeep = toCount(config.wordsToKeep);
    const keep =
        wordsToKeep === null
            ? "the number of kept words follows the Words to Keep setting"
            : wordsToKeep === 0
              ? "all words are kept"
              : `at most ${plural(wordsToKeep, "word")} ${wordsToKeep === 1 ? "is" : "are"} kept (ranked by ${ranking})`;
    const minFreq = toCount(config.minTermFreq);
    const prep =
        `Text is ${config.lowercase ? "converted to lowercase" : "not converted to lowercase"}; ` +
        `${stopwordPhrase(config)}; ${stemmingPhrase(config)}. ` +
        `Tokens are ${tokenizerPhrase(config)}; ${keep}` +
        (minFreq === null ? "." : `, and terms must occur at least ${plural(minFreq, "time")} in total.`);

    const parts = [
        section("What this shows", what),
        section("How to read it", how),
        section("Key findings", `${weights} ${prep}`),
    ];

    const notes: string[] = [];
    if (config.stemming.method !== "none" && !config.lowercase) {
        notes.push("Stemming always converts tokens to lowercase, so the Lowercase setting has no effect here.");
    }
    if (config.tokenizer.type === "ngram") {
        notes.push("Every distinct n-gram becomes its own column, so the vocabulary can grow quickly.");
    }
    if (notes.length > 0) parts.push(section("Note", notes.join(" ")));
    return parts.join("\n");
}

/** Tabel Vocabulary; `displayLimit` = batas baris tabel di Output Viewer. */
export function describeStwvVocabulary(input: StwvDescribeInput, displayLimit: number): string {
    const vocabulary = safeVocabulary(input.vocabulary);
    const matrix = safeMatrix(input.matrix);
    const documents = matrix.length;
    const vocabSize = vocabulary.length;

    const what =
        "Lists the terms of the vocabulary in alphabetical order, the dataset column each term was written to, " +
        "and the number of documents in which that column is not zero.";
    const how =
        "A high document count means the term appears in many documents; a count of 1 means it appears in a single document only. " +
        "Terms are listed in the same order as the new dataset columns.";

    let findings: string;
    if (vocabSize === 0) {
        findings = "The vocabulary is empty.";
    } else {
        const counts = countNonZeroByColumn(matrix, vocabSize);
        const ranked = counts
            .map((count, index) => ({ count, index }))
            .sort((a, b) => b.count - a.count || a.index - b.index)
            .slice(0, TOP_TERMS);
        const items = ranked.map(({ count, index }) => {
            const share = documents > 0 ? ` (${formatPercent(count / documents)})` : "";
            return `${strong(vocabulary[index])} in ${plural(count, "document")}${share}`;
        });
        findings =
            `The vocabulary has ${plural(vocabSize, "term")}. ` +
            `The ${ranked.length === 1 ? "term" : `${ranked.length} terms`} found in the most documents ` +
            `${ranked.length === 1 ? "is" : "are"}: ${items.join("; ")}.`;
    }

    const parts = [section("What this shows", what), section("How to read it", how), section("Key findings", findings)];
    if (vocabSize > displayLimit) {
        parts.push(
            section(
                "Note",
                `Only the first ${displayLimit} of ${vocabSize} terms are listed here; all ${vocabSize} columns were added to the dataset.`
            )
        );
    }
    return parts.join("\n");
}
