import { readFileSync } from "fs";
import { join } from "path";
import {
    describeAttributeDistribution,
    describeCaseProcessingSummary,
    describeCohensKappa,
    describeConfusionMatrix,
    describeEvaluationMetrics,
    describeExportModel,
    describeTextFeatureTable,
    escapeHtml,
    kappaCategory,
} from "@/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-interpretation";
import {
    TEXT_NO_PRIOR_NOTE,
    type NaiveBayesAttributeDistributionRaw,
    type NaiveBayesConfusionMatrixRaw,
    type NaiveBayesEvaluationMetricsRaw,
    type NaiveBayesRawResult,
    type NaiveBayesTextFeatureTableRaw,
} from "@/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-analysis-formatter";
import { getLeakageNote } from "@/components/Modals/Analyze/Classify/naive-bayes/hooks/useNaiveBayesTextRules";

const stub = JSON.parse(
    readFileSync(join(__dirname, "..", "__fixtures__", "naive-bayes-stub-result.json"), "utf8")
) as NaiveBayesRawResult;

/** Teks polos dari HTML (tanpa tag), untuk menghitung kata. */
const plain = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ");
const wordCount = (html: string): number => plain(html).split(/\s+/).filter(Boolean).length;
const tagsOf = (html: string): string[] =>
    Array.from(html.matchAll(/<\/?([a-z]+)/gi)).map((m) => m[1].toLowerCase());

/** Aturan umum §3.4: hanya tag yang diizinkan dan tidak ada nilai kotor. */
const expectCleanHtml = (html: string) => {
    expect(html.length).toBeGreaterThan(0);
    tagsOf(html).forEach((tag) => expect(["p", "strong", "em", "ul", "li"]).toContain(tag));
    expect(html).not.toMatch(/NaN|undefined|\[object|Infinity|AGENTS|§/);
};

// ---- data golden ----
const CONFUSION_2: NaiveBayesConfusionMatrixRaw = {
    classes: ["a", "b"],
    matrix: [
        [40, 10],
        [5, 45],
    ],
    row_totals: [50, 50],
    col_totals: [45, 55],
    grand_total: 100,
    percentages: [
        [80, 20],
        [10, 90],
    ],
};

const METRICS_2: NaiveBayesEvaluationMetricsRaw = {
    classes: ["a", "b"],
    per_class: [
        { class: "a", accuracy: 0.85, precision: 0.889, recall: 0.8, f1: 0.842 },
        { class: "b", accuracy: 0.85, precision: 0.818, recall: 0.9, f1: 0.857 },
    ],
    macro_avg: { precision: 0.853, recall: 0.85, f1: 0.85 },
    weighted_avg: { precision: 0.853, recall: 0.85, f1: 0.85 },
    micro_avg: { precision: 0.85, recall: 0.85, f1: 0.85 },
    overall_accuracy: 0.85,
    cohens_kappa: 0.7,
};

describe("escapeHtml", () => {
    it("meng-escape & < > \"", () => {
        expect(escapeHtml(`<b>"x" & y</b>`)).toBe("&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;");
    });
});

describe("describeCohensKappa", () => {
    it.each([
        [-0.1, "poor"],
        [0, "slight"],
        [0.2, "slight"],
        [0.21, "fair"],
        [0.4, "fair"],
        [0.41, "moderate"],
        [0.6, "moderate"],
        [0.61, "substantial"],
        [0.8, "substantial"],
        [0.81, "almost perfect"],
        [1, "almost perfect"],
    ])("kappa %f -> %s (Landis & Koch)", (kappa, label) => {
        expect(kappaCategory(kappa)).toBe(label);
        const html = describeCohensKappa(kappa);
        expect(html).toContain(`<em>${label}</em>`);
        expectCleanHtml(html);
    });

    it("menyebut nilai 3 desimal dan panjang 60-220 kata", () => {
        const html = describeCohensKappa(0.917);
        expect(html).toContain("0.917");
        expect(wordCount(html)).toBeGreaterThanOrEqual(60);
        expect(wordCount(html)).toBeLessThanOrEqual(220);
    });

    it.each([null, undefined, NaN, Infinity])("nilai %p: kalimat generik tanpa angka", (value) => {
        const html = describeCohensKappa(value as number | null | undefined);
        expect(html).toContain("not available");
        expectCleanHtml(html);
    });
});

describe("describeConfusionMatrix", () => {
    it("data stub 3 kelas: diagonal 43 dari 45 dan salah klasifikasi terbanyak", () => {
        const html = describeConfusionMatrix(stub.confusion_matrix!);
        expect(html).toContain("43 rows out of 45");
        expect(html).toContain("95.6%");
        expect(html).toContain("actual 'versicolor' predicted as 'virginica' (1 row)");
        expect(wordCount(html)).toBeGreaterThanOrEqual(60);
        expect(wordCount(html)).toBeLessThanOrEqual(220);
        expectCleanHtml(html);
    });

    it("tanpa kesalahan: tertulis tidak ada baris salah klasifikasi", () => {
        const html = describeConfusionMatrix({
            ...CONFUSION_2,
            matrix: [
                [5, 0],
                [0, 5],
            ],
        });
        expect(html).toContain("no misclassified rows");
        expectCleanHtml(html);
    });

    it("data hilang/NaN tidak bocor ke HTML", () => {
        const broken = {
            classes: ["a", "b"],
            matrix: [[NaN, undefined], []],
        } as unknown as NaiveBayesConfusionMatrixRaw;
        const html = describeConfusionMatrix(broken);
        expect(html).toContain("no evaluated rows");
        expectCleanHtml(html);
        expectCleanHtml(describeConfusionMatrix({} as NaiveBayesConfusionMatrixRaw));
    });

    it("nama kelas '<b>' di-escape", () => {
        const html = describeConfusionMatrix({
            ...CONFUSION_2,
            classes: ["<b>", "b"],
        });
        expect(html).toContain("&lt;b&gt;");
        expect(html).not.toContain("<b>");
        expectCleanHtml(html);
    });
});

describe("describeEvaluationMetrics", () => {
    it("2 kelas: accuracy vs NIR, F1, recall terendah", () => {
        const html = describeEvaluationMetrics(METRICS_2, CONFUSION_2);
        expect(html).toContain("Overall accuracy is 0.850");
        expect(html).toContain("no-information rate");
        expect(html).toContain("is 0.500");
        expect(html).toContain("exceeds it by 0.350");
        expect(html).toContain("Macro F1 is 0.850 and weighted F1 is 0.850");
        expect(html).toContain("lowest recall is 0.800 for class 'a'");
        expect(html).not.toContain("imbalanced");
        expect(wordCount(html)).toBeGreaterThanOrEqual(60);
        expect(wordCount(html)).toBeLessThanOrEqual(220);
        expectCleanHtml(html);
    });

    it("accuracy <= NIR + 0.01: belum lebih baik dari menebak kelas mayoritas", () => {
        const html = describeEvaluationMetrics(
            { ...METRICS_2, overall_accuracy: 0.5 },
            { ...CONFUSION_2, matrix: [[50, 0], [50, 0]] }
        );
        expect(html).toContain("not yet better than always guessing the majority class");
        expect(html).not.toContain("exceeds it");
    });

    it("batas tepat NIR + 0.01 masih dianggap belum lebih baik", () => {
        const html = describeEvaluationMetrics({ ...METRICS_2, overall_accuracy: 0.51 }, CONFUSION_2);
        expect(html).toContain("not yet better than always guessing the majority class");
    });

    it("kelas tidak seimbang (rasio < 0.5): catatan macro F1/recall", () => {
        const html = describeEvaluationMetrics(METRICS_2, {
            ...CONFUSION_2,
            matrix: [
                [90, 0],
                [2, 8],
            ],
        });
        expect(html).toContain("imbalanced");
        expect(html).toContain("11.1%");
        expect(html).toContain("macro F1");
        expectCleanHtml(html);
    });

    it("tanpa confusion matrix: tidak ada kalimat NIR, tetap valid", () => {
        const html = describeEvaluationMetrics(METRICS_2);
        expect(html).toContain("Overall accuracy is 0.850.");
        expect(html).not.toContain("no-information rate (");
        expectCleanHtml(html);
    });

    it("data hilang/NaN: tidak ada undefined/NaN di HTML", () => {
        const broken = {
            classes: [],
            per_class: [{ class: "a", recall: NaN }],
            macro_avg: { f1: NaN },
            overall_accuracy: undefined,
        } as unknown as NaiveBayesEvaluationMetricsRaw;
        const html = describeEvaluationMetrics(broken);
        expect(html).toContain("not available");
        expectCleanHtml(html);
        expectCleanHtml(describeEvaluationMetrics({} as NaiveBayesEvaluationMetricsRaw));
    });

    it("nama kelas '<b>' di-escape pada recall terendah dan NIR", () => {
        const html = describeEvaluationMetrics(
            { ...METRICS_2, per_class: [{ ...METRICS_2.per_class[0], class: "<b>" }, METRICS_2.per_class[1]] },
            { ...CONFUSION_2, classes: ["<b>", "b"] }
        );
        expect(html).toContain("&lt;b&gt;");
        expect(html).not.toContain("<b>");
    });

    it("data stub: kelas recall terendah adalah versicolor", () => {
        const html = describeEvaluationMetrics(stub.evaluation_metrics!, stub.confusion_matrix);
        expect(html).toContain("0.900 for class 'versicolor'");
        expectCleanHtml(html);
    });
});

describe("describeCaseProcessingSummary", () => {
    it("data stub: valid vs total, target, atribut, skenario", () => {
        const html = describeCaseProcessingSummary(stub.case_processing_summary);
        expect(html).toContain("148 of 150 rows are valid (98.7%)");
        expect(html).toContain("2 rows were excluded");
        expect(html).toContain("'Species'");
        expect(html).toContain("3 attribute variables");
        expect(html).toContain("Training/Holdout split (70% / 30%)");
        expect(wordCount(html)).toBeGreaterThanOrEqual(60);
        expect(wordCount(html)).toBeLessThanOrEqual(220);
        expectCleanHtml(html);
    });

    it("fitur teks vector: leakage dari getLeakageNote, tanpa menyalin teks", () => {
        const html = describeCaseProcessingSummary({
            ...stub.case_processing_summary!,
            not_scored_rows: 3,
            text_features: {
                source: "vector",
                description: "Word vectors: 3 columns",
                variable: null,
                n_terms: 3,
                likelihood: "bernoulli",
                alpha: 0.5,
                uses_class_prior: true,
                leakage_note: "catatan dari Rust",
                class_prior_note: null,
            },
        });
        expect(html).toContain("Word vectors: 3 columns, Bernoulli likelihood, smoothing alpha 0.5");
        expect(html).toContain("3 rows could not be scored");
        expect(html).toContain("<em>not scored</em>");
        expect(html).toContain(escapeHtml(getLeakageNote("vector") ?? "x"));
        expect(html).not.toContain("catatan dari Rust");
        expectCleanHtml(html);
    });

    it("complement tanpa prior: catatan kanonik NO_PRIOR", () => {
        expect(TEXT_NO_PRIOR_NOTE).toBe(
            "Complement Naive Bayes does not use class priors; class scores come from the text features only."
        );
        const html = describeCaseProcessingSummary(stub.case_processing_summary, {
            source: "raw",
            likelihood: "complement",
            alpha: 1,
            terms: ["a", "b"],
            raw_variable: "Text Tweet",
            columns: null,
            log_weights: {},
            class_term_counts: {},
            uses_class_prior: false,
            recipe: null,
        });
        expect(html).toContain("Raw text: 'Text Tweet' (2 terms)");
        expect(html).toContain(TEXT_NO_PRIOR_NOTE);
    });

    it("tanpa data: kalimat generik, tidak ada NaN/undefined", () => {
        expectCleanHtml(describeCaseProcessingSummary(undefined));
        expectCleanHtml(describeCaseProcessingSummary(null));
        const html = describeCaseProcessingSummary({
            total_instances: NaN,
            valid_instances: undefined,
        } as unknown as Parameters<typeof describeCaseProcessingSummary>[0]);
        expect(html).toContain("No case counts");
        expectCleanHtml(html);
    });

    it("nama target dan atribut di-escape", () => {
        const html = describeCaseProcessingSummary({
            ...stub.case_processing_summary!,
            target_variable: "<b>",
            attribute_variables: ["<i>x</i>"],
        });
        expect(html).toContain("&lt;b&gt;");
        expect(html).toContain("&lt;i&gt;x&lt;/i&gt;");
        expectCleanHtml(html);
    });
});

describe("describeAttributeDistribution", () => {
    const attributes: NaiveBayesAttributeDistributionRaw[] = [
        {
            name: "Length",
            role: "numerical",
            classes: ["A", "B"],
            numeric: {
                per_class: [
                    { class: "A", mean: 1, std_dev: 1 },
                    { class: "B", mean: 5, std_dev: 1 },
                ],
            },
        },
        {
            name: "Soil",
            role: "categorical",
            classes: ["A", "B"],
            categories: [
                {
                    category: "clay",
                    per_class: [
                        { class: "A", raw_count: 8, smoothed_count: 9, probability: 0.8, total: 10 },
                        { class: "B", raw_count: 1, smoothed_count: 2, probability: 0.2, total: 10 },
                    ],
                },
            ],
        },
    ];

    it("atribut numerik dengan beda mean terbesar dan kategori dengan rasio terbesar", () => {
        const html = describeAttributeDistribution(attributes);
        expect(html).toContain("1 categorical and 1 numeric attributes");
        expect(html).toContain("'Length'");
        expect(html).toContain("4.00 pooled standard deviations");
        expect(html).toContain("category 'clay' of 'Soil'");
        expect(html).toContain("80.0% in class 'A' versus 20.0% in class 'B' (4.00 times)");
        expect(wordCount(html)).toBeGreaterThanOrEqual(60);
        expect(wordCount(html)).toBeLessThanOrEqual(220);
        expectCleanHtml(html);
    });

    it("min-std: catatan tampil hanya bila ada atribut gaussian_minstd", () => {
        expect(describeAttributeDistribution(attributes)).not.toContain("minimum standard deviation");
        const withMin = attributes.map((a) =>
            a.role === "numerical" ? { ...a, likelihood: "gaussian_minstd" as const } : a
        );
        expect(describeAttributeDistribution(withMin)).toContain("minimum standard deviation was applied to 'Length'");
    });

    it("data stub dan data kosong/rusak tetap bersih", () => {
        expectCleanHtml(describeAttributeDistribution(stub.attribute_distribution!));
        const empty = describeAttributeDistribution([]);
        expect(empty).toContain("No attribute distributions");
        expectCleanHtml(empty);
        const broken = [
            {
                name: "X",
                role: "numerical",
                classes: ["A", "B"],
                numeric: { per_class: [{ class: "A", mean: NaN, std_dev: 0 }, { class: "B", mean: 1, std_dev: 0 }] },
            },
        ] as unknown as NaiveBayesAttributeDistributionRaw[];
        expectCleanHtml(describeAttributeDistribution(broken));
    });

    it("nama atribut dan kelas '<b>' di-escape", () => {
        const html = describeAttributeDistribution(
            attributes.map((a) => ({ ...a, name: "<b>" + a.name }))
        );
        expect(html).toContain("&lt;b&gt;Length");
        expect(html).not.toContain("<b>");
    });
});

describe("describeTextFeatureTable", () => {
    const table: NaiveBayesTextFeatureTableRaw = {
        likelihood: "multinomial",
        classes: ["neg", "pos"],
        k: 5,
        top: {
            neg: [
                { term: "tidak", score: 1, log_weight: -1.5, count: 1 },
                { term: "jelek", score: 0.9, log_weight: -1.6, count: 1 },
                { term: "buruk", score: 0.8, log_weight: -1.7, count: 1 },
                { term: "lambat", score: 0.7, log_weight: -1.8, count: 1 },
            ],
            pos: [{ term: "<makan>", score: 1.3, log_weight: -0.8, count: 4 }],
        },
        full: [],
    };

    it("3 term teratas per kelas, likelihood, alpha, catatan top-k", () => {
        const html = describeTextFeatureTable(table, { alpha: 1, source: "raw" });
        expect(html).toContain("<li>Class 'neg': 'tidak', 'jelek', 'buruk'</li>");
        expect(html).not.toContain("lambat");
        expect(html).toContain("Likelihood: Multinomial, smoothing alpha 1");
        expect(html).toContain("top 5 terms per class");
        expect(html).not.toContain(escapeHtml(getLeakageNote("vector") ?? "x"));
        expect(wordCount(html)).toBeGreaterThanOrEqual(60);
        expect(wordCount(html)).toBeLessThanOrEqual(220);
        expectCleanHtml(html);
    });

    it("term ber-HTML di-escape", () => {
        const html = describeTextFeatureTable(table, { source: "raw" });
        expect(html).toContain("&lt;makan&gt;");
        expect(html).not.toContain("<makan>");
    });

    it("source vector: catatan LEAKAGE lewat getLeakageNote", () => {
        const html = describeTextFeatureTable(table, { alpha: 0.5, source: "vector" });
        expect(html).toContain(escapeHtml(getLeakageNote("vector") ?? "x"));
        expectCleanHtml(html);
    });

    it("data kosong/rusak tetap bersih", () => {
        const html = describeTextFeatureTable({
            likelihood: "bernoulli",
            classes: [],
            k: NaN,
            top: {},
            full: [],
        });
        expect(html).toContain("No terms are available");
        expectCleanHtml(html);
        expectCleanHtml(describeTextFeatureTable({} as NaiveBayesTextFeatureTableRaw));
    });
});

describe("describeExportModel", () => {
    it("model stub: schema, target, jumlah kelas, peringatan data sensitif, cara pakai", () => {
        const html = describeExportModel(stub.trained_model);
        expect(html).toContain(`schema version ${stub.trained_model!.schema_version}`);
        expect(html).toContain("Apply Model");
        expect(html).toContain("sensitive");
        expect(wordCount(html)).toBeGreaterThanOrEqual(60);
        expect(wordCount(html)).toBeLessThanOrEqual(220);
        expectCleanHtml(html);
    });

    it("tanpa model: tetap non-kosong dan bersih", () => {
        expectCleanHtml(describeExportModel(undefined));
        expectCleanHtml(describeExportModel(null));
    });
});
