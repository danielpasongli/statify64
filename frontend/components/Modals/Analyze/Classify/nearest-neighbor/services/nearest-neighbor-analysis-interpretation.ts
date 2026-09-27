/* eslint-disable @typescript-eslint/no-explicit-any -- WASM result payloads are validated while building interpretations. */
// Builds the short HTML interpretation shown in the output viewer "description"
// field for the KNN output items.

const STOPPING_REASON_TEXT: Record<string, string> = {
  zero_error: "error sudah 0",
  minimum_change_reached: "penurunan error sudah di bawah batas perubahan minimum",
  no_error_change: "error tidak berubah lagi",
  error_deteriorated: "fitur berikutnya justru menaikkan error",
  max_features_reached: "jumlah fitur maksimum tercapai",
  candidate_features_exhausted: "semua kandidat fitur sudah masuk",
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatFixed(value: number, digits: number) {
  return value.toFixed(digits);
}

// Classification errors arrive as percentages (0–100); regression errors as SSE.
function formatError(value: number, isRegression: boolean) {
  return isRegression ? `SSE ${formatFixed(value, 4)}` : `${formatFixed(value, 2)}%`;
}

function bold(value: unknown) {
  return `<strong>${escapeHtml(value)}</strong>`;
}

function featureList(features: string[]) {
  return features.length ? features.map(bold).join(", ") : "-";
}

function paragraph(text: string) {
  return `<p>${text}</p>`;
}

function stringList(values: unknown): string[] {
  return Array.isArray(values) ? values.map(String) : [];
}

function partitionTotal(partition: any) {
  return Array.isArray(partition?.observed)
    ? partition.observed.reduce(
        (sum: number, value: unknown) => sum + (toFiniteNumber(value) ?? 0),
        0,
      )
    : 0;
}

export function isRegressionResult(rawResult?: any) {
  return (
    rawResult?.predictor_space?.target_measure === "scale" ||
    (!rawResult?.classification_table && !rawResult?.error_summary)
  );
}

/* =========================
   k SELECTION (CROSS-VALIDATION)
========================= */

export function describeKSelection(chart?: any): string {
  const candidates = (Array.isArray(chart?.candidates) ? chart.candidates : [])
    .map((candidate: any) => ({
      k: toFiniteNumber(candidate?.k),
      error: toFiniteNumber(candidate?.average_error ?? candidate?.averageError),
    }))
    .filter((candidate: any) => candidate.k !== null && candidate.error !== null);

  if (!candidates.length) return "k Selection Error Log";

  const isRegression = String(chart?.metric_name ?? chart?.metricName ?? "")
    .toLowerCase()
    .includes("sse");
  const selectedK = toFiniteNumber(chart?.selected_k ?? chart?.selectedK);
  const selected =
    candidates.find((candidate: any) => candidate.k === selectedK) ??
    candidates.reduce((best: any, candidate: any) =>
      candidate.error < best.error ? candidate : best,
    );
  const details = candidates
    .map((candidate: any) => {
      const text = `k=${candidate.k}: ${formatError(candidate.error, isRegression)}`;
      return candidate.k === selected.k ? `<strong>${text}</strong>` : text;
    })
    .join("; ");

  return [
    paragraph(
      `<strong>k = ${selected.k}</strong> dipilih karena error cross-validation-nya paling kecil (${formatError(selected.error, isRegression)}).`,
    ),
    paragraph(`Error per k: ${details}.`),
  ].join("");
}

/* =========================
   FEATURE SELECTION (FIXED k & AUTO k)
========================= */

export function describeFeatureSelection(rawResult?: any): string {
  const summary = rawResult?.feature_selection_summary;
  const kSummary = Array.isArray(rawResult?.k_feature_selection_summary)
    ? rawResult.k_feature_selection_summary
    : [];

  if (!summary && !kSummary.length) return "Predictor Selection";

  const isRegression = isRegressionResult(rawResult);
  const selectedEntry = kSummary.find((entry: any) => entry?.selected);
  const selectedK = toFiniteNumber(selectedEntry?.k);
  const selectedFeatures = stringList(
    summary?.selected_features ?? selectedEntry?.selected_features,
  );
  const removedFeatures = stringList(summary?.removed_features);
  const finalError = toFiniteNumber(summary?.final_error ?? selectedEntry?.error);
  const reason =
    STOPPING_REASON_TEXT[String(summary?.stopping_reason ?? selectedEntry?.stopping_reason ?? "")];

  const parts = [
    paragraph(
      `Model terbaik${selectedK === null ? "" : ` menggunakan <strong>k = ${selectedK}</strong> dengan`} <strong>${selectedFeatures.length} fitur</strong>: ${featureList(selectedFeatures)}${
        finalError === null ? "" : ` (error ${formatError(finalError, isRegression)})`
      }.${removedFeatures.length ? ` Fitur ${featureList(removedFeatures)} tidak digunakan.` : ""}${
        reason ? ` Seleksi berhenti karena ${reason}.` : ""
      }`,
    ),
  ];

  if (kSummary.length > 1) {
    const details = kSummary
      .map((entry: any) => {
        const error = toFiniteNumber(entry?.error);
        const text = `k=${escapeHtml(entry?.k)}: ${stringList(entry?.selected_features).length} fitur, ${
          error === null ? "-" : formatError(error, isRegression)
        }`;
        return entry?.selected ? `<strong>${text}</strong>` : text;
      })
      .join("; ");
    parts.push(paragraph(`Hasil per k: ${details}.`));
  }

  return parts.join("");
}

/* =========================
   FEATURE WEIGHTING (PREDICTOR IMPORTANCE)
========================= */

export function describePredictorImportance(importance?: any): string {
  const entries = (Array.isArray(importance?.entries) ? importance.entries : [])
    .map((entry: any) => ({
      name: String(entry?.featureName ?? entry?.feature_name ?? ""),
      delta: toFiniteNumber(entry?.deltaError ?? entry?.delta_error),
      weight: toFiniteNumber(entry?.normalizedImportance ?? entry?.normalized_importance),
    }))
    .filter((entry: any) => entry.name && entry.weight !== null)
    .sort((left: any, right: any) => right.weight - left.weight);

  if (!entries.length) return "Predictor Importance";

  const ranking = entries
    .map((entry: any) => `${bold(entry.name)} (${formatFixed(entry.weight * 100, 1)}%)`)
    .join(", ");
  const notHelpful = entries
    .filter((entry: any) => (entry.delta ?? 0) <= 0)
    .map((entry: any) => entry.name);

  return paragraph(
    `Fitur paling berpengaruh adalah ${bold(entries[0].name)}. Urutan bobot: ${ranking}.${
      notHelpful.length && notHelpful.length < entries.length
        ? ` Menghapus ${featureList(notHelpful)} tidak menaikkan error, sehingga kontribusinya kecil.`
        : ""
    }`,
  );
}

/* =========================
   CLASSIFICATION TABLE
========================= */

function describeClassificationPartition(name: string, partition: any, categories: string[]) {
  const matrix: number[][] = Array.isArray(partition?.confusion_matrix)
    ? partition.confusion_matrix.map((row: any) =>
        Array.isArray(row) ? row.map((cell: any) => toFiniteNumber(cell) ?? 0) : [],
      )
    : [];
  const total = matrix.reduce(
    (sum, row) => sum + row.reduce((rowSum, cell) => rowSum + cell, 0),
    0,
  );
  if (total <= 0) return "";

  const correct = matrix.reduce((sum, row, index) => sum + (row[index] ?? 0), 0);
  const perCategory = categories
    .map((category, index) => {
      const row = matrix[index] ?? [];
      const observed = row.reduce((sum, cell) => sum + cell, 0);
      return {
        category,
        observed,
        recall: observed > 0 ? ((row[index] ?? 0) / observed) * 100 : null,
      };
    })
    .filter((item) => item.recall !== null);

  const recallText = perCategory
    .map((item) => `${bold(item.category)} ${formatFixed(item.recall ?? 0, 1)}%`)
    .join(", ");
  const weakest = perCategory.reduce<(typeof perCategory)[number] | null>(
    (current, item) => (!current || (item.recall ?? 0) < (current.recall ?? 0) ? item : current),
    null,
  );
  const majority = perCategory.reduce<(typeof perCategory)[number] | null>(
    (current, item) => (!current || item.observed > current.observed ? item : current),
    null,
  );
  const imbalanceNote =
    weakest && majority && weakest.category !== majority.category && (weakest.recall ?? 100) < 50
      ? ` Kategori ${bold(weakest.category)} sulit diprediksi; akurasi tinggi terutama berasal dari kategori mayoritas ${bold(majority.category)}.`
      : "";

  return paragraph(
    `<strong>${name}</strong>: akurasi ${formatFixed((correct / total) * 100, 1)}% (${correct} dari ${total} kasus). Ketepatan per kategori: ${recallText}.${imbalanceNote}`,
  );
}

export function describeClassificationTable(table?: any): string {
  const categories = stringList(table?.categories);
  if (!table || !categories.length) return "Classification Table";

  const text = [
    describeClassificationPartition("Training", table.training, categories),
    describeClassificationPartition("Holdout", table.holdout, categories),
  ].join("");

  return text || "Classification Table";
}

/* =========================
   ERROR SUMMARY
========================= */

export function describeErrorSummary(summary?: any, classificationTable?: any): string {
  const trainingError = toFiniteNumber(summary?.training);
  const holdoutError = toFiniteNumber(summary?.holdout);
  const hasTraining =
    trainingError !== null &&
    (!classificationTable || partitionTotal(classificationTable.training) > 0);
  const hasHoldout =
    holdoutError !== null &&
    (!classificationTable || partitionTotal(classificationTable.holdout) > 0);

  if (hasTraining && hasHoldout && trainingError !== null && holdoutError !== null) {
    const gap = holdoutError - trainingError;
    const verdict =
      gap > 5
        ? "model cenderung overfitting"
        : "model konsisten pada data baru (tidak overfitting)";
    return paragraph(
      `Kasus salah klasifikasi: training ${formatFixed(trainingError, 1)}%, holdout ${formatFixed(holdoutError, 1)}%. Selisih ${formatFixed(Math.abs(gap), 1)} poin persen, sehingga ${verdict}.`,
    );
  }

  if (hasTraining && trainingError !== null) {
    return paragraph(
      `Kasus salah klasifikasi pada training ${formatFixed(trainingError, 1)}%. Tidak ada data holdout untuk menguji model pada data baru.`,
    );
  }

  if (hasHoldout && holdoutError !== null) {
    return paragraph(`Kasus salah klasifikasi pada holdout ${formatFixed(holdoutError, 1)}%.`);
  }

  return "Error Summary";
}
