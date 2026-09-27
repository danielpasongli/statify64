import init, {
  calculate_binary_logistic,
  calculate_vif,
  calculate_box_tidwell,
} from "./Binary/pkg/statify_logistic.js";

self.onmessage = async (event) => {
  const { action, data, config, dependentId, independentIds, variableDetails } =
    event.data;

  // Logging
  console.log("Worker: Processing action", action);

  const validActions = ["run_binary_logistic", "run_vif", "run_box_tidwell"];
  if (!action || !validActions.includes(action)) return;

  // Timing: a fresh Worker is created per click and terminated right after,
  // so this timeline never holds more than one run - mark names don't need
  // a run id to stay unambiguous. Durations are computed with this worker's
  // own performance.now(); only the resulting numbers (never raw timestamps)
  // are sent back to the main thread, whose timeOrigin differs from ours.
  const markStart = `worker:${action}:start`;
  const markInitEnd = `worker:${action}:init-end`;
  performance.mark(markStart);

  try {
    await init();
    performance.mark(markInitEnd);
    const wasmInitMs = performance.measure(
      `Worker Wasm Init — ${action}`,
      markStart,
      markInitEnd
    ).duration;

    // =================================================================
    // 1. DATA PREPARATION
    // =================================================================

    let configObj = config;
    if (typeof config === "string") {
      try {
        configObj = JSON.parse(config);
      } catch (e) {
        throw new Error("Invalid configuration JSON.");
      }
    }

    const getValue = (row, varId) => {
      const colIdx = variableDetails[varId]?.columnIndex;
      if (colIdx === undefined) return undefined;
      return row[colIdx];
    };

    // Filter Missing Values
    const allIds = dependentId
      ? [dependentId, ...independentIds]
      : [...independentIds];

    // Track each kept row's position in the ORIGINAL dataset. Rust only ever
    // sees `cleanData` (no gaps) and numbers cases 1..N within that filtered
    // set, so this array is what lets us translate those numbers back to
    // real dataset rows after listwise deletion drops any cases.
    const keptIndices = [];
    const cleanData = data.filter((row, originalIndex) => {
      const isComplete = allIds.every((id) => {
        const val = getValue(row, id);
        return val !== null && val !== undefined && val !== "";
      });
      if (isComplete) keptIndices.push(originalIndex);
      return isComplete;
    });

    if (cleanData.length === 0) {
      throw new Error("No valid cases remaining after missing value handling.");
    }

    const nIncluded = cleanData.length;
    const nMissing = data.length - nIncluded;

    // --- PROSES X ---
    const { xMatrix, xFeatureNames, categoricalConfigForRust, xEncodings } =
      processCovariates(
        cleanData,
        independentIds,
        variableDetails,
        configObj,
        getValue
      );

    const rows = xMatrix.length;
    const cols = xMatrix[0].length;

    // Flatten X Matrix
    const xFlat = new Float64Array(rows * cols);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        xFlat[i * cols + j] = xMatrix[i][j];
      }
    }

    // =================================================================
    // 2. ACTION HANDLING
    // =================================================================

    switch (action) {
      case "run_binary_logistic": {
        // Persiapan Y
        const rawY = cleanData.map((row) => getValue(row, dependentId));
        const { yVector, yMap } = processDependentVariable(rawY);

        const yFlat = new Float64Array(rows);
        for (let i = 0; i < rows; i++) yFlat[i] = yVector[i];

        // --- UPDATE PENTING DI SINI ---
        // Menambahkan parameter opsi tambahan ke rustConfig
        const rustConfig = {
          dependent_index: 0,
          independent_indices: [],
          categoricalVariables: categoricalConfigForRust,

          // Algoritma Core
          max_iterations: configObj.max_iterations ?? 20,
          convergence_threshold: configObj.convergence_threshold ?? 0.001,
          include_constant: configObj.include_constant !== false,
          // confidence_level: value like 95 or 0.95. Rust handles both.
          confidence_level: configObj.confidence_level ?? 95,
          cutoff: configObj.cutoff ?? 0.5,
          method: configObj.method || "Enter",
          p_entry: configObj.p_entry ?? 0.05,
          p_removal: configObj.p_removal ?? 0.1,

          // Opsi Statistik & Plot (Pastikan diteruskan ke Rust!)
          hosmer_lemeshow: configObj.hosmer_lemeshow || false,
          classification_plots: configObj.classification_plots || false,
          casewise_listing: configObj.casewise_listing || false,
          casewise_type: configObj.casewise_type || "outliers", // BARU: "outliers" atau "all"
          casewise_outliers: configObj.casewise_outliers ?? 2.0,
          iteration_history: configObj.iteration_history || false,
          correlations: configObj.correlations || false,

          // Display options
          display_at_last_step: configObj.display_at_last_step || false,

          // --- BARU: Save Options (Tab Save di UI) ---
          save_predicted_probabilities: configObj.save_predicted_probabilities || false,
          save_predicted_group: configObj.save_predicted_group || false,
          save_residuals_unstandardized: configObj.save_residuals_unstandardized || false,
          save_residuals_logit: configObj.save_residuals_logit || false,
          save_residuals_studentized: configObj.save_residuals_studentized || false,
          save_residuals_standardized: configObj.save_residuals_standardized || false,
          save_residuals_deviance: configObj.save_residuals_deviance || false,
          save_influence_cooks: configObj.save_influence_cooks || false,
          save_influence_leverage: configObj.save_influence_leverage || false,
          save_influence_dfbeta: configObj.save_influence_dfbeta || false,

          assumptions: configObj.assumptions || {},
        };

        const markComputeStart = `worker:${action}:compute-start`;
        const markComputeEnd = `worker:${action}:compute-end`;
        performance.mark(markComputeStart);
        const resultJson = await calculate_binary_logistic(
          xFlat,
          rows,
          cols,
          yFlat,
          JSON.stringify(rustConfig),
          JSON.stringify(xFeatureNames)
        );
        performance.mark(markComputeEnd);
        const computeMs = performance.measure(
          `Worker Compute — ${action}`,
          markComputeStart,
          markComputeEnd
        ).duration;

        let result = resultJson;
        if (typeof result === "string") {
          result = JSON.parse(result);
        }

        if (!result || !result.classification_table) {
          throw new Error("Calculation failed in backend.");
        }

        // Translate Rust's post-listwise-deletion case numbering back to
        // original dataset row positions (see keptIndices above), so the
        // Casewise List table and the Save-tab cell writes both point at
        // the correct rows instead of silently shifting after the first
        // dropped case.
        if (result.saved_predictions?.rows) {
          result.saved_predictions.rows.forEach((row, i) => {
            row.case_index = keptIndices[i];
          });
        }
        if (result.casewise_list) {
          result.casewise_list.forEach((row) => {
            const originalIndex = keptIndices[row.case_number - 1];
            if (originalIndex !== undefined) {
              row.case_number = originalIndex + 1;
            }
          });
        }

        const finalResult = {
          ...result,
          method_used: rustConfig.method,
          model_info: {
            y_encoding: yMap,
            x_encodings: xEncodings,
            n_samples: rows,
            n_missing: nMissing,
            variables: xFeatureNames,
            include_constant: rustConfig.include_constant,
            step_number:
              result.step_history && result.step_history.length > 0
                ? result.step_history[result.step_history.length - 1].step
                : 0,
          },
        };

        self.postMessage({
          type: "SUCCESS",
          payload: finalResult,
          action,
          timing: finishWorkerTiming(action, markStart, wasmInitMs, computeMs),
        });
        break;
      }

      case "run_vif": {
        // Same categorical config as the main regression, so VIF is
        // computed on the actual dummy-coded design matrix (Rust expands
        // it via design_matrix::build) instead of raw ordinal category
        // codes - matches R's car::vif(), which uses Generalized VIF for
        // multi-category (3+ level) predictors.
        //
        // Y is now required too: VIF is computed from the actual fitted
        // logistic model's weighted vcov (X'WX)^-1, W = p̂(1-p̂) - matching
        // car::vif() on a real glm object - not from the plain correlation
        // of X alone (which only matches car::vif() for an lm).
        const rawY = cleanData.map((row) => getValue(row, dependentId));
        const { yVector } = processDependentVariable(rawY);
        const yFlat = new Float64Array(rows);
        for (let i = 0; i < rows; i++) yFlat[i] = yVector[i];

        const vifConfig = {
          feature_names: xFeatureNames,
          categorical_variables: categoricalConfigForRust,
        };
        const markComputeStart = `worker:${action}:compute-start`;
        const markComputeEnd = `worker:${action}:compute-end`;
        performance.mark(markComputeStart);
        let vifResult = await calculate_vif(
          xFlat,
          rows,
          cols,
          yFlat,
          JSON.stringify(vifConfig)
        );
        performance.mark(markComputeEnd);
        const computeMs = performance.measure(
          `Worker Compute — ${action}`,
          markComputeStart,
          markComputeEnd
        ).duration;
        if (typeof vifResult === "string") vifResult = JSON.parse(vifResult);

        const formattedVif = vifResult.map((item, idx) => ({
          ...item,
          variable: xFeatureNames[idx] || item.variable || `Var ${idx + 1}`,
        }));

        const payload = {
          assumption_tests: {
            vif: formattedVif,
          },
        };
        self.postMessage({
          type: "SUCCESS",
          payload: payload,
          action,
          timing: finishWorkerTiming(action, markStart, wasmInitMs, computeMs),
        });
        break;
      }

      case "run_box_tidwell": {
        const rawY = cleanData.map((row) => getValue(row, dependentId));
        const { yVector } = processDependentVariable(rawY);
        const yFlat = new Float64Array(rows);
        for (let i = 0; i < rows; i++) yFlat[i] = yVector[i];

        // Reuse the SAME categorical config already computed above for the
        // main regression (measure = nominal/ordinal, or explicitly added
        // in the Categorical tab). Rust needs the full config, not just
        // the column indices, so it can (1) skip categoricals as ln(X)
        // candidates - a nominal variable with 5+ categories would
        // otherwise slip past a "<=4 unique values" heuristic and get
        // tested as if continuous - and (2) dummy-code them properly when
        // they're used as CONTROL variables in the augmented regression,
        // instead of feeding in raw ordinal integers that would distort
        // the fit for every variable in the model.
        const btConfig = {
          feature_names: xFeatureNames,
          categorical_variables: categoricalConfigForRust,
        };
        const markComputeStart = `worker:${action}:compute-start`;
        const markComputeEnd = `worker:${action}:compute-end`;
        performance.mark(markComputeStart);
        let btResult = await calculate_box_tidwell(
          xFlat,
          rows,
          cols,
          yFlat,
          JSON.stringify(btConfig)
        );
        performance.mark(markComputeEnd);
        const computeMs = performance.measure(
          `Worker Compute — ${action}`,
          markComputeStart,
          markComputeEnd
        ).duration;
        if (typeof btResult === "string") btResult = JSON.parse(btResult);
        self.postMessage({
          type: "SUCCESS",
          payload: btResult,
          action,
          timing: finishWorkerTiming(action, markStart, wasmInitMs, computeMs),
        });
        break;
      }
    }
  } catch (error) {
    console.error("Worker Error:", error);
    self.postMessage({
      type: "ERROR",
      payload: error.message || "An unexpected error occurred in the worker.",
      action,
    });
  }
};

// =================================================================
// HELPER FUNCTIONS
// =================================================================

// Marks the end of this worker's timeline and bundles the durations it
// measured on its own performance.now() into plain numbers, safe to send
// across postMessage to a main thread with a different timeOrigin.
function finishWorkerTiming(action, markStart, wasmInitMs, computeMs) {
  const markEnd = `worker:${action}:end`;
  performance.mark(markEnd);
  const workerTotalMs = performance.measure(
    `Worker Total — ${action}`,
    markStart,
    markEnd
  ).duration;
  return { workerTotalMs, computeMs, wasmInitMs };
}

function processDependentVariable(rawY) {
  const uniqueVals = [...new Set(rawY)].sort();
  if (uniqueVals.length !== 2) {
    throw new Error(
      `Binary Logistic Regression requires exactly 2 levels for Y. Found: ${
        uniqueVals.length
      } (${uniqueVals.join(", ")})`
    );
  }
  const map = { [uniqueVals[0]]: 0.0, [uniqueVals[1]]: 1.0 };
  const yVector = rawY.map((v) => map[v]);
  return { yVector, yMap: map };
}

function processCovariates(data, ids, details, configObj, getValueFn) {
  let xFeatureNames = [];
  let categoricalConfigForRust = [];
  let xEncodings = {};
  // Collects non-numeric values hit by non-categorical columns' encode() so
  // we can raise one descriptive error instead of silently coding them 0.0.
  const invalidValues = [];

  const uiCatSettings = configObj.categoricalVariables || [];
  const getCatSetting = (id) => {
    if (Array.isArray(uiCatSettings)) {
      if (uiCatSettings.length > 0 && typeof uiCatSettings[0] === "string") {
        return uiCatSettings.includes(id)
          ? { method: "Indicator", reference: "Last" }
          : null;
      }
      return uiCatSettings.find((s) => s.id === id) || null;
    }
    return null;
  };

  // 1. Fase Scanning
  const columnProcessors = ids.map((id, idx) => {
    const detail = details[id];
    const isNominalOrOrdinal =
      detail?.measure === "nominal" || detail?.measure === "ordinal";
    const uiSetting = getCatSetting(id);
    const isCategorical = isNominalOrOrdinal || uiSetting !== null;

    const codeMap = new Map();

    if (isCategorical) {
      // Kumpulkan nilai unik
      const uniqueSet = new Set();
      data.forEach((row) => {
        const rawVal = getValueFn(row, id);
        if (rawVal !== null && rawVal !== undefined) {
          uniqueSet.add(rawVal);
        }
      });

      // Sorting
      const sortedValues = Array.from(uniqueSet).sort((a, b) => {
        const numA = Number(a);
        const numB = Number(b);
        if (!isNaN(numA) && !isNaN(numB)) {
          return numA - numB;
        }
        return String(a).localeCompare(String(b));
      });

      // Cek apakah angka
      const isAllNumeric = sortedValues.every(
        (val) => !isNaN(Number(val)) && val !== ""
      );

      // Assign Code
      const varName = detail?.name || `Var_${id}`;
      xEncodings[varName] = {}; // Init map untuk variabel ini

      sortedValues.forEach((val, index) => {
        if (isAllNumeric) {
          // Jika angka, gunakan angka aslinya
          const numVal = Number(val);
          codeMap.set(String(val), numVal);
          // Simpan ke encoding map (Original -> Internal)
          xEncodings[varName][String(val)] = numVal;
        } else {
          // Jika teks, gunakan index (0.0, 1.0, ...)
          const internalVal = index + 0.0;
          codeMap.set(String(val), internalVal);
          // Simpan ke encoding map: "Male" -> 0
          xEncodings[varName][String(val)] = internalVal;
        }
      });
    }

    return {
      id,
      name: detail?.name || `Var_${id}`,
      isCategorical,
      uiSetting,
      codeMap,

      encode: function (val, rowIndex) {
        if (!this.isCategorical) {
          const num = Number(val);
          if (isNaN(num)) {
            invalidValues.push({ name: this.name, value: val, rowIndex });
            return 0.0;
          }
          return num;
        }
        const strVal = String(val);
        return this.codeMap.has(strVal) ? this.codeMap.get(strVal) : 0.0;
      },
    };
  });

  // 2. Build Config
  columnProcessors.forEach((col, idx) => {
    xFeatureNames.push(col.name);
    if (col.isCategorical) {
      const refType = col.uiSetting?.reference || "Last";
      const method = col.uiSetting?.method || "Indicator";
      categoricalConfigForRust.push({
        columnIndex: idx,
        method: method,
        reference: refType === "First" ? "First" : "Last",
      });
    }
  });

  // 3. Generate Matrix
  const xMatrix = data.map((row, rowIndex) => {
    return columnProcessors.map((col) => {
      const rawVal = getValueFn(row, col.id);
      return col.encode(rawVal, rowIndex);
    });
  });

  if (invalidValues.length > 0) {
    const varNames = [...new Set(invalidValues.map((v) => v.name))];
    const sample = invalidValues
      .slice(0, 5)
      .map((v) => `"${v.value}" (row ${v.rowIndex + 1})`)
      .join(", ");
    const remaining = invalidValues.length - 5;
    throw new Error(
      `Variable(s) ${varNames.join(", ")} contain non-numeric value(s) that cannot be used as a scale covariate: ${sample}` +
        (remaining > 0 ? `, and ${remaining} more` : "") +
        `. If this variable is categorical, set its measurement level to Nominal/Ordinal or add it in the Categorical tab.`
    );
  }

  // KEMBALIKAN xEncodings
  return { xMatrix, xFeatureNames, categoricalConfigForRust, xEncodings };
}
