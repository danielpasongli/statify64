// AGENTS.md §4.5, §6.6 — test pesan error ramah pengguna Apply Model (PLAN.md Fase 16).

import { APPLY_MODEL_MESSAGES } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import { getUserFriendlyApplyModelError } from "@/components/Modals/Analyze/Classify/apply-model/services/apply-model-error-messages";

describe("getUserFriendlyApplyModelError", () => {
  it("AM_E_SCHEMA_VERSION_UNSUPPORTED dengan detail 2.0 -> teks §4.5 memuat '2.0'", () => {
    const message = getUserFriendlyApplyModelError(
      "AM_E_SCHEMA_VERSION_UNSUPPORTED: 2.0"
    );

    expect(message).toBe(
      'Versi format model "2.0" tidak didukung. Versi yang didukung: 1.0, 1.1.'
    );
    expect(message).not.toContain("{detail}");
  });

  it("AM_E_MODEL_TYPE_UNSUPPORTED dengan detail decision_tree", () => {
    const message = getUserFriendlyApplyModelError(
      new Error("AM_E_MODEL_TYPE_UNSUPPORTED: decision_tree")
    );

    expect(message).toBe('Jenis model "decision_tree" belum didukung oleh Apply Model.');
  });

  it("AM_E_MAP_ROLE_MISMATCH dengan detail nama fitur", () => {
    const message = getUserFriendlyApplyModelError("AM_E_MAP_ROLE_MISMATCH: Temp");

    expect(message).toBe(
      'Fitur "Temp" tidak cocok dengan measurement level variabel yang dipilih.'
    );
  });

  it("kode tanpa detail (AM_E_NO_ROWS)", () => {
    expect(getUserFriendlyApplyModelError("AM_E_NO_ROWS")).toBe(
      "Dataset aktif tidak berisi baris data pada variabel yang dipetakan."
    );
    expect(getUserFriendlyApplyModelError("AM_E_NO_ROWS: baris 0")).toBe(
      APPLY_MODEL_MESSAGES.AM_E_NO_ROWS
    );
  });

  it("prefix 'Error:' dari String(error) tetap dikenali", () => {
    expect(getUserFriendlyApplyModelError("Error: AM_E_PAYLOAD: panjang tidak sejajar")).toBe(
      APPLY_MODEL_MESSAGES.AM_E_PAYLOAD
    );
  });

  it("'Failed to load wasm module' -> pesan AM_E_WORKER", () => {
    const message = getUserFriendlyApplyModelError(new Error("Failed to load wasm module"));

    expect(message).toBe(APPLY_MODEL_MESSAGES.AM_E_WORKER);
    expect(message).toContain("Mesin prediksi gagal dijalankan");
  });

  it("kata 'worker' dan 'module' juga dipetakan ke AM_E_WORKER", () => {
    expect(getUserFriendlyApplyModelError("Worker error")).toBe(APPLY_MODEL_MESSAGES.AM_E_WORKER);
    expect(getUserFriendlyApplyModelError("Cannot find module")).toBe(
      APPLY_MODEL_MESSAGES.AM_E_WORKER
    );
  });

  it("teks acak -> pesan generik", () => {
    const message = getUserFriendlyApplyModelError("sesuatu yang aneh terjadi");

    expect(message).toBe(
      "Penerapan model tidak dapat diselesaikan. Periksa kembali model, pemetaan variabel, dan pengaturan yang dipilih, lalu coba lagi."
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
