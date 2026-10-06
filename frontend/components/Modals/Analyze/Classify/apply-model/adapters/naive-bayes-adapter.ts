// AGENTS.md §3.2, §4.3, §4.4 — adapter model Naive Bayes (schema 1.0 & 1.1).
// AGENTS_V2.md §10.1 — schema 2.0 (fitur Text, gaussian_minstd) ditambahkan; 1.0/1.1 tidak berubah.
// Murni TypeScript; tanpa komponen React, tanpa akses store.

import type { ApplyModelIssue } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";
import type {
  ClassifierModelAdapter,
  ModelDescriptor,
  ModelFeatureDescriptor,
  ModelTextDescriptor,
  ModelValidationResult,
} from "@/components/Modals/Analyze/Classify/apply-model/adapters/types";
import type { NaiveBayesExportedModel } from "@/components/Modals/Analyze/Classify/apply-model/types/model-schema";

const MODEL_TYPE = "naive_bayes";
const ALGORITHM_LABEL = "Naive Bayes";
const SUPPORTED_SCHEMA_VERSIONS: readonly string[] = ["1.0", "1.1", "2.0"];
const LEGACY_SCHEMA_VERSION = "1.0";
const SCHEMA_VERSION_WITH_COUNTS = "1.1";
const SCHEMA_VERSION_V2 = "2.0"; // juga mewajibkan field 1.1 (counts & class_totals)

const TEXT_SOURCES: readonly string[] = ["raw", "vector"];
const TEXT_LIKELIHOODS: readonly string[] = ["multinomial", "bernoulli", "complement"];
const NUMERIC_LIKELIHOODS: readonly string[] = ["gaussian", "gaussian_minstd"];
const TOLERANCE = 1e-6; // AGENTS.md K8

// Field wajib di kedua versi (§3.1: semua field kecuali yang bertanda `?`).
// Field bertanda (1.1) — `target.class_counts` dan `class_totals` — diperiksa
// di langkah 11 (kode AM_E_COUNTS_INVALID / AM_E_CLASS_TOTALS_INVALID), bukan
// di langkah 2.
const REQUIRED_TOP_LEVEL_FIELDS = [
  "schema_version",
  "model_type",
  "trained_at",
  "target",
  "features",
  "smoothing_alpha",
  "variance_floor",
  "feature_order",
  "label_mapping",
  "validation_config",
  "missing_value_policy",
  "unseen_category_policy",
] as const;

const REQUIRED_TARGET_FIELDS = ["name", "classes", "class_priors"] as const;

// ---------------------------------------------------------------------------
// Helper murni
// ---------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function hasOwn(obj: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isV2(raw: UnknownRecord): boolean {
  return raw.schema_version === SCHEMA_VERSION_V2;
}

// Blok `text` hanya bermakna di schema 2.0; `null`/tidak ada = tanpa fitur Text.
function getTextBlock(raw: UnknownRecord): unknown {
  return isV2(raw) ? raw.text : undefined;
}

function hasTextBlock(raw: UnknownRecord): boolean {
  const text = getTextBlock(raw);
  return text !== undefined && text !== null;
}

function sameStringList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function makeError(
  code: ApplyModelIssue["code"],
  detail?: string
): ApplyModelIssue {
  return detail !== undefined
    ? { code, severity: "error", detail }
    : { code, severity: "error" };
}

function featureLabel(feature: UnknownRecord, index: number): string {
  return isNonEmptyString(feature.name) ? feature.name : `features[${index}]`;
}

// ---------------------------------------------------------------------------
// Langkah 1: schema_version (stop)
// ---------------------------------------------------------------------------

function validateStep1SchemaVersion(
  raw: UnknownRecord,
  errors: ApplyModelIssue[]
): boolean {
  const version = raw.schema_version;
  if (typeof version !== "string" || !SUPPORTED_SCHEMA_VERSIONS.includes(version)) {
    errors.push(
      makeError(
        "AM_E_SCHEMA_VERSION_UNSUPPORTED",
        typeof version === "string" ? version : String(version ?? "")
      )
    );
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Langkah 2: field wajib (stop)
// ---------------------------------------------------------------------------

function validateStep2RequiredFields(
  raw: UnknownRecord,
  errors: ApplyModelIssue[]
): boolean {
  const missing: string[] = [];

  for (const key of REQUIRED_TOP_LEVEL_FIELDS) {
    if (raw[key] === undefined || raw[key] === null) missing.push(key);
  }

  if (isPlainObject(raw.target)) {
    for (const key of REQUIRED_TARGET_FIELDS) {
      const value = raw.target[key];
      if (value === undefined || value === null) missing.push(`target.${key}`);
    }
  }

  for (const field of missing) {
    errors.push(makeError("AM_E_FIELD_MISSING", field));
  }
  return missing.length === 0;
}

// ---------------------------------------------------------------------------
// Langkah 3: tipe field
// ---------------------------------------------------------------------------

function validateStep3FieldTypes(
  raw: UnknownRecord,
  errors: ApplyModelIssue[]
): void {
  const fail = (detail: string) => {
    errors.push(makeError("AM_E_FIELD_TYPE", detail));
  };

  if (!isNonEmptyString(raw.model_type)) fail("model_type");
  if (typeof raw.trained_at !== "string") fail("trained_at");
  if (!isPlainObject(raw.target)) fail("target");
  if (!Array.isArray(raw.features)) fail("features");
  if (typeof raw.smoothing_alpha !== "number") fail("smoothing_alpha");
  if (typeof raw.variance_floor !== "number") fail("variance_floor");
  if (!isStringArray(raw.feature_order)) fail("feature_order");
  if (!isPlainObject(raw.label_mapping)) fail("label_mapping");
  if (!isPlainObject(raw.validation_config)) fail("validation_config");
  if (typeof raw.missing_value_policy !== "string") fail("missing_value_policy");
  if (typeof raw.unseen_category_policy !== "string") {
    fail("unseen_category_policy");
  }

  if (isPlainObject(raw.target)) {
    const target = raw.target;
    if (!isNonEmptyString(target.name)) fail("target.name");
    if (!isStringArray(target.classes)) fail("target.classes");
    if (!Array.isArray(target.class_priors)) fail("target.class_priors");
  }

  if (Array.isArray(raw.features)) {
    const featureList: unknown[] = raw.features;
    featureList.forEach((f, i) => {
      if (!isPlainObject(f)) {
        fail(`features[${i}]`);
        return;
      }
      const label = featureLabel(f, i);
      if (!isNonEmptyString(f.name)) fail(`features[${i}].name`);

      if (f.role === "categorical") {
        if (!isStringArray(f.categories)) fail(`${label}.categories`);
        if (!isPlainObject(f.distribution)) {
          fail(`${label}.distribution`);
        } else {
          for (const [cls, vec] of Object.entries(f.distribution)) {
            if (!Array.isArray(vec)) fail(`${label}.distribution.${cls}`);
          }
        }
      } else if (f.role === "numerical") {
        if (!isPlainObject(f.mean)) fail(`${label}.mean`);
        if (!isPlainObject(f.variance)) fail(`${label}.variance`);
      }
      // role lain → AM_E_ROLE_INVALID di langkah 8.
    });
  }
}

// ---------------------------------------------------------------------------
// Langkah 4: classes
// ---------------------------------------------------------------------------

function validateStep4Classes(
  classes: string[] | null,
  errors: ApplyModelIssue[]
): void {
  if (classes === null) return; // tipe salah sudah dilaporkan di langkah 3
  if (classes.length === 0) {
    errors.push(makeError("AM_E_CLASSES_EMPTY"));
    return;
  }
  if (hasDuplicates(classes)) {
    errors.push(makeError("AM_E_CLASSES_DUPLICATE"));
  }
}

// ---------------------------------------------------------------------------
// Langkah 5: class_priors
// ---------------------------------------------------------------------------

function validateStep5Priors(
  target: UnknownRecord | null,
  errors: ApplyModelIssue[]
): void {
  if (target === null) return;
  const classes = target.classes;
  const priors = target.class_priors;
  if (!Array.isArray(classes) || !Array.isArray(priors)) return;

  if (priors.length !== classes.length) {
    errors.push(
      makeError(
        "AM_E_PRIORS_LENGTH",
        `class_priors=${priors.length}, classes=${classes.length}`
      )
    );
    return;
  }
  const allInRange = priors.every(
    (p: unknown) => isFiniteNumber(p) && p >= 0 && p <= 1
  );
  if (!allInRange) {
    errors.push(makeError("AM_E_PRIORS_INVALID", "range"));
    return;
  }
  const sum = (priors as number[]).reduce((acc, p) => acc + p, 0);
  if (Math.abs(sum - 1) > TOLERANCE) {
    errors.push(makeError("AM_E_PRIORS_INVALID", "sum"));
  }
}

// ---------------------------------------------------------------------------
// Langkah 6: smoothing_alpha & variance_floor
// ---------------------------------------------------------------------------

function validateStep6Params(
  raw: UnknownRecord,
  errors: ApplyModelIssue[]
): void {
  // Tipe non-numerik sudah dilaporkan di langkah 3 (AM_E_FIELD_TYPE).
  if (typeof raw.smoothing_alpha === "number" && !(isFiniteNumber(raw.smoothing_alpha) && raw.smoothing_alpha > 0)) {
    errors.push(makeError("AM_E_PARAM_INVALID", "smoothing_alpha"));
  }
  if (typeof raw.variance_floor === "number" && !(isFiniteNumber(raw.variance_floor) && raw.variance_floor > 0)) {
    errors.push(makeError("AM_E_PARAM_INVALID", "variance_floor"));
  }
}

// ---------------------------------------------------------------------------
// Langkah 7: feature_order
// ---------------------------------------------------------------------------

function validateStep7FeatureOrder(
  raw: UnknownRecord,
  errors: ApplyModelIssue[]
): void {
  if (!isStringArray(raw.feature_order) || !Array.isArray(raw.features)) return;
  const featureOrder = raw.feature_order;
  const featureList: unknown[] = raw.features;
  const featureNames = featureList
    .filter(isPlainObject)
    .map((f) => f.name)
    .filter(isNonEmptyString);

  // v2: model hanya-Text (tanpa fitur Numeric/Categorical) punya feature_order kosong.
  const textOnly = hasTextBlock(raw) && featureList.length === 0;
  if (featureOrder.length === 0 && !textOnly) {
    errors.push(makeError("AM_E_FEATURE_ORDER_MISMATCH", "feature_order is empty"));
    return;
  }
  if (hasDuplicates(featureOrder)) {
    errors.push(makeError("AM_E_FEATURE_ORDER_MISMATCH", "feature_order has duplicates"));
    return;
  }
  const orderSet = new Set(featureOrder);
  const nameSet = new Set(featureNames);
  const sameSet =
    featureOrder.length === featureList.length &&
    featureNames.length === featureList.length &&
    orderSet.size === nameSet.size &&
    featureOrder.every((n) => nameSet.has(n));
  if (!sameSet) {
    errors.push(
      makeError("AM_E_FEATURE_ORDER_MISMATCH", "does not match features[].name")
    );
  }
}

// ---------------------------------------------------------------------------
// Langkah 8: features[].role
// ---------------------------------------------------------------------------

function validateStep8Roles(
  raw: UnknownRecord,
  errors: ApplyModelIssue[]
): void {
  if (!Array.isArray(raw.features)) return;
  const featureList: unknown[] = raw.features;
  featureList.forEach((f, i) => {
    if (!isPlainObject(f)) return;
    if (f.role !== "categorical" && f.role !== "numerical") {
      errors.push(makeError("AM_E_ROLE_INVALID", featureLabel(f, i)));
    }
  });
}

// ---------------------------------------------------------------------------
// Langkah 9: fitur categorical
// ---------------------------------------------------------------------------

function validateStep9Categorical(
  raw: UnknownRecord,
  classes: string[] | null,
  errors: ApplyModelIssue[]
): void {
  if (classes === null || !Array.isArray(raw.features)) return;

  const featureList: unknown[] = raw.features;
  featureList.forEach((f, i) => {
    if (!isPlainObject(f) || f.role !== "categorical") return;
    const label = featureLabel(f, i);
    // Tipe salah (categories/distribution) sudah dilaporkan di langkah 3.
    if (!isStringArray(f.categories) || !isPlainObject(f.distribution)) return;

    const categories = f.categories;
    if (categories.length === 0 || hasDuplicates(categories)) {
      errors.push(makeError("AM_E_CATEGORIES_INVALID", label));
      return;
    }

    const dist = f.distribution;
    if (classes.some((cls) => !hasOwn(dist, cls))) {
      errors.push(makeError("AM_E_DISTRIBUTION_CLASS_MISSING", label));
      return;
    }

    const vectors = classes.map((cls) => dist[cls]);
    if (vectors.some((v) => !Array.isArray(v))) return; // langkah 3
    const arrays = vectors as unknown[][];

    if (arrays.some((v) => v.length !== categories.length)) {
      errors.push(makeError("AM_E_DISTRIBUTION_LENGTH", label));
      return;
    }

    const sumInvalid = arrays.some((v) => {
      if (!v.every((x) => isFiniteNumber(x) && x > 0 && x <= 1)) return true;
      const sum = (v as number[]).reduce((a, x) => a + x, 0);
      return Math.abs(sum - 1) > TOLERANCE;
    });
    if (sumInvalid) {
      errors.push(makeError("AM_E_DISTRIBUTION_SUM", label));
    }
  });
}

// ---------------------------------------------------------------------------
// Langkah 10: fitur numerical
// ---------------------------------------------------------------------------

function validateStep10Numerical(
  raw: UnknownRecord,
  classes: string[] | null,
  errors: ApplyModelIssue[]
): void {
  if (classes === null || !Array.isArray(raw.features)) return;

  const featureList: unknown[] = raw.features;
  featureList.forEach((f, i) => {
    if (!isPlainObject(f) || f.role !== "numerical") return;
    const label = featureLabel(f, i);
    // Tipe salah (mean/variance) sudah dilaporkan di langkah 3.
    if (!isPlainObject(f.mean) || !isPlainObject(f.variance)) return;

    const mean = f.mean;
    const variance = f.variance;
    if (classes.some((cls) => !hasOwn(mean, cls) || !hasOwn(variance, cls))) {
      errors.push(makeError("AM_E_GAUSSIAN_CLASS_MISSING", label));
      return;
    }

    const invalid = classes.some((cls) => {
      const v = variance[cls];
      return !isFiniteNumber(mean[cls]) || !isFiniteNumber(v) || v <= 0;
    });
    if (invalid) {
      errors.push(makeError("AM_E_GAUSSIAN_INVALID", label));
    }
  });
}

// ---------------------------------------------------------------------------
// Langkah 12 (v2): likelihood per fitur Numeric/Categorical
// ---------------------------------------------------------------------------

function validateStep12FeatureLikelihoods(
  raw: UnknownRecord,
  errors: ApplyModelIssue[]
): void {
  if (!isV2(raw) || !Array.isArray(raw.features)) return;

  const featureList: unknown[] = raw.features;
  featureList.forEach((f, i) => {
    if (!isPlainObject(f)) return;
    const label = featureLabel(f, i);

    if (f.role === "categorical") {
      if (f.likelihood !== undefined && f.likelihood !== "categorical") {
        errors.push(
          makeError("AM_E_NB2_LIKELIHOOD", `${label}: ${String(f.likelihood)}`)
        );
      }
      return;
    }

    if (f.role === "numerical") {
      // Tanpa field `likelihood` = "gaussian" (kompatibel dengan model 1.1 yang di-upgrade).
      const likelihood = f.likelihood;
      if (
        likelihood !== undefined &&
        !(typeof likelihood === "string" && NUMERIC_LIKELIHOODS.includes(likelihood))
      ) {
        errors.push(makeError("AM_E_NB2_LIKELIHOOD", `${label}: ${String(likelihood)}`));
        return;
      }
      if (likelihood === "gaussian_minstd") {
        const minVar = f.min_variance;
        if (!(isFiniteNumber(minVar) && minVar > 0)) {
          errors.push(makeError("AM_E_GAUSSIAN_INVALID", label));
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Langkah 13 (v2): blok `text` (AGENTS_V2.md §8, §10.1)
// ---------------------------------------------------------------------------

// Memeriksa `obj[class]` untuk setiap kelas: harus array sepanjang `expectedLength`
// berisi bilangan finite (dan >= 0 bila `nonNegative`). Berhenti pada masalah pertama.
function checkClassVectors(
  label: string,
  obj: unknown,
  classes: string[],
  expectedLength: number,
  nonNegative: boolean,
  errors: ApplyModelIssue[]
): void {
  if (!isPlainObject(obj)) {
    errors.push(makeError("AM_E_FIELD_TYPE", label));
    return;
  }
  for (const cls of classes) {
    const vec = obj[cls];
    if (!hasOwn(obj, cls) || !Array.isArray(vec)) {
      errors.push(makeError("AM_E_NB2_TEXT_SHAPE", `${label}[${cls}]`));
      return;
    }
    if (vec.length !== expectedLength) {
      errors.push(
        makeError(
          "AM_E_NB2_TEXT_SHAPE",
          `${label}[${cls}]: ${vec.length} values, expected ${expectedLength}`
        )
      );
      return;
    }
    const valid = vec.every(
      (x: unknown) => isFiniteNumber(x) && (!nonNegative || x >= 0)
    );
    if (!valid) {
      errors.push(makeError("AM_E_FIELD_TYPE", `${label}.${cls}`));
      return;
    }
  }
}

function validateStep13Text(
  raw: UnknownRecord,
  classes: string[] | null,
  errors: ApplyModelIssue[]
): void {
  if (!hasTextBlock(raw)) return;
  const text = raw.text;
  if (!isPlainObject(text)) {
    errors.push(makeError("AM_E_FIELD_TYPE", "text"));
    return;
  }

  // --- source & likelihood ---
  const source = text.source;
  const sourceKnown = typeof source === "string" && TEXT_SOURCES.includes(source);
  if (!sourceKnown) {
    errors.push(makeError("AM_E_NB2_TEXT_SOURCE", `source=${String(source)}`));
  }
  const likelihood = text.likelihood;
  const likelihoodKnown =
    typeof likelihood === "string" && TEXT_LIKELIHOODS.includes(likelihood);
  if (!likelihoodKnown) {
    errors.push(makeError("AM_E_NB2_LIKELIHOOD", `text: ${String(likelihood)}`));
  }

  // --- alpha ---
  if (!(isFiniteNumber(text.alpha) && text.alpha > 0)) {
    errors.push(makeError("AM_E_PARAM_INVALID", "text.alpha"));
  }

  // --- uses_class_prior ---
  if (typeof text.uses_class_prior !== "boolean") {
    errors.push(makeError("AM_E_FIELD_TYPE", "text.uses_class_prior"));
  } else if (likelihoodKnown && classes !== null) {
    // Konsistensi dengan scorer Rust (A2, REVIEW-G1 A1-3): Complement dengan K >= 2
    // tidak memakai prior; selain itu prior selalu dipakai.
    const expectedUsesPrior = !(likelihood === "complement" && classes.length >= 2);
    if (text.uses_class_prior !== expectedUsesPrior) {
      errors.push(
        makeError(
          "AM_E_NB2_LIKELIHOOD",
          `text.uses_class_prior=${String(text.uses_class_prior)}, expected ${String(expectedUsesPrior)} for ${String(likelihood)}`
        )
      );
    }
  }

  // --- Complement hanya sah bila model hanya berisi Text ---
  if (
    likelihood === "complement" &&
    Array.isArray(raw.features) &&
    raw.features.length > 0
  ) {
    errors.push(makeError("AM_E_NB2_COMPLEMENT_MIXED"));
  }

  // --- terms ---
  if (!isStringArray(text.terms)) {
    errors.push(makeError("AM_E_FIELD_TYPE", "text.terms"));
    return; // panjang acuan tidak ada; pemeriksaan bentuk tidak bisa dilanjutkan
  }
  const terms = text.terms;
  if (terms.length === 0) {
    errors.push(makeError("AM_E_NB2_TEXT_SHAPE", "text.terms: empty"));
    return;
  }
  if (hasDuplicates(terms)) {
    errors.push(makeError("AM_E_NB2_TEXT_SHAPE", "text.terms: duplicates"));
  }

  // --- sumber raw: raw_variable + recipe ---
  if (source === "raw") {
    if (!isNonEmptyString(text.raw_variable)) {
      errors.push(makeError("AM_E_NB2_TEXT_SOURCE", "raw source without raw_variable"));
    }
    const recipe = text.recipe;
    if (!isPlainObject(recipe)) {
      errors.push(makeError("AM_E_NB2_TEXT_SOURCE", "raw source without text preprocessing settings"));
    } else {
      if (!isPlainObject(recipe.config) || !isStringArray(recipe.resolved_stopwords)) {
        errors.push(makeError("AM_E_NB2_TEXT_SOURCE", "incomplete text preprocessing settings"));
      }
      if (!isStringArray(recipe.vocabulary)) {
        errors.push(makeError("AM_E_NB2_TEXT_SOURCE", "recipe.vocabulary"));
      } else if (!sameStringList(recipe.vocabulary, terms)) {
        errors.push(
          makeError("AM_E_NB2_TEXT_SHAPE", "recipe.vocabulary differs from text.terms")
        );
      }
      if (!Array.isArray(recipe.idf) || recipe.idf.length !== terms.length) {
        errors.push(makeError("AM_E_NB2_TEXT_SHAPE", "recipe.idf"));
      }
    }
  }

  // --- sumber vector: columns sama dengan terms ---
  if (source === "vector") {
    if (!isStringArray(text.columns)) {
      errors.push(makeError("AM_E_NB2_TEXT_SOURCE", "vector source without columns"));
    } else if (!sameStringList(text.columns, terms)) {
      errors.push(makeError("AM_E_NB2_TEXT_SHAPE", "text.columns differs from text.terms"));
    }
  }

  // --- parameter per kelas ---
  if (classes !== null) {
    checkClassVectors("text.log_weights", text.log_weights, classes, terms.length, false, errors);
    checkClassVectors(
      "text.class_term_counts",
      text.class_term_counts,
      classes,
      terms.length,
      true,
      errors
    );
    if (likelihood === "bernoulli") {
      // log_weights_absent (A_ct) wajib hanya untuk Bernoulli.
      if (text.log_weights_absent === null || text.log_weights_absent === undefined) {
        errors.push(makeError("AM_E_NB2_TEXT_SHAPE", "text.log_weights_absent"));
      } else {
        checkClassVectors(
          "text.log_weights_absent",
          text.log_weights_absent,
          classes,
          terms.length,
          false,
          errors
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Langkah 11: khusus schema 1.1 (class_counts & class_totals)
// ---------------------------------------------------------------------------

function validateStep11Counts(
  raw: UnknownRecord,
  target: UnknownRecord | null,
  classes: string[] | null,
  errors: ApplyModelIssue[]
): void {
  if (raw.schema_version !== SCHEMA_VERSION_WITH_COUNTS && !isV2(raw)) return;

  // --- target.class_counts ---
  if (target !== null && Array.isArray(target.classes)) {
    const counts = target.class_counts;
    const classCount = target.classes.length;
    let countsValid = false;
    if (!Array.isArray(counts)) {
      errors.push(makeError("AM_E_COUNTS_INVALID", "target.class_counts"));
    } else if (counts.length !== classCount) {
      errors.push(makeError("AM_E_COUNTS_INVALID", "target.class_counts: length"));
    } else if (!counts.every(isNonNegativeInteger)) {
      errors.push(makeError("AM_E_COUNTS_INVALID", "target.class_counts: values"));
    } else if ((counts as number[]).reduce((a, c) => a + c, 0) === 0) {
      errors.push(makeError("AM_E_COUNTS_INVALID", "target.class_counts: sum is 0"));
    } else {
      countsValid = true;
    }

    // Konsistensi dengan class_priors (hanya bila keduanya valid agar tidak
    // menimbulkan error berantai).
    const priors = target.class_priors;
    if (
      countsValid &&
      Array.isArray(priors) &&
      priors.length === classCount &&
      priors.every((p: unknown) => isFiniteNumber(p))
    ) {
      const countList = counts as number[];
      const total = countList.reduce((a, c) => a + c, 0);
      const priorList = priors as number[];
      const badIndex = countList.findIndex(
        (c, idx) => Math.abs(priorList[idx] - c / total) > TOLERANCE
      );
      if (badIndex >= 0) {
        const cls: unknown = target.classes[badIndex];
        errors.push(
          makeError(
            "AM_E_COUNTS_INCONSISTENT",
            typeof cls === "string" ? cls : String(badIndex)
          )
        );
      }
    }
  }

  // --- class_totals per fitur categorical ---
  if (classes === null || !Array.isArray(raw.features)) return;
  const featureList: unknown[] = raw.features;
  featureList.forEach((f, i) => {
    if (!isPlainObject(f) || f.role !== "categorical") return;
    const totals = f.class_totals;
    const valid =
      isPlainObject(totals) &&
      classes.every((cls) => hasOwn(totals, cls) && isNonNegativeInteger(totals[cls]));
    if (!valid) {
      errors.push(makeError("AM_E_CLASS_TOTALS_INVALID", featureLabel(f, i)));
    }
  });
}

// ---------------------------------------------------------------------------
// Descriptor (hanya dipanggil bila semua langkah lolos)
// ---------------------------------------------------------------------------

function formatTrainingValidation(config: unknown): string {
  if (!isPlainObject(config)) return "-";
  const seed = isFiniteNumber(config.seed) ? `seed ${config.seed}` : "no seed";
  const num = (v: unknown): string => (isFiniteNumber(v) ? String(v) : "?");
  if (config.method === "holdout") {
    return `Holdout ${num(config.training_percentage)}% / ${num(config.holdout_percentage)}%, ${seed}`;
  }
  if (config.method === "kfold") {
    return `${num(config.folds)}-fold, ${seed}`;
  }
  return typeof config.method === "string" ? `${config.method}, ${seed}` : "-";
}

const TEXT_LIKELIHOOD_LABELS: Record<ModelTextDescriptor["likelihood"], string> = {
  multinomial: "Multinomial",
  bernoulli: "Bernoulli",
  complement: "Complement",
};

function buildDescriptor(raw: NaiveBayesExportedModel): ModelDescriptor {
  const roleByName = new Map<string, ModelFeatureDescriptor["role"]>(
    raw.features.map((f): [string, ModelFeatureDescriptor["role"]] => [f.name, f.role])
  );
  // Urutan fitur = feature_order model (§3.2).
  const features: ModelFeatureDescriptor[] = raw.feature_order.map((name) => ({
    name,
    role: roleByName.get(name) as ModelFeatureDescriptor["role"],
  }));

  const warnings: ModelDescriptor["warnings"] =
    raw.schema_version === LEGACY_SCHEMA_VERSION ? ["AM_W_LEGACY_SCHEMA"] : [];

  // v2: info fitur Text (hanya schema 2.0 dengan blok `text`).
  const textBlock =
    raw.schema_version === SCHEMA_VERSION_V2 && raw.text ? raw.text : null;
  const textDescriptor: ModelTextDescriptor | null =
    textBlock === null
      ? null
      : {
          source: textBlock.source,
          likelihood: textBlock.likelihood,
          alpha: textBlock.alpha,
          termCount: textBlock.terms.length,
          rawVariable: textBlock.source === "raw" ? textBlock.raw_variable : null,
          columns: textBlock.source === "vector" ? [...(textBlock.columns ?? [])] : [],
        };

  const summaryRows = [
    { label: "Smoothing alpha", value: String(raw.smoothing_alpha) },
    { label: "Variance floor", value: String(raw.variance_floor) },
    {
      label: "Training validation",
      value: formatTrainingValidation(raw.validation_config),
    },
  ];
  if (textDescriptor !== null) {
    summaryRows.push(
      {
        label: "Text source",
        value:
          textDescriptor.source === "raw"
            ? `Raw text: '${textDescriptor.rawVariable ?? ""}'`
            : "Word vectors",
      },
      { label: "Text likelihood", value: TEXT_LIKELIHOOD_LABELS[textDescriptor.likelihood] },
      { label: "Text terms", value: String(textDescriptor.termCount) },
      { label: "Text alpha", value: String(textDescriptor.alpha) }
    );
  }

  return {
    modelType: MODEL_TYPE,
    algorithmLabel: ALGORITHM_LABEL,
    schemaVersion: raw.schema_version,
    trainedAt: raw.trained_at,
    targetName: raw.target.name,
    classes: [...raw.target.classes],
    features,
    summaryRows,
    warnings,
    // Sengaja tidak menambah key `text` untuk model tanpa fitur Text agar
    // descriptor v1 identik dengan sebelumnya.
    ...(textDescriptor !== null ? { text: textDescriptor } : {}),
  };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const naiveBayesModelAdapter: ClassifierModelAdapter = {
  modelType: MODEL_TYPE,
  algorithmLabel: ALGORITHM_LABEL,
  supportedSchemaVersions: SUPPORTED_SCHEMA_VERSIONS,
  defaultOutputPrefix: "NB",
  resultStoreSource: {
    componentKey: "Export Model",
    payloadKey: "naiveBayesTrainedModel",
  },

  validate(raw: unknown): ModelValidationResult {
    if (!isPlainObject(raw)) {
      return { ok: false, errors: [makeError("AM_E_NOT_OBJECT")] };
    }

    const errors: ApplyModelIssue[] = [];

    // Langkah 1–2 menghentikan validasi.
    if (!validateStep1SchemaVersion(raw, errors)) return { ok: false, errors };
    if (!validateStep2RequiredFields(raw, errors)) return { ok: false, errors };

    const target = isPlainObject(raw.target) ? raw.target : null;
    const classes =
      target !== null && isStringArray(target.classes) ? target.classes : null;

    // Langkah 3–11 dikumpulkan; tiap langkah melewati data yang tipenya sudah
    // dilaporkan salah di langkah 3 agar tidak ada error berantai / crash.
    validateStep3FieldTypes(raw, errors);
    validateStep4Classes(classes, errors);
    validateStep5Priors(target, errors);
    validateStep6Params(raw, errors);
    validateStep7FeatureOrder(raw, errors);
    validateStep8Roles(raw, errors);
    validateStep9Categorical(raw, classes, errors);
    validateStep10Numerical(raw, classes, errors);
    validateStep11Counts(raw, target, classes, errors);
    validateStep12FeatureLikelihoods(raw, errors);
    validateStep13Text(raw, classes, errors);

    if (errors.length > 0) return { ok: false, errors };

    // Semua langkah lolos → bentuk model sesuai NaiveBayesExportedModel.
    const model = raw as unknown as NaiveBayesExportedModel;
    return { ok: true, model, descriptor: buildDescriptor(model) };
  },
};
