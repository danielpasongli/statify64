// discriminant-analysis-formatter.ts
import { formatDisplayNumber } from "@/hooks/useFormatter";
import {
  compareGroupLabels,
  comparisonDecimals,
  formatCount,
  formatPercent,
  formatSig,
  formatStat,
} from "@/components/Modals/Analyze/Classify/discriminant/services/discriminant-number-format";
import type { ResultJson, Table } from "@/types/Table";
import type { Chart } from "@/types/Chart";

// Actual group the engine gives a case with a missing or out-of-range group code
// (UNGROUPED_LABEL in common.rs), as SPSS prints it in the Casewise Statistics, and
// the name of those cases in the plot legend.
const UNGROUPED_GROUP = "ungrouped";
const UNGROUPED_CASES = "Ungrouped Cases";

// The assumption tables keep the app-wide number style, except in precision mode
// (see discriminant-number-format.ts), where they follow the other tables.
const assumptionStat = (value: number) =>
  comparisonDecimals() ? formatStat(value) : formatDisplayNumber(value);
const assumptionSig = (value: number) =>
  comparisonDecimals() ? formatSig(value) : formatDisplayNumber(value);

export function transformDiscriminantResult(data: any): ResultJson {
  const resultJson: ResultJson = {
    tables: [],
  };

  // 1. Analysis Case Processing Summary
  if (data.processing_summary) {
    const table: Table = {
      key: "processing_summary",
      title: "Analysis Case Processing Summary",
      columnHeaders: [
        { header: "", key: "case_category" },
        { header: "", key: "sub_category" },
        { header: "N", key: "n" },
        { header: "Percent", key: "percent" },
      ],
      rows: [],
    };

    // Valid row
    table.rows.push({
      rowHeader: ["Valid"],
      n: formatCount(data.processing_summary.valid_count),
      percent: formatPercent(data.processing_summary.valid_percent),
    });

    // Excluded rows - only add if defined
    if (data.processing_summary.missing_group_codes !== undefined) {
      table.rows.push({
        rowHeader: ["Excluded", "Missing or out-of-range group codes"],
        n: formatCount(data.processing_summary.missing_group_codes),
        percent: formatPercent(
          data.processing_summary.missing_group_percent,
        ),
      });
    }

    if (data.processing_summary.missing_disc_vars !== undefined) {
      table.rows.push({
        rowHeader: ["", "At least one missing discriminating variable"],
        n: formatCount(data.processing_summary.missing_disc_vars),
        percent: formatPercent(
          data.processing_summary.missing_disc_percent,
        ),
      });
    }

    if (data.processing_summary.both_missing !== undefined) {
      table.rows.push({
        rowHeader: [
          "",
          "Both missing or out-of-range group codes and at least one missing discriminating variable",
        ],
        n: formatCount(data.processing_summary.both_missing),
        percent: formatPercent(
          data.processing_summary.both_missing_percent,
        ),
      });
    }

    // Cases left out by the selection variable: only selected cases enter the
    // analysis, so they are excluded rather than counted as valid. Shown only when
    // a selection variable actually left cases out.
    if ((data.processing_summary.unselected ?? 0) > 0) {
      table.rows.push({
        rowHeader: ["", "Unselected"],
        n: formatCount(data.processing_summary.unselected),
        percent: formatPercent(data.processing_summary.unselected_percent),
      });
    }

    // Total excluded
    table.rows.push({
      rowHeader: ["", "Total"],
      n: formatCount(data.processing_summary.excluded_count),
      percent: formatPercent(
        data.processing_summary.total_excluded_percent,
      ),
    });

    // Grand total
    table.rows.push({
      rowHeader: ["Total"],
      n: formatCount(data.processing_summary.total_count),
      percent: formatPercent(100.0),
    });

    resultJson.tables.push(table);
  }

  // 2. Classification Processing Summary
  if (data.processing_summary) {
    const table: Table = {
      key: "classification_processing_summary",
      title: "Classification Processing Summary",
      columnHeaders: [
        { header: "", key: "category" },
        { header: "", key: "subcategory" },
        { header: "", key: "value" },
      ],
      rows: [],
    };

    // Processed = every case: the selected ones and, with a selection variable, the
    // unselected ones, which are classified as testing cases. Used in Output =
    // Processed − Excluded. With "Replace missing values with mean", cases missing
    // only a predictor are still classified, so Rust reports 0 for that exclusion
    // (classification_missing_disc_vars).
    const ps = data.processing_summary;
    const processed: number = ps.classification_processed ?? ps.total_count;
    const missingGroupExcluded =
      ps.classification_missing_group_codes ??
      (ps.missing_group_codes ?? 0) + (ps.both_missing ?? 0);
    const missingDiscExcluded =
      ps.classification_missing_disc_vars ?? ps.missing_disc_vars ?? 0;

    table.rows.push({
      rowHeader: ["Processed"],
      value: formatCount(processed),
    });

    table.rows.push({
      rowHeader: ["Excluded", "Missing or out-of-range group codes"],
      value: formatCount(missingGroupExcluded),
    });

    table.rows.push({
      rowHeader: ["", "At least one missing discriminating variable"],
      value: formatCount(missingDiscExcluded),
    });

    table.rows.push({
      rowHeader: ["Used in Output"],
      value: formatCount(
        ps.classification_used_count ??
          processed - missingGroupExcluded - missingDiscExcluded,
      ),
    });

    resultJson.tables.push(table);
  }

  // 3. Group Statistics
  if (data.group_statistics) {
    const gs = data.group_statistics;
    // Mean and Std. Deviation come only with Statistics → Means (SPSS /STATISTICS=
    // MEAN STDDEV). Without it the engine sends no values, and the table keeps just
    // the Valid N counts instead of printing zeros.
    const hasMeans = Array.isArray(gs.means) && gs.means.length > 0;
    const entryOf = (list: any[] | undefined, variable: string) =>
      list?.find((entry: any) => entry.variable === variable);

    const table: Table = {
      key: "group_statistics",
      title: "Group Statistics",
      columnHeaders: [
        { header: "category", key: "category" },
        { header: "", key: "var" },
        ...(hasMeans
          ? [
              { header: "Mean", key: "mean" },
              { header: "Std. Deviation", key: "std_deviation" },
            ]
          : []),
        {
          header: "Valid N (listwise)",
          key: "valid_n",
          children: [
            { header: "Unweighted", key: "unweighted" },
            { header: "Weighted", key: "weighted" },
          ],
        },
      ],
      rows: [],
    };

    // One row per group (Total first) and variable.
    gs.groups.forEach((group: string, groupIndex: number) => {
      gs.variables.forEach((variableName: string) => {
        const unweightedNEntry = entryOf(gs.unweighted_n, variableName);
        const weightedNEntry = entryOf(gs.weighted_n, variableName);

        table.rows.push({
          rowHeader: [group, variableName],
          ...(hasMeans
            ? {
                mean: formatStat(entryOf(gs.means, variableName)?.values[groupIndex]),
                std_deviation: formatStat(
                  entryOf(gs.std_deviations, variableName)?.values[groupIndex],
                ),
              }
            : {}),
          unweighted: unweightedNEntry
            ? formatCount(unweightedNEntry.values[groupIndex])
            : "Invalid",
          weighted: weightedNEntry
            ? formatStat(weightedNEntry.values[groupIndex])
            : "Invalid",
        });
      });
    });

    resultJson.tables.push(table);
  }

  // 4. Tests of Equality of Group Means
  if (data.equality_tests) {
    const table: Table = {
      key: "equality_tests",
      title: "Tests of Equality of Group Means",
      columnHeaders: [
        { header: "", key: "var" },
        { header: "Wilks' Lambda", key: "wilks_lambda" },
        { header: "F", key: "f" },
        { header: "df1", key: "df1" },
        { header: "df2", key: "df2" },
        { header: "Sig.", key: "sig" },
      ],
      rows: [],
    };

    // Iterate through variables
    for (let i = 0; i < data.equality_tests.variables.length; i++) {
      table.rows.push({
        rowHeader: [data.equality_tests.variables[i]],
        wilks_lambda: formatStat(data.equality_tests.wilks_lambda[i]),
        f: formatStat(data.equality_tests.f_values[i]),
        df1: formatCount(data.equality_tests.df1[i]),
        df2: formatCount(data.equality_tests.df2[i]),
        sig: formatSig(data.equality_tests.significance[i]),
      });
    }

    resultJson.tables.push(table);
  }

  // 5a. Pooled Within-Groups Covariance Matrix
  if (data.pooled_matrices) {
    const table: Table = {
      key: "pooled_covariance_matrix",
      title: "Pooled Within-Groups Covariance Matrix",
      columnHeaders: [
        { header: "", key: "var" },
        ...data.pooled_matrices.variables.map(
          (variable: string, index: number) => ({
            header: variable,
            key: `var_${index}`,
          }),
        ),
      ],
      rows: [],
    };

    for (let i = 0; i < data.pooled_matrices.variables.length; i++) {
      const entry = data.pooled_matrices.covariance[i];
      const rowData: any = {
        rowHeader: [entry.variable],
      };

      for (let j = 0; j < entry.values.length; j++) {
        rowData[`var_${j}`] = formatStat(entry.values[j].value);
      }

      table.rows.push(rowData);
    }

    resultJson.tables.push(table);
  }

  // 5b. Pooled Within-Groups Correlation Matrix
  if (data.pooled_matrices) {
    const table: Table = {
      key: "pooled_correlation_matrix",
      title: "Pooled Within-Groups Correlation Matrix",
      columnHeaders: [
        { header: "", key: "var" },
        ...data.pooled_matrices.variables.map(
          (variable: string, index: number) => ({
            header: variable,
            key: `var_${index}`,
          }),
        ),
      ],
      rows: [],
    };

    for (let i = 0; i < data.pooled_matrices.variables.length; i++) {
      const entry = data.pooled_matrices.correlation[i];
      const rowData: any = {
        rowHeader: [entry.variable],
      };

      for (let j = 0; j < entry.values.length; j++) {
        rowData[`var_${j}`] = formatStat(entry.values[j].value);
      }

      table.rows.push(rowData);
    }

    resultJson.tables.push(table);
  }

  // 6. Covariance Matrices
  if (data.covariance_matrices) {
    const table: Table = {
      key: "covariance_matrices",
      title: "Covariance Matrices",
      columnHeaders: [
        { header: "category", key: "category" },
        { header: "", key: "var" },
        ...data.covariance_matrices.variables.map(
          (variable: string, index: number) => ({
            header: variable,
            key: `var_${index}`,
          }),
        ),
      ],
      rows: [],
    };

    // Iterate through groups and their matrices
    for (let g = 0; g < data.covariance_matrices.matrices.length; g++) {
      const groupEntry = data.covariance_matrices.matrices[g];

      // For each variable in the group's matrix
      for (let v = 0; v < groupEntry.matrix.length; v++) {
        const entry = groupEntry.matrix[v];

        const rowData: any = {
          rowHeader: [groupEntry.group, entry.variable],
        };

        // For each value in the variable's row
        for (let i = 0; i < entry.values.length; i++) {
          rowData[`var_${i}`] = formatStat(entry.values[i].value);
        }

        table.rows.push(rowData);
      }
    }

    // Add footnote based on actual degrees of freedom (from Rust note_df)
    table.rows.push({
      rowHeader: [
        data.covariance_matrices.note_df ??
          "a. The total covariance matrix has N-1 degrees of freedom.",
      ],
    });

    resultJson.tables.push(table);
  }

  // 7. Log Determinants
  if (data.log_determinants) {
    const table: Table = {
      key: "log_determinants",
      title: "Log Determinants",
      columnHeaders: [
        { header: "category", key: "category" },
        { header: "Rank", key: "rank" },
        { header: "Log Determinant", key: "log_determinant" },
      ],
      rows: [],
    };

    // Group log determinants
    for (let i = 0; i < data.log_determinants.groups.length; i++) {
      table.rows.push({
        rowHeader: [data.log_determinants.groups[i]],
        rank: formatCount(data.log_determinants.ranks[i]),
        log_determinant: formatStat(
          data.log_determinants.log_determinants[i],
        ),
      });
    }

    // Pooled within-groups
    table.rows.push({
      rowHeader: ["Pooled within-groups"],
      rank: formatCount(data.log_determinants.rank_pooled),
      log_determinant: formatStat(
        data.log_determinants.pooled_log_determinant,
      ),
    });

    // Add footnote
    table.rows.push({
      rowHeader: [
        "The ranks and natural logarithms of determinants printed are those of the group covariance matrices.",
      ],
    });

    resultJson.tables.push(table);
  }

  // 8. Box's M Test Results
  if (data.box_m_test) {
    const table: Table = {
      key: "box_m_test",
      title: "Test Results",
      columnHeaders: [
        { header: "", key: "test" },
        { header: "" },
        { header: "", key: "value" },
      ],
      rows: [
        {
          rowHeader: ["Box's M"],
          value: formatStat(data.box_m_test.box_m),
        },
        {
          rowHeader: ["F", "Approx."],
          value: formatStat(data.box_m_test.f_approx),
        },
        {
          rowHeader: ["", "df1"],
          value: formatCount(data.box_m_test.df1),
        },
        {
          rowHeader: ["", "df2"],
          value: formatCount(data.box_m_test.df2),
        },
        {
          rowHeader: ["", "Sig."],
          value: formatSig(data.box_m_test.p_value),
        },
        {
          rowHeader: [
            "Tests null hypothesis of equal population covariance matrices.",
          ],
        },
      ],
    };

    // Interpretation (homogeneity-of-covariance assumption), surfaced as the
    // section Description by store.ts.
    const boxMp = data.box_m_test.p_value;
    (table as Table & { footer?: string }).footer =
      typeof boxMp === "number" && boxMp < 0.05
        ? "Not met: Box's M is significant (p < 0.05), so the group covariance matrices are not equal. Consider separate-covariance (quadratic) classification."
        : "Met: Box's M is not significant (p ≥ 0.05), so equal group covariance matrices can be assumed.";

    resultJson.tables.push(table);
  }

  // 9. Prior Probabilities for Groups
  if (data.prior_probabilities) {
    const table: Table = {
      key: "prior_probabilities",
      title: "Prior Probabilities for Groups",
      columnHeaders: [
        { header: "Group", key: "group" },
        { header: "Prior", key: "prior" },
        {
          header: "Cases Used in Analysis",
          key: "cases_used",
          children: [
            { header: "Unweighted", key: "unweighted" },
            { header: "Weighted", key: "weighted" },
          ],
        },
      ],
      rows: [],
    };

    // Group prior probabilities
    for (let i = 0; i < data.prior_probabilities.groups.length; i++) {
      const unweightedData = data.prior_probabilities.cases_used.find(
        (c: any) => c.case_type === "Unweighted",
      );

      const weightedData = data.prior_probabilities.cases_used.find(
        (c: any) => c.case_type === "Weighted",
      );

      const unweightedCount = unweightedData ? unweightedData.counts[i] : 0;
      const weightedCount = weightedData ? weightedData.counts[i] : 0;

      table.rows.push({
        rowHeader: [data.prior_probabilities.groups[i].toString()],
        prior: formatStat(
          data.prior_probabilities.prior_probabilities[i],
        ),
        unweighted: formatCount(unweightedCount),
        weighted: formatStat(weightedCount),
      });
    }

    // Total row
    const totalUnweighted =
      data.prior_probabilities.cases_used
        .find((c: any) => c.case_type === "Unweighted")
        ?.counts.reduce((sum: number, val: number) => sum + val, 0) || 0;

    const totalWeighted =
      data.prior_probabilities.cases_used
        .find((c: any) => c.case_type === "Weighted")
        ?.counts.reduce((sum: number, val: number) => sum + val, 0) || 0;

    table.rows.push({
      rowHeader: ["Total"],
      // Priors always sum to 1; the count columns sum to the total N.
      prior: formatStat(
        data.prior_probabilities.prior_probabilities.reduce(
          (sum: number, val: number) => sum + val,
          0,
        ),
      ),
      unweighted: formatCount(totalUnweighted),
      weighted: formatStat(totalWeighted),
    });

    resultJson.tables.push(table);
  }

  // 10. Classification Function Coefficients
  if (data.classification_function_coefficients) {
    const table: Table = {
      key: "classification_function_coefficients",
      title: "Classification Function Coefficients",
      columnHeaders: [
        { header: "", key: "var" },
        ...data.classification_function_coefficients.groups.map(
          (group: number) => ({
            header: group.toString(),
            key: `group_${group}`,
          }),
        ),
      ],
      rows: [],
    };

    // Variable coefficients
    for (
      let v = 0;
      v < data.classification_function_coefficients.variables.length;
      v++
    ) {
      const variable = data.classification_function_coefficients.variables[v];
      const rowData: any = {
        rowHeader: [variable],
      };

      const coeff = data.classification_function_coefficients.coefficients.find(
        (c: any) => c.variable === variable,
      );

      if (coeff) {
        for (
          let g = 0;
          g < data.classification_function_coefficients.groups.length;
          g++
        ) {
          const group = data.classification_function_coefficients.groups[g];
          rowData[`group_${group}`] = formatStat(coeff.values[g]);
        }
      }

      table.rows.push(rowData);
    }

    // Constant terms
    const constantRow: any = {
      rowHeader: ["(Constant)"],
    };

    for (
      let g = 0;
      g < data.classification_function_coefficients.groups.length;
      g++
    ) {
      const group = data.classification_function_coefficients.groups[g];
      constantRow[`group_${group}`] = formatStat(
        data.classification_function_coefficients.constant_terms[g],
      );
    }

    table.rows.push(constantRow);

    // Add footnote
    table.rows.push({
      rowHeader: ["Fisher's linear discriminant functions"],
    });

    resultJson.tables.push(table);
  }

  // 11. Canonical Discriminant Function Coefficients
  // Shown only for Statistics → Function Coefficients → Unstandardized, as in SPSS.
  // The coefficients themselves stay in the payload: Save and the XML export use them.
  if (
    data.unstandardized_coefficients === true &&
    data.canonical_functions?.coefficients
  ) {
    // Get the number of functions from the first coefficient's values length
    const numFunctions =
      data.canonical_functions.coefficients.length > 0
        ? data.canonical_functions.coefficients[0].values.length
        : 0;

    if (numFunctions > 0) {
      // Create column headers dynamically based on number of functions
      const functionChildren = [];
      for (let i = 1; i <= numFunctions; i++) {
        functionChildren.push({
          header: i.toString(),
          key: `function_${i}`,
        });
      }

      const table: Table = {
        key: "canonical_discriminant_function_coefficients",
        title: "Canonical Discriminant Function Coefficients",
        columnHeaders: [
          { header: "", key: "var" },
          {
            header: "Function",
            key: "function",
            children: functionChildren,
          },
        ],
        rows: [],
      };

      // Variable coefficients
      for (let i = 0; i < data.canonical_functions.coefficients.length; i++) {
        const coeff = data.canonical_functions.coefficients[i];
        const rowData: any = {
          rowHeader: [coeff.variable],
        };

        // Add each function value dynamically
        for (let j = 0; j < numFunctions; j++) {
          rowData[`function_${j + 1}`] = formatStat(coeff.values[j]);
        }

        table.rows.push(rowData);
      }

      // Add footnote
      table.rows.push({
        rowHeader: ["Unstandardized coefficients"],
      });

      resultJson.tables.push(table);
    }
  }

  // 12. Standardized Canonical Discriminant Function Coefficients
  if (
    data.canonical_functions?.standardized_coefficients &&
    data.canonical_functions.standardized_coefficients.length > 0
  ) {
    // Get the number of functions from the first coefficient's values length
    const numFunctions =
      data.canonical_functions.standardized_coefficients[0].values.length;

    // Create column headers dynamically based on number of functions
    const functionChildren = [];
    for (let i = 1; i <= numFunctions; i++) {
      functionChildren.push({
        header: i.toString(),
        key: `function_${i}`,
      });
    }

    const table: Table = {
      key: "standardized_coefficients",
      title: "Standardized Canonical Discriminant Function Coefficients",
      columnHeaders: [
        { header: "", key: "var" },
        {
          header: "Function",
          key: "function",
          children: functionChildren,
        },
      ],
      rows: [],
    };

    // Iterate through variables and their coefficients
    for (
      let i = 0;
      i < data.canonical_functions.standardized_coefficients.length;
      i++
    ) {
      const coeff = data.canonical_functions.standardized_coefficients[i];
      const rowData: any = {
        rowHeader: [coeff.variable],
      };

      // Add each function value dynamically
      for (let j = 0; j < numFunctions; j++) {
        rowData[`function_${j + 1}`] = formatStat(coeff.values[j]);
      }

      table.rows.push(rowData);
    }

    resultJson.tables.push(table);
  }

  // 13. Functions at Group Centroids
  if (
    data.canonical_functions?.function_at_centroids &&
    data.canonical_functions.function_at_centroids.length > 0
  ) {
    // Get the number of functions from the first centroid's values length
    const numFunctions =
      data.canonical_functions.function_at_centroids[0].values.length;

    // Create column headers dynamically based on number of functions
    const functionChildren = [];
    for (let i = 1; i <= numFunctions; i++) {
      functionChildren.push({
        header: i.toString(),
        key: `function_${i}`,
      });
    }

    const table: Table = {
      key: "functions_at_group_centroids",
      title: "Functions at Group Centroids",
      columnHeaders: [
        { header: "Group", key: "group" },
        {
          header: "Function",
          key: "function",
          children: functionChildren,
        },
      ],
      rows: [],
    };

    // Group centroids
    for (
      let i = 0;
      i < data.canonical_functions.function_at_centroids.length;
      i++
    ) {
      const centroid = data.canonical_functions.function_at_centroids[i];
      const rowData: any = {
        rowHeader: [centroid.group],
      };

      // Add each function value dynamically
      for (let j = 0; j < numFunctions; j++) {
        rowData[`function_${j + 1}`] = formatStat(centroid.values[j]);
      }

      table.rows.push(rowData);
    }

    // Add footnote
    table.rows.push({
      rowHeader: [
        "Unstandardized canonical discriminant functions evaluated at group means",
      ],
    });

    resultJson.tables.push(table);
  }

  // 14. Structure Matrix
  // converter.rs transforms HashMap to Vec<FunctionValue> where each entry has .variable and .values
  if (
    data.structure_matrix?.correlations &&
    data.structure_matrix.correlations.length > 0
  ) {
    const numFunctions = data.structure_matrix.correlations[0].values.length;

    const functionChildren = [];
    for (let i = 1; i <= numFunctions; i++) {
      functionChildren.push({
        header: i.toString(),
        key: `function_${i}`,
      });
    }

    const table: Table = {
      key: "structure_matrix",
      title: "Structure Matrix",
      columnHeaders: [
        { header: "", key: "var" },
        {
          header: "Function",
          key: "function",
          children: functionChildren,
        },
      ],
      rows: [],
    };

    // Iterate through variables (correlations is array of {variable, values})
    for (let i = 0; i < data.structure_matrix.correlations.length; i++) {
      const corr = data.structure_matrix.correlations[i];
      const rowData: any = {
        rowHeader: [corr.variable],
      };

      // Find the largest absolute correlation value for this variable
      let maxAbsValueIndex = 0;
      let maxAbsValue = Math.abs(corr.values[0]);

      for (let j = 1; j < numFunctions; j++) {
        if (Math.abs(corr.values[j]) > maxAbsValue) {
          maxAbsValue = Math.abs(corr.values[j]);
          maxAbsValueIndex = j;
        }
      }

      // Add each function value dynamically, marking the largest with superscript
      for (let j = 0; j < numFunctions; j++) {
        rowData[`function_${j + 1}`] =
          formatStat(corr.values[j]) +
          (j === maxAbsValueIndex ? "ᵃ" : "");
      }

      table.rows.push(rowData);
    }

    // Add footnotes
    table.rows.push({
      rowHeader: [
        "Pooled within-groups correlations between discriminating variables and standardized canonical discriminant functions",
      ],
    });
    table.rows.push({
      rowHeader: [
        "Variables ordered by absolute size of correlation within function.",
      ],
    });
    table.rows.push({
      rowHeader: [
        "a. Largest absolute correlation between each variable and any discriminant function",
      ],
    });

    resultJson.tables.push(table);
  }

  // ==========================================
  // ROBUST METHOD DETECTION
  // ==========================================
  let isMahalanobis = false;
  let isRaosVMethod = false;
  // Detected via the explicit method field emitted by Rust.
  const isFRatio = data.stepwise_statistics?.method === "f_ratio";
  const isUnexplained = data.stepwise_statistics?.method === "unexplained";

  if (data.stepwise_statistics) {
    // 1. Rao's V — detected via the explicit method field from Rust
    isRaosVMethod = data.stepwise_statistics.method === "raos_v";

    // 2. Mahalanobis — some step has min_d_squared > 0, and the method is not Rao's V /
    //    F-ratio / Unexplained
    if (!isRaosVMethod && !isFRatio && !isUnexplained) {
      const notInAnalysis = data.stepwise_statistics.variables_not_in_analysis;
      if (Array.isArray(notInAnalysis) && notInAnalysis.length > 0) {
        isMahalanobis = notInAnalysis.some(
          (step: any) =>
            Array.isArray(step.variables) &&
            step.variables.some(
              (v: any) => v.min_d_squared !== undefined && v.min_d_squared > 0,
            ),
        );
      }
    }
  }

  // Rao's V recovered from the proxy stored in the wilks_lambda field by Rust:
  // proxy = 1 / (1 + V/n)  ⇒  V = n · (1/proxy − 1)
  const _raosN = data.processing_summary?.valid_count ?? 1;
  const raosVFromProxy = (proxy: number) =>
    proxy > 0 && proxy < 1 ? _raosN * (1 / proxy - 1) : 0;

  // 15. Stepwise Statistics
  if (data.stepwise_statistics?.variables_entered) {
    // Rao's F (the F of Wilks' Lambda) is exact only while min(variables, groups − 1)
    // ≤ 2. An approximate step goes under its own "Approximate F" block, with a
    // fractional df2, so that block is added once any step needs it.
    const wilksFExact: boolean[] = Array.isArray(
      data.stepwise_statistics.wilks_f_exact,
    )
      ? data.stepwise_statistics.wilks_f_exact
      : [];
    const hasApproxF = wilksFExact.some((exact) => exact === false);

    // Rao's F cells of step i, filled under the exact or the approximate keys.
    const raoFCells = (
      i: number,
      exactKeys: string[],
      approxKeys: string[],
    ): Record<string, string> => {
      const values = [
        formatStat(data.stepwise_statistics.wilks_exact_f?.[i] ?? 0),
        formatCount(data.stepwise_statistics.wilks_exact_df1?.[i] ?? 0),
        formatCount(data.stepwise_statistics.wilks_exact_df2?.[i] ?? 0),
        formatSig(data.stepwise_statistics.wilks_exact_sig?.[i] ?? 1),
      ];
      const isExact = wilksFExact[i] !== false;
      const cells: Record<string, string> = {};
      exactKeys.forEach((key, k) => (cells[key] = isExact ? values[k] : ""));
      if (hasApproxF) {
        approxKeys.forEach((key, k) => (cells[key] = isExact ? "" : values[k]));
      }
      return cells;
    };

    const columnHeaders = isRaosVMethod
      ? [
          { header: "", key: "step_header" },
          { header: "Step", key: "step" },
          { header: "Entered", key: "entered" },
          {
            header: "Rao's V",
            key: "raos_v",
            children: [
              { header: "Statistic", key: "raos_v_statistic" },
              { header: "df", key: "raos_v_df" },
              { header: "Approx. Sig.", key: "raos_v_sig" },
            ],
          },
          {
            header: "Change in V",
            key: "change_in_v",
            children: [
              { header: "Statistic", key: "change_statistic" },
              { header: "Sig.", key: "change_sig" },
            ],
          },
        ]
      : isFRatio
        ? [
            { header: "", key: "step_header" },
            { header: "Step", key: "step" },
            { header: "Entered", key: "entered" },
            { header: "Removed", key: "removed" },
            {
              header: "Min. F",
              key: "min_f",
              children: [
                { header: "Statistic", key: "f_statistic" },
                { header: "df1", key: "f_df1" },
                { header: "df2", key: "f_df2" },
                { header: "Sig.", key: "sig" },
                { header: "Between Groups", key: "between_groups" },
              ],
            },
          ]
      : isUnexplained
        ? [
            { header: "", key: "step_header" },
            { header: "Step", key: "step" },
            { header: "Entered", key: "entered" },
            { header: "Removed", key: "removed" },
            { header: "Residual Variance", key: "residual_variance" },
          ]
      : isMahalanobis
        ? [
            { header: "", key: "step_header" },
            { header: "Step", key: "step" },
            { header: "Entered", key: "entered" },
            { header: "Removed", key: "removed" },
            {
              header: "Min. D Squared",
              key: "min_d_squared",
              children: [
                { header: "Statistic", key: "d_statistic" },
                { header: "Between Groups", key: "between_groups" },
              ],
            },
            {
              header: "Exact F",
              key: "exact_f",
              children: [
                { header: "Statistic", key: "f_statistic" },
                { header: "df1", key: "f_df1" },
                { header: "df2", key: "f_df2" },
                { header: "Sig.", key: "sig" },
              ],
            },
          ]
        : [
            { header: "", key: "step_header" },
            { header: "Step", key: "step" },
            { header: "Entered", key: "entered" },
            { header: "Removed", key: "removed" },
            {
              header: "Wilks' Lambda",
              key: "wilks_lambda",
              children: [
                { header: "Statistic", key: "lambda_statistic" },
                { header: "df1", key: "lambda_df1" },
                { header: "df2", key: "lambda_df2" },
                { header: "df3", key: "lambda_df3" },
              ],
            },
            {
              header: "Exact F",
              key: "exact_f",
              children: [
                { header: "Statistic", key: "exact_f_statistic" },
                { header: "df1", key: "exact_f_df1" },
                { header: "df2", key: "exact_f_df2" },
                { header: "Sig.", key: "exact_f_sig" },
              ],
            },
            ...(hasApproxF
              ? [
                  {
                    header: "Approximate F",
                    key: "approx_f",
                    children: [
                      { header: "Statistic", key: "approx_f_statistic" },
                      { header: "df1", key: "approx_f_df1" },
                      { header: "df2", key: "approx_f_df2" },
                      { header: "Sig.", key: "approx_f_sig" },
                    ],
                  },
                ]
              : []),
          ];

    const table: Table = {
      key: "stepwise_statistics",
      title: "Variables Entered/Removed",
      columnHeaders,
      rows: [],
    };

    const stepsCount = data.stepwise_statistics.variables_entered.length;
    // Use num_groups from Rust output (authoritative k from dataset.num_groups)
    const numGroups = data.stepwise_statistics.num_groups ?? data.group_statistics?.groups?.length ?? 3;
    const raosVdf = numGroups - 1;
    const wilksN = data.processing_summary?.valid_count ?? 0;

    let wilksNumVars = 0;
    for (let i = 0; i < stepsCount; i++) {
      const stepNum = i + 1;

      if (isRaosVMethod) {
        table.rows.push({
          rowHeader: [""],
          step: formatCount(stepNum),
          entered: data.stepwise_statistics.variables_entered[i] || "",
          raos_v_statistic: formatStat(
            data.stepwise_statistics.raos_v?.[i] ?? 0,
          ),
          // df = variables in the model × (k − 1), from Rust (differs from
          // step × (k − 1) after a removal step).
          raos_v_df: formatCount(
            data.stepwise_statistics.raos_v_df?.[i] ?? raosVdf * stepNum,
          ),
          raos_v_sig: formatSig(
            data.stepwise_statistics.raos_v_sig?.[i] ?? 1,
          ),
          change_statistic: formatStat(
            data.stepwise_statistics.change_in_v?.[i] ?? 0,
          ),
          change_sig: formatSig(
            data.stepwise_statistics.change_sig?.[i] ?? 1,
          ),
        });
      } else if (isFRatio) {
        table.rows.push({
          rowHeader: [""],
          step: formatCount(stepNum),
          entered: data.stepwise_statistics.variables_entered[i] || "",
          removed: data.stepwise_statistics.variables_removed[i]
            ? data.stepwise_statistics.variables_removed[i]
            : "",
          f_statistic: formatStat(
            data.stepwise_statistics.min_d_squared?.[i] ?? 0,
          ),
          f_df1: formatCount(
            data.stepwise_statistics.f_to_enter_df1?.[i] ?? 0,
          ),
          f_df2: formatCount(
            data.stepwise_statistics.f_to_enter_df2?.[i] ?? 0,
          ),
          sig: formatSig(
            data.stepwise_statistics.significance?.[i] ?? 1,
          ),
          between_groups: data.stepwise_statistics.between_groups?.[i] ?? "",
        });
      } else if (isUnexplained) {
        table.rows.push({
          rowHeader: [""],
          step: formatCount(stepNum),
          entered: data.stepwise_statistics.variables_entered[i] || "",
          removed: data.stepwise_statistics.variables_removed[i]
            ? data.stepwise_statistics.variables_removed[i]
            : "",
          residual_variance: formatStat(
            data.stepwise_statistics.min_d_squared?.[i] ?? 0,
          ),
        });
      } else if (isMahalanobis) {
        table.rows.push({
          rowHeader: [""],
          step: formatCount(stepNum),
          entered: data.stepwise_statistics.variables_entered[i] || "",
          removed: data.stepwise_statistics.variables_removed[i]
            ? data.stepwise_statistics.variables_removed[i]
            : "",
          d_statistic: formatStat(
            data.stepwise_statistics.min_d_squared?.[i] ?? 0,
          ),
          between_groups: data.stepwise_statistics.between_groups?.[i] ?? "",
          f_statistic: formatStat(
            data.stepwise_statistics.f_to_enter?.[i] ?? 0,
          ),
          f_df1: formatCount(
            data.stepwise_statistics.f_to_enter_df1?.[i] ?? 0,
          ),
          f_df2: formatCount(
            data.stepwise_statistics.f_to_enter_df2?.[i] ?? 0,
          ),
          sig: formatSig(
            data.stepwise_statistics.significance?.[i] ?? 1,
          ),
        });
      } else {
        if (data.stepwise_statistics.variables_entered[i]) wilksNumVars++;
        if (data.stepwise_statistics.variables_removed?.[i]) wilksNumVars--;
        table.rows.push({
          rowHeader: [""],
          step: formatCount(stepNum),
          entered: data.stepwise_statistics.variables_entered[i] || "",
          removed: data.stepwise_statistics.variables_removed[i]
            ? data.stepwise_statistics.variables_removed[i]
            : "",
          lambda_statistic: formatStat(
            data.stepwise_statistics.wilks_lambda?.[i] ?? 1,
          ),
          lambda_df1: formatCount(wilksNumVars),
          lambda_df2: formatCount(numGroups - 1),
          lambda_df3: formatCount(wilksN - numGroups),
          ...raoFCells(
            i,
            ["exact_f_statistic", "exact_f_df1", "exact_f_df2", "exact_f_sig"],
            ["approx_f_statistic", "approx_f_df1", "approx_f_df2", "approx_f_sig"],
          ),
        });
      }
    }

    const methodDescription = isRaosVMethod
      ? "At each step, the variable that produces the largest increase in Rao's V is entered."
      : isFRatio
        ? "At each step, the variable that maximizes the smallest F ratio between pairs of groups is entered."
        : isUnexplained
          ? "At each step, the variable that minimizes the sum of the unexplained variation for all pairs of groups is entered."
          : isMahalanobis
            ? "At each step, the variable that maximizes the Mahalanobis distance between the two closest groups is entered."
            : "At each step, the variable that minimizes the overall Wilks' Lambda is entered.";
    table.rows.push({ rowHeader: [methodDescription] });

    // Footnotes come from Rust (create_stepwise_note), which builds them from the
    // thresholds the procedure actually applied: max steps = 2 × predictors, the
    // user's F / probability criteria, and V-to-enter for Rao's V (empty otherwise).
    const swNote = data.stepwise_statistics.note;
    for (const text of [
      swNote?.max_steps,
      swNote?.min_f_to_enter,
      swNote?.max_f_to_remove,
      swNote?.min_v_to_enter,
      swNote?.note,
    ]) {
      if (typeof text === "string" && text.length > 0) {
        table.rows.push({ rowHeader: [text] });
      }
    }

    resultJson.tables.push(table);

    // Stepwise Wilks' Lambda — per-step model table (SPSS "Wilks' Lambda" in stepwise output).
    // Placed inside the same `if` block so it always renders when the stepwise table renders.
    {
      const swTable: Table = {
        key: "stepwise_wilks_lambda",
        title: "Wilks' Lambda",
        columnHeaders: [
          { header: "Step", key: "sw_step" },
          { header: "Number of Variables", key: "num_vars" },
          {
            header: "Lambda",
            key: "lambda_group",
            children: [
              { header: "Statistic", key: "lambda" },
              { header: "df1", key: "lambda_df1" },
              { header: "df2", key: "lambda_df2" },
              { header: "df3", key: "lambda_df3" },
            ],
          },
          {
            header: "Exact F",
            key: "exact_f_group",
            children: [
              { header: "Statistic", key: "f_stat" },
              { header: "df1", key: "f_df1" },
              { header: "df2", key: "f_df2" },
              { header: "Sig.", key: "f_sig" },
            ],
          },
          ...(hasApproxF
            ? [
                {
                  header: "Approximate F",
                  key: "approx_f_group",
                  children: [
                    { header: "Statistic", key: "approx_f_stat" },
                    { header: "df1", key: "approx_f_df1" },
                    { header: "df2", key: "approx_f_df2" },
                    { header: "Sig.", key: "approx_f_sig" },
                  ],
                },
              ]
            : []),
        ],
        rows: [],
      };

      const swEntries: string[] = Array.isArray(
        data.stepwise_statistics.variables_entered,
      )
        ? data.stepwise_statistics.variables_entered
        : [];
      const swStepsCount = swEntries.length;

      const swNumGroups: number =
        data.stepwise_statistics.num_groups ??
        data.group_statistics?.groups?.length ??
        3;
      const swN: number = data.processing_summary?.valid_count ?? 0;
      const lambdaDf2 = swNumGroups - 1;
      const lambdaDf3 = swN - swNumGroups;

      const swWilks: number[] = Array.isArray(
        data.stepwise_statistics.wilks_lambda,
      )
        ? data.stepwise_statistics.wilks_lambda
        : [];
      const swRemoved: any[] = Array.isArray(
        data.stepwise_statistics.variables_removed,
      )
        ? data.stepwise_statistics.variables_removed
        : [];

      let numVarsInModel = 0;
      for (let i = 0; i < swStepsCount; i++) {
        if (swEntries[i]) numVarsInModel++;
        if (swRemoved[i]) numVarsInModel--;

        swTable.rows.push({
          rowHeader: [String(i + 1)],
          sw_step: String(i + 1),
          num_vars: formatCount(numVarsInModel),
          lambda: formatStat(swWilks[i] ?? 1),
          lambda_df1: formatCount(numVarsInModel),
          lambda_df2: formatCount(lambdaDf2),
          lambda_df3: formatCount(lambdaDf3),
          // The model's Wilks F (Rao's F), correct for every method — NOT
          // f_to_enter, which holds the method-specific statistic (Min F /
          // closest-pair F) for Smallest-F and Mahalanobis.
          ...raoFCells(
            i,
            ["f_stat", "f_df1", "f_df2", "f_sig"],
            ["approx_f_stat", "approx_f_df1", "approx_f_df2", "approx_f_sig"],
          ),
        });
      }

      if (swTable.rows.length > 0) {
        resultJson.tables.push(swTable);
      }
    }

    // Pairwise Group Comparisons (Method → Display → F for pairwise distances).
    // Rust sends one entry per (step, group) with that group's F and Sig. against
    // every other group, already ordered by step then group. SPSS lays it out as a
    // Step × Group matrix with an F row and a Sig. row per group; the diagonal is
    // blank, and a footnote per step gives the F degrees of freedom.
    const pairwiseEntries: Array<{
      step: string;
      group: string;
      comparisons: Array<{
        group_name: string;
        f_value: number;
        significance: number;
        df1: number;
        df2: number;
      }>;
    }> = Array.isArray(data.stepwise_statistics.pairwise_comparisons)
      ? data.stepwise_statistics.pairwise_comparisons
      : [];

    if (pairwiseEntries.length > 0) {
      const pairGroups = [
        ...new Set(
          pairwiseEntries.flatMap((e) => [
            e.group,
            ...e.comparisons.map((c) => c.group_name),
          ]),
        ),
      ].sort(compareGroupLabels);
      const pairSteps = [...new Set(pairwiseEntries.map((e) => e.step))];
      const stepMarks = "ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻ";

      const pairTable: Table = {
        key: "pairwise_group_comparisons",
        title: "Pairwise Group Comparisons",
        columnHeaders: [
          { header: "Step", key: "step" },
          { header: "Group", key: "group" },
          { header: "", key: "stat" },
          ...pairGroups.map((g, i) => ({ header: g, key: `pair_g_${i}` })),
        ],
        rows: [],
      };

      const pairFootnotes: string[] = [];
      pairSteps.forEach((step, stepIdx) => {
        const stepLabel = `${step}${stepMarks[stepIdx] ?? ""}`;
        let stepDf: { df1: number; df2: number } | null = null;

        for (const entry of pairwiseEntries.filter((e) => e.step === step)) {
          const fRow: any = { rowHeader: [stepLabel, entry.group, "F"] };
          const sigRow: any = { rowHeader: [stepLabel, entry.group, "Sig."] };
          pairGroups.forEach((_, i) => {
            fRow[`pair_g_${i}`] = "";
            sigRow[`pair_g_${i}`] = "";
          });
          for (const c of entry.comparisons) {
            const idx = pairGroups.indexOf(c.group_name);
            if (idx === -1) continue;
            fRow[`pair_g_${idx}`] = formatStat(c.f_value);
            sigRow[`pair_g_${idx}`] = formatSig(c.significance);
            stepDf = { df1: c.df1, df2: c.df2 };
          }
          pairTable.rows.push(fRow, sigRow);
        }

        if (stepDf) {
          pairFootnotes.push(
            `${String.fromCharCode(97 + stepIdx)}. ${stepDf.df1}, ${stepDf.df2} degrees of freedom for step ${step}.`,
          );
        }
      });

      for (const note of pairFootnotes) {
        pairTable.rows.push({ rowHeader: [note] });
      }

      resultJson.tables.push(pairTable);
    }
  }

  // 16. Variables in the Analysis
  // SPSS shows Min. Tolerance only in "Variables Not in the Analysis"; the in-model
  // table has Tolerance, F to Remove and the method statistic, for every method.
  if (data.stepwise_statistics?.variables_in_analysis) {
    const columnHeaders = isRaosVMethod
      ? [
          { header: "Step", key: "step" },
          { header: "", key: "var" },
          { header: "Tolerance", key: "tolerance" },
          { header: "F to Remove", key: "f_to_remove" },
          { header: "Rao's V", key: "raos_v" },
        ]
      : isFRatio
        ? [
            { header: "Step", key: "step" },
            { header: "", key: "var" },
            { header: "Tolerance", key: "tolerance" },
            { header: "F to Remove", key: "f_to_remove" },
            { header: "Min. F", key: "min_f" },
            { header: "Between Groups", key: "between_groups" },
          ]
      : isUnexplained
        ? [
            { header: "Step", key: "step" },
            { header: "", key: "var" },
            { header: "Tolerance", key: "tolerance" },
            { header: "F to Remove", key: "f_to_remove" },
            { header: "Residual Variance", key: "residual_variance" },
          ]
      : isMahalanobis
        ? [
            { header: "Step", key: "step" },
            { header: "", key: "var" },
            { header: "Tolerance", key: "tolerance" },
            { header: "F to Remove", key: "f_to_remove" },
            { header: "Min. D Squared", key: "min_d_squared" },
            { header: "Between Groups", key: "between_groups" },
          ]
        : [
            { header: "Step", key: "step" },
            { header: "", key: "var" },
            { header: "Tolerance", key: "tolerance" },
            { header: "F to Remove", key: "f_to_remove" },
            { header: "Wilks' Lambda", key: "wilks_lambda" },
          ];

    const table: Table = {
      key: "variables_in_analysis",
      title: "Variables in the Analysis",
      columnHeaders,
      rows: [],
    };

    const sortedSteps = [
      ...data.stepwise_statistics.variables_in_analysis,
    ].sort((a: any, b: any) => parseInt(a.step) - parseInt(b.step));

    // SPSS lists the variables within each step in the order they ENTERED the
    // model (Fe2O3, MgO, K2O, …), not most-recently-entered first.
    const entryOrder: string[] = Array.isArray(
      data.stepwise_statistics.variables_entered,
    )
      ? data.stepwise_statistics.variables_entered.filter(Boolean)
      : [];
    const entryRank = (name: string) => {
      const idx = entryOrder.indexOf(name);
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    };

    for (let i = 0; i < sortedSteps.length; i++) {
      const stepData = sortedSteps[i];
      const step = stepData.step;

      if (stepData.variables && stepData.variables.length > 0) {
        const stepVars = [...stepData.variables].sort(
          (a: any, b: any) => entryRank(a.variable) - entryRank(b.variable),
        );
        // Residual variance shown is the model WITHOUT this variable. With only
        // one variable in the model, removing it leaves nothing, so SPSS blanks it.
        const modelSize = stepVars.length;
        for (let j = 0; j < stepVars.length; j++) {
          const variable = stepVars[j];

          if (isRaosVMethod) {
            table.rows.push({
              rowHeader: [step, variable.variable],
              tolerance: formatStat(variable.tolerance),
              f_to_remove: formatStat(variable.f_to_remove),
              raos_v: formatStat(raosVFromProxy(variable.wilks_lambda)),
            });
          } else if (isFRatio) {
            table.rows.push({
              rowHeader: [step, variable.variable],
              tolerance: formatStat(variable.tolerance),
              f_to_remove: formatStat(variable.f_to_remove),
              min_f: formatStat(variable.min_d_squared || 0),
              between_groups: variable.between_groups || "",
            });
          } else if (isUnexplained) {
            table.rows.push({
              rowHeader: [step, variable.variable],
              tolerance: formatStat(variable.tolerance),
              f_to_remove: formatStat(variable.f_to_remove),
              residual_variance:
                modelSize <= 1
                  ? ""
                  : formatStat(variable.min_d_squared || 0),
            });
          } else if (isMahalanobis) {
            table.rows.push({
              rowHeader: [step, variable.variable],
              tolerance: formatStat(variable.tolerance),
              f_to_remove: formatStat(variable.f_to_remove),
              min_d_squared: formatStat(variable.min_d_squared || 0),
              between_groups: variable.between_groups || "",
            });
          } else {
            table.rows.push({
              rowHeader: [step, variable.variable],
              tolerance: formatStat(variable.tolerance),
              f_to_remove: formatStat(variable.f_to_remove),
              wilks_lambda: formatStat(variable.wilks_lambda),
            });
          }
        }
      }
    }

    resultJson.tables.push(table);
  }

  // 17. Variables Not in the Analysis
  if (data.stepwise_statistics?.variables_not_in_analysis) {
    const columnHeaders = isRaosVMethod
      ? [
          { header: "Step", key: "step" },
          { header: "", key: "var" },
          { header: "Tolerance", key: "tolerance" },
          { header: "Min. Tolerance", key: "min_tolerance" },
          { header: "F to Enter", key: "f_to_enter" },
          { header: "Rao's V", key: "raos_v" },
        ]
      : isFRatio
        ? [
            { header: "Step", key: "step" },
            { header: "", key: "var" },
            { header: "Tolerance", key: "tolerance" },
            { header: "Min. Tolerance", key: "min_tolerance" },
            { header: "F to Enter", key: "f_to_enter" },
            { header: "Min. F", key: "min_f" },
            { header: "Between Groups", key: "between_groups" },
          ]
      : isUnexplained
        ? [
            { header: "Step", key: "step" },
            { header: "", key: "var" },
            { header: "Tolerance", key: "tolerance" },
            { header: "Min. Tolerance", key: "min_tolerance" },
            { header: "F to Enter", key: "f_to_enter" },
            { header: "Residual Variance", key: "residual_variance" },
          ]
      : isMahalanobis
        ? [
            { header: "Step", key: "step" },
            { header: "", key: "var" },
            { header: "Tolerance", key: "tolerance" },
            { header: "Min. Tolerance", key: "min_tolerance" },
            { header: "F to Enter", key: "f_to_enter" },
            { header: "Min. D Squared", key: "min_d_squared" },
            { header: "Between Groups", key: "between_groups" },
          ]
        : [
            { header: "Step", key: "step" },
            { header: "", key: "var" },
            { header: "Tolerance", key: "tolerance" },
            { header: "Min. Tolerance", key: "min_tolerance" },
            { header: "F to Enter", key: "f_to_enter" },
            { header: "Wilks' Lambda", key: "wilks_lambda" },
          ];

    const table: Table = {
      key: "variables_not_in_analysis",
      title: "Variables Not in the Analysis",
      columnHeaders,
      rows: [],
    };

    const sortedNotInSteps = [
      ...data.stepwise_statistics.variables_not_in_analysis,
    ].sort((a: any, b: any) => parseInt(a.step) - parseInt(b.step));

    // SPSS lists the not-in-analysis variables in the ORIGINAL predictor order
    // (as entered in the Independents list), not by the selection criterion.
    const notInOriginalOrder: string[] =
      (Array.isArray(data.equality_tests?.variables) &&
        data.equality_tests.variables) ||
      (Array.isArray(data.pooled_matrices?.variables) &&
        data.pooled_matrices.variables) ||
      (Array.isArray(data.group_statistics?.means)
        ? data.group_statistics.means.map((m: any) => m.variable)
        : []) ||
      [];
    const notInRank = (name: string) => {
      const idx = notInOriginalOrder.indexOf(name);
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    };

    for (let i = 0; i < sortedNotInSteps.length; i++) {
      const stepData = sortedNotInSteps[i];
      const step = stepData.step;

      if (stepData.variables && stepData.variables.length > 0) {
        const stepVars =
          notInOriginalOrder.length > 0
            ? [...stepData.variables].sort(
                (a: any, b: any) => notInRank(a.variable) - notInRank(b.variable),
              )
            : stepData.variables;
        for (let j = 0; j < stepVars.length; j++) {
          const variable = stepVars[j];

          if (isRaosVMethod) {
            table.rows.push({
              rowHeader: [step, variable.variable],
              tolerance: formatStat(variable.tolerance),
              min_tolerance: formatStat(
                variable.min_tolerance ?? variable.tolerance,
              ),
              f_to_enter: formatStat(variable.f_to_enter),
              raos_v: formatStat(raosVFromProxy(variable.wilks_lambda)),
            });
          } else if (isFRatio) {
            table.rows.push({
              rowHeader: [step, variable.variable],
              tolerance: formatStat(variable.tolerance),
              min_tolerance: formatStat(
                variable.min_tolerance ?? variable.tolerance,
              ),
              f_to_enter: formatStat(variable.f_to_enter),
              min_f: formatStat(variable.min_d_squared || 0),
              between_groups: variable.between_groups || "",
            });
          } else if (isUnexplained) {
            table.rows.push({
              rowHeader: [step, variable.variable],
              tolerance: formatStat(variable.tolerance),
              min_tolerance: formatStat(
                variable.min_tolerance ?? variable.tolerance,
              ),
              f_to_enter: formatStat(variable.f_to_enter),
              residual_variance: formatStat(variable.min_d_squared || 0),
            });
          } else if (isMahalanobis) {
            table.rows.push({
              rowHeader: [step, variable.variable],
              tolerance: formatStat(variable.tolerance),
              min_tolerance: formatStat(
                variable.min_tolerance ?? variable.tolerance,
              ),
              f_to_enter: formatStat(variable.f_to_enter),
              min_d_squared: formatStat(variable.min_d_squared || 0),
              between_groups: variable.between_groups || "",
            });
          } else {
            table.rows.push({
              rowHeader: [step, variable.variable],
              tolerance: formatStat(variable.tolerance),
              min_tolerance: formatStat(
                variable.min_tolerance ?? variable.tolerance,
              ),
              f_to_enter: formatStat(variable.f_to_enter),
              wilks_lambda: formatStat(variable.wilks_lambda),
            });
          }
        }
      }
    }

    resultJson.tables.push(table);
  }

  // 18. Wilks' Lambda — Summary of Canonical Discriminant Functions
  // (the chi-square test of the discriminant functions). SPSS shows this for
  // both the enter and stepwise methods, under Eigenvalues. It is distinct from
  // the per-step stepwise table rendered above as "stepwise_wilks_lambda".
  if (data.wilks_lambda_test) {
    const testTable: Table = {
      key: "wilks_lambda_test",
      title: "Wilks' Lambda",
      columnHeaders: [
        { header: "Test of Function(s)", key: "test_functions" },
        { header: "Wilks' Lambda", key: "wilks_lambda" },
        { header: "Chi-square", key: "chi_square" },
        { header: "df", key: "df" },
        { header: "Sig.", key: "sig" },
      ],
      rows: [],
    };

    // Iterate through test of functions
    for (let i = 0; i < data.wilks_lambda_test.test_of_functions.length; i++) {
      testTable.rows.push({
        rowHeader: [data.wilks_lambda_test.test_of_functions[i]],
        wilks_lambda: formatStat(
          data.wilks_lambda_test.wilks_lambda[i],
        ),
        chi_square: formatStat(data.wilks_lambda_test.chi_square[i]),
        df: formatCount(data.wilks_lambda_test.df[i]),
        sig: formatSig(data.wilks_lambda_test.significance[i]),
      });
    }

    resultJson.tables.push(testTable);
  }

  // 19. Eigenvalues
  if (data.eigen_description) {
    const table: Table = {
      key: "eigenvalues",
      title: "Eigenvalues",
      columnHeaders: [
        { header: "Function", key: "function" },
        { header: "Eigenvalue", key: "eigenvalue" },
        { header: "% of Variance", key: "variance_percent" },
        { header: "Cumulative %", key: "cumulative_percent" },
        {
          header: "Canonical Correlation",
          key: "canonical_correlation",
        },
      ],
      rows: [],
    };

    // Iterate through functions
    for (let i = 0; i < data.eigen_description.functions.length; i++) {
      table.rows.push({
        rowHeader: [data.eigen_description.functions[i]],
        eigenvalue:
          formatStat(data.eigen_description.eigenvalue[i]) +
          (i === 0 ? "ᵃ" : ""), // Add superscript for the first function
        variance_percent: formatPercent(
          data.eigen_description.variance_percentage[i],
        ),
        cumulative_percent: formatPercent(
          data.eigen_description.cumulative_percentage[i],
        ),
        canonical_correlation: formatStat(
          data.eigen_description.canonical_correlation[i],
        ),
      });
    }

    // Footnote: the number of functions actually used (it was hard-coded to 1).
    table.rows.push({
      rowHeader: [
        `a. First ${data.eigen_description.functions.length} canonical discriminant functions were used in the analysis.`,
      ],
    });

    resultJson.tables.push(table);
  }

  // 20. Casewise Statistics
  if (data.casewise_statistics) {
    // Check if discriminant_scores exists and has entries
    // discriminant_scores from WASM is a Vec<ScoreValue> array with {function, values} entries
    const discriminantScoreEntries = Array.isArray(
      data.casewise_statistics.discriminant_scores,
    )
      ? data.casewise_statistics.discriminant_scores
      : [];

    const numFunctions = discriminantScoreEntries.length;

    // Create dynamic function headers - use function name from WASM data
    const functionChildren = [];
    for (let i = 0; i < discriminantScoreEntries.length; i++) {
      functionChildren.push({
        header: discriminantScoreEntries[i].function,
        key: `function_${i + 1}`,
      });
    }

    const table: Table = {
      key: "casewise_statistics",
      title: "Casewise Statistics",
      columnHeaders: [
        { header: "", key: "type" },
        { header: "Case Number", key: "case_number" },
        { header: "Actual Group", key: "actual_group" },
        // As in SPSS: the predicted group is the Highest Group itself, and only the
        // Second Highest Group block names its group.
        {
          header: "Highest Group",
          key: "highest_group",
          children: [
            { header: "Predicted Group", key: "predicted_group" },
            {
              header: "P(D>d | G=g)",
              key: "p_d_given_g",
              children: [
                { header: "p", key: "p" },
                { header: "df", key: "df" },
              ],
            },
            { header: "P(G=g | D=d)", key: "p_d_g" },
            {
              header: "Squared Mahalanobis Distance to Centroid",
              key: "mahalanobis",
            },
          ],
        },
        {
          header: "Second Highest Group",
          key: "second_highest_group",
          children: [
            { header: "Group", key: "second_group" },
            { header: "P(G=g | D=d)", key: "p_g_d" },
            {
              header: "Squared Mahalanobis Distance to Centroid",
              key: "second_mahalanobis",
            },
          ],
        },
        ...(numFunctions > 0
          ? [
              {
                header: "Discriminant Scores",
                key: "discriminant_scores",
                children: functionChildren,
              },
            ]
          : []),
      ],
      rows: [],
    };

    // Process each case (Original classification)
    for (let i = 0; i < data.casewise_statistics.case_number.length; i++) {
      // Check if this is a misclassified case (add asterisk)
      const predictedGroup = data.casewise_statistics.predicted_group[i];
      const actualGroup = data.casewise_statistics.actual_group[i];
      const isMisclassified = actualGroup !== UNGROUPED_GROUP && predictedGroup !== actualGroup;

      // Discriminant scores: discriminant_scores is a Vec<ScoreValue> array of
      // { function, values }, so read the per-case value from each entry's
      // `values` array (NOT by indexing the entry object itself).
      const scoreData: any = {};
      for (let j = 0; j < discriminantScoreEntries.length; j++) {
        scoreData[`function_${j + 1}`] = formatStat(
          discriminantScoreEntries[j].values[i],
        );
      }

      table.rows.push({
        rowHeader: ["Original"],
        case_number: formatCount(
          data.casewise_statistics.case_number[i],
        ),
        actual_group: data.casewise_statistics.actual_group[i],
        predicted_group:
          data.casewise_statistics.predicted_group[i] +
          (isMisclassified ? "**" : ""),
        p: formatStat(
          data.casewise_statistics.highest_group.p_value[i],
        ),
        df: formatCount(data.casewise_statistics.highest_group.df[i]),
        p_d_g: formatStat(
          data.casewise_statistics.highest_group.p_g_equals_d[i],
        ),
        mahalanobis: formatStat(
          data.casewise_statistics.highest_group.squared_mahalanobis_distance[
            i
          ],
        ),
        // Second Highest Group shows the posterior P(G=g | D=d), not P(D>d | G=g).
        p_g_d: formatStat(
          data.casewise_statistics.second_highest_group.p_g_equals_d[i],
        ),
        second_mahalanobis: formatStat(
          data.casewise_statistics.second_highest_group
            .squared_mahalanobis_distance[i],
        ),
        second_group: data.casewise_statistics.second_highest_group.group[i],
        ...scoreData,
      });
    }

    // ---- CROSS-VALIDATED SECTION ----
    if (data.casewise_statistics.cross_validated) {
      const cvData = data.casewise_statistics.cross_validated;

      // One row per cross-validated case, labelled "Cross-validated" in the row header.
      for (let i = 0; i < cvData.case_number.length; i++) {
        const cvPredictedGroup = cvData.predicted_group[i];
        const cvActualGroup = cvData.actual_group[i];
        const isMisclassifiedCV = cvPredictedGroup !== cvActualGroup;

        // Cross-validated has NO discriminant scores (SPSS leaves them blank).
        const scoreDataCV: any = {};
        for (let j = 0; j < discriminantScoreEntries.length; j++) {
          scoreDataCV[`function_${j + 1}`] = "";
        }

        table.rows.push({
          rowHeader: ["Cross-validatedᵃ"],
          case_number: formatCount(cvData.case_number[i]),
          actual_group: cvData.actual_group[i],
          predicted_group:
            cvData.predicted_group[i] + (isMisclassifiedCV ? "**" : ""),
          p: formatStat(cvData.highest_group.p_value[i]),
          df: formatCount(cvData.highest_group.df[i]),
          p_d_g: formatStat(cvData.highest_group.p_g_equals_d[i]),
          mahalanobis: formatStat(
            cvData.highest_group.squared_mahalanobis_distance[i],
          ),
          p_g_d: formatStat(cvData.second_highest_group.p_g_equals_d[i]),
          second_mahalanobis: formatStat(
            cvData.second_highest_group.squared_mahalanobis_distance[i],
          ),
          second_group: cvData.second_highest_group.group[i],
          ...scoreDataCV,
        });
      }
    }

    // Footnotes, as SPSS prints them under the table.
    const hasCrossValidated = Boolean(data.casewise_statistics.cross_validated);
    const anyMisclassified = table.rows.some((row) =>
      String(row.predicted_group ?? "").endsWith("**"),
    );
    const footnotes = [
      ...(hasCrossValidated
        ? [
            "For the original data, squared Mahalanobis distance is based on canonical functions.",
            "For the cross-validated data, squared Mahalanobis distance is based on observations.",
          ]
        : []),
      ...(anyMisclassified ? ["**. Misclassified case"] : []),
      ...(hasCrossValidated
        ? [
            "a. Cross validation is done only for those cases in the analysis. In cross validation, each case is classified by the functions derived from all cases other than that case.",
          ]
        : []),
    ];
    for (const note of footnotes) table.rows.push({ rowHeader: [note] });

    resultJson.tables.push(table);
  }

  // 21. Classification Results
  if (
    data.classification_results?.original_classification &&
    data.classification_results.original_classification.length > 0
  ) {
    type GroupCounts = { group: string; counts: number[] };
    type GroupPercentages = { group: string; percentages: number[] };
    const cr = data.classification_results;

    // Columns and rows in group-code order; counts[j] follows the same order.
    const groups: string[] = cr.original_classification
      .map((item: GroupCounts) => item.group)
      .sort(compareGroupLabels);

    // With a selection variable (e.g. a training/testing split), SPSS splits the
    // table into "Cases Selected" (the analysis/training cases) and "Cases Not
    // Selected" (the testing cases, classified with the training functions), each
    // with its own hit ratio. Cross-validation covers the selected cases only.
    const unselectedCounts: GroupCounts[] = Array.isArray(cr.unselected_classification)
      ? cr.unselected_classification
      : [];
    const unselectedPercentages: GroupPercentages[] = Array.isArray(cr.unselected_percentage)
      ? cr.unselected_percentage
      : [];
    const hasUnselected = unselectedCounts.length > 0;
    const hasCrossValidated = Array.isArray(cr.cross_validated_classification);
    // Cases with a missing or out-of-range group code, classified as SPSS does and
    // shown as an "Ungrouped cases" row of the Original block they belong to.
    const numbers = (value: unknown): number[] | null => (Array.isArray(value) ? value : null);
    const ungroupedCounts = numbers(cr.ungrouped_classification);
    const ungroupedPercentages = numbers(cr.ungrouped_percentage);
    const unselectedUngroupedCounts = numbers(cr.unselected_ungrouped_classification);
    const unselectedUngroupedPercentages = numbers(cr.unselected_ungrouped_percentage);
    const groupedTotal = (counts: GroupCounts[]): number =>
      counts.reduce((sum, row) => sum + row.counts.reduce((s, c) => s + c, 0), 0);

    // Footnote letters in the order the notes are printed. The unselected hit ratio
    // is left out when every unselected case is ungrouped (there is nothing to score).
    const letters = "abcdefg";
    let nextLetter = 0;
    const originalNote = letters[nextLetter++];
    const unselectedNote =
      hasUnselected && groupedTotal(unselectedCounts) > 0 ? letters[nextLetter++] : "";
    const crossValidationNote = hasCrossValidated ? letters[nextLetter++] : "";
    const crossValidatedNote = hasCrossValidated ? letters[nextLetter++] : "";
    const superscript: Record<string, string> = { a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ" };

    const table: Table = {
      key: "classification_results",
      title: "Classification Results",
      columnHeaders: [
        ...(hasUnselected ? [{ header: "", key: "sample" }] : []),
        { header: "", key: "category" },
        { header: "", key: "subcategory" },
        { header: "Group", key: "group_label" },
        {
          header: "Predicted Group Membership",
          key: "predicted_groups",
          children: groups.map((group: string, i: number) => ({
            header: group,
            key: `group_${i}`,
          })),
        },
        { header: "Total", key: "total" },
      ],
      rows: [],
    };

    // One block (Count rows, then % rows) of the table. `sampleLabel` goes in the
    // extra leading column when the table is split by the selection variable. The
    // optional `ungrouped` row closes each part of an Original block.
    const pushBlock = (
      sampleLabel: string,
      blockLabel: string,
      counts: GroupCounts[],
      percentages: GroupPercentages[],
      ungrouped?: { counts: number[] | null; percentages: number[] | null },
    ) => {
      const lead = (first: boolean) => (hasUnselected ? [first ? sampleLabel : ""] : []);

      groups.forEach((group, i) => {
        const row = counts.find((item) => item.group === group);
        if (!row) return;
        const rowData: any = {
          rowHeader: [...lead(i === 0), i === 0 ? blockLabel : "", i === 0 ? "Count" : "", row.group],
          total: formatCount(row.counts.reduce((sum, count) => sum + count, 0)),
        };
        row.counts.forEach((count, j) => (rowData[`group_${j}`] = formatCount(count)));
        table.rows.push(rowData);
      });
      if (ungrouped?.counts) {
        const rowData: any = {
          rowHeader: [...lead(false), "", "", "Ungrouped cases"],
          total: formatCount(ungrouped.counts.reduce((sum, count) => sum + count, 0)),
        };
        ungrouped.counts.forEach((count, j) => (rowData[`group_${j}`] = formatCount(count)));
        table.rows.push(rowData);
      }

      groups.forEach((group, i) => {
        const row = percentages.find((item) => item.group === group);
        if (!row) return;
        const rowCount = counts.find((item) => item.group === group)?.counts
          .reduce((sum, count) => sum + count, 0) ?? 0;
        const rowData: any = {
          rowHeader: [...lead(false), "", i === 0 ? "%" : "", row.group],
          total: formatPercent(rowCount > 0 ? 100 : 0),
        };
        row.percentages.forEach((pct, j) => (rowData[`group_${j}`] = formatPercent(pct)));
        table.rows.push(rowData);
      });
      if (ungrouped?.percentages) {
        const rowData: any = {
          rowHeader: [...lead(false), "", "", "Ungrouped cases"],
          total: formatPercent(100),
        };
        ungrouped.percentages.forEach((pct, j) => (rowData[`group_${j}`] = formatPercent(pct)));
        table.rows.push(rowData);
      }
    };

    // Share of correctly classified cases: 100 · Σ diagonal / Σ all counts. Every
    // classified case is in the denominator, including the rows of a group that got
    // none of its own cases right.
    const hitRatio = (counts: GroupCounts[]): number => {
      let correct = 0;
      let total = 0;
      groups.forEach((group, i) => {
        const row = counts.find((item) => item.group === group);
        if (!row) return;
        correct += row.counts[i] ?? 0;
        total += row.counts.reduce((sum, count) => sum + count, 0);
      });
      return total > 0 ? (correct / total) * 100 : 0;
    };

    pushBlock(
      "Cases Selected",
      "Original",
      cr.original_classification,
      cr.original_percentage ?? [],
      { counts: ungroupedCounts, percentages: ungroupedPercentages },
    );
    if (hasCrossValidated) {
      pushBlock(
        "",
        `Cross-validated${superscript[crossValidationNote] ?? ""}`,
        cr.cross_validated_classification,
        cr.cross_validated_percentage ?? [],
      );
    }
    if (hasUnselected) {
      pushBlock("Cases Not Selected", "Original", unselectedCounts, unselectedPercentages, {
        counts: unselectedUngroupedCounts,
        percentages: unselectedUngroupedPercentages,
      });
    }

    // --- FOOTNOTES ---
    const selectedWord = hasUnselected ? "selected " : "";
    table.rows.push({
      rowHeader: [
        `${originalNote}. ${formatPercent(hitRatio(cr.original_classification))}% of ${selectedWord}original grouped cases correctly classified.`,
      ],
    });
    if (unselectedNote) {
      table.rows.push({
        rowHeader: [
          `${unselectedNote}. ${formatPercent(hitRatio(unselectedCounts))}% of unselected original grouped cases correctly classified.`,
        ],
      });
    }
    if (hasCrossValidated) {
      table.rows.push({
        rowHeader: [
          `${crossValidationNote}. Cross validation is done only for those cases in the analysis. In cross validation, each case is classified by the functions derived from all cases other than that case.`,
        ],
      });
      table.rows.push({
        rowHeader: [
          `${crossValidatedNote}. ${formatPercent(hitRatio(cr.cross_validated_classification))}% of ${selectedWord}cross-validated grouped cases correctly classified.`,
        ],
      });
    }

    resultJson.tables.push(table);
  }

  // 22. Separate-groups classification (Classify → Use Covariance Matrix →
  // Separate-groups). SPSS then shows each group's covariance matrix of the
  // canonical discriminant functions — the matrices that classify the cases — and
  // Box's test of their equality.
  const sep = data.separate_groups_classification;
  if (sep && Array.isArray(sep.groups) && sep.groups.length > 0) {
    const functions: string[] = sep.functions ?? [];

    const covTable: Table = {
      key: "separate_groups_covariance_matrices",
      title: "Covariance Matrices of Canonical Discriminant Functions",
      columnHeaders: [
        { header: "Group", key: "category" },
        { header: "Function", key: "func" },
        ...functions.map((f: string, index: number) => ({
          header: f,
          key: `fn_${index}`,
        })),
      ],
      rows: [],
    };

    for (const g of sep.groups) {
      (g.covariance ?? []).forEach((row: number[], i: number) => {
        const rowData: any = {
          rowHeader: [i === 0 ? g.group : "", functions[i] ?? String(i + 1)],
        };
        row.forEach((value: number, j: number) => {
          rowData[`fn_${j}`] = formatStat(value);
        });
        covTable.rows.push(rowData);
      });
    }

    covTable.rows.push({
      rowHeader: [
        "Separate-groups covariance matrices of the canonical discriminant functions, used to classify the cases.",
      ],
    });
    resultJson.tables.push(covTable);

    const ld = sep.log_determinants;
    if (ld) {
      const ldTable: Table = {
        key: "separate_groups_log_determinants",
        title: "Log Determinants",
        columnHeaders: [
          { header: "Group", key: "category" },
          { header: "Rank", key: "rank" },
          { header: "Log Determinant", key: "log_determinant" },
        ],
        rows: [],
      };

      for (let i = 0; i < ld.groups.length; i++) {
        ldTable.rows.push({
          rowHeader: [ld.groups[i]],
          rank: formatCount(ld.ranks[i]),
          log_determinant: formatStat(ld.log_determinants[i]),
        });
      }
      ldTable.rows.push({
        rowHeader: ["Pooled within-groups"],
        rank: formatCount(ld.rank_pooled),
        log_determinant: formatStat(ld.pooled_log_determinant),
      });
      ldTable.rows.push({
        rowHeader: [
          "The ranks and natural logarithms of determinants printed are those of the group covariance matrices of the canonical discriminant functions.",
        ],
      });
      resultJson.tables.push(ldTable);
    }

    const bm = sep.box_m_test;
    if (bm) {
      resultJson.tables.push({
        key: "separate_groups_box_m_test",
        title: "Test Results",
        columnHeaders: [
          { header: "", key: "test" },
          { header: "" },
          { header: "", key: "value" },
        ],
        rows: [
          { rowHeader: ["Box's M"], value: formatStat(bm.box_m) },
          { rowHeader: ["F", "Approx."], value: formatStat(bm.f_approx) },
          { rowHeader: ["", "df1"], value: formatCount(bm.df1) },
          { rowHeader: ["", "df2"], value: formatCount(bm.df2) },
          { rowHeader: ["", "Sig."], value: formatSig(bm.p_value) },
          {
            rowHeader: [
              "Tests null hypothesis of equal population covariance matrices of canonical discriminant functions.",
            ],
          },
        ],
      });
    }
  }

  // ── Scatter plots (Combined-Groups + Separate-Groups) ──────────────────────
  // scatter_data holds every classified case's scores whenever combine||sep_grp
  // is on (casewise_statistics may stop at "Limit cases to first n", so it is only
  // a fallback). Each plot is gated on its own Classify → Plots checkbox.
  const wantCombinedPlot = data?.combined_groups_plot === true;
  const wantSeparatePlots = data?.separate_groups_plot === true;
  const scatterSrc = data?.scatter_data ?? data?.casewise_statistics;
  // discriminant_scores is Vec<ScoreValue> = [{function, values}], not a keyed object
  const scoreArr: Array<{ function: string; values: number[] }> | undefined =
    scatterSrc?.discriminant_scores;
  const f1Scores: number[] | undefined = scoreArr?.find((s: any) => s.function === "Function 1")?.values;
  const f2Scores: number[] | undefined = scoreArr?.find((s: any) => s.function === "Function 2")?.values;
  // Ungrouped cases are named as in SPSS's legend; they get no Separate-groups plot.
  const caseGroups: string[] | undefined = scatterSrc?.actual_group?.map((g: string) =>
    g === UNGROUPED_GROUP ? UNGROUPED_CASES : g,
  );
  // function_at_centroids is Vec<GroupCentroid> = [{group, values}], not a keyed object
  const centroidArr: Array<{ group: string; values: number[] }> | undefined =
    data?.canonical_functions?.function_at_centroids;
  // Non-empty only under Classify → Use Covariance Matrix → Separate-groups.
  const sepGroups: Array<{ group: string; covariance: number[][] }> =
    data?.separate_groups_classification?.groups ?? [];

  const hasScatterData =
    Array.isArray(f1Scores) &&
    Array.isArray(f2Scores) &&
    Array.isArray(caseGroups) &&
    f1Scores.length > 0;

  // One discriminant function (two groups, or a single predictor): as SPSS does,
  // the Combined-groups plot becomes a histogram of the Function 1 scores stacked
  // by group, and the Separate-groups plots become one histogram per group.
  const hasOneFunction =
    Array.isArray(f1Scores) &&
    !Array.isArray(f2Scores) &&
    Array.isArray(caseGroups) &&
    f1Scores.length > 0;

  if (hasOneFunction && (wantCombinedPlot || wantSeparatePlots)) {
    const f1 = f1Scores as number[];
    const grps = caseGroups as string[];

    const combinedHistogram: Chart = {
      chartType: "Stacked Histogram",
      chartData: grps.map((g, i) => ({ category: g, value: f1[i] })),
      chartMetadata: {
        axisInfo: { x: "Function 1", y: "Frequency", category: "Group" },
        description: "Combined-Groups Plot",
        title: "Canonical Discriminant Function 1",
        subtitle: "All groups",
        notes: null,
      },
      chartConfig: {
        width: 600,
        height: 450,
        useAxis: true,
        useLegend: true,
        axisLabels: { x: "Function 1", y: "Frequency" },
      },
    };

    const separateHistograms: Chart[] = [...new Set(grps)].filter((g) => g !== UNGROUPED_CASES).map((group) => {
      const values = f1.filter((_, i) => grps[i] === group);
      const n = values.length;
      const mean = n > 0 ? values.reduce((s, v) => s + v, 0) / n : 0;
      const sd =
        n > 1
          ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1))
          : 0;
      return {
        chartType: "Histogram",
        chartData: values,
        chartMetadata: {
          axisInfo: { x: "Function 1", y: "Frequency", category: "Group" },
          description: `Separate-Groups Plot: Group ${group}`,
          title: "Canonical Discriminant Function 1",
          subtitle: `Group = ${group}   Mean = ${formatStat(mean)}, Std. Dev. = ${formatStat(sd)}, N = ${n}`,
          notes: null,
        },
        chartConfig: {
          width: 600,
          height: 450,
          useAxis: true,
          useLegend: false,
          axisLabels: { x: "Function 1", y: "Frequency" },
        },
      };
    });

    resultJson.charts = [
      ...(wantCombinedPlot ? [combinedHistogram] : []),
      ...(wantSeparatePlots ? separateHistograms : []),
    ];
  }

  if (hasScatterData && (wantCombinedPlot || wantSeparatePlots)) {
    const f1 = f1Scores as number[];
    const f2 = f2Scores as number[];
    const grps = caseGroups as string[];

    // Case data points: { category: group, x: Function1, y: Function2 }
    const casePoints = grps.map((g, i) => ({ category: g, x: f1[i], y: f2[i] }));

    // Centroid data points: { category: "GroupName ★", x, y }
    const centroidPoints: { category: string; x: number; y: number }[] = (
      centroidArr ?? []
    ).map(({ group, values }) => ({
      category: group + " ★",
      x: values[0] ?? 0,
      y: values[1] ?? 0,
    }));

    // Linear decision boundaries (perpendicular bisectors of centroid pairs, equal-prior LDA).
    // Each boundary is parameterised as a line segment extended far beyond the data range;
    // the renderer clips it to the plot area. Under Separate-groups classification
    // the real boundaries are curved, so these straight lines are left out.
    const boundaryLines: Array<{ x1: number; y1: number; x2: number; y2: number; dashArray: string }> = [];
    const centroids = centroidArr ?? [];
    if (centroids.length >= 2 && sepGroups.length === 0) {
      const allX = casePoints.map((p) => p.x);
      const allY = casePoints.map((p) => p.y);
      const xSpan = Math.max(...allX) - Math.min(...allX);
      const ySpan = Math.max(...allY) - Math.min(...allY);
      const T = Math.max(xSpan, ySpan, 1) * 4; // extend well beyond data

      for (let i = 0; i < centroids.length; i++) {
        for (let j = i + 1; j < centroids.length; j++) {
          const c1x = centroids[i].values[0] ?? 0;
          const c1y = centroids[i].values[1] ?? 0;
          const c2x = centroids[j].values[0] ?? 0;
          const c2y = centroids[j].values[1] ?? 0;

          const mx = (c1x + c2x) / 2;
          const my = (c1y + c2y) / 2;
          const dx = c2x - c1x;
          const dy = c2y - c1y;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len < 1e-10) continue;

          // Perpendicular direction (normalised)
          const perpX = -dy / len;
          const perpY = dx / len;

          boundaryLines.push({
            x1: mx + T * perpX,
            y1: my + T * perpY,
            x2: mx - T * perpX,
            y2: my - T * perpY,
            dashArray: "6,3",
          });
        }
      }
    }

    // Combined-Groups Plot
    const combinedChart: Chart = {
      chartType: "Grouped Scatter Plot",
      chartData: [...casePoints, ...centroidPoints],
      chartMetadata: {
        axisInfo: { x: "Function 1", y: "Function 2", category: "Group" },
        description: "Combined-Groups Plot",
        title: "Combined-Groups Plot",
        subtitle: "Canonical Discriminant Functions",
        notes:
          boundaryLines.length > 0
            ? "★ = Group Centroid  — — — = Decision Boundary"
            : "★ = Group Centroid",
      },
      chartConfig: {
        width: 600,
        height: 500,
        useAxis: true,
        useLegend: true,
        axisLabels: { x: "Function 1", y: "Function 2" },
        ...(boundaryLines.length > 0 && { boundaryLines }),
      },
    };

    // Separate-Groups Plots (one per group)
    const uniqueGroups = [...new Set(grps)].filter((g) => g !== UNGROUPED_CASES);
    const separateCharts: Chart[] = uniqueGroups.map((group) => {
      const groupCases = casePoints.filter((p) => p.category === group);
      const groupCentroid = centroidPoints.find((p) => p.category === group + " ★");
      return {
        chartType: "Grouped Scatter Plot",
        chartData: groupCentroid ? [...groupCases, groupCentroid] : groupCases,
        chartMetadata: {
          axisInfo: { x: "Function 1", y: "Function 2", category: "Group" },
          description: `Separate-Groups Plot: Group ${group}`,
          title: "Separate-Groups Plot",
          subtitle: `Group ${group}`,
          notes: "★ = Group Centroid",
        },
        chartConfig: {
          width: 600,
          height: 500,
          useAxis: true,
          useLegend: true,
          axisLabels: { x: "Function 1", y: "Function 2" },
        },
      };
    });

    resultJson.charts = [
      ...(wantCombinedPlot ? [combinedChart] : []),
      ...(wantSeparatePlots ? separateCharts : []),
    ];
  }

  // ── Territorial Map (Classify → Plots → Territorial Map) ───────────────────
  // Partitions the discriminant space (Function 1 × Function 2) into the LDA
  // classification regions (nearest centroid, prior-adjusted) and shades each
  // region by group. Built from the centroids alone, so it works even when no
  // scatter/casewise data is present. Needs ≥ 2 discriminant functions.
  if (data?.territorial_map) {
    const cents = (centroidArr ?? []).filter(
      (c) => Array.isArray(c.values) && c.values.length >= 2,
    );

    if (cents.length >= 2) {
      // Prior probability per group (log), defaulting to equal priors.
      const priorLog: Record<string, number> = {};
      const pp = data?.prior_probabilities;
      if (pp && Array.isArray(pp.groups) && Array.isArray(pp.prior_probabilities)) {
        for (let i = 0; i < pp.groups.length; i++) {
          const v = pp.prior_probabilities[i];
          priorLog[String(pp.groups[i])] =
            typeof v === "number" && v > 0 ? Math.log(v) : 0;
        }
      }
      const lnPrior = (g: string) => priorLog[String(g)] ?? 0;

      // Separate-groups: each group's own covariance matrix of Functions 1–2
      // replaces the identity, so the region boundaries are curved.
      const sepRule = new Map<string, { inv: number[][]; logDet: number }>();
      for (const g of sepGroups) sepRule.set(String(g.group), twoFunctionRule(g.covariance));

      // Plot range: cover the centroids (and case scores when available), padded.
      const xs = cents.map((c) => c.values[0]);
      const ys = cents.map((c) => c.values[1]);
      if (Array.isArray(f1Scores)) xs.push(...(f1Scores as number[]));
      if (Array.isArray(f2Scores)) ys.push(...(f2Scores as number[]));
      let xMin = Math.min(...xs);
      let xMax = Math.max(...xs);
      let yMin = Math.min(...ys);
      let yMax = Math.max(...ys);
      const padX = (xMax - xMin) * 0.25 || 1;
      const padY = (yMax - yMin) * 0.25 || 1;
      xMin -= padX;
      xMax += padX;
      yMin -= padY;
      yMax += padY;

      // Grid resolution (~2200 cells, kept roughly square).
      const aspect = (xMax - xMin) / (yMax - yMin || 1);
      const NY = Math.min(90, Math.max(34, Math.round(Math.sqrt(2200 / (aspect || 1)))));
      const NX = Math.min(90, Math.max(34, Math.round((2200 / NY) || 50)));

      // Classify each grid cell to the group with the largest
      // ln πₖ − ½ ln|Σₖ| − ½ (d − d̄ₖ)ᵀ Σₖ⁻¹ (d − d̄ₖ), d = (Function 1, Function 2); with
      // the pooled matrix Σₖ = I, so this is ln πₖ − ½ (squared Euclidean distance).
      const regionPoints: { category: string; x: number; y: number }[] = [];
      for (let i = 0; i < NX; i++) {
        const gx = xMin + ((xMax - xMin) * i) / (NX - 1);
        for (let j = 0; j < NY; j++) {
          const gy = yMin + ((yMax - yMin) * j) / (NY - 1);
          let bestGroup = cents[0].group;
          let bestScore = -Infinity;
          for (const c of cents) {
            const dx = gx - c.values[0];
            const dy = gy - c.values[1];
            const rule = sepRule.get(String(c.group));
            const score = rule
              ? -0.5 *
                  (dx * dx * rule.inv[0][0] +
                    2 * dx * dy * rule.inv[0][1] +
                    dy * dy * rule.inv[1][1]) -
                0.5 * rule.logDet +
                lnPrior(c.group)
              : -0.5 * (dx * dx + dy * dy) + lnPrior(c.group);
            if (score > bestScore) {
              bestScore = score;
              bestGroup = c.group;
            }
          }
          regionPoints.push({ category: bestGroup, x: gx, y: gy });
        }
      }

      // Centroids drawn last (on top), in their own category so they stand out.
      const centroidMarks = cents.map((c) => ({
        category: "Centroid ★",
        x: c.values[0],
        y: c.values[1],
      }));

      const territorialChart: Chart = {
        chartType: "Grouped Scatter Plot",
        chartData: [...regionPoints, ...centroidMarks],
        chartMetadata: {
          axisInfo: { x: "Function 1", y: "Function 2", category: "Group" },
          description: "Territorial Map",
          title: "Territorial Map",
          subtitle: "Classification regions in discriminant space",
          notes:
            sepRule.size > 0
              ? "Each region is colored by the group a case there would be classified into (separate-groups covariance matrices). ★ = group centroid."
              : "Each region is colored by the group a case there would be classified into (nearest centroid). ★ = group centroid.",
        },
        chartConfig: {
          width: 640,
          height: 520,
          useAxis: true,
          useLegend: true,
          axisLabels: { x: "Function 1", y: "Function 2" },
        },
      };

      resultJson.charts = [...(resultJson.charts ?? []), territorialChart];
    }
  }

  // Bootstrap for Standardized Canonical Discriminant Function Coefficients
  if (data.bootstrap_results?.standardized?.length) {
    const b = data.bootstrap_results;
    const ciLabel = `${b.level ?? 95}% ${b.ci_method ?? "Percentile"} Confidence Interval`;

    const table: Table = {
      key: "bootstrap_standardized_coefficients",
      title:
        "Bootstrap for Standardized Canonical Discriminant Function Coefficients",
      columnHeaders: [
        { header: "", key: "var" },
        { header: "Function", key: "function" },
        { header: "Coefficient", key: "coefficient" },
        { header: "Bias", key: "bias" },
        { header: "Std. Error", key: "std_error" },
        {
          header: ciLabel,
          key: "ci",
          children: [
            { header: "Lower", key: "ci_lower" },
            { header: "Upper", key: "ci_upper" },
          ],
        },
      ],
      rows: [],
    };

    const funcs: string[] = b.functions ?? [];
    for (const entry of b.standardized) {
      const numF = entry.original?.length ?? 0;
      for (let f = 0; f < numF; f++) {
        table.rows.push({
          rowHeader: [entry.variable, funcs[f] ?? `Function ${f + 1}`],
          coefficient: formatStat(entry.original[f]),
          bias: formatStat(entry.bias[f]),
          std_error: formatStat(entry.std_error[f]),
          ci_lower: formatStat(entry.ci_lower[f]),
          ci_upper: formatStat(entry.ci_upper[f]),
        });
      }
    }

    // The count is the number of resamples actually fitted: resamples that lost
    // a group are dropped, because they cannot support the full set of functions.
    const requested: number = b.num_samples ?? 0;
    const used: number = b.valid_samples ?? requested;
    const strataVars: string[] = b.strata_variables ?? [];

    let footnote = `Bootstrap results are based on ${used} ${(
      b.sampling ?? "Simple"
    ).toLowerCase()} bootstrap samples`;
    footnote += strataVars.length
      ? `, stratified by ${strataVars.join(", ")}.`
      : ".";
    if (used < requested) {
      footnote += ` ${requested - used} of the ${requested} requested samples were dropped because a group was lost in the resample.`;
    }
    // Refits are matched to the original functions by reordering and reflection;
    // say how often the order actually changed (functions with close eigenvalues).
    const reordered: number = b.reordered_samples ?? 0;
    if (reordered > 0) {
      footnote += ` In ${reordered} samples the discriminant functions came out in a different order and were matched to the original functions.`;
    }

    table.rows.push({ rowHeader: [footnote] });

    resultJson.tables.push(table);
  }

  // ── Assumption checks ───────────────────────────────────────────────────────
  // Display order is controlled by store.ts sections[]; the keys are registered
  // at the top there so these render before the main discriminant output.
  const assumptions = data.assumption_results;
  if (assumptions) {
    // Overview with PASS/VIOLATED status per assumption.
    if (Array.isArray(assumptions.summary) && assumptions.summary.length > 0) {
      const table: Table = {
        key: "assumption_summary",
        title: "Assumption Checks Summary",
        columnHeaders: [
          { header: "Assumption", key: "assumption" },
          { header: "Test", key: "test" },
          { header: "Finding", key: "finding" },
          { header: "Status", key: "status" },
        ],
        rows: [],
      };
      let anyViolated = false;
      for (const r of assumptions.summary) {
        if (r.violated) anyViolated = true;
        table.rows.push({
          rowHeader: [r.assumption],
          test: r.test,
          finding: r.finding,
          status: r.violated ? "⚠ Violated" : "Met",
        });
      }
      (table as Table & { footer?: string }).footer = anyViolated
        ? "⚠ One or more assumptions are not met — interpret the results with caution. See the detail tables below."
        : "All checked assumptions are met.";
      resultJson.tables.push(table);
    }

    // Multicollinearity: Tolerance / VIF + condition diagnostics.
    const mc = assumptions.multicollinearity;
    if (mc && Array.isArray(mc.variables) && mc.variables.length > 0) {
      const table: Table = {
        key: "assumption_multicollinearity",
        title: "Multicollinearity (Tolerance and VIF)",
        columnHeaders: [
          { header: "Variable", key: "variable" },
          { header: "Tolerance", key: "tolerance" },
          { header: "VIF", key: "vif" },
        ],
        rows: [],
      };
      for (let i = 0; i < mc.variables.length; i++) {
        table.rows.push({
          rowHeader: [mc.variables[i]],
          tolerance: assumptionStat(mc.tolerance[i]),
          vif: assumptionStat(mc.vif[i]),
        });
      }
      (table as Table & { footer?: string }).footer = mc.note;
      resultJson.tables.push(table);
    }

    // Multivariate normality (Henze–Zirkler) within each group — one row per
    // group (Group / N / HZ / p value / MVN). LDA assumes normality within groups,
    // so the test runs per group rather than on the pooled data.
    const mv = assumptions.multivariate_normality;
    if (mv && Array.isArray(mv.groups) && mv.groups.length > 0) {
      const table: Table = {
        key: "assumption_multivariate_normality",
        title: "Multivariate Normality within Groups (Henze-Zirkler Test)",
        columnHeaders: [
          { header: "Group", key: "group" },
          { header: "N", key: "n" },
          { header: "HZ", key: "hz" },
          { header: "p value", key: "p_value" },
          { header: "MVN", key: "mvn" },
        ],
        rows: [],
      };
      for (let i = 0; i < mv.groups.length; i++) {
        const tested = mv.tested[i];
        table.rows.push({
          rowHeader: [mv.groups[i]],
          n: String(mv.n[i]),
          hz: tested ? assumptionStat(mv.hz[i]) : "",
          p_value: tested ? assumptionSig(mv.p_value[i]) : "",
          mvn: !tested ? "Not tested (n ≤ p)" : mv.normal[i] ? "YES" : "⚠ NO",
        });
      }
      (table as Table & { footer?: string }).footer = mv.note;
      resultJson.tables.push(table);
    }

    // Univariate normality (Anderson–Darling) per predictor within each group
    // (Group / Variable / Statistic / p value / Normality).
    const uv = assumptions.univariate_normality;
    if (uv && Array.isArray(uv.variables) && uv.variables.length > 0) {
      const table: Table = {
        key: "assumption_univariate_normality",
        title: "Univariate Normality within Groups (Anderson-Darling)",
        columnHeaders: [
          { header: "Group", key: "group" },
          { header: "Variable", key: "variable" },
          { header: "Statistic", key: "statistic" },
          { header: "p value", key: "p_value" },
          { header: "Normality", key: "normality" },
        ],
        rows: [],
      };
      for (let i = 0; i < uv.variables.length; i++) {
        table.rows.push({
          rowHeader: [uv.groups[i], uv.variables[i]],
          statistic: assumptionStat(uv.statistic[i]),
          p_value: assumptionSig(uv.p_value[i]),
          normality: uv.normal[i] ? "YES" : "⚠ NO",
        });
      }
      (table as Table & { footer?: string }).footer = uv.note;
      resultJson.tables.push(table);
    }
  }

  return resultJson;
}

/**
 * Separate-groups rule on the territorial map's axes (Functions 1–2): inverse and
 * log determinant of a group's 2 × 2 covariance block Σ = [[a, b], [b, d]]:
 *
 *   Σ⁻¹ = [[d, −b], [−b, a]] / (ad − b²),   ln|Σ| = ln(ad − b²)
 *
 * As in SPSS (and separate_covariance.rs), a function whose variance is ~0, or that
 * is linearly dependent on Function 1 (residual variance d − b²/a ≈ 0), is dropped
 * from the block.
 */
function twoFunctionRule(cov: number[][]): { inv: number[][]; logDet: number } {
  const EPS = 1e-10;
  const a = cov?.[0]?.[0] ?? 0;
  const b = cov?.[0]?.[1] ?? 0;
  const d = cov?.[1]?.[1] ?? 0;

  const keep1 = a > EPS;
  const resid2 = keep1 ? d - (b * b) / a : d;
  const keep2 = resid2 > EPS && resid2 > EPS * Math.abs(d);

  if (keep1 && keep2) {
    const det = a * d - b * b;
    return {
      inv: [
        [d / det, -b / det],
        [-b / det, a / det],
      ],
      logDet: Math.log(det),
    };
  }
  if (keep1) return { inv: [[1 / a, 0], [0, 0]], logDet: Math.log(a) };
  if (keep2) return { inv: [[0, 0], [0, 1 / d]], logDet: Math.log(d) };
  return { inv: [[0, 0], [0, 0]], logDet: 0 };
}
