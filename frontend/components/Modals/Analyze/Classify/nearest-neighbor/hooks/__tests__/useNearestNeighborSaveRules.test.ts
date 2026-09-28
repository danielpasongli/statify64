/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import {
    computeSaveCapabilities,
    parseMaxCatsToSaveInput,
    resolveSavedVariableName,
    validateCustomSavedNames,
    type SaveCapabilitiesInput,
} from '@/components/Modals/Analyze/Classify/nearest-neighbor/hooks/useNearestNeighborSaveRules';

// ─── Helpers ───────────────────────────────────────────────────────────────────
/** Semua opsi Save terbuka: target nominal, k otomatis, tanpa feature selection & variabel partisi. */
const makeCapabilitiesInput = (overrides: Partial<SaveCapabilitiesInput> = {}): SaveCapabilitiesInput => ({
    hasTarget: true,
    targetType: 'nominal',
    isAutoK: true,
    isFeatureSelectionActive: false,
    isUsingPartitionVariable: false,
    isUsingFoldVariable: false,
    ...overrides,
});

type CustomNameConfig = Parameters<typeof validateCustomSavedNames>[0];

/** Nama kustom aktif, hanya variabel prediksi yang dicentang dengan nama valid. */
const makeSaveConfig = (overrides: Partial<CustomNameConfig> = {}): CustomNameConfig => ({
    CustomName: true,
    HasTargetVar: true,
    IsCateTargetVar: false,
    RandomAssignToPartition: false,
    RandomAssignToFold: false,
    PredictedValueName: 'Pred_Value',
    ProbabilityName: 'Prob_Value',
    PartitionName: 'Part_Value',
    FoldName: 'Fold_Value',
    ...overrides,
});

// ─── Analisis Basis Path ───────────────────────────────────────────────────────
//
//  Unit yang diuji: hooks/useNearestNeighborSaveRules.ts
//  Node keputusan = setiap kondisi atomik pada if, loop, ternary, &&, ||, ?., dan ??.
//  V(G) = jumlah node keputusan + 1.
//
//  (1) computeSaveCapabilities — opsi tab Save yang boleh dicentang
//   D1: targetType === "nominal"                             (baris 27, ||)
//   D2: targetType === "ordinal"                             (baris 27)
//   D3: hasTarget                                            (baris 30, &&)
//   D4: isCategorical                                        (baris 30)
//   D5: hasTarget                                            (baris 32, &&)
//   D6: isAutoK                                              (baris 32, &&)
//   D7: !isFeatureSelectionActive                            (baris 32)
//   D8: canFold                                              (baris 34, &&)
//   D9: !isUsingFoldVariable                                 (baris 34)
//   Jalur Independen:
//   P1 (TC-KNN-CAP-01): semua keputusan true     → seluruh opsi terbuka
//   P2 (TC-KNN-CAP-02): D1=F, D2=T               → target ordinal, probabilitas tetap terbuka
//   P3 (TC-KNN-CAP-03): D2=F → D4=F              → target scale, probabilitas terkunci
//   P4 (TC-KNN-CAP-04): D3=F → D5=F, D8=F        → tanpa target, prediksi/probabilitas/fold terkunci
//   P5 (TC-KNN-CAP-05): D6=F → D8=F              → k manual, fold terkunci
//   P6 (TC-KNN-CAP-06): D7=F → D8=F              → feature selection aktif, fold terkunci
//   P7 (TC-KNN-CAP-07): D9=F                     → variabel fold/partisi dipakai, simpan fold/partisi terkunci
//   P8 (TC-KNN-CAP-08): D2=F, D3=F               → tanpa target & target scale, seluruh opsi target terkunci
//   Cyclomatic Complexity V(G) = 9 + 1 = 10
//   Catatan: D3≡D5 memeriksa variabel yang sama dan D8 ditentukan D5–D7,
//   sehingga 2 jalur basis tidak feasible (dibuktikan dengan simulasi seluruh
//   kombinasi input: rank maksimum jalur feasible = 8).
//
//  (2) parseMaxCatsToSaveInput — input "Max categories to save"
//   D1: rawValue === ""                                      (baris 46)
//   D2: !Number.isFinite(numericValue)                       (baris 49)
//   Jalur Independen:
//   P1 (TC-KNN-MAXCAT-01): D1=T                  → null
//   P2 (TC-KNN-MAXCAT-02): D1=F, D2=T            → undefined (nilai lama dipertahankan)
//   P3 (TC-KNN-MAXCAT-03): D1=F, D2=F            → dibulatkan ke bawah, minimal 1
//   Cyclomatic Complexity V(G) = 2 + 1 = 3
//
//  (3) resolveSavedVariableName — nama final variabel simpanan
//   D1: save[field]?.trim()                                  (baris 80, ?.)
//   D2: save.CustomName                                      (baris 81, &&)
//   D3: customName truthy                                    (baris 81)
//   Jalur Independen:
//   P1 (TC-KNN-NAME-01): D1=ada, D2=T, D3=T      → nama kustom (sudah di-trim)
//   P2 (TC-KNN-NAME-02): D2=F                    → nama bawaan
//   P3 (TC-KNN-NAME-03): D3=F                    → nama kustom kosong → nama bawaan
//   P4 (TC-KNN-NAME-04): D1=null → D3=F          → nama kustom null → nama bawaan
//   Cyclomatic Complexity V(G) = 3 + 1 = 4
//
//  (4) validateCustomSavedNames — validasi nama kustom
//   D1:  !save.CustomName                                    (baris 104)
//   D2:  save.HasTargetVar                                   (baris 107)
//   D3:  save.IsCateTargetVar                                (baris 108)
//   D4:  save.RandomAssignToPartition                        (baris 109)
//   D5:  save.RandomAssignToFold                             (baris 110)
//   D6:  for (... of checkedFields) masih ada elemen         (baris 114)
//   D7:  save[field]?.trim()                                 (baris 115, ?.)
//   D8:  ... ?? ""                                           (baris 115, ??)
//   D9:  !name                                               (baris 117)
//   D10: !VARIABLE_NAME_PATTERN.test(name)                   (baris 121, ||)
//   D11: /[._]$/.test(name)                                  (baris 121)
//   D12: RESERVED_VARIABLE_NAMES.has(...)                    (baris 125)
//   D13: name.length > MAX_VARIABLE_NAME_LENGTH              (baris 129)
//   D14: usedNames.has(key)                                  (baris 134)
//   Jalur Independen:
//   P1  (TC-KNN-CUST-01): D1=T                     → null (nama kustom tidak dipakai)
//   P2  (TC-KNN-CUST-02): D2=T, D6 satu kali, D9–D14=F → null
//   P3  (TC-KNN-CUST-03): D2–D5=F → D6=F langsung  → null (tidak ada yang dicentang)
//   P4  (TC-KNN-CUST-04): D3=T                     → dua nama berbeda → null
//   P5  (TC-KNN-CUST-05): D4=T                     → nama partisi valid → null
//   P6  (TC-KNN-CUST-06): D5=T                     → nama fold valid → null
//   P7  (TC-KNN-CUST-07): D7=null → D8=T → D9=T    → error nama kosong
//   P8  (TC-KNN-CUST-08): D7=ada, D8=F, D9=T       → nama spasi saja → error nama kosong
//   P9  (TC-KNN-CUST-09): D10=T                    → error format nama
//   P10 (TC-KNN-CUST-10): D10=F, D11=T             → error format nama (akhiran "_")
//   P11 (TC-KNN-CUST-11): D12=T                    → error kata kunci terlarang
//   P12 (TC-KNN-CUST-12): D13=T                    → error nama terlalu panjang
//   P13 (TC-KNN-CUST-13): D14=T                    → error nama ganda
//   P14 (TC-KNN-CUST-14): D2–D5=T, D7=null         → keempat variabel dicentang, nama pertama kosong → error
//   Cyclomatic Complexity V(G) = 14 + 1 = 15
//   Catatan: D8 hanya bisa true bila D7 null (trim() selalu menghasilkan
//   string), sehingga 1 jalur basis tidak feasible (dibuktikan dengan simulasi
//   seluruh kombinasi input: rank maksimum jalur feasible = 14).

// ─── (1) computeSaveCapabilities ───────────────────────────────────────────────
describe('computeSaveCapabilities – opsi tab Save (P1–P8)', () => {
    it('TC-KNN-CAP-01 [P1]: Target nominal, k otomatis, tanpa feature selection → semua opsi terbuka', () => {
        expect(computeSaveCapabilities(makeCapabilitiesInput())).toEqual({
            canPredict: true,
            canProbability: true,
            canFold: true,
            canSavePartition: true,
            canSaveFold: true,
        });
    });

    it('TC-KNN-CAP-02 [P2]: Target ordinal → probabilitas tetap boleh disimpan', () => {
        expect(computeSaveCapabilities(makeCapabilitiesInput({ targetType: 'ordinal' })).canProbability).toBe(true);
    });

    it('TC-KNN-CAP-03 [P3]: Target scale → prediksi boleh, probabilitas terkunci', () => {
        const caps = computeSaveCapabilities(makeCapabilitiesInput({ targetType: 'scale' }));
        expect(caps.canPredict).toBe(true);
        expect(caps.canProbability).toBe(false);
    });

    it('TC-KNN-CAP-04 [P4]: Belum ada target → prediksi, probabilitas, dan fold terkunci', () => {
        const caps = computeSaveCapabilities(makeCapabilitiesInput({ hasTarget: false }));
        expect(caps.canPredict).toBe(false);
        expect(caps.canProbability).toBe(false);
        expect(caps.canFold).toBe(false);
        expect(caps.canSaveFold).toBe(false);
    });

    it('TC-KNN-CAP-05 [P5]: k ditentukan manual → fold terkunci', () => {
        const caps = computeSaveCapabilities(makeCapabilitiesInput({ isAutoK: false }));
        expect(caps.canFold).toBe(false);
        expect(caps.canSaveFold).toBe(false);
    });

    it('TC-KNN-CAP-06 [P6]: Feature selection aktif → fold terkunci', () => {
        const caps = computeSaveCapabilities(makeCapabilitiesInput({ isFeatureSelectionActive: true }));
        expect(caps.canFold).toBe(false);
        expect(caps.canSaveFold).toBe(false);
    });

    it('TC-KNN-CAP-07 [P7]: Fold & partisi memakai variabel → fold aktif, tapi simpan fold/partisi terkunci', () => {
        const caps = computeSaveCapabilities(
            makeCapabilitiesInput({ isUsingFoldVariable: true, isUsingPartitionVariable: true }),
        );
        expect(caps.canFold).toBe(true);
        expect(caps.canSaveFold).toBe(false);
        expect(caps.canSavePartition).toBe(false);
    });

    it('TC-KNN-CAP-08 [P8]: Belum ada target & target scale → prediksi, probabilitas, dan fold terkunci', () => {
        const caps = computeSaveCapabilities(makeCapabilitiesInput({ hasTarget: false, targetType: 'scale' }));
        expect(caps.canPredict).toBe(false);
        expect(caps.canProbability).toBe(false);
        expect(caps.canFold).toBe(false);
        expect(caps.canSaveFold).toBe(false);
    });
});

// ─── (2) parseMaxCatsToSaveInput ───────────────────────────────────────────────
describe('parseMaxCatsToSaveInput – input Max categories to save (P1–P3)', () => {
    it('TC-KNN-MAXCAT-01 [P1]: Input dikosongkan → null', () => {
        expect(parseMaxCatsToSaveInput('')).toBeNull();
    });

    it('TC-KNN-MAXCAT-02 [P2]: Input bukan angka → undefined (nilai lama dipertahankan)', () => {
        expect(parseMaxCatsToSaveInput('abc')).toBeUndefined();
    });

    it('TC-KNN-MAXCAT-03 [P3]: Input angka → dibulatkan ke bawah dan minimal 1', () => {
        expect(parseMaxCatsToSaveInput('2.7')).toBe(2);
        expect(parseMaxCatsToSaveInput('0')).toBe(1);
    });
});

// ─── (3) resolveSavedVariableName ──────────────────────────────────────────────
describe('resolveSavedVariableName – nama final variabel simpanan (P1–P4)', () => {
    it('TC-KNN-NAME-01 [P1]: Nama kustom aktif & terisi → nama kustom yang sudah di-trim', () => {
        expect(resolveSavedVariableName({ CustomName: true, PartitionName: '  My_Part  ' }, 'PartitionName')).toBe('My_Part');
    });

    it('TC-KNN-NAME-02 [P2]: Nama kustom nonaktif → nama bawaan', () => {
        expect(resolveSavedVariableName({ CustomName: false, PartitionName: 'My_Part' }, 'PartitionName')).toBe('KNN_Partition');
    });

    it('TC-KNN-NAME-03 [P3]: Nama kustom hanya spasi → nama bawaan', () => {
        expect(resolveSavedVariableName({ CustomName: true, FoldName: '   ' }, 'FoldName')).toBe('KNN_Fold');
    });

    it('TC-KNN-NAME-04 [P4]: Nama kustom null → nama bawaan', () => {
        expect(resolveSavedVariableName({ CustomName: true, FoldName: null }, 'FoldName')).toBe('KNN_Fold');
    });
});

// ─── (4) validateCustomSavedNames ──────────────────────────────────────────────
describe('validateCustomSavedNames – validasi nama kustom (P1–P14)', () => {
    it('TC-KNN-CUST-01 [P1]: Nama kustom nonaktif → null walau nama tidak valid', () => {
        expect(validateCustomSavedNames(makeSaveConfig({ CustomName: false, PredictedValueName: '' }))).toBeNull();
    });

    it('TC-KNN-CUST-02 [P2]: Hanya variabel prediksi dicentang dengan nama valid → null', () => {
        expect(validateCustomSavedNames(makeSaveConfig())).toBeNull();
    });

    it('TC-KNN-CUST-03 [P3]: Tidak ada variabel yang dicentang → null', () => {
        expect(validateCustomSavedNames(makeSaveConfig({ HasTargetVar: false }))).toBeNull();
    });

    it('TC-KNN-CUST-04 [P4]: Prediksi & probabilitas dicentang dengan nama berbeda → null', () => {
        expect(validateCustomSavedNames(makeSaveConfig({ IsCateTargetVar: true }))).toBeNull();
    });

    it('TC-KNN-CUST-05 [P5]: Variabel partisi dicentang dengan nama valid → null', () => {
        expect(validateCustomSavedNames(makeSaveConfig({ RandomAssignToPartition: true }))).toBeNull();
    });

    it('TC-KNN-CUST-06 [P6]: Variabel fold dicentang dengan nama valid → null', () => {
        expect(validateCustomSavedNames(makeSaveConfig({ RandomAssignToFold: true }))).toBeNull();
    });

    it('TC-KNN-CUST-07 [P7]: Nama prediksi null → error nama kosong', () => {
        expect(validateCustomSavedNames(makeSaveConfig({ PredictedValueName: null })))
            .toBe('Enter a variable name for "Predicted Value or Category".');
    });

    it('TC-KNN-CUST-08 [P8]: Nama prediksi hanya spasi → error nama kosong', () => {
        expect(validateCustomSavedNames(makeSaveConfig({ PredictedValueName: '   ' })))
            .toBe('Enter a variable name for "Predicted Value or Category".');
    });

    it('TC-KNN-CUST-09 [P9]: Nama diawali angka → error format nama', () => {
        expect(validateCustomSavedNames(makeSaveConfig({ PredictedValueName: '1Pred' })))
            .toMatch(/^The variable name for "Predicted Value or Category" must start with a letter/);
    });

    it('TC-KNN-CUST-10 [P10]: Nama berakhiran "_" → error format nama', () => {
        expect(validateCustomSavedNames(makeSaveConfig({ PredictedValueName: 'Pred_' })))
            .toMatch(/^The variable name for "Predicted Value or Category" must start with a letter/);
    });

    it('TC-KNN-CUST-11 [P11]: Nama berupa kata kunci "and" → error kata kunci terlarang', () => {
        expect(validateCustomSavedNames(makeSaveConfig({ PredictedValueName: 'and' })))
            .toBe('"and" is a reserved word and cannot be used as a variable name.');
    });

    it('TC-KNN-CUST-12 [P12]: Nama 65 karakter → error nama terlalu panjang', () => {
        expect(validateCustomSavedNames(makeSaveConfig({ PredictedValueName: 'A'.repeat(65) })))
            .toBe('The variable name for "Predicted Value or Category" cannot be longer than 64 characters.');
    });

    it('TC-KNN-CUST-13 [P13]: Nama prediksi & partisi sama (beda huruf besar/kecil) → error nama ganda', () => {
        expect(validateCustomSavedNames(makeSaveConfig({
            RandomAssignToPartition: true,
            PredictedValueName: 'Same_Name',
            PartitionName: 'same_name',
        }))).toBe('Each saved variable must have a different name ("same_name" is used more than once).');
    });

    it('TC-KNN-CUST-14 [P14]: Keempat variabel dicentang, nama prediksi null → error nama kosong', () => {
        expect(validateCustomSavedNames(makeSaveConfig({
            IsCateTargetVar: true,
            RandomAssignToPartition: true,
            RandomAssignToFold: true,
            PredictedValueName: null,
        }))).toBe('Enter a variable name for "Predicted Value or Category".');
    });
});
