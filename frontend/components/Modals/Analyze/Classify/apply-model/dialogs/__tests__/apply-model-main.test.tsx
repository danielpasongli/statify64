// AGENTS.md §6.1, §6.5 — test RTL container Apply Model (PLAN.md Fase 15):
// tombol OK/Reset/Cancel/Help, persistensi IndexedDB "ApplyModel" dan reset
// parsial saat dataset berubah. IndexedDB memakai fake-indexeddb
// (jest.setup.ts); store, useModal, dan sonner di-mock.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Log } from "@/types/Result";
import type { Variable } from "@/types/Variable";
import ApplyModelMain, {
  formatApplyModelSuccessMessage,
  getVariablesFingerprint,
  mergeWithDefaults,
  reconcileForDatasetChange,
} from "@/components/Modals/Analyze/Classify/apply-model/dialogs/apply-model-main";
import { validateAnyModel } from "@/components/Modals/Analyze/Classify/apply-model/adapters/registry";
import { ApplyModelDefault } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-default";
import type { ApplyModelType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";
import { clearFormData, getFormData, saveFormData } from "@/hooks/useIndexedDB";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Mocks (di-hoist Jest; variabel diawali `mock` agar boleh dirujuk factory)
// ---------------------------------------------------------------------------

const mockStoreState: { logs: Log[]; loadResults: jest.Mock } = {
  logs: [],
  loadResults: jest.fn(),
};
jest.mock("@/stores/useResultStore", () => ({
  useResultStore: { getState: jest.fn(() => mockStoreState) },
}));

// Daftar variabel dataset aktif; diganti dengan array BARU untuk mensimulasikan
// perubahan dataset (lalu `rerender`).
let mockCurrentVariables: Variable[] = [];
jest.mock("@/stores/useVariableStore", () => ({
  useVariableStore: jest.fn((selector: (state: { variables: Variable[] }) => unknown) =>
    selector({ variables: mockCurrentVariables })
  ),
  processVariableName: (name: string, existingVariables: Array<{ name: string }>) => {
    const existingNames = existingVariables.map((v) => v.name.toLowerCase());
    let processedName = name;
    let counter = 1;
    while (existingNames.includes(processedName.toLowerCase())) {
      processedName = `${name}_${counter}`;
      counter++;
    }
    return { isValid: true, processedName };
  },
}));

// Isi dataset aktif yang dibaca container saat OK (`useDataStore.getState().data`).
const mockDataRows: string[][] = [
  ["Overcast", "85", "No"],
  ["Sunny", "71", "Yes"],
];
jest.mock("@/stores/useDataStore", () => ({
  useDataStore: { getState: jest.fn(() => ({ data: mockDataRows })) },
}));

// Orkestrator Fase 17 di-mock: test container hanya memeriksa pemanggilan &
// teks toast; pipeline-nya diuji di services/__tests__/apply-model-analysis.test.ts.
const mockApplyModel = jest.fn();
jest.mock(
  "@/components/Modals/Analyze/Classify/apply-model/services/apply-model-analysis",
  () => ({
    applyModel: (...args: unknown[]) => mockApplyModel(...args),
  })
);

const mockCloseModal = jest.fn();
jest.mock("@/hooks/useModal", () => ({
  useModal: () => ({ closeModal: mockCloseModal }),
}));

type MockPromiseOptions = {
  loading: string;
  success: (value: unknown) => string;
  error: (error: unknown) => string;
};
type MockPromiseCall = {
  promise: Promise<unknown>;
  options: MockPromiseOptions;
};
const mockPromiseCalls: MockPromiseCall[] = [];

// Factory memakai jest.fn langsung (bukan variabel `mock*` di luar): factory
// dievaluasi saat import pertama, sebelum deklarasi `const` di bawah berjalan.
jest.mock("sonner", () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
    info: jest.fn(),
    promise: jest.fn(),
  },
}));

// Fixture dimuat via require: tsconfig `composite: true` tidak mengizinkan
// import JSON via path alias (TS6307).
const nbModelV11 = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v1_1.json") as Record<string, unknown>;

// jsdom (Jest) tidak menyediakan `structuredClone`, padahal fake-indexeddb
// memakainya pada `put`. Polyfill khusus test ini (data form hanya JSON).
if (typeof globalThis.structuredClone === "undefined") {
  globalThis.structuredClone = <T,>(value: T): T =>
    JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

const mockToast = toast as unknown as {
  error: jest.Mock;
  success: jest.Mock;
  info: jest.Mock;
  promise: jest.Mock;
};

const DATASET_CHANGED_MESSAGE =
  "Dataset berubah — pemetaan variabel Apply Model disusun ulang.";

function makeVariable(
  name: string,
  measure: Variable["measure"],
  type: Variable["type"]
): Variable {
  return {
    columnIndex: 0,
    name,
    type,
    width: 8,
    decimals: 0,
    values: [],
    missing: null,
    columns: 8,
    align: "right",
    measure,
    role: "input",
  };
}

// Dataset D3 (PLAN.md §1).
function makeD3Variables(): Variable[] {
  return [
    makeVariable("Outlook", "nominal", "STRING"),
    makeVariable("Temp", "scale", "NUMERIC"),
    makeVariable("Play", "nominal", "STRING"),
  ];
}

function cloneDefault(): ApplyModelType {
  return JSON.parse(JSON.stringify(ApplyModelDefault)) as ApplyModelType;
}

function uploadD1(): void {
  const file = {
    name: "nb-model-v1_1.json",
    size: 100,
    text: async () => JSON.stringify(nbModelV11),
  } as unknown as File;
  fireEvent.change(screen.getByTestId("model-file-input"), {
    target: { files: [file] },
  });
}

// Hydration awal (baca IndexedDB) async; beri waktu sebelum berinteraksi.
async function flushHydration(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
}

async function renderAndLoadModel(onClose = jest.fn()) {
  const view = render(<ApplyModelMain onClose={onClose} />);
  await flushHydration();
  uploadD1();
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: "Variables" })).toBeEnabled()
  );
  return { ...view, onClose };
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockPromiseCalls.length = 0;
  mockToast.promise.mockImplementation(
    (promise: Promise<unknown>, options: MockPromiseOptions) => {
      mockPromiseCalls.push({ promise, options });
      // Tandai rejection sebagai ditangani agar test yang menolak promise
      // tidak gagal karena "unhandled rejection"; promise asli tetap reject.
      promise.catch(() => undefined);
      return promise;
    }
  );
  mockStoreState.logs = [];
  mockApplyModel.mockReset();
  mockApplyModel.mockResolvedValue({
    scoredRows: 5,
    finalNames: ["NB_PredictedValue", "NB_PredictedProbability"],
    warnings: [],
  });
  mockCurrentVariables = makeD3Variables();
  await clearFormData("ApplyModel");
});

// ---------------------------------------------------------------------------
// Fungsi murni container
// ---------------------------------------------------------------------------

describe("fungsi murni container", () => {
  it("formatApplyModelSuccessMessage sesuai AGENTS.md §6.1", () => {
    expect(
      formatApplyModelSuccessMessage({
        scoredRows: 5,
        finalNames: ["NB_PredictedValue", "NB_PredictedProbability"],
        warnings: [],
      })
    ).toBe(
      "Prediksi selesai: 5 baris diprediksi. Kolom baru: NB_PredictedValue, NB_PredictedProbability."
    );
  });

  it("getVariablesFingerprint tidak bergantung urutan variabel", () => {
    const vars = makeD3Variables();
    expect(getVariablesFingerprint(vars)).toBe(
      getVariablesFingerprint([...vars].reverse())
    );
    expect(getVariablesFingerprint(vars)).not.toBe(
      getVariablesFingerprint([...vars, makeVariable("X", "scale", "NUMERIC")])
    );
  });

  it("mergeWithDefaults: null → default; field hilang dilengkapi default", () => {
    expect(mergeWithDefaults(null)).toEqual(ApplyModelDefault);

    const merged = mergeWithDefaults({
      save: { SaveMaxProbability: false },
    } as unknown as Partial<ApplyModelType>);
    expect(merged.save.SaveMaxProbability).toBe(false);
    expect(merged.save.CustomNames).toEqual({
      PredictedValue: null,
      MaxProbability: null,
      ClassProbabilities: {},
    });
    expect(merged.output).toEqual(ApplyModelDefault.output);
    expect(merged.model.ModelJson).toBeNull();
  });

  it("mergeWithDefaults: ModelJson tersimpan yang tidak valid dibuang", () => {
    const saved = cloneDefault();
    saved.model.ModelJson = { ...nbModelV11, model_type: "svm" };
    saved.variables.FeatureMapping = { Outlook: "Outlook" };
    saved.output.ModelSummary = false;

    const merged = mergeWithDefaults(saved);

    expect(merged.model.ModelJson).toBeNull();
    expect(merged.variables).toEqual(ApplyModelDefault.variables);
    expect(merged.output.ModelSummary).toBe(false);
  });

  it("reconcileForDatasetChange: hanya variables & CustomNames direset, lalu auto-map", () => {
    const validation = validateAnyModel(nbModelV11);
    if (!validation.ok) throw new Error("Fixture D1 harus valid");
    const prev = cloneDefault();
    prev.model = {
      SourceKind: "file",
      SourceRef: "nb-model-v1_1.json",
      SourceLabel: "File: nb-model-v1_1.json",
      ModelJson: validation.model,
    };
    prev.variables = {
      FeatureMapping: { Outlook: null, Temp: null },
      ActualTargetVar: null,
    };
    prev.save = {
      ...prev.save,
      SaveClassProbabilities: true,
      NamePrefix: "XY",
      UseCustomNames: true,
      CustomNames: {
        PredictedValue: "A",
        MaxProbability: "B",
        ClassProbabilities: { No: "C" },
      },
    };
    prev.output.ModelSummary = false;

    const next = reconcileForDatasetChange(prev, makeD3Variables());

    expect(next.model).toEqual(prev.model);
    expect(next.output).toEqual(prev.output);
    expect(next.variables).toEqual({
      FeatureMapping: { Outlook: "Outlook", Temp: "Temp" },
      ActualTargetVar: "Play",
    });
    expect(next.save.CustomNames).toEqual(ApplyModelDefault.save.CustomNames);
    // Sisa pengaturan save dipertahankan.
    expect(next.save.SaveClassProbabilities).toBe(true);
    expect(next.save.NamePrefix).toBe("XY");
    expect(next.save.UseCustomNames).toBe(true);
  });

  it("reconcileForDatasetChange tanpa model → variables default", () => {
    const next = reconcileForDatasetChange(cloneDefault(), makeD3Variables());
    expect(next.variables).toEqual(ApplyModelDefault.variables);
  });
});

// ---------------------------------------------------------------------------
// Kriteria manual (a)–(e) PLAN.md Fase 15, versi otomatis
// ---------------------------------------------------------------------------

describe("ApplyModelMain — OK", () => {
  it("(a) OK disabled sebelum model dimuat; aktif setelah D1 dimuat", async () => {
    render(<ApplyModelMain onClose={jest.fn()} />);
    expect(screen.getByRole("button", { name: "OK" })).toBeDisabled();

    await flushHydration();
    uploadD1();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "OK" })).toBeEnabled()
    );
  });

  it("OK disabled bila mapping tidak lengkap (dataset tanpa variabel Temp)", async () => {
    mockCurrentVariables = [
      makeVariable("Outlook", "nominal", "STRING"),
      makeVariable("Play", "nominal", "STRING"),
    ];
    await renderAndLoadModel();

    expect(screen.getByRole("button", { name: "OK" })).toBeDisabled();
  });

  it("OK menutup panel, menyimpan form ke IndexedDB, memanggil applyModel, dan menjalankan toast.promise", async () => {
    const user = userEvent.setup();
    const { onClose } = await renderAndLoadModel();

    await user.click(screen.getByRole("button", { name: "OK" }));

    expect(mockCloseModal).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(mockPromiseCalls).toHaveLength(1);
    expect(mockPromiseCalls[0].options.loading).toBe(
      "Menerapkan model ke dataset..."
    );

    const summary = await mockPromiseCalls[0].promise;
    expect(mockApplyModel).toHaveBeenCalledTimes(1);
    const callArg = mockApplyModel.mock.calls[0][0] as {
      formData: ApplyModelType;
      variables: Variable[];
      dataVariables: string[][];
    };
    expect(callArg.formData.model.ModelJson).toEqual(nbModelV11);
    expect(callArg.formData.variables.FeatureMapping).toEqual({
      Outlook: "Outlook",
      Temp: "Temp",
    });
    expect(callArg.variables).toEqual(makeD3Variables());
    expect(callArg.dataVariables).toBe(mockDataRows);

    expect(mockPromiseCalls[0].options.success(summary)).toBe(
      "Prediksi selesai: 5 baris diprediksi. Kolom baru: NB_PredictedValue, NB_PredictedProbability."
    );

    const saved = (await getFormData("ApplyModel")) as ApplyModelType & {
      _variablesFingerprint?: string;
    };
    expect(saved.model.ModelJson).toEqual(nbModelV11);
    expect(saved.model.SourceLabel).toBe("File: nb-model-v1_1.json");
    expect(saved.variables.FeatureMapping).toEqual({
      Outlook: "Outlook",
      Temp: "Temp",
    });
    expect(saved.variables.ActualTargetVar).toBe("Play");
    expect(saved._variablesFingerprint).toBe(
      getVariablesFingerprint(makeD3Variables())
    );
  });

  it("pesan error toast memakai getUserFriendlyApplyModelError (kode AM_E_ dipetakan ke teks Indonesia)", async () => {
    const user = userEvent.setup();
    mockApplyModel.mockRejectedValueOnce(
      new Error("AM_E_SCHEMA_VERSION_UNSUPPORTED: 2.0")
    );
    await renderAndLoadModel();
    await user.click(screen.getByRole("button", { name: "OK" }));
    await expect(mockPromiseCalls[0].promise).rejects.toThrow(
      "AM_E_SCHEMA_VERSION_UNSUPPORTED: 2.0"
    );

    const { error } = mockPromiseCalls[0].options;
    expect(error(new Error("AM_E_SCHEMA_VERSION_UNSUPPORTED: 2.0"))).toBe(
      "Versi format model \"2.0\" tidak didukung. Versi yang didukung: 1.0, 1.1."
    );
    expect(error(new Error("sesuatu yang acak"))).toContain(
      "Penerapan model tidak dapat diselesaikan"
    );
  });
});

describe("ApplyModelMain — Cancel", () => {
  it("Cancel menutup panel tanpa menyimpan", async () => {
    const user = userEvent.setup();
    const { onClose } = await renderAndLoadModel();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockCloseModal).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockToast.promise).not.toHaveBeenCalled();
    expect(await getFormData("ApplyModel")).toBeNull();
  });
});

describe("ApplyModelMain — persistensi", () => {
  it("(b) setelah OK lalu buka lagi, model & mapping masih ada", async () => {
    const user = userEvent.setup();
    const first = await renderAndLoadModel();
    await user.click(screen.getByRole("button", { name: "OK" }));
    await mockPromiseCalls[0].promise;
    first.unmount();

    render(<ApplyModelMain onClose={jest.fn()} />);

    expect(await screen.findByTestId("model-summary-card")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Variables" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "OK" })).toBeEnabled();

    await user.click(screen.getByRole("tab", { name: "Variables" }));
    expect(await screen.findByTestId("mapping-status-Outlook")).toHaveTextContent("✓");
    expect(screen.getByTestId("mapping-status-Temp")).toHaveTextContent("✓");
    // Dataset sama → tidak ada toast "Dataset berubah".
    expect(mockToast.info).not.toHaveBeenCalled();
  });

  it("form tersimpan dengan fingerprint dataset lain → reset parsial: model & output tetap, mapping disusun ulang, toast info", async () => {
    const user = userEvent.setup();
    const saved = cloneDefault();
    saved.model = {
      SourceKind: "file",
      SourceRef: "nb-model-v1_1.json",
      SourceLabel: "File: nb-model-v1_1.json",
      ModelJson: nbModelV11,
    };
    saved.variables = {
      FeatureMapping: { Outlook: "Outlook", Temp: null },
      ActualTargetVar: null,
    };
    saved.output.ModelSummary = false;
    await saveFormData("ApplyModel", {
      ...saved,
      _variablesFingerprint: "fingerprint-lama",
    });

    render(<ApplyModelMain onClose={jest.fn()} />);

    expect(await screen.findByTestId("model-summary-card")).toBeInTheDocument();
    await waitFor(() =>
      expect(mockToast.info).toHaveBeenCalledWith(DATASET_CHANGED_MESSAGE)
    );

    await user.click(screen.getByRole("tab", { name: "Variables" }));
    expect(await screen.findByTestId("mapping-status-Temp")).toHaveTextContent("✓");
    expect(
      screen.getByRole("combobox", { name: "Actual target variable" })
    ).toHaveTextContent("Play");

    await user.click(screen.getByRole("tab", { name: "Output" }));
    expect(
      await screen.findByRole("checkbox", { name: "Model summary" })
    ).not.toBeChecked();
  });

  it("data tersimpan rusak (ModelJson tidak valid) → form default tanpa model", async () => {
    const saved = cloneDefault();
    saved.model.ModelJson = { ...nbModelV11, model_type: "svm" };
    await saveFormData("ApplyModel", {
      ...saved,
      _variablesFingerprint: getVariablesFingerprint(makeD3Variables()),
    });

    render(<ApplyModelMain onClose={jest.fn()} />);
    await flushHydration();

    expect(screen.queryByTestId("model-summary-card")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Variables" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "OK" })).toBeDisabled();
  });
});

describe("ApplyModelMain — Reset", () => {
  it("(c) Reset: semua default, tab Model aktif, data tersimpan dihapus, toast sukses", async () => {
    const user = userEvent.setup();
    await renderAndLoadModel();
    await user.click(screen.getByRole("button", { name: "OK" }));
    await mockPromiseCalls[0].promise;
    expect(await getFormData("ApplyModel")).not.toBeNull();

    await user.click(screen.getByRole("tab", { name: "Output" }));
    await user.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() =>
      expect(mockToast.success).toHaveBeenCalledWith(
        "Pengaturan Apply Model telah direset."
      )
    );
    expect(screen.getByRole("tab", { name: "Model" })).toHaveAttribute(
      "data-state",
      "active"
    );
    expect(screen.queryByTestId("model-summary-card")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Variables" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Output" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "OK" })).toBeDisabled();
    expect(await getFormData("ApplyModel")).toBeNull();

  });
});

describe("ApplyModelMain — dataset berubah saat panel terbuka", () => {
  it("(d) variabel baru ditambahkan → mapping disusun ulang, model tetap, toast info", async () => {
    const user = userEvent.setup();
    const { rerender } = await renderAndLoadModel();

    await user.click(screen.getByRole("tab", { name: "Variables" }));
    await user.click(
      screen.getByRole("combobox", { name: "Dataset variable for Temp" })
    );
    await user.click(screen.getByRole("option", { name: "— Not mapped —" }));
    expect(screen.getByTestId("mapping-status-Temp")).not.toHaveTextContent("✓");
    expect(screen.getByRole("button", { name: "OK" })).toBeDisabled();

    // Dataset berubah: variabel baru ditambahkan (array baru, isi berbeda).
    mockCurrentVariables = [
      ...makeD3Variables(),
      makeVariable("Humidity", "scale", "NUMERIC"),
    ];
    rerender(<ApplyModelMain onClose={jest.fn()} />);

    await waitFor(() =>
      expect(mockToast.info).toHaveBeenCalledWith(DATASET_CHANGED_MESSAGE)
    );
    expect(mockToast.info).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("mapping-status-Temp")).toHaveTextContent("✓");
    expect(screen.getByRole("button", { name: "OK" })).toBeEnabled();

    // Model tetap dimuat.
    await user.click(screen.getByRole("tab", { name: "Model" }));
    expect(screen.getByTestId("model-summary-card")).toBeInTheDocument();
  });

  it("referensi array berubah tetapi isi variabel sama → tidak ada reset", async () => {
    const { rerender } = await renderAndLoadModel();

    mockCurrentVariables = makeD3Variables();
    rerender(<ApplyModelMain onClose={jest.fn()} />);
    await flushHydration();

    expect(mockToast.info).not.toHaveBeenCalled();
  });
});

describe("ApplyModelMain — Help", () => {
  it("(e) Help memunculkan/menyembunyikan teks bantuan dan memperbarui aria-pressed", async () => {
    const user = userEvent.setup();
    render(<ApplyModelMain onClose={jest.fn()} />);
    const help = screen.getByRole("button", { name: "Toggle help" });
    expect(help).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.queryByText(/Choose where the trained model comes from/)
    ).not.toBeInTheDocument();

    await user.click(help);
    expect(help).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByText(/Choose where the trained model comes from/)
    ).toBeInTheDocument();

    await user.click(help);
    expect(help).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.queryByText(/Choose where the trained model comes from/)
    ).not.toBeInTheDocument();
  });
});
