// apply-model-interpretation.ts
//
// Interpretasi otomatis (PLAN_V3_UI_EN §3.4) untuk setiap output Apply Model.
// Semua fungsi MURNI dan deterministik: masukan = hasil mentah run ini, keluaran
// = string HTML pendek berbahasa Inggris (hanya <p>, <strong>, <em>, <ul>, <li>)
// yang dipasang sebagai `description` statistic dan tetap bisa diedit pengguna.
// Tidak memakai AI/LLM saat runtime.
//
// Aturan yang dijaga di sini (sama dengan modul NB):
//  - semua nilai dari data di-escape HTML (& < > ");
//  - field hilang/NaN/Infinity -> kalimat generik tanpa angka (tidak pernah
//    "undefined"/"NaN" di HTML);
//  - angka: metrik 3 desimal, persentase 1 desimal;
//  - tidak ada klaim di luar data.
//
// Tabel evaluasi (Metrics, Kappa, Confusion Matrix) memakai ulang fungsi milik
// NB (read-only) lalu menambahkan satu kalimat tentang baris yang dikecualikan.

import {
  describeCohensKappa,
  describeConfusionMatrix,
  describeEvaluationMetrics,
  escapeHtml,
} from "@/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-interpretation";
import type {
  ApplyModelSavedColumn,
  ApplyModelTextMappingInfo,
} from "@/components/Modals/Analyze/Classify/apply-model/services/apply-model-formatter";
import type { ApplyModelRawResult } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model-worker";

type ModelSummaryRaw = ApplyModelRawResult["model_summary"];
type CaseProcessingRaw = ApplyModelRawResult["case_processing_summary"];
type PredictionDistributionRaw = ApplyModelRawResult["prediction_distribution"];
type EvaluationRaw = ApplyModelRawResult["evaluation"];

/* =========================
   HELPER DASAR
========================= */

/** Batas daftar yang ditulis di dalam kalimat agar teks tetap pendek. */
const MAX_LISTED = 5;

/** Angka hanya bila berhingga; selain itu null (tidak pernah NaN di teks). */
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** Bilangan bulat tak negatif atau null. */
const count = (value: unknown): number | null => {
  const parsed = num(value);
  return parsed !== null && parsed >= 0 ? Math.round(parsed) : null;
};

const percent = (fraction: number): string => `${(fraction * 100).toFixed(1)}%`;

/** `1 row` / `3 rows`. */
const rowsText = (amount: number): string => `${amount} row${amount === 1 ? "" : "s"}`;

/** Nama (kelas/variabel/term) yang sudah di-escape dan diberi tanda kutip tunggal. */
const quoted = (value: unknown): string => `'${escapeHtml(String(value ?? ""))}'`;

/** Daftar nama dalam kalimat: `'a', 'b' and 2 more`. */
function listNames(names: string[], max = MAX_LISTED): string {
  const shown = names.slice(0, max).map(quoted).join(", ");
  const rest = names.length - max;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

/** Satu paragraf berlabel; kosong bila teks kosong. */
const paragraph = (label: string, text: string): string =>
  text.trim() === "" ? "" : `<p><strong>${label}</strong> ${text}</p>`;

/** Gabungkan kalimat yang ada (buang yang kosong). */
const sentences = (parts: Array<string | null | undefined | false>): string =>
  parts.filter((part): part is string => typeof part === "string" && part !== "").join(" ");

/** Nama likelihood teks dari Rust (huruf kecil) -> nama tampilan. */
const TEXT_LIKELIHOOD_NAME: Record<string, string> = {
  multinomial: "Multinomial",
  bernoulli: "Bernoulli",
  complement: "Complement",
};

/** Nilai parameter ringkasan model berdasarkan label; null bila tidak ada. */
function summaryParameter(
  summary: ModelSummaryRaw | null | undefined,
  label: string
): string | null {
  const parameters = Array.isArray(summary?.parameters) ? summary.parameters : [];
  const found = parameters.find((parameter) => parameter?.label === label);
  return typeof found?.value === "string" ? found.value : null;
}

/* =========================
   MODEL SUMMARY
========================= */

export type ApplyModelSummaryDescriptionContext = {
  /** Teks sumber model, mis. `File: nb-model.json`. */
  sourceLabel?: string | null;
  /** Nama algoritma tampilan (adapter); bila kosong dipakai `model_type`. */
  algorithmLabel?: string | null;
  /** Pemetaan fitur Text (hanya model dengan Text Features). */
  textMapping?: ApplyModelTextMappingInfo;
};

/** Kalimat ringkasan vektor kanonik (PLAN §3.3): `{m} of {V} vector columns found; {V−m} treated as 0.` */
export function describeVectorColumnsFound(mappedColumns: number, totalColumns: number): string {
  const mapped = Math.max(0, Math.round(mappedColumns));
  const total = Math.max(mapped, Math.round(totalColumns));
  return `${mapped} of ${total} vector columns found; ${total - mapped} treated as 0.`;
}

export function describeApplyModelSummary(
  raw: ModelSummaryRaw | null | undefined,
  context: ApplyModelSummaryDescriptionContext = {}
): string {
  let keyFindings: string;
  let note = "";

  if (!raw) {
    keyFindings = "The model summary is not available for this run.";
  } else {
    const algorithm =
      (context.algorithmLabel ?? "").trim() !== "" ? String(context.algorithmLabel) : raw.model_type;
    const source = (context.sourceLabel ?? "").trim();
    const classes = Array.isArray(raw.classes) ? raw.classes.map((name) => String(name ?? "")) : [];
    const features = Array.isArray(raw.features) ? raw.features : [];
    const categorical = features.filter((feature) => feature?.role === "categorical").length;
    const numerical = features.filter((feature) => feature?.role === "numerical").length;

    // Kalimat tentang model: algoritma, schema, target, dan kelas.
    const modelSentence =
      `This is a ${escapeHtml(String(algorithm ?? ""))} model` +
      (raw.schema_version ? ` (schema ${escapeHtml(String(raw.schema_version))})` : "") +
      (raw.target_name
        ? ` that predicts ${quoted(raw.target_name)}${
            classes.length > 0
              ? ` with ${classes.length} class${classes.length === 1 ? "" : "es"}: ${listNames(classes)}`
              : ""
          }.`
        : ".");

    const featureSentence =
      features.length > 0
        ? `${features.length} feature${features.length === 1 ? " is" : "s are"} mapped to dataset variables (${categorical} categorical, ${numerical} numeric).`
        : null;

    // Sumber teks: raw (variabel string) atau vector (kolom vektor kata).
    let textSentence: string | null = null;
    const mapping = context.textMapping;
    if (mapping?.source === "raw") {
      textSentence = `Text is read from the raw text variable ${quoted(mapping.datasetVariable)}.`;
    } else if (mapping?.source === "vector") {
      textSentence = describeVectorColumnsFound(mapping.mappedColumns, mapping.totalColumns);
    }
    const likelihoodValue = summaryParameter(raw, "Text likelihood");
    const likelihoodSentence =
      likelihoodValue !== null
        ? `The text likelihood is ${escapeHtml(TEXT_LIKELIHOOD_NAME[likelihoodValue] ?? likelihoodValue)}.`
        : null;

    keyFindings = sentences([
      source !== "" ? `The model source is ${escapeHtml(source)}.` : null,
      modelSentence,
      featureSentence,
      textSentence,
      likelihoodSentence,
    ]);

    if (raw.legacy_unseen_handling === true) {
      note =
        "This model uses the older schema 1.0, which skips categories that were not seen during training instead of smoothing them. Export the model again from Naive Bayes for consistent results.";
    }
  }

  return [
    paragraph(
      "What this shows.",
      "The trained model that was applied to the dataset: where it was loaded from, its algorithm and version, the target variable with its classes, and how each model feature is matched to a dataset variable."
    ),
    paragraph(
      "How to read it.",
      "Each Feature row reads as model feature, then the dataset variable it is mapped to, then its role (categorical or numerical). The remaining rows are settings that were stored with the model when it was trained."
    ),
    paragraph("Key findings.", keyFindings),
    paragraph("Note.", note),
  ].join("");
}

/* =========================
   EVALUASI: BARIS YANG DIKECUALIKAN
========================= */

/** Kalimat baris yang dikecualikan dari evaluasi; "" bila tidak ada yang dikecualikan. */
function exclusionSentence(evaluation: EvaluationRaw | null | undefined): string {
  if (!evaluation) return "";
  const parts: string[] = [];
  const notScored = count(evaluation.excluded_not_scored) ?? 0;
  const missing = count(evaluation.excluded_actual_missing) ?? 0;
  const unknown = count(evaluation.excluded_actual_unknown_class) ?? 0;
  const total = notScored + missing + unknown;
  if (total === 0) return "";

  if (notScored > 0) parts.push(`${notScored} not scored`);
  if (missing > 0) parts.push(`${missing} with a missing actual value`);
  if (unknown > 0) parts.push(`${unknown} whose actual class is not in the model`);
  return `${rowsText(total)} were excluded from the evaluation (${parts.join(", ")}).`;
}

/**
 * Menambahkan kalimat ke paragraf "Note." terakhir; bila belum ada paragraf Note,
 * dibuat satu paragraf baru. Hanya menyentuh akhir string HTML hasil fungsi NB.
 */
function appendNote(html: string, text: string): string {
  if (text === "") return html;
  const noteStart = html.lastIndexOf("<p><strong>Note.</strong>");
  if (noteStart >= 0 && html.endsWith("</p>")) {
    return `${html.slice(0, -"</p>".length)} ${text}</p>`;
  }
  return html + paragraph("Note.", text);
}

/** Model Evaluation Metrics: fungsi NB + baris yang dikecualikan. */
export function describeApplyModelEvaluationMetrics(
  evaluation: EvaluationRaw | null | undefined
): string {
  if (!evaluation?.evaluation_metrics) {
    return paragraph("What this shows.", "Evaluation metrics are not available for this run.");
  }
  return appendNote(
    describeEvaluationMetrics(evaluation.evaluation_metrics, evaluation.confusion_matrix),
    exclusionSentence(evaluation)
  );
}

/** Cohen's Kappa: fungsi NB + baris yang dikecualikan. */
export function describeApplyModelCohensKappa(evaluation: EvaluationRaw | null | undefined): string {
  return appendNote(
    describeCohensKappa(evaluation?.evaluation_metrics?.cohens_kappa),
    exclusionSentence(evaluation)
  );
}

/** Confusion Matrix: fungsi NB + baris yang dikecualikan. */
export function describeApplyModelConfusionMatrix(
  evaluation: EvaluationRaw | null | undefined
): string {
  if (!evaluation?.confusion_matrix) {
    return paragraph("What this shows.", "The confusion matrix is not available for this run.");
  }
  return appendNote(
    describeConfusionMatrix(evaluation.confusion_matrix),
    exclusionSentence(evaluation)
  );
}

/* =========================
   CASE PROCESSING SUMMARY
========================= */

export function describeApplyModelCaseProcessingSummary(
  raw: CaseProcessingRaw | null | undefined,
  evaluation?: EvaluationRaw | null,
  modelSummary?: ModelSummaryRaw | null
): string {
  const total = count(raw?.total_rows);
  const scored = count(raw?.scored_rows);
  const notScored = count(raw?.not_scored_all_missing);
  const missingPredictor = count(raw?.rows_with_missing_predictor) ?? 0;
  const unseen = count(raw?.rows_with_unseen_category) ?? 0;

  let keyFindings: string;
  if (total === null || scored === null) {
    keyFindings = "Row counts are not available for this run.";
  } else if (total === 0) {
    keyFindings = "The dataset has no rows to score.";
  } else {
    const emptyText = count(Number(summaryParameter(modelSummary, "Rows with empty text")));
    const evaluated = count(evaluation?.evaluated_rows);
    keyFindings = sentences([
      `${scored} of ${total} rows (${percent(scored / total)}) were scored.`,
      (notScored ?? 0) > 0
        ? `${rowsText(notScored ?? 0)} ${(notScored ?? 0) === 1 ? "was" : "were"} not scored because every predictor was missing.`
        : "No rows were left unscored because of missing predictors.",
      missingPredictor > 0
        ? `${rowsText(missingPredictor)} had at least one missing predictor but ${missingPredictor === 1 ? "was" : "were"} still scored.`
        : null,
      unseen > 0
        ? `${rowsText(unseen)} contained at least one category that was not seen during training.`
        : null,
      emptyText !== null && emptyText > 0
        ? `${rowsText(emptyText)} had empty text.`
        : null,
      evaluated !== null
        ? `${rowsText(evaluated)} ${evaluated === 1 ? "was" : "were"} used for evaluation against the actual variable.`
        : null,
      exclusionSentence(evaluation),
    ]);
  }

  // Cara kategori tak dikenal ditangani bergantung pada schema model.
  let note = "";
  if (unseen > 0) {
    note =
      modelSummary?.legacy_unseen_handling === true
        ? "In models with schema 1.0, an unseen category is skipped for the affected predictor."
        : "An unseen category is handled with smoothing, so the row is still scored.";
  }

  return [
    paragraph(
      "What this shows.",
      "How many dataset rows the model was applied to, how many could not be scored, and how many scored rows had data problems such as missing predictors or categories the model has not seen."
    ),
    paragraph(
      "How to read it.",
      "A row is not scored when all of its predictors are missing, and it gets an empty prediction in the saved variables. The evaluation rows appear only when an actual variable was selected."
    ),
    paragraph("Key findings.", keyFindings),
    paragraph("Note.", note),
  ].join("");
}

/* =========================
   PREDICTION DISTRIBUTION
========================= */

export type ApplyModelTrainingPriors = {
  classes: string[];
  /** Proporsi kelas pada data pelatihan (0..1), sejajar `classes`. */
  priors: number[];
};

/**
 * Membaca proporsi kelas pelatihan dari JSON model (`target.classes` +
 * `target.class_priors`). Mengembalikan null bila tidak tersedia, bentuknya tidak
 * sesuai, atau model tidak memakai prior (Complement Naive Bayes).
 */
export function readTrainingPriors(modelJson: unknown): ApplyModelTrainingPriors | null {
  if (typeof modelJson !== "object" || modelJson === null) return null;
  const model = modelJson as { target?: unknown; text?: unknown };

  // Complement NB tidak memakai prior; membandingkannya menyesatkan.
  if (typeof model.text === "object" && model.text !== null) {
    if ((model.text as { uses_class_prior?: unknown }).uses_class_prior === false) return null;
  }

  if (typeof model.target !== "object" || model.target === null) return null;
  const target = model.target as { classes?: unknown; class_priors?: unknown };
  if (!Array.isArray(target.classes) || !Array.isArray(target.class_priors)) return null;
  if (target.classes.length === 0 || target.classes.length !== target.class_priors.length) {
    return null;
  }

  const priors: number[] = [];
  for (const value of target.class_priors) {
    const parsed = num(value);
    if (parsed === null || parsed < 0 || parsed > 1) return null;
    priors.push(parsed);
  }
  return { classes: target.classes.map((name) => String(name ?? "")), priors };
}

export function describeApplyModelPredictionDistribution(
  raw: PredictionDistributionRaw | null | undefined,
  trainingPriors?: ApplyModelTrainingPriors | null
): string {
  const classes = Array.isArray(raw?.classes) ? raw.classes.map((name) => String(name ?? "")) : [];
  const counts = classes.map((_, index) => count(raw?.counts?.[index]) ?? 0);
  const scored = counts.reduce((sum, value) => sum + value, 0);
  const notScored = count(raw?.not_scored) ?? 0;

  let keyFindings: string;
  let note = "";

  if (classes.length === 0) {
    keyFindings = "The prediction distribution is not available for this run.";
  } else if (scored === 0) {
    keyFindings = "No rows were scored, so there is no distribution to describe.";
  } else {
    // Kelas terbanyak (seri -> kelas pertama).
    const topIndex = counts.indexOf(Math.max(...counts));
    const topShare = counts[topIndex] / scored;
    const never = classes.filter((_, index) => counts[index] === 0);

    // Perbandingan dengan proporsi kelas pada data pelatihan (bila tersedia di model).
    let priorSentence: string | null = null;
    let gapSentence: string | null = null;
    if (trainingPriors && trainingPriors.classes.length > 0) {
      const priorOf = (name: string): number | null => {
        const index = trainingPriors.classes.indexOf(name);
        return index >= 0 ? trainingPriors.priors[index] ?? null : null;
      };
      const topPrior = priorOf(classes[topIndex]);
      if (topPrior !== null) {
        priorSentence = `In the training data, class ${quoted(classes[topIndex])} made up ${percent(topPrior)} of the rows, compared with ${percent(topShare)} of the predictions here.`;
      }
      // Selisih terbesar pada kelas lain, hanya bila cukup besar (>= 10 poin persentase).
      let gapName: string | null = null;
      let gapPredicted = 0;
      let gapPrior = 0;
      let gapSize = 0;
      for (let index = 0; index < classes.length; index++) {
        if (index === topIndex) continue;
        const prior = priorOf(classes[index]);
        if (prior === null) continue;
        const predicted = counts[index] / scored;
        const gap = Math.abs(predicted - prior);
        if (gap >= 0.1 && gap > gapSize) {
          gapName = classes[index];
          gapPredicted = predicted;
          gapPrior = prior;
          gapSize = gap;
        }
      }
      if (gapName !== null) {
        gapSentence = `Class ${quoted(gapName)} differs the most among the other classes: ${percent(gapPredicted)} of the predictions versus ${percent(gapPrior)} in the training data.`;
      }
      if (priorSentence !== null) {
        note =
          "The training shares come from the model file and may differ from the dataset used here, so a difference does not by itself mean the predictions are wrong.";
      }
    }

    keyFindings = sentences([
      `The most frequent predicted class is ${quoted(classes[topIndex])} with ${rowsText(counts[topIndex])} (${percent(topShare)} of the scored rows).`,
      never.length > 0
        ? `No rows were predicted as ${listNames(never)}.`
        : null,
      priorSentence,
      gapSentence,
      notScored > 0
        ? `${rowsText(notScored)} ${notScored === 1 ? "was" : "were"} not scored and ${notScored === 1 ? "is" : "are"} listed separately.`
        : null,
    ]);
  }

  return [
    paragraph(
      "What this shows.",
      "How the scored rows are spread over the classes predicted by the model."
    ),
    paragraph(
      "How to read it.",
      "Count is the number of rows predicted as each class, and Percent of Scored is that count as a share of all scored rows. Rows that were not scored are shown separately and are not part of the percentages."
    ),
    paragraph("Key findings.", keyFindings),
    paragraph("Note.", note),
  ].join("");
}

/* =========================
   SAVED VARIABLES
========================= */

export function describeApplyModelSavedVariables(
  savedColumns: ApplyModelSavedColumn[] | null | undefined
): string {
  const columns = Array.isArray(savedColumns) ? savedColumns : [];

  let keyFindings: string;
  if (columns.length === 0) {
    keyFindings = "No variables were saved for this run.";
  } else {
    const finalNames = columns.map((column) => String(column?.finalName ?? ""));
    const numeric = columns.filter((column) => String(column?.type ?? "").toUpperCase() === "NUMERIC").length;
    const text = columns.filter((column) => String(column?.type ?? "").toUpperCase() === "STRING").length;
    const kinds = [
      numeric > 0 ? `${numeric} numeric` : null,
      text > 0 ? `${text} string` : null,
    ].filter((part): part is string => part !== null);

    keyFindings = sentences([
      `${columns.length} new variable${columns.length === 1 ? " was" : "s were"} added to the dataset: ${listNames(finalNames)}.`,
      kinds.length > 0 ? `That is ${kinds.join(" and ")}.` : null,
    ]);
  }

  return [
    paragraph(
      "What this shows.",
      "The new variables that Apply Model wrote to the dataset, such as the predicted class and, if selected, the maximum probability and the probability of each class."
    ),
    paragraph(
      "How to read it.",
      "Column describes the value that is saved. Final Name is the variable name actually created in the dataset, which can differ from the requested name when that name is already in use or is not valid. Type and Measure show how the variable is stored."
    ),
    paragraph("Key findings.", keyFindings),
    paragraph(
      "Note.",
      "Apply Model always creates new variables and never changes existing ones. Rows that were not scored are left empty."
    ),
  ].join("");
}
