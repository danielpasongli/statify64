// AGENTS.md §4.3, §4.4 — test adapter Naive Bayes (Fase 2).
// Satu test minimal per kode AM_E_* validasi model (AM_E_NOT_OBJECT s/d
// AM_E_CLASS_TOTALS_INVALID) dibuat dengan memodifikasi salinan D1/D2
// (PLAN.md §1). Setiap test men-assert `code` dan `detail`.

import { naiveBayesModelAdapter } from "@/components/Modals/Analyze/Classify/apply-model/adapters/naive-bayes-adapter";
import type { ModelValidationResult } from "@/components/Modals/Analyze/Classify/apply-model/adapters/types";
import type { ApplyModelIssue } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";

// Fixture dimuat via require: tsconfig `composite: true` tidak mengizinkan
// import JSON via path alias (TS6307). Dicek bentuknya lewat cast.
const nbModelV11 = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v1_1.json") as Record<string, unknown>;
const nbModelV10 = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v1_0.json") as Record<string, unknown>;

type RawModel = Record<string, unknown>;

function clone(value: unknown): RawModel {
  return JSON.parse(JSON.stringify(value)) as RawModel;
}

/** Salinan D1 (schema 1.1) + pintasan ke bagian-bagiannya. */
function modelV11() {
  const model = clone(nbModelV11);
  const target = model.target as RawModel;
  const features = model.features as RawModel[];
  return {
    model,
    target,
    outlook: features[0],
    temp: features[1],
    outlookDist: features[0].distribution as Record<string, unknown>,
    outlookTotals: features[0].class_totals as Record<string, unknown>,
    tempMean: features[1].mean as Record<string, unknown>,
    tempVariance: features[1].variance as Record<string, unknown>,
  };
}

function validate(model: unknown): ModelValidationResult {
  return naiveBayesModelAdapter.validate(model);
}

function errorsOf(result: ModelValidationResult): ApplyModelIssue[] {
  if (result.ok) {
    throw new Error("Expected validation to fail, but it succeeded");
  }
  return result.errors;
}

function expectOk(
  result: ModelValidationResult
): asserts result is Extract<ModelValidationResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(
      `Expected validation to succeed, got errors: ${JSON.stringify(result.errors)}`
    );
  }
}

/** Assert ada error dengan `code` (dan `detail` bila diberikan). */
function expectIssue(
  errors: ApplyModelIssue[],
  code: ApplyModelIssue["code"],
  detail?: string
): void {
  const found = errors.find(
    (e) => e.code === code && (detail === undefined || e.detail === detail)
  );
  if (!found) {
    throw new Error(
      `Expected issue ${code}${detail !== undefined ? ` (detail "${detail}")` : ""}, got: ${JSON.stringify(errors)}`
    );
  }
  expect(found.severity).toBe("error");
}

function codesOf(errors: ApplyModelIssue[]): string[] {
  return errors.map((e) => e.code);
}

describe("naiveBayesModelAdapter — metadata (PLAN Fase 2 langkah 1)", () => {
  it("memuat konfigurasi adapter sesuai kontrak", () => {
    expect(naiveBayesModelAdapter.modelType).toBe("naive_bayes");
    expect(naiveBayesModelAdapter.algorithmLabel).toBe("Naive Bayes");
    expect(naiveBayesModelAdapter.supportedSchemaVersions).toEqual(["1.0", "1.1", "2.0"]);
    expect(naiveBayesModelAdapter.defaultOutputPrefix).toBe("NB");
    expect(naiveBayesModelAdapter.resultStoreSource).toEqual({
      componentKey: "Export Model",
      payloadKey: "naiveBayesTrainedModel",
    });
  });
});

describe("naiveBayesModelAdapter.validate — model valid", () => {
  it("D1 (schema 1.1) → ok:true, tanpa warning, descriptor lengkap", () => {
    const result = validate(nbModelV11);
    expectOk(result);
    expect(result.model).toBe(nbModelV11);
    expect(result.descriptor).toEqual({
      modelType: "naive_bayes",
      algorithmLabel: "Naive Bayes",
      schemaVersion: "1.1",
      trainedAt: "2026-10-01T00:00:00.000Z",
      targetName: "Play",
      classes: ["No", "Yes"],
      features: [
        { name: "Outlook", role: "categorical" },
        { name: "Temp", role: "numerical" },
      ],
      summaryRows: [
        { label: "Smoothing alpha", value: "1" },
        { label: "Variance floor", value: "1e-9" },
        { label: "Training validation", value: "Holdout 70% / 30%, seed 42" },
      ],
      warnings: [],
    });
  });

  it("D2 (schema 1.0) → ok:true dengan warning AM_W_LEGACY_SCHEMA", () => {
    const result = validate(nbModelV10);
    expectOk(result);
    expect(result.descriptor.schemaVersion).toBe("1.0");
    expect(result.descriptor.warnings).toEqual(["AM_W_LEGACY_SCHEMA"]);
  });

  it("descriptor.features mengikuti urutan feature_order, bukan urutan features[]", () => {
    const { model } = modelV11();
    model.feature_order = ["Temp", "Outlook"];
    const result = validate(model);
    expectOk(result);
    expect(result.descriptor.features).toEqual([
      { name: "Temp", role: "numerical" },
      { name: "Outlook", role: "categorical" },
    ]);
  });

  it("Training validation untuk k-fold tanpa seed → '10-fold, no seed'", () => {
    const { model } = modelV11();
    model.validation_config = {
      method: "kfold",
      training_percentage: null,
      holdout_percentage: null,
      folds: 10,
      seed: null,
    };
    const result = validate(model);
    expectOk(result);
    expect(result.descriptor.summaryRows[2]).toEqual({
      label: "Training validation",
      value: "10-fold, no seed",
    });
  });

  it("field tambahan yang tidak dikenal diabaikan (bukan error)", () => {
    const { model, target, outlook, temp } = modelV11();
    model.unknown_top_level = { a: 1 };
    target.unknown_target_field = "x";
    outlook.unknown_feature_field = [1, 2, 3];
    temp.unknown_feature_field = null;
    const result = validate(model);
    expectOk(result);
    expect(result.descriptor.warnings).toEqual([]);
  });

  it("D2 (1.0) mengabaikan class_counts & class_totals yang tidak valid", () => {
    const model = clone(nbModelV10);
    (model.target as RawModel).class_counts = "bukan array";
    ((model.features as RawModel[])[0]).class_totals = [1, 2];
    expectOk(validate(model));
  });

  it("toleransi 1e-6: prior dan distribution yang meleset 5e-7 tetap lolos", () => {
    const { model, target, outlookDist } = modelV11();
    target.class_priors = [0.5 + 5e-7, 0.5];
    outlookDist.No = [0.5, 0.16666666666666666, 0.3333333333333333 + 5e-7];
    expectOk(validate(model));
  });
});

describe("naiveBayesModelAdapter.validate — AM_E_NOT_OBJECT", () => {
  it.each([[null], [undefined], [[1, 2]], ["teks"], [42], [true]])(
    "%p → AM_E_NOT_OBJECT",
    (value) => {
      const errors = errorsOf(validate(value));
      expect(errors).toEqual([{ code: "AM_E_NOT_OBJECT", severity: "error" }]);
    }
  );
});

describe("naiveBayesModelAdapter.validate — langkah 1–2 (stop)", () => {
  it("schema_version salah → AM_E_SCHEMA_VERSION_UNSUPPORTED (detail = versi), validasi berhenti", () => {
    const { model, target } = modelV11();
    model.schema_version = "9.9";
    target.classes = ["No", "No"]; // error langkah 4 tidak boleh muncul
    const errors = errorsOf(validate(model));
    expect(errors).toEqual([
      { code: "AM_E_SCHEMA_VERSION_UNSUPPORTED", severity: "error", detail: "9.9" },
    ]);
  });

  it("schema_version hilang → AM_E_SCHEMA_VERSION_UNSUPPORTED dengan detail kosong", () => {
    const { model } = modelV11();
    delete model.schema_version;
    const errors = errorsOf(validate(model));
    expect(errors).toEqual([
      { code: "AM_E_SCHEMA_VERSION_UNSUPPORTED", severity: "error", detail: "" },
    ]);
  });

  it("schema_version bukan string (1.1 numerik) → AM_E_SCHEMA_VERSION_UNSUPPORTED", () => {
    const { model } = modelV11();
    model.schema_version = 1.1;
    const errors = errorsOf(validate(model));
    expect(errors).toEqual([
      { code: "AM_E_SCHEMA_VERSION_UNSUPPORTED", severity: "error", detail: "1.1" },
    ]);
  });

  it("field wajib hilang → AM_E_FIELD_MISSING per path, validasi berhenti", () => {
    const { model, target } = modelV11();
    delete model.smoothing_alpha;
    delete model.variance_floor;
    delete target.class_priors;
    target.classes = ["No", "No"]; // error langkah 4 tidak boleh muncul
    const errors = errorsOf(validate(model));
    expect(errors).toEqual([
      { code: "AM_E_FIELD_MISSING", severity: "error", detail: "smoothing_alpha" },
      { code: "AM_E_FIELD_MISSING", severity: "error", detail: "variance_floor" },
      { code: "AM_E_FIELD_MISSING", severity: "error", detail: "target.class_priors" },
    ]);
  });

  it("field wajib bernilai null dihitung hilang (target.name)", () => {
    const { model, target } = modelV11();
    target.name = null;
    const errors = errorsOf(validate(model));
    expect(errors).toEqual([
      { code: "AM_E_FIELD_MISSING", severity: "error", detail: "target.name" },
    ]);
  });
});

describe("naiveBayesModelAdapter.validate — AM_E_FIELD_TYPE (langkah 3)", () => {
  it("classes bukan array string → AM_E_FIELD_TYPE target.classes, tanpa error berantai", () => {
    const { model, target } = modelV11();
    target.classes = "No,Yes";
    const errors = errorsOf(validate(model));
    expect(errors).toEqual([
      { code: "AM_E_FIELD_TYPE", severity: "error", detail: "target.classes" },
    ]);
  });

  it("elemen classes bukan string → AM_E_FIELD_TYPE target.classes", () => {
    const { model, target } = modelV11();
    target.classes = ["No", 1];
    expectIssue(errorsOf(validate(model)), "AM_E_FIELD_TYPE", "target.classes");
  });

  it("class_priors bukan array → AM_E_FIELD_TYPE target.class_priors", () => {
    const { model, target } = modelV11();
    target.class_priors = 0.5;
    expectIssue(errorsOf(validate(model)), "AM_E_FIELD_TYPE", "target.class_priors");
  });

  it("smoothing_alpha bukan angka → AM_E_FIELD_TYPE smoothing_alpha (bukan AM_E_PARAM_INVALID)", () => {
    const { model } = modelV11();
    model.smoothing_alpha = "1";
    const errors = errorsOf(validate(model));
    expectIssue(errors, "AM_E_FIELD_TYPE", "smoothing_alpha");
    expect(codesOf(errors)).not.toContain("AM_E_PARAM_INVALID");
  });

  it("features bukan array → AM_E_FIELD_TYPE features, tidak melempar exception", () => {
    const { model } = modelV11();
    model.features = "bukan array";
    expectIssue(errorsOf(validate(model)), "AM_E_FIELD_TYPE", "features");
  });

  it("elemen features bukan objek → AM_E_FIELD_TYPE features[0]", () => {
    const { model } = modelV11();
    (model.features as unknown[])[0] = "Outlook";
    expectIssue(errorsOf(validate(model)), "AM_E_FIELD_TYPE", "features[0]");
  });

  it("categories bukan array string → AM_E_FIELD_TYPE Outlook.categories", () => {
    const { model, outlook } = modelV11();
    outlook.categories = [1, 2, 3];
    const errors = errorsOf(validate(model));
    expectIssue(errors, "AM_E_FIELD_TYPE", "Outlook.categories");
    expect(codesOf(errors)).not.toContain("AM_E_CATEGORIES_INVALID");
  });

  it("distribution bukan objek → AM_E_FIELD_TYPE Outlook.distribution", () => {
    const { model, outlook } = modelV11();
    outlook.distribution = [0.5, 0.5];
    expectIssue(errorsOf(validate(model)), "AM_E_FIELD_TYPE", "Outlook.distribution");
  });

  it("vektor distribution bukan array → AM_E_FIELD_TYPE Outlook.distribution.No", () => {
    const { model, outlookDist } = modelV11();
    outlookDist.No = "0.5";
    expectIssue(errorsOf(validate(model)), "AM_E_FIELD_TYPE", "Outlook.distribution.No");
  });

  it("mean/variance bukan objek → AM_E_FIELD_TYPE Temp.mean / Temp.variance", () => {
    const { model, temp } = modelV11();
    temp.mean = 84;
    temp.variance = null;
    const errors = errorsOf(validate(model));
    expectIssue(errors, "AM_E_FIELD_TYPE", "Temp.mean");
    expectIssue(errors, "AM_E_FIELD_TYPE", "Temp.variance");
  });

  it("input sangat rusak tidak melempar exception", () => {
    const { model, target } = modelV11();
    target.classes = 5;
    target.class_priors = { a: 1 };
    model.features = "x";
    model.feature_order = {};
    const result = validate(model);
    const errors = errorsOf(result);
    expectIssue(errors, "AM_E_FIELD_TYPE", "target.classes");
    expectIssue(errors, "AM_E_FIELD_TYPE", "target.class_priors");
    expectIssue(errors, "AM_E_FIELD_TYPE", "features");
    expectIssue(errors, "AM_E_FIELD_TYPE", "feature_order");
  });
});

describe("naiveBayesModelAdapter.validate — langkah 4–5 (classes, priors)", () => {
  it("classes kosong → AM_E_CLASSES_EMPTY", () => {
    const { model, target } = modelV11();
    target.classes = [];
    target.class_priors = [];
    target.class_counts = [];
    expectIssue(errorsOf(validate(model)), "AM_E_CLASSES_EMPTY");
  });

  it("classes duplikat → AM_E_CLASSES_DUPLICATE", () => {
    const { model, target } = modelV11();
    target.classes = ["No", "No"];
    expectIssue(errorsOf(validate(model)), "AM_E_CLASSES_DUPLICATE");
  });

  it("class_priors panjang beda → AM_E_PRIORS_LENGTH", () => {
    const { model, target } = modelV11();
    target.class_priors = [0.5, 0.3, 0.2];
    expectIssue(
      errorsOf(validate(model)),
      "AM_E_PRIORS_LENGTH",
      "class_priors=3, classes=2"
    );
  });

  it("class_priors di luar [0,1] → AM_E_PRIORS_INVALID (detail range)", () => {
    const { model, target } = modelV11();
    target.class_priors = [1.5, -0.5];
    expectIssue(errorsOf(validate(model)), "AM_E_PRIORS_INVALID", "range");
  });

  it("class_priors non-numerik → AM_E_PRIORS_INVALID (detail range)", () => {
    const { model, target } = modelV11();
    target.class_priors = [0.5, null];
    expectIssue(errorsOf(validate(model)), "AM_E_PRIORS_INVALID", "range");
  });

  it("jumlah class_priors ≠ 1 (selisih > 1e-6) → AM_E_PRIORS_INVALID (detail sum)", () => {
    const { model, target } = modelV11();
    target.class_priors = [0.4, 0.4];
    expectIssue(errorsOf(validate(model)), "AM_E_PRIORS_INVALID", "sum");
  });

  it("jumlah class_priors meleset 2e-6 → AM_E_PRIORS_INVALID (di luar toleransi)", () => {
    const { model, target } = modelV11();
    target.class_priors = [0.5 + 2e-6, 0.5];
    expectIssue(errorsOf(validate(model)), "AM_E_PRIORS_INVALID", "sum");
  });
});

describe("naiveBayesModelAdapter.validate — langkah 6–8 (parameter, urutan fitur, role)", () => {
  it("smoothing_alpha ≤ 0 → AM_E_PARAM_INVALID (detail smoothing_alpha)", () => {
    const { model } = modelV11();
    model.smoothing_alpha = 0;
    expectIssue(errorsOf(validate(model)), "AM_E_PARAM_INVALID", "smoothing_alpha");
  });

  it("variance_floor negatif → AM_E_PARAM_INVALID (detail variance_floor)", () => {
    const { model } = modelV11();
    model.variance_floor = -1;
    const errors = errorsOf(validate(model));
    expectIssue(errors, "AM_E_PARAM_INVALID", "variance_floor");
    expect(errors.some((e) => e.detail === "smoothing_alpha")).toBe(false);
  });

  it("feature_order beda dari features[].name → AM_E_FEATURE_ORDER_MISMATCH", () => {
    const { model } = modelV11();
    model.feature_order = ["Outlook", "Humidity"];
    expectIssue(errorsOf(validate(model)), "AM_E_FEATURE_ORDER_MISMATCH");
  });

  it("feature_order kosong → AM_E_FEATURE_ORDER_MISMATCH", () => {
    const { model } = modelV11();
    model.feature_order = [];
    expectIssue(errorsOf(validate(model)), "AM_E_FEATURE_ORDER_MISMATCH");
  });

  it("feature_order duplikat → AM_E_FEATURE_ORDER_MISMATCH", () => {
    const { model } = modelV11();
    model.feature_order = ["Outlook", "Outlook"];
    expectIssue(errorsOf(validate(model)), "AM_E_FEATURE_ORDER_MISMATCH");
  });

  it("feature_order lebih pendek dari features → AM_E_FEATURE_ORDER_MISMATCH", () => {
    const { model } = modelV11();
    model.feature_order = ["Outlook"];
    expectIssue(errorsOf(validate(model)), "AM_E_FEATURE_ORDER_MISMATCH");
  });

  it("role tidak dikenal → AM_E_ROLE_INVALID (detail nama fitur)", () => {
    const { model, outlook } = modelV11();
    outlook.role = "text";
    expectIssue(errorsOf(validate(model)), "AM_E_ROLE_INVALID", "Outlook");
  });
});

describe("naiveBayesModelAdapter.validate — langkah 9 (categorical)", () => {
  it("categories kosong → AM_E_CATEGORIES_INVALID (detail nama fitur)", () => {
    const { model, outlook } = modelV11();
    outlook.categories = [];
    expectIssue(errorsOf(validate(model)), "AM_E_CATEGORIES_INVALID", "Outlook");
  });

  it("categories duplikat → AM_E_CATEGORIES_INVALID (detail nama fitur)", () => {
    const { model, outlook } = modelV11();
    outlook.categories = ["Sunny", "Sunny", "Rain"];
    expectIssue(errorsOf(validate(model)), "AM_E_CATEGORIES_INVALID", "Outlook");
  });

  it("distribution tanpa key kelas → AM_E_DISTRIBUTION_CLASS_MISSING", () => {
    const { model, outlookDist } = modelV11();
    delete outlookDist.Yes;
    expectIssue(
      errorsOf(validate(model)),
      "AM_E_DISTRIBUTION_CLASS_MISSING",
      "Outlook"
    );
  });

  it("panjang vektor ≠ jumlah kategori → AM_E_DISTRIBUTION_LENGTH", () => {
    const { model, outlookDist } = modelV11();
    outlookDist.No = [0.5, 0.5];
    outlookDist.Yes = [0.5, 0.5];
    expectIssue(errorsOf(validate(model)), "AM_E_DISTRIBUTION_LENGTH", "Outlook");
  });

  it("jumlah probabilitas ≠ 1 → AM_E_DISTRIBUTION_SUM", () => {
    const { model, outlookDist } = modelV11();
    outlookDist.No = [0.5, 0.5, 0.5];
    expectIssue(errorsOf(validate(model)), "AM_E_DISTRIBUTION_SUM", "Outlook");
  });

  it("probabilitas bernilai 0 (di luar (0,1]) → AM_E_DISTRIBUTION_SUM", () => {
    const { model, outlookDist } = modelV11();
    outlookDist.No = [0, 0.5, 0.5];
    expectIssue(errorsOf(validate(model)), "AM_E_DISTRIBUTION_SUM", "Outlook");
  });

  it("probabilitas non-finite/null → AM_E_DISTRIBUTION_SUM", () => {
    const { model, outlookDist } = modelV11();
    outlookDist.Yes = [null, 0.5, 0.5];
    expectIssue(errorsOf(validate(model)), "AM_E_DISTRIBUTION_SUM", "Outlook");
  });
});

describe("naiveBayesModelAdapter.validate — langkah 10 (numerical)", () => {
  it("mean/variance tanpa key kelas → AM_E_GAUSSIAN_CLASS_MISSING", () => {
    const { model, tempMean } = modelV11();
    delete tempMean.Yes;
    expectIssue(errorsOf(validate(model)), "AM_E_GAUSSIAN_CLASS_MISSING", "Temp");
  });

  it("variance ≤ 0 → AM_E_GAUSSIAN_INVALID", () => {
    const { model, tempVariance } = modelV11();
    tempVariance.No = 0;
    expectIssue(errorsOf(validate(model)), "AM_E_GAUSSIAN_INVALID", "Temp");
  });

  it("mean tidak finite (null) → AM_E_GAUSSIAN_INVALID", () => {
    const { model, tempMean } = modelV11();
    tempMean.Yes = null;
    expectIssue(errorsOf(validate(model)), "AM_E_GAUSSIAN_INVALID", "Temp");
  });
});

describe("naiveBayesModelAdapter.validate — langkah 11 (khusus 1.1)", () => {
  it("class_counts tidak ada → AM_E_COUNTS_INVALID (bukan AM_E_FIELD_MISSING)", () => {
    const { model, target } = modelV11();
    delete target.class_counts;
    const errors = errorsOf(validate(model));
    expectIssue(errors, "AM_E_COUNTS_INVALID", "target.class_counts");
    expect(codesOf(errors)).not.toContain("AM_E_FIELD_MISSING");
  });

  it("class_counts bukan array → AM_E_COUNTS_INVALID", () => {
    const { model, target } = modelV11();
    target.class_counts = "3,3";
    expectIssue(errorsOf(validate(model)), "AM_E_COUNTS_INVALID", "target.class_counts");
  });

  it("class_counts panjang ≠ jumlah kelas → AM_E_COUNTS_INVALID", () => {
    const { model, target } = modelV11();
    target.class_counts = [6];
    expectIssue(
      errorsOf(validate(model)),
      "AM_E_COUNTS_INVALID",
      "target.class_counts: length"
    );
  });

  it("class_counts negatif → AM_E_COUNTS_INVALID", () => {
    const { model, target } = modelV11();
    target.class_counts = [-1, 3];
    expectIssue(
      errorsOf(validate(model)),
      "AM_E_COUNTS_INVALID",
      "target.class_counts: values"
    );
  });

  it("class_counts bukan integer → AM_E_COUNTS_INVALID", () => {
    const { model, target } = modelV11();
    target.class_counts = [1.5, 4.5];
    expectIssue(
      errorsOf(validate(model)),
      "AM_E_COUNTS_INVALID",
      "target.class_counts: values"
    );
  });

  it("jumlah class_counts = 0 → AM_E_COUNTS_INVALID", () => {
    const { model, target } = modelV11();
    target.class_counts = [0, 0];
    expectIssue(
      errorsOf(validate(model)),
      "AM_E_COUNTS_INVALID",
      "target.class_counts: sum is 0"
    );
  });

  it("class_priors tidak sesuai class_counts/Σ → AM_E_COUNTS_INCONSISTENT (detail kelas pertama yang menyimpang)", () => {
    const { model, target } = modelV11();
    target.class_counts = [1, 5]; // 1/6 ≠ 0.5
    const errors = errorsOf(validate(model));
    expect(errors).toEqual([
      { code: "AM_E_COUNTS_INCONSISTENT", severity: "error", detail: "No" },
    ]);
  });

  it("selisih prior vs counts 2e-6 → AM_E_COUNTS_INCONSISTENT; 5e-7 → lolos", () => {
    const off = modelV11();
    off.target.class_priors = [0.5 + 2e-6, 0.5 - 2e-6];
    expectIssue(errorsOf(validate(off.model)), "AM_E_COUNTS_INCONSISTENT", "No");

    const within = modelV11();
    within.target.class_priors = [0.5 + 5e-7, 0.5 - 5e-7];
    expectOk(validate(within.model));
  });

  it("class_totals tidak ada → AM_E_CLASS_TOTALS_INVALID (detail nama fitur)", () => {
    const { model, outlook } = modelV11();
    delete outlook.class_totals;
    expect(errorsOf(validate(model))).toEqual([
      { code: "AM_E_CLASS_TOTALS_INVALID", severity: "error", detail: "Outlook" },
    ]);
  });

  it("class_totals tanpa key kelas → AM_E_CLASS_TOTALS_INVALID", () => {
    const { model, outlookTotals } = modelV11();
    delete outlookTotals.Yes;
    expectIssue(errorsOf(validate(model)), "AM_E_CLASS_TOTALS_INVALID", "Outlook");
  });

  it("class_totals negatif → AM_E_CLASS_TOTALS_INVALID", () => {
    const { model, outlookTotals } = modelV11();
    outlookTotals.No = -3;
    expectIssue(errorsOf(validate(model)), "AM_E_CLASS_TOTALS_INVALID", "Outlook");
  });

  it("class_totals bukan integer → AM_E_CLASS_TOTALS_INVALID", () => {
    const { model, outlookTotals } = modelV11();
    outlookTotals.Yes = 2.5;
    expectIssue(errorsOf(validate(model)), "AM_E_CLASS_TOTALS_INVALID", "Outlook");
  });

  it("class_totals bukan objek → AM_E_CLASS_TOTALS_INVALID", () => {
    const { model, outlook } = modelV11();
    outlook.class_totals = [3, 3];
    expectIssue(errorsOf(validate(model)), "AM_E_CLASS_TOTALS_INVALID", "Outlook");
  });

  it("fitur numerical tidak diperiksa class_totals-nya", () => {
    const { model, temp } = modelV11();
    delete temp.class_totals; // memang tidak ada di D1
    expectOk(validate(model));
  });
});

describe("naiveBayesModelAdapter.validate — semua error dikumpulkan (langkah 3–11)", () => {
  it("beberapa pelanggaran sekaligus dilaporkan dalam satu hasil, urut langkah", () => {
    const { model, target, outlookDist, tempVariance } = modelV11();
    target.classes = ["No", "No"]; // langkah 4
    model.smoothing_alpha = 0; // langkah 6
    outlookDist.No = [0.5, 0.5]; // langkah 9 (panjang)
    tempVariance.No = -1; // langkah 10
    const codes = codesOf(errorsOf(validate(model)));
    expect(codes).toEqual(
      expect.arrayContaining([
        "AM_E_CLASSES_DUPLICATE",
        "AM_E_PARAM_INVALID",
        "AM_E_DISTRIBUTION_LENGTH",
        "AM_E_GAUSSIAN_INVALID",
      ])
    );
    expect(codes.indexOf("AM_E_CLASSES_DUPLICATE")).toBeLessThan(
      codes.indexOf("AM_E_PARAM_INVALID")
    );
    expect(codes.indexOf("AM_E_DISTRIBUTION_LENGTH")).toBeLessThan(
      codes.indexOf("AM_E_GAUSSIAN_INVALID")
    );
  });
});
