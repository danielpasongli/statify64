/**
 * Menerjemahkan pesan error internal (dari mesin analisis KNN) menjadi pesan
 * yang dipahami pengguna saat menu ditutup dengan hasil gagal.
 */
export const getUserFriendlyKNNError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("target variable")) {
    return "Select a target variable before running the KNN analysis.";
  }

  if (
    normalizedMessage.includes("feature variable") ||
    normalizedMessage.includes("at least one feature") ||
    normalizedMessage.includes("no valid features") ||
    normalizedMessage.includes("no predictors")
  ) {
    return "Select at least one feature variable before running the KNN analysis.";
  }

  if (
    normalizedMessage.includes("no cases found") ||
    normalizedMessage.includes("no data available") ||
    normalizedMessage.includes("no valid data records")
  ) {
    return "No valid cases are available for analysis. Check the selected variables for missing or invalid values.";
  }

  if (normalizedMessage.includes("no focal cases")) {
    return "No matching focal cases were found. Check the focal case identifier values.";
  }

  if (
    normalizedMessage.includes("partition variable") &&
    normalizedMessage.includes("no training cases")
  ) {
    return "The selected partition variable does not contain any training cases. Use positive values for training cases.";
  }

  if (normalizedMessage.includes("partition variable")) {
    return "Select a partition variable or switch to random partitioning.";
  }

  if (
    normalizedMessage.includes("cross-validation fold variable") ||
    normalizedMessage.includes("fold variable")
  ) {
    return "Select a cross-validation fold variable or switch to automatic fold assignment.";
  }

  if (
    normalizedMessage.includes("cross-validation") ||
    normalizedMessage.includes("fold")
  ) {
    return "Review the cross-validation settings. Use at least two valid folds and ensure the number of folds does not exceed the available training cases.";
  }

  if (normalizedMessage.includes("training case")) {
    return "There are not enough valid training cases for this analysis. Review the partition settings and selected variables.";
  }

  if (
    normalizedMessage.includes("worker") ||
    normalizedMessage.includes("wasm") ||
    normalizedMessage.includes("module")
  ) {
    return "The KNN analysis engine could not be loaded. Please refresh the page and try again.";
  }

  return "The KNN analysis could not be completed. Review the selected variables and settings, then try again.";
};
