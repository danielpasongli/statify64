// AGENTS.md §6.1–6.3, §6.7 — test RTL Tab Model + perilaku container terkait
// (PLAN.md Fase 12). Store di-mock (pola services/__tests__/model-loader.test.ts).

import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Log } from "@/types/Result";
import type { Variable } from "@/types/Variable";
import { ModelTab } from "@/components/Modals/Analyze/Classify/apply-model/dialogs/model-tab";
import ApplyModelMain, {
  applyLoadedModel,
  cloneApplyModelDefault,
} from "@/components/Modals/Analyze/Classify/apply-model/dialogs/apply-model-main";
import { validateAnyModel } from "@/components/Modals/Analyze/Classify/apply-model/adapters/registry";
import { APPLY_MODEL_MESSAGES } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import { ApplyModelModelDefault } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-default";
import type { ModelLoadSuccess } from "@/components/Modals/Analyze/Classify/apply-model/services/model-loader";
import type {
  ApplyModelModelTabType,
  ApplyModelSourceKind,
} from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";

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

const mockVariables: Variable[] = [];
jest.mock("@/stores/useVariableStore", () => ({
  useVariableStore: jest.fn((selector: (state: { variables: Variable[] }) => unknown) =>
    selector({ variables: mockVariables })
  ),
}));

// Fixture dimuat via require: tsconfig `composite: true` tidak mengizinkan
// import JSON via path alias (TS6307).
const nbModelV11 = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v1_1.json") as Record<string, unknown>;
const nbModelV10 = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v1_0.json") as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeFile(name: string, content: string): File {
  return {
    name,
    size: content.length,
    text: async () => content,
  } as unknown as File;
}

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

// Dataset D3 (PLAN.md §1): Outlook (STRING, nominal), Temp (NUMERIC, scale), Play (STRING, nominal).
function makeD3Variables(): Variable[] {
  return [
    makeVariable("Outlook", "nominal", "STRING"),
    makeVariable("Temp", "scale", "NUMERIC"),
    makeVariable("Play", "nominal", "STRING"),
  ];
}

function getLoadedD1(): ModelLoadSuccess {
  const validation = validateAnyModel(nbModelV11);
  if (!validation.ok) throw new Error("Fixture D1 harus valid");
  return {
    ok: true,
    model: validation.model,
    descriptor: validation.descriptor,
    sourceRef: "nb-model-v1_1.json",
    sourceLabel: "File: nb-model-v1_1.json",
  };
}

const onLoaded = jest.fn();

// Pembungkus berstate yang meniru container: hasil muat disimpan ke `data`.
function Harness({ showFieldHelp = false }: { showFieldHelp?: boolean }) {
  const [data, setData] = useState<ApplyModelModelTabType>(ApplyModelModelDefault);
  return (
    <ModelTab
      data={data}
      showFieldHelp={showFieldHelp}
      onModelLoaded={(result: ModelLoadSuccess, kind: ApplyModelSourceKind) => {
        onLoaded(result, kind);
        setData({
          SourceKind: kind,
          SourceRef: result.sourceRef,
          SourceLabel: result.sourceLabel,
          ModelJson: result.model,
        });
      }}
    />
  );
}

function uploadFile(file: File): void {
  fireEvent.change(screen.getByTestId("model-file-input"), {
    target: { files: [file] },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStoreState.logs = [];
  mockVariables.splice(0, mockVariables.length);
});

// ---------------------------------------------------------------------------
// ModelTab
// ---------------------------------------------------------------------------

describe("ModelTab — sumber file", () => {
  it("radio 'Upload file (.json)' terpilih secara default", () => {
    render(<Harness />);
    expect(screen.getByRole("radio", { name: "Upload file (.json)" })).toBeChecked();
  });

  it("upload D1 menampilkan kartu ringkasan model", async () => {
    render(<Harness />);
    uploadFile(makeFile("nb-model-v1_1.json", JSON.stringify(nbModelV11)));

    const card = await screen.findByTestId("model-summary-card");
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(onLoaded.mock.calls[0][1]).toBe("file");

    expect(within(card).getByText("File: nb-model-v1_1.json")).toBeInTheDocument();
    expect(within(card).getByText("Naive Bayes")).toBeInTheDocument();
    expect(within(card).getByText("1.1")).toBeInTheDocument();
    expect(within(card).getByText("Play")).toBeInTheDocument();
    expect(within(card).getByText("No, Yes")).toBeInTheDocument();
    expect(within(card).getByText("Outlook")).toBeInTheDocument();
    expect(within(card).getByText("categorical")).toBeInTheDocument();
    expect(within(card).getByText("Temp")).toBeInTheDocument();
    expect(within(card).getByText("numerical")).toBeInTheDocument();
    expect(
      screen.queryByTestId("model-warning-AM_W_LEGACY_SCHEMA")
    ).not.toBeInTheDocument();
  });

  it("upload D2 (schema 1.0) menampilkan banner AM_W_LEGACY_SCHEMA", async () => {
    render(<Harness />);
    uploadFile(makeFile("nb-model-v1_0.json", JSON.stringify(nbModelV10)));

    const card = await screen.findByTestId("model-summary-card");
    expect(within(card).getByText("1.0")).toBeInTheDocument();
    const banner = screen.getByTestId("model-warning-AM_W_LEGACY_SCHEMA");
    expect(banner).toHaveTextContent(APPLY_MODEL_MESSAGES.AM_W_LEGACY_SCHEMA);
  });

  it("upload JSON rusak menampilkan error dan model tetap null", async () => {
    render(<Harness />);
    uploadFile(makeFile("bad.json", "{bad"));

    const errors = await screen.findByTestId("model-load-errors");
    expect(errors).toHaveTextContent(APPLY_MODEL_MESSAGES.AM_E_PARSE);
    expect(onLoaded).not.toHaveBeenCalled();
    expect(screen.queryByTestId("model-summary-card")).not.toBeInTheDocument();
  });

  it("model_type tak terdaftar menampilkan pesan AM_E_MODEL_TYPE_UNSUPPORTED dengan detail", async () => {
    render(<Harness />);
    uploadFile(
      makeFile("svm.json", JSON.stringify({ ...nbModelV11, model_type: "svm" }))
    );

    const errors = await screen.findByTestId("model-load-errors");
    expect(errors).toHaveTextContent(
      APPLY_MODEL_MESSAGES.AM_E_MODEL_TYPE_UNSUPPORTED.replace("{detail}", "svm")
    );
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it("file tidak valid tidak menghapus model yang sudah dimuat", async () => {
    render(<Harness />);
    uploadFile(makeFile("nb-model-v1_1.json", JSON.stringify(nbModelV11)));
    await screen.findByTestId("model-summary-card");

    uploadFile(makeFile("bad.json", "{bad"));
    const errors = await screen.findByTestId("model-load-errors");
    expect(errors).toHaveTextContent(APPLY_MODEL_MESSAGES.AM_E_PARSE);
    expect(screen.getByTestId("model-summary-card")).toBeInTheDocument();
    expect(onLoaded).toHaveBeenCalledTimes(1);
  });
});

describe("ModelTab — sumber bawaan dan Output Viewer", () => {
  it("radio built-in: Select disabled dan teks 'There are no built-in Statify models yet.'", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "Statify built-in model" }));

    expect(
      await screen.findByText("There are no built-in Statify models yet.")
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Built-in model" })).toBeDisabled();
  });

  it("radio Output Viewer tanpa model: tampil AM_W_NO_RESULT_STORE_MODELS dan loadResults dipanggil sekali", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "From Output Viewer" }));

    expect(
      await screen.findByText(APPLY_MODEL_MESSAGES.AM_W_NO_RESULT_STORE_MODELS)
    ).toBeInTheDocument();
    expect(mockLoadResults).toHaveBeenCalledTimes(1);
  });

  it("radio Output Viewer dengan satu model: Select aktif dan pesan kosong tidak tampil", async () => {
    mockStoreState.logs = [
      {
        id: 1,
        log: "Naive Bayes Run",
        analytics: [
          {
            id: 1,
            title: "Naive Bayes Result",
            statistics: [
              {
                id: 7,
                components: "Export Model",
                output_data: JSON.stringify({
                  naiveBayesTrainedModel: JSON.stringify(nbModelV11),
                }),
              },
              { id: 8, components: "Other", output_data: "{}" },
            ],
          },
        ],
      },
    ] as unknown as Log[];

    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "From Output Viewer" }));

    const trigger = await screen.findByRole("combobox", {
      name: "Output Viewer model",
    });
    expect(trigger).toBeEnabled();
    expect(
      screen.queryByText(APPLY_MODEL_MESSAGES.AM_W_NO_RESULT_STORE_MODELS)
    ).not.toBeInTheDocument();
  });

  it("mengganti radio tidak menghapus model yang sudah dimuat", async () => {
    render(<Harness />);
    uploadFile(makeFile("nb-model-v1_1.json", JSON.stringify(nbModelV11)));
    await screen.findByTestId("model-summary-card");

    fireEvent.click(screen.getByRole("radio", { name: "Statify built-in model" }));
    expect(screen.getByTestId("model-summary-card")).toBeInTheDocument();
  });
});

describe("ModelTab — teks bantuan", () => {
  it("showFieldHelp true menampilkan teks bantuan; false menyembunyikannya", () => {
    const { unmount } = render(<Harness showFieldHelp={false} />);
    expect(
      screen.queryByText(/Choose where the trained model comes from/)
    ).not.toBeInTheDocument();
    unmount();

    render(<Harness showFieldHelp />);
    expect(
      screen.getByText(/Choose where the trained model comes from/)
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Container — perilaku Fase 12 (AGENTS.md §6.1)
// ---------------------------------------------------------------------------

describe("applyLoadedModel (AGENTS.md §6.1 'Saat model baru berhasil dimuat')", () => {
  it("mengisi model, auto-map variabel, reset save, mempertahankan output", () => {
    const prev = cloneApplyModelDefault();
    prev.save.SaveClassProbabilities = true;
    prev.save.NamePrefix = "XY";
    prev.output.ModelSummary = false;
    prev.variables.FeatureMapping = { Outlook: "Lama" };

    const next = applyLoadedModel(prev, getLoadedD1(), "file", makeD3Variables());

    expect(next.model.SourceKind).toBe("file");
    expect(next.model.SourceRef).toBe("nb-model-v1_1.json");
    expect(next.model.SourceLabel).toBe("File: nb-model-v1_1.json");
    expect(next.model.ModelJson).not.toBeNull();
    expect(next.variables.FeatureMapping).toEqual({
      Outlook: "Outlook",
      Temp: "Temp",
    });
    expect(next.variables.ActualTargetVar).toBe("Play");
    expect(next.save.SaveClassProbabilities).toBe(false);
    expect(next.save.NamePrefix).toBeNull();
    expect(next.output.ModelSummary).toBe(false);
  });
});

describe("ApplyModelMain — tab disabled selama belum ada model", () => {
  it("tab Variables, Save, Output disabled; aktif setelah model dimuat", async () => {
    render(<ApplyModelMain onClose={jest.fn()} />);

    expect(screen.getByRole("tab", { name: "Model" })).toBeEnabled();
    expect(screen.getByRole("tab", { name: "Variables" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Output" })).toBeDisabled();

    uploadFile(makeFile("nb-model-v1_1.json", JSON.stringify(nbModelV11)));

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Variables" })).toBeEnabled()
    );
    expect(screen.getByRole("tab", { name: "Save" })).toBeEnabled();
    expect(screen.getByRole("tab", { name: "Output" })).toBeEnabled();
    expect(screen.getByTestId("model-summary-card")).toBeInTheDocument();
  });

  it("tombol Help mengaktifkan teks bantuan di Tab Model", () => {
    render(<ApplyModelMain onClose={jest.fn()} />);
    const help = screen.getByRole("button", { name: "Toggle help" });
    expect(help).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.queryByText(/Choose where the trained model comes from/)
    ).not.toBeInTheDocument();

    fireEvent.click(help);
    expect(help).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByText(/Choose where the trained model comes from/)
    ).toBeInTheDocument();
  });
});
