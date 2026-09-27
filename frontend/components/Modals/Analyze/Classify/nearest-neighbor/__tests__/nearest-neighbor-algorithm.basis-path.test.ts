/** @jest-environment jsdom */

/**
 * WHITE-BOX TESTING — BASIS PATH TESTING (Jest, via modul WASM)
 * Target uji: LOGIKA PERHITUNGAN algoritma Nearest Neighbor itu sendiri
 * (cara sistem mengukur kedekatan antar data, memilih jumlah tetangga,
 * dan menentukan hasil prediksi) — bukan kode "penghubung" antarmuka.
 *
 * Setiap skenario di bawah adalah satu keputusan nyata yang akan diambil
 * pengguna saat mengonfigurasi analisis Nearest Neighbor (mis. memilih
 * metode jarak, jenis prediksi, dsb). Test menjalankan modul KNN yang
 * sesungguhnya (dikompilasi dari Rust ke WebAssembly) lewat Jest, dengan
 * data yang dirancang khusus agar hasil setiap skenario dapat dipastikan
 * secara pasti (bukan hanya "tidak error").
 */

import "@testing-library/jest-dom";
import fs from "fs";
import path from "path";
import init, {
  KNNAnalysis,
} from "@/components/Modals/Analyze/Classify/nearest-neighbor/rust/pkg/wasm";

const variableDefinition = (
  name: string,
  columnIndex: number,
  measure: "scale" | "nominal" = "scale",
) => ({
  id: columnIndex + 1,
  columnIndex,
  name,
  type: "NUMERIC",
  width: 8,
  decimals: 0,
  label: "",
  values: [],
  missing: [],
  columns: 8,
  align: "right",
  measure,
  role: "input",
});

const baseConfig = {
  main: {
    TargetVar: "target",
    FeatureVar: ["score"],
    CaseIdenVar: "case_id",
    FocalCaseIdenVar: null as string | null,
    NormCovar: false,
  },
  neighbors: {
    Specify: true,
    AutoSelection: false,
    SpecifyK: 1,
    MinK: null as number | null,
    MaxK: null as number | null,
    MetricEucli: true,
    MetricManhattan: false,
    Weight: false,
    PredictionsMean: true,
    PredictionsMedian: false,
  },
  features: {
    ForwardSelection: null,
    ForcedEntryVar: null,
    FeaturesToEvaluate: 0,
    ForcedFeatures: 0,
    PerformSelection: false,
    MaxReached: true,
    BelowMin: false,
    MaxToSelect: null,
    MinChange: 0.01,
  },
  partition: {
    SrcVar: null,
    PartitioningVariable: null,
    UseRandomly: false,
    UseVariable: false,
    VFoldPartitioningVariable: null,
    VFoldUseRandomly: false,
    VFoldUsePartitioningVar: false,
    TrainingNumber: 70,
    NumPartition: 2,
    SetSeed: false,
    Seed: null,
  },
  save: {
    AutoName: true,
    CustomName: false,
    MaxCatsToSave: null,
    HasTargetVar: false,
    IsCateTargetVar: false,
    RandomAssignToPartition: false,
    RandomAssignToFold: false,
  },
  output: {
    CaseSummary: false,
    FeatureSelectionSummary: false,
    KSelectionChart: false,
    PredictorSpace: false,
    PredictionResults: false,
    ConfusionMatrix: false,
    ShowNeighborDetail: true,
    ChartAndTable: true,
    ExportModelXML: false,
    XMLFilePath: null,
    ExportDistance: false,
    CreateDataset: false,
    WriteDataFile: false,
    NewDataFilePath: null,
    DatasetName: null,
  },
};

type DeepPartial<T> = { [K in keyof T]?: Partial<T[K]> };

function makeConfig(overrides: DeepPartial<typeof baseConfig> = {}) {
  return {
    main: { ...baseConfig.main, ...overrides.main },
    neighbors: { ...baseConfig.neighbors, ...overrides.neighbors },
    features: { ...baseConfig.features, ...overrides.features },
    partition: { ...baseConfig.partition, ...overrides.partition },
    save: { ...baseConfig.save, ...overrides.save },
    output: { ...baseConfig.output, ...overrides.output },
  };
}

type Row = Record<string, unknown>;

function createAnalysis(params: {
  targetData: Row[];
  featuresData: Row[][];
  caseData: Row[];
  targetDefs: ReturnType<typeof variableDefinition>[];
  featuresDefs: ReturnType<typeof variableDefinition>[][];
  caseDefs: ReturnType<typeof variableDefinition>[];
  config: ReturnType<typeof makeConfig>;
}) {
  return new KNNAnalysis(
    [params.targetData],
    params.featuresData,
    [],
    [params.caseData],
    [params.targetDefs],
    params.featuresDefs,
    [],
    [params.caseDefs],
    params.config,
  );
}

// Penampung hasil untuk laporan akhir
type ScenarioResult = { logika: string; skenario: string; status: "PASS" | "FAIL" };
const hasil: ScenarioResult[] = [];
function catat(logika: string, skenario: string, status: "PASS" | "FAIL") {
  hasil.push({ logika, skenario, status });
}

describe("Basis Path Testing — Logika Perhitungan Algoritma Nearest Neighbor", () => {
  beforeAll(async () => {
    const wasmPath = path.join(__dirname, "../rust/pkg/wasm_bg.wasm");
    const wasmBuffer = fs.readFileSync(wasmPath);
    await init({ module_or_path: wasmBuffer });
  });

  // ===========================================================================
  // LOGIKA 1 — Cara sistem menentukan hasil prediksi
  // Simpul: N1 Mulai -> N2 "Apakah variabel target berupa kategori?"
  //   -> [Ya] N3 "Ambil kategori terbanyak dari para tetangga (voting mayoritas)"
  //   -> [Tidak] N4 "Apakah pengguna memilih median?"
  //       -> [Ya] N5 "Ambil nilai tengah (median) para tetangga"
  //       -> [Tidak] N6 "Ambil nilai rata-rata (mean) para tetangga"
  //   -> N7 Selesai
  // 2 keputusan -> 3 kemungkinan jalur pengujian.
  // ===========================================================================
  describe("Logika 1: Penentuan hasil prediksi (kategori / median / rata-rata)", () => {
    const featuresDataNumeric: Row[][] = [
      [{ score: 0 }, { score: 5 }, { score: 10 }, { score: 100 }],
    ];
    const featuresDefsNumeric = [[variableDefinition("score", 1)]];
    const caseData: Row[] = [
      { case_id: 1 }, { case_id: 2 }, { case_id: 3 }, { case_id: 4 },
    ];
    const caseDefs = [variableDefinition("case_id", 2)];

    it("Skenario A: target berupa angka & pengguna memilih rata-rata (mean) -> hasil prediksi = rata-rata nilai 3 tetangga terdekat", () => {
      const analysis = createAnalysis({
        targetData: [{ target: 10 }, { target: 20 }, { target: 300 }, { target: 9999 }],
        featuresData: featuresDataNumeric,
        caseData,
        targetDefs: [variableDefinition("target", 0, "scale")],
        featuresDefs: featuresDefsNumeric,
        caseDefs,
        config: makeConfig({ neighbors: { SpecifyK: 3, PredictionsMean: true, PredictionsMedian: false } }),
      });
      const results = analysis.get_results();
      const focal = results.nearest_neighbors.focal_neighbor_sets.find((f: any) => f.focal_record === 4);

      const ok = results.nearest_neighbors.prediction_method === "Mean"
        && Math.abs((focal.predicted_value as number) - 110) < 1e-9;
      expect(results.nearest_neighbors.prediction_method).toBe("Mean");
      expect(focal.predicted_value).toBeCloseTo(110, 9);
      catat("Logika 1", "A: target numerik, metode rata-rata", ok ? "PASS" : "FAIL");
      analysis.free();
    });

    it("Skenario B: target berupa angka & pengguna memilih median -> hasil prediksi = nilai tengah dari 3 tetangga terdekat", () => {
      const analysis = createAnalysis({
        targetData: [{ target: 10 }, { target: 20 }, { target: 300 }, { target: 9999 }],
        featuresData: featuresDataNumeric,
        caseData,
        targetDefs: [variableDefinition("target", 0, "scale")],
        featuresDefs: featuresDefsNumeric,
        caseDefs,
        config: makeConfig({ neighbors: { SpecifyK: 3, PredictionsMean: false, PredictionsMedian: true } }),
      });
      const results = analysis.get_results();
      const focal = results.nearest_neighbors.focal_neighbor_sets.find((f: any) => f.focal_record === 4);

      const ok = results.nearest_neighbors.prediction_method === "Median" && focal.predicted_value === 20;
      expect(results.nearest_neighbors.prediction_method).toBe("Median");
      expect(focal.predicted_value).toBe(20);
      catat("Logika 1", "B: target numerik, metode median", ok ? "PASS" : "FAIL");
      analysis.free();
    });

    it("Skenario C: target berupa kategori -> hasil prediksi = kategori terbanyak di antara para tetangga (voting mayoritas)", () => {
      const analysis = createAnalysis({
        targetData: [{ target: "A" }, { target: "B" }, { target: "B" }, { target: "C" }],
        featuresData: featuresDataNumeric,
        caseData,
        targetDefs: [variableDefinition("target", 0, "nominal")],
        featuresDefs: featuresDefsNumeric,
        caseDefs,
        config: makeConfig({ neighbors: { SpecifyK: 3 } }),
      });
      const results = analysis.get_results();
      const focal = results.nearest_neighbors.focal_neighbor_sets.find((f: any) => f.focal_record === 4);

      const ok = results.nearest_neighbors.prediction_method == null && focal.predicted_value === "B";
      expect(results.nearest_neighbors.prediction_method).toBeFalsy();
      expect(focal.predicted_value).toBe("B");
      catat("Logika 1", "C: target kategori, voting mayoritas", ok ? "PASS" : "FAIL");
      analysis.free();
    });

    it("Skenario D (tambahan): jumlah tetangga GENAP & metode median -> hasil prediksi = rata-rata dua nilai tengah (bukan satu nilai tengah tunggal)", () => {
      const analysis = createAnalysis({
        targetData: [{ target: 10 }, { target: 20 }, { target: 300 }, { target: 400 }, { target: 9999 }],
        featuresData: [[{ score: 0 }, { score: 5 }, { score: 10 }, { score: 15 }, { score: 100 }]],
        caseData: [{ case_id: 1 }, { case_id: 2 }, { case_id: 3 }, { case_id: 4 }, { case_id: 5 }],
        targetDefs: [variableDefinition("target", 0, "scale")],
        featuresDefs: [[variableDefinition("score", 1)]],
        caseDefs: [variableDefinition("case_id", 2)],
        config: makeConfig({ neighbors: { SpecifyK: 4, PredictionsMean: false, PredictionsMedian: true } }),
      });
      const results = analysis.get_results();
      const focal = results.nearest_neighbors.focal_neighbor_sets.find((f: any) => f.focal_record === 5);

      // 4 tetangga -> target terurut [10,20,300,400] -> median = (20+300)/2 = 160
      const ok = focal.predicted_value === 160;
      expect(focal.predicted_value).toBe(160);
      catat("Logika 1", "D: median dengan jumlah tetangga genap", ok ? "PASS" : "FAIL");
      analysis.free();
    });
  });

  // ===========================================================================
  // LOGIKA 2 — Cara sistem mengukur kedekatan (jarak) antar data
  // Simpul: N1 Mulai -> N2 "Metode = Euclidean?"
  //   -> [Ya] N3 "Hitung jarak garis lurus (akar dari jumlah kuadrat selisih)"
  //   -> [Tidak] N4 "Hitung jarak blok kota (jumlah nilai mutlak selisih)"
  //   -> N5 Selesai. 1 keputusan -> 2 jalur.
  // ===========================================================================
  describe("Logika 2: Metode pengukuran jarak (Euclidean vs Manhattan)", () => {
    const targetData: Row[] = [{ target: 0 }, { target: 0 }];
    const targetDefs = [variableDefinition("target", 0, "scale")];
    const featuresData: Row[][] = [
      [{ featA: 0 }, { featA: 3 }],
      [{ featB: 0 }, { featB: 4 }],
    ];
    const featuresDefs = [[variableDefinition("featA", 1)], [variableDefinition("featB", 2)]];
    const caseData: Row[] = [{ case_id: 1 }, { case_id: 2 }];
    const caseDefs = [variableDefinition("case_id", 3)];

    it("Skenario A: metode Euclidean -> jarak dihitung sebagai garis lurus (di sini seharusnya = 5)", () => {
      const analysis = createAnalysis({
        targetData, featuresData, caseData, targetDefs, featuresDefs, caseDefs,
        config: makeConfig({ main: { FeatureVar: ["featA", "featB"] }, neighbors: { MetricEucli: true, MetricManhattan: false } }),
      });
      const results = analysis.get_results();
      const focal = results.nearest_neighbors.focal_neighbor_sets.find((f: any) => f.focal_record === 2);

      const ok = results.nearest_neighbors.distance_metric === "Euclidean" && Math.abs(focal.distances[0] - 5) < 1e-9;
      expect(results.nearest_neighbors.distance_metric).toBe("Euclidean");
      expect(focal.distances[0]).toBeCloseTo(5, 9);
      catat("Logika 2", "A: jarak Euclidean = 5", ok ? "PASS" : "FAIL");
      analysis.free();
    });

    it("Skenario B: metode Manhattan -> jarak dihitung sebagai jumlah selisih mutlak (di sini seharusnya = 7)", () => {
      const analysis = createAnalysis({
        targetData, featuresData, caseData, targetDefs, featuresDefs, caseDefs,
        config: makeConfig({ main: { FeatureVar: ["featA", "featB"] }, neighbors: { MetricEucli: false, MetricManhattan: true } }),
      });
      const results = analysis.get_results();
      const focal = results.nearest_neighbors.focal_neighbor_sets.find((f: any) => f.focal_record === 2);

      const ok = results.nearest_neighbors.distance_metric === "Manhattan" && Math.abs(focal.distances[0] - 7) < 1e-9;
      expect(results.nearest_neighbors.distance_metric).toBe("Manhattan");
      expect(focal.distances[0]).toBeCloseTo(7, 9);
      catat("Logika 2", "B: jarak Manhattan = 7", ok ? "PASS" : "FAIL");
      analysis.free();
    });
  });

  // ===========================================================================
  // LOGIKA 3 — Cara sistem menentukan jumlah tetangga (k)
  // Simpul: N1 Mulai -> N2 "Mode = otomatis?"
  //   -> [Ya] N3 "Uji beberapa nilai k, pilih yang error rata-ratanya paling kecil
  //             (jika seri, pilih k terkecil)"
  //   -> [Tidak] N4 "Pakai jumlah k yang ditentukan pengguna secara manual"
  //   -> N5 Selesai. 1 keputusan -> 2 jalur.
  // ===========================================================================
  describe("Logika 3: Penentuan jumlah tetangga / k (manual vs otomatis)", () => {
    it("Skenario A: k ditentukan manual -> sistem memakai persis jumlah yang diminta pengguna", () => {
      const analysis = createAnalysis({
        targetData: [{ target: 1 }, { target: 2 }, { target: 3 }],
        featuresData: [[{ score: 1 }, { score: 2 }, { score: 3 }]],
        caseData: [{ case_id: 1 }, { case_id: 2 }, { case_id: 3 }],
        targetDefs: [variableDefinition("target", 0, "scale")],
        featuresDefs: [[variableDefinition("score", 1)]],
        caseDefs: [variableDefinition("case_id", 2)],
        config: makeConfig({ neighbors: { Specify: true, AutoSelection: false, SpecifyK: 2 } }),
      });
      const results = analysis.get_results();

      const ok = results.nearest_neighbors.k_value === 2;
      expect(results.nearest_neighbors.k_value).toBe(2);
      catat("Logika 3", "A: k manual dipakai apa adanya", ok ? "PASS" : "FAIL");
      analysis.free();
    });

    it("Skenario B: k dipilih otomatis & seluruh pilihan k sama baiknya (error 0) -> sistem memilih k TERKECIL dalam rentang", () => {
      // Target konstan untuk semua baris supaya prediksi selalu tepat pada k berapa pun (error = 0 untuk semua k -> hasil seri).
      const rows = [10, 20, 30, 40, 50, 60];
      const analysis = createAnalysis({
        targetData: rows.map(() => ({ target: 50 })),
        featuresData: [rows.map((v) => ({ score: v }))],
        caseData: rows.map((_, i) => ({ case_id: i + 1 })),
        targetDefs: [variableDefinition("target", 0, "scale")],
        featuresDefs: [[variableDefinition("score", 1)]],
        caseDefs: [variableDefinition("case_id", 2)],
        config: makeConfig({
          neighbors: { Specify: false, AutoSelection: true, MinK: 1, MaxK: 3 },
          output: { KSelectionChart: true },
        }),
      });
      const results = analysis.get_results();
      const candidates = results.k_selection_chart.candidates as Array<{ k: number; average_error: number; selected: boolean }>;
      const semuaErrorNol = candidates.every((c) => Math.abs(c.average_error) < 1e-9);

      const ok = semuaErrorNol && results.k_selection_chart.selected_k === 1
        && candidates.find((c) => c.k === 1)?.selected === true;
      expect(semuaErrorNol).toBe(true);
      expect(results.k_selection_chart.selected_k).toBe(1);
      catat("Logika 3", "B: seri error -> pilih k terkecil", ok ? "PASS" : "FAIL");
      analysis.free();
    });
  });

  // ===========================================================================
  // LOGIKA 4 — Normalisasi variabel prediktor sebelum dihitung jaraknya
  // Simpul: N1 Mulai -> N2 "Normalisasi diaktifkan?"
  //   -> [Ya] N3 "Skalakan tiap variabel prediktor ke rentang yang sebanding
  //             berdasarkan data latih, baru hitung jarak"
  //   -> [Tidak] N4 "Hitung jarak langsung dari nilai asli (tanpa skala)"
  //   -> N5 Selesai. 1 keputusan -> 2 jalur.
  // Data dirancang agar tetangga terdekat BERBEDA tergantung normalisasi
  // diaktifkan atau tidak, sehingga efeknya benar-benar teruji.
  // ===========================================================================
  describe("Logika 4: Normalisasi variabel prediktor (aktif vs tidak)", () => {
    const targetData: Row[] = [{ target: 100 }, { target: 999 }, { target: 0 }];
    const targetDefs = [variableDefinition("target", 0, "scale")];
    // featA berskala kecil (0-1), featB berskala besar (0-100) -> tanpa
    // normalisasi, featB akan mendominasi perhitungan jarak.
    const featuresData: Row[][] = [
      [{ featA: 0 }, { featA: 1 }, { featA: 1 }],
      [{ featB: 49 }, { featB: 0 }, { featB: 50 }],
    ];
    const featuresDefs = [[variableDefinition("featA", 1)], [variableDefinition("featB", 2)]];
    const caseData: Row[] = [{ case_id: 1 }, { case_id: 2 }, { case_id: 3 }];
    const caseDefs = [variableDefinition("case_id", 3)];
    const cfg = (normCovar: boolean) => makeConfig({
      main: { FeatureVar: ["featA", "featB"], NormCovar: normCovar },
      neighbors: { MetricEucli: false, MetricManhattan: true, SpecifyK: 1 },
    });

    it("Skenario A: normalisasi NONAKTIF -> variabel berskala besar mendominasi, tetangga terdekat = case_id 1", () => {
      const analysis = createAnalysis({ targetData, featuresData, caseData, targetDefs, featuresDefs, caseDefs, config: cfg(false) });
      const results = analysis.get_results();
      const focal = results.nearest_neighbors.focal_neighbor_sets.find((f: any) => f.focal_record === 3);

      const ok = focal.neighbors[0].id === 1 && focal.predicted_value === 100;
      expect(focal.neighbors[0].id).toBe(1);
      expect(focal.predicted_value).toBe(100);
      catat("Logika 4", "A: tanpa normalisasi -> tetangga terdekat berubah", ok ? "PASS" : "FAIL");
      analysis.free();
    });

    it("Skenario B: normalisasi AKTIF -> setelah diskalakan sebanding, tetangga terdekat berubah menjadi case_id 2", () => {
      const analysis = createAnalysis({ targetData, featuresData, caseData, targetDefs, featuresDefs, caseDefs, config: cfg(true) });
      const results = analysis.get_results();
      const focal = results.nearest_neighbors.focal_neighbor_sets.find((f: any) => f.focal_record === 3);

      const ok = focal.neighbors[0].id === 2 && focal.predicted_value === 999;
      expect(focal.neighbors[0].id).toBe(2);
      expect(focal.predicted_value).toBe(999);
      catat("Logika 4", "B: dengan normalisasi -> tetangga terdekat berubah", ok ? "PASS" : "FAIL");
      analysis.free();
    });
  });

  // ===========================================================================
  // LOGIKA 5 — Pembobotan variabel prediktor (feature weighting)
  // Simpul: N1 Mulai -> N2 "Pembobotan diaktifkan?"
  //   -> [Ya] N3 "Hitung tingkat kepentingan tiap variabel prediktor, variabel
  //             yang lebih menentukan hasil diberi bobot lebih besar dalam jarak"
  //   -> [Tidak] N4 "Semua variabel prediktor diperlakukan sama pentingnya"
  //   -> N5 Selesai. 1 keputusan -> 2 jalur.
  // ===========================================================================
  describe("Logika 5: Pembobotan variabel prediktor (aktif vs tidak)", () => {
    // "informatif" berkorelasi langsung dengan target, "tidak_relevan" konstan
    // (tidak membawa informasi apa pun untuk membedakan satu kasus dari kasus lain).
    const targetVals = [10, 20, 30, 40, 50, 60];
    const targetData: Row[] = targetVals.map((v) => ({ target: v }));
    const targetDefs = [variableDefinition("target", 0, "scale")];
    const featuresData: Row[][] = [
      targetVals.map((v) => ({ informatif: v / 10 })),
      targetVals.map(() => ({ tidak_relevan: 7 })),
    ];
    const featuresDefs = [[variableDefinition("informatif", 1)], [variableDefinition("tidak_relevan", 2)]];
    const caseData: Row[] = targetVals.map((_, i) => ({ case_id: i + 1 }));
    const caseDefs = [variableDefinition("case_id", 3)];
    const cfg = (weight: boolean) => makeConfig({
      main: { FeatureVar: ["informatif", "tidak_relevan"] },
      neighbors: { Weight: weight, SpecifyK: 2 },
    });

    it("Skenario A: pembobotan AKTIF -> variabel yang informatif diberi bobot jauh lebih besar daripada variabel yang tidak relevan", () => {
      const analysis = createAnalysis({ targetData, featuresData, caseData, targetDefs, featuresDefs, caseDefs, config: cfg(true) });
      const results = analysis.get_results();
      const entries = results.predictor_importance.entries as Array<{ featureName: string; normalizedImportance: number }>;
      const bobotInformatif = entries.find((e) => e.featureName === "informatif")!.normalizedImportance;
      const bobotTidakRelevan = entries.find((e) => e.featureName === "tidak_relevan")!.normalizedImportance;

      const ok = results.nearest_neighbors.weighting_enabled === true && bobotInformatif > bobotTidakRelevan;
      expect(results.nearest_neighbors.weighting_enabled).toBe(true);
      expect(bobotInformatif).toBeGreaterThan(bobotTidakRelevan);
      catat("Logika 5", "A: variabel informatif mendapat bobot lebih besar", ok ? "PASS" : "FAIL");
      analysis.free();
    });

    it("Skenario B: pembobotan NONAKTIF -> seluruh variabel prediktor diperlakukan sama, jarak dihitung tanpa bobot", () => {
      const withWeight = createAnalysis({ targetData, featuresData, caseData, targetDefs, featuresDefs, caseDefs, config: cfg(true) }).get_results();
      const withoutWeight = createAnalysis({ targetData, featuresData, caseData, targetDefs, featuresDefs, caseDefs, config: cfg(false) }).get_results();

      const distA = withWeight.nearest_neighbors.focal_neighbor_sets[0].distances[0];
      const distB = withoutWeight.nearest_neighbors.focal_neighbor_sets[0].distances[0];

      const ok = withoutWeight.nearest_neighbors.weighting_enabled === false && Math.abs(distA - distB) > 1e-9;
      expect(withoutWeight.nearest_neighbors.weighting_enabled).toBe(false);
      expect(Math.abs(distA - distB)).toBeGreaterThan(1e-9);
      catat("Logika 5", "B: tanpa pembobotan -> jarak berbeda dari yang dibobot", ok ? "PASS" : "FAIL");
    });
  });

  // ===========================================================================
  // LOGIKA 6 — Penanganan dua kasus yang berjarak sama persis ke kasus fokus
  // Simpul: N1 Mulai -> N2 "Ada dua kasus atau lebih berjarak sama persis?"
  //   -> [Ya] N3 "Pilih kasus yang letaknya lebih akhir pada data asli"
  //   -> [Tidak] N4 "Urutkan berdasarkan jarak seperti biasa"
  //   -> N5 Selesai. 1 keputusan -> 2 jalur.
  // ===========================================================================
  describe("Logika 6: Penanganan hasil seri pada jarak antar kasus", () => {
    it("Skenario A: dua kasus latih berjarak sama persis ke kasus fokus -> sistem memilih kasus yang datanya lebih akhir", () => {
      const analysis = createAnalysis({
        targetData: [{ target: 0 }, { target: 100 }, { target: 200 }],
        featuresData: [[{ score: 5 }, { score: 0 }, { score: 0 }]],
        caseData: [{ case_id: 1 }, { case_id: 2 }, { case_id: 3 }],
        targetDefs: [variableDefinition("target", 0, "scale")],
        featuresDefs: [[variableDefinition("score", 1)]],
        caseDefs: [variableDefinition("case_id", 2)],
        config: makeConfig({ neighbors: { SpecifyK: 1 } }),
      });
      const results = analysis.get_results();
      const focal = results.nearest_neighbors.focal_neighbor_sets.find((f: any) => f.focal_record === 1);

      const ok = focal.neighbors[0].id === 3;
      expect(focal.neighbors[0].id).toBe(3);
      catat("Logika 6", "A: seri jarak -> data yang lebih akhir menang", ok ? "PASS" : "FAIL");
      analysis.free();
    });

    it("Skenario B: tidak ada kasus yang berjarak sama -> urutan tetangga mengikuti jarak sesungguhnya", () => {
      const analysis = createAnalysis({
        targetData: [{ target: 0 }, { target: 100 }, { target: 200 }],
        featuresData: [[{ score: 5 }, { score: 1 }, { score: 8 }]],
        caseData: [{ case_id: 1 }, { case_id: 2 }, { case_id: 3 }],
        targetDefs: [variableDefinition("target", 0, "scale")],
        featuresDefs: [[variableDefinition("score", 1)]],
        caseDefs: [variableDefinition("case_id", 2)],
        config: makeConfig({ neighbors: { SpecifyK: 1 } }),
      });
      const results = analysis.get_results();
      const focal = results.nearest_neighbors.focal_neighbor_sets.find((f: any) => f.focal_record === 1);

      // focal score=5; case_id 2 score=1 -> jarak 4; case_id 3 score=8 -> jarak 3 (lebih dekat, tidak ada seri).
      const ok = focal.neighbors[0].id === 3;
      expect(focal.neighbors[0].id).toBe(3);
      catat("Logika 6", "B: tanpa seri -> tetangga terdekat sesuai jarak asli", ok ? "PASS" : "FAIL");
      analysis.free();
    });
  });

  // ===========================================================================
  // LOGIKA 7 — Penanganan hasil seri pada voting kategori
  // Simpul: N1 Mulai -> N2 "Ada dua kategori atau lebih dgn jumlah suara sama
  //           sebagai suara terbanyak?"
  //   -> [Ya] N3 "Pilih kategori yang lebih dulu secara abjad"
  //   -> [Tidak] N4 "Pilih kategori dengan suara terbanyak"
  //   -> N5 Selesai. 1 keputusan -> 2 jalur.
  // ===========================================================================
  describe("Logika 7: Penanganan hasil seri pada voting kategori", () => {
    it("Skenario A: jumlah suara dua kategori sama banyak -> sistem memilih kategori yang lebih dulu secara abjad", () => {
      const analysis = createAnalysis({
        targetData: [{ target: "Z" }, { target: "B" }, { target: "A" }],
        featuresData: [[{ score: 5 }, { score: 1 }, { score: 9 }]],
        caseData: [{ case_id: 1 }, { case_id: 2 }, { case_id: 3 }],
        targetDefs: [variableDefinition("target", 0, "nominal")],
        featuresDefs: [[variableDefinition("score", 1)]],
        caseDefs: [variableDefinition("case_id", 2)],
        config: makeConfig({ neighbors: { SpecifyK: 2 } }),
      });
      const results = analysis.get_results();
      const focal = results.nearest_neighbors.focal_neighbor_sets.find((f: any) => f.focal_record === 1);

      const ok = focal.predicted_value === "A";
      expect(focal.predicted_value).toBe("A");
      catat("Logika 7", "A: seri suara -> kategori abjad awal menang", ok ? "PASS" : "FAIL");
      analysis.free();
    });

    it("Skenario B: satu kategori jelas lebih banyak suaranya -> kategori itulah yang dipilih (tanpa perlu aturan seri)", () => {
      const analysis = createAnalysis({
        targetData: [{ target: "Z" }, { target: "B" }, { target: "B" }],
        featuresData: [[{ score: 5 }, { score: 1 }, { score: 9 }]],
        caseData: [{ case_id: 1 }, { case_id: 2 }, { case_id: 3 }],
        targetDefs: [variableDefinition("target", 0, "nominal")],
        featuresDefs: [[variableDefinition("score", 1)]],
        caseDefs: [variableDefinition("case_id", 2)],
        config: makeConfig({ neighbors: { SpecifyK: 2 } }),
      });
      const results = analysis.get_results();
      const focal = results.nearest_neighbors.focal_neighbor_sets.find((f: any) => f.focal_record === 1);

      const ok = focal.predicted_value === "B";
      expect(focal.predicted_value).toBe("B");
      catat("Logika 7", "B: tanpa seri -> suara terbanyak menang", ok ? "PASS" : "FAIL");
      analysis.free();
    });
  });

  // ===========================================================================
  // LOGIKA 8 — Jumlah tetangga (k) yang diminta melebihi jumlah data latih
  // Simpul: N1 Mulai -> N2 "Apakah k yang diminta lebih besar dari jumlah
  //           data latih yang tersedia?"
  //   -> [Ya] N3 "Sesuaikan k secara otomatis menjadi jumlah data latih yang ada"
  //   -> [Tidak] N4 "Pakai k yang diminta apa adanya"
  //   -> N5 Selesai. 1 keputusan -> 2 jalur (jalur "Tidak" sudah diuji di
  //   Logika 3 Skenario A; di sini difokuskan pada jalur "Ya").
  // ===========================================================================
  describe("Logika 8: Permintaan jumlah tetangga melebihi data latih yang tersedia", () => {
    it("Skenario: k yang diminta (10) jauh lebih besar dari data latih yang ada -> sistem otomatis menurunkan k ke jumlah data yang tersedia", () => {
      const analysis = createAnalysis({
        targetData: [{ target: 1 }, { target: 2 }, { target: 3 }],
        featuresData: [[{ score: 1 }, { score: 2 }, { score: 3 }]],
        caseData: [{ case_id: 1 }, { case_id: 2 }, { case_id: 3 }],
        targetDefs: [variableDefinition("target", 0, "scale")],
        featuresDefs: [[variableDefinition("score", 1)]],
        caseDefs: [variableDefinition("case_id", 2)],
        // Hanya 3 baris data -> untuk tiap kasus fokus, data latih yang
        // tersisa (di luar dirinya sendiri) hanya 2 baris.
        config: makeConfig({ neighbors: { Specify: true, AutoSelection: false, SpecifyK: 10 } }),
      });
      const results = analysis.get_results();
      const focal = results.nearest_neighbors.focal_neighbor_sets[0];

      const ok = results.nearest_neighbors.k_value === 2 && focal.neighbors.length === 2;
      expect(results.nearest_neighbors.k_value).toBe(2);
      expect(focal.neighbors.length).toBe(2);
      catat("Logika 8", "k diminta > data latih -> otomatis disesuaikan", ok ? "PASS" : "FAIL");
      analysis.free();
    });
  });

  // ===========================================================================
  // LOGIKA 9 — Penanganan baris data dengan nilai kosong/tidak valid
  // Simpul: N1 Mulai -> N2 "Apakah nilai prediktor ATAU nilai target pada
  //           kasus ini kosong/tidak valid?"
  //   -> [Ya] N3 "Keluarkan kasus ini sepenuhnya dari analisis"
  //   -> [Tidak] N4 "Sertakan kasus ini dalam pencarian tetangga & prediksi"
  //   -> N5 Selesai. 1 keputusan -> 2 jalur.
  // ===========================================================================
  describe("Logika 9: Baris data dengan nilai kosong/tidak valid", () => {
    it("Skenario: satu kasus memiliki nilai prediktor kosong -> kasus itu otomatis dikeluarkan dari analisis, kasus lain tetap diproses normal", () => {
      const analysis = createAnalysis({
        targetData: [{ target: 10 }, { target: 20 }, { target: 30 }, { target: 40 }],
        featuresData: [[{ score: 1 }, { score: null }, { score: 3 }, { score: 4 }]],
        caseData: [{ case_id: 1 }, { case_id: 2 }, { case_id: 3 }, { case_id: 4 }],
        targetDefs: [variableDefinition("target", 0, "scale")],
        featuresDefs: [[variableDefinition("score", 1)]],
        caseDefs: [variableDefinition("case_id", 2)],
        config: makeConfig({ neighbors: { SpecifyK: 1 } }),
      });
      const results = analysis.get_results();
      const sets = results.nearest_neighbors.focal_neighbor_sets as Array<{ focal_record: number; neighbors: Array<{ id: number }> }>;
      const case2MasihMuncul = sets.some((s) => s.focal_record === 2)
        || sets.some((s) => s.neighbors.some((n) => n.id === 2));

      const ok = sets.length === 3 && !case2MasihMuncul;
      expect(sets.length).toBe(3);
      expect(case2MasihMuncul).toBe(false);
      catat("Logika 9", "kasus dgn nilai prediktor kosong -> dikeluarkan otomatis", ok ? "PASS" : "FAIL");
      analysis.free();
    });
  });

  afterAll(() => {
    const total = hasil.length;
    const lulus = hasil.filter((h) => h.status === "PASS").length;

    // eslint-disable-next-line no-console
    console.log("\n============================================================");
    console.log(" HASIL AKHIR — BASIS PATH TESTING LOGIKA ALGORITMA NEAREST NEIGHBOR");
    console.log("============================================================");
    const byLogika = new Map<string, ScenarioResult[]>();
    for (const h of hasil) {
      if (!byLogika.has(h.logika)) byLogika.set(h.logika, []);
      byLogika.get(h.logika)!.push(h);
    }
    for (const [logika, items] of byLogika) {
      console.log(`\n${logika} (${items.filter((i) => i.status === "PASS").length}/${items.length} skenario lulus)`);
      for (const item of items) {
        console.log(`  [${item.status}] ${item.skenario}`);
      }
    }
    console.log("\n------------------------------------------------------------");
    console.log(`TOTAL SKENARIO DIUJI : ${total}`);
    console.log(`LULUS                : ${lulus}`);
    console.log(`GAGAL                : ${total - lulus}`);
    console.log(`STATUS AKHIR         : ${total - lulus === 0 ? "SEMUA SKENARIO LOGIKA TERCAKUP DAN LULUS" : "ADA SKENARIO YANG GAGAL"}`);
    console.log("============================================================\n");
  });
});
