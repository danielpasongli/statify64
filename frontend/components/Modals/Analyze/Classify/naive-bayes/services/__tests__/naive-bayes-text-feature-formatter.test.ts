import {
    buildAttributeDistributionTable,
    buildCaseProcessingSummaryTable,
    getTrainedText,
    buildTextFeatureTable,
    TEXT_NO_PRIOR_NOTE,
    transformNaiveBayesResult,
    type NaiveBayesRawResult,
    type NaiveBayesTextFeatureTableRaw,
    type NaiveBayesTextFeaturesSummaryRaw,
    type NaiveBayesTrainedModelRaw,
    type NaiveBayesTrainedTextRaw,
} from "@/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-analysis-formatter";
import { getLeakageNote } from "@/components/Modals/Analyze/Classify/naive-bayes/hooks/useNaiveBayesTextRules";
import { readFileSync } from "fs";
import { join } from "path";

// Fixture dibaca lewat fs (bukan import JSON) agar `tsc -p frontend` (composite) tidak
// menolaknya dengan TS6307 karena JSON tidak masuk daftar file proyek.
const stubResult: unknown = JSON.parse(
    readFileSync(join(__dirname, "..", "__fixtures__", "naive-bayes-stub-result.json"), "utf8")
);
const stub = stubResult as unknown as NaiveBayesRawResult;

const FLAGS_V1 = {
    CaseProcessingSummary: true,
    AttributeDistributionTable: true,
    ModelEvaluationMetrics: true,
    ConfusionMatrix: true,
};

// Angka golden AGENTS_V2 §6.7 (Multinomial, kelas [neg, pos], kosakata
// [makan, nasi, saya, suka, tidak]); score = L_ct - L_c't (K = 2).
const TERMS = ["makan", "nasi", "saya", "suka", "tidak"];
const L_NEG = [-2.197225, -1.504077, -1.504077, -1.504077, -1.504077];
const L_POS = [-0.875469, -1.791759, -1.791759, -1.791759, -2.484907];
const N_NEG = [0, 1, 1, 1, 1];
const N_POS = [4, 1, 1, 1, 0];

const TFT: NaiveBayesTextFeatureTableRaw = {
    likelihood: "multinomial",
    classes: ["neg", "pos"],
    k: 3,
    top: {
        neg: [
            { term: "tidak", score: L_NEG[4] - L_POS[4], log_weight: L_NEG[4], count: N_NEG[4] },
            { term: "nasi", score: L_NEG[1] - L_POS[1], log_weight: L_NEG[1], count: N_NEG[1] },
            { term: "saya", score: L_NEG[2] - L_POS[2], log_weight: L_NEG[2], count: N_NEG[2] },
        ],
        pos: [
            { term: "makan", score: L_POS[0] - L_NEG[0], log_weight: L_POS[0], count: N_POS[0] },
            { term: "tidak", score: L_POS[4] - L_NEG[4], log_weight: L_POS[4], count: N_POS[4] },
            { term: "nasi", score: L_POS[1] - L_NEG[1], log_weight: L_POS[1], count: N_POS[1] },
        ],
    },
    full: TERMS.flatMap((term, t) => [
        { term, class: "neg", count: N_NEG[t], log_weight: L_NEG[t], probability: Math.exp(L_NEG[t]), score: L_NEG[t] - L_POS[t] },
        { term, class: "pos", count: N_POS[t], log_weight: L_POS[t], probability: Math.exp(L_POS[t]), score: L_POS[t] - L_NEG[t] },
    ]),
};

const textBlock = (over: Partial<NaiveBayesTrainedTextRaw>): NaiveBayesTrainedTextRaw => ({
    source: "raw",
    likelihood: "multinomial",
    alpha: 1,
    terms: TERMS,
    raw_variable: "Text Tweet",
    columns: null,
    log_weights: { neg: L_NEG, pos: L_POS },
    log_weights_absent: null,
    class_term_counts: { neg: N_NEG, pos: N_POS },
    uses_class_prior: true,
    recipe: { vocabulary: TERMS },
    ...over,
});

const valueOf = (table: ReturnType<typeof buildCaseProcessingSummaryTable>, label: string) =>
    table.rows.find((r) => r.rowHeader[0] === label)?.value;

describe("Case Processing Summary: baris Text (AGENTS_V2 §9)", () => {
    const base = stub.case_processing_summary!;

    it("tanpa blok text: tabel v1 TIDAK berubah (6 baris)", () => {
        const table = buildCaseProcessingSummaryTable(base);
        expect(table.rows.map((r) => r.rowHeader[0])).toEqual([
            "Total Instances",
            "Valid Instances",
            "Excluded (Target Missing)",
            "Target Variable",
            "Attribute Variables",
            "Validation Scenario",
        ]);
        expect(buildCaseProcessingSummaryTable(base, null)).toEqual(table);
        expect(buildCaseProcessingSummaryTable(base, undefined)).toEqual(table);
    });

    it("raw: Raw text '{var}' ({V} terms), likelihood, alpha; tanpa catatan W-LEAK", () => {
        const table = buildCaseProcessingSummaryTable(base, textBlock({}));
        expect(valueOf(table, "Text features")).toBe("Raw text: 'Text Tweet' (5 terms)");
        expect(valueOf(table, "Text likelihood")).toBe("Multinomial");
        expect(valueOf(table, "Text alpha")).toBe(1);
        expect(table.rows.some((r) => r.rowHeader[0] === "Note")).toBe(false);
        expect(table.rows).toHaveLength(9);
    });

    it("vector: Word vectors: {n} columns + catatan W-LEAK", () => {
        const table = buildCaseProcessingSummaryTable(
            base,
            textBlock({
                source: "vector",
                raw_variable: null,
                columns: ["VEC_a", "VEC_b", "VEC_c"],
                terms: ["VEC_a", "VEC_b", "VEC_c"],
                likelihood: "bernoulli",
                alpha: 0.5,
            })
        );
        expect(valueOf(table, "Text features")).toBe("Word vectors: 3 columns");
        expect(valueOf(table, "Text likelihood")).toBe("Bernoulli");
        expect(valueOf(table, "Text alpha")).toBe(0.5);
        // Teks LEAKAGE diambil dari getLeakageNote (milik fase T1), tidak disalin.
        expect(valueOf(table, "Note")).toBe(getLeakageNote("vector"));
    });
});

describe("buildTextFeatureTable", () => {
    it("baris per kelas berurutan dengan Rank mulai 1 dan angka golden §6.7", () => {
        const table = buildTextFeatureTable(TFT);
        expect(table.key).toBe("text_feature_table");
        expect(table.title).toBe("Text Feature Table");
        expect(table.columnHeaders.map((c) => c.header)).toEqual([
            "Class", "Rank", "Term", "Score", "Log weight", "Count",
        ]);
        expect(table.rows).toHaveLength(6);
        expect(table.rows[0].rowHeader).toEqual(["neg", "1"]);
        expect(table.rows[0].term).toBe("tidak");
        // 0.98083 = -1.504077 - (-2.484907)
        expect(table.rows[0].score).toBeCloseTo(0.98083, 4);
        expect(table.rows[0].log_weight).toBeCloseTo(-1.504077, 4);
        expect(table.rows[3].rowHeader).toEqual(["pos", "1"]);
        expect(table.rows[3].term).toBe("makan");
        expect(table.rows[3].count).toBe(4);
        expect(table.note).toContain("Top 3");
    });

    it("tidak membawa data `full` ke dalam tabel", () => {
        expect(JSON.stringify(buildTextFeatureTable(TFT))).not.toContain("probability");
    });

    it("k lebih kecil dari panjang `top` memotong baris", () => {
        const table = buildTextFeatureTable({ ...TFT, k: 1 });
        expect(table.rows.map((r) => r.rowHeader)).toEqual([["neg", "1"], ["pos", "1"]]);
    });

    it("kelas tanpa entri tidak menimbulkan galat", () => {
        const table = buildTextFeatureTable({ ...TFT, classes: ["neg", "pos", "netral"] });
        expect(table.rows).toHaveLength(6);
    });
});

describe("transformNaiveBayesResult", () => {
    it("v1: hasil stub identik dengan empat kelompok tabel v1 (regresi nol)", () => {
        const result = transformNaiveBayesResult(stub, FLAGS_V1);
        expect(result.tables.map((t) => t.key)).toEqual([
            "case_processing_summary",
            "attribute_distribution_table",
            "evaluation_metrics",
            "evaluation_metrics_kappa",
            "confusion_matrix",
        ]);
        // Tidak ada baris Text pada Case Processing Summary v1.
        expect(result.tables[0].rows).toHaveLength(6);
    });

    it("v1 + flag TextFeatureTable=true tanpa text_feature_table: tabel Text diabaikan", () => {
        const result = transformNaiveBayesResult(stub, { ...FLAGS_V1, TextFeatureTable: true });
        expect(result.tables.some((t) => t.key === "text_feature_table")).toBe(false);
        expect(result.tables).toHaveLength(5);
    });

    it("dengan text_feature_table + flag true: tabel Text ditambahkan di akhir", () => {
        const raw: NaiveBayesRawResult = { ...stub, text_feature_table: TFT };
        const result = transformNaiveBayesResult(raw, { ...FLAGS_V1, TextFeatureTable: true });
        expect(result.tables[result.tables.length - 1].key).toBe("text_feature_table");
    });

    it("flag TextFeatureTable=false atau tidak diberikan: tabel Text tidak dibangun", () => {
        const raw: NaiveBayesRawResult = { ...stub, text_feature_table: TFT };
        expect(
            transformNaiveBayesResult(raw, { ...FLAGS_V1, TextFeatureTable: false }).tables.some(
                (t) => t.key === "text_feature_table"
            )
        ).toBe(false);
        expect(
            transformNaiveBayesResult(raw, FLAGS_V1).tables.some((t) => t.key === "text_feature_table")
        ).toBe(false);
    });

    it("baris Text pada Case Processing Summary diambil dari trained_model.text", () => {
        const raw: NaiveBayesRawResult = {
            ...stub,
            trained_model: {
                ...stub.trained_model!,
                schema_version: "2.0",
                text: textBlock({}),
            } as unknown as NaiveBayesTrainedModelRaw,
        };
        const result = transformNaiveBayesResult(raw, FLAGS_V1);
        expect(valueOf(result.tables[0], "Text features")).toBe("Raw text: 'Text Tweet' (5 terms)");
    });
});

// --- Penyesuaian setelah N4: bentuk JSON Rust yang sebenarnya ---

const SUMMARY_RAW: NaiveBayesTextFeaturesSummaryRaw = {
    source: "raw",
    description: "Raw text: 'Teks' (1234 terms)",
    variable: "Teks",
    n_terms: 1234,
    likelihood: "multinomial",
    alpha: 1,
    uses_class_prior: true,
    leakage_note: null,
    class_prior_note: null,
};

describe("Case Processing Summary: case_processing_summary.text_features (N4)", () => {
    const base = stub.case_processing_summary!;

    it("text_features menjadi sumber utama (mengalahkan trained_model.text)", () => {
        const table = buildCaseProcessingSummaryTable(
            { ...base, text_features: SUMMARY_RAW },
            textBlock({ raw_variable: "Lain" })
        );
        expect(valueOf(table, "Text features")).toBe("Raw text: 'Teks' (1234 terms)");
        expect(valueOf(table, "Text likelihood")).toBe("Multinomial");
        expect(valueOf(table, "Text alpha")).toBe(1);
    });

    it("Complement tanpa prior: catatan class_prior_note tampil, tanpa tabel prior", () => {
        const note = TEXT_NO_PRIOR_NOTE;
        const table = buildCaseProcessingSummaryTable({
            ...base,
            text_features: {
                ...SUMMARY_RAW,
                likelihood: "complement",
                uses_class_prior: false,
                class_prior_note: note,
            },
        });
        expect(valueOf(table, "Text likelihood")).toBe("Complement");
        expect(valueOf(table, "Note")).toBe(note);
    });

    it("cadangan trained_model.text untuk Complement juga memberi catatan tanpa prior", () => {
        const table = buildCaseProcessingSummaryTable(
            base,
            textBlock({ likelihood: "complement", uses_class_prior: false })
        );
        expect(valueOf(table, "Note")).toBe(TEXT_NO_PRIOR_NOTE);
    });

    it("uses_class_prior=true: class_prior_note diabaikan", () => {
        const table = buildCaseProcessingSummaryTable({
            ...base,
            text_features: { ...SUMMARY_RAW, class_prior_note: "tidak dipakai" },
        });
        expect(table.rows.some((r) => r.rowHeader[0] === "Note")).toBe(false);
    });

    it("vector: catatan leakage ditampilkan memakai teks kanonik (bukan string Rust)", () => {
        const table = buildCaseProcessingSummaryTable({
            ...base,
            text_features: {
                ...SUMMARY_RAW,
                source: "vector",
                description: "Word vectors: 3 columns",
                variable: null,
                leakage_note: "catatan bocor",
            },
        });
        expect(valueOf(table, "Text features")).toBe("Word vectors: 3 columns");
        expect(valueOf(table, "Note")).toBe(getLeakageNote("vector"));
    });

    it("not_scored_rows: baris tampil (termasuk 0); tanpa nilai tidak ada baris (v1)", () => {
        const label = "Not Scored (All Predictors Missing)";
        expect(valueOf(buildCaseProcessingSummaryTable({ ...base, not_scored_rows: 2 }), label)).toBe(2);
        expect(valueOf(buildCaseProcessingSummaryTable({ ...base, not_scored_rows: 0 }), label)).toBe(0);
        expect(buildCaseProcessingSummaryTable(base).rows).toHaveLength(6);
    });

    it("transform: not_scored_rows level atas dipakai bila summary belum membawanya", () => {
        const raw: NaiveBayesRawResult = { ...stub, not_scored_rows: 3 };
        const table = transformNaiveBayesResult(raw, FLAGS_V1).tables[0];
        expect(valueOf(table, "Not Scored (All Predictors Missing)")).toBe(3);
    });
});

describe("Attribute Distribution Table: keterangan likelihood Numeric (N4)", () => {
    const attrs = stub.attribute_distribution!;

    it("tanpa likelihood_note: note identik v1", () => {
        const note = buildAttributeDistributionTable(attrs).note;
        expect(note).toMatch(/Numerical rows show the mean and standard deviation per class\.$/);
    });

    it("atribut gaussian_minstd menambah keterangan pada note", () => {
        const withNote = attrs.map((a) =>
            a.role === "numerical" && a.name === "PetalLength"
                ? { ...a, likelihood: "gaussian_minstd" as const, likelihood_note: "Gaussian (Weka min. std), min. variance = 0.01" }
                : a
        );
        const note = buildAttributeDistributionTable(withNote).note;
        expect(note).toContain("PetalLength: Gaussian (Weka min. std), min. variance = 0.01");
        expect(note).not.toContain("PetalWidth:");
        expect(buildAttributeDistributionTable(attrs).note).not.toContain("Numerical likelihood");
    });
});

describe("getTrainedText (union export 1.x | 2.0)", () => {
    it("1.x tanpa blok text, 2.0 text=null, 2.0 dengan text, model kosong", () => {
        expect(getTrainedText(stub.trained_model)).toBeNull();
        expect(getTrainedText(undefined)).toBeNull();
        const v2null = { ...stub.trained_model!, schema_version: "2.0", text: null } as unknown as NaiveBayesTrainedModelRaw;
        expect(getTrainedText(v2null)).toBeNull();
        const v2 = { ...stub.trained_model!, schema_version: "2.0", text: textBlock({ recipe: undefined, raw_variable: undefined }) } as unknown as NaiveBayesTrainedModelRaw;
        expect(getTrainedText(v2)?.source).toBe("raw");
    });
});
