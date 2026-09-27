/**
 * PENGUJIAN MENU — Aturan Menu Nearest Neighbor tab Save
 *
 * Mencakup: variabel apa saja yang boleh disimpan (tergantung pilihan di
 * tab Variables/Neighbors/Features/Partition), dan validasi input
 * "Max categories to save".
 */

import {
  computeSaveCapabilities,
  parseMaxCatsToSaveInput,
  type SaveCapabilitiesInput,
} from "../useNearestNeighborSaveRules";

function makeInput(overrides: Partial<SaveCapabilitiesInput> = {}): SaveCapabilitiesInput {
  return {
    hasTarget: true,
    targetType: "scale",
    isAutoK: false,
    isFeatureSelectionActive: false,
    isUsingPartitionVariable: false,
    isUsingFoldVariable: false,
    ...overrides,
  };
}

describe("computeSaveCapabilities — menu tab Save", () => {
  it("TCS01: belum ada Target Variable -> semua opsi simpan (prediksi, probabilitas, fold) terkunci", () => {
    const result = computeSaveCapabilities(makeInput({ hasTarget: false }));
    expect(result.canPredict).toBe(false);
    expect(result.canProbability).toBe(false);
    expect(result.canFold).toBe(false);
  });

  it("TCS02: Target Variable ada, target berskala (scale) -> boleh simpan prediksi, TIDAK boleh simpan probabilitas", () => {
    const result = computeSaveCapabilities(makeInput({ hasTarget: true, targetType: "scale" }));
    expect(result.canPredict).toBe(true);
    expect(result.canProbability).toBe(false);
  });

  it("TCS03: Target Variable ada, target kategorikal (nominal) -> boleh simpan prediksi DAN probabilitas", () => {
    const result = computeSaveCapabilities(makeInput({ hasTarget: true, targetType: "nominal" }));
    expect(result.canPredict).toBe(true);
    expect(result.canProbability).toBe(true);
  });

  it("TCS04: target kategorikal ordinal -> boleh simpan probabilitas juga (aturan sama seperti nominal)", () => {
    const result = computeSaveCapabilities(makeInput({ hasTarget: true, targetType: "ordinal" }));
    expect(result.canProbability).toBe(true);
  });

  it("TCS05: Auto K Selection nonaktif -> opsi simpan fold terkunci", () => {
    const result = computeSaveCapabilities(makeInput({ isAutoK: false }));
    expect(result.canFold).toBe(false);
  });

  it("TCS06: Auto K Selection aktif TAPI Feature Selection juga aktif -> opsi simpan fold tetap terkunci", () => {
    const result = computeSaveCapabilities(makeInput({ isAutoK: true, isFeatureSelectionActive: true }));
    expect(result.canFold).toBe(false);
  });

  it("TCS07: Auto K Selection aktif DAN Feature Selection nonaktif -> opsi simpan fold terbuka", () => {
    const result = computeSaveCapabilities(makeInput({ isAutoK: true, isFeatureSelectionActive: false }));
    expect(result.canFold).toBe(true);
  });

  it("TCS08: fold boleh disimpan TAPI tab Partition sudah memakai variabel fold sendiri -> opsi simpan fold tetap terkunci", () => {
    const result = computeSaveCapabilities(
      makeInput({ isAutoK: true, isFeatureSelectionActive: false, isUsingFoldVariable: true }),
    );
    expect(result.canSaveFold).toBe(false);
  });

  it("TCS09: tab Partition TIDAK memakai Partition Variable sendiri -> opsi simpan partisi terbuka", () => {
    const result = computeSaveCapabilities(makeInput({ isUsingPartitionVariable: false }));
    expect(result.canSavePartition).toBe(true);
  });

  it("TCS10: tab Partition memakai Partition Variable sendiri -> opsi simpan partisi terkunci", () => {
    const result = computeSaveCapabilities(makeInput({ isUsingPartitionVariable: true }));
    expect(result.canSavePartition).toBe(false);
  });
});

describe("parseMaxCatsToSaveInput — validasi input Max categories to save", () => {
  it("TCS11: input dikosongkan -> nilai menjadi null", () => {
    expect(parseMaxCatsToSaveInput("")).toBeNull();
  });

  it("TCS12: input bukan angka (mis. huruf) -> diabaikan, nilai lama dipertahankan", () => {
    expect(parseMaxCatsToSaveInput("abc")).toBeUndefined();
  });

  it("TCS13: input angka desimal -> dibulatkan ke bawah (dipotong ke bilangan bulat)", () => {
    expect(parseMaxCatsToSaveInput("7.9")).toBe(7);
  });

  it("TCS14: input angka nol atau negatif -> dibatasi minimal 1", () => {
    expect(parseMaxCatsToSaveInput("0")).toBe(1);
    expect(parseMaxCatsToSaveInput("-5")).toBe(1);
  });

  it("TCS15: input angka positif wajar -> dipakai apa adanya", () => {
    expect(parseMaxCatsToSaveInput("25")).toBe(25);
  });
});
