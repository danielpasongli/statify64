/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import fs from 'fs';
import path from 'path';
import { renderHook } from '@testing-library/react';
import init, { KNNAnalysis } from '@/components/Modals/Analyze/Classify/nearest-neighbor/rust/pkg/wasm';
import { useNearestNeighborValidation } from '@/components/Modals/Analyze/Classify/nearest-neighbor/hooks/useNearestNeighborValidation';
import { analyzeKNN } from '@/components/Modals/Analyze/Classify/nearest-neighbor/services/nearest-neighbor-analysis';
import { getUserFriendlyKNNError } from '@/components/Modals/Analyze/Classify/nearest-neighbor/services/nearest-neighbor-error-messages';
import { KNNDefault } from '@/components/Modals/Analyze/Classify/nearest-neighbor/constants/nearest-neighbor-default';
import type { KNNType } from '@/components/Modals/Analyze/Classify/nearest-neighbor/types/nearest-neighbor';
import type { Variable } from '@/types/Variable';

// ─── Store Mock (Output Viewer & lembar data) ──────────────────────────────────
const shownOutputs: string[] = [];

jest.mock('@/stores/useResultStore', () => ({
    useResultStore: {
        getState: () => ({
            addLog: jest.fn(() => Promise.resolve(1)),
            addAnalytic: jest.fn(() => Promise.resolve(1)),
            addStatistic: jest.fn((_id: number, stat: { title: string }) => {
                shownOutputs.push(stat.title);
                return Promise.resolve(shownOutputs.length);
            }),
        }),
    },
}));

jest.mock('@/stores/useVariableStore', () => ({
    useVariableStore: { getState: () => ({ variables: [], addVariables: jest.fn() }) },
}));

jest.mock('@/stores/useDataStore', () => ({
    useDataStore: { getState: () => ({ updateCells: jest.fn() }) },
}));

// ─── Worker Mock: menjalankan modul WASM KNN yang asli ─────────────────────────
// Meniru public/workers/Classify/NearestNeighbor/nearest-neighbor.worker.js.
// Hanya koneksi Web Worker yang disimulasikan; perhitungan tetap memakai WASM.
let simulateConnectionError = false;

class WasmWorker {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: { message?: string }) => void) | null = null;
    terminate = jest.fn();

    postMessage(msg: Record<string, unknown>) {
        setTimeout(() => {
            if (simulateConnectionError) {
                this.onerror?.({ message: 'Failed to load worker script.' });
                return;
            }
            try {
                const knn = new KNNAnalysis(
                    msg.target, msg.features, msg.focal, msg.caseData,
                    msg.targetDefs, msg.featureDefs, msg.focalDefs, msg.caseDefs, msg.config,
                );
                this.onmessage?.({ data: { success: true, data: knn.get_formatted_results(), errors: knn.get_all_errors() } });
            } catch (err) {
                this.onmessage?.({ data: { success: false, error: err instanceof Error ? err.message : String(err) } });
            }
        }, 0);
    }
}

(global as unknown as { Worker: unknown }).Worker = WasmWorker;

// ─── Data uji ──────────────────────────────────────────────────────────────────
const createVar = (name: string, columnIndex: number, measure: Variable['measure']): Variable => ({
    id: columnIndex + 1,
    columnIndex,
    name,
    type: 'NUMERIC',
    width: 8,
    decimals: 2,
    label: '',
    values: [],
    missing: null,
    columns: 8,
    align: 'right',
    measure,
    role: 'input',
});

const variables: Variable[] = [
    createVar('case_id', 0, 'nominal'),
    createVar('x1', 1, 'scale'),
    createVar('x2', 2, 'scale'),
    createVar('kelas', 3, 'nominal'),
    createVar('nilai', 4, 'scale'),
    createVar('partisi', 5, 'nominal'),
];

/** 30 kasus: dua kelompok yang terpisah jelas pada x1/x2; kolom partisi seluruhnya holdout (0). */
const dataVariables = Array.from({ length: 30 }, (_, i) => {
    const group = i % 2;
    return [i + 1, group * 10 + (i % 5), group * 10 + ((i * 3) % 5), group + 1, group * 50 + i, 0];
});

type FormOverrides = { [K in keyof KNNType]?: Partial<KNNType[K]> };

/** Pengaturan menu yang valid: target kategorik, 2 feature, k = 3, partisi acak dengan seed. */
const makeForm = (o: FormOverrides = {}): KNNType => ({
    main: { ...KNNDefault.main, TargetVar: 'kelas', FeatureVar: ['x1', 'x2'], ...o.main },
    neighbors: { ...KNNDefault.neighbors, ...o.neighbors },
    features: { ...KNNDefault.features, ForwardSelection: ['x1', 'x2'], ...o.features },
    partition: { ...KNNDefault.partition, SetSeed: true, Seed: 42, ...o.partition },
    save: { ...KNNDefault.save, ...o.save },
    output: { ...KNNDefault.output, ...o.output },
});

type MenuResult = { status: 'blocked' | 'error' | 'success'; message?: string; outputs: string[] };

/**
 * Menjalankan menu Nearest Neighbor seperti saat pengguna menekan tombol OK:
 * tombol OK aktif? → validateBeforeRun → analyzeKNN (modul WASM) → Output Viewer.
 * Pesan error akhir memakai getUserFriendlyKNNError, sama seperti toast di dialog.
 */
async function runMenu(form: KNNType): Promise<MenuResult> {
    shownOutputs.length = 0;
    const { result } = renderHook(() => useNearestNeighborValidation(form));

    if (!result.current.validation.isValid) {
        return { status: 'blocked', message: result.current.validation.errors.join(' '), outputs: [] };
    }

    const error = result.current.validateBeforeRun();
    if (error) return { status: 'error', message: error, outputs: [] };

    try {
        await analyzeKNN({ configData: form, dataVariables, variables } as never);
        return { status: 'success', outputs: [...shownOutputs] };
    } catch (err) {
        return { status: 'error', message: getUserFriendlyKNNError(err), outputs: [...shownOutputs] };
    }
}

// ─── Analisis Basis Path (tingkat menu) ────────────────────────────────────────
//
//  Simpul:
//   K01 Mengakses / mengeksekusi menu Nearest Neighbor
//   K02 Variabel target atau feature belum dipilih (tombol OK terkunci)
//   K03 Variabel target dan feature telah dipilih (tombol OK aktif)
//   K04 Pengaturan Feature Selection tidak valid
//   K05 Pengaturan Feature Selection valid atau tidak digunakan
//   K06 Input angka (k, Training %, fold, seed) tidak valid
//   K07 Input angka valid
//   K08 Nama kustom variabel yang disimpan tidak valid
//   K09 Nama kustom valid atau tidak digunakan; data dikirim ke modul perhitungan
//   K10 Modul perhitungan gagal menganalisis data
//   K11 Terjadi gangguan koneksi ke modul perhitungan
//   K12 Modul perhitungan mengirim hasil analisis
//   K13 Variabel target bertipe kategorik
//   K14 Variabel target bertipe scale
//   K15 Menyusun luaran klasifikasi (Classification Table dan Error Summary)
//   K16 Menyusun luaran prediksi numerik (tanpa Classification Table dan Error Summary)
//   K17 Menyusun luaran umum (Case Processing Summary dan Predictor Space)
//   K18 Nilai k ditentukan manual
//   K19 Nilai k dipilih otomatis (menampilkan k Selection Error Log)
//   K20 Menampilkan luaran statistik atau pesan kesalahan (error)
//
//  E = 27, N = 20 → V(G) = 27 − 20 + 2 = 9
//
//  Jalur Independen:
//   P1 (TCK01): K01–K02–K20
//   P2 (TCK02): K01–K03–K04–K20
//   P3 (TCK03): K01–K03–K05–K06–K20
//   P4 (TCK04): K01–K03–K05–K07–K08–K20
//   P5 (TCK05): K01–K03–K05–K07–K09–K10–K20
//   P6 (TCK06): K01–K03–K05–K07–K09–K11–K20
//   P7 (TCK07): K01–K03–K05–K07–K09–K12–K13–K15–K17–K18–K20
//   P8 (TCK08): K01–K03–K05–K07–K09–K12–K14–K16–K17–K18–K20
//   P9 (TCK09): K01–K03–K05–K07–K09–K12–K13–K15–K17–K19–K20

beforeAll(async () => {
    const wasmBuffer = fs.readFileSync(path.join(__dirname, '../rust/pkg/wasm_bg.wasm'));
    await init({ module_or_path: wasmBuffer });
});

beforeEach(() => {
    simulateConnectionError = false;
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('Menu Nearest Neighbor – Validasi Pengaturan (P1–P4)', () => {
    it('TCK01 [P1]: Variabel target belum dipilih → tombol OK terkunci dengan pesan target', async () => {
        const result = await runMenu(makeForm({ main: { TargetVar: null } }));
        expect(result.status).toBe('blocked');
        expect(result.message).toBe('Select a target variable.');
    });

    it('TCK02 [P2]: Jumlah fitur Feature Selection melebihi daftar → pesan error, analisis tidak dijalankan', async () => {
        const result = await runMenu(makeForm({ features: { PerformSelection: true, MaxReached: true, MaxToSelect: 5 } }));
        expect(result.status).toBe('error');
        expect(result.message).toBe('The number of features to select cannot exceed the number of features in the Forward Selection list.');
        expect(result.outputs).toEqual([]);
    });

    it('TCK03 [P3]: Nilai k = 0 → pesan error, analisis tidak dijalankan', async () => {
        const result = await runMenu(makeForm({ neighbors: { SpecifyK: 0 } }));
        expect(result.status).toBe('error');
        expect(result.message).toBe('Enter a whole number of at least 1 for k.');
        expect(result.outputs).toEqual([]);
    });

    it('TCK04 [P4]: Nama kustom variabel prediksi kosong → pesan error, analisis tidak dijalankan', async () => {
        const result = await runMenu(makeForm({ save: { CustomName: true, HasTargetVar: true, PredictedValueName: '' } }));
        expect(result.status).toBe('error');
        expect(result.message).toBe('Enter a variable name for "Predicted Value or Category".');
        expect(result.outputs).toEqual([]);
    });
});

describe('Menu Nearest Neighbor – Respons Modul Perhitungan (P5–P9)', () => {
    it('TCK05 [P5]: Variabel partisi tanpa kasus training → modul perhitungan gagal, pesan error ditampilkan', async () => {
        const result = await runMenu(makeForm({
            main: { CaseIdenVar: 'case_id' },
            partition: { UseRandomly: false, UseVariable: true, PartitioningVariable: 'partisi' },
        }));
        expect(result.status).toBe('error');
        expect(result.message).toBe('The selected partition variable does not contain any training cases. Use positive values for training cases.');
    });

    it('TCK06 [P6]: Gangguan koneksi ke modul perhitungan → pesan error ditampilkan', async () => {
        simulateConnectionError = true;
        const result = await runMenu(makeForm());
        expect(result.status).toBe('error');
        expect(result.message).toBe('The KNN analysis engine could not be loaded. Please refresh the page and try again.');
        expect(result.outputs).toEqual([]);
    });

    it('TCK07 [P7]: Target kategorik, k manual → Classification Table tampil, tanpa k Selection Error Log', async () => {
        const result = await runMenu(makeForm());
        expect(result.status).toBe('success');
        expect(result.outputs).toEqual(expect.arrayContaining(['Case Processing Summary', 'Predictor Space', 'Classification Table', 'Error Summary']));
        expect(result.outputs).not.toContain('k Selection Error Log');
    });

    it('TCK08 [P8]: Target scale, k manual → luaran prediksi numerik tanpa Classification Table & Error Summary', async () => {
        const result = await runMenu(makeForm({ main: { TargetVar: 'nilai' } }));
        expect(result.status).toBe('success');
        expect(result.outputs).toEqual(expect.arrayContaining(['Case Processing Summary', 'Predictor Space']));
        expect(result.outputs).not.toContain('Classification Table');
        expect(result.outputs).not.toContain('Error Summary');
        expect(result.outputs).not.toContain('k Selection Error Log');
    });

    it('TCK09 [P9]: Target kategorik, k otomatis 1–5 → Classification Table dan k Selection Error Log tampil', async () => {
        const result = await runMenu(makeForm({
            neighbors: { Specify: false, AutoSelection: true, MinK: 1, MaxK: 5 },
        }));
        expect(result.status).toBe('success');
        expect(result.outputs).toEqual(expect.arrayContaining(['Classification Table', 'k Selection Error Log']));
    });
});
