// AGENTS.md §4.1, §6.3, §6.6, §6.7 — test pemuat model (PLAN.md Fase 5).
// Store & fetch di-mock (pola KNN/services/__tests__/nearest-neighbor-analysis.test.ts).

import type { Log, Statistic } from "@/types/Result";
import type {
  ModelLoadResult,
} from "@/components/Modals/Analyze/Classify/apply-model/services/model-loader";
import type { BuiltinModelEntry } from "@/components/Modals/Analyze/Classify/apply-model/constants/builtin-models";

// ---------------------------------------------------------------------------
// Mocks (di-hoist Jest; variabel diawali `mock` agar boleh dirujuk factory)
// ---------------------------------------------------------------------------

const mockLoadResults = jest.fn();
const mockStoreState: { logs: Log[]; loadResults: jest.Mock } = {
  logs: [],
  loadResults: mockLoadResults,
};
jest.mock("@/stores/useResultStore", () => ({
  useResultStore: { getState: jest.fn(() => mockStoreState) },
}));

// Array yang sama dimutasi per test (katalog nyata = kosong, §6.7).
const mockBuiltinModels: BuiltinModelEntry[] = [];
jest.mock(
  "@/components/Modals/Analyze/Classify/apply-model/constants/builtin-models",
  () => ({
    // getter: dibaca saat dipakai, bukan saat modul di-require (hindari TDZ).
    get BUILTIN_MODELS() {
      return mockBuiltinModels;
    },
  })
);

import {
  MAX_MODEL_FILE_BYTES,
  listResultStoreModels,
  loadBuiltinModel,
  loadModelFromFile,
  loadModelFromResultStore,
} from "@/components/Modals/Analyze/Classify/apply-model/services/model-loader";

// Fixture dimuat via require: tsconfig `composite: true` tidak mengizinkan
// import JSON via path alias (TS6307).
const nbModelV11 = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v1_1.json") as Record<string, unknown>;
const nbModelV10 = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v1_0.json") as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

const D1_TRAINED_AT = "2026-10-01T00:00:00.000Z";

function clone(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function makeFile(name: string, content: string, size?: number): File {
  return {
    name,
    size: size ?? content.length,
    text: async () => content,
  } as unknown as File;
}

function expectFailure(
  result: ModelLoadResult,
  code: string,
  detail?: string
): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected load to fail, but it succeeded");
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0].code).toBe(code);
  expect(result.errors[0].severity).toBe("error");
  if (detail !== undefined) {
    expect(result.errors[0].detail).toBe(detail);
  }
}

function modelStatistic(id: number, model: unknown) {
  return {
    id,
    title: "Export Model",
    description: "Export Model",
    output_data: JSON.stringify({ naiveBayesTrainedModel: model }),
    components: "Export Model",
  };
}

function otherStatistic(id: number) {
  return {
    id,
    title: "Case Processing Summary",
    description: "Case Processing Summary",
    output_data: { tables: [] },
    components: "Case Processing Summary",
  };
}

function makeLog(
  id: number,
  logName: string,
  analyticTitle: string,
  statistics: Statistic[]
): Log {
  return {
    id,
    log: logName,
    analytics: [{ id, logId: id, title: analyticTitle, note: "", statistics }],
  };
}

function okResponse(body: string) {
  return { ok: true, status: 200, text: async () => body };
}

const originalFetch = global.fetch;
const mockFetch = jest.fn();

beforeEach(() => {
  mockStoreState.logs = [];
  mockLoadResults.mockReset();
  mockBuiltinModels.length = 0;
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// loadModelFromFile (§4.1 File, §6.3)
// ---------------------------------------------------------------------------

describe("loadModelFromFile", () => {
  it("D1 (schema 1.1) → ok, tanpa warning, label sumber 'File: <nama>'", async () => {
    const result = await loadModelFromFile(
      makeFile("nb-model-v1_1.json", JSON.stringify(nbModelV11))
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceRef).toBe("nb-model-v1_1.json");
    expect(result.sourceLabel).toBe("File: nb-model-v1_1.json");
    expect(result.descriptor.modelType).toBe("naive_bayes");
    expect(result.descriptor.schemaVersion).toBe("1.1");
    expect(result.descriptor.targetName).toBe("Play");
    expect(result.descriptor.classes).toEqual(["No", "Yes"]);
    expect(result.descriptor.warnings).toEqual([]);
    expect((result.model as Record<string, unknown>).model_type).toBe("naive_bayes");
  });

  it("D2 (schema 1.0) → ok dengan warning AM_W_LEGACY_SCHEMA", async () => {
    const result = await loadModelFromFile(
      makeFile("nb-model-v1_0.json", JSON.stringify(nbModelV10))
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.descriptor.schemaVersion).toBe("1.0");
    expect(result.descriptor.warnings).toEqual(["AM_W_LEGACY_SCHEMA"]);
  });

  it("ekstensi .JSON (huruf besar) diterima (case-insensitive)", async () => {
    const result = await loadModelFromFile(
      makeFile("MODEL.JSON", JSON.stringify(nbModelV11))
    );
    expect(result.ok).toBe(true);
  });

  it("file .txt → AM_E_PARSE", async () => {
    const result = await loadModelFromFile(
      makeFile("model.txt", JSON.stringify(nbModelV11))
    );
    expectFailure(result, "AM_E_PARSE", "model.txt");
  });

  it("ukuran 11 MB → AM_E_FILE_TOO_LARGE", async () => {
    const result = await loadModelFromFile(
      makeFile("big.json", JSON.stringify(nbModelV11), 11 * 1024 * 1024)
    );
    expectFailure(result, "AM_E_FILE_TOO_LARGE", "big.json");
  });

  it("ukuran tepat 10 MB masih diterima (batas inklusif)", async () => {
    const result = await loadModelFromFile(
      makeFile("edge.json", JSON.stringify(nbModelV11), MAX_MODEL_FILE_BYTES)
    );
    expect(result.ok).toBe(true);
  });

  it('isi "{bad" → AM_E_PARSE', async () => {
    const result = await loadModelFromFile(makeFile("bad.json", "{bad"));
    expectFailure(result, "AM_E_PARSE", "bad.json");
  });

  it("file.text() gagal dibaca → AM_E_PARSE", async () => {
    const file = {
      name: "unreadable.json",
      size: 10,
      text: async () => {
        throw new Error("read error");
      },
    } as unknown as File;
    expectFailure(await loadModelFromFile(file), "AM_E_PARSE", "unreadable.json");
  });

  it("JSON valid tetapi bukan objek → error validasi AM_E_NOT_OBJECT", async () => {
    const result = await loadModelFromFile(makeFile("arr.json", "[]"));
    expectFailure(result, "AM_E_NOT_OBJECT");
  });

  it('model_type "decision_tree" → AM_E_MODEL_TYPE_UNSUPPORTED dengan detail', async () => {
    const model = clone(nbModelV11);
    model.model_type = "decision_tree";
    const result = await loadModelFromFile(
      makeFile("dt.json", JSON.stringify(model))
    );
    expectFailure(result, "AM_E_MODEL_TYPE_UNSUPPORTED", "decision_tree");
  });
});

// ---------------------------------------------------------------------------
// Result store (§4.1, §6.2, §6.6)
// ---------------------------------------------------------------------------

describe("listResultStoreModels & loadModelFromResultStore", () => {
  it("1 statistic 'Export Model' + 1 statistic lain → list berisi 1 item; load → ok", async () => {
    mockStoreState.logs = [
      makeLog(1, "Naive Bayes", "Naive Bayes Analysis Result", [
        otherStatistic(10),
        modelStatistic(11, nbModelV11),
      ]),
    ];

    const items = await listResultStoreModels();
    expect(items).toEqual([
      {
        statisticId: 11,
        label: `Naive Bayes › Naive Bayes Analysis Result — ${D1_TRAINED_AT}`,
        modelType: "naive_bayes",
        trainedAt: D1_TRAINED_AT,
      },
    ]);

    const loaded = await loadModelFromResultStore(11);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.sourceRef).toBe("11");
    expect(loaded.sourceLabel).toBe(
      "Output Viewer: Naive Bayes › Naive Bayes Analysis Result (#11)"
    );
    expect(loaded.descriptor.targetName).toBe("Play");
    expect(loaded.descriptor.schemaVersion).toBe("1.1");
  });

  it("urutan hasil: id statistic menurun (terbaru dulu)", async () => {
    mockStoreState.logs = [
      makeLog(1, "Run A", "Analytic A", [modelStatistic(11, nbModelV11)]),
      makeLog(2, "Run B", "Analytic B", [modelStatistic(20, nbModelV10)]),
      makeLog(3, "Run C", "Analytic C", [modelStatistic(15, nbModelV11)]),
    ];
    const items = await listResultStoreModels();
    expect(items.map((item) => item.statisticId)).toEqual([20, 15, 11]);
  });

  it("output_data berupa objek (bukan string) tetap terbaca", async () => {
    mockStoreState.logs = [
      makeLog(1, "NB", "Result", [
        {
          id: 5,
          title: "Export Model",
          description: "",
          output_data: { naiveBayesTrainedModel: nbModelV11 },
          components: "Export Model",
        },
      ]),
    ];
    const items = await listResultStoreModels();
    expect(items).toHaveLength(1);
    expect(items[0].statisticId).toBe(5);
    expect((await loadModelFromResultStore(5)).ok).toBe(true);
  });

  it("statistic yang gagal parse / tanpa payload / tanpa id dilewati tanpa error", async () => {
    mockStoreState.logs = [
      makeLog(1, "NB", "Result", [
        {
          id: 1,
          title: "Export Model",
          description: "",
          output_data: "{bad",
          components: "Export Model",
        },
        {
          id: 2,
          title: "Export Model",
          description: "",
          output_data: JSON.stringify({ lainnya: 1 }),
          components: "Export Model",
        },
        {
          id: 3,
          title: "Export Model",
          description: "",
          output_data: JSON.stringify({ naiveBayesTrainedModel: "{bad" }),
          components: "Export Model",
        },
        {
          // tanpa id
          title: "Export Model",
          description: "",
          output_data: JSON.stringify({ naiveBayesTrainedModel: nbModelV11 }),
          components: "Export Model",
        },
        modelStatistic(4, nbModelV11),
      ]),
    ];
    const items = await listResultStoreModels();
    expect(items.map((item) => item.statisticId)).toEqual([4]);
  });

  it("payload berupa string JSON di dalam output_data juga di-parse", async () => {
    mockStoreState.logs = [
      makeLog(1, "NB", "Result", [
        {
          id: 7,
          title: "Export Model",
          description: "",
          output_data: JSON.stringify({
            naiveBayesTrainedModel: JSON.stringify(nbModelV11),
          }),
          components: "Export Model",
        },
      ]),
    ];
    expect((await listResultStoreModels()).map((i) => i.statisticId)).toEqual([7]);
    expect((await loadModelFromResultStore(7)).ok).toBe(true);
  });

  it("logs kosong → loadResults dipanggil tepat sekali, lalu hasilnya dipakai", async () => {
    mockLoadResults.mockImplementation(async () => {
      mockStoreState.logs = [
        makeLog(1, "NB", "Result", [modelStatistic(11, nbModelV11)]),
      ];
    });
    const items = await listResultStoreModels();
    expect(mockLoadResults).toHaveBeenCalledTimes(1);
    expect(items).toHaveLength(1);
  });

  it("logs tetap kosong setelah loadResults → list kosong, loadResults hanya sekali", async () => {
    mockLoadResults.mockResolvedValue(undefined);
    const items = await listResultStoreModels();
    expect(items).toEqual([]);
    expect(mockLoadResults).toHaveBeenCalledTimes(1);
  });

  it("logs sudah terisi → loadResults tidak dipanggil", async () => {
    mockStoreState.logs = [
      makeLog(1, "NB", "Result", [modelStatistic(11, nbModelV11)]),
    ];
    await listResultStoreModels();
    await loadModelFromResultStore(11);
    expect(mockLoadResults).not.toHaveBeenCalled();
  });

  it("loadModelFromResultStore: id tidak ada → AM_E_NO_MODEL", async () => {
    mockStoreState.logs = [
      makeLog(1, "NB", "Result", [modelStatistic(11, nbModelV11)]),
    ];
    expectFailure(await loadModelFromResultStore(99), "AM_E_NO_MODEL", "99");
  });

  it("loadModelFromResultStore: statistic bukan model → AM_E_NO_MODEL", async () => {
    mockStoreState.logs = [makeLog(1, "NB", "Result", [otherStatistic(10)])];
    expectFailure(await loadModelFromResultStore(10), "AM_E_NO_MODEL", "10");
  });

  it("loadModelFromResultStore: output_data rusak → AM_E_PARSE", async () => {
    mockStoreState.logs = [
      makeLog(1, "NB", "Result", [
        {
          id: 3,
          title: "Export Model",
          description: "",
          output_data: "{bad",
          components: "Export Model",
        },
      ]),
    ];
    expectFailure(await loadModelFromResultStore(3), "AM_E_PARSE", "3");
  });

  it('loadModelFromResultStore: model_type "svm" → AM_E_MODEL_TYPE_UNSUPPORTED', async () => {
    const model = clone(nbModelV11);
    model.model_type = "svm";
    mockStoreState.logs = [makeLog(1, "NB", "Result", [modelStatistic(8, model)])];
    expectFailure(await loadModelFromResultStore(8), "AM_E_MODEL_TYPE_UNSUPPORTED", "svm");
  });
});

// ---------------------------------------------------------------------------
// Built-in (§4.1, §6.7)
// ---------------------------------------------------------------------------

describe("loadBuiltinModel", () => {
  const entry: BuiltinModelEntry = {
    id: "demo-nb",
    label: "Demo NB",
    description: "Model contoh",
    modelType: "naive_bayes",
    path: "/models/classify/demo-nb.json",
  };

  it("katalog kosong: id apa pun → AM_E_BUILTIN_FETCH tanpa memanggil fetch", async () => {
    expectFailure(await loadBuiltinModel("demo-nb"), "AM_E_BUILTIN_FETCH", "demo-nb");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetch 404 → AM_E_BUILTIN_FETCH", async () => {
    mockBuiltinModels.push(entry);
    mockFetch.mockResolvedValue({ ok: false, status: 404, text: async () => "" });
    expectFailure(await loadBuiltinModel("demo-nb"), "AM_E_BUILTIN_FETCH", "demo-nb");
    expect(mockFetch).toHaveBeenCalledWith("/models/classify/demo-nb.json");
  });

  it("fetch menolak (jaringan gagal) → AM_E_BUILTIN_FETCH", async () => {
    mockBuiltinModels.push(entry);
    mockFetch.mockRejectedValue(new Error("network"));
    expectFailure(await loadBuiltinModel("demo-nb"), "AM_E_BUILTIN_FETCH", "demo-nb");
  });

  it("fetch D1 → ok, label 'Built-in: <label>', sourceRef = id entri", async () => {
    mockBuiltinModels.push(entry);
    mockFetch.mockResolvedValue(okResponse(JSON.stringify(nbModelV11)));
    const result = await loadBuiltinModel("demo-nb");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceRef).toBe("demo-nb");
    expect(result.sourceLabel).toBe("Built-in: Demo NB");
    expect(result.descriptor.modelType).toBe("naive_bayes");
  });

  it('isi "{bad" → AM_E_PARSE', async () => {
    mockBuiltinModels.push(entry);
    mockFetch.mockResolvedValue(okResponse("{bad"));
    expectFailure(await loadBuiltinModel("demo-nb"), "AM_E_PARSE", "demo-nb");
  });

  it("model_type di file ≠ entry.modelType → AM_E_MODEL_TYPE_UNSUPPORTED (detail = tipe di file)", async () => {
    mockBuiltinModels.push({ ...entry, modelType: "decision_tree" });
    mockFetch.mockResolvedValue(okResponse(JSON.stringify(nbModelV11)));
    expectFailure(
      await loadBuiltinModel("demo-nb"),
      "AM_E_MODEL_TYPE_UNSUPPORTED",
      "naive_bayes"
    );
  });

  it('model_type tak terdaftar di file ("svm") → AM_E_MODEL_TYPE_UNSUPPORTED dari validasi', async () => {
    const model = clone(nbModelV11);
    model.model_type = "svm";
    mockBuiltinModels.push(entry);
    mockFetch.mockResolvedValue(okResponse(JSON.stringify(model)));
    expectFailure(await loadBuiltinModel("demo-nb"), "AM_E_MODEL_TYPE_UNSUPPORTED", "svm");
  });
});
