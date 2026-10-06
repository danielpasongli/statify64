/**
 * Definisi standar rumus vektorisasi STWV (PLAN_FIX §3.1, keputusan D5).
 * File murni (tanpa React/hook) agar bisa dipakai ulang di NB v2.
 */

/** Standar rumus: Weka (default), scikit-learn, atau Custom. */
export type FormulaStandard = "weka" | "sklearn" | "custom";

/** Metode TF (opsi "none" v1 sudah dihapus karena identik dengan "binary", F22). */
export type TfMethod = "binary" | "raw" | "log1p" | "sublinear" | "normalized";

/** Metode IDF. */
export type IdfMethod = "none" | "standard" | "smooth" | "plus1";

/** Normalisasi baris. */
export type Normalization = "none" | "l1" | "l2" | "doc_length";

export interface FormulaOption<T extends string> {
    value: T;
    /** Label UI (Bahasa Inggris). */
    label: string;
    /** Rumus singkat untuk tooltip. */
    formula: string;
}

export interface FormulaDefaults {
    tfMethod: TfMethod;
    idfMethod: IdfMethod;
    normalization: Normalization;
}

export interface FormulaStandardDefinition {
    id: FormulaStandard;
    label: string;
    description: string;
    tfOptions: readonly FormulaOption<TfMethod>[];
    idfOptions: readonly FormulaOption<IdfMethod>[];
    normOptions: readonly FormulaOption<Normalization>[];
    /** Default saat standar dipilih; null = pertahankan nilai saat ini (Custom). */
    defaults: FormulaDefaults | null;
}

const TF_BINARY = (label: string): FormulaOption<TfMethod> => ({ value: "binary", label, formula: "1 if f > 0, else 0" });
const TF_RAW = (label: string): FormulaOption<TfMethod> => ({ value: "raw", label, formula: "f" });
const TF_LOG1P = (label: string): FormulaOption<TfMethod> => ({ value: "log1p", label, formula: "ln(1 + f)" });
const TF_SUBLINEAR = (label: string): FormulaOption<TfMethod> => ({ value: "sublinear", label, formula: "1 + ln(f) if f > 0, else 0" });
const TF_NORMALIZED = (label: string): FormulaOption<TfMethod> => ({ value: "normalized", label, formula: "f / (number of tokens in document)" });

const IDF_NONE = (label: string): FormulaOption<IdfMethod> => ({ value: "none", label, formula: "1" });
const IDF_STANDARD = (label: string): FormulaOption<IdfMethod> => ({ value: "standard", label, formula: "ln(N / df)" });
const IDF_SMOOTH = (label: string): FormulaOption<IdfMethod> => ({ value: "smooth", label, formula: "ln((1 + N) / (1 + df)) + 1" });
const IDF_PLUS1 = (label: string): FormulaOption<IdfMethod> => ({ value: "plus1", label, formula: "ln(N / df) + 1" });

const NORM_NONE = (label: string): FormulaOption<Normalization> => ({ value: "none", label, formula: "no normalization" });
const NORM_DOCLEN = (label: string): FormulaOption<Normalization> => ({ value: "doc_length", label, formula: "v · (average vector length) / ‖v‖₂" });
const NORM_L2 = (label: string): FormulaOption<Normalization> => ({ value: "l2", label, formula: "v / ‖v‖₂" });
const NORM_L1 = (label: string): FormulaOption<Normalization> => ({ value: "l1", label, formula: "v / Σ|v|" });

export const FORMULA_STANDARDS: Record<FormulaStandard, FormulaStandardDefinition> = {
    weka: {
        id: "weka",
        label: "Weka",
        description: "Follows Weka StringToWordVector. Words to Keep ranks by total word count.",
        tfOptions: [TF_BINARY("Presence (0/1)"), TF_RAW("Word count"), TF_LOG1P("log(1 + f)")],
        idfOptions: [IDF_NONE("None"), IDF_STANDARD("ln(N / df)")],
        normOptions: [NORM_NONE("None"), NORM_DOCLEN("Normalize document length")],
        defaults: { tfMethod: "raw", idfMethod: "none", normalization: "none" },
    },
    sklearn: {
        id: "sklearn",
        label: "scikit-learn",
        description: "Follows scikit-learn TfidfVectorizer. Words to Keep ranks by total word count.",
        tfOptions: [TF_BINARY("Binary"), TF_RAW("Count"), TF_SUBLINEAR("Sublinear 1 + ln(f)")],
        idfOptions: [IDF_NONE("None"), IDF_SMOOTH("Smooth ln((1+N)/(1+df)) + 1"), IDF_PLUS1("ln(N/df) + 1")],
        normOptions: [NORM_NONE("None"), NORM_L2("L2"), NORM_L1("L1")],
        defaults: { tfMethod: "raw", idfMethod: "smooth", normalization: "l2" },
    },
    custom: {
        id: "custom",
        label: "Custom",
        description: "Free combination of formulas. Words to Keep ranks by sum of TF × IDF.",
        tfOptions: [
            TF_BINARY("Presence (0/1)  —  1 if f > 0"),
            TF_RAW("Word count  —  f"),
            TF_LOG1P("log(1 + f)  —  ln(1 + f)"),
            TF_SUBLINEAR("Sublinear  —  1 + ln(f)"),
            TF_NORMALIZED("Normalized  —  f / tokens"),
        ],
        idfOptions: [
            IDF_NONE("None  —  1"),
            IDF_STANDARD("Standard  —  ln(N / df)"),
            IDF_SMOOTH("Smooth  —  ln((1+N)/(1+df)) + 1"),
            IDF_PLUS1("Plus 1  —  ln(N/df) + 1"),
        ],
        normOptions: [
            NORM_NONE("None"),
            NORM_L2("L2  —  v / ‖v‖₂"),
            NORM_L1("L1  —  v / Σ|v|"),
            NORM_DOCLEN("Normalize document length (Weka)"),
        ],
        defaults: null,
    },
};

/** Urutan tampil radio "Formula standard". */
export const FORMULA_STANDARD_ORDER: readonly FormulaStandard[] = ["weka", "sklearn", "custom"];

/** Type guard: string → FormulaStandard (menghindari cast). */
export function isFormulaStandard(value: string): value is FormulaStandard {
    return value === "weka" || value === "sklearn" || value === "custom";
}

/** Apakah nilai `value` ada di daftar opsi sah suatu standar. */
export function isOptionAllowed<T extends string>(options: readonly FormulaOption<T>[], value: T): boolean {
    return options.some((o) => o.value === value);
}
