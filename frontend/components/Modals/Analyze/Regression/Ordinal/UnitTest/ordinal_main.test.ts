import "@testing-library/jest-dom";
import type { Variable } from "@/types/Variable";
import type {
  OrdinalOptions,
  OrdinalLocationParams,
  OrdinalScaleParams,
  OrdinalOptionsParams,
  OrdinalOutputParams,
  LocationModelTerm,
  LocationInteraction,
} from "../types/ordinal";
import {
  buildOrdinalPlumDesignMatrix,
  extractOrdinalDependentCategories,
} from "../services/plum_design_matrix";

/**
 * Interface parameter input untuk pure logic runner OrdinalMain
 */
export interface OrdinalMainLogicInput {
  options: OrdinalOptions;
  locationParams: OrdinalLocationParams;
  scaleParams: OrdinalScaleParams;
  optParams: OrdinalOptionsParams;
  outputParams: OrdinalOutputParams;
  data: any[];
  weights?: number[];
  variablesFromStore: Variable[];
}

/**
 * Runner logika murni dari workflow handleAnalyze pada OrdinalMain
 * Merefleksikan setiap cabang (simpul/node) keputusan dari Node 1 sampai Node 17
 */
export function runOrdinalMainLogic(input: OrdinalMainLogicInput) {
  const {
    options,
    locationParams,
    scaleParams,
    optParams,
    outputParams,
    data,
    weights = [],
    variablesFromStore,
  } = input;

  const isMissingValue = (value: unknown) =>
    value === null || value === undefined || value === "";

  const isValidRow = (row: unknown) =>
    row !== null && row !== undefined && (Array.isArray(row) || typeof row === "object");

  const getRowValue = (row: any, columnIndex: number) => row?.[columnIndex];

  const toNumberOrThrow = (value: unknown, label: string) => {
    const numeric = Number(value);
    if (Number.isNaN(numeric) || !Number.isFinite(numeric)) {
      throw new Error(`Variabel '${label}' kontinu/rasio, kovariat wajib bertipe numerik.`);
    }
    return numeric;
  };

  const getVariableKey = (variable: Variable) => `${variable.columnIndex}-${variable.name}`;

  const getVariableIdentity = (variable: Variable) => {
    if (typeof variable.columnIndex === "number") {
      return `col:${variable.columnIndex}`;
    }
    return `name:${variable.name}`;
  };

  const isInteraction = (term: LocationModelTerm): term is LocationInteraction =>
    typeof term === "object" && "kind" in term && term.kind === "interaction";

  const buildInteractionKey = (variables: Variable[]) =>
    variables.map(getVariableKey).sort().join("::");

  const buildLocationPredictors = (responseVariable: Variable, predictors: LocationModelTerm[]) => {
    const variableTerms: Variable[] = [];
    const interactionTerms: LocationInteraction[] = [];
    const seenVariables = new Set<string>();
    const seenInteractions = new Set<string>();

    for (const term of predictors) {
      if (isInteraction(term)) {
        if (!Array.isArray(term.variables) || term.variables.length < 2) {
          throw new Error("Suku interaksi harus memiliki minimal 2 variabel.");
        }
        for (const variable of term.variables) {
          if (
            responseVariable?.id === variable?.id ||
            responseVariable?.columnIndex === variable?.columnIndex
          ) {
            throw new Error("Prediktor tidak boleh sama dengan variabel dependen (respon).");
          }
        }
        const interactionKey = buildInteractionKey(term.variables);
        if (seenInteractions.has(interactionKey)) {
          throw new Error("Suku interaksi tidak boleh duplikat.");
        }
        seenInteractions.add(interactionKey);
        interactionTerms.push(term);
      } else {
        const key = getVariableKey(term);
        if (
          responseVariable?.id === term?.id ||
          responseVariable?.columnIndex === term?.columnIndex
        ) {
          throw new Error("Prediktor tidak boleh sama dengan variabel dependen (respon).");
        }
        if (seenVariables.has(key)) {
          throw new Error("Prediktor tidak boleh duplikat.");
        }
        seenVariables.add(key);
        variableTerms.push(term);
      }
    }

    return { variableTerms, interactionTerms };
  };

  // Node 2: Cek Fitur Scale Model
  if ((scaleParams.scaleModel ?? []).length > 0) {
    throw new Error("Fitur belum tersedia");
  }

  // Node 4: Validasi Variabel Dependen
  const responseVariable = options.dependent;
  if (!responseVariable) {
    throw new Error("Mohon pilih variabel dependen.");
  }
  if (typeof responseVariable.columnIndex !== "number") {
    throw new Error("Response variable tidak memiliki columnIndex yang valid.");
  }
  if (responseVariable.measure !== "ordinal") {
    throw new Error("Variabel respon wajib bertipe Ordinal.");
  }

  // Node 5: Validasi Dataset Tidak Kosong
  if (!data || data.length === 0) {
    throw new Error("Dataset kosong atau tidak tersedia.");
  }

  // Node 6: Validasi Parameter Options (non-negatif)
  if (
    optParams.maxIterations < 0 ||
    optParams.maxStepHalving < 0 ||
    optParams.logLikelihoodConvergence < 0 ||
    optParams.parameterConvergence < 0 ||
    optParams.confidenceInterval < 0 ||
    optParams.delta < 0 ||
    optParams.singularityTolerance < 0
  ) {
    if (optParams.maxIterations < 0) throw new Error("Maximum iterations tidak boleh minus.");
    if (optParams.maxStepHalving < 0) throw new Error("Maximum step-halving tidak boleh minus.");
    if (optParams.logLikelihoodConvergence < 0) throw new Error("Log-likelihood convergence tidak boleh minus.");
    if (optParams.parameterConvergence < 0) throw new Error("Parameter convergence tidak boleh minus.");
    if (optParams.confidenceInterval < 0) throw new Error("Confidence interval tidak boleh minus.");
    if (optParams.delta < 0) throw new Error("Delta tidak boleh minus.");
    if (optParams.singularityTolerance < 0) throw new Error("Singularity tolerance tidak boleh minus.");
  }

  const factors = options.factors;
  const covariates = options.covariates;

  // Node 7: Validasi Measure Faktor & Kovariat
  for (const factor of factors) {
    if (factor.measure !== "nominal" && factor.measure !== "ordinal") {
      throw new Error(`Variabel faktor '${factor.name}' harus memiliki tipe pengukuran Nominal atau Ordinal.`);
    }
  }

  for (const covariate of covariates) {
    if (covariate.measure !== "scale") {
      throw new Error(`Variabel kovariat '${covariate.name}' harus memiliki tipe pengukuran Scale.`);
    }
  }

  const factorIdentities = new Set(factors.map(getVariableIdentity));
  const covariateIdentities = new Set(covariates.map(getVariableIdentity));
  Array.from(factorIdentities).forEach((identity) => {
    if (covariateIdentities.has(identity)) {
      throw new Error("Variabel yang sama tidak boleh muncul di factors dan covariates.");
    }
  });

  // Node 8: Penentuan Prediktor Model Lokasi
  const locationPredictorsRaw: LocationModelTerm[] =
    locationParams.locationModel.length > 0
      ? locationParams.locationModel
      : [...factors, ...covariates];

  if (locationPredictorsRaw.length === 0) {
    throw new Error("Minimal 1 variabel independen.");
  }

  // Node 9: Validasi Keanggotaan Prediktor & Interaksi
  const { variableTerms: locationPredictors, interactionTerms } = buildLocationPredictors(
    responseVariable,
    locationPredictorsRaw
  );

  for (const predictor of locationPredictors) {
    const identity = getVariableIdentity(predictor);
    if (!factorIdentities.has(identity) && !covariateIdentities.has(identity)) {
      throw new Error(`Prediktor '${predictor.name}' harus berada di Faktor atau Kovariat.`);
    }
  }

  for (const interaction of interactionTerms) {
    for (const variable of interaction.variables) {
      const identity = getVariableIdentity(variable);
      if (!factorIdentities.has(identity) && !covariateIdentities.has(identity)) {
        throw new Error(`Variabel interaksi '${variable.name}' harus berada di Faktor atau Kovariat.`);
      }
    }
  }

  // Node 10: Filtering Baris & Listwise Deletion
  const validRows: any[] = [];
  const validWeights: number[] = [];
  const originalRowIndices: number[] = [];
  const droppedRows: any[] = [];
  let totalWeightAll = 0;

  for (let rowIndex = 0; rowIndex < data.length; rowIndex += 1) {
    const row = data[rowIndex];
    const weight = weights[rowIndex] ?? 1;
    if (!isValidRow(row) || typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) {
      droppedRows.push(row);
      continue;
    }
    totalWeightAll += weight;

    const responseValue = getRowValue(row, responseVariable.columnIndex);
    if (isMissingValue(responseValue)) {
      droppedRows.push(row);
      continue;
    }

    let rowValid = true;
    for (const predictor of locationPredictors) {
      const predictorIndex = predictor?.columnIndex;
      if (typeof predictorIndex !== "number") {
        throw new Error(`Prediktor "${predictor?.name ?? ""}" tidak memiliki columnIndex yang valid.`);
      }
      const predictorValue = getRowValue(row, predictorIndex);
      if (isMissingValue(predictorValue)) {
        rowValid = false;
        break;
      }
    }

    if (rowValid) {
      for (const interaction of interactionTerms) {
        for (const variable of interaction.variables) {
          const predictorIndex = variable?.columnIndex;
          if (typeof predictorIndex !== "number") {
            throw new Error(`Variabel interaksi "${variable?.name ?? ""}" tidak memiliki columnIndex yang valid.`);
          }
          const predictorValue = getRowValue(row, predictorIndex);
          if (isMissingValue(predictorValue)) {
            rowValid = false;
            break;
          }
        }
        if (!rowValid) break;
      }
    }

    if (rowValid) {
      validRows.push(row);
      validWeights.push(weight);
      originalRowIndices.push(rowIndex);
    } else {
      droppedRows.push(row);
    }
  }

  // Node 11: Validasi Baris Valid > 0
  if (validRows.length === 0) {
    throw new Error("Semua baris terhapus setelah penghapusan data hilang (listwise deletion).");
  }

  // Node 12: Ekstraksi Kategori Respon & Validasi Minimal 3 Kategori
  const responseValues = validRows.map((row) => getRowValue(row, responseVariable.columnIndex));
  const responseCategories = extractOrdinalDependentCategories(responseValues, responseVariable);

  if (responseCategories.length < 3) {
    throw new Error("Variabel dependen (respon) harus memiliki minimal 3 kategori untuk regresi ordinal.");
  }

  const responseCategoriesNumeric = responseCategories.every((value) => typeof value === "number");
  const responseCategoryMap = new Map<string | number, number>();
  responseCategories.forEach((category, index) => {
    const key = responseCategoriesNumeric ? (category as number) : String(category);
    responseCategoryMap.set(key, index + 1);
  });

  const responseVector = responseValues.map((value) => {
    const key = responseCategoriesNumeric ? (value as number) : String(value);
    return responseCategoryMap.get(key);
  });

  if (responseVector.some((value) => value === undefined)) {
    throw new Error("Pengkodean vektor respon gagal karena kategori tidak valid.");
  }

  // Node 13: Konstruksi Design Matrix PLUM
  const factorPredictors = locationPredictors.filter((predictor) =>
    factorIdentities.has(getVariableIdentity(predictor))
  );
  const covariatePredictors = locationPredictors.filter((predictor) =>
    covariateIdentities.has(getVariableIdentity(predictor))
  );

  const interactionFactorIdentities = new Set<string>();
  interactionTerms.forEach((interaction) => {
    interaction.variables.forEach((variable) => {
      const identity = getVariableIdentity(variable);
      if (factorIdentities.has(identity)) {
        interactionFactorIdentities.add(identity);
      }
    });
  });

  const allModelFactors = factors.filter((factor) => {
    const identity = getVariableIdentity(factor);
    return (
      factorPredictors.some((p) => getVariableIdentity(p) === identity) ||
      interactionFactorIdentities.has(identity)
    );
  });

  const designMatrixResult = buildOrdinalPlumDesignMatrix({
    rows: validRows,
    factors: factorPredictors,
    allFactors: allModelFactors,
    covariates: covariatePredictors,
    interactions: interactionTerms,
    getRowValue,
    toNumberOrThrow,
  });

  // Node 14: Validasi Integritas Matriks Desain
  const { locationDesignMatrix, locationTermNames, activeParameterCount } = designMatrixResult;
  if (activeParameterCount > validRows.length) {
    throw new Error("Jumlah parameter aktif melebihi jumlah observasi efektif.");
  }
  if (locationDesignMatrix.length === 0 || locationDesignMatrix[0]?.length === 0) {
    throw new Error("Matriks desain lokasi kosong.");
  }
  if (locationDesignMatrix.length !== responseVector.length) {
    throw new Error("Jumlah baris matriks desain lokasi tidak sesuai dengan panjang vektor respon.");
  }

  // Node 15: Perakitan Payload Worker
  const payload = {
    analysisType: "ORDINAL_REGRESSION_PLUM",
    procedure: "PLUM",
    dependent: {
      name: responseVariable.name,
      columnIndex: responseVariable.columnIndex,
    },
    weights: validWeights,
    response: {
      responseCategories,
      responseVector,
      categoryCount: responseCategories.length,
    },
    locationModel: {
      locationDesignMatrix,
      locationTermNames,
      parameterCount: locationTermNames.length,
    },
    estimationOptions: {
      linkFunction: optParams.linkFunction,
      maxIterations: optParams.maxIterations,
      confidenceLevel: optParams.confidenceInterval,
    },
  };

  return {
    success: true,
    payload,
    validRowsCount: validRows.length,
    droppedRowsCount: droppedRows.length,
  };
}

// ========================================================================
// SUITE PENGUJIAN BASIS PATH TESTING ORDINAL MAIN
// ========================================================================
describe("White-Box: OrdinalMain Workflow & Decision Paths", () => {
  const createVar = (overrides: Partial<Variable> & { name: string; columnIndex: number }): Variable => ({
    id: overrides.columnIndex,
    // name: overrides.name,
    // columnIndex: overrides.columnIndex,
    label: overrides.name.toUpperCase(),
    type: "NUMERIC",
    width: 8,
    decimals: 0,
    values: [],
    missing: null,
    columns: 8,
    align: "right",
    measure: "scale",
    role: "input",
    ...overrides,
  });

  const baseOptParams: OrdinalOptionsParams = {
    maxIterations: 100,
    maxStepHalving: 5,
    logLikelihoodConvergence: 0,
    parameterConvergence: 0.000001,
    confidenceInterval: 95,
    delta: 0,
    singularityTolerance: 0.00000001,
    linkFunction: "Logit",
  };

  const baseOutputParams: OrdinalOutputParams = {
    display: {
      goodnessOfFit: true,
      summaryStatistics: true,
      parameterEstimates: true,
      asymptoticCovariance: false,
      asymptoticCorrelation: false,
      testOfParallelLines: false,
      iterationHistory: false,
      iterationHistoryStep: 1,
      printIterationHistory: false,
      iterationHistoryEvery: 1,
    },
    savedVariables: {
      predictedResponseCategory: false,
      estimatedResponseProbabilities: false,
      predictedCategoryProbability: false,
      actualCategoryProbability: false,
    },
    printLogLikelihood: "Including",
  };

  /**
   * Path 1: 1 -> 2 -> 3 -> 17
   * Penolakan dini ketika Tab Scale diaktifkan / berisi model
   * Input: scaleParams.scaleModel diisi prediktor
   * Expected: Error "Fitur belum tersedia"
   */
  it("Path 1 (1->2->3->17): Deteksi Scale Model aktif (Fitur belum tersedia)", () => {
    const scaleVar = createVar({ name: "scale_var", columnIndex: 3, measure: "scale" });
    expect(() =>
      runOrdinalMainLogic({
        options: { dependent: null, factors: [], covariates: [] },
        locationParams: { locationModel: [] },
        scaleParams: { scaleModel: [scaleVar] },
        optParams: baseOptParams,
        outputParams: baseOutputParams,
        data: [[1, 2]],
        variablesFromStore: [scaleVar],
      })
    ).toThrow("Fitur belum tersedia");
  });

  /**
   * Path 2: 1 -> 2 -> 4 -> 17
   * Validasi variabel dependen (Null / Missing / Bukan Ordinal)
   * Input: dependent = null
   * Expected: Error "Mohon pilih variabel dependen."
   */
  it("Path 2 (1->2->4->17): Variabel dependen kosong / bukan ordinal", () => {
    expect(() =>
      runOrdinalMainLogic({
        options: { dependent: null, factors: [], covariates: [] },
        locationParams: { locationModel: [] },
        scaleParams: { scaleModel: [] },
        optParams: baseOptParams,
        outputParams: baseOutputParams,
        data: [[1, 2]],
        variablesFromStore: [],
      })
    ).toThrow("Mohon pilih variabel dependen.");

    const nonOrdinalDep = createVar({ name: "y_cont", columnIndex: 0, measure: "scale" });
    expect(() =>
      runOrdinalMainLogic({
        options: { dependent: nonOrdinalDep, factors: [], covariates: [] },
        locationParams: { locationModel: [] },
        scaleParams: { scaleModel: [] },
        optParams: baseOptParams,
        outputParams: baseOutputParams,
        data: [[1, 2]],
        variablesFromStore: [nonOrdinalDep],
      })
    ).toThrow("Variabel respon wajib bertipe Ordinal.");
  });

  /**
   * Path 3: 1 -> 2 -> 4 -> 5 -> 17
   * Validasi dataset kosong
   * Input: data = []
   * Expected: Error "Dataset kosong atau tidak tersedia."
   */
  it("Path 3 (1->2->4->5->17): Dataset kosong", () => {
    const depVar = createVar({ name: "y", columnIndex: 0, measure: "ordinal" });
    expect(() =>
      runOrdinalMainLogic({
        options: { dependent: depVar, factors: [], covariates: [] },
        locationParams: { locationModel: [] },
        scaleParams: { scaleModel: [] },
        optParams: baseOptParams,
        outputParams: baseOutputParams,
        data: [],
        variablesFromStore: [depVar],
      })
    ).toThrow("Dataset kosong atau tidak tersedia.");
  });

  /**
   * Path 4: 1 -> 2 -> 4 -> 5 -> 6 -> 17
   * Validasi parameter options bernilai negatif
   * Input: maxIterations = -10
   * Expected: Error "Maximum iterations tidak boleh minus."
   */
  it("Path 4 (1->2->4->5->6->17): Parameter opsi numerik negatif (minus)", () => {
    const depVar = createVar({ name: "y", columnIndex: 0, measure: "ordinal" });
    expect(() =>
      runOrdinalMainLogic({
        options: { dependent: depVar, factors: [], covariates: [] },
        locationParams: { locationModel: [] },
        scaleParams: { scaleModel: [] },
        optParams: { ...baseOptParams, maxIterations: -5 },
        outputParams: baseOutputParams,
        data: [[1]],
        variablesFromStore: [depVar],
      })
    ).toThrow("Maximum iterations tidak boleh minus.");
  });

  /**
   * Path 5: 1 -> 2 -> 4 -> 5 -> 6 -> 7 -> 17
   * Validasi tipe pengukuran (measure) prediktor yang tidak sesuai
   * Input: Faktor bertipe Scale (seharusnya Nominal/Ordinal) atau Kovariat bukan Scale
   * Expected: Error "Variabel faktor 'f1' harus memiliki tipe pengukuran Nominal atau Ordinal."
   */
  it("Path 5 (1->2->4->5->6->7->17): Tipe pengukuran prediktor tidak sesuai", () => {
    const depVar = createVar({ name: "y", columnIndex: 0, measure: "ordinal" });
    const invalidFactor = createVar({ name: "f1", columnIndex: 1, measure: "scale" });
    expect(() =>
      runOrdinalMainLogic({
        options: { dependent: depVar, factors: [invalidFactor], covariates: [] },
        locationParams: { locationModel: [] },
        scaleParams: { scaleModel: [] },
        optParams: baseOptParams,
        outputParams: baseOutputParams,
        data: [[1, 2]],
        variablesFromStore: [depVar, invalidFactor],
      })
    ).toThrow("Variabel faktor 'f1' harus memiliki tipe pengukuran Nominal atau Ordinal.");
  });

  /**
   * Path 6: 1 -> 2 -> 4 -> 5 -> 6 -> 7 -> 8 -> 17
   * Tidak ada prediktor independen yang dipilih (model kosong)
   * Input: factors = [], covariates = [], locationModel = []
   * Expected: Error "Minimal 1 variabel independen."
   */
  it("Path 6 (1->2->4->5->6->7->8->17): Tidak ada prediktor independen", () => {
    const depVar = createVar({ name: "y", columnIndex: 0, measure: "ordinal" });
    expect(() =>
      runOrdinalMainLogic({
        options: { dependent: depVar, factors: [], covariates: [] },
        locationParams: { locationModel: [] },
        scaleParams: { scaleModel: [] },
        optParams: baseOptParams,
        outputParams: baseOutputParams,
        data: [[1]],
        variablesFromStore: [depVar],
      })
    ).toThrow("Minimal 1 variabel independen.");
  });

  /**
   * Path 7: 1 -> 2 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 17
   * Validasi prediktor di tab location yang tidak terdaftar di factors/covariates
   * Input: locationModel memuat variabel yang tidak ada di daftar factors/covariates
   * Expected: Error "Prediktor 'unlisted_x' harus berada di Faktor atau Kovariat."
   */
  it("Path 7 (1->2->4->5->6->7->8->9->17): Prediktor custom tidak terdaftar di factors/covariates", () => {
    const depVar = createVar({ name: "y", columnIndex: 0, measure: "ordinal" });
    const f1 = createVar({ name: "f1", columnIndex: 1, measure: "nominal" });
    const unlisted = createVar({ name: "unlisted_x", columnIndex: 2, measure: "scale" });
    expect(() =>
      runOrdinalMainLogic({
        options: { dependent: depVar, factors: [f1], covariates: [] },
        locationParams: { locationModel: [unlisted] },
        scaleParams: { scaleModel: [] },
        optParams: baseOptParams,
        outputParams: baseOutputParams,
        data: [[1, 1, 10]],
        variablesFromStore: [depVar, f1, unlisted],
      })
    ).toThrow("Prediktor 'unlisted_x' harus berada di Faktor atau Kovariat.");
  });

  /**
   * Path 8: 1 -> 2 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10 -> 11 -> 17
   * Seluruh baris gugur pada listwise deletion (missing data total)
   * Input: Semua observasi memiliki nilai null/empty/NaN pada respon atau prediktor
   * Expected: Error "Semua baris terhapus setelah penghapusan data hilang (listwise deletion)."
   */
  it("Path 8 (1->...->10->11->17): Seluruh baris terhapus karena data hilang (listwise deletion)", () => {
    const depVar = createVar({ name: "y", columnIndex: 0, measure: "ordinal" });
    const x1 = createVar({ name: "x1", columnIndex: 1, measure: "scale" });
    expect(() =>
      runOrdinalMainLogic({
        options: { dependent: depVar, factors: [], covariates: [x1] },
        locationParams: { locationModel: [] },
        scaleParams: { scaleModel: [] },
        optParams: baseOptParams,
        outputParams: baseOutputParams,
        data: [
          [null, 10],
          [2, null],
          ["", 15],
        ],
        variablesFromStore: [depVar, x1],
      })
    ).toThrow("Semua baris terhapus setelah penghapusan data hilang (listwise deletion).");
  });

  /**
   * Path 9: 1 -> ... -> 10 -> 11 -> 12 -> 17
   * Kategori respon kurang dari 3 level (< 3 kategori unik)
   * Input: Respon hanya memiliki nilai 1 dan 2 (biner)
   * Expected: Error "Variabel dependen (respon) harus memiliki minimal 3 kategori untuk regresi ordinal."
   */
  it("Path 9 (1->...->12->17): Kategori respon kurang dari 3 level unik", () => {
    const depVar = createVar({
      name: "y",
      columnIndex: 0,
      measure: "ordinal",
      values: [
        { id: 1, variableId: 0, value: 1, label: "Low" },
        { id: 2, variableId: 0, value: 2, label: "High" },
      ],
    });
    const x1 = createVar({ name: "x1", columnIndex: 1, measure: "scale" });
    expect(() =>
      runOrdinalMainLogic({
        options: { dependent: depVar, factors: [], covariates: [x1] },
        locationParams: { locationModel: [] },
        scaleParams: { scaleModel: [] },
        optParams: baseOptParams,
        outputParams: baseOutputParams,
        data: [
          [1, 10],
          [2, 12],
          [1, 14],
        ],
        variablesFromStore: [depVar, x1],
      })
    ).toThrow("Variabel dependen (respon) harus memiliki minimal 3 kategori untuk regresi ordinal.");
  });

  /**
   * Path 10: 1 -> ... -> 13 -> 14 -> 17
   * Jumlah parameter melebihi derajat observasi (N < parameter)
   * Input: 1 baris data valid, namun model memiliki 2 parameter aktif
   * Expected: Error "Jumlah parameter aktif melebihi jumlah observasi efektif."
   */
  it("Path 10 (1->...->14->17): Parameter aktif melebihi observasi efektif", () => {
    const depVar = createVar({
      name: "y",
      columnIndex: 0,
      measure: "ordinal",
      values: [
        { id: 1, variableId: 0, value: 1, label: "Low" },
        { id: 2, variableId: 0, value: 2, label: "Medium" },
        { id: 3, variableId: 0, value: 3, label: "High" },
      ],
    });
    const f1 = createVar({
      name: "f1",
      columnIndex: 1,
      measure: "nominal",
      values: [
        { id: 1, variableId: 1, value: 1, label: "A" },
        { id: 2, variableId: 1, value: 2, label: "B" },
        { id: 3, variableId: 1, value: 3, label: "C" },
        { id: 4, variableId: 1, value: 4, label: "D" },
      ],
    });
    const x1 = createVar({ name: "x1", columnIndex: 2, measure: "scale" });

    // Hanya ada 3 baris observasi, namun factor memiliki 4 level (3 dummy) + 1 kovariat = 4 parameter
    expect(() =>
      runOrdinalMainLogic({
        options: { dependent: depVar, factors: [f1], covariates: [x1] },
        locationParams: { locationModel: [] },
        scaleParams: { scaleModel: [] },
        optParams: baseOptParams,
        outputParams: baseOutputParams,
        data: [
          [1, 1, 10.5],
          [2, 2, 12.1],
          [3, 3, 14.2],
        ],
        variablesFromStore: [depVar, f1, x1],
      })
    ).toThrow("Jumlah parameter aktif melebihi jumlah observasi efektif.");
  });

  /**
   * Path 11: 1 -> 2 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10 -> 11 -> 12 -> 13 -> 14 -> 15 -> 16
   * Eksekusi alur penuh sukses (Happy Path) tanpa kesalahan
   * Input: Dataset valid, variabel dependen 3 kategori (1, 2, 3), 1 faktor, 1 kovariat
   * Expected: Sukses, payload worker terkonstruksi secara akurat
   */
  it("Path 11 (1->...->15->16): Eksekusi alur penuh sukses (Happy Path)", () => {
    const depVar = createVar({
      name: "y",
      columnIndex: 0,
      measure: "ordinal",
      values: [
        { id: 1, variableId: 0, value: 1, label: "Low" },
        { id: 2, variableId: 0, value: 2, label: "Medium" },
        { id: 3, variableId: 0, value: 3, label: "High" },
      ],
    });
    const f1 = createVar({
      name: "gender",
      columnIndex: 1,
      measure: "nominal",
      values: [
        { id: 1, variableId: 1, value: 1, label: "Male" },
        { id: 2, variableId: 1, value: 2, label: "Female" },
      ],
    });
    const x1 = createVar({ name: "age", columnIndex: 2, measure: "scale" });

    const result = runOrdinalMainLogic({
      options: { dependent: depVar, factors: [f1], covariates: [x1] },
      locationParams: { locationModel: [] },
      scaleParams: { scaleModel: [] },
      optParams: baseOptParams,
      outputParams: baseOutputParams,
      data: [
        [1, 1, 25],
        [2, 2, 30],
        [3, 1, 35],
        [2, 2, 40],
      ],
      weights: [1, 1, 1, 1],
      variablesFromStore: [depVar, f1, x1],
    });

    expect(result.success).toBe(true);
    expect(result.validRowsCount).toBe(4);
    expect(result.payload.response.categoryCount).toBe(3);
    expect(result.payload.procedure).toBe("PLUM");
    expect(result.payload.locationModel.parameterCount).toBeGreaterThan(0);
  });
});
