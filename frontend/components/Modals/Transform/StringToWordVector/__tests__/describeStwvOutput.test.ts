import {
    ZERO_VECTOR_WARNING_SHARE,
    countNonZeroByColumn,
    countZeroVectorDocuments,
    describeStwvProcessingSummary,
    describeStwvSettings,
    describeStwvSummary,
    describeStwvVocabulary,
    type StwvDescribeInput,
} from "../utils/describeStwvOutput";
import { buildStwvOutput, MAX_VOCABULARY_ROWS } from "../utils/buildStwvOutput";
import { STWV_DEFAULT_CONFIG, applyFormulaStandard, type StwvConfig } from "../config";
import type { VectorizerOutput } from "../types";

// Korpus golden PLAN_FIX §3.6 (Weka raw/none/none): "Saya suka makan nasi", "Saya tidak suka nasi!", "Makan, makan, makan"
const GOLDEN_VOCAB = ["makan", "nasi", "saya", "suka", "tidak"];
const GOLDEN_RAW = [
    [1, 1, 1, 1, 0],
    [0, 1, 1, 1, 1],
    [3, 0, 0, 0, 0],
];
// Weka log1p/standard/none (angka acuan §3.6)
const GOLDEN_LOG1P = [
    [0.281047, 0.281047, 0.281047, 0.281047, 0],
    [0, 0.281047, 0.281047, 0.281047, 0.7615],
    [0.562094, 0, 0, 0, 0],
];

const base = (over: Partial<StwvDescribeInput> = {}): StwvDescribeInput => ({
    variableName: "teks",
    config: STWV_DEFAULT_CONFIG,
    vocabulary: GOLDEN_VOCAB,
    matrix: GOLDEN_RAW,
    columnPrefix: "VEC_",
    columnNames: GOLDEN_VOCAB.map((w) => `VEC_${w}`),
    ...over,
});

const ALL = (input: StwvDescribeInput) => [
    describeStwvSummary(input),
    describeStwvProcessingSummary(input),
    describeStwvSettings(input),
    describeStwvVocabulary(input, MAX_VOCABULARY_ROWS),
];

const wordCount = (html: string) => html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;

describe("helper penghitung", () => {
    it("countZeroVectorDocuments dan countNonZeroByColumn pada korpus golden", () => {
        expect(countZeroVectorDocuments(GOLDEN_RAW)).toBe(0);
        expect(countZeroVectorDocuments([[0, 0], [1, 0], [0, 0]])).toBe(2);
        expect(countNonZeroByColumn(GOLDEN_RAW, 5)).toEqual([2, 2, 2, 2, 1]);
    });
});

describe("describeStwv* — kasus normal (korpus golden 3 dokumen)", () => {
    it("Summary menyebut dokumen, kosakata, kolom, dan prefiks", () => {
        const html = describeStwvSummary(base());
        expect(html).toContain("3 documents were processed");
        expect(html).toContain("5 terms");
        expect(html).toContain("5 columns were added");
        expect(html).toContain("<strong>VEC_</strong>");
        expect(html).toContain("<strong>VEC_makan</strong>");
        expect(html).toContain("<strong>VEC_tidak</strong>");
        expect(html).not.toContain("<strong>Note.</strong>");
    });

    it("Processing Summary: 0 dokumen nol, waktu proses, dan catatan tanpa resep", () => {
        const html = describeStwvProcessingSummary(base({ durationMs: 12.4 }));
        expect(html).toContain("0 of 3 documents (0.0%) have a zero vector.");
        expect(html).toContain("Processing took 12 ms.");
        expect(html).toContain("does not save a reusable recipe");
        expect(html).toContain("<strong>Note.</strong>");
    });

    it("Settings default Weka: word counts tanpa IDF dan tanpa normalisasi", () => {
        const html = describeStwvSettings(base());
        expect(html).toContain("With the Weka standard, cell values are word counts, without IDF weighting and without row normalization.");
        expect(html).toContain("no stopwords are removed");
        expect(html).toContain("no stemming is applied");
        expect(html).toContain("at most 1000 words are kept");
        expect(html).toContain("at least 1 time in total");
        expect(html).not.toContain("<strong>Note.</strong>");
    });

    it("Settings sklearn raw/smooth/l2 dan Weka log1p/standard", () => {
        const sk = describeStwvSettings(base({ config: applyFormulaStandard(STWV_DEFAULT_CONFIG, "sklearn") }));
        expect(sk).toContain("scikit-learn standard");
        expect(sk).toContain("smoothed IDF = ln((1 + N) / (1 + df)) + 1");
        expect(sk).toContain("unit L2 length");
        const weka: StwvConfig = {
            ...STWV_DEFAULT_CONFIG,
            vectorization: { tfMethod: "log1p", idfMethod: "standard", normalization: "none" },
        };
        const html = describeStwvSettings(base({ config: weka, matrix: GOLDEN_LOG1P }));
        expect(html).toContain("log-scaled word counts, ln(1 + f)");
        expect(html).toContain("IDF = ln(N / df)");
    });

    it("Settings: stopword custom, stemming, n-gram, Words to Keep 0, catatan stemming tanpa lowercase", () => {
        const html = describeStwvSettings(
            base({
                config: {
                    ...STWV_DEFAULT_CONFIG,
                    lowercase: false,
                    stopwords: { method: "custom", customList: "a\nb\n\nc" },
                    stemming: { method: "indonesian" },
                    tokenizer: { type: "ngram", minSize: 1, maxSize: 2 },
                    wordsToKeep: 0,
                    minTermFreq: 3,
                },
            })
        );
        expect(html).toContain("a custom list of 3 stopwords is removed");
        expect(html).toContain("Indonesian stemming (Sastrawi) is applied");
        expect(html).toContain("n-grams of size 1 to 2");
        expect(html).toContain("all words are kept");
        expect(html).toContain("at least 3 times in total");
        expect(html).toContain("<strong>Note.</strong>");
        expect(html).toContain("Lowercase setting has no effect");
        expect(html).toContain("vocabulary can grow quickly");
    });

    it("Vocabulary: 5 term teratas menurut dokumen non-nol (urutan seri = urutan kosakata)", () => {
        const html = describeStwvVocabulary(base(), MAX_VOCABULARY_ROWS);
        expect(html).toContain(
            "<strong>makan</strong> in 2 documents (66.7%); <strong>nasi</strong> in 2 documents (66.7%); " +
                "<strong>saya</strong> in 2 documents (66.7%); <strong>suka</strong> in 2 documents (66.7%); " +
                "<strong>tidak</strong> in 1 document (33.3%)"
        );
        expect(html).not.toContain("<strong>Note.</strong>");
    });

    it("Vocabulary: lebih dari 5 term hanya menyebut 5 teratas, dan batas baris ditulis di Note", () => {
        const n = MAX_VOCABULARY_ROWS + 5;
        const vocabulary = Array.from({ length: n }, (_, i) => `w${String(i).padStart(3, "0")}`);
        const matrix = [vocabulary.map((_, i) => (i === 7 ? 1 : i % 2))];
        const html = describeStwvVocabulary(base({ vocabulary, matrix, columnNames: vocabulary }), MAX_VOCABULARY_ROWS);
        expect(html).toContain("The 5 terms found in the most documents are");
        expect(html).toContain(`Only the first ${MAX_VOCABULARY_ROWS} of ${n} terms are listed here; all ${n} columns were added`);
    });

    it("panjang tiap interpretasi 60–220 kata dan hanya memakai tag yang diizinkan", () => {
        for (const html of ALL(base({ durationMs: 5 }))) {
            const words = wordCount(html);
            expect(words).toBeGreaterThanOrEqual(60);
            expect(words).toBeLessThanOrEqual(220);
            const tags = (html.match(/<\/?([a-z]+)/g) ?? []).map((t) => t.replace(/[</]/g, ""));
            for (const tag of tags) expect(["p", "strong", "em", "ul", "li"]).toContain(tag);
        }
    });
});

describe("describeStwv* — dokumen kosong sebagian", () => {
    const matrix = [[1, 1], [0, 0], [0, 0], [3, 0]];
    const input = base({ vocabulary: ["a", "b"], matrix, columnNames: ["VEC_a", "VEC_b"] });

    it("Processing Summary menghitung jumlah dan persen dokumen vektor nol (> ambang → saran)", () => {
        const html = describeStwvProcessingSummary(input);
        expect(html).toContain("2 of 4 documents (50.0%) have a zero vector.");
        expect(html).toContain(`more than ${(ZERO_VECTOR_WARNING_SHARE * 100).toFixed(1)}% of the rows`);
        expect(html).toContain("consider relaxing");
    });

    it("tepat 1 dokumen nol memakai bentuk tunggal dan Summary memuat Note", () => {
        const one = base({ matrix: [[1, 0], [0, 0]], vocabulary: ["a", "b"], columnNames: ["x", "y"] });
        expect(describeStwvProcessingSummary(one)).toContain("1 of 2 documents (50.0%) has a zero vector.");
        const summary = describeStwvSummary(one);
        expect(summary).toContain("<strong>Note.</strong>");
        expect(summary).toContain("1 document has a zero vector");
    });

    it("di bawah ambang tidak memberi saran melonggarkan opsi", () => {
        const matrix20 = Array.from({ length: 20 }, (_, i) => (i === 0 ? [0, 0] : [1, 0]));
        const html = describeStwvProcessingSummary(
            base({ matrix: matrix20, vocabulary: ["a", "b"], columnNames: ["x", "y"] })
        );
        expect(html).toContain("1 of 20 documents (5.0%) has a zero vector.");
        expect(html).not.toContain("consider relaxing");
    });
});

describe("describeStwv* — data hilang / tidak sah", () => {
    const badInputs: [string, StwvDescribeInput][] = [
        ["kosong", base({ vocabulary: [], matrix: [], columnNames: [] })],
        [
            "tipe salah",
            base({
                vocabulary: undefined as unknown as string[],
                matrix: null as unknown as number[][],
                columnNames: undefined as unknown as string[],
                durationMs: Number.NaN,
            })
        ],
        ["durasi tak terhingga/negatif", base({ durationMs: -5 })],
        ["baris bukan array", base({ matrix: [null as unknown as number[], [1, 0, 0, 0, 0]] })],
        [
            "setelan tak sah",
            base({ config: { ...STWV_DEFAULT_CONFIG, wordsToKeep: Number.NaN, minTermFreq: Number.NaN } }),
        ],
    ];

    it.each(badInputs)("tidak membocorkan undefined/NaN/Infinity/[object Object] (%s)", (_name, input) => {
        for (const html of ALL(input)) {
            expect(html.length).toBeGreaterThan(0);
            expect(html).not.toMatch(/undefined|NaN|Infinity|\[object Object\]|null/);
        }
    });

    it("tanpa dokumen dan kosakata: kalimat generik tanpa angka", () => {
        const empty = base({ vocabulary: [], matrix: [], columnNames: [] });
        expect(describeStwvSummary(empty)).toContain("The result contains no documents or terms.");
        expect(describeStwvProcessingSummary(empty)).toContain("The result contains no documents.");
        expect(describeStwvVocabulary(empty, MAX_VOCABULARY_ROWS)).toContain("The vocabulary is empty.");
    });

    it("durasi tidak sah tidak menulis kalimat waktu", () => {
        expect(describeStwvProcessingSummary(base({ durationMs: -5 }))).not.toContain("Processing took");
        expect(describeStwvProcessingSummary(base({ durationMs: Number.NaN }))).not.toContain("Processing took");
    });
});

describe("describeStwv* — escape HTML", () => {
    it("nama variabel, prefiks, nama kolom, dan term di-escape", () => {
        const html = ALL(
            base({
                variableName: 'a<b>&"c"',
                columnPrefix: "<i>_",
                vocabulary: ["<script>", "x&y"],
                matrix: [[1, 1]],
                columnNames: ["<i>_<script>", "<i>_x&y"],
            })
        ).join("\n");
        expect(html).not.toContain("<script>");
        expect(html).not.toContain("<b>");
        expect(html).not.toContain("<i>");
        expect(html).toContain("&lt;script&gt;");
        expect(html).toContain("a&lt;b&gt;&amp;&quot;c&quot;");
        expect(html).toContain("x&amp;y");
    });
});

describe("buildStwvOutput menyertakan interpretasi", () => {
    const result: VectorizerOutput = {
        vocabulary: GOLDEN_VOCAB,
        matrix: GOLDEN_RAW,
        stats: { total_documents: 3, vocabulary_size: 5, method: "x" },
    };
    const out = buildStwvOutput({
        variableName: "teks",
        config: STWV_DEFAULT_CONFIG,
        result,
        columnPrefix: "VEC_",
        columnNames: GOLDEN_VOCAB.map((w) => `VEC_${w}`),
        durationMs: 3,
    });

    it("setiap statistic punya description non-kosong berbahasa Inggris", () => {
        expect(out.summaryDescription.length).toBeGreaterThan(0);
        for (const table of out.tables) {
            const d = out.tableDescriptions[table.key];
            expect(typeof d).toBe("string");
            expect(d.length).toBeGreaterThan(0);
            expect(d).toContain("<strong>What this shows.</strong>");
        }
    });

    it("tabel dan description sejalan (Processing Summary memuat angka yang sama)", () => {
        expect(out.tableDescriptions["stwv_processing_summary"]).toContain("0 of 3 documents");
        expect(out.tableDescriptions["stwv_vocabulary"]).toContain("<strong>makan</strong>");
    });
});
