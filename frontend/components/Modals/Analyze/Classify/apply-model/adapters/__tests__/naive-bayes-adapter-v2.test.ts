// AGENTS_V2.md §10.1 — test adapter Naive Bayes schema 2.0 (Fase A1).
// Model 1.0/1.1 harus tetap valid persis seperti sebelumnya (P-V1).

import { naiveBayesModelAdapter } from "@/components/Modals/Analyze/Classify/apply-model/adapters/naive-bayes-adapter";
import type { ModelValidationResult } from "@/components/Modals/Analyze/Classify/apply-model/adapters/types";
import type { ApplyModelIssue } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-codes";

// Fixture dimuat via require: tsconfig `composite: true` tidak mengizinkan
// import JSON via path alias (TS6307).
const nbModelV11 = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v1_1.json") as Record<string, unknown>;
const nbModelV10 = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v1_0.json") as Record<string, unknown>;
const nbModelRaw = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v2_0-raw.json") as Record<string, unknown>;
const nbModelVector = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/nb-model-v2_0-vector.json") as Record<string, unknown>;

type RawModel = Record<string, unknown>;

function clone(value: unknown): RawModel {
  return JSON.parse(JSON.stringify(value)) as RawModel;
}

function textOf(model: RawModel): RawModel {
  return model.text as RawModel;
}

function errorsOf(result: ModelValidationResult): ApplyModelIssue[] {
  if (result.ok) {
    throw new Error("Expected validation to fail, but it succeeded");
  }
  return result.errors;
}

function expectIssue(
  result: ModelValidationResult,
  code: ApplyModelIssue["code"],
  detail?: string
): void {
  const errors = errorsOf(result);
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

function expectOk(
  result: ModelValidationResult
): asserts result is Extract<ModelValidationResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(
      `Expected validation to succeed, got errors: ${JSON.stringify(result.errors)}`
    );
  }
}

const validate = (m: unknown) => naiveBayesModelAdapter.validate(m);

/** Model campuran 2.0: D1 (Outlook + Temp) + gaussian_minstd + Text vector. */
function mixedModel(): RawModel {
  const model = clone(nbModelV11);
  model.schema_version = "2.0";
  const features = model.features as RawModel[];
  features[0].likelihood = "categorical";
  features[1].likelihood = "gaussian_minstd";
  features[1].min_variance = 0.111111;
  const vec = clone(nbModelVector);
  const text = textOf(vec);
  // Kelas D1 = [No, Yes]: pindahkan parameter golden ke nama kelas D1.
  const remap = (o: RawModel): RawModel => ({ No: o.neg, Yes: o.pos });
  text.log_weights = remap(text.log_weights as RawModel);
  text.class_term_counts = remap(text.class_term_counts as RawModel);
  model.text = text;
  return model;
}

describe("naiveBayesModelAdapter — schema 2.0", () => {
  it("supportedSchemaVersions memuat 1.0, 1.1, 2.0", () => {
    expect(naiveBayesModelAdapter.supportedSchemaVersions).toEqual(["1.0", "1.1", "2.0"]);
  });

  it("fixture raw (golden §6.7) valid; descriptor memuat info Text dan feature kosong", () => {
    const result = validate(nbModelRaw);
    expectOk(result);
    expect(result.descriptor.schemaVersion).toBe("2.0");
    expect(result.descriptor.classes).toEqual(["neg", "pos"]);
    expect(result.descriptor.features).toEqual([]);
    expect(result.descriptor.warnings).toEqual([]);
    expect(result.descriptor.text).toEqual({
      source: "raw",
      likelihood: "multinomial",
      alpha: 1,
      termCount: 5,
      rawVariable: "Teks",
      columns: [],
    });
    const labels = result.descriptor.summaryRows.map((r) => r.label);
    expect(labels).toEqual([
      "Smoothing alpha",
      "Variance floor",
      "Training validation",
      "Text source",
      "Text likelihood",
      "Text terms",
      "Text alpha",
    ]);
    const row = (label: string) =>
      result.descriptor.summaryRows.find((r) => r.label === label)?.value;
    expect(row("Text source")).toBe("Raw text: 'Teks'");
    expect(row("Text likelihood")).toBe("Multinomial");
    expect(row("Text terms")).toBe("5");
    expect(row("Text alpha")).toBe("1");
  });

  it("fixture vector valid; descriptor memuat kolom vektor", () => {
    const result = validate(nbModelVector);
    expectOk(result);
    expect(result.descriptor.text?.source).toBe("vector");
    expect(result.descriptor.text?.rawVariable).toBeNull();
    expect(result.descriptor.text?.columns).toEqual([
      "VEC_makan",
      "VEC_nasi",
      "VEC_saya",
      "VEC_suka",
      "VEC_tidak",
    ]);
    expect(
      result.descriptor.summaryRows.find((r) => r.label === "Text source")?.value
    ).toBe("Word vectors");
  });

  it("model campuran (gaussian_minstd + categorical + Text vector) valid", () => {
    const result = validate(mixedModel());
    expectOk(result);
    expect(result.descriptor.features).toEqual([
      { name: "Outlook", role: "categorical" },
      { name: "Temp", role: "numerical" },
    ]);
    expect(result.descriptor.text?.termCount).toBe(5);
  });

  it("2.0 dengan text: null dan fitur biasa valid; descriptor tanpa key text", () => {
    const model = clone(nbModelV11);
    model.schema_version = "2.0";
    model.text = null;
    const result = validate(model);
    expectOk(result);
    expect("text" in result.descriptor).toBe(false);
  });

  it("2.0 tanpa key text sama dengan text: null (valid)", () => {
    const model = clone(nbModelV11);
    model.schema_version = "2.0";
    expectOk(validate(model));
  });

  it("Bernoulli dengan log_weights_absent valid", () => {
    const model = clone(nbModelVector);
    const text = textOf(model);
    text.likelihood = "bernoulli";
    text.log_weights_absent = clone(text.log_weights);
    expectOk(validate(model));
  });

  it("Complement hanya-Text dengan uses_class_prior=false valid", () => {
    const model = clone(nbModelVector);
    const text = textOf(model);
    text.likelihood = "complement";
    text.uses_class_prior = false;
    expectOk(validate(model));
  });
});

describe("naiveBayesModelAdapter — model 1.0/1.1 tetap valid (P-V1)", () => {
  it("D1 (1.1) dan D2 (1.0) valid; descriptor tidak punya key text", () => {
    const v11 = validate(nbModelV11);
    expectOk(v11);
    expect("text" in v11.descriptor).toBe(false);
    expect(v11.descriptor.summaryRows).toHaveLength(3);
    const v10 = validate(nbModelV10);
    expectOk(v10);
    expect(v10.descriptor.warnings).toEqual(["AM_W_LEGACY_SCHEMA"]);
  });

  it("blok text pada schema 1.1 diabaikan (tidak divalidasi, tidak masuk descriptor)", () => {
    const model = clone(nbModelV11);
    model.text = { source: "ngawur" };
    const result = validate(model);
    expectOk(result);
    expect("text" in result.descriptor).toBe(false);
  });

  it("feature_order kosong tanpa Text tetap AM_E_FEATURE_ORDER_MISMATCH", () => {
    const model = clone(nbModelV11);
    model.features = [];
    model.feature_order = [];
    expectIssue(validate(model), "AM_E_FEATURE_ORDER_MISMATCH", "feature_order is empty");
  });

  it("versi di luar 1.0/1.1/2.0 tetap AM_E_SCHEMA_VERSION_UNSUPPORTED", () => {
    const model = clone(nbModelV11);
    model.schema_version = "3.0";
    expectIssue(validate(model), "AM_E_SCHEMA_VERSION_UNSUPPORTED", "3.0");
  });
});

describe("naiveBayesModelAdapter — validasi 2.0 gagal", () => {
  it("2.0 tanpa target.class_counts -> AM_E_COUNTS_INVALID (field 1.1 wajib)", () => {
    const model = clone(nbModelVector);
    delete (model.target as RawModel).class_counts;
    expectIssue(validate(model), "AM_E_COUNTS_INVALID", "target.class_counts");
  });

  it("AM_E_NB2_TEXT_SHAPE: panjang log_weights[kelas] tidak sama dengan terms", () => {
    const model = clone(nbModelVector);
    ((textOf(model).log_weights as RawModel).neg as number[]).pop();
    expectIssue(validate(model), "AM_E_NB2_TEXT_SHAPE");
  });

  it("AM_E_NB2_TEXT_SHAPE: panjang class_term_counts[kelas] tidak sama dengan terms", () => {
    const model = clone(nbModelVector);
    ((textOf(model).class_term_counts as RawModel).pos as number[]).push(1);
    expectIssue(validate(model), "AM_E_NB2_TEXT_SHAPE");
  });

  it("AM_E_NB2_TEXT_SHAPE: kelas hilang pada log_weights", () => {
    const model = clone(nbModelVector);
    delete (textOf(model).log_weights as RawModel).pos;
    expectIssue(validate(model), "AM_E_NB2_TEXT_SHAPE", "text.log_weights[pos]");
  });

  it("AM_E_NB2_TEXT_SHAPE: columns berbeda panjang dengan terms", () => {
    const model = clone(nbModelVector);
    (textOf(model).columns as string[]).pop();
    expectIssue(validate(model), "AM_E_NB2_TEXT_SHAPE");
  });

  it("AM_E_NB2_TEXT_SHAPE: recipe.vocabulary berbeda dari terms (raw)", () => {
    const model = clone(nbModelRaw);
    const recipe = textOf(model).recipe as RawModel;
    (recipe.vocabulary as string[]).reverse();
    expectIssue(validate(model), "AM_E_NB2_TEXT_SHAPE");
  });

  it("AM_E_NB2_TEXT_SHAPE: Bernoulli tanpa log_weights_absent", () => {
    const model = clone(nbModelVector);
    textOf(model).likelihood = "bernoulli";
    expectIssue(validate(model), "AM_E_NB2_TEXT_SHAPE", "text.log_weights_absent");
  });

  it("AM_E_NB2_TEXT_SOURCE: raw tanpa recipe", () => {
    const model = clone(nbModelRaw);
    textOf(model).recipe = null;
    expectIssue(validate(model), "AM_E_NB2_TEXT_SOURCE", "raw source without text preprocessing settings");
  });

  it("AM_E_NB2_TEXT_SOURCE: raw tanpa raw_variable", () => {
    const model = clone(nbModelRaw);
    textOf(model).raw_variable = null;
    expectIssue(validate(model), "AM_E_NB2_TEXT_SOURCE", "raw source without raw_variable");
  });

  it("AM_E_NB2_TEXT_SOURCE: vector tanpa columns", () => {
    const model = clone(nbModelVector);
    textOf(model).columns = null;
    expectIssue(validate(model), "AM_E_NB2_TEXT_SOURCE", "vector source without columns");
  });

  it("AM_E_NB2_TEXT_SOURCE: source tidak dikenal", () => {
    const model = clone(nbModelVector);
    textOf(model).source = "gambar";
    expectIssue(validate(model), "AM_E_NB2_TEXT_SOURCE", "source=gambar");
  });

  it("AM_E_NB2_LIKELIHOOD: likelihood Text tidak dikenal", () => {
    const model = clone(nbModelVector);
    textOf(model).likelihood = "poisson";
    expectIssue(validate(model), "AM_E_NB2_LIKELIHOOD", "text: poisson");
  });

  it("AM_E_NB2_LIKELIHOOD: likelihood fitur numerik tidak dikenal", () => {
    const model = mixedModel();
    (model.features as RawModel[])[1].likelihood = "kde";
    expectIssue(validate(model), "AM_E_NB2_LIKELIHOOD", "Temp: kde");
  });

  it("AM_E_NB2_COMPLEMENT_MIXED: Complement dengan fitur non-Text", () => {
    const model = mixedModel();
    const text = textOf(model);
    text.likelihood = "complement";
    text.uses_class_prior = false;
    expectIssue(validate(model), "AM_E_NB2_COMPLEMENT_MIXED");
  });

  // Revisi v2 (A3, keputusan pemilik A2 #7): konsistensi uses_class_prior dengan likelihood & K.
  it("AM_E_NB2_LIKELIHOOD: Complement (K=2) dengan uses_class_prior=true ditolak", () => {
    const model = clone(nbModelVector);
    const text = textOf(model);
    text.likelihood = "complement";
    text.uses_class_prior = true;
    expectIssue(
      validate(model),
      "AM_E_NB2_LIKELIHOOD",
      "text.uses_class_prior=true, expected false for complement"
    );
  });

  it("AM_E_NB2_LIKELIHOOD: Multinomial dengan uses_class_prior=false ditolak", () => {
    const model = clone(nbModelVector);
    textOf(model).uses_class_prior = false;
    expectIssue(
      validate(model),
      "AM_E_NB2_LIKELIHOOD",
      "text.uses_class_prior=false, expected true for multinomial"
    );
  });

  it("AM_E_NB2_LIKELIHOOD: Bernoulli dengan uses_class_prior=false ditolak", () => {
    const model = clone(nbModelVector);
    const text = textOf(model);
    text.likelihood = "bernoulli";
    text.log_weights_absent = clone(text.log_weights);
    text.uses_class_prior = false;
    expectIssue(validate(model), "AM_E_NB2_LIKELIHOOD", "text.uses_class_prior=false, expected true for bernoulli");
  });

  it("uses_class_prior konsisten: Complement K=2 false dan Multinomial true tetap valid; tipe salah tetap AM_E_FIELD_TYPE", () => {
    const complement = clone(nbModelVector);
    textOf(complement).likelihood = "complement";
    textOf(complement).uses_class_prior = false;
    expectOk(validate(complement));
    expectOk(validate(nbModelVector));

    const wrongType = clone(nbModelVector);
    textOf(wrongType).uses_class_prior = "ya";
    const errors = errorsOf(validate(wrongType));
    expect(errors.some((e) => e.code === "AM_E_FIELD_TYPE" && e.detail === "text.uses_class_prior")).toBe(true);
    expect(errors.some((e) => e.code === "AM_E_NB2_LIKELIHOOD")).toBe(false);
  });

  it("gaussian_minstd tanpa min_variance valid -> AM_E_GAUSSIAN_INVALID", () => {
    const model = mixedModel();
    delete (model.features as RawModel[])[1].min_variance;
    expectIssue(validate(model), "AM_E_GAUSSIAN_INVALID", "Temp");
  });

  it("alpha Text <= 0 -> AM_E_PARAM_INVALID (text.alpha)", () => {
    const model = clone(nbModelVector);
    textOf(model).alpha = 0;
    expectIssue(validate(model), "AM_E_PARAM_INVALID", "text.alpha");
  });

  it("text bukan objek -> AM_E_FIELD_TYPE", () => {
    const model = clone(nbModelVector);
    model.text = "teks";
    expectIssue(validate(model), "AM_E_FIELD_TYPE", "text");
  });
});
