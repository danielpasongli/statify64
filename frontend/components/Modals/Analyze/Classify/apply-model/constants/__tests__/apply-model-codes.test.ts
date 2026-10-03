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

  it("setiap kode bernama AM_E_* atau AM_W_*", () => {
    for (const code of ALL_APPLY_MODEL_CODES) {
      expect(code).toMatch(/^AM_[EW]_[A-Z_]+$/);
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

  it("jumlah kode: 43 error dan 8 warning", () => {
    const errors = ALL_APPLY_MODEL_CODES.filter((c) => c.startsWith("AM_E_"));
    const warnings = ALL_APPLY_MODEL_CODES.filter((c) => c.startsWith("AM_W_"));
    expect(errors).toHaveLength(43);
    expect(warnings).toHaveLength(8);
  });

  it("lima teks wajib persis seperti AGENTS.md §4.5", () => {
    expect(APPLY_MODEL_MESSAGES.AM_E_MODEL_TYPE_UNSUPPORTED).toBe(
      'Jenis model "{detail}" belum didukung oleh Apply Model.'
    );
    expect(APPLY_MODEL_MESSAGES.AM_E_SCHEMA_VERSION_UNSUPPORTED).toBe(
      'Versi format model "{detail}" tidak didukung. Versi yang didukung: 1.0, 1.1.'
    );
    expect(APPLY_MODEL_MESSAGES.AM_E_MAP_ROLE_MISMATCH).toBe(
      'Fitur "{detail}" tidak cocok dengan measurement level variabel yang dipilih.'
    );
    expect(APPLY_MODEL_MESSAGES.AM_E_NO_ROWS).toBe(
      "Dataset aktif tidak berisi baris data pada variabel yang dipetakan."
    );
    expect(APPLY_MODEL_MESSAGES.AM_W_LEGACY_SCHEMA).toBe(
      "Model ini memakai format lama (1.0). Kategori yang tidak dikenal akan dilewati saat prediksi. Ekspor ulang model dari menu Naive Bayes untuk hasil yang konsisten."
    );
  });

  it("AM_W_BUILTIN_EMPTY memakai teks wajib tab Model (§6.2)", () => {
    expect(APPLY_MODEL_MESSAGES.AM_W_BUILTIN_EMPTY).toBe(
      "Belum ada model bawaan Statify."
    );
  });
});
