import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import OptionsTab, { pruneNumericOverrides } from "../../dialogs/options";
import OutputTab from "../../dialogs/output";
import TextPreprocessingTab from "../../dialogs/text-preprocessing";
import NaiveBayesContainer, {
    buildRawTextValues,
    getEffectiveNumericPredictors,
    getNaiveBayesSelectedVariables,
    getTabLeaveError,
} from "../../dialogs/naive-bayes-main";
import { mergeWithDefaults } from "../../constants/naive-bayes-default";
import { STWV_DEFAULT_CONFIG } from "@/components/Modals/Transform/StringToWordVector/config";
import type { StwvConfig } from "@/components/Modals/Transform/StringToWordVector/config";
import type {
    NaiveBayesMainType,
    NaiveBayesOptionsType,
    NaiveBayesOutputType,
    NaiveBayesType,
} from "@/components/Modals/Analyze/Classify/naive-bayes/types/naive-bayes";
import type { Variable } from "@/types/Variable";
import type { DataRow } from "@/types/Data";

// --- Mock untuk uji container (N7) -------------------------------------------------
// Store, modal, IndexedDB, toast, tab Variables (milik N6), dan service analisis dimock
// supaya container dapat dirender murni di jsdom.
const mockStoreState: { variables: Variable[]; data: DataRow[] } = { variables: [], data: [] };
const mockAnalyze = jest.fn();
const mockCloseModal = jest.fn();

jest.mock("@/stores/useVariableStore", () => ({
    useVariableStore: (selector: (state: { variables: Variable[] }) => unknown) =>
        selector({ variables: mockStoreState.variables }),
}));
jest.mock("@/stores/useDataStore", () => ({
    useDataStore: (selector: (state: { data: DataRow[] }) => unknown) =>
        selector({ data: mockStoreState.data }),
}));
jest.mock("@/hooks/useModal", () => ({
    useModal: () => ({ closeModal: mockCloseModal }),
}));
jest.mock("@/hooks/useIndexedDB", () => ({
    getFormData: async () => null,
    saveFormData: async () => undefined,
    clearFormData: async () => undefined,
}));
jest.mock("sonner", () => ({
    toast: {
        error: jest.fn(),
        info: jest.fn(),
        success: jest.fn(),
        promise: (p: Promise<unknown>) => p,
    },
}));
jest.mock("@/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-analysis", () => ({
    analyzeNaiveBayes: (...args: unknown[]) => mockAnalyze(...args),
}));
jest.mock("@/components/Modals/Analyze/Classify/naive-bayes/components/variables-tab", () => {
    const { createElement } = jest.requireActual<typeof import("react")>("react");
    return {
        __esModule: true,
        default: (props: { onChange: (update: Partial<NaiveBayesMainType>) => void }) =>
            createElement(
                "div",
                null,
                createElement(
                    "button",
                    { onClick: () => props.onChange({ TargetVar: "Kelas", RawTextVar: "Teks" }) },
                    "set-raw"
                ),
                createElement(
                    "button",
                    { onClick: () => props.onChange({ TargetVar: "Kelas", RawTextVar: null }) },
                    "set-target-only"
                )
            ),
    };
});

// Radix (RadioGroup/ScrollArea) memakai ResizeObserver yang tidak ada di jsdom.
if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
}

describe("OptionsTab", () => {
    const defaultData: NaiveBayesOptionsType = {
        MissingValuePolicy: "exclude",
        UnseenCategoryPolicy: "smoothing",
        SmoothingAlpha: 1,
        VarianceFloor: 1e-9,
        // v2 (AGENTS_V2 §4): empat field Options baru
        NumericLikelihood: "gaussian",
        NumericLikelihoodOverrides: {},
        TextLikelihood: "multinomial",
        TextAlpha: 1,
    };

    const mockUpdateFormData = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("renders with default value 1", () => {
        render(<OptionsTab data={defaultData} updateFormData={mockUpdateFormData} />);
        const input = screen.getByLabelText(/Smoothing Alpha/i);
        expect(input).toHaveValue(1);
    });

    it("calls updateFormData when valid value is entered", () => {
        render(<OptionsTab data={defaultData} updateFormData={mockUpdateFormData} />);
        const input = screen.getByLabelText(/Smoothing Alpha/i);

        fireEvent.change(input, { target: { value: "2.5" } });

        expect(mockUpdateFormData).toHaveBeenCalledWith("SmoothingAlpha", 2.5);
    });

    it("shows error for value 0", () => {
        render(<OptionsTab data={defaultData} updateFormData={mockUpdateFormData} />);
        const input = screen.getByLabelText(/Smoothing Alpha/i);

        fireEvent.change(input, { target: { value: "0" } });

        expect(screen.getByText(/must be greater than 0/i)).toBeInTheDocument();
        expect(mockUpdateFormData).not.toHaveBeenCalled();
    });

    it("shows error for negative value", () => {
        render(<OptionsTab data={defaultData} updateFormData={mockUpdateFormData} />);
        const input = screen.getByLabelText(/Smoothing Alpha/i);

        fireEvent.change(input, { target: { value: "-1" } });

        expect(screen.getByText(/must be greater than 0/i)).toBeInTheDocument();
        expect(mockUpdateFormData).not.toHaveBeenCalled();
    });

    it("shows error for value > 999", () => {
        render(<OptionsTab data={defaultData} updateFormData={mockUpdateFormData} />);
        const input = screen.getByLabelText(/Smoothing Alpha/i);

        fireEvent.change(input, { target: { value: "1000" } });

        expect(screen.getByText(/must not exceed 999/i)).toBeInTheDocument();
        expect(mockUpdateFormData).not.toHaveBeenCalled();
    });

    it("accepts decimal values", () => {
        render(<OptionsTab data={defaultData} updateFormData={mockUpdateFormData} />);
        const input = screen.getByLabelText(/Smoothing Alpha/i);

        fireEvent.change(input, { target: { value: "0.5" } });

        expect(screen.queryByText(/must be greater than 0/i)).not.toBeInTheDocument();
        expect(mockUpdateFormData).toHaveBeenCalledWith("SmoothingAlpha", 0.5);
    });

    it("syncs local state when data prop changes", () => {
        const { rerender } = render(
            <OptionsTab data={defaultData} updateFormData={mockUpdateFormData} />
        );

        const newData = { ...defaultData, SmoothingAlpha: 5 };
        rerender(<OptionsTab data={newData} updateFormData={mockUpdateFormData} />);

        const input = screen.getByLabelText(/Smoothing Alpha/i);
        expect(input).toHaveValue(5);
    });
});

// =====================================================================================
// N7 — Options v2
// =====================================================================================
describe("OptionsTab v2", () => {
    const baseData: NaiveBayesOptionsType = {
        MissingValuePolicy: "exclude",
        UnseenCategoryPolicy: "smoothing",
        SmoothingAlpha: 1,
        VarianceFloor: 1e-9,
        NumericLikelihood: "gaussian",
        NumericLikelihoodOverrides: {},
        TextLikelihood: "multinomial",
        TextAlpha: 1,
    };
    const update = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("Complement disabled (dengan penjelasan) saat ada predictor Numeric/Categorical", () => {
        render(
            <OptionsTab
                data={baseData}
                updateFormData={update}
                numericVariables={["Umur"]}
                hasTextFeatures
                hasOtherPredictors
            />
        );
        expect(screen.getByRole("radio", { name: "Complement" })).toBeDisabled();
        expect(screen.getByRole("radio", { name: "Multinomial" })).toBeEnabled();
        expect(screen.getByRole("radio", { name: "Bernoulli" })).toBeEnabled();
        expect(screen.getByText(/Complement is only available when the model contains Text Features only/i)).toBeInTheDocument();
    });

    it("Complement enabled bila model hanya berisi Text Features", () => {
        render(<OptionsTab data={baseData} updateFormData={update} hasTextFeatures hasOtherPredictors={false} />);
        const complement = screen.getByRole("radio", { name: "Complement" });
        expect(complement).toBeEnabled();
        fireEvent.click(complement);
        expect(update).toHaveBeenCalledWith("TextLikelihood", "complement");
    });

    it("pilihan tersimpan complement + predictor lain menampilkan galat", () => {
        render(
            <OptionsTab
                data={{ ...baseData, TextLikelihood: "complement" }}
                updateFormData={update}
                hasTextFeatures
                hasOtherPredictors
            />
        );
        expect(screen.getByRole("alert")).toHaveTextContent(/Complement/i);
    });

    it("blok Text nonaktif tanpa Text Features", () => {
        render(<OptionsTab data={baseData} updateFormData={update} />);
        expect(screen.getByRole("radio", { name: "Multinomial" })).toBeDisabled();
        expect(screen.getByLabelText(/Text Alpha/i)).toBeDisabled();
    });

    it("TextAlpha tidak sah tidak diteruskan, nilai sah diteruskan", () => {
        render(<OptionsTab data={baseData} updateFormData={update} hasTextFeatures />);
        const input = screen.getByLabelText(/Text Alpha/i);
        fireEvent.change(input, { target: { value: "0" } });
        expect(update).not.toHaveBeenCalled();
        expect(screen.getByText("Text Alpha must be greater than 0")).toBeInTheDocument();
        fireEvent.change(input, { target: { value: "0.5" } });
        expect(update).toHaveBeenCalledWith("TextAlpha", 0.5);
    });

    it("radio Numeric memilih Gaussian (Weka min. std)", () => {
        render(<OptionsTab data={baseData} updateFormData={update} />);
        fireEvent.click(screen.getByRole("radio", { name: "Gaussian (Weka min. std)" }));
        expect(update).toHaveBeenCalledWith("NumericLikelihood", "gaussian_minstd");
    });

    it("override per variabel: set lalu kembali ke Group default menghapus kunci", () => {
        const { rerender } = render(
            <OptionsTab data={baseData} updateFormData={update} numericVariables={["Umur", "Tinggi"]} />
        );
        fireEvent.change(screen.getByLabelText("Likelihood for Umur"), { target: { value: "gaussian_minstd" } });
        expect(update).toHaveBeenLastCalledWith("NumericLikelihoodOverrides", { Umur: "gaussian_minstd" });

        rerender(
            <OptionsTab
                data={{ ...baseData, NumericLikelihoodOverrides: { Umur: "gaussian_minstd", Tinggi: "gaussian" } }}
                updateFormData={update}
                numericVariables={["Umur", "Tinggi"]}
            />
        );
        fireEvent.change(screen.getByLabelText("Likelihood for Umur"), { target: { value: "default" } });
        expect(update).toHaveBeenLastCalledWith("NumericLikelihoodOverrides", { Tinggi: "gaussian" });
    });

    it("kotak filter tabel override hanya muncul bila variabel Numeric > 50", () => {
        const fifty = Array.from({ length: 50 }, (_, i) => `V${i}`);
        const { rerender } = render(
            <OptionsTab data={baseData} updateFormData={update} numericVariables={fifty} />
        );
        expect(screen.queryByLabelText("Filter numeric variables")).not.toBeInTheDocument();

        const many = [...fifty, "Umur"];
        rerender(<OptionsTab data={baseData} updateFormData={update} numericVariables={many} />);
        const filter = screen.getByLabelText("Filter numeric variables");
        fireEvent.change(filter, { target: { value: "umur" } });
        expect(screen.getByLabelText("Likelihood for Umur")).toBeInTheDocument();
        expect(screen.queryByLabelText("Likelihood for V1")).not.toBeInTheDocument();
    });

    it("pruneNumericOverrides membuang variabel yang tidak lagi Numeric", () => {
        const overrides = { Umur: "gaussian_minstd", Hilang: "gaussian" } as const;
        const pruned = pruneNumericOverrides({ ...overrides }, ["Umur"]);
        expect(pruned).toEqual({ Umur: "gaussian_minstd" });
        const same = { Umur: "gaussian" as const };
        expect(pruneNumericOverrides(same, ["Umur"])).toBe(same);
    });
});

// =====================================================================================
// N7 — Output v2
// =====================================================================================
describe("OutputTab v2", () => {
    const output: NaiveBayesOutputType = {
        CaseProcessingSummary: true,
        AttributeDistributionTable: true,
        ModelEvaluationMetrics: true,
        ConfusionMatrix: true,
        TextFeatureTable: true,
        TextTopK: 100,
    };
    const update = jest.fn();

    beforeEach(() => jest.clearAllMocks());

    it("Text Feature Table dan Top-k nonaktif tanpa Text Features", () => {
        render(<OutputTab data={output} updateFormData={update} />);
        expect(screen.getByLabelText("Text Feature Table")).toBeDisabled();
        expect(screen.getByLabelText("Top-k terms per class")).toBeDisabled();
    });

    it("Top-k hanya meneruskan bilangan bulat 1-1000", () => {
        render(<OutputTab data={output} updateFormData={update} hasTextFeatures />);
        const input = screen.getByLabelText("Top-k terms per class");
        expect(input).toHaveValue(100);

        fireEvent.change(input, { target: { value: "0" } });
        fireEvent.change(input, { target: { value: "1001" } });
        fireEvent.change(input, { target: { value: "2.5" } });
        expect(update).not.toHaveBeenCalled();
        expect(screen.getByText(/whole number between 1 and 1000/i)).toBeInTheDocument();

        fireEvent.change(input, { target: { value: "25" } });
        expect(update).toHaveBeenCalledWith("TextTopK", 25);
    });

    it("mencentang Text Feature Table memanggil updateFormData", () => {
        render(<OutputTab data={{ ...output, TextFeatureTable: false }} updateFormData={update} hasTextFeatures />);
        fireEvent.click(screen.getByLabelText("Text Feature Table"));
        expect(update).toHaveBeenCalledWith("TextFeatureTable", true);
    });
});

// =====================================================================================
// N7 — Text Preprocessing
// =====================================================================================
describe("TextPreprocessingTab", () => {
    it("memakai OptionsTab STWV tanpa bagian Vector Column Name dan tanpa galat pada default", () => {
        render(<TextPreprocessingTab config={STWV_DEFAULT_CONFIG} setConfig={jest.fn()} />);
        expect(screen.getByText("Stopwords Removal")).toBeInTheDocument();
        expect(screen.queryByText("Vector Column Name")).not.toBeInTheDocument();
        expect(screen.queryByTestId("text-preprocessing-errors")).not.toBeInTheDocument();
    });

    it("menampilkan galat validateStwvConfig", () => {
        const invalid: StwvConfig = { ...STWV_DEFAULT_CONFIG, minTermFreq: 0 };
        render(<TextPreprocessingTab config={invalid} setConfig={jest.fn()} />);
        expect(within(screen.getByTestId("text-preprocessing-errors")).getByText(/Min term frequency/i)).toBeInTheDocument();
    });
});

// =====================================================================================
// N7 — Container: helper murni + render
// =====================================================================================
const makeVar = (name: string, columnIndex: number, measure: string, type: string): Variable =>
    ({ name, columnIndex, measure, type } as unknown as Variable);

describe("helper container v2", () => {
    const vars = [
        makeVar("Kelas", 0, "nominal", "STRING"),
        makeVar("Teks", 1, "nominal", "STRING"),
        makeVar("Umur", 2, "scale", "NUMERIC"),
        makeVar("Paslon", 3, "nominal", "STRING"),
    ];
    const baseMain = mergeWithDefaults(null).main;

    it("getEffectiveNumericPredictors: exclude memakai measure scale; candidates memakai CandidateCovariates", () => {
        expect(getEffectiveNumericPredictors({ ...baseMain, TargetVar: "Kelas" }, vars)).toEqual(["Umur"]);
        expect(
            getEffectiveNumericPredictors(
                { ...baseMain, TargetVar: "Kelas", SpecificationMode: "candidates", CandidateCovariates: ["Umur"] },
                vars
            )
        ).toEqual(["Umur"]);
    });

    it("getNaiveBayesSelectedVariables: raw TIDAK ikut slice, vector ikut di ekor", () => {
        const raw = getNaiveBayesSelectedVariables(
            { ...baseMain, TargetVar: "Kelas", RawTextVar: "Teks", ExcludedVar: ["Umur", "Paslon"] },
            vars
        );
        expect(raw).toEqual(["Kelas"]);
        const vec = getNaiveBayesSelectedVariables(
            { ...baseMain, TargetVar: "Kelas", TextVectorVars: ["Umur"], ExcludedVar: ["Teks", "Paslon"] },
            vars
        );
        expect(vec).toEqual(["Kelas", "Umur"]);
    });

    it("buildRawTextValues membaca sel asli (tanpa parseFloat)", () => {
        const data: DataRow[] = [["pos", "3 kucing lucu"], ["neg", 42], ["pos", null]];
        const main = { ...baseMain, TargetVar: "Kelas", RawTextVar: "Teks" };
        expect(buildRawTextValues(main, vars, data, 3)).toEqual(["3 kucing lucu", 42, null]);
        expect(buildRawTextValues({ ...baseMain, TargetVar: "Kelas" }, vars, data, 3)).toBeUndefined();
        expect(buildRawTextValues({ ...main, RawTextVar: "TidakAda" }, vars, data, 3)).toBeUndefined();
    });

    it("getTabLeaveError hanya menahan galat milik tab itu", () => {
        const form: NaiveBayesType = mergeWithDefaults({
            validation: { ValidationMethod: "holdout", TrainingPercentage: 150 },
            main: { RawTextVar: "Teks" },
            text: { minTermFreq: 0 },
        });
        expect(getTabLeaveError("validation", form)).toMatch(/Training percentage/);
        expect(getTabLeaveError("options", form)).toBeNull();
        expect(getTabLeaveError("output", form)).toBeNull();
        expect(getTabLeaveError("variables", form)).toBeNull();
        expect(getTabLeaveError("text", form)).toMatch(/Min term frequency/);
        // jalur selain raw: konfigurasi teks tidak ditahan
        expect(getTabLeaveError("text", { ...form, main: { ...form.main, RawTextVar: null } })).toBeNull();
    });
});

describe("NaiveBayesContainer v2", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAnalyze.mockResolvedValue({});
        mockStoreState.variables = [
            makeVar("Kelas", 0, "nominal", "STRING"),
            makeVar("Teks", 1, "nominal", "STRING"),
        ];
        mockStoreState.data = [
            ["pos", "3 kucing lucu"],
            ["neg", "2024 pilkada seru"],
            ["pos", ""],
        ];
    });

    it("tab Text Preprocessing disabled tanpa Raw Text dan aktif setelah Raw Text terisi", async () => {
        render(<NaiveBayesContainer onClose={jest.fn()} />);
        const textTab = await screen.findByRole("tab", { name: /Text Preprocessing/i });
        expect(textTab).toBeDisabled();

        fireEvent.click(screen.getByText("set-raw"));
        await waitFor(() => expect(screen.getByRole("tab", { name: /Text Preprocessing/i })).toBeEnabled());

        fireEvent.click(screen.getByText("set-target-only"));
        await waitFor(() => expect(screen.getByRole("tab", { name: /Text Preprocessing/i })).toBeDisabled());
    });

    it('"3 kucing lucu" tetap utuh sampai payload (rawTextValues dari useDataStore.data)', async () => {
        render(<NaiveBayesContainer onClose={jest.fn()} />);
        await screen.findByRole("tab", { name: /Variables/i });
        fireEvent.click(screen.getByText("set-raw"));
        const ok = screen.getByRole("button", { name: "OK" });
        await waitFor(() => expect(ok).toBeEnabled());
        fireEvent.click(ok);

        await waitFor(() => expect(mockAnalyze).toHaveBeenCalledTimes(1));
        const args = mockAnalyze.mock.calls[0][0] as {
            configData: NaiveBayesType;
            dataVariables: unknown[];
            rawTextValues?: unknown[];
        };
        // Kolom Raw Text tidak ikut getSlicedData (hanya target).
        expect(args.dataVariables).toHaveLength(1);
        expect(args.rawTextValues).toEqual(["3 kucing lucu", "2024 pilkada seru", ""]);

        // Sampai payload akhir: builder N5 yang asli menjaga teks tetap utuh.
        const { buildNaiveBayesTextPayload } = jest.requireActual<
            typeof import("@/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-analysis")
        >("@/components/Modals/Analyze/Classify/naive-bayes/services/naive-bayes-analysis");
        const payload = buildNaiveBayesTextPayload(args.configData.main, [], 3, args.rawTextValues);
        expect(payload).toEqual({
            source: "raw",
            variable: "Teks",
            values: ["3 kucing lucu", "2024 pilkada seru", null],
        });
    });
});
