// naive-bayes-interpretation.ts
//
// Interpretasi otomatis (PLAN_V3_UI_EN §3.4) untuk setiap output Naive Bayes.
// Semua fungsi MURNI dan deterministik: masukan = hasil mentah run ini, keluaran
// = string HTML pendek berbahasa Inggris (hanya <p>, <strong>, <em>, <ul>, <li>)
// yang dipasang sebagai `description` statistic dan tetap bisa diedit pengguna.
// Tidak memakai AI/LLM saat runtime.
//
// Aturan yang dijaga di sini:
//  - semua nilai dari data di-escape HTML (& < > ");
//  - field hilang/NaN/Infinity -> kalimat generik tanpa angka (tidak pernah
//    "undefined"/"NaN" di HTML);
//  - angka: metrik 3 desimal, persentase 1 desimal, probabilitas 4 desimal;
//  - tidak ada klaim di luar data.
//
// Tiga fungsi evaluasi (`describeEvaluationMetrics`, `describeCohensKappa`,
// `describeConfusionMatrix`) diekspor karena dipakai ulang oleh Apply Model (Fase I2).

import { getLeakageNote } from "@/components/Modals/Analyze/Classify/naive-bayes/hooks/useNaiveBayesTextRules";
import {
  TEXT_NO_PRIOR_NOTE,
  describeValidationScenario,
  textSummaryFromTrainedText,
  type NaiveBayesAttributeDistributionRaw,
  type NaiveBayesCaseProcessingSummaryRaw,
  type NaiveBayesConfusionMatrixRaw,
  type NaiveBayesEvaluationMetricsRaw,
  type NaiveBayesNumericalAttribute,
  type NaiveBayesTextFeatureTableRaw,
  type NaiveBayesTextLikelihoodRaw,
  type NaiveBayesTrainedModelRaw,
  type NaiveBayesTrainedTextRaw,
} from "./naive-bayes-analysis-formatter";

/* =========================
   HELPER DASAR
========================= */

/** Batas daftar yang ditulis di dalam kalimat agar teks tetap pendek. */
const MAX_LISTED = 5;

/** Escape HTML untuk setiap nilai yang berasal dari data (nama kelas, variabel, term). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Angka hingga hanya bila berhingga; selain itu null (tidak pernah NaN di teks). */
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const metric = (value: number): string => value.toFixed(3);
const percent = (fraction: number): string => `${(fraction * 100).toFixed(1)}%`;
const probability = (value: number): string => value.toFixed(4);

/** `1 row` / `3 rows`. */
const rowsText = (count: number): string => `${count} row${count === 1 ? "" : "s"}`;

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

const TEXT_LIKELIHOOD_NAME: Record<NaiveBayesTextLikelihoodRaw, string> = {
  multinomial: "Multinomial",
  bernoulli: "Bernoulli",
  complement: "Complement",
};

/* =========================
   ANALISIS MATRIKS KONFUSI (dipakai Metrics & Confusion Matrix)
========================= */

type ConfusionStats = {
  classes: string[];
  rowTotals: number[];
  total: number;
  correct: number;
  /** Salah klasifikasi terbanyak (actual -> predicted); null bila tidak ada kesalahan. */
  worst: { actual: string; predicted: string; count: number } | null;
};

/** Menurunkan statistik dari `matrix` (sumber kebenaran); null bila bentuknya tidak dapat dipakai. */
function analyseConfusion(
  confusion: NaiveBayesConfusionMatrixRaw | null | undefined
): ConfusionStats | null {
  if (!confusion || !Array.isArray(confusion.classes) || !Array.isArray(confusion.matrix)) {
    return null;
  }
  const size = confusion.classes.length;
  if (size === 0) return null;

  const cell = (i: number, j: number): number => {
    const value = num(confusion.matrix[i]?.[j]);
    return value !== null && value > 0 ? value : 0;
  };

  const classes = confusion.classes.map((name) => String(name ?? ""));
  const rowTotals: number[] = [];
  let total = 0;
  let correct = 0;
  let worst: ConfusionStats["worst"] = null;

  for (let i = 0; i < size; i++) {
    let rowSum = 0;
    for (let j = 0; j < size; j++) {
      const value = cell(i, j);
      rowSum += value;
      if (i === j) correct += value;
      else if (value > 0 && (worst === null || value > worst.count)) {
        worst = { actual: classes[i], predicted: classes[j], count: value };
      }
    }
    rowTotals.push(rowSum);
    total += rowSum;
  }

  if (total <= 0) return null;
  return { classes, rowTotals, total, correct, worst };
}

/** Rasio kelas terkecil/terbesar (berdasarkan jumlah baris aktual). */
function classBalanceRatio(stats: ConfusionStats): number | null {
  const max = Math.max(...stats.rowTotals);
  const min = Math.min(...stats.rowTotals);
  return max > 0 ? min / max : null;
}

/* =========================
   COHEN'S KAPPA
========================= */

/** Kategori Landis & Koch (1977). */
export function kappaCategory(kappa: number): string {
  if (kappa < 0) return "poor";
  if (kappa <= 0.2) return "slight";
  if (kappa <= 0.4) return "fair";
  if (kappa <= 0.6) return "moderate";
  if (kappa <= 0.8) return "substantial";
  return "almost perfect";
}

export function describeCohensKappa(kappa: number | null | undefined): string {
  const value = num(kappa);
  const keyFindings =
    value === null
      ? "Cohen's Kappa is not available for this run."
      : `Cohen's Kappa is ${metric(value)}, which falls in the <em>${kappaCategory(value)}</em> agreement range.`;

  return [
    paragraph(
      "What this shows.",
      "Cohen's Kappa measures how well the predicted classes agree with the actual classes after removing the agreement that would be expected by chance. A value of 1 means perfect agreement, 0 means chance-level agreement, and negative values mean agreement worse than chance."
    ),
    paragraph(
      "How to read it.",
      "Following Landis &amp; Koch (1977): below 0 is poor, 0 to 0.20 slight, 0.21 to 0.40 fair, 0.41 to 0.60 moderate, 0.61 to 0.80 substantial, and 0.81 to 1 almost perfect."
    ),
    paragraph("Key findings.", keyFindings),
    paragraph(
      "Note.",
      "Kappa is a single overall value and is not broken down per class. These ranges are conventional guidelines, not strict rules."
    ),
  ].join("");
}

/* =========================
   CONFUSION MATRIX
========================= */

export function describeConfusionMatrix(confusion: NaiveBayesConfusionMatrixRaw): string {
  const stats = analyseConfusion(confusion);

  let keyFindings: string;
  if (stats === null) {
    keyFindings = "The confusion matrix has no evaluated rows, so no summary can be given.";
  } else {
    keyFindings = sentences([
      `${rowsText(stats.correct)} out of ${stats.total} evaluated (${percent(stats.correct / stats.total)}) lie on the diagonal, which means they were predicted correctly.`,
      stats.worst
        ? `The most frequent misclassification is actual ${quoted(stats.worst.actual)} predicted as ${quoted(stats.worst.predicted)} (${rowsText(stats.worst.count)}).`
        : "There are no misclassified rows.",
    ]);
  }

  return [
    paragraph(
      "What this shows.",
      "A cross-tabulation of the actual class (rows) against the class predicted by the model (columns) on the evaluation data. Each cell shows a count and its percentage of the row total."
    ),
    paragraph(
      "How to read it.",
      "Cells on the diagonal are correct predictions. Cells off the diagonal are errors: the row tells you the true class and the column tells you what the model predicted instead. A class whose row has large off-diagonal counts is often confused with the class in that column."
    ),
    paragraph("Key findings.", keyFindings),
  ].join("");
}

/* =========================
   MODEL EVALUATION METRICS
========================= */

export function describeEvaluationMetrics(
  metrics: NaiveBayesEvaluationMetricsRaw,
  confusion?: NaiveBayesConfusionMatrixRaw
): string {
  const accuracy = num(metrics?.overall_accuracy);
  const macroF1 = num(metrics?.macro_avg?.f1);
  const weightedF1 = num(metrics?.weighted_avg?.f1);
  const stats = analyseConfusion(confusion);

  // No-information rate: proporsi kelas terbanyak pada data evaluasi.
  let nirSentence: string | null = null;
  if (stats !== null) {
    const topIndex = stats.rowTotals.indexOf(Math.max(...stats.rowTotals));
    const nir = stats.rowTotals[topIndex] / stats.total;
    if (accuracy !== null) {
      nirSentence = `Overall accuracy is ${metric(accuracy)}. The no-information rate (the share of the most frequent class ${quoted(stats.classes[topIndex])}) is ${metric(nir)}. ${
        accuracy <= nir + 0.01
          ? "The model is not yet better than always guessing the majority class."
          : `The model exceeds it by ${metric(accuracy - nir)}.`
      }`;
    } else {
      nirSentence = `The no-information rate (the share of the most frequent class ${quoted(stats.classes[topIndex])}) is ${metric(nir)}.`;
    }
  } else if (accuracy !== null) {
    nirSentence = `Overall accuracy is ${metric(accuracy)}.`;
  }

  const f1Sentence =
    macroF1 !== null && weightedF1 !== null
      ? `Macro F1 is ${metric(macroF1)} and weighted F1 is ${metric(weightedF1)}.`
      : macroF1 !== null
        ? `Macro F1 is ${metric(macroF1)}.`
        : weightedF1 !== null
          ? `Weighted F1 is ${metric(weightedF1)}.`
          : null;

  // Kelas dengan recall terendah (seri -> kelas pertama).
  let recallSentence: string | null = null;
  let lowest: { name: string; recall: number } | null = null;
  for (const row of Array.isArray(metrics?.per_class) ? metrics.per_class : []) {
    const recall = num(row?.recall);
    if (recall !== null && (lowest === null || recall < lowest.recall)) {
      lowest = { name: String(row.class ?? ""), recall };
    }
  }
  if (lowest !== null) {
    recallSentence = `The lowest recall is ${metric(lowest.recall)} for class ${quoted(lowest.name)}.`;
  }

  const keyFindings =
    sentences([nirSentence, f1Sentence, recallSentence]) ||
    "Evaluation metrics are not available for this run.";

  // Ketidakseimbangan kelas: rasio kelas terkecil/terbesar < 0.5.
  const ratio = stats !== null ? classBalanceRatio(stats) : null;
  const note =
    ratio !== null && ratio < 0.5
      ? `The classes are imbalanced: the smallest class has only ${percent(ratio)} as many rows as the largest. Pay attention to macro F1 and the recall of each class rather than to accuracy alone.`
      : "";

  return [
    paragraph(
      "What this shows.",
      "Accuracy, precision, recall and F1-score for each class, plus macro, weighted and micro averages and the overall accuracy, all computed on the evaluation data."
    ),
    paragraph(
      "How to read it.",
      "Precision is the share of rows predicted as a class that truly belong to it. Recall is the share of the rows of a class that the model found. F1 combines both. The macro average treats every class equally, while the weighted average gives larger classes more influence. Overall accuracy is the share of all rows predicted correctly."
    ),
    paragraph("Key findings.", keyFindings),
    paragraph("Note.", note),
  ].join("");
}

/* =========================
   CASE PROCESSING SUMMARY
========================= */

export function describeCaseProcessingSummary(
  raw: NaiveBayesCaseProcessingSummaryRaw | null | undefined,
  text?: NaiveBayesTrainedTextRaw | null
): string {
  const total = num(raw?.total_instances);
  const valid = num(raw?.valid_instances);
  const excluded = num(raw?.excluded_target_missing);
  const textSummary = raw?.text_features ?? (text ? textSummaryFromTrainedText(text) : null);

  const validSentence =
    total !== null && valid !== null
      ? `${valid} of ${rowsText(total)} are valid${total > 0 ? ` (${percent(valid / total)})` : ""}${
          excluded !== null
            ? `; ${rowsText(excluded)} ${excluded === 1 ? "was" : "were"} excluded because the target value is missing.`
            : "."
        }`
      : null;

  const attributes = Array.isArray(raw?.attribute_variables) ? raw.attribute_variables : [];
  const targetSentence =
    typeof raw?.target_variable === "string" && raw.target_variable !== ""
      ? `The target variable is ${quoted(raw.target_variable)}${
          attributes.length > 0
            ? ` and it is predicted from ${attributes.length} attribute variable${attributes.length === 1 ? "" : "s"} (${listNames(attributes)}).`
            : "."
        }`
      : null;

  const scenarioSentence = raw?.validation_scenario
    ? `Validation scenario: ${escapeHtml(describeValidationScenario(raw.validation_scenario))}.`
    : null;

  const textSentence = textSummary
    ? `Text Features: ${escapeHtml(textSummary.description)}, ${TEXT_LIKELIHOOD_NAME[textSummary.likelihood] ?? escapeHtml(String(textSummary.likelihood))} likelihood${
        num(textSummary.alpha) !== null ? `, smoothing alpha ${num(textSummary.alpha)}` : ""
      }.`
    : null;

  const notScored = num(raw?.not_scored_rows);
  const notScoredSentence =
    notScored === null
      ? null
      : notScored === 0
        ? "No rows were left unscored."
        : `${rowsText(notScored)} could not be scored in the evaluation because all predictors were missing.`;

  const keyFindings =
    sentences([validSentence, targetSentence, scenarioSentence, textSentence, notScoredSentence]) ||
    "No case counts are available for this run.";

  const noteParts: string[] = [];
  if (textSummary?.leakage_note) {
    const leakage = getLeakageNote(textSummary.source);
    if (leakage) noteParts.push(escapeHtml(leakage));
  }
  if (textSummary && !textSummary.uses_class_prior) noteParts.push(escapeHtml(TEXT_NO_PRIOR_NOTE));

  return [
    paragraph(
      "What this shows.",
      "How many rows were available, how many were valid for the analysis, and how the model was validated."
    ),
    paragraph(
      "How to read it.",
      `Valid instances are the rows that have a target value; rows with a missing target are excluded. ${
        notScored !== null
          ? "A row is <em>not scored</em> when every predictor is missing, so no prediction can be made for it. "
          : ""
      }The validation scenario states how the data were split into training and evaluation parts.`
    ),
    paragraph("Key findings.", keyFindings),
    paragraph("Note.", noteParts.join(" ")),
  ].join("");
}

/* =========================
   ATTRIBUTE DISTRIBUTION TABLE
========================= */

/** SD gabungan sederhana: akar rata-rata varians antar kelas (jumlah baris per kelas tidak tersedia). */
function pooledStd(values: number[]): number | null {
  if (values.length === 0) return null;
  const meanVariance = values.reduce((sum, sd) => sum + sd * sd, 0) / values.length;
  return Number.isFinite(meanVariance) && meanVariance > 0 ? Math.sqrt(meanVariance) : null;
}

export function describeAttributeDistribution(
  attributes: NaiveBayesAttributeDistributionRaw[]
): string {
  const list = Array.isArray(attributes) ? attributes : [];
  const categorical = list.filter((a) => a?.role === "categorical");
  const numerical = list.filter(
    (a): a is NaiveBayesNumericalAttribute => a?.role === "numerical"
  );

  // Atribut numerik dengan beda mean antar kelas terbesar (satuan SD gabungan).
  let bestNumeric: { name: string; distance: number; lo: string; hi: string; loMean: number; hiMean: number } | null =
    null;
  for (const attribute of numerical) {
    const rows = (attribute.numeric?.per_class ?? []).filter(
      (row) => num(row?.mean) !== null && num(row?.std_dev) !== null
    );
    if (rows.length < 2) continue;
    const sd = pooledStd(rows.map((row) => row.std_dev));
    if (sd === null) continue;
    const lo = rows.reduce((a, b) => (b.mean < a.mean ? b : a));
    const hi = rows.reduce((a, b) => (b.mean > a.mean ? b : a));
    const distance = (hi.mean - lo.mean) / sd;
    if (bestNumeric === null || distance > bestNumeric.distance) {
      bestNumeric = {
        name: attribute.name,
        distance,
        lo: lo.class,
        hi: hi.class,
        loMean: lo.mean,
        hiMean: hi.mean,
      };
    }
  }

  // Kategori dengan rasio probabilitas antar kelas terbesar (probabilitas > 0).
  let bestCategory: { attribute: string; category: string; ratio: number; hiClass: string; loClass: string; hiP: number; loP: number } | null =
    null;
  for (const attribute of categorical) {
    if (attribute.role !== "categorical") continue;
    for (const category of attribute.categories ?? []) {
      const rows = (category.per_class ?? []).filter(
        (row) => num(row?.probability) !== null && row.probability > 0
      );
      if (rows.length < 2) continue;
      const lo = rows.reduce((a, b) => (b.probability < a.probability ? b : a));
      const hi = rows.reduce((a, b) => (b.probability > a.probability ? b : a));
      const ratio = hi.probability / lo.probability;
      if (bestCategory === null || ratio > bestCategory.ratio) {
        bestCategory = {
          attribute: attribute.name,
          category: category.category,
          ratio,
          hiClass: hi.class,
          loClass: lo.class,
          hiP: hi.probability,
          loP: lo.probability,
        };
      }
    }
  }

  const findings: string[] = [];
  if (list.length > 0) {
    findings.push(
      `The table covers ${categorical.length} categorical and ${numerical.length} numeric attribute${list.length === 1 ? "" : "s"}.`
    );
  }
  if (bestNumeric !== null) {
    findings.push(
      `Among the numeric attributes, ${quoted(bestNumeric.name)} separates the classes most: its class means range from ${metric(bestNumeric.loMean)} (${quoted(bestNumeric.lo)}) to ${metric(bestNumeric.hiMean)} (${quoted(bestNumeric.hi)}), about ${bestNumeric.distance.toFixed(2)} pooled standard deviations apart.`
    );
  }
  if (bestCategory !== null) {
    findings.push(
      `Among the categorical attributes, category ${quoted(bestCategory.category)} of ${quoted(bestCategory.attribute)} differs most between classes: its probability is ${percent(bestCategory.hiP)} in class ${quoted(bestCategory.hiClass)} versus ${percent(bestCategory.loP)} in class ${quoted(bestCategory.loClass)} (${bestCategory.ratio.toFixed(2)} times).`
    );
  }
  if (findings.length === 0) findings.push("No attribute distributions are available for this run.");

  const minStd = numerical.filter((a) => a.likelihood === "gaussian_minstd").map((a) => a.name);
  const note =
    minStd.length > 0
      ? `A minimum standard deviation was applied to ${listNames(minStd)}, so the displayed standard deviation can be larger than the raw sample value.`
      : "";

  return [
    paragraph(
      "What this shows.",
      "The parameters the model learned for every attribute, separately for each class. These values are what the model uses to score a new row."
    ),
    paragraph(
      "How to read it.",
      "For a categorical attribute, each cell shows the raw count, the smoothed count (after adding the smoothing alpha), the resulting probability, and the class total. For a numeric attribute, the rows show the mean and standard deviation per class. Attributes whose values differ strongly between classes are the most useful for telling the classes apart."
    ),
    paragraph("Key findings.", findings.join(" ")),
    paragraph("Note.", note),
  ].join("");
}

/* =========================
   TEXT FEATURE TABLE
========================= */

export function describeTextFeatureTable(
  raw: NaiveBayesTextFeatureTableRaw,
  options?: { alpha?: number | null; source?: "raw" | "vector" | null }
): string {
  const likelihood = TEXT_LIKELIHOOD_NAME[raw?.likelihood] ?? "text";
  const alpha = num(options?.alpha);
  const classes =
    Array.isArray(raw?.classes) && raw.classes.length > 0
      ? raw.classes
      : Object.keys(raw?.top ?? {});

  // 3 term teratas per kelas, berdasarkan urutan Top-k dari hasil.
  const items = classes.slice(0, MAX_LISTED).flatMap((className) => {
    const terms = (raw?.top?.[className] ?? [])
      .slice(0, 3)
      .map((entry) => entry?.term)
      .filter((term): term is string => typeof term === "string" && term !== "");
    return terms.length > 0
      ? [`<li>Class ${quoted(className)}: ${terms.map(quoted).join(", ")}</li>`]
      : [];
  });
  const more = classes.length - MAX_LISTED;

  const intro = `Likelihood: ${likelihood}${alpha !== null ? `, smoothing alpha ${alpha}` : ""}.`;
  const keyHtml =
    items.length > 0
      ? `<p><strong>Key findings.</strong> ${intro} The three most characteristic terms per class are:</p><ul>${items.join("")}</ul>${
          more > 0 ? `<p>${more} more class${more === 1 ? "" : "es"} are shown in the table.</p>` : ""
        }`
      : paragraph("Key findings.", `${intro} No terms are available for this run.`);

  const k = num(raw?.k);
  const leakage = options?.source ? getLeakageNote(options.source) : null;
  const note = sentences([
    k !== null && k > 0
      ? `Only the top ${Math.floor(k)} terms per class are shown; use Download CSV for the complete term-by-class table.`
      : "Use Download CSV for the complete term-by-class table.",
    leakage ? escapeHtml(leakage) : null,
  ]);

  return [
    paragraph(
      "What this shows.",
      "The terms that influence the model most for each class, based on the text features it learned."
    ),
    paragraph(
      "How to read it.",
      "Score is the log weight of a term in a class minus the average log weight of the same term in the other classes, so a higher score means the term is more characteristic of that class. Log weight is the logarithm of the weight the model gives the term for that class, and Count is the term count behind it."
    ),
    // `keyHtml` sudah berupa blok HTML utuh (paragraf + daftar bila ada).
    keyHtml,
    paragraph("Note.", note),
  ].join("");
}

/* =========================
   EXPORT MODEL
========================= */

export function describeExportModel(model: NaiveBayesTrainedModelRaw | null | undefined): string {
  const schema = typeof model?.schema_version === "string" ? model.schema_version : null;
  const classCount = Array.isArray(model?.target?.classes) ? model.target.classes.length : null;
  const featureCount = Array.isArray(model?.feature_order) ? model.feature_order.length : null;
  const textBlock = model && "text" in model ? model.text : null;

  const findings = sentences([
    schema !== null ? `This export uses schema version ${escapeHtml(schema)}.` : null,
    model?.target?.name
      ? `It predicts ${quoted(model.target.name)}${classCount !== null ? ` with ${classCount} class${classCount === 1 ? "" : "es"}` : ""}.`
      : null,
    featureCount !== null
      ? `It stores ${featureCount} numeric or categorical predictor${featureCount === 1 ? "" : "s"}${
          textBlock ? ` and a ${TEXT_LIKELIHOOD_NAME[textBlock.likelihood] ?? "text"} Text Features block (${textBlock.source === "raw" ? "raw text" : "word vectors"})` : ""
        }.`
      : null,
  ]);

  return [
    paragraph(
      "What this shows.",
      "A button to download the trained Naive Bayes model as a JSON file. The file contains the class priors, the learned parameters of every predictor, the settings used for training and, when Text Features were used, the term weights."
    ),
    paragraph(
      "How to read it.",
      "Schema 1.1 describes models with numeric and categorical predictors only. Schema 2.0 additionally records the likelihood type of each predictor and the Text Features block. To score another dataset, load the file in Apply Model."
    ),
    paragraph("Key findings.", findings || "The model is ready to be exported."),
    paragraph(
      "Note.",
      "The file can contain the original category labels and terms from your dataset. Check that it does not hold sensitive information before sharing it."
    ),
  ].join("");
}
