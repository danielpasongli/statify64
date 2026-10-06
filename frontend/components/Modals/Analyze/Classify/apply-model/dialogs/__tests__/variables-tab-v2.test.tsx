// AGENTS_V2.md §10.2 — test RTL Tab Variables untuk model teks (Fase A3):
// Raw Text Variable (raw) dan ringkasan kolom vektor yang dapat dibuka (vector).

import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Variable } from "@/types/Variable";
import { VariablesTab } from "@/components/Modals/Analyze/Classify/apply-model/dialogs/variables-tab";
import { validateAnyModel } from "@/components/Modals/Analyze/Classify/apply-model/adapters/registry";
import type { ModelDescriptor } from "@/components/Modals/Analyze/Classify/apply-model/adapters/types";
import { APPLY_MODEL_MESSAGES } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import { autoMapFeatures } from "@/components/Modals/Analyze/Classify/apply-model/hooks/useApplyModelMappingRules";
import type { ApplyModelVariablesTabType } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model";

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

function descriptorOf(model: Record<string, unknown>): ModelDescriptor {
  const validation = validateAnyModel(model);
  if (!validation.ok) throw new Error("Fixture harus valid");
  return validation.descriptor;
}

// Pembungkus berstate yang meniru container: perubahan disimpan ke `data`.
function Harness({
  descriptor,
  variables,
  initial,
  onChangeSpy,
}: {
  descriptor: ModelDescriptor;
  variables: Variable[];
  initial?: ApplyModelVariablesTabType;
  onChangeSpy?: (next: ApplyModelVariablesTabType) => void;
}) {
  const [data, setData] = useState<ApplyModelVariablesTabType>(
    initial ?? autoMapFeatures(descriptor, variables)
  );
  return (
    <VariablesTab
      data={data}
      descriptor={descriptor}
      variables={variables}
      onChange={(next) => {
        onChangeSpy?.(next);
        setData(next);
      }}
      showFieldHelp={false}
    />
  );
}

const RAW_DATASET: Variable[] = [
  makeVariable("Teks", "nominal", "STRING"),
  makeVariable("Catatan", "nominal", "STRING"),
  makeVariable("Sentimen", "nominal", "STRING"),
  makeVariable("Angka", "scale", "NUMERIC"),
];

describe("VariablesTab v2 — model Raw Text", () => {
  it("auto-map mengisi Raw Text Variable; tabel fitur v1 diganti catatan 'text features only'", () => {
    render(<Harness descriptor={descriptorOf(nbModelRaw)} variables={RAW_DATASET} />);

    expect(screen.getByTestId("raw-text-section")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Raw text variable" })).toHaveTextContent("Teks");
    expect(screen.getByTestId("no-numeric-categorical-features")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByTestId("vector-text-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("raw-text-errors")).not.toBeInTheDocument();
  });

  it("opsi Raw Text Variable hanya variabel STRING", async () => {
    const user = userEvent.setup();
    render(<Harness descriptor={descriptorOf(nbModelRaw)} variables={RAW_DATASET} />);

    await user.click(screen.getByRole("combobox", { name: "Raw text variable" }));
    const names = screen.getAllByRole("option").map((option) => option.textContent);
    expect(names).toEqual(["— Not mapped —", "Teks", "Catatan", "Sentimen"]);
  });

  it("memilih variabel lain memanggil onChange dengan RawTextVar baru", async () => {
    const user = userEvent.setup();
    const spy = jest.fn();
    render(
      <Harness
        descriptor={descriptorOf(nbModelRaw)}
        variables={RAW_DATASET}
        onChangeSpy={spy}
      />
    );

    await user.click(screen.getByRole("combobox", { name: "Raw text variable" }));
    await user.click(screen.getByRole("option", { name: "Catatan" }));

    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ RawTextVar: "Catatan" }));
    expect(screen.getByRole("combobox", { name: "Raw text variable" })).toHaveTextContent("Catatan");
  });

  it("'— Not mapped —' menampilkan AM_E_MAP_RAW_TEXT_UNMAPPED dengan nama variabel model", async () => {
    const user = userEvent.setup();
    render(<Harness descriptor={descriptorOf(nbModelRaw)} variables={RAW_DATASET} />);

    await user.click(screen.getByRole("combobox", { name: "Raw text variable" }));
    await user.click(screen.getByRole("option", { name: "— Not mapped —" }));

    expect(screen.getByTestId("raw-text-errors")).toHaveTextContent(
      APPLY_MODEL_MESSAGES.AM_E_MAP_RAW_TEXT_UNMAPPED.replace("{detail}", "Teks")
    );
  });

  it("variabel numerik terpilih sebagai teks menampilkan AM_E_MAP_RAW_TEXT_TYPE", () => {
    render(
      <Harness
        descriptor={descriptorOf(nbModelRaw)}
        variables={RAW_DATASET}
        initial={{ FeatureMapping: {}, ActualTargetVar: null, RawTextVar: "Angka", VectorMapping: {} }}
      />
    );

    expect(screen.getByTestId("raw-text-errors")).toHaveTextContent(
      APPLY_MODEL_MESSAGES.AM_E_MAP_RAW_TEXT_TYPE.replace("{detail}", "Teks")
    );
  });

  it("'Auto-map by name' mengisi ulang RawTextVar yang kosong", async () => {
    const user = userEvent.setup();
    const spy = jest.fn();
    render(
      <Harness
        descriptor={descriptorOf(nbModelRaw)}
        variables={RAW_DATASET}
        initial={{ FeatureMapping: {}, ActualTargetVar: null, RawTextVar: null, VectorMapping: {} }}
        onChangeSpy={spy}
      />
    );

    await user.click(screen.getByRole("button", { name: "Auto-map by name" }));

    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ RawTextVar: "Teks" }));
    expect(screen.getByRole("combobox", { name: "Raw text variable" })).toHaveTextContent("Teks");
  });
});

const VECTOR_COLUMNS = ["VEC_makan", "VEC_nasi", "VEC_saya", "VEC_suka", "VEC_tidak"];

describe("VariablesTab v2 — model Word-Vector", () => {
  it("3 dari 5 kolom ditemukan: ringkasan satu baris, daftar zero-filled tertutup lalu dapat dibuka", async () => {
    const user = userEvent.setup();
    const variables = [
      makeVariable("VEC_makan", "scale", "NUMERIC"),
      makeVariable("VEC_nasi", "scale", "NUMERIC"),
      makeVariable("VEC_saya", "scale", "NUMERIC"),
      makeVariable("Sentimen", "nominal", "STRING"),
    ];
    render(<Harness descriptor={descriptorOf(nbModelVector)} variables={variables} />);

    expect(screen.getByTestId("vector-mapping-summary")).toHaveTextContent(
      "3 of 5 vector columns found; 2 treated as 0."
    );
    // Tidak ada baris per kolom; daftar tertutup.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText("VEC_suka")).not.toBeInTheDocument();
    expect(screen.queryByTestId("vector-mapping-errors")).not.toBeInTheDocument();
    expect(screen.queryByTestId("vector-all-zero-filled-warning")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /Show columns treated as 0 \(2\)/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["VEC_suka", "VEC_tidak"]);
  });

  it("semua kolom ditemukan: '5 dari 5', tanpa daftar zero-filled", () => {
    const variables = VECTOR_COLUMNS.map((name) => makeVariable(name, "scale", "NUMERIC"));
    render(<Harness descriptor={descriptorOf(nbModelVector)} variables={variables} />);

    expect(screen.getByTestId("vector-mapping-summary")).toHaveTextContent(
      "5 of 5 vector columns found; 0 treated as 0."
    );
    expect(screen.queryByTestId("vector-zero-filled-list")).not.toBeInTheDocument();
  });

  it("tidak ada kolom ditemukan (model hanya-Text): peringatan AM_W_TEXT_ALL_ZERO_FILLED tampil", () => {
    render(
      <Harness
        descriptor={descriptorOf(nbModelVector)}
        variables={[makeVariable("Sentimen", "nominal", "STRING")]}
      />
    );

    expect(screen.getByTestId("vector-mapping-summary")).toHaveTextContent(
      "0 of 5 vector columns found; 5 treated as 0."
    );
    expect(screen.getByTestId("vector-all-zero-filled-warning")).toHaveTextContent(
      APPLY_MODEL_MESSAGES.AM_W_TEXT_ALL_ZERO_FILLED
    );
  });

  it("kolom vektor bertipe STRING menampilkan AM_E_MAP_NUMERIC_TYPE dengan nama kolom model", () => {
    const variables = [
      makeVariable("VEC_makan", "nominal", "STRING"),
      makeVariable("Sentimen", "nominal", "STRING"),
    ];
    render(<Harness descriptor={descriptorOf(nbModelVector)} variables={variables} />);

    expect(screen.getByTestId("vector-mapping-errors")).toHaveTextContent(
      APPLY_MODEL_MESSAGES.AM_E_MAP_NUMERIC_TYPE.replace("{detail}", "VEC_makan")
    );
  });

  it("ribuan kolom: satu baris ringkasan, daftar dibuka bertahap (200 per tahap)", async () => {
    const user = userEvent.setup();
    const base = descriptorOf(nbModelVector);
    const columns = Array.from({ length: 2500 }, (_, index) => `VEC_t${index}`);
    const descriptor: ModelDescriptor = {
      ...base,
      text: { ...base.text!, columns, termCount: columns.length },
    };
    render(
      <Harness
        descriptor={descriptor}
        variables={[makeVariable("Sentimen", "nominal", "STRING")]}
      />
    );

    expect(screen.getByTestId("vector-mapping-summary")).toHaveTextContent(
      "0 of 2500 vector columns found; 2500 treated as 0."
    );
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /Show columns treated as 0 \(2500\)/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(200);

    await user.click(screen.getByRole("button", { name: /Show 200 more \(2300 remaining\)/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(400);
  });
});

describe("VariablesTab v2 — regresi v1", () => {
  it("model v1 tidak menampilkan blok Text dan tetap memakai tabel fitur", () => {
    const variables = [
      makeVariable("Outlook", "nominal", "STRING"),
      makeVariable("Temp", "scale", "NUMERIC"),
      makeVariable("Play", "nominal", "STRING"),
    ];
    render(<Harness descriptor={descriptorOf(nbModelV11)} variables={variables} />);

    expect(screen.queryByTestId("raw-text-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("vector-text-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("no-numeric-categorical-features")).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("'Auto-map by name' pada model v1 menghasilkan objek persis v1 (tanpa kunci Text)", async () => {
    const user = userEvent.setup();
    const spy = jest.fn();
    const variables = [
      makeVariable("Outlook", "nominal", "STRING"),
      makeVariable("Temp", "scale", "NUMERIC"),
      makeVariable("Play", "nominal", "STRING"),
    ];
    render(<Harness descriptor={descriptorOf(nbModelV11)} variables={variables} onChangeSpy={spy} />);

    await user.click(screen.getByRole("button", { name: "Auto-map by name" }));

    expect(spy).toHaveBeenLastCalledWith({
      FeatureMapping: { Outlook: "Outlook", Temp: "Temp" },
      ActualTargetVar: "Play",
    });
  });
});
