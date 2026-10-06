// Test interpretasi otomatis Apply Model (PLAN_V3_UI_EN §3.4, Fase I2).
// Data golden = fixture hasil T1-T7 (6 baris, 5 diskor, 4 dievaluasi; matriks [[1,1],[0,2]]).

import type { ApplyModelRawResult } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model-worker";
import {
  describeApplyModelCaseProcessingSummary,
  describeApplyModelCohensKappa,
  describeApplyModelConfusionMatrix,
  describeApplyModelEvaluationMetrics,
  describeApplyModelPredictionDistribution,
  describeApplyModelSavedVariables,
  describeApplyModelSummary,
  describeVectorColumnsFound,
  readTrainingPriors,
} from "@/components/Modals/Analyze/Classify/apply-model/services/apply-model-interpretation";

// Fixture dimuat via require: tsconfig `composite: true` tidak mengizinkan import JSON via alias.
const rawFixture = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/apply-model-raw-result.json") as ApplyModelRawResult;

const cloneRaw = (): ApplyModelRawResult => JSON.parse(JSON.stringify(rawFixture)) as ApplyModelRawResult;

/** Teks polos dari HTML (tanpa tag), untuk menghitung kata. */
const plain = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ");
const wordCount = (html: string): number => plain(html).split(/\s+/).filter(Boolean).length;
const tagsOf = (html: string): string[] =>
  Array.from(html.matchAll(/<\/?([a-z0-9]+)/gi)).map((match) => match[1].toLowerCase());

/** Aturan umum: hanya tag yang diizinkan dan tidak ada nilai mentah yang bocor. */
const expectCleanHtml = (html: string) => {
  expect(html.length).toBeGreaterThan(0);
  tagsOf(html).forEach((tag) => expect(["p", "strong", "em", "ul", "li"]).toContain(tag));
  expect(html).not.toMatch(/NaN|undefined|\[object|Infinity|AGENTS|§/);
};

const expectLength = (html: string) => {
  expect(wordCount(html)).toBeGreaterThanOrEqual(60);
  expect(wordCount(html)).toBeLessThanOrEqual(220);
};

describe("describeVectorColumnsFound", () => {
  it("memakai teks kanonik PLAN §3.3", () => {
    expect(describeVectorColumnsFound(3, 5)).toBe("3 of 5 vector columns found; 2 treated as 0.");
    expect(describeVectorColumnsFound(5, 5)).toBe("5 of 5 vector columns found; 0 treated as 0.");
    expect(describeVectorColumnsFound(0, 4)).toBe("0 of 4 vector columns found; 4 treated as 0.");
  });
});

describe("describeApplyModelSummary", () => {
  it("fixture: sumber, algoritma, schema, target, kelas, dan jumlah fitur terpetakan", () => {
    const html = describeApplyModelSummary(rawFixture.model_summary, {
      sourceLabel: "File: nb-model-v1_1.json",
      algorithmLabel: "Naive Bayes",
    });

    expect(html).toContain("The model source is File: nb-model-v1_1.json.");
    expect(html).toContain("This is a Naive Bayes model (schema 1.1) that predicts 'Play' with 2 classes: 'No', 'Yes'.");
    expect(html).toContain("2 features are mapped to dataset variables (1 categorical, 1 numeric).");
    expect(html).not.toContain("Note.");
    expectLength(html);
    expectCleanHtml(html);
  });

  it("tanpa algorithmLabel: memakai model_type apa adanya", () => {
    const html = describeApplyModelSummary(rawFixture.model_summary, {});
    expect(html).toContain("This is a naive_bayes model");
  });

  it("model Text raw: variabel teks dan likelihood disebut", () => {
    const raw = cloneRaw().model_summary;
    raw.features = [];
    raw.parameters = [
      { label: "Text source", value: "raw" },
      { label: "Text likelihood", value: "multinomial" },
    ];
    const html = describeApplyModelSummary(raw, {
      sourceLabel: "File: m.json",
      textMapping: { source: "raw", modelVariable: "Teks", datasetVariable: "Tweet" },
    });

    expect(html).toContain("Text is read from the raw text variable 'Tweet'.");
    expect(html).toContain("The text likelihood is Multinomial.");
    expect(html).not.toContain("features are mapped");
    expectLength(html);
    expectCleanHtml(html);
  });

  it("model Text vector: memakai kalimat kanonik ringkasan vektor", () => {
    const raw = cloneRaw().model_summary;
    raw.features = [];
    raw.parameters = [{ label: "Text likelihood", value: "complement" }];
    const html = describeApplyModelSummary(raw, {
      textMapping: { source: "vector", totalColumns: 5, mappedColumns: 3 },
    });

    expect(html).toContain("3 of 5 vector columns found; 2 treated as 0.");
    expect(html).toContain("The text likelihood is Complement.");
    expectCleanHtml(html);
  });

  it("schema 1.0 (legacy): menulis Note tentang kategori yang dilewati", () => {
    const raw = cloneRaw().model_summary;
    raw.schema_version = "1.0";
    raw.legacy_unseen_handling = true;
    const html = describeApplyModelSummary(raw, { algorithmLabel: "Naive Bayes" });

    expect(html).toContain("<strong>Note.</strong>");
    expect(html).toContain("schema 1.0");
    expectCleanHtml(html);
  });

  it("nama target/kelas/sumber di-escape HTML", () => {
    const raw = cloneRaw().model_summary;
    raw.target_name = "<b>Play</b>";
    raw.classes = ["<i>No</i>", "A&B"];
    const html = describeApplyModelSummary(raw, { sourceLabel: "File: <x>.json" });

    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<i>");
    expect(html).toContain("&lt;b&gt;Play&lt;/b&gt;");
    expect(html).toContain("A&amp;B");
    expect(html).toContain("File: &lt;x&gt;.json");
    expectCleanHtml(html);
  });

  it("data hilang: kalimat generik tanpa undefined/NaN", () => {
    const html = describeApplyModelSummary(undefined);
    expect(html).toContain("not available");
    expectCleanHtml(html);

    const broken = { ...cloneRaw().model_summary } as Record<string, unknown>;
    delete broken.classes;
    delete broken.features;
    delete broken.parameters;
    expectCleanHtml(describeApplyModelSummary(broken as unknown as ApplyModelRawResult["model_summary"]));
  });
});

describe("describeApplyModelCaseProcessingSummary", () => {
  it("fixture T3: 5 dari 6 diskor, 1 tidak diskor, 2 prediktor hilang, 2 kategori baru, evaluasi", () => {
    const html = describeApplyModelCaseProcessingSummary(
      rawFixture.case_processing_summary,
      rawFixture.evaluation,
      rawFixture.model_summary
    );

    expect(html).toContain("5 of 6 rows (83.3%) were scored.");
    expect(html).toContain("1 row was not scored because every predictor was missing.");
    expect(html).toContain("2 rows had at least one missing predictor but were still scored.");
    expect(html).toContain("2 rows contained at least one category that was not seen during training.");
    expect(html).toContain("4 rows were used for evaluation against the actual variable.");
    expect(html).toContain("2 rows were excluded from the evaluation (1 not scored, 1 whose actual class is not in the model).");
    expect(html).toContain("smoothing");
    expectLength(html);
    expectCleanHtml(html);
  });

  it("tanpa evaluasi dan tanpa masalah data: kalimat sederhana, tanpa Note", () => {
    const html = describeApplyModelCaseProcessingSummary(
      {
        total_rows: 10,
        scored_rows: 10,
        not_scored_all_missing: 0,
        rows_with_missing_predictor: 0,
        rows_with_unseen_category: 0,
      },
      null,
      rawFixture.model_summary
    );

    expect(html).toContain("10 of 10 rows (100.0%) were scored.");
    expect(html).toContain("No rows were left unscored because of missing predictors.");
    expect(html).not.toContain("used for evaluation");
    expect(html).not.toContain("Note.</strong>");
    expectCleanHtml(html);
  });

  it("schema legacy dengan kategori baru: Note menyebut kategori dilewati", () => {
    const summary = cloneRaw().model_summary;
    summary.legacy_unseen_handling = true;
    const html = describeApplyModelCaseProcessingSummary(
      rawFixture.case_processing_summary,
      null,
      summary
    );
    expect(html).toContain("is skipped for the affected predictor");
    expectCleanHtml(html);
  });

  it("model Text raw: baris dengan teks kosong disebut", () => {
    const summary = cloneRaw().model_summary;
    summary.parameters = [{ label: "Rows with empty text", value: "3" }];
    const html = describeApplyModelCaseProcessingSummary(
      rawFixture.case_processing_summary,
      null,
      summary
    );
    expect(html).toContain("3 rows had empty text.");
    expectCleanHtml(html);
  });

  it("tidak ada baris: kalimat generik; data hilang/NaN tidak bocor", () => {
    const empty = describeApplyModelCaseProcessingSummary({
      total_rows: 0,
      scored_rows: 0,
      not_scored_all_missing: 0,
      rows_with_missing_predictor: 0,
      rows_with_unseen_category: 0,
    });
    expect(empty).toContain("no rows to score");
    expectCleanHtml(empty);

    const missing = describeApplyModelCaseProcessingSummary(undefined);
    expect(missing).toContain("not available");
    expectCleanHtml(missing);

    const nan = describeApplyModelCaseProcessingSummary({
      total_rows: Number.NaN,
      scored_rows: Number.POSITIVE_INFINITY,
      not_scored_all_missing: Number.NaN,
      rows_with_missing_predictor: Number.NaN,
      rows_with_unseen_category: Number.NaN,
    });
    expect(nan).toContain("not available");
    expectCleanHtml(nan);
  });
});

describe("describeApplyModelPredictionDistribution", () => {
  it("fixture T4: kelas terbanyak 'Yes' (3 baris, 60.0%) dan 1 baris tidak diskor", () => {
    const html = describeApplyModelPredictionDistribution(rawFixture.prediction_distribution);

    expect(html).toContain("The most frequent predicted class is 'Yes' with 3 rows (60.0% of the scored rows).");
    expect(html).toContain("1 row was not scored and is listed separately.");
    expect(html).not.toContain("training data");
    expect(html).not.toContain("Note.</strong>");
    expectLength(html);
    expectCleanHtml(html);
  });

  it("dengan prior pelatihan: membandingkan kelas terbanyak dan menulis Note", () => {
    const html = describeApplyModelPredictionDistribution(rawFixture.prediction_distribution, {
      classes: ["No", "Yes"],
      priors: [0.5, 0.5],
    });

    expect(html).toContain("In the training data, class 'Yes' made up 50.0% of the rows, compared with 60.0% of the predictions here.");
    expect(html).toContain("<strong>Note.</strong>");
    expectLength(html);
    expectCleanHtml(html);
  });

  it("selisih >= 10 poin pada kelas lain disebut; kelas tanpa prediksi disebut", () => {
    const html = describeApplyModelPredictionDistribution(
      {
        classes: ["a", "b", "c"],
        counts: [6, 0, 4],
        percentages: [60, 0, 40],
        not_scored: 0,
      },
      { classes: ["a", "b", "c"], priors: [0.5, 0.3, 0.2] }
    );

    expect(html).toContain("No rows were predicted as 'b'.");
    expect(html).toContain("Class 'b' differs the most among the other classes: 0.0% of the predictions versus 30.0% in the training data.");
    expectCleanHtml(html);
  });

  it("tidak ada baris diskor: kalimat generik", () => {
    const html = describeApplyModelPredictionDistribution({
      classes: ["a", "b"],
      counts: [0, 0],
      percentages: [0, 0],
      not_scored: 4,
    });
    expect(html).toContain("No rows were scored");
    expectCleanHtml(html);
  });

  it("nama kelas '<b>' di-escape; data hilang/NaN tidak bocor", () => {
    const html = describeApplyModelPredictionDistribution({
      classes: ["<b>x</b>", "y"],
      counts: [3, Number.NaN],
      percentages: [100, Number.NaN],
      not_scored: Number.NaN,
    });
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expectCleanHtml(html);

    const missing = describeApplyModelPredictionDistribution(undefined);
    expect(missing).toContain("not available");
    expectCleanHtml(missing);
  });
});

describe("readTrainingPriors", () => {
  const model = (extra: Record<string, unknown> = {}) => ({
    target: { name: "Play", classes: ["No", "Yes"], class_priors: [0.4, 0.6] },
    ...extra,
  });

  it("membaca classes + class_priors", () => {
    expect(readTrainingPriors(model())).toEqual({ classes: ["No", "Yes"], priors: [0.4, 0.6] });
  });

  it("null untuk bentuk yang tidak sesuai", () => {
    expect(readTrainingPriors(null)).toBeNull();
    expect(readTrainingPriors("x")).toBeNull();
    expect(readTrainingPriors({})).toBeNull();
    expect(readTrainingPriors({ target: { classes: ["a"], class_priors: [0.5, 0.5] } })).toBeNull();
    expect(readTrainingPriors({ target: { classes: ["a"], class_priors: [1.5] } })).toBeNull();
    expect(readTrainingPriors({ target: { classes: ["a"], class_priors: [Number.NaN] } })).toBeNull();
  });

  it("null bila model tidak memakai prior (Complement NB)", () => {
    expect(readTrainingPriors(model({ text: { uses_class_prior: false } }))).toBeNull();
    expect(readTrainingPriors(model({ text: { uses_class_prior: true } }))).not.toBeNull();
  });
});

describe("describeApplyModelSavedVariables", () => {
  it("menyebut jumlah, nama akhir, dan tipe kolom", () => {
    const html = describeApplyModelSavedVariables([
      { column: "Predicted value", finalName: "NB_PredictedValue", type: "STRING", measure: "nominal" },
      { column: "Max probability", finalName: "NB_PredictedProbability", type: "NUMERIC", measure: "scale" },
      { column: "Probability of No", finalName: "NB_Probability_No", type: "NUMERIC", measure: "scale" },
      { column: "Probability of Yes", finalName: "NB_Probability_Yes", type: "NUMERIC", measure: "scale" },
    ]);

    expect(html).toContain("4 new variables were added to the dataset: 'NB_PredictedValue', 'NB_PredictedProbability', 'NB_Probability_No', 'NB_Probability_Yes'.");
    expect(html).toContain("That is 3 numeric and 1 string.");
    expect(html).toContain("Rows that were not scored are left empty.");
    expectLength(html);
    expectCleanHtml(html);
  });

  it("satu kolom: bentuk tunggal; daftar panjang dipotong '… and N more'", () => {
    const one = describeApplyModelSavedVariables([
      { column: "Predicted value", finalName: "P", type: "STRING", measure: "nominal" },
    ]);
    expect(one).toContain("1 new variable was added to the dataset: 'P'.");

    const many = describeApplyModelSavedVariables(
      Array.from({ length: 8 }, (_, index) => ({
        column: `c${index}`,
        finalName: `V${index}`,
        type: "NUMERIC",
        measure: "scale",
      }))
    );
    expect(many).toContain("and 3 more");
  });

  it("nama akhir di-escape; daftar kosong/hilang -> kalimat generik", () => {
    const html = describeApplyModelSavedVariables([
      { column: "c", finalName: "<b>X</b>", type: "NUMERIC", measure: "scale" },
    ]);
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;X&lt;/b&gt;");
    expectCleanHtml(html);

    expect(describeApplyModelSavedVariables([])).toContain("No variables were saved");
    expectCleanHtml(describeApplyModelSavedVariables(undefined));
  });
});

describe("evaluasi (memakai ulang fungsi NB)", () => {
  it("Metrics: accuracy vs NIR, F1, recall terendah, dan baris yang dikecualikan", () => {
    const html = describeApplyModelEvaluationMetrics(rawFixture.evaluation);

    expect(html).toContain("Overall accuracy is 0.750.");
    expect(html).toContain("no-information rate");
    expect(html).toContain("Macro F1 is 0.733");
    expect(html).toContain("The lowest recall is 0.500 for class 'No'.");
    expect(html).toContain("2 rows were excluded from the evaluation (1 not scored, 1 whose actual class is not in the model).");
    expectLength(html);
    expectCleanHtml(html);
  });

  it("Kappa: nilai 0.500 kategori moderate + baris yang dikecualikan", () => {
    const html = describeApplyModelCohensKappa(rawFixture.evaluation);

    expect(html).toContain("Cohen's Kappa is 0.500");
    expect(html).toContain("<em>moderate</em>");
    expect(html).toContain("excluded from the evaluation");
    expect(html.match(/<strong>Note\.<\/strong>/g)).toHaveLength(1);
    expectLength(html);
    expectCleanHtml(html);
  });

  it("Confusion Matrix: diagonal 3 dari 4 dan salah klasifikasi terbanyak + baris yang dikecualikan", () => {
    const html = describeApplyModelConfusionMatrix(rawFixture.evaluation);

    expect(html).toContain("3 rows out of 4 evaluated (75.0%)");
    expect(html).toContain("actual 'No' predicted as 'Yes' (1 row)");
    expect(html).toContain("excluded from the evaluation");
    expect(html.match(/<strong>Note\.<\/strong>/g)).toHaveLength(1);
    expectLength(html);
    expectCleanHtml(html);
  });

  it("tanpa baris yang dikecualikan: tidak ada kalimat pengecualian", () => {
    const raw = cloneRaw();
    raw.evaluation!.excluded_not_scored = 0;
    raw.evaluation!.excluded_actual_missing = 0;
    raw.evaluation!.excluded_actual_unknown_class = 0;

    expect(describeApplyModelCohensKappa(raw.evaluation)).not.toContain("excluded");
    expect(describeApplyModelConfusionMatrix(raw.evaluation)).not.toContain("excluded");
    expect(describeApplyModelEvaluationMetrics(raw.evaluation)).not.toContain("excluded");
  });

  it("kelas tidak seimbang: Note NB tetap ada dan kalimat pengecualian digabung ke Note yang sama", () => {
    const raw = cloneRaw();
    const evaluation = raw.evaluation!;
    evaluation.confusion_matrix = {
      classes: ["a", "b"],
      matrix: [
        [90, 0],
        [5, 5],
      ],
      row_totals: [90, 10],
      col_totals: [95, 5],
      grand_total: 100,
      percentages: [
        [90, 0],
        [5, 5],
      ],
    };
    const html = describeApplyModelEvaluationMetrics(evaluation);

    expect(html).toContain("The classes are imbalanced");
    expect(html).toContain("excluded from the evaluation");
    expect(html.match(/<strong>Note\.<\/strong>/g)).toHaveLength(1);
    expectCleanHtml(html);
  });

  it("evaluasi null/hilang: kalimat generik, tidak melempar galat", () => {
    expect(describeApplyModelEvaluationMetrics(null)).toContain("not available");
    expect(describeApplyModelConfusionMatrix(null)).toContain("not available");
    const kappa = describeApplyModelCohensKappa(null);
    expect(kappa).toContain("not available");
    expectCleanHtml(kappa);
  });

  it("nama kelas '<b>' pada confusion matrix di-escape", () => {
    const raw = cloneRaw();
    raw.evaluation!.confusion_matrix.classes = ["<b>No</b>", "Yes"];
    const html = describeApplyModelConfusionMatrix(raw.evaluation);

    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;No&lt;/b&gt;");
  });
});
