/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { renderHook } from '@testing-library/react';
import {
    useNearestNeighborValidation,
    getNumericInputError,
} from '@/components/Modals/Analyze/Classify/nearest-neighbor/hooks/useNearestNeighborValidation';
import type { KNNType } from '@/components/Modals/Analyze/Classify/nearest-neighbor/types/nearest-neighbor';

// ─── Helpers ───────────────────────────────────────────────────────────────────
type FormOverrides = Partial<{
    main: Partial<KNNType['main']>;
    neighbors: Partial<KNNType['neighbors']>;
    features: Partial<KNNType['features']>;
    partition: Partial<KNNType['partition']>;
}>;

/** Form data valid: lolos seluruh validasi menu. */
const makeFormData = (overrides: FormOverrides = {}): KNNType => ({
    main: {
        TargetVar: 'target',
        FeatureVar: ['feat1'],
        CaseIdenVar: null,
        FocalCaseIdenVar: null,
        NormCovar: false,
        ...overrides.main,
    },
    neighbors: {
        Specify: true,
        AutoSelection: false,
        SpecifyK: 3,
        MinK: null,
        MaxK: null,
        MetricEucli: true,
        MetricManhattan: false,
        Weight: false,
        PredictionsMean: true,
        PredictionsMedian: false,
        ...overrides.neighbors,
    },
    features: {
        ForwardSelection: ['feat1', 'feat2', 'feat3'],
        ForcedEntryVar: [],
        FeaturesToEvaluate: 0,
        ForcedFeatures: 0,
        PerformSelection: true,
        MaxReached: true,
        BelowMin: false,
        MaxToSelect: 2,
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
        NumPartition: 10,
        SetSeed: false,
        Seed: null,
        ...overrides.partition,
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
} as KNNType);

const runValidation = (overrides: FormOverrides = {}) =>
    renderHook(() => useNearestNeighborValidation(makeFormData(overrides))).result.current.validation;

const runFeatureSelection = (features: Partial<KNNType['features']>) =>
    renderHook(() => useNearestNeighborValidation(makeFormData({ features }))).result.current.validateFeatureSelection();

const runNumeric = (overrides: Pick<FormOverrides, 'neighbors' | 'partition'>) =>
    getNumericInputError(makeFormData(overrides));

const MSG = {
    target: 'Select a target variable.',
    feature: 'Select at least one feature variable.',
    fsPositive: 'Enter a positive whole number for the number of features to select, or leave it blank to select automatically.',
    fsExceed: 'The number of features to select cannot exceed the number of features in the Forward Selection list.',
    fsMinChange: 'Enter a number greater than or equal to 0 for the minimum change.',
    k: 'Enter a whole number of at least 1 for k.',
    minK: 'Enter a whole number of at least 1 for the minimum k.',
    maxK: 'Enter a whole number of at least 1 for the maximum k.',
    minGreaterMax: 'The minimum k cannot be greater than the maximum k.',
    training: 'Training % must be a whole number from 1 to 100.',
    folds: 'The number of folds must be a whole number.',
    seedWhole: 'The seed must be a whole number.',
    seedRange: 'Enter a whole number from 0 to 4294967295 for the seed.',
};

// ─── Analisis Basis Path ───────────────────────────────────────────────────────
//
//  Unit yang diuji: hooks/useNearestNeighborValidation.ts
//  Node keputusan = setiap kondisi atomik pada if, ternary, &&, ||, dan ??.
//  V(G) = jumlah node keputusan + 1.
//
//  (1) validation — useMemo, menentukan tombol OK boleh ditekan
//   D1: formData.main.FeatureVar ?? []                       (baris 17)
//   D2: !formData.main.TargetVar                             (baris 19)
//   D3: featureVars.length === 0                             (baris 23)
//   Jalur Independen:
//   P1 (TC-KNN-VAL-01): D1=array, D2=F, D3=F    → valid, tanpa error
//   P2 (TC-KNN-VAL-02): D2=T                    → error target
//   P3 (TC-KNN-VAL-03): D3=T                    → error feature
//   P4 (TC-KNN-VAL-04): D1=null → D3=T          → fallback [], error feature
//   Cyclomatic Complexity V(G) = 3 + 1 = 4
//
//  (2) validateFeatureSelection — aturan tab Features (Feature Selection)
//   Callback .filter (baris 39) dihitung sebagai flow graph terpisah, lihat (2b).
//   D1:  !f.PerformSelection                                 (baris 36)
//   D2:  f.ForwardSelection ?? []                            (baris 38)
//   D3:  f.MaxReached                                        (baris 41, &&)
//   D4:  !f.BelowMin                                         (baris 41)
//   D5:  usesFixedNumber                                     (baris 45)
//   D6:  f.MaxToSelect !== null                              (baris 46)
//   D7:  f.MaxToSelect <= 0                                  (baris 47, ||)
//   D8:  !Number.isInteger(f.MaxToSelect)                    (baris 47)
//   D9:  usesFixedNumber                                     (baris 53)
//   D10: f.MaxToSelect !== null                              (baris 54)
//   D11: f.MaxToSelect > forwardCount                        (baris 55)
//   D12: f.BelowMin                                          (baris 61)
//   D13: f.MinChange === null                                (baris 62, ||)
//   D14: !Number.isFinite(f.MinChange)                       (baris 62, ||)
//   D15: f.MinChange < 0                                     (baris 62)
//   Jalur Independen:
//   P1  (TC-KNN-FS-01): D1=T                         → null (Feature Selection nonaktif)
//   P2  (TC-KNN-FS-02): D1=F, jumlah tetap valid     → null
//   P3  (TC-KNN-FS-03): D2=null                      → forwardCount 0 → error melebihi daftar
//   P4  (TC-KNN-FS-04): D3=F → D5=F, D9=F, D12=F     → null (aturan jumlah tidak berlaku)
//   P5  (TC-KNN-FS-05): D4=F → D5=F, D12=T           → null (mode batas minimum, MinChange valid)
//   P6  (TC-KNN-FS-06): D6=F → D10=F                 → null (jumlah dikosongkan = otomatis)
//   P7  (TC-KNN-FS-07): D7=T                         → error bilangan positif
//   P8  (TC-KNN-FS-08): D7=F, D8=T                   → error bilangan positif
//   P9  (TC-KNN-FS-09): D11=T                        → error melebihi daftar Forward Selection
//   P10 (TC-KNN-FS-10): D12=T, D13=T                 → error minimum change
//   P11 (TC-KNN-FS-11): D13=F, D14=T                 → error minimum change
//   P12 (TC-KNN-FS-12): D14=F, D15=T                 → error minimum change
//   P13 (TC-KNN-FS-13): D3=T, D4=F, D12=T, D13=T     → mode jumlah tetap & batas minimum aktif bersamaan → error minimum change
//   Cyclomatic Complexity V(G) = 15 + 1 = 16
//   Catatan: D5≡D9 dan D6≡D10 memeriksa kondisi yang sama, dan D5 ditentukan
//   oleh D3–D4, sehingga 3 jalur basis tidak feasible (dibuktikan dengan
//   simulasi seluruh kombinasi input: rank maksimum jalur feasible = 13).
//
//  (2b) callback .filter di validateFeatureSelection — hitung forwardCount
//   D1: f.ForcedEntryVar ?? []                               (baris 39)
//   Jalur Independen:
//   P1 (TC-KNN-FSCB-01): D1=array                → fitur forced tidak ikut dihitung
//   P2 (TC-KNN-FSCB-02): D1=null                 → ForcedEntryVar dianggap []
//   Cyclomatic Complexity V(G) = 1 + 1 = 2
//
//  (3) getNumericInputError — input angka tab Neighbors & Partition
//   Pemanggilan isWholeNumber diperlakukan sebagai satu node; flow graph-nya
//   sendiri ada di (3b).
//   D1:  !isWholeNumber(n.SpecifyK)                          (baris 92, ||)
//   D2:  n.Specify                                           (baris 92, &&)
//   D3:  n.SpecifyK < 1                                      (baris 92)
//   D4:  n.AutoSelection                                     (baris 96)
//   D5:  !isWholeNumber(n.MinK)                              (baris 97, ||)
//   D6:  n.MinK < 1                                          (baris 97)
//   D7:  !isWholeNumber(n.MaxK)                              (baris 101, ||)
//   D8:  n.MaxK < 1                                          (baris 101)
//   D9:  n.MinK > n.MaxK                                     (baris 105)
//   D10: !isWholeNumber(p.TrainingNumber)                    (baris 111, ||)
//   D11: p.UseRandomly                                       (baris 112, &&)
//   D12: p.TrainingNumber < 1                                (baris 112, ||)
//   D13: p.TrainingNumber > 100                              (baris 112)
//   D14: !isWholeNumber(p.NumPartition)                      (baris 117)
//   D15: p.Seed !== null                                     (baris 121, &&)
//   D16: !isWholeNumber(p.Seed)                              (baris 121)
//   D17: p.SetSeed                                           (baris 125, &&)
//   D18: p.Seed === null                                     (baris 125, ||)
//   D19: p.Seed < 0                                          (baris 125, ||)
//   D20: p.Seed > MAX_SEED                                   (baris 125)
//   Jalur Independen:
//   P1  (TC-KNN-NUM-01): semua keputusan sisi "valid"  → null
//   P2  (TC-KNN-NUM-02): D1=T                          → error k
//   P3  (TC-KNN-NUM-03): D2=F                          → k < 1 diabaikan → null
//   P4  (TC-KNN-NUM-04): D3=T                          → error k
//   P5  (TC-KNN-NUM-05): D4=T, D5–D9=F                 → null (rentang k otomatis valid)
//   P6  (TC-KNN-NUM-06): D5=T                          → error minimum k
//   P7  (TC-KNN-NUM-07): D6=T                          → error minimum k
//   P8  (TC-KNN-NUM-08): D7=T                          → error maksimum k
//   P9  (TC-KNN-NUM-09): D8=T                          → error maksimum k
//   P10 (TC-KNN-NUM-10): D9=T                          → error minimum k > maksimum k
//   P11 (TC-KNN-NUM-11): D10=T                         → error Training %
//   P12 (TC-KNN-NUM-12): D11=F                         → Training % di luar 1–100 diabaikan → null
//   P13 (TC-KNN-NUM-13): D12=T                         → error Training %
//   P14 (TC-KNN-NUM-14): D13=T                         → error Training %
//   P15 (TC-KNN-NUM-15): D14=T                         → error jumlah fold
//   P16 (TC-KNN-NUM-16): D15=T, D16=T                  → error seed bukan bilangan bulat
//   P17 (TC-KNN-NUM-17): D15=T, D16=F, D17=F           → null (seed terisi tanpa Set Seed)
//   P18 (TC-KNN-NUM-18): D17=T, D18=T                  → error rentang seed
//   P19 (TC-KNN-NUM-19): D18=F, D19=T                  → error rentang seed
//   P20 (TC-KNN-NUM-20): D19=F, D20=T                  → error rentang seed
//   P21 (TC-KNN-NUM-21): D17=T, D18–D20=F              → null (seed valid)
//   Cyclomatic Complexity V(G) = 20 + 1 = 21
//
//  (3b) isWholeNumber — helper bilangan bulat
//   D1: typeof value === "number"                            (baris 77, &&)
//   D2: Number.isInteger(value)                              (baris 77)
//   Jalur Independen (dieksekusi lewat test getNumericInputError):
//   P1 (TC-KNN-NUM-01): D1=T, D2=T               → true  (k = 3)
//   P2 (TC-KNN-NUM-06): D1=F                     → false (minimum k = null)
//   P3 (TC-KNN-NUM-02): D1=T, D2=F               → false (k = 2.5)
//   Cyclomatic Complexity V(G) = 2 + 1 = 3

// ─── (1) validation ────────────────────────────────────────────────────────────
describe('useNearestNeighborValidation – validation / tombol OK (P1–P4)', () => {
    it('TC-KNN-VAL-01 [P1]: Target & feature terisi → isValid true, tanpa pesan error', () => {
        const validation = runValidation();
        expect(validation.isValid).toBe(true);
        expect(validation.errors).toEqual([]);
    });

    it('TC-KNN-VAL-02 [P2]: Target kosong → isValid false, hanya pesan target', () => {
        const validation = runValidation({ main: { TargetVar: null } });
        expect(validation.isValid).toBe(false);
        expect(validation.errors).toEqual([MSG.target]);
    });

    it('TC-KNN-VAL-03 [P3]: Daftar feature kosong → isValid false, hanya pesan feature', () => {
        const validation = runValidation({ main: { FeatureVar: [] } });
        expect(validation.isValid).toBe(false);
        expect(validation.errors).toEqual([MSG.feature]);
    });

    it('TC-KNN-VAL-04 [P4]: FeatureVar null → fallback [], pesan feature muncul', () => {
        const validation = runValidation({ main: { FeatureVar: null } });
        expect(validation.isValid).toBe(false);
        expect(validation.errors).toEqual([MSG.feature]);
    });
});

// ─── (2) validateFeatureSelection ──────────────────────────────────────────────
describe('useNearestNeighborValidation – validateFeatureSelection (P1–P13)', () => {
    it('TC-KNN-FS-01 [P1]: Feature Selection nonaktif → null walau jumlah fitur tidak valid', () => {
        expect(runFeatureSelection({ PerformSelection: false, MaxToSelect: 0 })).toBeNull();
    });

    it('TC-KNN-FS-02 [P2]: Feature Selection aktif, jumlah tetap 2 dari 3 fitur → null', () => {
        expect(runFeatureSelection({})).toBeNull();
    });

    it('TC-KNN-FS-03 [P3]: ForwardSelection null → daftar dianggap kosong → error melebihi daftar', () => {
        expect(runFeatureSelection({ ForwardSelection: null })).toBe(MSG.fsExceed);
    });

    it('TC-KNN-FS-04 [P4]: MaxReached & BelowMin nonaktif → aturan jumlah tidak berlaku → null', () => {
        expect(runFeatureSelection({ MaxReached: false, BelowMin: false, MaxToSelect: 0 })).toBeNull();
    });

    it('TC-KNN-FS-05 [P5]: Mode batas minimum (BelowMin) dengan MinChange valid → null', () => {
        expect(runFeatureSelection({ MaxReached: true, BelowMin: true, MaxToSelect: 0, MinChange: 0.05 })).toBeNull();
    });

    it('TC-KNN-FS-06 [P6]: Jumlah fitur dikosongkan (null) → dihitung otomatis → null', () => {
        expect(runFeatureSelection({ MaxToSelect: null })).toBeNull();
    });

    it('TC-KNN-FS-07 [P7]: Jumlah fitur 0 → error bilangan bulat positif', () => {
        expect(runFeatureSelection({ MaxToSelect: 0 })).toBe(MSG.fsPositive);
    });

    it('TC-KNN-FS-08 [P8]: Jumlah fitur pecahan (1.5) → error bilangan bulat positif', () => {
        expect(runFeatureSelection({ MaxToSelect: 1.5 })).toBe(MSG.fsPositive);
    });

    it('TC-KNN-FS-09 [P9]: Jumlah fitur 5 melebihi 3 fitur Forward Selection → error melebihi daftar', () => {
        expect(runFeatureSelection({ MaxToSelect: 5 })).toBe(MSG.fsExceed);
    });

    it('TC-KNN-FS-10 [P10]: Mode batas minimum, MinChange null → error minimum change', () => {
        expect(runFeatureSelection({ MaxReached: false, BelowMin: true, MinChange: null })).toBe(MSG.fsMinChange);
    });

    it('TC-KNN-FS-11 [P11]: Mode batas minimum, MinChange tak hingga → error minimum change', () => {
        expect(runFeatureSelection({ MaxReached: false, BelowMin: true, MinChange: Infinity })).toBe(MSG.fsMinChange);
    });

    it('TC-KNN-FS-12 [P12]: Mode batas minimum, MinChange negatif → error minimum change', () => {
        expect(runFeatureSelection({ MaxReached: false, BelowMin: true, MinChange: -0.1 })).toBe(MSG.fsMinChange);
    });

    it('TC-KNN-FS-13 [P13]: MaxReached & BelowMin sama-sama aktif, MinChange null → error minimum change', () => {
        expect(runFeatureSelection({ MaxReached: true, BelowMin: true, MinChange: null })).toBe(MSG.fsMinChange);
    });
});

describe('useNearestNeighborValidation – callback .filter forwardCount (P1–P2)', () => {
    it('TC-KNN-FSCB-01 [P1]: ForcedEntryVar berisi feat1 → hanya 2 fitur terhitung, jumlah 3 → error melebihi daftar', () => {
        expect(runFeatureSelection({ ForcedEntryVar: ['feat1'], MaxToSelect: 3 })).toBe(MSG.fsExceed);
    });

    it('TC-KNN-FSCB-02 [P2]: ForcedEntryVar null → dianggap [] sehingga 3 fitur terhitung → null', () => {
        expect(runFeatureSelection({ ForcedEntryVar: null, MaxToSelect: 3 })).toBeNull();
    });
});

// ─── (3) getNumericInputError ──────────────────────────────────────────────────
describe('getNumericInputError – input angka Neighbors (P1–P10)', () => {
    it('TC-KNN-NUM-01 [P1]: Semua input angka valid → null (langsung maupun lewat validateNumericInputs)', () => {
        expect(runNumeric({})).toBeNull();
        const { result } = renderHook(() => useNearestNeighborValidation(makeFormData()));
        expect(result.current.validateNumericInputs()).toBeNull();
    });

    it('TC-KNN-NUM-02 [P2]: k pecahan (2.5) → error k', () => {
        expect(runNumeric({ neighbors: { SpecifyK: 2.5 } })).toBe(MSG.k);
    });

    it('TC-KNN-NUM-03 [P3]: Specify nonaktif → k = 0 tidak diperiksa batasnya → null', () => {
        expect(runNumeric({ neighbors: { Specify: false, SpecifyK: 0 } })).toBeNull();
    });

    it('TC-KNN-NUM-04 [P4]: Specify aktif, k = 0 → error k', () => {
        expect(runNumeric({ neighbors: { SpecifyK: 0 } })).toBe(MSG.k);
    });

    it('TC-KNN-NUM-05 [P5]: k otomatis dengan rentang 3–5 → null', () => {
        expect(runNumeric({ neighbors: { AutoSelection: true, MinK: 3, MaxK: 5 } })).toBeNull();
    });

    it('TC-KNN-NUM-06 [P6]: k otomatis, minimum k kosong → error minimum k', () => {
        expect(runNumeric({ neighbors: { AutoSelection: true, MinK: null, MaxK: 5 } })).toBe(MSG.minK);
    });

    it('TC-KNN-NUM-07 [P7]: k otomatis, minimum k = 0 → error minimum k', () => {
        expect(runNumeric({ neighbors: { AutoSelection: true, MinK: 0, MaxK: 5 } })).toBe(MSG.minK);
    });

    it('TC-KNN-NUM-08 [P8]: k otomatis, maksimum k kosong → error maksimum k', () => {
        expect(runNumeric({ neighbors: { AutoSelection: true, MinK: 3, MaxK: null } })).toBe(MSG.maxK);
    });

    it('TC-KNN-NUM-09 [P9]: k otomatis, maksimum k = 0 → error maksimum k', () => {
        expect(runNumeric({ neighbors: { AutoSelection: true, MinK: 3, MaxK: 0 } })).toBe(MSG.maxK);
    });

    it('TC-KNN-NUM-10 [P10]: k otomatis, minimum 5 > maksimum 3 → error urutan rentang k', () => {
        expect(runNumeric({ neighbors: { AutoSelection: true, MinK: 5, MaxK: 3 } })).toBe(MSG.minGreaterMax);
    });
});

describe('getNumericInputError – input angka Partition (P11–P21)', () => {
    it('TC-KNN-NUM-11 [P11]: Training % pecahan (70.5) → error Training %', () => {
        expect(runNumeric({ partition: { TrainingNumber: 70.5 } })).toBe(MSG.training);
    });

    it('TC-KNN-NUM-12 [P12]: Partisi tidak acak → Training % = 0 tidak diperiksa batasnya → null', () => {
        expect(runNumeric({ partition: { UseRandomly: false, TrainingNumber: 0 } })).toBeNull();
    });

    it('TC-KNN-NUM-13 [P13]: Partisi acak, Training % = 0 → error Training %', () => {
        expect(runNumeric({ partition: { TrainingNumber: 0 } })).toBe(MSG.training);
    });

    it('TC-KNN-NUM-14 [P14]: Partisi acak, Training % = 101 → error Training %', () => {
        expect(runNumeric({ partition: { TrainingNumber: 101 } })).toBe(MSG.training);
    });

    it('TC-KNN-NUM-15 [P15]: Jumlah fold kosong → error jumlah fold', () => {
        expect(runNumeric({ partition: { NumPartition: null } })).toBe(MSG.folds);
    });

    it('TC-KNN-NUM-16 [P16]: Seed pecahan (1.5) → error seed bukan bilangan bulat', () => {
        expect(runNumeric({ partition: { Seed: 1.5 } })).toBe(MSG.seedWhole);
    });

    it('TC-KNN-NUM-17 [P17]: Seed terisi tetapi Set Seed nonaktif → null', () => {
        expect(runNumeric({ partition: { Seed: 5, SetSeed: false } })).toBeNull();
    });

    it('TC-KNN-NUM-18 [P18]: Set Seed aktif, seed kosong → error rentang seed', () => {
        expect(runNumeric({ partition: { SetSeed: true, Seed: null } })).toBe(MSG.seedRange);
    });

    it('TC-KNN-NUM-19 [P19]: Set Seed aktif, seed negatif → error rentang seed', () => {
        expect(runNumeric({ partition: { SetSeed: true, Seed: -1 } })).toBe(MSG.seedRange);
    });

    it('TC-KNN-NUM-20 [P20]: Set Seed aktif, seed melebihi 4294967295 → error rentang seed', () => {
        expect(runNumeric({ partition: { SetSeed: true, Seed: 4294967296 } })).toBe(MSG.seedRange);
    });

    it('TC-KNN-NUM-21 [P21]: Set Seed aktif, seed 12345 → null', () => {
        expect(runNumeric({ partition: { SetSeed: true, Seed: 12345 } })).toBeNull();
    });
});
