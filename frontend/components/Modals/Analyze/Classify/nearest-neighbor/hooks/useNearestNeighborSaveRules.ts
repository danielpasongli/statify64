/**
 * Aturan menu tab Save: variabel apa saja yang boleh disimpan (tergantung
 * pilihan di tab lain), dan validasi input "Max categories to save".
 */

export type SaveCapabilitiesInput = {
  hasTarget: boolean;
  targetType: "scale" | "nominal" | "ordinal" | null;
  isAutoK: boolean;
  isFeatureSelectionActive: boolean;
  isUsingPartitionVariable: boolean;
  isUsingFoldVariable: boolean;
};

export type SaveCapabilities = {
  canPredict: boolean;
  canProbability: boolean;
  canFold: boolean;
  canSavePartition: boolean;
  canSaveFold: boolean;
};

export function computeSaveCapabilities(
  input: SaveCapabilitiesInput,
): SaveCapabilities {
  const isCategorical =
    input.targetType === "nominal" || input.targetType === "ordinal";

  const canPredict = input.hasTarget;
  const canProbability = input.hasTarget && isCategorical;
  const canFold =
    input.hasTarget && input.isAutoK && !input.isFeatureSelectionActive;
  const canSavePartition = !input.isUsingPartitionVariable;
  const canSaveFold = canFold && !input.isUsingFoldVariable;

  return { canPredict, canProbability, canFold, canSavePartition, canSaveFold };
}

/**
 * Menerjemahkan teks input "Max categories to save" menjadi nilai final.
 * - "" -> null (dikosongkan)
 * - teks bukan angka -> undefined (diabaikan, nilai lama dipertahankan)
 * - angka valid -> dibulatkan ke bawah dan dibatasi minimal 1
 */
export function parseMaxCatsToSaveInput(rawValue: string): number | null | undefined {
  if (rawValue === "") return null;

  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue)) return undefined;

  return Math.max(1, Math.trunc(numericValue));
}

/**
 * Nama bawaan variabel yang disimpan. Harus sama dengan nama bawaan di sisi
 * Rust (rust/src/stats/save.rs). Untuk probabilitas, nama ini adalah awalan
 * yang diikuti nama kategori (mis. KNN_Probability_A).
 */
export const DEFAULT_SAVED_VARIABLE_NAMES = {
  PredictedValueName: "KNN_PredictedValue",
  ProbabilityName: "KNN_Probability",
  PartitionName: "KNN_Partition",
  FoldName: "KNN_Fold",
} as const;

export type SavedVariableNameField = keyof typeof DEFAULT_SAVED_VARIABLE_NAMES;

type SavedNameConfig = Partial<Record<SavedVariableNameField, string | null>> & {
  CustomName: boolean;
};

/**
 * Nama final sebuah variabel simpanan, dengan aturan yang sama seperti Rust:
 * nama kustom hanya dipakai jika "Use custom names" aktif dan tidak kosong.
 */
export function resolveSavedVariableName(
  save: SavedNameConfig,
  field: SavedVariableNameField,
): string {
  const customName = save[field]?.trim();
  if (save.CustomName && customName) return customName;
  return DEFAULT_SAVED_VARIABLE_NAMES[field];
}

const VARIABLE_NAME_PATTERN = /^[A-Za-z@#$][A-Za-z0-9._@#$]*$/;
const MAX_VARIABLE_NAME_LENGTH = 64;
// Sama dengan kata kunci terlarang di useVariableStore.processVariableName.
const RESERVED_VARIABLE_NAMES = new Set([
  "ALL", "AND", "BY", "EQ", "GE", "GT", "LE", "LT", "NE", "NOT", "OR", "TO", "WITH",
]);

/**
 * Validasi nama kustom untuk variabel yang dicentang di tab Save.
 * Mengembalikan pesan error pertama, atau null jika semua nama valid.
 */
export function validateCustomSavedNames(
  save: SavedNameConfig & {
    HasTargetVar: boolean;
    IsCateTargetVar: boolean;
    RandomAssignToPartition: boolean;
    RandomAssignToFold: boolean;
  },
): string | null {
  if (!save.CustomName) return null;

  const checkedFields: Array<[SavedVariableNameField, string]> = [];
  if (save.HasTargetVar) checkedFields.push(["PredictedValueName", "Predicted Value or Category"]);
  if (save.IsCateTargetVar) checkedFields.push(["ProbabilityName", "Predicted Probability"]);
  if (save.RandomAssignToPartition) checkedFields.push(["PartitionName", "Training/Holdout Partition Variable"]);
  if (save.RandomAssignToFold) checkedFields.push(["FoldName", "Cross-Validation Fold Variable"]);

  const usedNames = new Set<string>();

  for (const [field, label] of checkedFields) {
    const name = save[field]?.trim() ?? "";

    if (!name) {
      return `Enter a variable name for "${label}".`;
    }

    if (!VARIABLE_NAME_PATTERN.test(name) || /[._]$/.test(name)) {
      return `The variable name for "${label}" must start with a letter, "@", "#", or "$", contain only letters, digits, ".", "_", "@", "#", or "$", and cannot end with "." or "_".`;
    }

    if (RESERVED_VARIABLE_NAMES.has(name.toUpperCase())) {
      return `"${name}" is a reserved word and cannot be used as a variable name.`;
    }

    if (name.length > MAX_VARIABLE_NAME_LENGTH) {
      return `The variable name for "${label}" cannot be longer than ${MAX_VARIABLE_NAME_LENGTH} characters.`;
    }

    const key = name.toLowerCase();
    if (usedNames.has(key)) {
      return `Each saved variable must have a different name ("${name}" is used more than once).`;
    }
    usedNames.add(key);
  }

  return null;
}
