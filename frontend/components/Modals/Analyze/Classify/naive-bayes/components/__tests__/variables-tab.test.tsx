import React, { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import VariablesTab, {
    moveVariables,
    readZoneLists,
    reorderWithin,
    isAllowedInZone,
} from "../variables-tab";
import { filterVariablesByText } from "../dataset-variable-list";
import type { NaiveBayesMainType } from "@/components/Modals/Analyze/Classify/naive-bayes/types/naive-bayes";
import type { Variable, VariableMeasure, VariableType } from "@/types/Variable";

// Data dataset tiruan untuk peringatan W-VEC/W-STR (dibaca lewat useDataStore).
let mockData: unknown[][] = [];
jest.mock("@/stores/useDataStore", () => ({
    useDataStore: (selector: (state: { data: unknown[][] }) => unknown) =>
        selector({ data: mockData }),
}));

function makeVar(
    name: string,
    columnIndex: number,
    type: VariableType,
    measure: VariableMeasure,
    label?: string
): Variable {
    return {
        columnIndex,
        name,
        type,
        label,
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

const BASE_MAIN: NaiveBayesMainType = {
    TargetVar: null,
    SpecificationMode: "exclude",
    ExcludedVar: [],
    CandidateFactors: [],
    CandidateCovariates: [],
    TextSource: "none",
    RawTextVar: null,
    TextVectorVars: null,
};

const VARS: Variable[] = [
    makeVar("VEC_makan", 0, "NUMERIC", "scale"),
    makeVar("VEC_nasi", 1, "NUMERIC", "scale"),
    makeVar("VEC_saya", 2, "NUMERIC", "scale"),
    makeVar("Umur", 3, "NUMERIC", "scale", "Umur responden"),
    makeVar("Kelas", 4, "STRING", "nominal"),
    makeVar("Teks", 5, "STRING", "nominal"),
];

const byName = new Map(VARS.map((v) => [v.name, v]));

function Harness({
    variables = VARS,
    initial = BASE_MAIN,
}: {
    variables?: Variable[];
    initial?: NaiveBayesMainType;
}) {
    const [main, setMain] = useState<NaiveBayesMainType>(initial);
    return (
        <>
            <VariablesTab
                allVariables={variables}
                formData={main}
                onChange={(update) => setMain((prev) => ({ ...prev, ...update }))}
            />
            <pre data-testid="state">{JSON.stringify(main)}</pre>
        </>
    );
}

const readState = (): NaiveBayesMainType =>
    JSON.parse(screen.getByTestId("state").textContent ?? "{}") as NaiveBayesMainType;

const availableNames = (): string[] =>
    within(screen.getByTestId("nb-available-list"))
        .queryAllByRole("option")
        .map((el) => el.getAttribute("data-testid")?.replace("nb-available-item-", "") ?? "");

const selectedNames = (): string[] =>
    within(screen.getByTestId("nb-available-list"))
        .queryAllByRole("option")
        .filter((el) => el.getAttribute("aria-selected") === "true")
        .map((el) => el.getAttribute("data-testid")?.replace("nb-available-item-", "") ?? "");

const typeFilter = (text: string) =>
    fireEvent.change(screen.getByTestId("nb-variable-filter"), { target: { value: text } });

beforeEach(() => {
    mockData = [];
});

describe("filterVariablesByText", () => {
    it("case-insensitive, mencocokkan nama atau label, awalan VEC_ ikut", () => {
        expect(filterVariablesByText(VARS, "vec_").map((v) => v.name)).toEqual([
            "VEC_makan",
            "VEC_nasi",
            "VEC_saya",
        ]);
        // cocok lewat label ("Umur responden"), bukan nama
        expect(filterVariablesByText(VARS, "RESPONDEN").map((v) => v.name)).toEqual(["Umur"]);
        // kosong/spasi saja = semua
        expect(filterVariablesByText(VARS, "   ")).toHaveLength(VARS.length);
        expect(filterVariablesByText(VARS, "tidak-ada")).toEqual([]);
    });
});

describe("DatasetVariableList lewat VariablesTab: filter + Select All (filtered)", () => {
    it("filter VEC_ + Select All menyorot HANYA variabel yang cocok", () => {
        render(<Harness />);
        expect(availableNames()).toHaveLength(6);

        typeFilter("VEC_");
        expect(availableNames()).toEqual(["VEC_makan", "VEC_nasi", "VEC_saya"]);

        fireEvent.click(screen.getByTestId("nb-select-all-filtered"));
        expect(selectedNames()).toEqual(["VEC_makan", "VEC_nasi", "VEC_saya"]);
        expect(screen.getByTestId("nb-available-count")).toHaveTextContent("3 shown, 3 selected");

        // Variabel di luar filter tidak ikut tersorot.
        typeFilter("");
        expect(selectedNames()).toEqual(["VEC_makan", "VEC_nasi", "VEC_saya"]);
        expect(selectedNames()).not.toContain("Umur");
    });

    it("mengubah filter membuang sorotan pada variabel yang tersembunyi", () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId("nb-select-all-filtered")); // semua 6
        expect(selectedNames()).toHaveLength(6);
        typeFilter("umur");
        expect(selectedNames()).toEqual(["Umur"]);
        typeFilter("");
        expect(selectedNames()).toEqual(["Umur"]);
    });

    it("Shift-range bekerja pada daftar yang terfilter", () => {
        render(<Harness />);
        typeFilter("vec_");
        fireEvent.click(screen.getByTestId("nb-available-item-VEC_makan"));
        fireEvent.click(screen.getByTestId("nb-available-item-VEC_saya"), { shiftKey: true });
        expect(selectedNames()).toEqual(["VEC_makan", "VEC_nasi", "VEC_saya"]);
    });

    it("Ctrl-klik menambah/mengurangi sorotan satu per satu", () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId("nb-available-item-Umur"));
        fireEvent.click(screen.getByTestId("nb-available-item-Kelas"), { ctrlKey: true });
        expect(selectedNames().sort()).toEqual(["Kelas", "Umur"]);
        fireEvent.click(screen.getByTestId("nb-available-item-Umur"), { ctrlKey: true });
        expect(selectedNames()).toEqual(["Kelas"]);
    });

    it("drag item yang tersorot membawa SELURUH sorotan; item lain hanya dirinya", () => {
        render(<Harness />);
        typeFilter("vec_");
        fireEvent.click(screen.getByTestId("nb-select-all-filtered"));

        const setData = jest.fn();
        fireEvent.dragStart(screen.getByTestId("nb-available-item-VEC_nasi"), {
            dataTransfer: { setData, effectAllowed: "" },
        });
        const payload = JSON.parse(setData.mock.calls[0][1] as string) as {
            source: string;
            names: string[];
        };
        expect(payload).toEqual({
            source: "available",
            names: ["VEC_makan", "VEC_nasi", "VEC_saya"],
        });

        typeFilter("");
        const setData2 = jest.fn();
        fireEvent.dragStart(screen.getByTestId("nb-available-item-Umur"), {
            dataTransfer: { setData: setData2, effectAllowed: "" },
        });
        expect(JSON.parse(setData2.mock.calls[0][1] as string)).toEqual({
            source: "available",
            names: ["Umur"],
        });
    });
});

describe("VariablesTab: pemindahan multi-variabel & slot Text Features", () => {
    it("Select All (filtered) lalu tombol panah memindahkan semuanya ke Word-Vector Variables", () => {
        render(<Harness />);
        typeFilter("VEC_");
        fireEvent.click(screen.getByTestId("nb-select-all-filtered"));
        fireEvent.click(screen.getByTestId("nb-move-to-wordVector"));

        const state = readState();
        expect(state.TextVectorVars).toEqual(["VEC_makan", "VEC_nasi", "VEC_saya"]);
        expect(state.TextSource).toBe("vector");
        expect(state.RawTextVar).toBeNull();
        typeFilter("");
        expect(availableNames()).toEqual(["Kelas", "Teks", "Umur"]);
    });

    it("memasukkan ke Raw Text mengosongkan Word-Vector (dan sebaliknya)", () => {
        render(<Harness />);
        typeFilter("VEC_");
        fireEvent.click(screen.getByTestId("nb-select-all-filtered"));
        fireEvent.click(screen.getByTestId("nb-move-to-wordVector"));
        expect(readState().TextVectorVars).toHaveLength(3);

        // Teks -> Raw Text: Word-Vector dikosongkan, isinya kembali ke Available.
        typeFilter("");
        fireEvent.click(screen.getByTestId("nb-available-item-Teks"));
        fireEvent.click(screen.getByTestId("nb-move-to-rawText"));
        let state = readState();
        expect(state.RawTextVar).toBe("Teks");
        expect(state.TextVectorVars).toBeNull();
        expect(state.TextSource).toBe("raw");
        expect(availableNames()).toEqual(
            expect.arrayContaining(["VEC_makan", "VEC_nasi", "VEC_saya"])
        );
        expect(screen.queryByTestId("nb-zone-item-wordVector-VEC_makan")).toBeNull();

        // Sebaliknya: Word-Vector terisi -> Raw Text dikosongkan.
        fireEvent.click(screen.getByTestId("nb-available-item-Umur"));
        fireEvent.click(screen.getByTestId("nb-move-to-wordVector"));
        state = readState();
        expect(state.RawTextVar).toBeNull();
        expect(state.TextVectorVars).toEqual(["Umur"]);
        expect(state.TextSource).toBe("vector");
        expect(availableNames()).toContain("Teks");
    });

    it("aturan tipe: STRING tidak bisa ke Word-Vector, NUMERIC tidak bisa ke Raw Text", () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId("nb-available-item-Teks"));
        expect(screen.queryByTestId("nb-move-to-wordVector")).toBeNull();
        expect(screen.getByTestId("nb-move-to-rawText")).toBeInTheDocument();

        fireEvent.click(screen.getByTestId("nb-available-item-Umur"));
        expect(screen.queryByTestId("nb-move-to-rawText")).toBeNull();
        expect(screen.getByTestId("nb-move-to-wordVector")).toBeInTheDocument();
    });

    it("sorotan campuran: hanya variabel yang lolos aturan yang dipindah ke slot", () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId("nb-select-all-filtered")); // 6 variabel
        fireEvent.click(screen.getByTestId("nb-move-to-wordVector"));
        // Hanya 4 NUMERIC yang pindah (urut sesuai daftar terurut nama: Umur dulu); 2 STRING tetap di Available dan tetap tersorot.
        expect(readState().TextVectorVars).toEqual(["Umur", "VEC_makan", "VEC_nasi", "VEC_saya"]);
        expect(availableNames()).toEqual(["Kelas", "Teks"]);
        expect(selectedNames()).toEqual(["Kelas", "Teks"]);
    });

    it("tombol panah kembali memindahkan item zona ke Available", () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId("nb-available-item-Teks"));
        fireEvent.click(screen.getByTestId("nb-move-to-rawText"));
        fireEvent.click(screen.getByTestId("nb-zone-item-rawText-Teks"));
        fireEvent.click(screen.getByTestId("nb-move-back-rawText"));
        expect(readState().RawTextVar).toBeNull();
        expect(readState().TextSource).toBe("none");
        expect(availableNames()).toContain("Teks");
    });

    it("drop muatan multi-variabel ke zona memindahkan semuanya; urut ulang dalam zona", () => {
        render(<Harness />);
        const payload = JSON.stringify({ source: "available", names: ["VEC_makan", "VEC_nasi", "VEC_saya"] });
        fireEvent.drop(screen.getByTestId("nb-zone-list-wordVector"), {
            dataTransfer: { getData: () => payload },
        });
        expect(readState().TextVectorVars).toEqual(["VEC_makan", "VEC_nasi", "VEC_saya"]);

        // Urut ulang: VEC_saya dijatuhkan di atas item indeks 0.
        const reorder = JSON.stringify({ source: "wordVector", names: ["VEC_saya"] });
        fireEvent.drop(screen.getByTestId("nb-zone-item-wordVector-VEC_makan"), {
            dataTransfer: { getData: () => reorder },
        });
        expect(readState().TextVectorVars).toEqual(["VEC_saya", "VEC_makan", "VEC_nasi"]);

        // Drop ke panel kiri mengembalikan ke Available.
        fireEvent.drop(screen.getByTestId("nb-available-panel"), {
            dataTransfer: {
                getData: () => JSON.stringify({ source: "wordVector", names: ["VEC_saya"] }),
            },
        });
        expect(readState().TextVectorVars).toEqual(["VEC_makan", "VEC_nasi"]);
        expect(availableNames()).toContain("VEC_saya");
    });

    it("muatan drop tidak sah diabaikan tanpa galat", () => {
        render(<Harness />);
        fireEvent.drop(screen.getByTestId("nb-zone-list-wordVector"), {
            dataTransfer: { getData: () => "bukan-json" },
        });
        fireEvent.drop(screen.getByTestId("nb-zone-list-wordVector"), {
            dataTransfer: { getData: () => "" },
        });
        expect(readState().TextVectorVars).toBeNull();
    });

    it("perilaku v1: double-click pertama mengisi Target, berikutnya ke Excluded (mode exclude)", () => {
        render(<Harness />);
        fireEvent.doubleClick(screen.getByTestId("nb-available-item-Kelas"));
        expect(readState().TargetVar).toBe("Kelas");
        fireEvent.doubleClick(screen.getByTestId("nb-available-item-Umur"));
        expect(readState().ExcludedVar).toEqual(["Umur"]);
        // double-click di zona mengembalikan ke Available
        fireEvent.doubleClick(screen.getByTestId("nb-zone-item-excluded-Umur"));
        expect(readState().ExcludedVar).toEqual([]);
        expect(availableNames()).toContain("Umur");
    });

    it("perilaku v1: pindah ke Candidates mengosongkan Excluded (mode saling eksklusif)", () => {
        render(
            <Harness
                initial={{ ...BASE_MAIN, TargetVar: "Kelas", ExcludedVar: ["VEC_makan"] }}
            />
        );
        fireEvent.click(screen.getByTestId("nb-available-item-Umur"));
        fireEvent.click(screen.getByTestId("nb-move-to-covariates"));
        const state = readState();
        expect(state.SpecificationMode).toBe("candidates");
        expect(state.CandidateCovariates).toEqual(["Umur"]);
        expect(state.ExcludedVar).toEqual([]);
        expect(availableNames()).toContain("VEC_makan");
    });
});

describe("moveVariables (fungsi murni)", () => {
    it("variabel tidak pernah berada di dua tempat", () => {
        const main: NaiveBayesMainType = {
            ...BASE_MAIN,
            TargetVar: "Kelas",
            ExcludedVar: ["Umur", "VEC_makan"],
        };
        const result = moveVariables(main, ["Umur"], "wordVector", byName);
        expect(result).not.toBeNull();
        const next = { ...main, ...(result?.update ?? {}) } as NaiveBayesMainType;
        const lists = readZoneLists(next);
        const all = Object.values(lists).flat();
        expect(new Set(all).size).toBe(all.length);
        expect(lists.wordVector).toEqual(["Umur"]);
        expect(lists.excluded).toEqual(["VEC_makan"]);
    });

    it("memindahkan target yang sudah ada ke Excluded mencabutnya dari Target", () => {
        const main: NaiveBayesMainType = { ...BASE_MAIN, TargetVar: "Kelas" };
        const result = moveVariables(main, ["Kelas"], "excluded", byName);
        expect(result?.update.TargetVar).toBeNull();
        expect(result?.update.ExcludedVar).toEqual(["Kelas"]);
    });

    it("zona maxItems=1 memakai variabel lolos pertama dan melepas isi lama", () => {
        const main: NaiveBayesMainType = { ...BASE_MAIN, RawTextVar: "Kelas", TextSource: "raw" };
        const result = moveVariables(main, ["Umur", "Teks"], "rawText", byName);
        expect(result?.moved).toEqual(["Teks"]);
        expect(result?.update.RawTextVar).toBe("Teks");
        expect(result?.update.TextVectorVars).toBeNull();
    });

    it("mengembalikan null bila tidak ada variabel yang lolos aturan", () => {
        expect(moveVariables(BASE_MAIN, ["Teks"], "wordVector", byName)).toBeNull();
        expect(moveVariables(BASE_MAIN, ["Umur"], "rawText", byName)).toBeNull();
        expect(moveVariables(BASE_MAIN, ["tidak-ada"], "excluded", byName)).toBeNull();
        expect(moveVariables(BASE_MAIN, [], "excluded", byName)).toBeNull();
    });

    it("TextSource dijaga konsisten dengan isi slot", () => {
        const toVector = moveVariables(BASE_MAIN, ["VEC_makan"], "wordVector", byName);
        expect(toVector?.update.TextSource).toBe("vector");
        const afterVector = { ...BASE_MAIN, ...(toVector?.update ?? {}) } as NaiveBayesMainType;
        const back = moveVariables(afterVector, ["VEC_makan"], "available", byName);
        expect(back?.update.TextSource).toBe("none");
        expect(back?.update.TextVectorVars).toBeNull();
    });

    it("readZoneLists: Raw Text menang atas Word-Vector pada state tidak konsisten", () => {
        const lists = readZoneLists({
            ...BASE_MAIN,
            RawTextVar: "Teks",
            TextVectorVars: ["VEC_makan"],
        });
        expect(lists.rawText).toEqual(["Teks"]);
        expect(lists.wordVector).toEqual([]);
    });

    it("isAllowedInZone: Target nominal/ordinal, Raw STRING, Word-Vector NUMERIC", () => {
        expect(isAllowedInZone(byName.get("Kelas") as Variable, "target")).toBe(true);
        expect(isAllowedInZone(byName.get("Umur") as Variable, "target")).toBe(false);
        expect(isAllowedInZone(byName.get("Teks") as Variable, "rawText")).toBe(true);
        expect(isAllowedInZone(byName.get("Umur") as Variable, "wordVector")).toBe(true);
        expect(isAllowedInZone(byName.get("Teks") as Variable, "wordVector")).toBe(false);
    });

    it("reorderWithin menyisipkan pada indeks daftar asli", () => {
        expect(reorderWithin(["a", "b", "c", "d"], ["d"], 0)).toEqual(["d", "a", "b", "c"]);
        expect(reorderWithin(["a", "b", "c", "d"], ["a"], 3)).toEqual(["b", "c", "a", "d"]);
        expect(reorderWithin(["a", "b", "c"], ["x"], 1)).toEqual(["a", "b", "c"]);
    });
});

describe("VariablesTab: peringatan non-blokir (AGENTS_V2 §3.4)", () => {
    it("W-LEAK muncul bila Word-Vector Variables terisi", () => {
        render(<Harness />);
        expect(screen.queryByTestId("nb-text-warnings")).toBeNull();
        fireEvent.click(screen.getByTestId("nb-available-item-Umur"));
        fireEvent.click(screen.getByTestId("nb-move-to-wordVector"));
        expect(screen.getByTestId("nb-text-warnings")).toHaveTextContent(
            "The vocabulary and IDF of these vector columns were computed outside Naive Bayes on all rows, so evaluation results may be slightly optimistic."
        );
    });

    it("W-VEC muncul bila >= 20 kolom numerik tampak seperti vektor kata", () => {
        const vecVars = Array.from({ length: 20 }, (_, i) =>
            makeVar(`T${i}`, i, "NUMERIC", "scale")
        );
        const variables = [...vecVars, makeVar("Kelas", 20, "STRING", "nominal")];
        // 10 baris: kolom hampir seluruhnya 0 (>50% nol, tidak ada negatif).
        mockData = Array.from({ length: 10 }, (_, r) => [
            ...vecVars.map(() => (r === 0 ? 1 : 0)),
            "a",
        ]);
        render(<Harness variables={variables} initial={{ ...BASE_MAIN, TargetVar: "Kelas" }} />);
        expect(screen.getByTestId("nb-text-warnings")).toHaveTextContent(
            "20 numeric columns look like word vectors. Move them to Text Features to use a text likelihood such as Multinomial."
        );
    });

    it("W-VEC tidak muncul pada 19 kolom", () => {
        const vecVars = Array.from({ length: 19 }, (_, i) =>
            makeVar(`T${i}`, i, "NUMERIC", "scale")
        );
        const variables = [...vecVars, makeVar("Kelas", 19, "STRING", "nominal")];
        mockData = Array.from({ length: 10 }, (_, r) => [
            ...vecVars.map(() => (r === 0 ? 1 : 0)),
            "a",
        ]);
        render(<Harness variables={variables} initial={{ ...BASE_MAIN, TargetVar: "Kelas" }} />);
        expect(screen.queryByTestId("nb-text-warnings")).toBeNull();
    });

    it("W-STR muncul untuk kolom STRING yang tampak seperti teks bebas/ID", () => {
        const variables = [
            makeVar("Kelas", 0, "STRING", "nominal"),
            makeVar("IDUser", 1, "STRING", "nominal"),
        ];
        mockData = Array.from({ length: 10 }, (_, r) => [r % 2 === 0 ? "a" : "b", `id-${r}`]);
        render(<Harness variables={variables} initial={{ ...BASE_MAIN, TargetVar: "Kelas" }} />);
        const warnings = screen.getAllByTestId("nb-text-warning");
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toHaveTextContent(
            "Column 'IDUser' looks like free text or an ID. Exclude it or move it to Text Features."
        );
    });

    it("peringatan tidak memblokir interaksi (tombol panah tetap bekerja)", () => {
        render(<Harness initial={{ ...BASE_MAIN, TextSource: "vector", TextVectorVars: ["Umur"] }} />);
        expect(screen.getByTestId("nb-text-warnings")).toBeInTheDocument();
        fireEvent.click(screen.getByTestId("nb-available-item-Teks"));
        fireEvent.click(screen.getByTestId("nb-move-to-rawText"));
        expect(readState().RawTextVar).toBe("Teks");
        // Slot vector dikosongkan -> W-LEAK hilang.
        expect(screen.queryByTestId("nb-text-warnings")).toBeNull();
    });
});
