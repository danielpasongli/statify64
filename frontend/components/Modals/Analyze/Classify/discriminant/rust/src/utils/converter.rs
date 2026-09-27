use wasm_bindgen::JsValue;
use serde::Serialize;
use std::cmp::Ordering;
use std::collections::HashMap;

use crate::models::result::{
    DiscriminantResult,
    ProcessingSummary,
    EqualityTests,
    BoxMTest,
    LogDeterminants,
    EigenDescription,
    WilksLambdaTest,
    VariableInAnalysis,
    PairwiseComparison,
    HighestGroupStatistics,
    ScoreValue,
};

/// Error message as a JavaScript value, for errors returned across the WASM boundary.
pub fn string_to_js_error(error: String) -> JsValue {
    JsValue::from_str(&error)
}

pub fn format_result(result: &Option<DiscriminantResult>) -> Result<JsValue, JsValue> {
    match result {
        Some(result) => {
            let formatted = FormatResult::from_analysis_result(result);
            Ok(serde_wasm_bindgen::to_value(&formatted).unwrap())
        }
        None => Err(JsValue::from_str("No discriminant analysis results available")),
    }
}

#[derive(Serialize)]
struct FormatResult {
    processing_summary: Option<ProcessingSummary>,
    group_statistics: Option<FormattedGroupStatistics>,
    equality_tests: Option<EqualityTests>,
    canonical_functions: Option<FormattedCanonicalFunctions>,
    structure_matrix: Option<FormattedStructureMatrix>,
    classification_results: Option<FormattedClassificationResults>,
    box_m_test: Option<BoxMTest>,
    pooled_matrices: Option<FormattedPooledMatrices>,
    covariance_matrices: Option<FormattedCovarianceMatrices>,
    log_determinants: Option<LogDeterminants>,
    eigen_description: Option<EigenDescription>,
    stepwise_statistics: Option<FormattedStepwiseStatistics>,
    wilks_lambda_test: Option<WilksLambdaTest>,
    casewise_statistics: Option<FormattedCasewiseStatistics>,
    prior_probabilities: Option<FormattedPriorProbabilities>,
    classification_function_coefficients: Option<FormattedClassificationFunctionCoefficients>,
    scatter_data: Option<FormattedScatterData>,
    bootstrap_results: Option<crate::models::result::BootstrapResults>,
    // Already display-shaped (Vec-based), so passed straight through.
    assumption_results: Option<crate::models::result::AssumptionResults>,
    territorial_map: bool,
    combined_groups_plot: bool,
    separate_groups_plot: bool,
    unstandardized_coefficients: bool,
    // Vec-based already; rows follow the analysis group order.
    separate_groups_classification: Option<crate::models::result::SeparateGroupsClassification>,
}

/// Convert a `"Function k" → scores` map into a Vec ordered Function 1, 2, …
/// HashMap iteration order is arbitrary, and the formatter lays out the casewise
/// "Discriminant Scores" columns in Vec order, so the order must be fixed here.
fn scores_in_function_order(scores: &HashMap<String, Vec<f64>>) -> Vec<ScoreValue> {
    let mut ordered: Vec<ScoreValue> = scores
        .iter()
        .map(|(function, values)| ScoreValue {
            function: function.clone(),
            values: values.clone(),
        })
        .collect();
    ordered.sort_by_key(|s| {
        s.function
            .rsplit(' ')
            .next()
            .and_then(|n| n.parse::<usize>().ok())
            .unwrap_or(usize::MAX)
    });
    ordered
}

#[derive(Serialize)]
struct FormattedScatterData {
    actual_group: Vec<String>,
    discriminant_scores: Vec<ScoreValue>,
}

#[derive(Serialize)]
struct FormattedGroupStatistics {
    groups: Vec<String>,
    variables: Vec<String>,
    means: Vec<GroupValue>,
    std_deviations: Vec<GroupValue>,
    unweighted_n: Vec<GroupValue>,
    weighted_n: Vec<GroupValue>,
}

#[derive(Serialize)]
struct GroupValue {
    variable: String,
    values: Vec<f64>,
}

#[derive(Serialize)]
struct FormattedCanonicalFunctions {
    coefficients: Vec<FunctionValue>,
    standardized_coefficients: Vec<FunctionValue>,
    function_at_centroids: Vec<GroupCentroid>,
}

#[derive(Serialize)]
struct FunctionValue {
    variable: String,
    values: Vec<f64>,
}

#[derive(Serialize)]
struct GroupCentroid {
    group: String,
    values: Vec<f64>,
}

/// Row label SPSS always prints last in the unstandardized coefficients table.
const CONSTANT_ROW: &str = "(Constant)";

/// Turn an unordered coefficient map into table rows in `order`.
///
/// The result structs store these keyed by variable name in a `HashMap`, whose
/// iteration order is arbitrary and differs between builds of the binary. Every
/// table below therefore has to impose its own order explicitly, or the rows come
/// out shuffled relative to SPSS.
///
/// Keys missing from `order` are appended afterwards — `(Constant)` last, as SPSS
/// prints it, and anything else by name so the output stays deterministic.
fn ordered_function_values(
    map: &HashMap<String, Vec<f64>>,
    order: &[String]
) -> Vec<FunctionValue> {
    let mut rows: Vec<FunctionValue> = Vec::with_capacity(map.len());

    for name in order {
        if let Some(values) = map.get(name) {
            rows.push(FunctionValue { variable: name.clone(), values: values.clone() });
        }
    }

    let mut leftover: Vec<&String> = map
        .keys()
        .filter(|k| !order.iter().any(|o| o == *k))
        .collect();
    leftover.sort_by(|a, b| {
        let key = |s: &str| (s == CONSTANT_ROW, s.to_string());
        key(a).cmp(&key(b))
    });
    for name in leftover {
        rows.push(FunctionValue { variable: name.clone(), values: map[name].clone() });
    }

    rows
}

/// Index of the function a variable correlates most strongly with, and that
/// correlation's absolute value. Mirrors the superscript the formatter puts on the
/// largest absolute correlation in each row of the Structure Matrix.
fn dominant_function(values: &[f64]) -> (usize, f64) {
    let mut index = 0;
    let mut largest = 0.0_f64;
    for (i, value) in values.iter().enumerate() {
        if value.abs() > largest {
            largest = value.abs();
            index = i;
        }
    }
    (index, largest)
}

/// Structure Matrix row order: "Variables ordered by absolute size of correlation
/// within function" — the footnote the table already prints. Variables are grouped
/// by the function they correlate most strongly with, functions in order, and within
/// each group sorted by descending absolute correlation.
fn ordered_structure_rows(
    map: &HashMap<String, Vec<f64>>,
    variables: &[String]
) -> Vec<FunctionValue> {
    // Seed from the analysis variable order so ties below break deterministically
    // (`sort_by` is stable).
    let mut rows = ordered_function_values(map, variables);
    rows.sort_by(|a, b| {
        let (fa, va) = dominant_function(&a.values);
        let (fb, vb) = dominant_function(&b.values);
        fa.cmp(&fb).then(vb.partial_cmp(&va).unwrap_or(Ordering::Equal))
    });
    rows
}

/// Group centroid rows, by group code ascending — numerically when the codes are
/// numeric (so 10 sorts after 2), otherwise as text.
fn ordered_group_centroids(map: &HashMap<String, Vec<f64>>) -> Vec<GroupCentroid> {
    let mut rows: Vec<GroupCentroid> = map
        .iter()
        .map(|(group, values)| GroupCentroid {
            group: group.clone(),
            values: values.clone(),
        })
        .collect();

    // (is_non_numeric, numeric value, text) — non-numeric codes sort after numeric ones.
    let key = |g: &str| match g.parse::<f64>() {
        Ok(n) if n.is_finite() => (0_u8, n, String::new()),
        _ => (1_u8, 0.0, g.to_string()),
    };
    rows.sort_by(|a, b| {
        let (ka, kb) = (key(&a.group), key(&b.group));
        ka.0
            .cmp(&kb.0)
            .then(ka.1.partial_cmp(&kb.1).unwrap_or(Ordering::Equal))
            .then(ka.2.cmp(&kb.2))
    });
    rows
}

#[derive(Serialize)]
struct FormattedStructureMatrix {
    variables: Vec<String>,
    correlations: Vec<FunctionValue>,
}

#[derive(Serialize)]
struct FormattedClassificationResults {
    original_classification: Vec<GroupClassification>,
    cross_validated_classification: Option<Vec<GroupClassification>>,
    original_percentage: Vec<GroupPercentage>,
    cross_validated_percentage: Option<Vec<GroupPercentage>>,
    unselected_classification: Option<Vec<GroupClassification>>,
    unselected_percentage: Option<Vec<GroupPercentage>>,
    // "Ungrouped cases" rows; counts and percentages are in group order.
    ungrouped_classification: Option<Vec<i32>>,
    ungrouped_percentage: Option<Vec<f64>>,
    unselected_ungrouped_classification: Option<Vec<i32>>,
    unselected_ungrouped_percentage: Option<Vec<f64>>,
}

#[derive(Serialize)]
struct GroupClassification {
    group: String,
    counts: Vec<i32>,
}

#[derive(Serialize)]
struct GroupPercentage {
    group: String,
    percentages: Vec<f64>,
}

#[derive(Serialize)]
struct FormattedPooledMatrices {
    variables: Vec<String>,
    covariance: Vec<MatrixEntry>,
    correlation: Vec<MatrixEntry>,
}

#[derive(Serialize)]
struct MatrixEntry {
    variable: String,
    values: Vec<ValueEntry>,
}

#[derive(Serialize)]
struct ValueEntry {
    variable: String,
    value: f64,
}

#[derive(Serialize)]
struct FormattedCovarianceMatrices {
    groups: Vec<String>,
    variables: Vec<String>,
    matrices: Vec<GroupMatrixEntry>,
    note_df: String,
}

#[derive(Serialize)]
struct GroupMatrixEntry {
    group: String,
    matrix: Vec<MatrixEntry>,
}

#[derive(Serialize)]
struct FormattedStepwiseStatistics {
    method: String,
    num_groups: usize,
    variables_entered: Vec<String>,
    variables_removed: Vec<Option<String>>,
    min_d_squared: Vec<f64>,
    between_groups: Vec<String>,
    wilks_lambda: Vec<f64>,
    f_to_enter: Vec<f64>,
    f_to_enter_df1: Vec<i32>,
    f_to_enter_df2: Vec<f64>,
    significance: Vec<f64>,
    wilks_exact_f: Vec<f64>,
    wilks_exact_df1: Vec<i32>,
    wilks_exact_df2: Vec<f64>,
    wilks_exact_sig: Vec<f64>,
    wilks_f_exact: Vec<bool>,
    raos_v: Vec<f64>,
    raos_v_sig: Vec<f64>,
    raos_v_df: Vec<f64>,
    change_in_v: Vec<f64>,
    change_sig: Vec<f64>,
    variables_in_analysis: Vec<StepVariables>,
    variables_not_in_analysis: Vec<StepVariables>,
    pairwise_comparisons: Vec<GroupPairComparison>,
    /// Footnotes of the Variables Entered/Removed table, built from the thresholds
    /// the procedure actually applied.
    note: crate::models::result::StepwiseNote,
}

#[derive(Serialize)]
struct StepVariables {
    step: String,
    variables: Vec<VariableInAnalysis>,
}

/// One row block of the Pairwise Group Comparisons table: a group at a step and its
/// F / Sig. against every other group (each comparison names the other group).
#[derive(Serialize)]
struct GroupPairComparison {
    step: String,
    group: String,
    comparisons: Vec<PairwiseComparison>,
}

#[derive(Serialize)]
struct FormattedCasewiseStatistics {
    case_number: Vec<usize>,
    actual_group: Vec<String>,
    predicted_group: Vec<String>,
    highest_group: HighestGroupStatistics,
    second_highest_group: HighestGroupStatistics,
    discriminant_scores: Vec<ScoreValue>,
    cross_validated: Option<FormattedCrossValidatedCasewiseStatistics>,
}

#[derive(Serialize)]
struct FormattedCrossValidatedCasewiseStatistics {
    case_number: Vec<usize>,
    actual_group: Vec<String>,
    predicted_group: Vec<String>,
    highest_group: HighestGroupStatistics,
    second_highest_group: HighestGroupStatistics,
    discriminant_scores: Option<Vec<ScoreValue>>,
}

#[derive(Serialize)]
struct FormattedPriorProbabilities {
    groups: Vec<String>,
    prior_probabilities: Vec<f64>,
    cases_used: Vec<GroupCases>,
    total: f64,
}

#[derive(Serialize)]
struct GroupCases {
    case_type: String,
    counts: Vec<usize>,
}

#[derive(Serialize)]
struct FormattedClassificationFunctionCoefficients {
    groups: Vec<String>,
    variables: Vec<String>,
    coefficients: Vec<GroupCoefficient>,
    constant_terms: Vec<f64>,
}

#[derive(Serialize)]
struct GroupCoefficient {
    variable: String,
    values: Vec<f64>,
}

impl FormatResult {
    fn from_analysis_result(result: &DiscriminantResult) -> Self {
        // Transform GroupStatistics
        let group_statistics = result.group_statistics.as_ref().map(|stats| {
            // Debug-build log of the raw group statistics.
            crate::debug_log!("Raw GroupStatistics - groups: {:?}", stats.groups);
            crate::debug_log!("Raw GroupStatistics - variables: {:?}", stats.variables);
            crate::debug_log!("Raw GroupStatistics - unweighted_n keys: {:?}", stats.unweighted_n.keys().collect::<Vec<_>>());
            crate::debug_log!("Raw GroupStatistics - weighted_n keys: {:?}", stats.weighted_n.keys().collect::<Vec<_>>());

            for var in &stats.variables {
                if let Some(n_values) = stats.unweighted_n.get(var) {
                    crate::debug_log!("  {} unweighted_n: {:?}", var, n_values);
                }
                if let Some(n_values) = stats.weighted_n.get(var) {
                    crate::debug_log!("  {} weighted_n: {:?}", var, n_values);
                }
            }

            // Means and standard deviations exist only with Statistics → Means; without
            // it both lists stay empty (no zeros), so the formatter leaves the Mean and
            // Std. Deviation columns out and the table shows only the Valid N counts.
            let has_means = stats.means.values().any(|values| !values.is_empty());

            let means: Vec<GroupValue> = if has_means {
                stats.variables
                    .iter()
                    .map(|var| {
                        let values = stats.groups
                            .iter()
                            .enumerate()
                            .map(|(j, _group)| {
                                stats.means.get(var)
                                    .and_then(|v| v.get(j))
                                    .copied()
                                    .unwrap_or(0.0)
                            })
                            .collect();

                        GroupValue {
                            variable: var.clone(),
                            values,
                        }
                    })
                    .collect()
            } else {
                Vec::new()
            };

            let std_deviations: Vec<GroupValue> = if has_means {
                stats.variables
                    .iter()
                    .map(|var| {
                        let values = stats.groups
                            .iter()
                            .enumerate()
                            .map(|(j, _group)| {
                                stats.std_deviations.get(var)
                                    .and_then(|v| v.get(j))
                                    .copied()
                                    .unwrap_or(0.0)
                            })
                            .collect();

                        GroupValue {
                            variable: var.clone(),
                            values,
                        }
                    })
                    .collect()
            } else {
                Vec::new()
            };

            let unweighted_n = stats.variables
                .iter()
                .map(|var| {
                    let values = stats.groups
                        .iter()
                        .enumerate()
                        .map(|(j, _group)| {
                            stats.unweighted_n.get(var)
                                .and_then(|v| v.get(j))
                                .copied()
                                .unwrap_or(0.0)
                        })
                        .collect();

                    GroupValue {
                        variable: var.clone(),
                        values,
                    }
                })
                .collect();

            let weighted_n = stats.variables
                .iter()
                .map(|var| {
                    let values = stats.groups
                        .iter()
                        .enumerate()
                        .map(|(j, _group)| {
                            stats.weighted_n.get(var)
                                .and_then(|v| v.get(j))
                                .copied()
                                .unwrap_or(0.0)
                        })
                        .collect();

                    GroupValue {
                        variable: var.clone(),
                        values,
                    }
                })
                .collect();

            FormattedGroupStatistics {
                groups: stats.groups.clone(),
                variables: stats.variables.clone(),
                means,
                std_deviations,
                unweighted_n,
                weighted_n,
            }
        });

        // Transform CanonicalFunctions.
        // Both coefficient tables follow the analysis variable order, with
        // "(Constant)" last in the unstandardized one; centroids follow group code.
        let canonical_functions = result.canonical_functions.as_ref().map(|funcs| {
            FormattedCanonicalFunctions {
                coefficients: ordered_function_values(&funcs.coefficients, &funcs.variables),
                standardized_coefficients: ordered_function_values(
                    &funcs.standardized_coefficients,
                    &funcs.variables
                ),
                function_at_centroids: ordered_group_centroids(&funcs.function_at_centroids),
            }
        });

        // Transform StructureMatrix
        let structure_matrix = result.structure_matrix.as_ref().map(|matrix| {
            FormattedStructureMatrix {
                variables: matrix.variables.clone(),
                correlations: ordered_structure_rows(&matrix.correlations, &matrix.variables),
            }
        });

        // Transform ClassificationResults
        let classification_results = result.classification_results.as_ref().map(|results| {
            let original_classification = results.original_classification
                .iter()
                .map(|(group, counts)| {
                    GroupClassification {
                        group: group.clone(),
                        counts: counts.clone(),
                    }
                })
                .collect();

            let cross_validated_classification = results.cross_validated_classification
                .as_ref()
                .map(|cross_val| {
                    cross_val
                        .iter()
                        .map(|(group, counts)| {
                            GroupClassification {
                                group: group.clone(),
                                counts: counts.clone(),
                            }
                        })
                        .collect()
                });

            let original_percentage = results.original_percentage
                .iter()
                .map(|(group, percentages)| {
                    GroupPercentage {
                        group: group.clone(),
                        percentages: percentages.clone(),
                    }
                })
                .collect();

            let cross_validated_percentage = results.cross_validated_percentage
                .as_ref()
                .map(|cross_val| {
                    cross_val
                        .iter()
                        .map(|(group, percentages)| {
                            GroupPercentage {
                                group: group.clone(),
                                percentages: percentages.clone(),
                            }
                        })
                        .collect()
                });

            let unselected_classification = results.unselected_classification
                .as_ref()
                .map(|unselected| {
                    unselected
                        .iter()
                        .map(|(group, counts)| GroupClassification {
                            group: group.clone(),
                            counts: counts.clone(),
                        })
                        .collect()
                });

            let unselected_percentage = results.unselected_percentage
                .as_ref()
                .map(|unselected| {
                    unselected
                        .iter()
                        .map(|(group, percentages)| GroupPercentage {
                            group: group.clone(),
                            percentages: percentages.clone(),
                        })
                        .collect()
                });

            FormattedClassificationResults {
                original_classification,
                cross_validated_classification,
                original_percentage,
                cross_validated_percentage,
                unselected_classification,
                unselected_percentage,
                ungrouped_classification: results.ungrouped_classification.clone(),
                ungrouped_percentage: results.ungrouped_percentage.clone(),
                unselected_ungrouped_classification: results.unselected_ungrouped_classification.clone(),
                unselected_ungrouped_percentage: results.unselected_ungrouped_percentage.clone(),
            }
        });

        // Transform PooledMatrices
        let pooled_matrices = result.pooled_matrices.as_ref().map(|matrices| {
            let covariance = matrices.variables
                .iter()
                .map(|var| {
                    let values = matrices.variables
                        .iter()
                        .map(|other_var| {
                            let value = matrices.covariance
                                .get(var)
                                .and_then(|row| row.get(other_var))
                                .cloned()
                                .unwrap_or(0.0);

                            ValueEntry {
                                variable: other_var.clone(),
                                value,
                            }
                        })
                        .collect();

                    MatrixEntry {
                        variable: var.clone(),
                        values,
                    }
                })
                .collect();

            let correlation = matrices.variables
                .iter()
                .map(|var| {
                    let values = matrices.variables
                        .iter()
                        .map(|other_var| {
                            let value = matrices.correlation
                                .get(var)
                                .and_then(|row| row.get(other_var))
                                .cloned()
                                .unwrap_or(0.0);

                            ValueEntry {
                                variable: other_var.clone(),
                                value,
                            }
                        })
                        .collect();

                    MatrixEntry {
                        variable: var.clone(),
                        values,
                    }
                })
                .collect();

            FormattedPooledMatrices {
                variables: matrices.variables.clone(),
                covariance,
                correlation,
            }
        });

        // Transform CovarianceMatrices
        let covariance_matrices = result.covariance_matrices.as_ref().map(|matrices| {
            let matrices_entries = matrices.groups
                .iter()
                .map(|group| {
                    let matrix = matrices.variables
                        .iter()
                        .map(|var| {
                            let values = matrices.variables
                                .iter()
                                .map(|other_var| {
                                    let value = matrices.matrices
                                        .get(group)
                                        .and_then(|group_matrix| group_matrix.get(var))
                                        .and_then(|row| row.get(other_var))
                                        .cloned()
                                        .unwrap_or(0.0);

                                    ValueEntry {
                                        variable: other_var.clone(),
                                        value,
                                    }
                                })
                                .collect();

                            MatrixEntry {
                                variable: var.clone(),
                                values,
                            }
                        })
                        .collect();

                    GroupMatrixEntry {
                        group: group.clone(),
                        matrix,
                    }
                })
                .collect();

            FormattedCovarianceMatrices {
                groups: matrices.groups.clone(),
                variables: matrices.variables.clone(),
                matrices: matrices_entries,
                note_df: matrices.note_df.clone(),
            }
        });

        // Transform StepwiseStatistics
        let stepwise_statistics = result.stepwise_statistics.as_ref().map(|stats| {
            let variables_in_analysis = stats.variables_in_analysis
                .iter()
                .map(|(step, vars)| {
                    StepVariables {
                        step: step.clone(),
                        variables: vars.clone(),
                    }
                })
                .collect();

            let variables_not_in_analysis = stats.variables_not_in_analysis
                .iter()
                .map(|(step, vars)| {
                    StepVariables {
                        step: step.clone(),
                        variables: vars
                            .iter()
                            .map(|v| {
                                // Rows of Variables Not in the Analysis share the output shape of
                                // Variables in the Analysis; their F to Enter fills both F fields.
                                VariableInAnalysis {
                                    variable: v.variable.clone(),
                                    tolerance: v.tolerance,
                                    min_tolerance: v.min_tolerance,
                                    f_to_enter: v.f_to_enter,
                                    f_to_remove: v.f_to_enter,
                                    wilks_lambda: v.wilks_lambda,
                                    min_d_squared: v.min_d_squared,
                                    between_groups: v.between_groups.clone(),
                                }
                            })
                            .collect(),
                    }
                })
                .collect();

            // One entry per (step, group), ordered by step then group. Both levels come
            // from HashMaps with arbitrary iteration order, so sort explicitly.
            let mut pairwise_comparisons: Vec<GroupPairComparison> = stats.pairwise_comparisons
                .iter()
                .flat_map(|(step, group_comps)| {
                    group_comps.iter().map(move |(group, comps)| GroupPairComparison {
                        step: step.clone(),
                        group: group.clone(),
                        comparisons: comps.clone(),
                    })
                })
                .collect();
            pairwise_comparisons.sort_by(|a, b| {
                let step_a = a.step.parse::<i32>().unwrap_or(i32::MAX);
                let step_b = b.step.parse::<i32>().unwrap_or(i32::MAX);
                step_a.cmp(&step_b).then_with(|| a.group.cmp(&b.group))
            });

            FormattedStepwiseStatistics {
                method: stats.method.clone(),
                num_groups: stats.num_groups,
                variables_entered: stats.variables_entered.clone(),
                variables_removed: stats.variables_removed.clone(),
                min_d_squared: stats.min_d_squared.clone(),
                between_groups: stats.between_groups.clone(),
                wilks_lambda: stats.wilks_lambda.clone(),
                f_to_enter: stats.f_to_enter.clone(),
                f_to_enter_df1: stats.f_to_enter_df1.clone(),
                f_to_enter_df2: stats.f_to_enter_df2.clone(),
                significance: stats.significance.clone(),
                wilks_exact_f: stats.wilks_exact_f.clone(),
                wilks_exact_df1: stats.wilks_exact_df1.clone(),
                wilks_exact_df2: stats.wilks_exact_df2.clone(),
                wilks_exact_sig: stats.wilks_exact_sig.clone(),
                wilks_f_exact: stats.wilks_f_exact.clone(),
                raos_v: stats.raos_v.clone(),
                raos_v_sig: stats.raos_v_sig.clone(),
                raos_v_df: stats.raos_v_df.clone(),
                change_in_v: stats.change_in_v.clone(),
                change_sig: stats.change_sig.clone(),
                variables_in_analysis,
                variables_not_in_analysis,
                pairwise_comparisons,
                note: stats.note.clone(),
            }
        });

        // Transform CasewiseStatistics
        let casewise_statistics = result.casewise_statistics.as_ref().map(|stats| {
            let discriminant_scores = scores_in_function_order(&stats.discriminant_scores);

            // Transform cross-validated casewise statistics if present
            let cross_validated = stats.cross_validated.as_ref().map(|cv| {
                FormattedCrossValidatedCasewiseStatistics {
                    case_number: cv.case_number.clone(),
                    actual_group: cv.actual_group.clone(),
                    predicted_group: cv.predicted_group.clone(),
                    highest_group: cv.highest_group.clone(),
                    second_highest_group: cv.second_highest_group.clone(),
                    discriminant_scores: None, // Always None; SPSS leaves this blank
                }
            });

            FormattedCasewiseStatistics {
                case_number: stats.case_number.clone(),
                actual_group: stats.actual_group.clone(),
                predicted_group: stats.predicted_group.clone(),
                highest_group: stats.highest_group.clone(),
                second_highest_group: stats.second_highest_group.clone(),
                discriminant_scores,
                cross_validated,
            }
        });

        // Transform PriorProbabilities
        let prior_probabilities = result.prior_probabilities.as_ref().map(|probs| {
            let cases_used = probs.cases_used
                .iter()
                .map(|(case_type, counts)| {
                    GroupCases {
                        case_type: case_type.clone(),
                        counts: counts.clone(),
                    }
                })
                .collect();

            FormattedPriorProbabilities {
                groups: probs.groups.clone(),
                prior_probabilities: probs.prior_probabilities.clone(),
                cases_used,
                total: probs.total,
            }
        });

        // Transform ClassificationFunctionCoefficients
        let classification_function_coefficients = result.classification_function_coefficients
            .as_ref()
            .map(|coeffs| {
                let coefficients = coeffs.variables
                    .iter()
                    .map(|var| {
                        let values = coeffs.coefficients.get(var).cloned().unwrap_or_default();

                        GroupCoefficient {
                            variable: var.clone(),
                            values,
                        }
                    })
                    .collect();

                FormattedClassificationFunctionCoefficients {
                    groups: coeffs.groups.clone(),
                    variables: coeffs.variables.clone(),
                    coefficients,
                    constant_terms: coeffs.constant_terms.clone(),
                }
            });

        // Transform ScatterData
        let scatter_data = result.scatter_data.as_ref().map(|sd| {
            let discriminant_scores = scores_in_function_order(&sd.discriminant_scores);
            FormattedScatterData {
                actual_group: sd.actual_group.clone(),
                discriminant_scores,
            }
        });

        FormatResult {
            processing_summary: Some(result.processing_summary.clone()),
            group_statistics,
            equality_tests: result.equality_tests.clone(),
            canonical_functions,
            structure_matrix,
            classification_results,
            box_m_test: result.box_m_test.clone(),
            pooled_matrices,
            covariance_matrices,
            log_determinants: result.log_determinants.clone(),
            eigen_description: result.eigen_description.clone(),
            stepwise_statistics,
            wilks_lambda_test: result.wilks_lambda_test.clone(),
            casewise_statistics,
            prior_probabilities,
            classification_function_coefficients,
            scatter_data,
            bootstrap_results: result.bootstrap_results.clone(),
            assumption_results: result.assumption_results.clone(),
            territorial_map: result.territorial_map,
            combined_groups_plot: result.combined_groups_plot,
            separate_groups_plot: result.separate_groups_plot,
            unstandardized_coefficients: result.unstandardized_coefficients,
            separate_groups_classification: result.separate_groups_classification.clone(),
        }
    }
}
