// AGENTS.md §4.5 — kode error/warning dan pesan pengguna.

import {
  ALL_APPLY_MODEL_CODES,
  APPLY_MODEL_MESSAGES,
} from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";

describe("Apply Model — kode & pesan (AGENTS.md §4.5)", () => {
  it("ALL_APPLY_MODEL_CODES tidak berisi duplikat", () => {
    expect(new Set(ALL_APPLY_MODEL_CODES).size).toBe(
      ALL_APPLY_MODEL_CODES.length
    );
  });

  it("setiap kode bernama AM_E_*, AM_W_*, atau AM_I_* (v2)", () => {
    for (const code of ALL_APPLY_MODEL_CODES) {
      expect(code).toMatch(/^AM_[EWI]_[A-Z0-9_]+$/);
    }
  });

  it("setiap kode punya pesan non-kosong", () => {
    for (const code of ALL_APPLY_MODEL_CODES) {
      const message = APPLY_MODEL_MESSAGES[code];
      expect(typeof message).toBe("string");
      expect(message.trim().length).toBeGreaterThan(0);
    }
  });

  it("APPLY_MODEL_MESSAGES tidak punya kunci di luar ALL_APPLY_MODEL_CODES", () => {
    expect(Object.keys(APPLY_MODEL_MESSAGES).sort()).toEqual(
      [...ALL_APPLY_MODEL_CODES].sort()
    );
  });

  it("jumlah kode: 50 error (43 v1 + 7 v2) dan 9 warning (8 v1 + 1 v2)", () => {
    const errors = ALL_APPLY_MODEL_CODES.filter((c) => c.startsWith("AM_E_"));
    const warnings = ALL_APPLY_MODEL_CODES.filter((c) => c.startsWith("AM_W_"));
    expect(errors).toHaveLength(50);
    expect(warnings).toHaveLength(9);
  });

  it("teks kunci memakai kalimat Inggris dengan kode di akhir (PLAN_V3_UI_EN E3)", () => {
    expect(APPLY_MODEL_MESSAGES.AM_E_MODEL_TYPE_UNSUPPORTED).toBe(
      'The model type "{detail}" is not supported by Apply Model. (AM_E_MODEL_TYPE_UNSUPPORTED)'
    );
    expect(APPLY_MODEL_MESSAGES.AM_E_SCHEMA_VERSION_UNSUPPORTED).toBe(
      'The model format version "{detail}" is not supported. Supported versions: 1.0, 1.1, 2.0. (AM_E_SCHEMA_VERSION_UNSUPPORTED)'
    );
    expect(APPLY_MODEL_MESSAGES.AM_E_MAP_ROLE_MISMATCH).toBe(
      'Feature "{detail}" does not match the measurement level of the selected variable. (AM_E_MAP_ROLE_MISMATCH)'
    );
    expect(APPLY_MODEL_MESSAGES.AM_E_NO_ROWS).toBe(
      "The active dataset has no data rows for the mapped variables. (AM_E_NO_ROWS)"
    );
    expect(APPLY_MODEL_MESSAGES.AM_W_LEGACY_SCHEMA).toBe(
      "This model uses the old format (1.0). Unknown categories are skipped during prediction. Export the model again from the Naive Bayes menu for consistent results."
    );
  });

  it("AM_W_BUILTIN_EMPTY memakai teks wajib tab Model (§6.2)", () => {
    expect(APPLY_MODEL_MESSAGES.AM_W_BUILTIN_EMPTY).toBe(
      "There are no built-in Statify models yet."
    );
  });
});
