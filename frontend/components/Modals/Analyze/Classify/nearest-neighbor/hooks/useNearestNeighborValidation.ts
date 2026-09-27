import { useMemo } from "react";
import type { KNNType } from "@/components/Modals/Analyze/Classify/nearest-neighbor/types/nearest-neighbor";

export type NearestNeighborValidationResult = {
  isValid: boolean;
  errors: string[];
};

/**
 * Validasi menu Nearest Neighbor: aturan yang menentukan kapan tombol OK
 * boleh ditekan (tab Variables) dan kapan perpindahan tab Feature Selection
 * ditolak (tab Features).
 */
export function useNearestNeighborValidation(formData: KNNType) {
  const validation = useMemo<NearestNeighborValidationResult>(() => {
    const errors: string[] = [];
    const featureVars = formData.main.FeatureVar ?? [];

    if (!formData.main.TargetVar) {
      errors.push("Select a target variable.");
    }

    if (featureVars.length === 0) {
      errors.push("Select at least one feature variable.");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }, [formData.main]);

  const validateFeatureSelection = (): string | null => {
    const f = formData.features;

    if (!f.PerformSelection) return null;

    const forwardCount = (f.ForwardSelection ?? []).filter(
      (v) => !(f.ForcedEntryVar ?? []).includes(v),
    ).length;
    const usesFixedNumber = f.MaxReached && !f.BelowMin;

    // A blank number to select is valid: SPSS then computes it automatically.
    if (
      usesFixedNumber &&
      f.MaxToSelect !== null &&
      (f.MaxToSelect <= 0 || !Number.isInteger(f.MaxToSelect))
    ) {
      return "Enter a positive whole number for the number of features to select, or leave it blank to select automatically.";
    }

    if (
      usesFixedNumber &&
      f.MaxToSelect !== null &&
      f.MaxToSelect > forwardCount
    ) {
      return "The number of features to select cannot exceed the number of features in the Forward Selection list.";
    }

    if (
      f.BelowMin &&
      (f.MinChange === null || !Number.isFinite(f.MinChange) || f.MinChange < 0)
    ) {
      return "Enter a number greater than or equal to 0 for the minimum change.";
    }

    return null;
  };

  const validateNumericInputs = (): string | null =>
    getNumericInputError(formData);

  return { validation, validateFeatureSelection, validateNumericInputs };
}

const isWholeNumber = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isInteger(value);

// Batas seed mengikuti Rust: seed dikonversi ke u32 untuk Mersenne Twister.
const MAX_SEED = 4294967295;

/**
 * Validasi input angka di tab Neighbors dan Partition. Nilai bulat wajib
 * karena field ini bertipe integer di Rust (config.rs). Batas jumlah fold
 * (minimal 2 dan tidak melebihi jumlah kasus training) sudah diperiksa Rust,
 * jadi tidak diulang di sini.
 */
export function getNumericInputError(formData: KNNType): string | null {
  const n = formData.neighbors;
  const p = formData.partition;

  if (!isWholeNumber(n.SpecifyK) || (n.Specify && n.SpecifyK < 1)) {
    return "Enter a whole number of at least 1 for k.";
  }

  if (n.AutoSelection) {
    if (!isWholeNumber(n.MinK) || n.MinK < 1) {
      return "Enter a whole number of at least 1 for the minimum k.";
    }

    if (!isWholeNumber(n.MaxK) || n.MaxK < 1) {
      return "Enter a whole number of at least 1 for the maximum k.";
    }

    if (n.MinK > n.MaxK) {
      return "The minimum k cannot be greater than the maximum k.";
    }
  }

  if (
    !isWholeNumber(p.TrainingNumber) ||
    (p.UseRandomly && (p.TrainingNumber < 1 || p.TrainingNumber > 100))
  ) {
    return "Training % must be a whole number from 1 to 100.";
  }

  if (!isWholeNumber(p.NumPartition)) {
    return "The number of folds must be a whole number.";
  }

  if (p.Seed !== null && !isWholeNumber(p.Seed)) {
    return "The seed must be a whole number.";
  }

  if (p.SetSeed && (p.Seed === null || p.Seed < 0 || p.Seed > MAX_SEED)) {
    return `Enter a whole number from 0 to ${MAX_SEED} for the seed.`;
  }

  return null;
}
