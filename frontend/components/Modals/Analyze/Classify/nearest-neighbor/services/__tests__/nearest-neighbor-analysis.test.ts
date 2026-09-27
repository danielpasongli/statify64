/**
 * WHITE-BOX TESTING — BASIS PATH TESTING (McCabe)
 * Modul yang diuji: nearest-neighbor-analysis.ts
 * (frontend/components/Modals/Analyze/Classify/nearest-neighbor/services/nearest-neighbor-analysis.ts)
 *
 * METODOLOGI
 * ----------
 * 1. Flow graph disusun per unit fungsi. Fungsi bertingkat yang berdiri
 *    sendiri sebagai closure (mis. Promise executor, worker.onmessage,
 *    worker.onerror pada analyzeKNN; forEach callback pada
 *    saveKnnVariablesToDataViewer) dihitung sebagai flow graph terpisah.
 * 2. Cyclomatic complexity dihitung dengan V(G) = jumlah simpul predikat + 1.
 *    Simpul predikat = setiap kemunculan if, else-if, for, while, case,
 *    catch, operator logika (&&, ||, ??), dan ekspresi ternary (?:) pada
 *    source code (setiap kemunculan dihitung terpisah walau kondisinya
 *    sama, karena tiap kemunculan adalah simpul keputusan tersendiri
 *    pada flow graph).
 * 3. Independent path (jalur basis) diturunkan dari flow graph sejumlah
 *    V(G), dipilih agar setiap edge baru pada graph ikut tercakup.
 * 4. Setiap independent path diimplementasikan sebagai satu test case Jest.
 *    Test bertanda "(tambahan)" adalah path/percabangan di luar jumlah
 *    minimum V(G) yang tetap diuji agar seluruh sisi true/false setiap
 *    simpul keputusan benar-benar tercakup 100% (full branch coverage),
 *    termasuk kasus batas perulangan (loop boundary 0/1/banyak elemen).
 *
 * Fungsi-fungsi internal (semula tidak diekspor) diberi keyword `export`
 * pada nearest-neighbor-analysis.ts supaya bisa diuji langsung sebagai
 * white-box unit (tidak mengubah perilaku, hanya visibilitas).
 *
 * Rekap V(G) (dihitung dari kondisi atomik pada flow graph tertutup/
 * single-exit — rincian tabel simpul, flow graph, dan derivasi test case
 * berupa kode TC, jalur, ekspektasi, aktual, hasil, ada pada laporan
 * pengujian terpisah):
 *   isResultJson                                -> V(G) = 4
 *   hasWorkerErrors                              -> V(G) = 3
 *   filterViewerOutput                           -> V(G) = 2
 *   normalizeKnnVarDefsForWorker (isArray ternary)  -> V(G) = 2
 *   normalizeKnnVarDefsForWorker (nullish chain)    -> V(G) = 3
 *   withInternalChartOutputs                     -> V(G) = 9
 *   normalizeSavedValue                          -> V(G) = 5
 *   saveKnnVariablesToDataViewer (badan utama)   -> V(G) = 15
 *   analyzeKNN (badan fungsi utama)              -> V(G) = 4
 *   analyzeKNN (closure Promise executor)        -> V(G) = 4
 *   analyzeKNN (closure worker.onmessage)        -> V(G) = 6
 *   analyzeKNN (closure worker.onerror)          -> V(G) = 1
 *
 * Hasil akhir eksekusi (ringkasan pass/fail) dicetak ke console pada blok
 * afterAll() di bagian paling bawah file ini.
 */

import type { Variable } from "@/types/Variable";
import type { KNNAnalysisType } from "@/components/Modals/Analyze/Classify/nearest-neighbor/types/nearest-neighbor-worker";

// ---------------------------------------------------------------------------
// Mocks (module-level, di-hoist oleh Jest)
// ---------------------------------------------------------------------------

const mockGetSlicedData = jest.fn();
const mockGetVarDefs = jest.fn();
jest.mock("@/hooks/useVariable", () => ({
  getSlicedData: (...args: unknown[]) => mockGetSlicedData(...args),
  getVarDefs: (...args: unknown[]) => mockGetVarDefs(...args),
}));

const mockTransformNearestNeighborResult = jest.fn();
jest.mock("../nearest-neighbor-analysis-formatter", () => ({
  transformNearestNeighborResult: (...args: unknown[]) =>
    mockTransformNearestNeighborResult(...args),
}));

const mockResultNearestNeighbor = jest.fn();
jest.mock("../nearest-neighbor-analysis-output", () => ({
  resultNearestNeighbor: (...args: unknown[]) => mockResultNearestNeighbor(...args),
}));

const mockAddVariables = jest.fn().mockResolvedValue(undefined);
const mockVariableStoreState = { variables: [] as Variable[], addVariables: mockAddVariables };
jest.mock("@/stores/useVariableStore", () => ({
  useVariableStore: { getState: jest.fn(() => mockVariableStoreState) },
}));

const mockUpdateCells = jest.fn().mockResolvedValue(undefined);
jest.mock("@/stores/useDataStore", () => ({
  useDataStore: { getState: jest.fn(() => ({ updateCells: mockUpdateCells })) },
}));

import {
  analyzeKNN,
  isResultJson,
  hasWorkerErrors,
  filterViewerOutput,
  normalizeKnnVarDefsForWorker,
  withInternalChartOutputs,
  saveKnnVariablesToDataViewer,
  normalizeSavedValue,
} from "../nearest-neighbor-analysis";

// ---------------------------------------------------------------------------
// Penampung hasil pengujian untuk laporan akhir
// ---------------------------------------------------------------------------
type PathResult = { fn: string; path: string; status: "PASS" | "FAIL"; note?: string };
const results: PathResult[] = [];
function record(fn: string, path: string, status: "PASS" | "FAIL", note?: string) {
  results.push({ fn, path, status, note });
}

// ---------------------------------------------------------------------------
// Helper fixture: konfigurasi KNN default yang valid
// ---------------------------------------------------------------------------
function makeConfig(
  overrides: Partial<{
    main: Partial<KNNAnalysisType["configData"]["main"]>;
    neighbors: Partial<KNNAnalysisType["configData"]["neighbors"]>;
    features: Partial<KNNAnalysisType["configData"]["features"]>;
    partition: Partial<KNNAnalysisType["configData"]["partition"]>;
    save: Partial<KNNAnalysisType["configData"]["save"]>;
    output: Partial<KNNAnalysisType["configData"]["output"]>;
  }> = {},
): KNNAnalysisType["configData"] {
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
      ForwardSelection: null,
      ForcedEntryVar: null,
      FeaturesToEvaluate: null,
      ForcedFeatures: null,
      PerformSelection: false,
      MaxReached: false,
      BelowMin: false,
      MaxToSelect: null,
      MinChange: null,
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
      ...overrides.save,
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
      ...overrides.output,
    },
  } as KNNAnalysisType["configData"];
}

// =============================================================================
// 1) isResultJson(result)  ->  V(G) = 3   (2 x "&&")
// Flow graph:
//   start -> C1:typeof===object -> [F]-> return false
//                                -> [T]-> C2:result!==null -> [F]-> return false
//                                                            -> [T]-> C3:Array.isArray(tables) -> [T]-> return true
//                                                                                                -> [F]-> return false
// Independent paths (basis set, V=3) + 1 tambahan untuk cakupan penuh:
//   P1: C1 false                              -> false
//   P2: C1 true,  C2 false                    -> false
//   P3: C1 true,  C2 true,  C3 true            -> true
//   P4 (tambahan): C1 true, C2 true, C3 false  -> false
// =============================================================================
describe("isResultJson — basis path testing (V(G)=3)", () => {
  it("P1: result bukan object -> false", () => {
    const r = isResultJson("bukan-object");
    expect(r).toBe(false);
    record("isResultJson", "P1 (C1=false)", r === false ? "PASS" : "FAIL");
  });

  it("P2: object tapi null -> false", () => {
    const r = isResultJson(null);
    expect(r).toBe(false);
    record("isResultJson", "P2 (C1=true, C2=false)", r === false ? "PASS" : "FAIL");
  });

  it("P3: object valid, tables adalah array -> true", () => {
    const r = isResultJson({ tables: [] });
    expect(r).toBe(true);
    record("isResultJson", "P3 (C1=true, C2=true, C3=true)", r === true ? "PASS" : "FAIL");
  });

  it("P4 (tambahan): object valid, tables BUKAN array -> false", () => {
    const r = isResultJson({ tables: "not-an-array" });
    expect(r).toBe(false);
    record("isResultJson", "P4 (C1=true, C2=true, C3=false)", r === false ? "PASS" : "FAIL");
  });
});

// =============================================================================
// 2) hasWorkerErrors(errors)  ->  V(G) = 2   (1 x "&&")
// Independent paths + 1 tambahan:
//   P1: bukan string                                    -> false
//   P2: string, TIDAK mengandung "No errors occurred."   -> true
//   P3 (tambahan): string, mengandung "No errors occurred." -> false
// =============================================================================
describe("hasWorkerErrors — basis path testing (V(G)=2)", () => {
  it("P1: errors bukan string -> false", () => {
    const r = hasWorkerErrors(undefined);
    expect(r).toBe(false);
    record("hasWorkerErrors", "P1 (C1=false)", r === false ? "PASS" : "FAIL");
  });

  it("P2: string tanpa frasa 'No errors occurred.' -> true", () => {
    const r = hasWorkerErrors("Error: fitur tidak valid");
    expect(r).toBe(true);
    record("hasWorkerErrors", "P2 (C1=true, C2=true)", r === true ? "PASS" : "FAIL");
  });

  it("P3 (tambahan): string berisi 'No errors occurred.' -> false", () => {
    const r = hasWorkerErrors("No errors occurred.");
    expect(r).toBe(false);
    record("hasWorkerErrors", "P3 (C1=true, C2=false)", r === false ? "PASS" : "FAIL");
  });
});

// =============================================================================
// 3) filterViewerOutput(result)  ->  V(G) = 1 (tidak ada percabangan eksplisit
//    pada fungsi itu sendiri; predicate .filter() diuji lewat data flow)
// Path tunggal wajib (P1) + 1 tambahan untuk memastikan predicate filter benar.
// =============================================================================
describe("filterViewerOutput — basis path testing (V(G)=1)", () => {
  it("P1: tabel dengan key tersembunyi ikut terbuang", () => {
    const result = filterViewerOutput({
      tables: [
        { key: "prediction_results", title: "x", columnHeaders: [], rows: [] } as any,
        { key: "case_processing_summary", title: "y", columnHeaders: [], rows: [] } as any,
      ],
    } as any);
    const keys = result.tables.map((t) => t.key);
    const ok = !keys.includes("prediction_results") && keys.includes("case_processing_summary");
    expect(keys).not.toContain("prediction_results");
    expect(keys).toContain("case_processing_summary");
    record("filterViewerOutput", "P1: hidden key dibuang", ok ? "PASS" : "FAIL");
  });

  it("tambahan: tidak ada tabel tersembunyi -> semua tabel tetap ada", () => {
    const result = filterViewerOutput({
      tables: [{ key: "case_processing_summary", title: "y", columnHeaders: [], rows: [] } as any],
    } as any);
    const ok = result.tables.length === 1;
    expect(result.tables).toHaveLength(1);
    record("filterViewerOutput", "tambahan: tanpa hidden key", ok ? "PASS" : "FAIL");
  });
});

// =============================================================================
// 4) normalizeKnnVarDefsForWorker(defs)  ->  V(G) = 4
//    (1 ternary Array.isArray + 2 operator "??")
// Independent paths:
//   P1: varDef.values BUKAN array           -> values dinormalisasi jadi []
//   P2: values array, valueLabel.variable_name terisi          -> dipakai apa adanya
//   P3: values array, variable_name kosong, varDef.name terisi -> fallback ke varDef.name
//   P4: values array, variable_name & varDef.name kosong       -> fallback ke ""
// =============================================================================
describe("normalizeKnnVarDefsForWorker — basis path testing (V(G)=4)", () => {
  it("P1: values bukan array -> dinormalisasi jadi array kosong", () => {
    const out = normalizeKnnVarDefsForWorker([[{ name: "feat1", values: "invalid" }]]);
    const ok = Array.isArray(out[0][0].values) && out[0][0].values.length === 0;
    expect(out[0][0].values).toEqual([]);
    record("normalizeKnnVarDefsForWorker", "P1: values not array", ok ? "PASS" : "FAIL");
  });

  it("P1b (tambahan): values array TAPI kosong -> tetap [] tanpa memanggil transformasi nilai", () => {
    const out = normalizeKnnVarDefsForWorker([[{ name: "feat1", values: [] }]]);
    const ok = Array.isArray(out[0][0].values) && out[0][0].values.length === 0;
    expect(out[0][0].values).toEqual([]);
    record("normalizeKnnVarDefsForWorker", "P1b: values array kosong (0 elemen)", ok ? "PASS" : "FAIL");
  });

  it("P2: variable_name pada value label sudah terisi -> dipakai apa adanya", () => {
    const out = normalizeKnnVarDefsForWorker([
      [{ name: "feat1", values: [{ value: 1, label: "A", variable_name: "feat1_custom" }] }],
    ]);
    const ok = out[0][0].values[0].variable_name === "feat1_custom";
    expect(out[0][0].values[0].variable_name).toBe("feat1_custom");
    record("normalizeKnnVarDefsForWorker", "P2: variable_name terisi", ok ? "PASS" : "FAIL");
  });

  it("P3: variable_name kosong -> fallback ke varDef.name", () => {
    const out = normalizeKnnVarDefsForWorker([
      [{ name: "feat1", values: [{ value: 1, label: "A" }] }],
    ]);
    const ok = out[0][0].values[0].variable_name === "feat1";
    expect(out[0][0].values[0].variable_name).toBe("feat1");
    record("normalizeKnnVarDefsForWorker", "P3: fallback ke varDef.name", ok ? "PASS" : "FAIL");
  });

  it("P4: variable_name dan varDef.name sama-sama kosong -> fallback ke string kosong", () => {
    const out = normalizeKnnVarDefsForWorker([
      [{ values: [{ value: 1, label: "A" }] }],
    ]);
    const ok = out[0][0].values[0].variable_name === "";
    expect(out[0][0].values[0].variable_name).toBe("");
    record("normalizeKnnVarDefsForWorker", "P4: fallback ke ''", ok ? "PASS" : "FAIL");
  });
});

// =============================================================================
// 5) withInternalChartOutputs(configData)  ->  V(G) = 4
//    (1 x "&&" untuk needsKSelectionErrorChart,
//     2 x "||" untuk KSelectionChart / FeatureSelectionSummary output;
//     needsKAndPredictorSelectionChart = PerformSelection, berlaku untuk k tetap maupun k otomatis)
// Independent paths (baseline + 1 flip per predikat):
//   P1 (baseline): AutoSelection=false, PerformSelection=false -> KSelectionChart=false, FeatureSelectionSummary=false
//   P2: AutoSelection=true, PerformSelection=false         -> KSelectionChart=true  (needsKSelectionErrorChart)
//   P3: AutoSelection=false, PerformSelection=true         -> FeatureSelectionSummary=true (seleksi fitur dengan k tetap)
//   P4: output.KSelectionChart sudah true (AutoSelection=false) -> tetap true lewat OR
// Tambahan (bukan basis path):
//   P5: output.FeatureSelectionSummary sudah true (AutoSelection=false) -> tetap true lewat OR
//   P6: AutoSelection=true, PerformSelection=true          -> FeatureSelectionSummary=true, KSelectionChart=false
// PredictorSpace selalu dipaksa true pada seluruh path (diverifikasi tiap test).
// =============================================================================
describe("withInternalChartOutputs — basis path testing (V(G)=4)", () => {
  it("P1 (baseline): AutoSelection=false -> tidak ada chart tambahan yang dipaksa", () => {
    const cfg = makeConfig({ neighbors: { AutoSelection: false }, features: { PerformSelection: false } });
    const out = withInternalChartOutputs(cfg);
    const ok = out.output.KSelectionChart === false && out.output.FeatureSelectionSummary === false && out.output.PredictorSpace === true;
    expect(out.output.KSelectionChart).toBe(false);
    expect(out.output.FeatureSelectionSummary).toBe(false);
    expect(out.output.PredictorSpace).toBe(true);
    record("withInternalChartOutputs", "P1: baseline", ok ? "PASS" : "FAIL");
  });

  it("P2: AutoSelection=true, PerformSelection=false -> KSelectionChart dipaksa true", () => {
    const cfg = makeConfig({ neighbors: { AutoSelection: true }, features: { PerformSelection: false } });
    const out = withInternalChartOutputs(cfg);
    const ok = out.output.KSelectionChart === true && out.output.FeatureSelectionSummary === false;
    expect(out.output.KSelectionChart).toBe(true);
    expect(out.output.FeatureSelectionSummary).toBe(false);
    record("withInternalChartOutputs", "P2: needsKSelectionErrorChart", ok ? "PASS" : "FAIL");
  });

  it("P3: AutoSelection=false, PerformSelection=true -> FeatureSelectionSummary dipaksa true (k tetap)", () => {
    const cfg = makeConfig({ neighbors: { AutoSelection: false }, features: { PerformSelection: true } });
    const out = withInternalChartOutputs(cfg);
    const ok = out.output.FeatureSelectionSummary === true && out.output.KSelectionChart === false;
    expect(out.output.FeatureSelectionSummary).toBe(true);
    expect(out.output.KSelectionChart).toBe(false);
    record("withInternalChartOutputs", "P3: needsKAndPredictorSelectionChart (fixed k)", ok ? "PASS" : "FAIL");
  });

  it("P4: output.KSelectionChart sudah true meski AutoSelection=false -> tetap true (OR)", () => {
    const cfg = makeConfig({ neighbors: { AutoSelection: false }, output: { KSelectionChart: true } });
    const out = withInternalChartOutputs(cfg);
    const ok = out.output.KSelectionChart === true;
    expect(out.output.KSelectionChart).toBe(true);
    record("withInternalChartOutputs", "P4: KSelectionChart existing true (OR)", ok ? "PASS" : "FAIL");
  });

  it("P5: output.FeatureSelectionSummary sudah true meski AutoSelection=false -> tetap true (OR)", () => {
    const cfg = makeConfig({ neighbors: { AutoSelection: false }, output: { FeatureSelectionSummary: true } });
    const out = withInternalChartOutputs(cfg);
    const ok = out.output.FeatureSelectionSummary === true;
    expect(out.output.FeatureSelectionSummary).toBe(true);
    record("withInternalChartOutputs", "P5: FeatureSelectionSummary existing true (OR)", ok ? "PASS" : "FAIL");
  });

  it("P6: AutoSelection=true, PerformSelection=true -> FeatureSelectionSummary dipaksa true (k otomatis)", () => {
    const cfg = makeConfig({ neighbors: { AutoSelection: true }, features: { PerformSelection: true } });
    const out = withInternalChartOutputs(cfg);
    const ok = out.output.FeatureSelectionSummary === true && out.output.KSelectionChart === false;
    expect(out.output.FeatureSelectionSummary).toBe(true);
    expect(out.output.KSelectionChart).toBe(false);
    record("withInternalChartOutputs", "P6: needsKAndPredictorSelectionChart (auto k)", ok ? "PASS" : "FAIL");
  });
});

// =============================================================================
// 6) normalizeSavedValue(value)  ->  V(G) = 5
//    (if#1 + "||" di dalamnya, if#2 + ternary di dalamnya)
// Independent paths:
//   P1: value === null                    -> ""
//   P2: value === undefined                -> ""
//   P3: typeof value === "boolean", true   -> "true"
//   P4: typeof value === "boolean", false  -> "false"
//   P5: value bukan null/undefined/boolean -> dikembalikan apa adanya
// =============================================================================
describe("normalizeSavedValue — basis path testing (V(G)=5)", () => {
  it("P1: value null -> ''", () => {
    const r = normalizeSavedValue(null);
    expect(r).toBe("");
    record("normalizeSavedValue", "P1: null", r === "" ? "PASS" : "FAIL");
  });

  it("P2: value undefined -> ''", () => {
    const r = normalizeSavedValue(undefined);
    expect(r).toBe("");
    record("normalizeSavedValue", "P2: undefined", r === "" ? "PASS" : "FAIL");
  });

  it("P3: value boolean true -> 'true'", () => {
    const r = normalizeSavedValue(true);
    expect(r).toBe("true");
    record("normalizeSavedValue", "P3: boolean true", r === "true" ? "PASS" : "FAIL");
  });

  it("P4: value boolean false -> 'false'", () => {
    const r = normalizeSavedValue(false);
    expect(r).toBe("false");
    record("normalizeSavedValue", "P4: boolean false", r === "false" ? "PASS" : "FAIL");
  });

  it("P5: value number/string biasa -> dikembalikan apa adanya", () => {
    const r1 = normalizeSavedValue(42);
    const r2 = normalizeSavedValue("abc");
    const ok = r1 === 42 && r2 === "abc";
    expect(r1).toBe(42);
    expect(r2).toBe("abc");
    record("normalizeSavedValue", "P5: nilai biasa", ok ? "PASS" : "FAIL");
  });
});

// =============================================================================
// 7) saveKnnVariablesToDataViewer(savedVariables, useCustomNames) -> V(G) = 15
//    Predikat: optional-chaining, "??", if(!length) return, ternary nextColumnIndex,
//    for-loop, ternary existingVariable, if(existingVariable), ternary width,
//    ternary align, "||" nama partition/fold, ternary role, if(normalizedValue!==""),
//    if(newVariableDefinitions.length>0), if(existingVariableUpdates.length>0).
// Independent paths (basis set dipilih agar tiap simpul predikat tercakup
// pada kedua sisi true/false-nya; beberapa predikat yang berkorelasi pada satu
// baris data — mis. ternary width & align yang sama-sama bergantung pada
// variable_type === "STRING" — sengaja dicek dalam satu test yang sama):
//   P1: savedVariables null/undefined                          -> tidak ada operasi apa pun
//   P2: savedVariables.variables kosong ([])                    -> tidak ada operasi apa pun
//   P3: variabel baru (bukan STRING), useCustomNames=false       -> addVariables terpanggil, width/align numerik, role="none"
//   P4: variabel baru bertipe STRING                             -> width=64, align="left"
//   P5: variabel baru bernama "KNN_Partition"/"KNN_Fold"         -> role="partition"
//   P6: variabel sudah ada & useCustomNames=true                 -> updateCells terpanggil (bukan addVariables)
//   P7: currentVariables kosong (nextColumnIndex dimulai dari 0) -> columnIndex baru = 0
//   P8: currentVariables tidak kosong                            -> columnIndex baru = max+1
//   P9: value hasil normalisasi "" (null) tidak ikut disimpan ke newVariableUpdates
// =============================================================================
describe("saveKnnVariablesToDataViewer — basis path testing (V(G)=15)", () => {
  beforeEach(() => {
    mockAddVariables.mockClear();
    mockUpdateCells.mockClear();
    mockVariableStoreState.variables = [];
  });

  it("P1: savedVariables null -> tidak melakukan apa pun", async () => {
    await saveKnnVariablesToDataViewer(null, false);
    const ok = mockAddVariables.mock.calls.length === 0 && mockUpdateCells.mock.calls.length === 0;
    expect(mockAddVariables).not.toHaveBeenCalled();
    expect(mockUpdateCells).not.toHaveBeenCalled();
    record("saveKnnVariablesToDataViewer", "P1: savedVariables null", ok ? "PASS" : "FAIL");
  });

  it("P2: savedVariables.variables = [] -> tidak melakukan apa pun", async () => {
    await saveKnnVariablesToDataViewer({ variables: [] }, false);
    const ok = mockAddVariables.mock.calls.length === 0 && mockUpdateCells.mock.calls.length === 0;
    expect(mockAddVariables).not.toHaveBeenCalled();
    record("saveKnnVariablesToDataViewer", "P2: variables kosong", ok ? "PASS" : "FAIL");
  });

  it("P3+P7: variabel baru non-STRING, currentVariables kosong -> columnIndex 0, role='none'", async () => {
    await saveKnnVariablesToDataViewer(
      {
        variables: [
          {
            name: "KNN_PredictedValue",
            label: "Predicted",
            variable_type: "NUMERIC",
            measure: "scale",
            decimals: 2,
            values: [1, 2, 3],
          },
        ],
      },
      false,
    );
    expect(mockAddVariables).toHaveBeenCalledTimes(1);
    const [defs] = mockAddVariables.mock.calls[0];
    const def = defs[0];
    const ok = def.columnIndex === 0 && def.width === 12 && def.align === "right" && def.role === "none";
    expect(def.columnIndex).toBe(0);
    expect(def.width).toBe(12);
    expect(def.align).toBe("right");
    expect(def.role).toBe("none");
    record("saveKnnVariablesToDataViewer", "P3+P7: baru non-STRING, columnIndex 0", ok ? "PASS" : "FAIL");
  });

  it("P4: variabel baru bertipe STRING -> width=64, align='left'", async () => {
    await saveKnnVariablesToDataViewer(
      {
        variables: [
          { name: "KNN_Label", label: "Label", variable_type: "STRING", measure: "nominal", decimals: 0, values: ["a"] },
        ],
      },
      false,
    );
    const [defs] = mockAddVariables.mock.calls[0];
    const ok = defs[0].width === 64 && defs[0].align === "left";
    expect(defs[0].width).toBe(64);
    expect(defs[0].align).toBe("left");
    record("saveKnnVariablesToDataViewer", "P4: STRING width/align", ok ? "PASS" : "FAIL");
  });

  it("P5: nama variabel 'KNN_Partition' -> role='partition'", async () => {
    await saveKnnVariablesToDataViewer(
      {
        variables: [
          { name: "KNN_Partition", label: "Partition", variable_type: "NUMERIC", measure: "nominal", decimals: 0, values: [1] },
        ],
      },
      false,
    );
    const [defs] = mockAddVariables.mock.calls[0];
    const ok = defs[0].role === "partition";
    expect(defs[0].role).toBe("partition");
    record("saveKnnVariablesToDataViewer", "P5: role partition", ok ? "PASS" : "FAIL");
  });

  it("P5b (tambahan): nama variabel 'KNN_Fold' -> role='partition' (operand kedua operator ||)", async () => {
    await saveKnnVariablesToDataViewer(
      {
        variables: [
          { name: "KNN_Fold", label: "Fold", variable_type: "NUMERIC", measure: "nominal", decimals: 0, values: [1] },
        ],
      },
      false,
    );
    const [defs] = mockAddVariables.mock.calls[0];
    const ok = defs[0].role === "partition";
    expect(defs[0].role).toBe("partition");
    record("saveKnnVariablesToDataViewer", "P5b: role partition via KNN_Fold (operand ke-2 ||)", ok ? "PASS" : "FAIL");
  });

  it("P6+P8: variabel sudah ada & useCustomNames=true -> updateCells (bukan addVariables), columnIndex existing dipakai", async () => {
    mockVariableStoreState.variables = [
      { name: "KNN_PredictedValue", columnIndex: 5 } as Variable,
    ];
    await saveKnnVariablesToDataViewer(
      {
        variables: [
          {
            name: "KNN_PredictedValue",
            label: "Predicted",
            variable_type: "NUMERIC",
            measure: "scale",
            decimals: 2,
            values: [10, 20],
          },
        ],
      },
      true,
    );
    expect(mockAddVariables).not.toHaveBeenCalled();
    expect(mockUpdateCells).toHaveBeenCalledTimes(1);
    const [updates] = mockUpdateCells.mock.calls[0];
    const ok = updates.every((u: { col: number }) => u.col === 5) && updates.length === 2;
    expect(ok).toBe(true);
    record("saveKnnVariablesToDataViewer", "P6+P8: existing variable -> updateCells", ok ? "PASS" : "FAIL");
  });

  it("P9: nilai null/undefined pada variabel baru dinormalisasi jadi '' dan TIDAK ikut disimpan", async () => {
    await saveKnnVariablesToDataViewer(
      {
        variables: [
          {
            name: "KNN_Optional",
            label: "Optional",
            variable_type: "NUMERIC",
            measure: "scale",
            decimals: 0,
            values: [5, null, undefined],
          },
        ],
      },
      false,
    );
    expect(mockAddVariables).toHaveBeenCalledTimes(1);
    const [, updates] = mockAddVariables.mock.calls[0];
    const ok = updates.length === 1 && updates[0].row === 0 && updates[0].value === 5;
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ row: 0, value: 5 });
    record("saveKnnVariablesToDataViewer", "P9: null/undefined tidak disimpan", ok ? "PASS" : "FAIL");
  });
});

// =============================================================================
// 8) analyzeKNN({configData, dataVariables, variables}) -> orkestrasi utama
//    Badan fungsi (di luar closure worker)  V(G) = 7
//    Closure worker.onmessage               V(G) = 6
//    Closure worker.onerror                 V(G) = 1
//
// Independent paths yang diuji end-to-end lewat mock Worker:
//   P1: TargetVar & FocalCaseIdenVar kosong (null) -> ternary/?? sisi "default"
//       diambil semua; worker sukses -> resultNearestNeighbor terpanggil, resolve()
//   P2: TargetVar & FocalCaseIdenVar terisi -> sisi lain dari ternary; worker sukses
//   P3: worker mengirim {success:false} -> reject dengan error dari worker
//   P4: hasil worker sudah berupa ResultJson (isResultJson=true) -> tidak lewat
//       transformNearestNeighborResult
//   P5: hasil worker BUKAN ResultJson -> lewat transformNearestNeighborResult
//   P6: tidak ada tabel analisis DAN ada worker error -> reject (worker.terminate())
//   P7: worker.onerror terpanggil -> reject dengan pesan error
//   P8: exception dilempar di dalam onmessage (try/catch) -> reject via catch
// =============================================================================
describe("analyzeKNN — basis path testing (badan fungsi V(G)=7, onmessage V(G)=6, onerror V(G)=1)", () => {
  let mockPostMessage: jest.Mock;
  let mockTerminate: jest.Mock;
  let workerOnMessage: (event: { data: unknown }) => void;
  let workerOnError: (event: { message?: string }) => void;

  beforeEach(() => {
    mockGetSlicedData.mockReset().mockImplementation(({ selectedVariables }: { selectedVariables: string[] }) =>
      selectedVariables.length ? [[{ [selectedVariables[0]]: 1 }]] : [],
    );
    mockGetVarDefs.mockReset().mockImplementation((_vars: unknown, names: string[]) =>
      (names ?? []).map(() => [{ name: "def" }]),
    );
    mockTransformNearestNeighborResult.mockReset().mockReturnValue({ tables: [{ key: "case_processing_summary" }] });
    mockResultNearestNeighbor.mockReset().mockResolvedValue(undefined);
    mockAddVariables.mockReset().mockResolvedValue(undefined);
    mockUpdateCells.mockReset().mockResolvedValue(undefined);

    mockPostMessage = jest.fn();
    mockTerminate = jest.fn();
    (global as unknown as { Worker: unknown }).Worker = jest.fn().mockImplementation(() => {
      let _onmessage: ((e: { data: unknown }) => void) | null = null;
      let _onerror: ((e: { message?: string }) => void) | null = null;
      const instance: Record<string, unknown> = { postMessage: mockPostMessage, terminate: mockTerminate };
      Object.defineProperty(instance, "onmessage", {
        get: () => _onmessage,
        set: (fn) => {
          _onmessage = fn;
          workerOnMessage = fn;
        },
      });
      Object.defineProperty(instance, "onerror", {
        get: () => _onerror,
        set: (fn) => {
          _onerror = fn;
          workerOnError = fn;
        },
      });
      return instance;
    });
  });

  const variables: Variable[] = [
    { name: "target", columnIndex: 0, type: "NUMERIC", width: 8, decimals: 0, label: "", values: [], missing: null, columns: 8, align: "right", measure: "scale", role: "input" },
    { name: "feat1", columnIndex: 1, type: "NUMERIC", width: 8, decimals: 0, label: "", values: [], missing: null, columns: 8, align: "right", measure: "scale", role: "input" },
  ];
  const dataVariables: unknown[] = [];

  it("P1: TargetVar & FocalCaseIdenVar kosong -> sukses, resultNearestNeighbor terpanggil", async () => {
    const cfg = makeConfig({ main: { TargetVar: null, FocalCaseIdenVar: null } });
    const promise = analyzeKNN({ configData: cfg, dataVariables, variables } as KNNAnalysisType);
    workerOnMessage({
      data: {
        success: true,
        data: { tables: [{ key: "case_processing_summary" }] },
        errors: "No errors occurred.",
        saved_variables: null,
      },
    });
    await promise;
    const ok = mockResultNearestNeighbor.mock.calls.length === 1;
    expect(mockResultNearestNeighbor).toHaveBeenCalledTimes(1);
    record("analyzeKNN", "P1: TargetVar/Focal kosong, sukses", ok ? "PASS" : "FAIL");
  });

  it("P2: TargetVar & FocalCaseIdenVar terisi -> sukses", async () => {
    const cfg = makeConfig({ main: { TargetVar: "target", FocalCaseIdenVar: "feat1" } });
    const promise = analyzeKNN({ configData: cfg, dataVariables, variables } as KNNAnalysisType);
    workerOnMessage({
      data: {
        success: true,
        data: { tables: [{ key: "case_processing_summary" }] },
        errors: "No errors occurred.",
        saved_variables: null,
      },
    });
    await promise;
    const ok = mockPostMessage.mock.calls.length === 1;
    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    record("analyzeKNN", "P2: TargetVar/Focal terisi, sukses", ok ? "PASS" : "FAIL");
  });

  it("P3: worker mengembalikan success=false -> promise reject", async () => {
    const cfg = makeConfig();
    const promise = analyzeKNN({ configData: cfg, dataVariables, variables } as KNNAnalysisType);
    workerOnMessage({ data: { success: false, error: "Worker gagal memproses data." } });
    let caught: Error | null = null;
    try {
      await promise;
    } catch (err) {
      caught = err as Error;
    }
    const ok = caught?.message === "Worker gagal memproses data.";
    expect(caught?.message).toBe("Worker gagal memproses data.");
    record("analyzeKNN", "P3: success=false -> reject", ok ? "PASS" : "FAIL");
  });

  it("P4: hasil worker sudah ResultJson (punya .tables array) -> tidak lewat transformNearestNeighborResult", async () => {
    const cfg = makeConfig();
    const promise = analyzeKNN({ configData: cfg, dataVariables, variables } as KNNAnalysisType);
    workerOnMessage({
      data: {
        success: true,
        data: { tables: [{ key: "case_processing_summary" }] },
        errors: "No errors occurred.",
        saved_variables: null,
      },
    });
    await promise;
    const ok = mockTransformNearestNeighborResult.mock.calls.length === 0;
    expect(mockTransformNearestNeighborResult).not.toHaveBeenCalled();
    record("analyzeKNN", "P4: isResultJson=true, skip transform", ok ? "PASS" : "FAIL");
  });

  it("P5: hasil worker BUKAN ResultJson -> lewat transformNearestNeighborResult", async () => {
    const cfg = makeConfig();
    const promise = analyzeKNN({ configData: cfg, dataVariables, variables } as KNNAnalysisType);
    workerOnMessage({
      data: {
        success: true,
        data: { rawShape: "raw-worker-output" },
        errors: "No errors occurred.",
        saved_variables: null,
      },
    });
    await promise;
    const ok = mockTransformNearestNeighborResult.mock.calls.length === 1;
    expect(mockTransformNearestNeighborResult).toHaveBeenCalledTimes(1);
    record("analyzeKNN", "P5: isResultJson=false, pakai transform", ok ? "PASS" : "FAIL");
  });

  it("P6: tidak ada tabel analisis DAN ada worker error -> reject + worker.terminate()", async () => {
    const cfg = makeConfig();
    const promise = analyzeKNN({ configData: cfg, dataVariables, variables } as KNNAnalysisType);
    workerOnMessage({
      data: {
        success: true,
        data: { tables: [{ key: "system_settings" }] },
        errors: "Error: data tidak cukup untuk analisis.",
        saved_variables: null,
      },
    });
    let caught: Error | null = null;
    try {
      await promise;
    } catch (err) {
      caught = err as Error;
    }
    const ok = caught?.message === "Error: data tidak cukup untuk analisis." && mockTerminate.mock.calls.length > 0;
    expect(caught?.message).toBe("Error: data tidak cukup untuk analisis.");
    expect(mockTerminate).toHaveBeenCalled();
    record("analyzeKNN", "P6: no analysis table + worker error -> reject", ok ? "PASS" : "FAIL");
  });

  it("P7: worker.onerror terpanggil -> reject dengan pesan error", async () => {
    const cfg = makeConfig();
    const promise = analyzeKNN({ configData: cfg, dataVariables, variables } as KNNAnalysisType);
    workerOnError({ message: "Worker crash." });
    let caught: Error | null = null;
    try {
      await promise;
    } catch (err) {
      caught = err as Error;
    }
    const ok = caught?.message === "Worker crash.";
    expect(caught?.message).toBe("Worker crash.");
    record("analyzeKNN", "P7: worker.onerror -> reject", ok ? "PASS" : "FAIL");
  });

  it("P8: exception di dalam onmessage (mis. resultNearestNeighbor melempar error) -> ditangkap try/catch, reject", async () => {
    mockResultNearestNeighbor.mockRejectedValueOnce(new Error("Gagal merender hasil."));
    const cfg = makeConfig();
    const promise = analyzeKNN({ configData: cfg, dataVariables, variables } as KNNAnalysisType);
    workerOnMessage({
      data: {
        success: true,
        data: { tables: [{ key: "case_processing_summary" }] },
        errors: "No errors occurred.",
        saved_variables: null,
      },
    });
    let caught: Error | null = null;
    try {
      await promise;
    } catch (err) {
      caught = err as Error;
    }
    const ok = caught?.message === "Gagal merender hasil." && mockTerminate.mock.calls.length > 0;
    expect(caught?.message).toBe("Gagal merender hasil.");
    record("analyzeKNN", "P8: exception in onmessage -> catch -> reject", ok ? "PASS" : "FAIL");
  });

  it("P9 (tambahan): FeatureVar null -> operator ?? memakai fallback array kosong", async () => {
    const cfg = makeConfig({ main: { FeatureVar: null } });
    const promise = analyzeKNN({ configData: cfg, dataVariables, variables } as KNNAnalysisType);
    workerOnMessage({
      data: {
        success: true,
        data: { tables: [{ key: "case_processing_summary" }] },
        errors: "No errors occurred.",
        saved_variables: null,
      },
    });
    await promise;
    const featuresCallArgs = mockGetSlicedData.mock.calls[1][0] as { selectedVariables: string[] };
    const ok = Array.isArray(featuresCallArgs.selectedVariables) && featuresCallArgs.selectedVariables.length === 0;
    expect(featuresCallArgs.selectedVariables).toEqual([]);
    record("analyzeKNN", "P9: FeatureVar null -> ?? fallback []", ok ? "PASS" : "FAIL");
  });

  it("P10 (tambahan): CaseIdenVar terisi -> ternary caseData bernilai true (data dikirim, bukan null)", async () => {
    const cfg = makeConfig({ main: { CaseIdenVar: "id" } });
    const promise = analyzeKNN({ configData: cfg, dataVariables, variables } as KNNAnalysisType);
    workerOnMessage({
      data: {
        success: true,
        data: { tables: [{ key: "case_processing_summary" }] },
        errors: "No errors occurred.",
        saved_variables: null,
      },
    });
    await promise;
    const [payload] = mockPostMessage.mock.calls[0] as [{ caseData: unknown }];
    const ok = payload.caseData !== null;
    expect(payload.caseData).not.toBeNull();
    record("analyzeKNN", "P10: CaseIdenVar terisi -> caseData ternary true", ok ? "PASS" : "FAIL");
  });

  it("P11 (tambahan): tidak ada tabel analisis TAPI tidak ada worker error -> tetap lanjut (tidak reject)", async () => {
    const cfg = makeConfig();
    const promise = analyzeKNN({ configData: cfg, dataVariables, variables } as KNNAnalysisType);
    workerOnMessage({
      data: {
        success: true,
        data: { tables: [{ key: "system_settings" }] },
        errors: "No errors occurred.",
        saved_variables: null,
      },
    });
    await promise;
    const ok = mockResultNearestNeighbor.mock.calls.length === 1;
    expect(mockResultNearestNeighbor).toHaveBeenCalledTimes(1);
    record("analyzeKNN", "P11: hasAnalysisTables=false & hasWorkerErrors=false -> lanjut", ok ? "PASS" : "FAIL");
  });
});

// ---------------------------------------------------------------------------
// LAPORAN AKHIR PENGUJIAN BASIS PATH
// ---------------------------------------------------------------------------
afterAll(() => {
  const total = results.length;
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = total - passed;

  // eslint-disable-next-line no-console
  console.log("\n============================================================");
  console.log(" HASIL AKHIR WHITE-BOX BASIS PATH TESTING — nearest-neighbor-analysis.ts");
  console.log("============================================================");
  const byFn = new Map<string, PathResult[]>();
  for (const r of results) {
    if (!byFn.has(r.fn)) byFn.set(r.fn, []);
    byFn.get(r.fn)!.push(r);
  }
  for (const [fn, paths] of byFn) {
    console.log(`\n${fn}  (${paths.filter((p) => p.status === "PASS").length}/${paths.length} path lulus)`);
    for (const p of paths) {
      console.log(`  [${p.status}] ${p.path}`);
    }
  }
  console.log("\n------------------------------------------------------------");
  console.log(`TOTAL INDEPENDENT PATH DIUJI : ${total}`);
  console.log(`LULUS                        : ${passed}`);
  console.log(`GAGAL                        : ${failed}`);
  console.log(`STATUS AKHIR                 : ${failed === 0 ? "SEMUA PATH TERCAKUP DAN LULUS" : "ADA PATH YANG GAGAL"}`);
  console.log("============================================================\n");
});
