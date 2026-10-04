// AGENTS.md §3.3, §6.5 — test RTL Tab Output (PLAN.md Fase 14).
// Store di-mock (pola dialogs/__tests__/variables-tab.test.tsx).

import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Log } from "@/types/Result";
import type { Variable } from "@/types/Variable";
import { OutputTab } from "@/components/Modals/Analyze/Classify/apply-model/dialogs/output-tab";
import ApplyModelMain from "@/components/Modals/Analyze/Classify/apply-model/dialogs/apply-model-main";
import { ApplyModelOutputDefault } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-default";
import type { ApplyModelOutputTabType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";

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
jest.mock("@/stores/useVariableStore", () => ({
  useVariableStore: jest.fn((selector: (state: { variables: Variable[] }) => unknown) =>
    selector({ variables: mockVariables })
  ),
  // Dibutuhkan tab Save (dirender container); nilai tidak relevan di file ini.
  processVariableName: (name: string) => ({ isValid: true, processedName: name }),
}));

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

function cloneOutputDefault(): ApplyModelOutputTabType {
  return JSON.parse(JSON.stringify(ApplyModelOutputDefault)) as ApplyModelOutputTabType;
}

const REQUIRES_ACTUAL_TEXT = "Requires an actual target variable (Variables tab).";

// Pembungkus berstate yang meniru container.
function Harness({
  hasActualTarget,
  initial,
  showFieldHelp = false,
}: {
  hasActualTarget: boolean;
  initial?: ApplyModelOutputTabType;
  showFieldHelp?: boolean;
}) {
  const [data, setData] = useState<ApplyModelOutputTabType>(
    initial ?? cloneOutputDefault()
  );
  return (
    <OutputTab
      data={data}
      hasActualTarget={hasActualTarget}
      onChange={setData}
      showFieldHelp={showFieldHelp}
    />
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStoreState.logs = [];
  mockVariables.splice(0, mockVariables.length);
});

// ---------------------------------------------------------------------------
// OutputTab
// ---------------------------------------------------------------------------

describe("OutputTab — aturan disabled", () => {
  it("tanpa actual target: Evaluation metrics & Confusion matrix disabled, tiga lainnya aktif", () => {
    render(<Harness hasActualTarget={false} />);

    expect(screen.getByRole("checkbox", { name: "Evaluation metrics" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Confusion matrix" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Model summary" })).toBeEnabled();
    expect(
      screen.getByRole("checkbox", { name: "Case processing summary" })
    ).toBeEnabled();
    expect(
      screen.getByRole("checkbox", { name: "Prediction distribution" })
    ).toBeEnabled();
    expect(screen.getAllByText(REQUIRES_ACTUAL_TEXT)).toHaveLength(2);
  });

  it("tanpa actual target: dua checkbox evaluasi tampil tidak tercentang walau nilai tersimpan true", () => {
    render(<Harness hasActualTarget={false} />);

    expect(
      screen.getByRole("checkbox", { name: "Evaluation metrics" })
    ).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Confusion matrix" })
    ).not.toBeChecked();
  });

  it("dengan actual target: kelima checkbox aktif & tercentang (default), tanpa teks syarat", () => {
    render(<Harness hasActualTarget />);

    for (const name of [
      "Model summary",
      "Case processing summary",
      "Prediction distribution",
      "Evaluation metrics",
      "Confusion matrix",
    ]) {
      const checkbox = screen.getByRole("checkbox", { name });
      expect(checkbox).toBeEnabled();
      expect(checkbox).toBeChecked();
    }
    expect(screen.queryByText(REQUIRES_ACTUAL_TEXT)).not.toBeInTheDocument();
  });
});

describe("OutputTab — perubahan", () => {
  it("menghapus centang Model summary mengubah state", async () => {
    const user = userEvent.setup();
    render(<Harness hasActualTarget />);

    const checkbox = screen.getByRole("checkbox", { name: "Model summary" });
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);
    expect(checkbox).toBeChecked();
  });

  it("onChange menerima boolean murni dan field lain tidak berubah", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(
      <OutputTab
        data={cloneOutputDefault()}
        hasActualTarget
        onChange={onChange}
        showFieldHelp={false}
      />
    );

    await user.click(screen.getByRole("checkbox", { name: "Confusion matrix" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      ...ApplyModelOutputDefault,
      ConfusionMatrix: false,
    });
  });

  it("checkbox disabled tidak memanggil onChange", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(
      <OutputTab
        data={cloneOutputDefault()}
        hasActualTarget={false}
        onChange={onChange}
        showFieldHelp={false}
      />
    );

    await user.click(screen.getByRole("checkbox", { name: "Evaluation metrics" }));

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("OutputTab — teks bantuan", () => {
  it("showFieldHelp true menampilkan teks bantuan; false menyembunyikannya", () => {
    const { unmount } = render(<Harness hasActualTarget showFieldHelp={false} />);
    expect(
      screen.queryByText(/Shows the algorithm, target, classes/)
    ).not.toBeInTheDocument();
    unmount();

    render(<Harness hasActualTarget showFieldHelp />);
    expect(
      screen.getByText(/Shows the algorithm, target, classes/)
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Container — tab Output terpasang (AGENTS.md §6.1, §6.5)
// ---------------------------------------------------------------------------

describe("ApplyModelMain — Tab Output", () => {
  async function loadModel(user: ReturnType<typeof userEvent.setup>) {
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
      expect(screen.getByRole("tab", { name: "Output" })).toBeEnabled()
    );
    return user;
  }

  it("D1 + D3 (actual = Play): checkbox evaluasi aktif", async () => {
    const user = userEvent.setup();
    makeD3Variables().forEach((variable) => mockVariables.push(variable));
    await loadModel(user);

    await user.click(screen.getByRole("tab", { name: "Output" }));

    expect(
      await screen.findByRole("checkbox", { name: "Evaluation metrics" })
    ).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Confusion matrix" })).toBeEnabled();
  });

  it("actual target diset '— None —' di tab Variables → checkbox evaluasi disabled", async () => {
    const user = userEvent.setup();
    makeD3Variables().forEach((variable) => mockVariables.push(variable));
    await loadModel(user);

    await user.click(screen.getByRole("tab", { name: "Variables" }));
    await user.click(
      await screen.findByRole("combobox", { name: "Actual target variable" })
    );
    await user.click(screen.getByRole("option", { name: "— None —" }));

    await user.click(screen.getByRole("tab", { name: "Output" }));

    expect(
      await screen.findByRole("checkbox", { name: "Evaluation metrics" })
    ).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Confusion matrix" })).toBeDisabled();
    expect(screen.getAllByText(REQUIRES_ACTUAL_TEXT)).toHaveLength(2);
  });

  it("pilihan di tab Output bertahan setelah berpindah tab", async () => {
    const user = userEvent.setup();
    makeD3Variables().forEach((variable) => mockVariables.push(variable));
    await loadModel(user);

    await user.click(screen.getByRole("tab", { name: "Output" }));
    await user.click(await screen.findByRole("checkbox", { name: "Model summary" }));
    await user.click(screen.getByRole("tab", { name: "Model" }));
    await user.click(screen.getByRole("tab", { name: "Output" }));

    expect(
      await screen.findByRole("checkbox", { name: "Model summary" })
    ).not.toBeChecked();
  });
});
