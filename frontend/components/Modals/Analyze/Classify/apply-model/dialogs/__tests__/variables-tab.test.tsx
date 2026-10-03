// AGENTS.md §3.4, §6.4 — test RTL Tab Variables (PLAN.md Fase 13).
// Store di-mock (pola dialogs/__tests__/model-tab.test.tsx).

import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Log } from "@/types/Result";
import type { Variable } from "@/types/Variable";
import { VariablesTab } from "@/components/Modals/Analyze/Classify/apply-model/dialogs/variables-tab";
import ApplyModelMain from "@/components/Modals/Analyze/Classify/apply-model/dialogs/apply-model-main";
import { validateAnyModel } from "@/components/Modals/Analyze/Classify/apply-model/adapters/registry";
import type { ModelDescriptor } from "@/components/Modals/Analyze/Classify/apply-model/adapters/types";
import { APPLY_MODEL_MESSAGES } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import { autoMapFeatures } from "@/components/Modals/Analyze/Classify/apply-model/hooks/useApplyModelMappingRules";
import type { ApplyModelVariablesTabType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";

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

// Dataset D3 (PLAN.md §1): Outlook (STRING, nominal), Temp (NUMERIC, scale), Play (STRING, nominal).
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

function getUnmappedMessage(feature: string): string {
  return APPLY_MODEL_MESSAGES.AM_E_MAP_UNMAPPED.replace("{detail}", feature);
}

// Pembungkus berstate yang meniru container: perubahan disimpan ke `data`.
function Harness({
  descriptor,
  variables,
  initial,
  showFieldHelp = false,
}: {
  descriptor: ModelDescriptor;
  variables: Variable[];
  initial?: ApplyModelVariablesTabType;
  showFieldHelp?: boolean;
}) {
  const [data, setData] = useState<ApplyModelVariablesTabType>(
    initial ?? autoMapFeatures(descriptor, variables)
  );
  return (
    <VariablesTab
      data={data}
      descriptor={descriptor}
      variables={variables}
      onChange={setData}
      showFieldHelp={showFieldHelp}
    />
  );
}

async function openSelect(
  user: ReturnType<typeof userEvent.setup>,
  name: string
): Promise<void> {
  await user.click(screen.getByRole("combobox", { name }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStoreState.logs = [];
  mockVariables.splice(0, mockVariables.length);
});

// ---------------------------------------------------------------------------
// VariablesTab
// ---------------------------------------------------------------------------

describe("VariablesTab — auto-map & status", () => {
  it("model D1 + variabel D3: kedua fitur terpetakan, status ✓, actual = Play", () => {
    render(
      <Harness descriptor={getD1Descriptor()} variables={makeD3Variables()} />
    );

    expect(
      screen.getByRole("combobox", { name: "Dataset variable for Outlook" })
    ).toHaveTextContent("Outlook");
    expect(
      screen.getByRole("combobox", { name: "Dataset variable for Temp" })
    ).toHaveTextContent("Temp");
    expect(screen.getByTestId("mapping-status-Outlook")).toHaveTextContent("✓");
    expect(screen.getByTestId("mapping-status-Temp")).toHaveTextContent("✓");
    expect(
      screen.getByRole("combobox", { name: "Actual target variable" })
    ).toHaveTextContent("Play");
    expect(screen.queryByTestId("actual-target-errors")).not.toBeInTheDocument();
  });

  it("tabel menampilkan nama fitur dan role", () => {
    render(
      <Harness descriptor={getD1Descriptor()} variables={makeD3Variables()} />
    );
    expect(screen.getByText("categorical")).toBeInTheDocument();
    expect(screen.getByText("numerical")).toBeInTheDocument();
  });

  it("mengubah Temp ke '— Not mapped —' menampilkan pesan AM_E_MAP_UNMAPPED", async () => {
    const user = userEvent.setup();
    render(
      <Harness descriptor={getD1Descriptor()} variables={makeD3Variables()} />
    );

    await openSelect(user, "Dataset variable for Temp");
    await user.click(screen.getByRole("option", { name: "— Not mapped —" }));

    const status = screen.getByTestId("mapping-status-Temp");
    expect(status).toHaveTextContent(getUnmappedMessage("Temp"));
    expect(status).not.toHaveTextContent("✓");
    // Fitur lain tidak terpengaruh.
    expect(screen.getByTestId("mapping-status-Outlook")).toHaveTextContent("✓");
  });

  it("Select Temp hanya berisi variabel scale (ditambah opsi Not mapped)", async () => {
    const user = userEvent.setup();
    render(
      <Harness descriptor={getD1Descriptor()} variables={makeD3Variables()} />
    );

    await openSelect(user, "Dataset variable for Temp");
    const names = screen
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(names).toEqual(["— Not mapped —", "Temp"]);
  });

  it("Select Outlook hanya berisi variabel nominal/ordinal", async () => {
    const user = userEvent.setup();
    render(
      <Harness descriptor={getD1Descriptor()} variables={makeD3Variables()} />
    );

    await openSelect(user, "Dataset variable for Outlook");
    const names = screen
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(names).toEqual(["— Not mapped —", "Outlook", "Play"]);
  });

  it("variabel yang sudah dipakai fitur lain tampil disabled", async () => {
    const user = userEvent.setup();
    const descriptor: ModelDescriptor = {
      ...getD1Descriptor(),
      features: [
        { name: "A", role: "categorical" },
        { name: "B", role: "categorical" },
      ],
    };
    const variables = [
      makeVariable("A", "nominal", "STRING"),
      makeVariable("B", "nominal", "STRING"),
    ];
    render(
      <Harness
        descriptor={descriptor}
        variables={variables}
        initial={{ FeatureMapping: { A: "A", B: null }, ActualTargetVar: null }}
      />
    );

    await openSelect(user, "Dataset variable for B");
    expect(screen.getByRole("option", { name: "A" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    expect(screen.getByRole("option", { name: "B" })).not.toHaveAttribute(
      "aria-disabled",
      "true"
    );
  });

  it("variabel Temp ber-measure nominal menampilkan AM_E_MAP_ROLE_MISMATCH", () => {
    const variables = [
      makeVariable("Outlook", "nominal", "STRING"),
      makeVariable("Temp", "nominal", "NUMERIC"),
    ];
    render(<Harness descriptor={getD1Descriptor()} variables={variables} />);

    expect(screen.getByTestId("mapping-status-Temp")).toHaveTextContent(
      APPLY_MODEL_MESSAGES.AM_E_MAP_ROLE_MISMATCH.replace("{detail}", "Temp")
    );
  });
});

describe("VariablesTab — tombol Auto-map by name", () => {
  it("menimpa pilihan manual dengan hasil auto-map", async () => {
    const user = userEvent.setup();
    render(
      <Harness descriptor={getD1Descriptor()} variables={makeD3Variables()} />
    );

    await openSelect(user, "Dataset variable for Temp");
    await user.click(screen.getByRole("option", { name: "— Not mapped —" }));
    expect(screen.getByTestId("mapping-status-Temp")).toHaveTextContent(
      getUnmappedMessage("Temp")
    );

    await user.click(screen.getByRole("button", { name: "Auto-map by name" }));

    expect(screen.getByTestId("mapping-status-Temp")).toHaveTextContent("✓");
    expect(
      screen.getByRole("combobox", { name: "Dataset variable for Temp" })
    ).toHaveTextContent("Temp");
  });
});

describe("VariablesTab — actual target", () => {
  it("opsi hanya variabel nominal/ordinal yang bukan prediktor, plus '— None —'", async () => {
    const user = userEvent.setup();
    render(
      <Harness descriptor={getD1Descriptor()} variables={makeD3Variables()} />
    );

    await openSelect(user, "Actual target variable");
    const names = screen
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(names).toEqual(["— None —", "Play"]);
  });

  it("memilih '— None —' mengosongkan actual target", async () => {
    const user = userEvent.setup();
    render(
      <Harness descriptor={getD1Descriptor()} variables={makeD3Variables()} />
    );

    await openSelect(user, "Actual target variable");
    await user.click(screen.getByRole("option", { name: "— None —" }));

    expect(
      screen.getByRole("combobox", { name: "Actual target variable" })
    ).toHaveTextContent("— None —");
  });

  it("actual target yang juga prediktor menampilkan AM_E_ACTUAL_IS_PREDICTOR", () => {
    render(
      <Harness
        descriptor={getD1Descriptor()}
        variables={makeD3Variables()}
        initial={{
          FeatureMapping: { Outlook: "Outlook", Temp: "Temp" },
          ActualTargetVar: "Outlook",
        }}
      />
    );

    expect(screen.getByTestId("actual-target-errors")).toHaveTextContent(
      APPLY_MODEL_MESSAGES.AM_E_ACTUAL_IS_PREDICTOR.replace("{detail}", "Outlook")
    );
  });
});

describe("VariablesTab — teks bantuan", () => {
  it("showFieldHelp true menampilkan teks bantuan; false menyembunyikannya", () => {
    const { unmount } = render(
      <Harness
        descriptor={getD1Descriptor()}
        variables={makeD3Variables()}
        showFieldHelp={false}
      />
    );
    expect(
      screen.queryByText(/Every model feature must be mapped/)
    ).not.toBeInTheDocument();
    unmount();

    render(
      <Harness
        descriptor={getD1Descriptor()}
        variables={makeD3Variables()}
        showFieldHelp
      />
    );
    expect(
      screen.getByText(/Every model feature must be mapped/)
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Container — tab Variables terpasang (AGENTS.md §6.1, §6.4)
// ---------------------------------------------------------------------------

describe("ApplyModelMain — Tab Variables", () => {
  it("setelah model D1 dimuat, tab Variables menampilkan mapping otomatis", async () => {
    const user = userEvent.setup();
    makeD3Variables().forEach((variable) => mockVariables.push(variable));
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
      expect(screen.getByRole("tab", { name: "Variables" })).toBeEnabled()
    );
    await user.click(screen.getByRole("tab", { name: "Variables" }));

    const outlookStatus = await screen.findByTestId("mapping-status-Outlook");
    expect(outlookStatus).toHaveTextContent("✓");
    expect(screen.getByTestId("mapping-status-Temp")).toHaveTextContent("✓");
    expect(
      within(screen.getByRole("tabpanel")).getByRole("combobox", {
        name: "Actual target variable",
      })
    ).toHaveTextContent("Play");
  });

  it("perubahan pilihan di tab Variables bertahan setelah berpindah tab", async () => {
    const user = userEvent.setup();
    makeD3Variables().forEach((variable) => mockVariables.push(variable));
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
      expect(screen.getByRole("tab", { name: "Variables" })).toBeEnabled()
    );

    await user.click(screen.getByRole("tab", { name: "Variables" }));
    await openSelect(user, "Dataset variable for Temp");
    await user.click(screen.getByRole("option", { name: "— Not mapped —" }));

    await user.click(screen.getByRole("tab", { name: "Model" }));
    await user.click(screen.getByRole("tab", { name: "Variables" }));

    expect(await screen.findByTestId("mapping-status-Temp")).toHaveTextContent(
      getUnmappedMessage("Temp")
    );
  });
});
