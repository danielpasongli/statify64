/**
 * PENGUJIAN MENU — Validasi Menu Nearest Neighbor
 *
 * Target uji: `useNearestNeighborValidation`, hook yang menjadi jembatan
 * antara menu (dialog Nearest Neighbor) dan mesin analisis — persis fungsi
 * yang dijalankan setiap kali pengguna mengisi menu, pindah tab, atau
 * menekan tombol OK. Mengikuti pola pengujian modul Time Series
 * (`useAnalyzeHook`): satu test case per aturan/skenario menu, dijalankan
 * lewat `renderHook`, tanpa perlu me-render tampilan dialog sungguhan.
 *
 * Cakupan:
 *  A) `validation` — aturan yang menentukan tombol OK boleh ditekan atau
 *     tidak (wajib pilih Target Variable & minimal satu Feature Variable).
 *  B) `validateFeatureSelection` — aturan tambahan saat menu "Feature
 *     Selection" pada tab Features diaktifkan.
 */

import { renderHook } from "@testing-library/react";
import { useNearestNeighborValidation } from "../useNearestNeighborValidation";
import type { KNNType } from "@/components/Modals/Analyze/Classify/nearest-neighbor/types/nearest-neighbor";

function makeFormData(overrides: Partial<{
  main: Partial<KNNType["main"]>;
  features: Partial<KNNType["features"]>;
}> = {}): KNNType {
  return {
    main: {
      TargetVar: "target",
      FeatureVar: ["feat1"],
      CaseIdenVar: null,
      FocalCaseIdenVar: null,
      NormCovar: false,
      ...overrides.main,
    },
    neighbors: {
      Specify: true,
      AutoSelection: false,
      SpecifyK: 1,
      MinK: null,
      MaxK: null,
      MetricEucli: true,
      MetricManhattan: false,
      Weight: false,
      PredictionsMean: true,
      PredictionsMedian: false,
    },
    features: {
      ForwardSelection: ["feat1", "feat2", "feat3"],
      ForcedEntryVar: [],
      FeaturesToEvaluate: 0,
      ForcedFeatures: 0,
      PerformSelection: false,
      MaxReached: true,
      BelowMin: false,
      MaxToSelect: null,
      MinChange: 0.01,
      ...overrides.features,
    },
    partition: {
      PartitioningVariable: null,
      UseRandomly: true,
      UseVariable: false,
      VFoldPartitioningVariable: null,
      VFoldUseRandomly: true,
      VFoldUsePartitioningVar: false,
      TrainingNumber: 70,
      NumPartition: null,
      SetSeed: false,
      Seed: null,
    },
    save: {
      AutoName: true,
      CustomName: false,
      MaxCatsToSave: null,
      HasTargetVar: true,
      IsCateTargetVar: false,
      RandomAssignToPartition: false,
      RandomAssignToFold: false,
    },
    output: {
      CaseSummary: true,
      FeatureSelectionSummary: false,
      KSelectionChart: false,
      PredictorSpace: false,
      PredictionResults: true,
      ShowNeighborDetail: false,
      PeersChart: false,
      QuadrantMap: false,
      ChartAndTable: true,
    },
  } as KNNType;
}

describe("useNearestNeighborValidation — validasi menu (tab Variables)", () => {
  it("TCV01: Target Variable & Feature Variable kosong -> tombol OK terkunci, dua pesan error muncul", () => {
    const { result } = renderHook(() =>
      useNearestNeighborValidation(makeFormData({ main: { TargetVar: null, FeatureVar: [] } })),
    );

    expect(result.current.validation.isValid).toBe(false);
    expect(result.current.validation.errors).toEqual([
      "Select a target variable.",
      "Select at least one feature variable.",
    ]);
  });

  it("TCV02: Target Variable sudah dipilih tapi Feature Variable masih kosong -> hanya pesan Feature Variable yang muncul", () => {
    const { result } = renderHook(() =>
      useNearestNeighborValidation(makeFormData({ main: { TargetVar: "target", FeatureVar: [] } })),
    );

    expect(result.current.validation.isValid).toBe(false);
    expect(result.current.validation.errors).toEqual(["Select at least one feature variable."]);
  });

  it("TCV03: Feature Variable sudah dipilih tapi Target Variable masih kosong -> hanya pesan Target Variable yang muncul", () => {
    const { result } = renderHook(() =>
      useNearestNeighborValidation(makeFormData({ main: { TargetVar: null, FeatureVar: ["feat1"] } })),
    );

    expect(result.current.validation.isValid).toBe(false);
    expect(result.current.validation.errors).toEqual(["Select a target variable."]);
  });

  it("TCV04: Target Variable & Feature Variable sudah lengkap -> tombol OK terbuka, tidak ada pesan error", () => {
    const { result } = renderHook(() =>
      useNearestNeighborValidation(makeFormData({ main: { TargetVar: "target", FeatureVar: ["feat1"] } })),
    );

    expect(result.current.validation.isValid).toBe(true);
    expect(result.current.validation.errors).toEqual([]);
  });
});

describe("useNearestNeighborValidation — validasi menu (tab Features, opsi Feature Selection)", () => {
  it("TCV05: Feature Selection TIDAK diaktifkan -> tidak ada validasi tambahan apa pun", () => {
    const { result } = renderHook(() =>
      useNearestNeighborValidation(makeFormData({ features: { PerformSelection: false } })),
    );

    expect(result.current.validateFeatureSelection()).toBeNull();
  });

  it("TCV06: Feature Selection aktif, jumlah fitur yang ingin dipilih dikosongkan -> diterima, jumlah fitur dihitung otomatis (J_add SPSS)", () => {
    const { result } = renderHook(() =>
      useNearestNeighborValidation(
        makeFormData({ features: { PerformSelection: true, MaxReached: true, BelowMin: false, MaxToSelect: null } }),
      ),
    );

    expect(result.current.validateFeatureSelection()).toBeNull();
  });

  it("TCV07: Feature Selection aktif, jumlah fitur diisi 0 -> tetap ditolak dengan pesan yang sama (batas nilai positif)", () => {
    const { result } = renderHook(() =>
      useNearestNeighborValidation(
        makeFormData({ features: { PerformSelection: true, MaxReached: true, BelowMin: false, MaxToSelect: 0 } }),
      ),
    );

    expect(result.current.validateFeatureSelection()).toBe(
      "Enter a positive whole number for the number of features to select, or leave it blank to select automatically.",
    );
  });

  it("TCV08: Feature Selection aktif, jumlah fitur yang diminta MELEBIHI daftar Forward Selection -> menu menolak dengan pesan batas maksimum", () => {
    const { result } = renderHook(() =>
      useNearestNeighborValidation(
        makeFormData({
          features: {
            PerformSelection: true,
            MaxReached: true,
            BelowMin: false,
            MaxToSelect: 5, // daftar Forward Selection hanya berisi 3 fitur
            ForwardSelection: ["feat1", "feat2", "feat3"],
            ForcedEntryVar: [],
          },
        }),
      ),
    );

    expect(result.current.validateFeatureSelection()).toBe(
      "The number of features to select cannot exceed the number of features in the Forward Selection list.",
    );
  });

  it("TCV09: Feature Selection aktif, jumlah fitur yang diminta MASIH DALAM batas daftar Forward Selection -> menu menerima, tidak ada error", () => {
    const { result } = renderHook(() =>
      useNearestNeighborValidation(
        makeFormData({
          features: {
            PerformSelection: true,
            MaxReached: true,
            BelowMin: false,
            MaxToSelect: 2,
            ForwardSelection: ["feat1", "feat2", "feat3"],
            ForcedEntryVar: [],
          },
        }),
      ),
    );

    expect(result.current.validateFeatureSelection()).toBeNull();
  });

  it("TCV10: Feature Selection aktif TAPI pengguna memilih mode 'sampai batas minimum' (bukan jumlah tetap) -> aturan jumlah fitur tetap tidak berlaku", () => {
    const { result } = renderHook(() =>
      useNearestNeighborValidation(
        makeFormData({
          features: { PerformSelection: true, MaxReached: false, BelowMin: true, MaxToSelect: null },
        }),
      ),
    );

    expect(result.current.validateFeatureSelection()).toBeNull();
  });
});
