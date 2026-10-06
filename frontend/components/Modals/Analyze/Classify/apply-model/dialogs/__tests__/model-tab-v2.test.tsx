// AGENTS_V2.md §10.1–10.2 — Tab Model untuk model teks + penyalinan pemetaan Text oleh
// container (Fase A3). Store di-mock (pola dialogs/__tests__/model-tab.test.tsx).

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Log } from "@/types/Result";
import type { Variable } from "@/types/Variable";
import { ModelTab } from "@/components/Modals/Analyze/Classify/apply-model/dialogs/model-tab";
import {
  applyLoadedModel,
  cloneApplyModelDefault,
  reconcileForDatasetChange,
} from "@/components/Modals/Analyze/Classify/apply-model/dialogs/apply-model-main";
import { validateAnyModel } from "@/components/Modals/Analyze/Classify/apply-model/adapters/registry";
import type { ModelLoadSuccess } from "@/components/Modals/Analyze/Classify/apply-model/services/model-loader";
import type { ApplyModelModelTabType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";

const mockStoreState: { logs: Log[]; loadResults: jest.Mock } = {
  logs: [],
  loadResults: jest.fn(),
};
jest.mock("@/stores/useResultStore", () => ({
  useResultStore: { getState: jest.fn(() => mockStoreState) },
}));

jest.mock("@/stores/useVariableStore", () => ({
  useVariableStore: jest.fn(
    (selector: (state: { variables: Variable[] }) => unknown) => selector({ variables: [] })
  ),
}));

// Fixture dimuat via require: tsconfig `composite: true` tidak mengizinkan
// import JSON via path alias (TS6307).
const nbModelV11 = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v1_1.json") as Record<string, unknown>;
const nbModelRaw = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v2_0-raw.json") as Record<string, unknown>;
const nbModelVector = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v2_0-vector.json") as Record<string, unknown>;

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

function loaded(model: Record<string, unknown>): ModelLoadSuccess {
  const validation = validateAnyModel(model);
  if (!validation.ok) throw new Error("Fixture harus valid");
  return {
    ok: true,
    model,
    descriptor: validation.descriptor,
    sourceRef: "model.json",
    sourceLabel: "File: model.json",
  };
}

function modelTabData(model: Record<string, unknown>): ApplyModelModelTabType {
  return {
    SourceKind: "file",
    SourceRef: "model.json",
    SourceLabel: "File: model.json",
    ModelJson: model,
  };
}

describe("ModelTab v2 — info Text", () => {
  it("model raw: baris ringkasan Text dari adapter + variabel teks model; tanpa tabel fitur", () => {
    render(<ModelTab data={modelTabData(nbModelRaw)} onModelLoaded={jest.fn()} showFieldHelp={false} />);

    const card = screen.getByTestId("model-summary-card");
    expect(within(card).getByText("Text source")).toBeInTheDocument();
    expect(within(card).getByText("Text likelihood")).toBeInTheDocument();
    expect(within(card).getByText("Text terms")).toBeInTheDocument();
    expect(within(card).getByText("Text alpha")).toBeInTheDocument();
    expect(screen.getByTestId("model-text-info")).toHaveTextContent("Raw text variable: Teks");
    expect(screen.getByTestId("model-no-features")).toBeInTheDocument();
    expect(within(card).queryByRole("table")).not.toBeInTheDocument();
  });

  it("model vector: jumlah kolom vektor + daftar kolom yang dapat dibuka", async () => {
    const user = userEvent.setup();
    render(<ModelTab data={modelTabData(nbModelVector)} onModelLoaded={jest.fn()} showFieldHelp={false} />);

    expect(screen.getByTestId("model-text-info")).toHaveTextContent("Word-vector columns: 5");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Show word-vector columns \(5\)/ }));
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "VEC_makan",
      "VEC_nasi",
      "VEC_saya",
      "VEC_suka",
      "VEC_tidak",
    ]);
  });

  it("model v1: tidak ada info Text dan tabel fitur tetap tampil", () => {
    render(<ModelTab data={modelTabData(nbModelV11)} onModelLoaded={jest.fn()} showFieldHelp={false} />);

    expect(screen.queryByTestId("model-text-info")).not.toBeInTheDocument();
    expect(screen.queryByTestId("model-no-features")).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});

describe("container v2 — pemetaan Text ikut disalin", () => {
  const rawDataset = [
    makeVariable("Teks", "nominal", "STRING"),
    makeVariable("Sentimen", "nominal", "STRING"),
  ];
  const vectorDataset = [
    makeVariable("VEC_makan", "scale", "NUMERIC"),
    makeVariable("VEC_nasi", "scale", "NUMERIC"),
    makeVariable("Sentimen", "nominal", "STRING"),
  ];

  it("applyLoadedModel (raw): RawTextVar terisi dari auto-map", () => {
    const next = applyLoadedModel(cloneApplyModelDefault(), loaded(nbModelRaw), "file", rawDataset);

    expect(next.variables.RawTextVar).toBe("Teks");
    expect(next.variables.FeatureMapping).toEqual({});
    expect(next.variables.ActualTargetVar).toBe("Sentimen");
  });

  it("applyLoadedModel (vector): VectorMapping memuat semua kolom model (tak ditemukan = null)", () => {
    const next = applyLoadedModel(cloneApplyModelDefault(), loaded(nbModelVector), "file", vectorDataset);

    expect(next.variables.VectorMapping).toEqual({
      VEC_makan: "VEC_makan",
      VEC_nasi: "VEC_nasi",
      VEC_saya: null,
      VEC_suka: null,
      VEC_tidak: null,
    });
  });

  it("reconcileForDatasetChange menyusun ulang pemetaan Text terhadap dataset baru", () => {
    const first = applyLoadedModel(cloneApplyModelDefault(), loaded(nbModelRaw), "file", rawDataset);
    expect(first.variables.RawTextVar).toBe("Teks");

    const reconciled = reconcileForDatasetChange(first, [makeVariable("Lain", "nominal", "STRING")]);
    expect(reconciled.variables.RawTextVar).toBeNull();
    expect(reconciled.model).toBe(first.model);
  });

  it("model v1: objek variables persis v1 (tanpa kunci Text) setelah muat dan setelah reconcile", () => {
    const dataset = [
      makeVariable("Outlook", "nominal", "STRING"),
      makeVariable("Temp", "scale", "NUMERIC"),
      makeVariable("Play", "nominal", "STRING"),
    ];
    const next = applyLoadedModel(cloneApplyModelDefault(), loaded(nbModelV11), "file", dataset);
    expect(next.variables).toEqual({
      FeatureMapping: { Outlook: "Outlook", Temp: "Temp" },
      ActualTargetVar: "Play",
    });
    expect(Object.keys(next.variables).sort()).toEqual(["ActualTargetVar", "FeatureMapping"]);

    const reconciled = reconcileForDatasetChange(next, dataset);
    expect(Object.keys(reconciled.variables).sort()).toEqual(["ActualTargetVar", "FeatureMapping"]);
  });
});
