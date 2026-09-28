/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import {
    isCrossValidationEnabled,
    isSeedUnavailable,
    enforcePartitionRules,
    applyCrossValidationDefaults,
} from '@/components/Modals/Analyze/Classify/nearest-neighbor/hooks/useNearestNeighborPartitionRules';
import type { KNNPartitionType } from '@/components/Modals/Analyze/Classify/nearest-neighbor/types/nearest-neighbor';

// ─── Helpers ───────────────────────────────────────────────────────────────────
/** State tab Partition bawaan: partisi & fold acak, Set Seed nonaktif. */
const makeState = (overrides: Partial<KNNPartitionType> = {}): KNNPartitionType => ({
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
    ...overrides,
});

/** State hasil muat ulang (form lama) yang field fold-nya belum pernah terisi. */
const makeUnsetFoldState = (): KNNPartitionType => makeState({
    VFoldUseRandomly: undefined as unknown as boolean,
    VFoldUsePartitioningVar: undefined as unknown as boolean,
    NumPartition: null,
});

// ─── Analisis Basis Path ───────────────────────────────────────────────────────
//
//  Unit yang diuji: hooks/useNearestNeighborPartitionRules.ts
//  Node keputusan = setiap kondisi atomik pada if, &&, ||, dan ??.
//  V(G) = jumlah node keputusan + 1.
//
//  (1) isCrossValidationEnabled — kapan bagian Cross Validation Folds aktif
//   D1: isAutoK                                              (baris 13, &&)
//   D2: !isFeatureSelectionActive                            (baris 13)
//   Jalur Independen:
//   P1 (TC-KNN-CV-01): D1=T, D2=T                → true
//   P2 (TC-KNN-CV-02): D1=F                      → false
//   P3 (TC-KNN-CV-03): D1=T, D2=F                → false
//   Cyclomatic Complexity V(G) = 2 + 1 = 3
//
//  (2) isSeedUnavailable — kapan opsi Set Seed tidak tersedia
//   D1: state.UseVariable                                    (baris 19, &&)
//   D2: state.VFoldUsePartitioningVar                        (baris 19)
//   Jalur Independen:
//   P1 (TC-KNN-SEED-01): D1=T, D2=T              → true
//   P2 (TC-KNN-SEED-02): D1=F                    → false
//   P3 (TC-KNN-SEED-03): D1=T, D2=F              → false
//   Cyclomatic Complexity V(G) = 2 + 1 = 3
//
//  (3) enforcePartitionRules — memaksa Set Seed nonaktif bila tidak tersedia
//   D1: !isSeedUnavailable(state)                            (baris 25, ||)
//   D2: !state.SetSeed                                       (baris 25)
//   Jalur Independen:
//   P1 (TC-KNN-ENF-01): D1=T                     → state dikembalikan apa adanya
//   P2 (TC-KNN-ENF-02): D1=F, D2=T               → state dikembalikan apa adanya
//   P3 (TC-KNN-ENF-03): D1=F, D2=F               → SetSeed dipaksa false
//   Cyclomatic Complexity V(G) = 2 + 1 = 3
//
//  (4) applyCrossValidationDefaults — penyesuaian default saat berpindah opsi
//   D1: crossValidationEnabled                               (baris 38)
//   D2: state.VFoldUseRandomly ?? true                       (baris 41)
//   D3: state.VFoldUsePartitioningVar ?? false               (baris 42)
//   D4: state.NumPartition ?? 10                             (baris 43)
//   D5: featureSelectionActive                               (baris 47)
//   Jalur Independen:
//   P1 (TC-KNN-CVDEF-01): D1=T, D2–D4=kosong     → diisi default (acak, tanpa variabel, 10 fold)
//   P2 (TC-KNN-CVDEF-02): D1=T, D2=terisi        → VFoldUseRandomly pengguna dipertahankan
//   P3 (TC-KNN-CVDEF-03): D1=T, D3=terisi        → VFoldUsePartitioningVar pengguna dipertahankan
//   P4 (TC-KNN-CVDEF-04): D1=T, D4=terisi        → NumPartition pengguna dipertahankan
//   P5 (TC-KNN-CVDEF-05): D1=F, D5=T             → kedua opsi fold dipaksa nonaktif
//   P6 (TC-KNN-CVDEF-06): D1=F, D5=F             → state dikembalikan apa adanya
//   Cyclomatic Complexity V(G) = 5 + 1 = 6

// ─── (1) isCrossValidationEnabled ──────────────────────────────────────────────
describe('isCrossValidationEnabled – bagian Cross Validation Folds (P1–P3)', () => {
    it('TC-KNN-CV-01 [P1]: k otomatis & feature selection nonaktif → Cross Validation terbuka', () => {
        expect(isCrossValidationEnabled(true, false)).toBe(true);
    });

    it('TC-KNN-CV-02 [P2]: k manual → Cross Validation terkunci', () => {
        expect(isCrossValidationEnabled(false, false)).toBe(false);
    });

    it('TC-KNN-CV-03 [P3]: k otomatis tetapi feature selection aktif → Cross Validation terkunci', () => {
        expect(isCrossValidationEnabled(true, true)).toBe(false);
    });
});

// ─── (2) isSeedUnavailable ─────────────────────────────────────────────────────
describe('isSeedUnavailable – ketersediaan Set Seed (P1–P3)', () => {
    it('TC-KNN-SEED-01 [P1]: Partisi & fold sama-sama memakai variabel → Set Seed tidak tersedia', () => {
        expect(isSeedUnavailable({ UseVariable: true, VFoldUsePartitioningVar: true })).toBe(true);
    });

    it('TC-KNN-SEED-02 [P2]: Partisi tidak memakai variabel → Set Seed tersedia', () => {
        expect(isSeedUnavailable({ UseVariable: false, VFoldUsePartitioningVar: true })).toBe(false);
    });

    it('TC-KNN-SEED-03 [P3]: Partisi memakai variabel, fold acak → Set Seed tersedia', () => {
        expect(isSeedUnavailable({ UseVariable: true, VFoldUsePartitioningVar: false })).toBe(false);
    });
});

// ─── (3) enforcePartitionRules ─────────────────────────────────────────────────
describe('enforcePartitionRules – memaksa Set Seed nonaktif (P1–P3)', () => {
    it('TC-KNN-ENF-01 [P1]: Seed tersedia → state tidak diubah', () => {
        const state = makeState({ SetSeed: true });
        expect(enforcePartitionRules(state)).toBe(state);
    });

    it('TC-KNN-ENF-02 [P2]: Seed tidak tersedia, Set Seed sudah false → state tidak diubah', () => {
        const state = makeState({ UseVariable: true, VFoldUsePartitioningVar: true, SetSeed: false });
        expect(enforcePartitionRules(state)).toBe(state);
    });

    it('TC-KNN-ENF-03 [P3]: Seed tidak tersedia & Set Seed aktif → Set Seed dipaksa false', () => {
        const state = makeState({ UseVariable: true, VFoldUsePartitioningVar: true, SetSeed: true });
        expect(enforcePartitionRules(state)).toEqual({ ...state, SetSeed: false });
    });
});

// ─── (4) applyCrossValidationDefaults ──────────────────────────────────────────
describe('applyCrossValidationDefaults – default saat berpindah opsi (P1–P6)', () => {
    it('TC-KNN-CVDEF-01 [P1]: Cross Validation aktif & field fold kosong → diisi default', () => {
        const result = applyCrossValidationDefaults(makeUnsetFoldState(), true, false);
        expect(result.VFoldUseRandomly).toBe(true);
        expect(result.VFoldUsePartitioningVar).toBe(false);
        expect(result.NumPartition).toBe(10);
    });

    it('TC-KNN-CVDEF-02 [P2]: Cross Validation aktif, VFoldUseRandomly sudah diisi → dipertahankan', () => {
        const result = applyCrossValidationDefaults({ ...makeUnsetFoldState(), VFoldUseRandomly: false }, true, false);
        expect(result.VFoldUseRandomly).toBe(false);
    });

    it('TC-KNN-CVDEF-03 [P3]: Cross Validation aktif, VFoldUsePartitioningVar sudah diisi → dipertahankan', () => {
        const result = applyCrossValidationDefaults({ ...makeUnsetFoldState(), VFoldUsePartitioningVar: true }, true, false);
        expect(result.VFoldUsePartitioningVar).toBe(true);
    });

    it('TC-KNN-CVDEF-04 [P4]: Cross Validation aktif, NumPartition sudah diisi → dipertahankan', () => {
        const result = applyCrossValidationDefaults({ ...makeUnsetFoldState(), NumPartition: 5 }, true, false);
        expect(result.NumPartition).toBe(5);
    });

    it('TC-KNN-CVDEF-05 [P5]: Cross Validation nonaktif & feature selection aktif → kedua opsi fold dinonaktifkan', () => {
        const result = applyCrossValidationDefaults(makeState({ VFoldUsePartitioningVar: true }), false, true);
        expect(result.VFoldUseRandomly).toBe(false);
        expect(result.VFoldUsePartitioningVar).toBe(false);
    });

    it('TC-KNN-CVDEF-06 [P6]: Cross Validation & feature selection nonaktif → state tidak diubah', () => {
        const state = makeState();
        expect(applyCrossValidationDefaults(state, false, false)).toBe(state);
    });
});
