// AGENTS.md §3.5, §6.5 — test RTL Tab Save (PLAN.md Fase 14).
// Store di-mock (pola dialogs/__tests__/variables-tab.test.tsx); logika
// `processVariableName` disalin agar nama akhir "_1" / "Rain_Day" nyata.

import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Log } from "@/types/Result";
import type { Variable } from "@/types/Variable";
import { SaveTab } from "@/components/Modals/Analyze/Classify/apply-model/dialogs/save-tab";
import ApplyModelMain from "@/components/Modals/Analyze/Classify/apply-model/dialogs/apply-model-main";
import { naiveBayesModelAdapter } from "@/components/Modals/Analyze/Classify/apply-model/adapters/naive-bayes-adapter";
import { validateAnyModel } from "@/components/Modals/Analyze/Classify/apply-model/adapters/registry";
import type { ModelDescriptor } from "@/components/Modals/Analyze/Classify/apply-model/adapters/types";
import { APPLY_MODEL_MESSAGES } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import { ApplyModelSaveDefault } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-default";
import type { ApplyModelSaveTabType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";

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

const mockVariables: Variable[] = [];
jest.mock("@/stores/useVariableStore", () => {
  const reserved = new Set(["ALL", "AND", "BY", "EQ", "GE", "GT", "LE", "LT", "NE", "NOT", "OR", "TO", "WITH"]);
  return {
    useVariableStore: jest.fn((selector: (state: { variables: Variable[] }) => unknown) =>
      selector({ variables: mockVariables })
    ),
    // Salinan setia processVariableName (FE/stores/useVariableStore.ts:29-59).
    processVariableName: (name: string, existingVariables: Array<{ name: string }>) => {
      if (!name) return { isValid: false, message: "Variable name cannot be empty" };
      let processedName = name.trim().replace(/\s+/g, "_");
      processedName = processedName.replace(/[^A-Za-z0-9._@#$]/g, "_");
      if (!/^[A-Za-z@#$]/.test(processedName)) processedName = "VAR_" + processedName;
      processedName = processedName.replace(/[._]+$/g, "");
      if (processedName.length > 64) processedName = processedName.slice(0, 64);
      if (reserved.has(processedName.toUpperCase())) processedName = "VAR_" + processedName;
      const existingNames = existingVariables.map((v) => v.name.toLowerCase());
      if (existingNames.includes(processedName.toLowerCase())) {
        let counter = 1;
        const base = processedName.slice(0, 60);
        let uniqueName = processedName;
        while (existingNames.includes(uniqueName.toLowerCase())) {
          uniqueName = `${base}_${counter}`;
          counter++;
        }
        processedName = uniqueName;
      }
      return { isValid: true, processedName };
    },
  };
});

// Fixture dimuat via require: tsconfig `composite: true` tidak mengizinkan
// import JSON via path alias (TS6307).
const nbModelV11 = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v1_1.json") as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

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

function getD1Descriptor(): ModelDescriptor {
  const validation = validateAnyModel(nbModelV11);
  if (!validation.ok) throw new Error("Fixture D1 harus valid");
  return validation.descriptor;
}

function cloneSaveDefault(): ApplyModelSaveTabType {
  return JSON.parse(JSON.stringify(ApplyModelSaveDefault)) as ApplyModelSaveTabType;
}

function formatMessage(code: keyof typeof APPLY_MODEL_MESSAGES, detail: string): string {
  return APPLY_MODEL_MESSAGES[code].replace("{detail}", detail);
}

// Pembungkus berstate yang meniru container: perubahan disimpan ke `data`.
function Harness({
  descriptor = getD1Descriptor(),
  existingVariables = [],
  initial,
  showFieldHelp = false,
}: {
  descriptor?: ModelDescriptor;
  existingVariables?: Variable[];
  initial?: ApplyModelSaveTabType;
  showFieldHelp?: boolean;
}) {
  const [data, setData] = useState<ApplyModelSaveTabType>(
    initial ?? cloneSaveDefault()
  );
  return (
    <SaveTab
      data={data}
      descriptor={descriptor}
      adapter={naiveBayesModelAdapter}
      existingVariables={existingVariables}
      onChange={setData}
      showFieldHelp={showFieldHelp}
    />
  );
}

function getRows(): HTMLElement[] {
  return screen.getAllByTestId(/^save-row-/);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStoreState.logs = [];
  mockVariables.splice(0, mockVariables.length);
});

// ---------------------------------------------------------------------------
// SaveTab
// ---------------------------------------------------------------------------

describe("SaveTab — tabel nama kolom", () => {
  it("D1 default: 2 baris (NB_PredictedValue, NB_PredictedProbability)", () => {
    render(<Harness />);

    expect(getRows()).toHaveLength(2);
    expect(screen.getByTestId("final-name-predicted")).toHaveTextContent(
      "NB_PredictedValue"
    );
    expect(screen.getByTestId("final-name-maxProbability")).toHaveTextContent(
      "NB_PredictedProbability"
    );
    expect(screen.queryByTestId("save-name-errors")).not.toBeInTheDocument();
    expect(screen.queryByTestId("save-name-adjusted")).not.toBeInTheDocument();
  });

  it("centang probabilitas per kelas: 4 baris (NB_Probability_No, NB_Probability_Yes)", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(
      screen.getByRole("checkbox", { name: "Predicted probability for each class" })
    );

    expect(getRows()).toHaveLength(4);
    expect(screen.getByTestId("final-name-class:No")).toHaveTextContent(
      "NB_Probability_No"
    );
    expect(screen.getByTestId("final-name-class:Yes")).toHaveTextContent(
      "NB_Probability_Yes"
    );
  });

  it("prefix XY menghasilkan XY_PredictedValue", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByRole("textbox", { name: "Name prefix" }), "XY");

    expect(screen.getByTestId("final-name-predicted")).toHaveTextContent(
      "XY_PredictedValue"
    );
    expect(screen.getByTestId("final-name-maxProbability")).toHaveTextContent(
      "XY_PredictedProbability"
    );
  });

  it("prefix tidak valid menampilkan AM_E_NAME_INVALID", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByRole("textbox", { name: "Name prefix" }), "1x");

    expect(screen.getByTestId("save-name-errors")).toHaveTextContent(
      formatMessage("AM_E_NAME_INVALID", "1x")
    );
  });

  it("prefix dikosongkan kembali memakai default adapter", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const prefix = screen.getByRole("textbox", { name: "Name prefix" });

    expect(prefix).toHaveAttribute("placeholder", "NB");
    await user.type(prefix, "XY");
    await user.clear(prefix);

    expect(screen.getByTestId("final-name-predicted")).toHaveTextContent(
      "NB_PredictedValue"
    );
  });

  it("mematikan probabilitas prediksi menyisakan 1 baris", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(
      screen.getByRole("checkbox", {
        name: "Predicted probability (predicted class)",
      })
    );

    expect(getRows()).toHaveLength(1);
  });

  it("checkbox Predicted value selalu tercentang dan disabled", () => {
    render(<Harness />);
    const checkbox = screen.getByRole("checkbox", { name: "Predicted value" });
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeDisabled();
  });
});

describe("SaveTab — nama kustom", () => {
  it("tanpa 'Use custom names' tabel read-only (tidak ada Input nama)", () => {
    render(<Harness />);
    expect(
      screen.queryByRole("textbox", { name: "Custom name for Predicted value" })
    ).not.toBeInTheDocument();
  });

  it("mengaktifkan nama kustom: Input muncul, kosong tidak jatuh ke default → AM_E_NAME_EMPTY", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("checkbox", { name: "Use custom names" }));

    const predicted = screen.getByRole("textbox", {
      name: "Custom name for Predicted value",
    });
    expect(predicted).toHaveValue("");
    expect(predicted).toHaveAttribute("placeholder", "NB_PredictedValue");
    expect(screen.getByTestId("save-name-errors")).toHaveTextContent(
      formatMessage("AM_E_NAME_EMPTY", "predicted")
    );
  });

  it("mengisi semua nama kustom menghilangkan error; mengosongkan lagi memunculkan AM_E_NAME_EMPTY", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("checkbox", { name: "Use custom names" }));
    const predicted = screen.getByRole("textbox", {
      name: "Custom name for Predicted value",
    });
    await user.type(predicted, "Pred");
    await user.type(
      screen.getByRole("textbox", { name: "Custom name for Predicted probability" }),
      "Prob"
    );

    expect(screen.queryByTestId("save-name-errors")).not.toBeInTheDocument();
    expect(screen.getByTestId("final-name-predicted")).toHaveTextContent("Pred");
    expect(screen.getByTestId("final-name-maxProbability")).toHaveTextContent("Prob");

    await user.clear(predicted);
    expect(screen.getByTestId("save-name-errors")).toHaveTextContent(
      formatMessage("AM_E_NAME_EMPTY", "predicted")
    );
  });

  it("nama kustom tidak valid dan duplikat menampilkan kode yang sesuai", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("checkbox", { name: "Use custom names" }));
    const predicted = screen.getByRole("textbox", {
      name: "Custom name for Predicted value",
    });
    const probability = screen.getByRole("textbox", {
      name: "Custom name for Predicted probability",
    });

    await user.type(predicted, "1abc");
    await user.type(probability, "x");
    expect(screen.getByTestId("save-name-errors")).toHaveTextContent(
      formatMessage("AM_E_NAME_INVALID", "1abc")
    );

    await user.clear(predicted);
    await user.type(predicted, "abc");
    await user.clear(probability);
    await user.type(probability, "ABC");
    expect(screen.getByTestId("save-name-errors")).toHaveTextContent(
      formatMessage("AM_E_NAME_DUPLICATE", "ABC")
    );
  });

  it("nama kustom untuk kolom per kelas tersimpan per kelas", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(
      screen.getByRole("checkbox", { name: "Predicted probability for each class" })
    );
    await user.click(screen.getByRole("checkbox", { name: "Use custom names" }));
    await user.type(
      screen.getByRole("textbox", { name: "Custom name for Probability of Yes" }),
      "PYes"
    );

    expect(screen.getByTestId("final-name-class:Yes")).toHaveTextContent("PYes");
    expect(screen.getByTestId("final-name-class:No")).toHaveTextContent("—");
  });
});

describe("SaveTab — Final name & AM_W_NAME_ADJUSTED", () => {
  it("variabel NB_PredictedValue sudah ada → Final name NB_PredictedValue_1 + ikon peringatan", () => {
    render(
      <Harness
        existingVariables={[makeVariable("NB_PredictedValue", "nominal", "STRING")]}
      />
    );

    expect(screen.getByTestId("final-name-predicted")).toHaveTextContent(
      "NB_PredictedValue_1"
    );
    expect(screen.getByTestId("name-adjusted-predicted")).toBeInTheDocument();
    expect(screen.getByTestId("save-name-adjusted")).toHaveTextContent(
      APPLY_MODEL_MESSAGES.AM_W_NAME_ADJUSTED
    );
    // Baris yang tidak berubah tidak diberi ikon.
    expect(
      screen.queryByTestId("name-adjusted-maxProbability")
    ).not.toBeInTheDocument();
  });

  it("kelas 'Rain Day' → NB_Probability_Rain_Day dengan ikon peringatan", () => {
    const base = getD1Descriptor();
    const descriptor: ModelDescriptor = { ...base, classes: ["Rain Day", "Sunny"] };
    const initial = { ...cloneSaveDefault(), SaveClassProbabilities: true };
    render(<Harness descriptor={descriptor} initial={initial} />);

    expect(screen.getByTestId("final-name-class:Rain Day")).toHaveTextContent(
      "NB_Probability_Rain_Day"
    );
    expect(screen.getByTestId("name-adjusted-class:Rain Day")).toBeInTheDocument();
    expect(screen.queryByTestId("name-adjusted-class:Sunny")).not.toBeInTheDocument();
  });
});

describe("SaveTab — teks bantuan", () => {
  it("showFieldHelp true menampilkan teks bantuan; false menyembunyikannya", () => {
    const { unmount } = render(<Harness showFieldHelp={false} />);
    expect(
      screen.queryByText(/Choose which columns are added/)
    ).not.toBeInTheDocument();
    unmount();

    render(<Harness showFieldHelp />);
    expect(
      screen.getByText(/Choose which columns are added/)
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Container — tab Save terpasang (AGENTS.md §6.1, §6.5)
// ---------------------------------------------------------------------------

describe("ApplyModelMain — Tab Save", () => {
  async function loadModelAndOpenSave(user: ReturnType<typeof userEvent.setup>) {
    render(<ApplyModelMain onClose={jest.fn()} />);
    const file = {
      name: "nb-model-v1_1.json",
      size: 100,
      text: async () => JSON.stringify(nbModelV11),
    } as unknown as File;
    fireEvent.change(screen.getByTestId("model-file-input"), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Save" })).toBeEnabled()
    );
    await user.click(screen.getByRole("tab", { name: "Save" }));
  }

  it("setelah model D1 dimuat, tab Save menampilkan 2 baris default", async () => {
    const user = userEvent.setup();
    makeD3Variables().forEach((variable) => mockVariables.push(variable));
    await loadModelAndOpenSave(user);

    expect(await screen.findByTestId("final-name-predicted")).toHaveTextContent(
      "NB_PredictedValue"
    );
    expect(getRows()).toHaveLength(2);
  });

  it("variabel NB_PredictedValue di dataset → Final name disesuaikan di container", async () => {
    const user = userEvent.setup();
    makeD3Variables().forEach((variable) => mockVariables.push(variable));
    mockVariables.push(makeVariable("NB_PredictedValue", "nominal", "STRING"));
    await loadModelAndOpenSave(user);

    expect(await screen.findByTestId("final-name-predicted")).toHaveTextContent(
      "NB_PredictedValue_1"
    );
  });

  it("pilihan di tab Save bertahan setelah berpindah tab", async () => {
    const user = userEvent.setup();
    makeD3Variables().forEach((variable) => mockVariables.push(variable));
    await loadModelAndOpenSave(user);

    await user.type(
      await screen.findByRole("textbox", { name: "Name prefix" }),
      "XY"
    );
    await user.click(screen.getByRole("tab", { name: "Model" }));
    await user.click(screen.getByRole("tab", { name: "Save" }));

    expect(
      within(screen.getByRole("tabpanel")).getByTestId("final-name-predicted")
    ).toHaveTextContent("XY_PredictedValue");
  });
});
