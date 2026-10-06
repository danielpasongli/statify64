// naive-bayes-analysis-formatter.ts
//
// Mengubah struktur mentah hasil analisis Naive Bayes (baik dari stub JSON
// Fase 7 maupun nanti dari WASM — bentuknya sengaja disamakan sejak awal,
// lihat PLAN.md Fase 7.2) menjadi `Table[]` yang dipahami output viewer
// aplikasi (types/Table.ts), mengikuti pola
// `nearest-neighbor-analysis-formatter.ts`.
//
// Skema angka/istilah di sini wajib konsisten dengan AGENTS.md §5.

import type { Table, ResultJson } from "@/types/Table";
import { getLeakageNote } from "@/components/Modals/Analyze/Classify/naive-bayes/hooks/useNaiveBayesTextRules";

/* =========================
   TIPE STRUKTUR MENTAH
   (bentuk yang disepakati dipakai stub JSON Fase 7 maupun payload WASM nanti)
========================= */

export type NaiveBayesValidationScenario = {
  method: "holdout" | "kfold";
  training_percentage: number | null;
  holdout_percentage: number | null;
  folds: number | null;
  seed: number | null;
};

export type NaiveBayesCaseProcessingSummaryRaw = {
  total_instances: number;
  valid_instances: number;
  excluded_target_missing: number;
  target_variable: string;
  attribute_variables: string[];
  validation_scenario: NaiveBayesValidationScenario;
  // --- v2 (N4): hanya ada pada model dengan fitur Text; kunci dihilangkan pada v1. ---
  text_features?: NaiveBayesTextFeaturesSummaryRaw;
  /** Baris yang tidak diskor saat evaluasi karena semua prediktor missing (V11). */
  not_scored_rows?: number;
};

/** `case_processing_summary.text_features` (dibuat Rust N4, `case_summary.rs`). */
export type NaiveBayesTextFeaturesSummaryRaw = {
  source: "raw" | "vector";
  /** Baris `Text features` siap tampil: `Raw text: '{var}' ({V} terms)` / `Word vectors: {n} columns`. */
  description: string;
  variable: string | null;
  n_terms: number;
  likelihood: NaiveBayesTextLikelihoodRaw;
  alpha: number;
  /** `false` hanya Complement dengan K >= 2: jangan tampilkan prior seolah dipakai. */
  uses_class_prior: boolean;
  /** Catatan W-LEAK; hanya jalur vector. */
  leakage_note: string | null;
  /** Catatan "tanpa prior"; hanya bila `uses_class_prior === false`. */
  class_prior_note: string | null;
};

export type NaiveBayesCategoricalPerClass = {
  class: string;
  raw_count: number;
  smoothed_count: number;
  probability: number;
  total: number;
};

export type NaiveBayesCategoricalAttribute = {
  name: string;
  role: "categorical";
  classes: string[];
  categories: Array<{
    category: string;
    per_class: NaiveBayesCategoricalPerClass[];
  }>;
};

export type NaiveBayesNumericalAttribute = {
  name: string;
  role: "numerical";
  classes: string[];
  numeric: {
    per_class: Array<{ class: string; mean: number; std_dev: number }>;
  };
  // --- v2 (N4): hanya untuk atribut Gaussian min-std; kunci dihilangkan untuk Gaussian biasa. ---
  likelihood?: "gaussian_minstd";
  likelihood_note?: string;
};

export type NaiveBayesAttributeDistributionRaw =
  | NaiveBayesCategoricalAttribute
  | NaiveBayesNumericalAttribute;

export type NaiveBayesEvaluationMetricsRaw = {
  classes: string[];
  per_class: Array<{
    class: string;
    accuracy: number;
    precision: number;
    recall: number;
    f1: number;
  }>;
  macro_avg: { precision: number; recall: number; f1: number };
  weighted_avg: { precision: number; recall: number; f1: number };
  micro_avg: { precision: number; recall: number; f1: number };
  overall_accuracy: number;
  cohens_kappa: number;
};

export type NaiveBayesConfusionMatrixRaw = {
  classes: string[];
  matrix: number[][];
  row_totals: number[];
  col_totals: number[];
  grand_total: number;
  percentages: number[][];
};

/** Field yang sama pada semua versi export (1.0/1.1/2.0). */
type NaiveBayesTrainedModelBaseRaw = {
  model_type: string;
  trained_at: string;
  target: {
    name: string;
    classes: string[];
    class_priors: number[];
    class_counts?: number[];
  };
  smoothing_alpha: number;
  variance_floor: number;
  feature_order: string[];
  label_mapping: Record<string, number>;
  validation_config: NaiveBayesValidationScenario;
  missing_value_policy: string;
  unseen_category_policy: string;
};

/** Export schema 1.0/1.1 (setara v1; tidak memuat blok `text`). */
export type NaiveBayesTrainedModelV1Raw = NaiveBayesTrainedModelBaseRaw & {
  schema_version: "1.0" | "1.1";
  features: unknown[];
};

/** Satu entri `features` schema 2.0 (AGENTS_V2 §8). */
export type NaiveBayesExportFeatureV2Raw =
  | {
      name: string;
      role: "categorical";
      likelihood: "categorical";
      categories: string[];
      distribution: Record<string, number[]>;
      class_totals: Record<string, number>;
    }
  | {
      name: string;
      role: "numerical";
      likelihood: "gaussian" | "gaussian_minstd";
      mean: Record<string, number>;
      /** Variance SETELAH min-std dan floor. */
      variance: Record<string, number>;
      /** `null` untuk `gaussian`. */
      min_variance: number | null;
    };

/** Export schema 2.0: field 1.1 + `text` (`null` bila model tanpa Text Features). */
export type NaiveBayesTrainedModelV2Raw = NaiveBayesTrainedModelBaseRaw & {
  schema_version: "2.0";
  features: NaiveBayesExportFeatureV2Raw[];
  text: NaiveBayesTrainedTextRaw | null;
};

/** Union export model terlatih: 1.0/1.1 | 2.0 (diskriminasi lewat `schema_version`). */
export type NaiveBayesTrainedModelRaw =
  | NaiveBayesTrainedModelV1Raw
  | NaiveBayesTrainedModelV2Raw;

/** Blok `text` model terlatih, atau `null` untuk 1.x / 2.0 tanpa Text. */
export function getTrainedText(
  model: NaiveBayesTrainedModelRaw | undefined
): NaiveBayesTrainedTextRaw | null {
  return model && "text" in model ? model.text ?? null : null;
}

/* =========================
   TIPE v2: blok `text` model terlatih (AGENTS_V2 §8) & Text Feature Table (§9)
========================= */

export type NaiveBayesTextLikelihoodRaw = "multinomial" | "bernoulli" | "complement";

/** Blok `text` pada export schema 2.0 (AGENTS_V2 §8). */
export type NaiveBayesTrainedTextRaw = {
  source: "raw" | "vector";
  likelihood: NaiveBayesTextLikelihoodRaw;
  alpha: number;
  /** Urutan indeks parameter; raw = recipe.vocabulary, vector = nama kolom. */
  terms: string[];
  /** Wajib bila source = raw; boleh tidak ada/`null` pada vector. */
  raw_variable?: string | null;
  /** Wajib bila source = vector (sama dengan `terms`); boleh tidak ada/`null` pada raw. */
  columns?: string[] | null;
  log_weights: Record<string, number[]>;
  /** Hanya Bernoulli. */
  log_weights_absent?: Record<string, number[]> | null;
  class_term_counts: Record<string, number[]>;
  uses_class_prior: boolean;
  /** `TextVectorizerModel` milik crate CORE; wajib bila source = raw. Bentuknya tidak diinterpretasi di TS. */
  recipe?: Record<string, unknown> | null;
};

/** Satu baris Top-k per kelas (bentuk DIKUNCI di Fase N8). */
export type NaiveBayesTextFeatureTopEntry = {
  term: string;
  score: number;
  log_weight: number;
  count: number;
};

/** Satu baris tabel lengkap term × kelas (bentuk DIKUNCI di Fase N8). */
export type NaiveBayesTextFeatureFullEntry = {
  term: string;
  class: string;
  count: number;
  log_weight: number;
  probability: number;
  score: number;
};

/**
 * Struktur JSON `text_feature_table` yang DIKUNCI di Fase N8 (PLAN_V2 N8) dan
 * wajib dihasilkan PERSIS oleh Rust (Fase N4, `text_feature_table.rs`):
 * `{ likelihood, classes, k, top: Record<class, {term, score, log_weight, count}[]>,
 *    full: {term, class, count, log_weight, probability, score}[] }`.
 */
export type NaiveBayesTextFeatureTableRaw = {
  likelihood: NaiveBayesTextLikelihoodRaw;
  classes: string[];
  k: number;
  top: Record<string, NaiveBayesTextFeatureTopEntry[]>;
  full: NaiveBayesTextFeatureFullEntry[];
};

export type NaiveBayesRawResult = {
  case_processing_summary?: NaiveBayesCaseProcessingSummaryRaw;
  attribute_distribution?: NaiveBayesAttributeDistributionRaw[];
  evaluation_metrics?: NaiveBayesEvaluationMetricsRaw;
  confusion_matrix?: NaiveBayesConfusionMatrixRaw;
  trained_model?: NaiveBayesTrainedModelRaw;
  /** v2 (N4): salinan level atas `case_processing_summary.not_scored_rows`; hanya model dengan Text. */
  not_scored_rows?: number;
  /** v2: hanya ada bila model punya Text Features dan opsi tabel aktif (N4). */
  text_feature_table?: NaiveBayesTextFeatureTableRaw;
};

const formatNumber = (value: number, decimals = 3): number =>
  Number.isFinite(value) ? Number(value.toFixed(decimals)) : value;

export const describeValidationScenario = (
  scenario: NaiveBayesValidationScenario
): string => {
  if (scenario.method === "holdout") {
    return `Training/Holdout split (${scenario.training_percentage}% / ${scenario.holdout_percentage}%)${
      scenario.seed !== null ? `, seed ${scenario.seed}` : ""
    }`;
  }
  return `${scenario.folds}-fold cross-validation${
    scenario.seed !== null ? `, seed ${scenario.seed}` : ""
  }`;
};

const TEXT_LIKELIHOOD_LABEL: Record<NaiveBayesTextLikelihoodRaw, string> = {
  multinomial: "Multinomial",
  bernoulli: "Bernoulli",
  complement: "Complement",
};

/** Catatan "tanpa prior" (teks kanonik NO_PRIOR PLAN_V3 §3.1; sama dengan Rust `case_summary.rs`). */
export const TEXT_NO_PRIOR_NOTE =
  "Complement Naive Bayes does not use class priors; class scores come from the text features only.";

/**
 * Menurunkan ringkasan Text dari blok `trained_model.text` (cadangan bila
 * `case_processing_summary.text_features` tidak ada).
 */
export function textSummaryFromTrainedText(
  text: NaiveBayesTrainedTextRaw
): NaiveBayesTextFeaturesSummaryRaw {
  const nTerms = text.source === "raw" ? text.terms.length : (text.columns ?? text.terms).length;
  return {
    source: text.source,
    description:
      text.source === "raw"
        ? `Raw text: '${text.raw_variable ?? ""}' (${nTerms} terms)`
        : `Word vectors: ${nTerms} columns`,
    variable: text.raw_variable ?? null,
    n_terms: nTerms,
    likelihood: text.likelihood,
    alpha: text.alpha,
    uses_class_prior: text.uses_class_prior,
    leakage_note: getLeakageNote(text.source),
    class_prior_note: text.uses_class_prior ? null : TEXT_NO_PRIOR_NOTE,
  };
}

/**
 * Baris tambahan Case Processing Summary untuk Text Features (AGENTS_V2 §9):
 * `Text features`, `Text likelihood`, `Text alpha`, catatan W-LEAK (vector) dan
 * catatan "tanpa prior" (Complement K >= 2). Mengembalikan daftar kosong bila
 * model tanpa Text Features, sehingga tabel v1 tidak berubah.
 */
export function buildTextSummaryRows(
  summary: NaiveBayesTextFeaturesSummaryRaw | null | undefined
): Table["rows"] {
  if (!summary) return [];
  const rows: Table["rows"] = [
    { rowHeader: ["Text features"], value: summary.description },
    {
      rowHeader: ["Text likelihood"],
      value: TEXT_LIKELIHOOD_LABEL[summary.likelihood] ?? summary.likelihood,
    },
    { rowHeader: ["Text alpha"], value: summary.alpha },
  ];
  // Teks catatan selalu diambil dari sumber kanonik (bukan dari string hasil Rust)
  // agar tetap berbahasa Inggris walau WASM lama masih mengirim teks Indonesia.
  if (summary.leakage_note) {
    const leakage = getLeakageNote(summary.source);
    if (leakage) rows.push({ rowHeader: ["Note"], value: leakage });
  }
  if (!summary.uses_class_prior && summary.class_prior_note) {
    rows.push({ rowHeader: ["Note"], value: TEXT_NO_PRIOR_NOTE });
  }
  return rows;
}

/**
 * Case Processing Summary (AGENTS.md §5.4): total instance, valid, dibuang
 * karena target missing, target, daftar atribut, dan skenario validasi.
 * v2 (AGENTS_V2 §9): baris Text features memakai `raw.text_features` (N4);
 * bila tidak ada, cadangan `text` (= `trained_model.text`). Baris `Not Scored`
 * tampil bila `raw.not_scored_rows` terisi (hanya model dengan Text).
 */
export function buildCaseProcessingSummaryTable(
  raw: NaiveBayesCaseProcessingSummaryRaw,
  text?: NaiveBayesTrainedTextRaw | null
): Table {
  const textSummary =
    raw.text_features ?? (text ? textSummaryFromTrainedText(text) : null);
  return {
    key: "case_processing_summary",
    title: "Case Processing Summary",
    columnHeaders: [
      { header: "", key: "label" },
      { header: "Value", key: "value" },
    ],
    rows: [
      { rowHeader: ["Total Instances"], value: raw.total_instances },
      { rowHeader: ["Valid Instances"], value: raw.valid_instances },
      {
        rowHeader: ["Excluded (Target Missing)"],
        value: raw.excluded_target_missing,
      },
      { rowHeader: ["Target Variable"], value: raw.target_variable },
      {
        rowHeader: ["Attribute Variables"],
        value: raw.attribute_variables.join(", "),
      },
      {
        rowHeader: ["Validation Scenario"],
        value: describeValidationScenario(raw.validation_scenario),
      },
      ...buildTextSummaryRows(textSummary),
      ...(typeof raw.not_scored_rows === "number"
        ? [
            {
              rowHeader: ["Not Scored (All Predictors Missing)"],
              value: raw.not_scored_rows,
            },
          ]
        : []),
    ],
  };
}

/**
 * Attribute Distribution Table gaya WEKA (AGENTS.md §5.8): kategorik ->
 * sub-baris per kategori dengan raw count, smoothed count, probability,
 * total per kelas; numerik -> mean & std dev per kelas (tanpa weighted sum).
 */
export function buildAttributeDistributionTable(
  attributes: NaiveBayesAttributeDistributionRaw[]
): Table {
  const classes = attributes[0]?.classes ?? [];

  const columnHeaders = [
    { header: "Attribute", key: "attribute" },
    { header: "Category / Stat", key: "categoryStat" },
    ...classes.map((className) => ({
      header: className,
      key: className,
    })),
  ];

  const rows = attributes.flatMap((attribute) => {
    if (attribute.role === "categorical") {
      return attribute.categories.map((category) => {
        const row: Table["rows"][number] = {
          rowHeader: [attribute.name, category.category],
        };
        category.per_class.forEach((perClass) => {
          row[perClass.class] =
            `${perClass.raw_count} / ${perClass.smoothed_count} (${formatNumber(
              perClass.probability * 100,
              1
            )}%) of ${perClass.total}`;
        });
        return row;
      });
    }

    const meanRow: Table["rows"][number] = {
      rowHeader: [attribute.name, "Mean"],
    };
    const stdDevRow: Table["rows"][number] = {
      rowHeader: [attribute.name, "Std. Dev."],
    };
    attribute.numeric.per_class.forEach((perClass) => {
      meanRow[perClass.class] = formatNumber(perClass.mean);
      stdDevRow[perClass.class] = formatNumber(perClass.std_dev);
    });
    return [meanRow, stdDevRow];
  });

  // v2 (N4): atribut Numeric ber-Gaussian min-std diberi keterangan; std_dev
  // dari Rust sudah memakai variance setelah min-std. Tanpa keterangan, note v1 identik.
  const likelihoodNotes = attributes
    .filter(
      (attribute): attribute is NaiveBayesNumericalAttribute =>
        attribute.role === "numerical" && !!attribute.likelihood_note
    )
    .map((attribute) => `${attribute.name}: ${attribute.likelihood_note}`);
  const baseNote =
    "Categorical cells show the raw count / smoothed count (percentage) of the class total. Numerical rows show the mean and standard deviation per class.";

  return {
    key: "attribute_distribution_table",
    title: "Attribute Distribution Table",
    columnHeaders,
    rows,
    note:
      likelihoodNotes.length > 0
        ? `${baseNote} Numerical likelihood: ${likelihoodNotes.join("; ")}.`
        : baseNote,
  };
}

/**
 * Model Evaluation Metrics (AGENTS.md §5.6): per kelas Accuracy, Precision,
 * Recall, F1, plus agregat macro/weighted/micro average dan overall
 * accuracy dalam satu tabel; Cohen's Kappa ditampilkan terpisah sebagai satu
 * angka overall (bukan per kelas).
 */
export function buildEvaluationMetricsTables(
  raw: NaiveBayesEvaluationMetricsRaw
): Table[] {
  const metricsColumnHeaders = [
    { header: "", key: "class" },
    { header: "Accuracy", key: "accuracy" },
    { header: "Precision", key: "precision" },
    { header: "Recall", key: "recall" },
    { header: "F1-Score", key: "f1" },
  ];

  const perClassRows = raw.per_class.map((row) => ({
    rowHeader: [row.class],
    accuracy: formatNumber(row.accuracy),
    precision: formatNumber(row.precision),
    recall: formatNumber(row.recall),
    f1: formatNumber(row.f1),
  }));

  const aggregateRows = [
    {
      rowHeader: ["Macro Average"],
      accuracy: null,
      precision: formatNumber(raw.macro_avg.precision),
      recall: formatNumber(raw.macro_avg.recall),
      f1: formatNumber(raw.macro_avg.f1),
    },
    {
      rowHeader: ["Weighted Average"],
      accuracy: null,
      precision: formatNumber(raw.weighted_avg.precision),
      recall: formatNumber(raw.weighted_avg.recall),
      f1: formatNumber(raw.weighted_avg.f1),
    },
    {
      rowHeader: ["Micro Average"],
      accuracy: null,
      precision: formatNumber(raw.micro_avg.precision),
      recall: formatNumber(raw.micro_avg.recall),
      f1: formatNumber(raw.micro_avg.f1),
    },
    {
      rowHeader: ["Overall Accuracy"],
      accuracy: formatNumber(raw.overall_accuracy),
      precision: null,
      recall: null,
      f1: null,
    },
  ];

  const metricsTable: Table = {
    key: "evaluation_metrics",
    title: "Model Evaluation Metrics",
    columnHeaders: metricsColumnHeaders,
    rows: [...perClassRows, ...aggregateRows],
  };

  const kappaTable: Table = {
    key: "evaluation_metrics_kappa",
    title: "Cohen's Kappa",
    columnHeaders: [
      { header: "", key: "label" },
      { header: "Value", key: "value" },
    ],
    rows: [
      { rowHeader: ["Cohen's Kappa (overall)"], value: formatNumber(raw.cohens_kappa) },
    ],
    note: "Cohen's Kappa is an overall statistic; it is not broken down per class.",
  };

  return [metricsTable, kappaTable];
}

/**
 * Confusion Matrix (AGENTS.md §5.7): baris = actual, kolom = predicted,
 * dengan count, total (baris/kolom/grand total), dan persentase.
 */
export function buildConfusionMatrixTable(
  raw: NaiveBayesConfusionMatrixRaw
): Table {
  const columnHeaders = [
    { header: "Actual \\ Predicted", key: "actual" },
    ...raw.classes.map((className) => ({ header: className, key: className })),
    { header: "Total", key: "total" },
  ];

  const rows = raw.classes.map((actualClass, rowIndex) => {
    const row: Table["rows"][number] = { rowHeader: [actualClass] };
    raw.classes.forEach((predictedClass, colIndex) => {
      const count = raw.matrix[rowIndex]?.[colIndex] ?? 0;
      const percentage = raw.percentages[rowIndex]?.[colIndex] ?? 0;
      row[predictedClass] = `${count} (${formatNumber(percentage, 1)}%)`;
    });
    row.total = raw.row_totals[rowIndex] ?? 0;
    return row;
  });

  const totalRow: Table["rows"][number] = { rowHeader: ["Total"] };
  raw.classes.forEach((className, colIndex) => {
    totalRow[className] = raw.col_totals[colIndex] ?? 0;
  });
  totalRow.total = raw.grand_total;
  rows.push(totalRow);

  return {
    key: "confusion_matrix",
    title: "Confusion Matrix",
    columnHeaders,
    rows,
  };
}

/**
 * Text Feature Table (AGENTS_V2 §9): per kelas, top-k baris
 * `Rank | Term | Score | Log weight | Count`. Data lengkap (`full`) TIDAK
 * dimasukkan ke tabel ini; ia dibawa terpisah di `output_data` untuk aksi
 * Download CSV / Copy TSV (lihat `naive-bayes-analysis-output.ts`).
 */
export function buildTextFeatureTable(
  raw: NaiveBayesTextFeatureTableRaw
): Table {
  const classes = raw.classes.length > 0 ? raw.classes : Object.keys(raw.top);
  const limit = Number.isFinite(raw.k) && raw.k > 0 ? Math.floor(raw.k) : null;

  const rows = classes.flatMap((className) => {
    const entries = raw.top[className] ?? [];
    const shown = limit === null ? entries : entries.slice(0, limit);
    return shown.map((entry, index) => ({
      rowHeader: [className, String(index + 1)],
      term: entry.term,
      score: formatNumber(entry.score, 4),
      log_weight: formatNumber(entry.log_weight, 4),
      count: formatNumber(entry.count),
    }));
  });

  return {
    key: "text_feature_table",
    title: "Text Feature Table",
    columnHeaders: [
      { header: "Class", key: "class" },
      { header: "Rank", key: "rank" },
      { header: "Term", key: "term" },
      { header: "Score", key: "score" },
      { header: "Log weight", key: "log_weight" },
      { header: "Count", key: "count" },
    ],
    rows,
    note: `Top ${raw.k} terms per class (${
      TEXT_LIKELIHOOD_LABEL[raw.likelihood] ?? raw.likelihood
    }). Score = log weight of the class minus the mean log weight of the other classes.`,
  };
}

/**
 * Mengubah seluruh hasil mentah Naive Bayes menjadi `ResultJson` (Table[])
 * sesuai output yang dicentang di tab Output (AGENTS.md §4.3). Tabel yang
 * tidak dicentang tidak ikut dibangun.
 */
export function transformNaiveBayesResult(
  raw: NaiveBayesRawResult,
  outputFlags: {
    CaseProcessingSummary: boolean;
    AttributeDistributionTable: boolean;
    ModelEvaluationMetrics: boolean;
    ConfusionMatrix: boolean;
    // v2: opsional agar pemanggil v1 tetap valid. Opsi ini tetap tersimpan
    // true walau tidak ada Text Features, jadi tabel Text hanya dibangun bila
    // Rust benar-benar mengirim `text_feature_table`.
    TextFeatureTable?: boolean;
  }
): ResultJson {
  const tables: Table[] = [];

  if (outputFlags.CaseProcessingSummary && raw.case_processing_summary) {
    // not_scored_rows level atas dipakai bila summary belum membawanya.
    const summaryRaw =
      raw.case_processing_summary.not_scored_rows === undefined &&
      raw.not_scored_rows !== undefined
        ? { ...raw.case_processing_summary, not_scored_rows: raw.not_scored_rows }
        : raw.case_processing_summary;
    tables.push(
      buildCaseProcessingSummaryTable(summaryRaw, getTrainedText(raw.trained_model))
    );
  }

  if (
    outputFlags.AttributeDistributionTable &&
    raw.attribute_distribution?.length
  ) {
    tables.push(buildAttributeDistributionTable(raw.attribute_distribution));
  }

  if (outputFlags.ModelEvaluationMetrics && raw.evaluation_metrics) {
    tables.push(...buildEvaluationMetricsTables(raw.evaluation_metrics));
  }

  if (outputFlags.ConfusionMatrix && raw.confusion_matrix) {
    tables.push(buildConfusionMatrixTable(raw.confusion_matrix));
  }

  if (outputFlags.TextFeatureTable === true && raw.text_feature_table) {
    tables.push(buildTextFeatureTable(raw.text_feature_table));
  }

  return { tables };
}
