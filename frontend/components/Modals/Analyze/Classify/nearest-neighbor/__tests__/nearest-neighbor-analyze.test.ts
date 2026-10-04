/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { analyzeKNN } from '@/components/Modals/Analyze/Classify/nearest-neighbor/services/nearest-neighbor-analysis';
import type { KNNAnalysisType } from '@/components/Modals/Analyze/Classify/nearest-neighbor/types/nearest-neighbor-worker';
import type { Variable } from '@/types/Variable';

// ─── Data Mock (getSlicedData / getVarDefs) ────────────────────────────────────
const mockGetSlicedData = jest.fn();
const mockGetVarDefs = jest.fn();

jest.mock('@/hooks/useVariable', () => ({
    getSlicedData: (...args: unknown[]) => mockGetSlicedData(...args),
    getVarDefs: (...args: unknown[]) => mockGetVarDefs(...args),
}));

// ─── Formatter & Output Mock ───────────────────────────────────────────────────
const mockTransformResult = jest.fn();
const mockResultNearestNeighbor = jest.fn();

jest.mock('@/components/Modals/Analyze/Classify/nearest-neighbor/services/nearest-neighbor-analysis-formatter', () => ({
    transformNearestNeighborResult: (...args: unknown[]) => mockTransformResult(...args),
}));

jest.mock('@/components/Modals/Analyze/Classify/nearest-neighbor/services/nearest-neighbor-analysis-output', () => ({
    resultNearestNeighbor: (...args: unknown[]) => mockResultNearestNeighbor(...args),
}));

// ─── Store Mock ────────────────────────────────────────────────────────────────
jest.mock('@/stores/useVariableStore', () => ({
    useVariableStore: { getState: () => ({ variables: [], addVariables: jest.fn() }) },
}));

jest.mock('@/stores/useDataStore', () => ({
    useDataStore: { getState: () => ({ updateCells: jest.fn() }) },
}));

// ─── Worker Mock ───────────────────────────────────────────────────────────────
let capturedMessageHandler: ((e: { data: unknown }) => Promise<void>) | null = null;
let capturedErrorHandler: ((e: { message?: string }) => void) | null = null;

const mockPostMessage = jest.fn();
const mockTerminate = jest.fn();

class MockWorker {
    postMessage = mockPostMessage;
    terminate = mockTerminate;
    set onmessage(h: (e: { data: unknown }) => Promise<void>) { capturedMessageHandler = h; }
    set onerror(h: (e: { message?: string }) => void) { capturedErrorHandler = h; }
}

(global as unknown as { Worker: unknown }).Worker = MockWorker;

// ─── Helpers ───────────────────────────────────────────────────────────────────
const createVar = (name: string, columnIndex: number): Variable => ({
    columnIndex,
    name,
    type: 'NUMERIC',
    width: 8,
    decimals: 2,
    label: '',
    values: [],
    missing: null,
    columns: 10,
    align: 'right',
    measure: 'scale',
    role: 'input',
});

const variables = [createVar('target', 0), createVar('feat1', 1), createVar('focal', 2), createVar('case_id', 3)];

const makeConfig = (main: Partial<KNNAnalysisType['configData']['main']> = {}) => ({
    main: {
        TargetVar: 'target',
        FeatureVar: ['feat1'],
        CaseIdenVar: null,
        FocalCaseIdenVar: null,
        NormCovar: false,
        ...main,
    },
    neighbors: {
        Specify: true, AutoSelection: false, SpecifyK: 3, MinK: null, MaxK: null,
        MetricEucli: true, MetricManhattan: false, Weight: false,
        PredictionsMean: true, PredictionsMedian: false,
    },
    features: {
        ForwardSelection: null, ForcedEntryVar: null, FeaturesToEvaluate: null, ForcedFeatures: null,
        PerformSelection: false, MaxReached: false, BelowMin: false, MaxToSelect: null, MinChange: null,
    },
    partition: {
        PartitioningVariable: null, UseRandomly: true, UseVariable: false,
        VFoldPartitioningVariable: null, VFoldUseRandomly: true, VFoldUsePartitioningVar: false,
        TrainingNumber: 70, NumPartition: null, SetSeed: false, Seed: null,
    },
    save: {
        AutoName: true, CustomName: false, MaxCatsToSave: null, HasTargetVar: false,
        IsCateTargetVar: false, RandomAssignToPartition: false, RandomAssignToFold: false,
    },
    output: {
        CaseSummary: true, FeatureSelectionSummary: false, KSelectionChart: false, PredictorSpace: false,
        PredictionResults: false, ShowNeighborDetail: false, PeersChart: false, QuadrantMap: false,
        ChartAndTable: true,
    },
}) as unknown as KNNAnalysisType['configData'];

/** Menjalankan analyzeKNN; payload yang dikirim ke worker bisa dibaca dari mockPostMessage. */
const runAnalyze = (config = makeConfig()) =>
    analyzeKNN({ configData: config, dataVariables: [], variables } as unknown as KNNAnalysisType);

const sentPayload = () => mockPostMessage.mock.calls[0][0];

const analysisTables = { tables: [{ key: 'case_processing_summary' }] };
const settingsOnlyTables = { tables: [{ key: 'system_settings' }] };

const triggerSuccess = async (data: unknown = analysisTables, errors = 'No errors occurred.') => {
    if (capturedMessageHandler)
        await capturedMessageHandler({ data: { success: true, data, errors } });
};

const triggerWorkerError = async (error?: string) => {
    if (capturedMessageHandler)
        await capturedMessageHandler({ data: { success: false, error } });
};

const triggerConnectionError = (message?: string) => {
    if (capturedErrorHandler) capturedErrorHandler({ message });
};

// ─── Analisis Basis Path ───────────────────────────────────────────────────────
//
//  Unit yang diuji: analyzeKNN (services/nearest-neighbor-analysis.ts)
//  — padanan handleAnalyzes pada modul Time Series. Validasi input (target/
//  feature kosong, parameter di luar batas) dilakukan oleh modul Rust di
//  worker, sehingga di sisi ini muncul sebagai respons {success:false}.
//
//  Node / Keputusan di analyzeKNN:
//   D1:  configData.main.TargetVar truthy                    (ternary, baris 111)
//   D2:  configData.main.FeatureVar ?? []                    (nullish, baris 114)
//   D3:  configData.main.FocalCaseIdenVar truthy             (ternary, baris 115)
//   D4:  slicedDataForTarget.length                          (ternary, baris 170)
//   D5:  slicedDataForFocalCaseIdentifier.length             (ternary, baris 172)
//   D6:  slicedDataForCaseIdentifier.length                  (ternary, baris 175)
//   D7:  worker merespons lewat onmessage atau onerror       (event, baris 186/237)
//   D8:  !e.data.success                                     (if, baris 189)
//   D9:  e.data.error ?? "KNN worker failed."                (nullish, baris 190)
//   D10: isResultJson(result)                                (ternary, baris 198)
//   D11: !hasAnalysisTables                                  (if &&, baris 207)
//   D12: hasWorkerErrors(workerErrors)                       (if &&, baris 207)
//   D13: exception di dalam try                              (catch, baris 231)
//   D14: err.message || "KNN worker error."                  (logika, baris 239)
//   D15: error instanceof Error                              (ternary, baris 233)
//
//  Jalur Independen (P1 = jalur dasar, P2–P15 mengubah keputusan tertentu dari P1):
//   P1  (TC-KNN-01): D1=T, D2=array, D3=F, D4=T, D5=F, D6=F, D7=message,
//                    D8=F, D10=T, D11=F                → sukses, resultNearestNeighbor dipanggil
//   P2  (TC-KNN-02): D1=F, D4=F                        → target dikirim sebagai []
//   P3  (TC-KNN-03): D2=null                           → fallback daftar feature []
//   P4  (TC-KNN-04): D3=T, D5=F                        → focal case di-slice, datanya kosong
//   P5  (TC-KNN-05): D4=F                              → payload.target = []
//   P6  (TC-KNN-06): D3=T, D5=T                        → payload.focal berisi data
//   P7  (TC-KNN-07): D6=T                              → payload.caseData berisi data (bukan null)
//   P8  (TC-KNN-08): D10=F                             → hasil lewat transformNearestNeighborResult
//   P9  (TC-KNN-09): D11=T, D12=F                      → tanpa tabel analisis & tanpa error → tetap sukses
//   P10 (TC-KNN-10): D11=T, D12=T                      → reject dengan pesan error worker
//   P11 (TC-KNN-11): D8=T, D9=kiri                     → reject dengan e.data.error
//   P12 (TC-KNN-12): D8=T, D9=kanan                    → reject "KNN worker failed."
//   P13 (TC-KNN-13): D13=T                             → exception ditangkap catch → reject
//   P14 (TC-KNN-14): D7=onerror, D14=kiri              → reject dengan err.message
//   P15 (TC-KNN-15): D7=onerror, D14=kanan             → reject "KNN worker error."
//   P16 (TC-KNN-16): D13=T, D15=F                      → exception bukan Error dibungkus new Error
//
//  Cyclomatic Complexity V(G) = jumlah simpul predikat + 1 = 15 + 1 = 16

beforeEach(() => {
    capturedMessageHandler = null;
    capturedErrorHandler = null;
    jest.clearAllMocks();
    mockGetSlicedData.mockImplementation(({ selectedVariables }: { selectedVariables: string[] }) =>
        selectedVariables.length ? [{ [selectedVariables[0]]: 1 }] : [],
    );
    mockGetVarDefs.mockImplementation((_vars: unknown, names: string[]) => names.map((name) => [{ name }]));
    mockTransformResult.mockReturnValue(analysisTables);
    mockResultNearestNeighbor.mockResolvedValue(undefined);
});

// ─── Jalur Penyiapan Payload ───────────────────────────────────────────────────
describe('analyzeKNN – Penyiapan Payload Worker (P1–P7)', () => {
    it('TC-KNN-01 [P1]: Konfigurasi dasar & worker sukses → resultNearestNeighbor dipanggil, worker dihentikan', async () => {
        const promise = runAnalyze();
        await triggerSuccess();
        await expect(promise).resolves.toBeUndefined();

        expect(sentPayload().target).toEqual([{ target: 1 }]);
        expect(sentPayload().focal).toEqual([]);
        expect(sentPayload().caseData).toBeNull();
        expect(mockTransformResult).not.toHaveBeenCalled();
        expect(mockResultNearestNeighbor).toHaveBeenCalledTimes(1);
        expect(mockTerminate).toHaveBeenCalled();
    });

    it('TC-KNN-02 [P2]: TargetVar kosong → target di-slice dengan daftar variabel kosong', async () => {
        const promise = runAnalyze(makeConfig({ TargetVar: null as unknown as string }));
        await triggerSuccess();
        await promise;

        expect(mockGetSlicedData).toHaveBeenCalledWith(expect.objectContaining({ selectedVariables: [] }));
        expect(sentPayload().target).toEqual([]);
        expect(sentPayload().targetDefs).toEqual([]);
    });

    it('TC-KNN-03 [P3]: FeatureVar null → fallback daftar feature kosong', async () => {
        const promise = runAnalyze(makeConfig({ FeatureVar: null as unknown as string[] }));
        await triggerSuccess();
        await promise;

        expect(sentPayload().features).toEqual([]);
        expect(sentPayload().featureDefs).toEqual([]);
    });

    it('TC-KNN-04 [P4]: FocalCaseIdenVar terisi tetapi datanya kosong → variabel ikut di-slice, payload.focal = []', async () => {
        mockGetSlicedData.mockImplementation(({ selectedVariables }: { selectedVariables: string[] }) =>
            selectedVariables[0] === 'focal' || !selectedVariables.length ? [] : [{ [selectedVariables[0]]: 1 }],
        );
        const promise = runAnalyze(makeConfig({ FocalCaseIdenVar: 'focal' }));
        await triggerSuccess();
        await promise;

        expect(mockGetSlicedData).toHaveBeenCalledWith(expect.objectContaining({ selectedVariables: ['focal'] }));
        expect(sentPayload().focalDefs).toEqual([[{ name: 'focal', values: [] }]]);
        expect(sentPayload().focal).toEqual([]);
    });

    it('TC-KNN-05 [P5]: Data target hasil slice kosong → payload.target dikirim sebagai []', async () => {
        mockGetSlicedData.mockImplementation(({ selectedVariables }: { selectedVariables: string[] }) =>
            selectedVariables[0] === 'target' || !selectedVariables.length ? [] : [{ [selectedVariables[0]]: 1 }],
        );
        const promise = runAnalyze();
        await triggerSuccess();
        await promise;

        expect(sentPayload().target).toEqual([]);
        expect(sentPayload().features).toEqual([{ feat1: 1 }]);
    });

    it('TC-KNN-06 [P6]: Data focal case tersedia → payload.focal berisi data focal case', async () => {
        const promise = runAnalyze(makeConfig({ FocalCaseIdenVar: 'focal' }));
        await triggerSuccess();
        await promise;

        expect(sentPayload().focal).toEqual([{ focal: 1 }]);
    });

    it('TC-KNN-07 [P7]: CaseIdenVar terisi → payload.caseData berisi data (bukan null)', async () => {
        const promise = runAnalyze(makeConfig({ CaseIdenVar: 'case_id' }));
        await triggerSuccess();
        await promise;

        expect(sentPayload().caseData).toEqual([{ case_id: 1 }]);
    });
});

// ─── Jalur Respons Worker Sukses ───────────────────────────────────────────────
describe('analyzeKNN – Respons Worker Sukses (P8–P10)', () => {
    it('TC-KNN-08 [P8]: Hasil worker bukan ResultJson → diformat lewat transformNearestNeighborResult', async () => {
        const rawResult = { case_processing_summary: {} };
        const promise = runAnalyze();
        await triggerSuccess(rawResult);
        await promise;

        expect(mockTransformResult).toHaveBeenCalledWith(rawResult);
        expect(mockResultNearestNeighbor).toHaveBeenCalledWith(
            expect.objectContaining({ formattedResult: analysisTables, rawResult }),
        );
    });

    it('TC-KNN-09 [P9]: Tanpa tabel analisis tetapi tidak ada error worker → tetap sukses', async () => {
        const promise = runAnalyze();
        await triggerSuccess(settingsOnlyTables, 'No errors occurred.');

        await expect(promise).resolves.toBeUndefined();
        expect(mockResultNearestNeighbor).toHaveBeenCalledTimes(1);
    });

    it('TC-KNN-10 [P10]: Tanpa tabel analisis & ada error worker → reject dengan pesan error worker', async () => {
        const promise = runAnalyze();
        await triggerSuccess(settingsOnlyTables, 'Error: data tidak cukup untuk analisis.');

        await expect(promise).rejects.toThrow('Error: data tidak cukup untuk analisis.');
        expect(mockResultNearestNeighbor).not.toHaveBeenCalled();
        expect(mockTerminate).toHaveBeenCalled();
    });
});

// ─── Jalur Respons Worker Error ────────────────────────────────────────────────
describe('analyzeKNN – Respons Worker Error (P11–P16)', () => {
    it('TC-KNN-11 [P11]: Worker kembalikan success=false dengan pesan → reject dengan pesan dari worker', async () => {
        const promise = runAnalyze();
        await triggerWorkerError('Target variable is required.');

        await expect(promise).rejects.toThrow('Target variable is required.');
        expect(mockResultNearestNeighbor).not.toHaveBeenCalled();
    });

    it('TC-KNN-12 [P12]: Worker kembalikan success=false tanpa pesan → reject "KNN worker failed."', async () => {
        const promise = runAnalyze();
        await triggerWorkerError();

        await expect(promise).rejects.toThrow('KNN worker failed.');
    });

    it('TC-KNN-13 [P13]: Exception saat memproses hasil → ditangkap catch, reject, worker dihentikan', async () => {
        mockResultNearestNeighbor.mockRejectedValueOnce(new Error('Gagal merender hasil.'));
        const promise = runAnalyze();
        await triggerSuccess();

        await expect(promise).rejects.toThrow('Gagal merender hasil.');
        expect(mockTerminate).toHaveBeenCalled();
    });

    it('TC-KNN-14 [P14]: Koneksi worker error dengan pesan → reject dengan err.message', async () => {
        const promise = runAnalyze();
        triggerConnectionError('Failed to load worker script.');

        await expect(promise).rejects.toThrow('Failed to load worker script.');
        expect(mockTerminate).toHaveBeenCalled();
    });

    it('TC-KNN-15 [P15]: Koneksi worker error tanpa pesan → reject "KNN worker error."', async () => {
        const promise = runAnalyze();
        triggerConnectionError();

        await expect(promise).rejects.toThrow('KNN worker error.');
    });

    it('TC-KNN-16 [P16]: Exception berupa string (bukan Error) → dibungkus new Error lalu reject', async () => {
        mockResultNearestNeighbor.mockRejectedValueOnce('Output gagal disimpan.');
        const promise = runAnalyze();
        await triggerSuccess();

        await expect(promise).rejects.toThrow('Output gagal disimpan.');
        await expect(promise).rejects.toBeInstanceOf(Error);
        expect(mockTerminate).toHaveBeenCalled();
    });
});
