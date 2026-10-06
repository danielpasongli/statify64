// AGENTS.md §4.5, §6.6 — test pesan error ramah pengguna Apply Model (PLAN.md Fase 16).

import { APPLY_MODEL_MESSAGES } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import { getUserFriendlyApplyModelError } from "@/components/Modals/Analyze/Classify/apply-model/services/apply-model-error-messages";

describe("getUserFriendlyApplyModelError", () => {
  it("AM_E_SCHEMA_VERSION_UNSUPPORTED dengan detail 3.0 -> teks §4.5 memuat '3.0'", () => {
    const message = getUserFriendlyApplyModelError(
      "AM_E_SCHEMA_VERSION_UNSUPPORTED: 3.0"
    );

    // Revisi v2 (A3): daftar versi didukung menjadi 1.0, 1.1, 2.0; contoh versi tak didukung 2.0 -> 3.0.
    expect(message).toBe(
      'The model format version "3.0" is not supported. Supported versions: 1.0, 1.1, 2.0. (AM_E_SCHEMA_VERSION_UNSUPPORTED)'
    );
    expect(message).not.toContain("{detail}");
  });

  it("AM_E_MODEL_TYPE_UNSUPPORTED dengan detail decision_tree", () => {
    const message = getUserFriendlyApplyModelError(
      new Error("AM_E_MODEL_TYPE_UNSUPPORTED: decision_tree")
    );

    expect(message).toBe('The model type "decision_tree" is not supported by Apply Model. (AM_E_MODEL_TYPE_UNSUPPORTED)');
  });

  it("AM_E_MAP_ROLE_MISMATCH dengan detail nama fitur", () => {
    const message = getUserFriendlyApplyModelError("AM_E_MAP_ROLE_MISMATCH: Temp");

    expect(message).toBe(
      'Feature "Temp" does not match the measurement level of the selected variable. (AM_E_MAP_ROLE_MISMATCH)'
    );
  });

  it("kode tanpa detail (AM_E_NO_ROWS)", () => {
    expect(getUserFriendlyApplyModelError("AM_E_NO_ROWS")).toBe(
      "The active dataset has no data rows for the mapped variables. (AM_E_NO_ROWS)"
    );
    expect(getUserFriendlyApplyModelError("AM_E_NO_ROWS: baris 0")).toBe(
      APPLY_MODEL_MESSAGES.AM_E_NO_ROWS
    );
  });

  it("prefix 'Error:' dari String(error) tetap dikenali", () => {
    expect(getUserFriendlyApplyModelError("Error: AM_E_PAYLOAD: lengths are not aligned")).toBe(
      APPLY_MODEL_MESSAGES.AM_E_PAYLOAD
    );
  });

  it("'Failed to load wasm module' -> pesan AM_E_WORKER", () => {
    const message = getUserFriendlyApplyModelError(new Error("Failed to load wasm module"));

    expect(message).toBe(APPLY_MODEL_MESSAGES.AM_E_WORKER);
    expect(message).toContain("The analysis engine failed to run");
  });

  it("kata 'worker' dan 'module' juga dipetakan ke AM_E_WORKER", () => {
    expect(getUserFriendlyApplyModelError("Worker error")).toBe(APPLY_MODEL_MESSAGES.AM_E_WORKER);
    expect(getUserFriendlyApplyModelError("Cannot find module")).toBe(
      APPLY_MODEL_MESSAGES.AM_E_WORKER
    );
  });

  it("teks acak -> pesan generik", () => {
    const message = getUserFriendlyApplyModelError("something strange happened");

    expect(message).toBe(
      "The model could not be applied. Check the model, the variable mapping and the selected settings, then try again."
    );
  });

  it("kode AM_E_ tak dikenal, null, dan undefined -> pesan generik", () => {
    const generic = getUserFriendlyApplyModelError("teks acak");

    expect(getUserFriendlyApplyModelError("AM_E_BOGUS: x")).toBe(generic);
    expect(getUserFriendlyApplyModelError(null)).toBe(generic);
    expect(getUserFriendlyApplyModelError(undefined)).toBe(generic);
  });

  it("kode warning (AM_W_*) bukan error -> pesan generik", () => {
    const generic = getUserFriendlyApplyModelError("teks acak");

    expect(getUserFriendlyApplyModelError("AM_W_LEGACY_SCHEMA: 1.0")).toBe(generic);
  });
});

// Revisi v2 (A3): AM_E_TEXT_NEGATIVE menampilkan nama kolom dan jumlah kolom secara terpisah;
// kode berdigit (AM_E_NB2_*) ikut dikenali.
describe("getUserFriendlyApplyModelError — v2 (fitur teks)", () => {
  it("AM_E_TEXT_NEGATIVE satu kolom -> nama kolom di dalam tanda kutip, tanpa keterangan jumlah", () => {
    const message = getUserFriendlyApplyModelError("AM_E_TEXT_NEGATIVE: VEC_a");

    expect(message).toContain("Negative values were found in text vector column 'VEC_a'.");
    expect(message).not.toContain("more column");
    expect(message).not.toContain("{detail}");
  });

  it("AM_E_TEXT_NEGATIVE beberapa kolom (format lama Rust) -> kolom pertama + 'and N more column(s)'", () => {
    const message = getUserFriendlyApplyModelError(
      "AM_E_TEXT_NEGATIVE: VEC_a (total 3 kolom bermasalah)"
    );

    expect(message).toContain("Negative values were found in text vector column 'VEC_a' and 2 more column(s).");
    expect(message).not.toContain("(total");
  });

  it("AM_E_TEXT_NEGATIVE beberapa kolom (format baru Rust) -> kolom pertama + 'and N more column(s)'", () => {
    const message = getUserFriendlyApplyModelError(
      "AM_E_TEXT_NEGATIVE: VEC_a (3 columns affected)"
    );

    expect(message).toContain("Negative values were found in text vector column 'VEC_a' and 2 more column(s).");
    expect(message.endsWith("(AM_E_TEXT_NEGATIVE)")).toBe(true);
    expect(message).not.toContain("columns affected");
  });

  it("AM_E_TEXT_NEGATIVE format baru dengan nama kolom berspasi/berkurung tetap terurai", () => {
    const message = getUserFriendlyApplyModelError(
      "AM_E_TEXT_NEGATIVE: VEC (a) b (2 columns affected)"
    );

    expect(message).toContain("column 'VEC (a) b' and 1 more column(s).");
  });

  it("AM_E_NB2_TEXT_SHAPE (kode memuat digit) dipetakan ke pesannya, bukan fallback generik", () => {
    const message = getUserFriendlyApplyModelError("AM_E_NB2_TEXT_SHAPE: text.terms: empty");

    expect(message).toBe(
      APPLY_MODEL_MESSAGES.AM_E_NB2_TEXT_SHAPE.replace("{detail}", "text.terms: empty")
    );
  });
});
