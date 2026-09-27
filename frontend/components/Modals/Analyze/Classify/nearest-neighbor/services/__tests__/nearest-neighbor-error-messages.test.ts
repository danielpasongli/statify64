/**
 * PENGUJIAN MENU — Pesan error yang dilihat pengguna saat analisis KNN gagal
 *
 * Target uji: `getUserFriendlyKNNError`, fungsi yang menerjemahkan pesan
 * error teknis dari mesin analisis menjadi pesan yang muncul di notifikasi
 * (toast) menu Nearest Neighbor. Satu test case per kemungkinan penyebab
 * kegagalan yang bisa dialami pengguna saat menekan tombol OK.
 */

import { getUserFriendlyKNNError } from "../nearest-neighbor-error-messages";

describe("getUserFriendlyKNNError — pesan error menu Nearest Neighbor", () => {
  const cases: Array<[string, string]> = [
    ["Target variable is required", "Select a target variable before running the KNN analysis."],
    ["No feature variable selected", "Select at least one feature variable before running the KNN analysis."],
    ["No valid features remain after preprocessing", "Select at least one feature variable before running the KNN analysis."],
    ["No cases found matching the criteria", "No valid cases are available for analysis. Check the selected variables for missing or invalid values."],
    ["No focal cases found", "No matching focal cases were found. Check the focal case identifier values."],
    ["Partition variable has no training cases", "The selected partition variable does not contain any training cases. Use positive values for training cases."],
    ["Invalid partition variable", "Select a partition variable or switch to random partitioning."],
    ["Cross-validation fold variable is invalid", "Select a cross-validation fold variable or switch to automatic fold assignment."],
    ["Cross-validation requires at least two folds", "Review the cross-validation settings. Use at least two valid folds and ensure the number of folds does not exceed the available training cases."],
    ["Not enough training case available", "There are not enough valid training cases for this analysis. Review the partition settings and selected variables."],
    ["Failed to load wasm module", "The KNN analysis engine could not be loaded. Please refresh the page and try again."],
    ["Some completely unrecognized internal failure", "The KNN analysis could not be completed. Review the selected variables and settings, then try again."],
  ];

  it.each(cases)("skenario: error backend \"%s\" -> pesan menu yang ditampilkan sesuai", (raw, expected) => {
    expect(getUserFriendlyKNNError(new Error(raw))).toBe(expected);
  });

  it("skenario tambahan: error bukan instance Error (mis. string biasa) -> tetap diterjemahkan tanpa gagal", () => {
    expect(getUserFriendlyKNNError("target variable missing")).toBe(
      "Select a target variable before running the KNN analysis.",
    );
  });

  it("skenario tambahan: nilai error kosong/tidak dikenal -> jatuh ke pesan umum", () => {
    expect(getUserFriendlyKNNError(undefined)).toBe(
      "The KNN analysis could not be completed. Review the selected variables and settings, then try again.",
    );
  });
});
