use serde::{ Deserialize, Serialize };
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiscriminantResult {
    #[serde(rename = "processing_summary")]
    pub processing_summary: ProcessingSummary,
    #[serde(rename = "group_statistics")]
    pub group_statistics: Option<GroupStatistics>,
    #[serde(rename = "equality_tests")]
    pub equality_tests: Option<EqualityTests>,
    #[serde(rename = "canonical_functions")]
    pub canonical_functions: Option<CanonicalFunctions>,
    #[serde(rename = "structure_matrix")]
    pub structure_matrix: Option<StructureMatrix>,
    #[serde(rename = "classification_results")]
    pub classification_results: Option<ClassificationResults>,
    #[serde(rename = "box_m_test")]
    pub box_m_test: Option<BoxMTest>,
    #[serde(rename = "pooled_matrices")]
    pub pooled_matrices: Option<PooledMatrices>,
    #[serde(rename = "covariance_matrices")]
    pub covariance_matrices: Option<CovarianceMatrices>,
    #[serde(rename = "log_determinants")]
    pub log_determinants: Option<LogDeterminants>,
    #[serde(rename = "eigen_description")]
    pub eigen_description: Option<EigenDescription>,
    #[serde(rename = "stepwise_statistics")]
    pub stepwise_statistics: Option<StepwiseStatistics>,
    #[serde(rename = "wilks_lambda_test")]
    pub wilks_lambda_test: Option<WilksLambdaTest>,
    #[serde(rename = "casewise_statistics")]
    pub casewise_statistics: Option<CasewiseStatistics>,
    #[serde(rename = "prior_probabilities")]
    pub prior_probabilities: Option<PriorProbabilities>,
    #[serde(rename = "classification_function_coefficients")]
    pub classification_function_coefficients: Option<ClassificationFunctionCoefficients>,
    /// Per-case discriminant scores of every classified case for the Combined-/
    /// Separate-groups plots. Populated whenever combine || sep_grp.
    #[serde(rename = "scatter_data")]
    pub scatter_data: Option<ScatterData>,
    /// Bootstrap results (bias, std. error, confidence intervals) for the
    /// standardized canonical discriminant function coefficients. Populated only
    /// when bootstrap.perform_boot_strapping is requested.
    #[serde(rename = "bootstrap_results")]
    pub bootstrap_results: Option<BootstrapResults>,
    /// Pre-results assumption checks (multicollinearity, multivariate &
    /// univariate normality). Populated only when at least one
    /// assumption check is requested in the Assumptions dialog.
    #[serde(rename = "assumption_results")]
    pub assumption_results: Option<AssumptionResults>,
    /// True when the Territorial Map plot was requested (Classify → Plots).
    /// The map itself is built on the frontend from the group centroids.
    #[serde(rename = "territorial_map")]
    pub territorial_map: bool,
    /// True when the Combined-Groups plot was requested (Classify → Plots).
    #[serde(rename = "combined_groups_plot")]
    pub combined_groups_plot: bool,
    /// True when the Separate-Groups plots were requested (Classify → Plots).
    #[serde(rename = "separate_groups_plot")]
    pub separate_groups_plot: bool,
    /// True when Statistics → Function Coefficients → Unstandardized was checked.
    /// The unstandardized coefficients are always computed (scores, centroids, Save
    /// and the XML export need them); this only decides whether the Canonical
    /// Discriminant Function Coefficients table is shown, as in SPSS (/STATISTICS=RAW).
    #[serde(rename = "unstandardized_coefficients")]
    pub unstandardized_coefficients: bool,
    /// Classify → Use Covariance Matrix → Separate-groups. Populated only for that
    /// option; its presence tells the frontend (Save, territorial map) to classify
    /// with the per-group matrices instead of the pooled one.
    #[serde(rename = "separate_groups_classification")]
    pub separate_groups_classification: Option<SeparateGroupsClassification>,
}

/// Separate-groups classification (SPSS /CLASSIFY=SEPARATE): each group's covariance
/// matrix of the canonical discriminant functions, which classifies the cases, and
/// Box's test of those matrices — both of which SPSS displays for this option.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SeparateGroupsClassification {
    /// Function labels ("1", "2", …) in matrix column order.
    pub functions: Vec<String>,
    /// One entry per group, in analysis group order.
    pub groups: Vec<GroupFunctionCovariance>,
    /// Log determinants of the group covariance matrices of the functions.
    #[serde(rename = "log_determinants")]
    pub log_determinants: LogDeterminants,
    /// Box's M on those matrices; `None` when it cannot be computed (a warning says why).
    #[serde(rename = "box_m_test")]
    pub box_m_test: Option<BoxMTest>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GroupFunctionCovariance {
    pub group: String,
    /// Analysis cases in the group (the matrix is estimated from these only).
    pub n: usize,
    /// Σⱼ: covariance matrix of the discriminant scores, m × m, one Vec per row.
    pub covariance: Vec<Vec<f64>>,
    /// Inverse of Σⱼ* (the functions kept by SPSS's pseudo-inverse rule), padded to
    /// m × m with zeros for the functions left out.
    pub inverse: Vec<Vec<f64>>,
    /// ln|Σⱼ*|.
    #[serde(rename = "log_determinant")]
    pub log_determinant: f64,
    /// Number of functions kept in Σⱼ* — the df of the case's chi-square distance.
    pub rank: usize,
}

/// Bundle of all requested assumption checks plus an at-a-glance summary used to
/// surface PASS/VIOLATED warnings at the top of the output.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AssumptionResults {
    /// One row per checked assumption: name, test used, finding, and verdict.
    pub summary: Vec<AssumptionSummaryRow>,
    pub multicollinearity: Option<MulticollinearityResult>,
    #[serde(rename = "multivariate_normality")]
    pub multivariate_normality: Option<HenzeZirklerResult>,
    #[serde(rename = "univariate_normality")]
    pub univariate_normality: Option<UnivariateNormalityResult>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AssumptionSummaryRow {
    pub assumption: String,
    pub test: String,
    pub finding: String,
    /// "Met" | "Violated" | "Inconclusive"
    pub status: String,
    pub violated: bool,
}

/// Tolerance/VIF per predictor (from the inverse pooled within-groups
/// correlation matrix) plus condition indices from its eigenvalues.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MulticollinearityResult {
    pub variables: Vec<String>,
    pub tolerance: Vec<f64>,
    pub vif: Vec<f64>,
    pub dimension: Vec<i32>,
    pub eigenvalue: Vec<f64>,
    #[serde(rename = "condition_index")]
    pub condition_index: Vec<f64>,
    #[serde(rename = "max_vif")]
    pub max_vif: f64,
    #[serde(rename = "max_condition_index")]
    pub max_condition_index: f64,
    #[serde(rename = "vif_threshold")]
    pub vif_threshold: f64,
    #[serde(rename = "condition_threshold")]
    pub condition_threshold: f64,
    pub violated: bool,
    pub note: String,
}

// INACTIVE — result shape of the former full-dataset (pooled) Henze–Zirkler test.
/*
/// Henze–Zirkler multivariate normality test computed on the full dataset
/// (all cases pooled, grouping variable excluded), matching R's `MVN::mvn`.
/// The HZ statistic is approximately lognormal under H0; `p_value` is its upper
/// tail.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HenzeZirklerResult {
    /// Cases used (total across all groups).
    pub n: i32,
    /// Henze–Zirkler statistic.
    pub hz: f64,
    #[serde(rename = "p_value")]
    pub p_value: f64,
    /// Verdict: p-value above the normality α (not significant).
    pub normal: bool,
    pub violated: bool,
    pub note: String,
}
*/

/// Henze–Zirkler multivariate normality test run within each group (grouping
/// variable excluded); every vector has one entry per group, in group order.
/// The HZ statistic is approximately lognormal under H0; `p_value` is its upper
/// tail. A group with n ≤ p is not tested (`tested` = false).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HenzeZirklerResult {
    pub groups: Vec<String>,
    /// Cases used in each group.
    pub n: Vec<i32>,
    /// Henze–Zirkler statistic per group (0 when not tested).
    pub hz: Vec<f64>,
    #[serde(rename = "p_value")]
    pub p_value: Vec<f64>,
    /// Verdict per group: p-value above the normality α (not significant).
    pub normal: Vec<bool>,
    /// False when the group could not be tested (too few cases for p predictors).
    pub tested: Vec<bool>,
    /// True when any tested group rejects multivariate normality.
    pub violated: bool,
    pub note: String,
}

/// Anderson–Darling univariate normality test per predictor within each group
/// (`nortest::ad.test` on each group's cases). One entry per tested
/// group × predictor pair; `groups` and `variables` are parallel.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UnivariateNormalityResult {
    pub groups: Vec<String>,
    pub variables: Vec<String>,
    /// Anderson–Darling A² statistic per variable.
    pub statistic: Vec<f64>,
    #[serde(rename = "p_value")]
    pub p_value: Vec<f64>,
    pub normal: Vec<bool>,
    pub violated: bool,
    pub note: String,
}

/// Bootstrap results for the standardized canonical discriminant function
/// coefficients: for each predictor, per-function Original / Bias / Std. Error /
/// CI bounds across `num_samples` resamples.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BootstrapResults {
    #[serde(rename = "num_samples")]
    pub num_samples: i32,
    /// Resamples that were actually fitted. Lower than `num_samples` when a
    /// resample lost a group or could not be fitted.
    #[serde(rename = "valid_samples")]
    pub valid_samples: i32,
    /// Fitted resamples whose functions came out in a different order than the
    /// original solution and were matched back to it.
    #[serde(rename = "reordered_samples", default)]
    pub reordered_samples: i32,
    pub level: f64,
    /// "Percentile" or "BCa"
    #[serde(rename = "ci_method")]
    pub ci_method: String,
    /// "Simple" or "Stratified"
    pub sampling: String,
    /// Variables that define the strata under stratified sampling. Empty when
    /// the strata are the groups of the grouping variable.
    #[serde(rename = "strata_variables")]
    pub strata_variables: Vec<String>,
    pub functions: Vec<String>,
    pub variables: Vec<String>,
    pub standardized: Vec<BootstrapCoefficient>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BootstrapCoefficient {
    pub variable: String,
    pub original: Vec<f64>,
    pub bias: Vec<f64>,
    #[serde(rename = "std_error")]
    pub std_error: Vec<f64>,
    #[serde(rename = "ci_lower")]
    pub ci_lower: Vec<f64>,
    #[serde(rename = "ci_upper")]
    pub ci_upper: Vec<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProcessingSummary {
    #[serde(rename = "valid_count")]
    pub valid_cases: usize,
    #[serde(rename = "excluded_count")]
    pub excluded_cases: usize,
    #[serde(rename = "total_count")]
    pub total_cases: usize,
    #[serde(rename = "valid_percent")]
    pub valid_percent: Option<f64>,
    #[serde(rename = "missing_group_codes")]
    pub missing_group_codes: Option<usize>,
    #[serde(rename = "missing_group_percent")]
    pub missing_group_percent: Option<f64>,
    #[serde(rename = "missing_disc_vars")]
    pub missing_disc_vars: Option<usize>,
    #[serde(rename = "missing_disc_percent")]
    pub missing_disc_percent: Option<f64>,
    #[serde(rename = "both_missing")]
    pub both_missing: Option<usize>,
    #[serde(rename = "both_missing_percent")]
    pub both_missing_percent: Option<f64>,
    #[serde(rename = "total_excluded_percent")]
    pub total_excluded_percent: Option<f64>,
    /// Cases left out by the selection variable (only selected cases enter the
    /// analysis). Counted before any missing-value category.
    #[serde(rename = "unselected", default)]
    pub unselected: Option<usize>,
    #[serde(rename = "unselected_percent", default)]
    pub unselected_percent: Option<f64>,
    /// Classification Processing Summary: cases processed for classification (every
    /// case; unselected cases are classified too, as the testing part of a split).
    #[serde(rename = "classification_processed", default)]
    pub classification_processed: Option<usize>,
    /// Classification Processing Summary: cases excluded for a missing or out-of-range
    /// group code. Always 0: such cases are classified as ungrouped cases, as SPSS does.
    #[serde(rename = "classification_missing_group_codes", default)]
    pub classification_missing_group_codes: Option<usize>,
    /// Classification Processing Summary: cases excluded for a missing predictor.
    /// 0 when "Replace missing values with mean" is on, because those cases are still
    /// classified with the predictor means substituted.
    #[serde(rename = "classification_missing_disc_vars")]
    pub classification_missing_disc_vars: Option<usize>,
    /// Classification Processing Summary: cases used in the classification output.
    #[serde(rename = "classification_used_count")]
    pub classification_used_cases: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GroupStatistics {
    pub groups: Vec<String>,
    pub variables: Vec<String>,
    pub means: HashMap<String, Vec<f64>>,
    #[serde(rename = "std_deviations")]
    pub std_deviations: HashMap<String, Vec<f64>>,
    pub unweighted_n: HashMap<String, Vec<f64>>,
    pub weighted_n: HashMap<String, Vec<f64>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EqualityTests {
    pub variables: Vec<String>,
    #[serde(rename = "wilks_lambda")]
    pub wilks_lambda: Vec<f64>,
    #[serde(rename = "f_values")]
    pub f_values: Vec<f64>,
    pub df1: Vec<i32>,
    pub df2: Vec<i32>,
    pub significance: Vec<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EigenDescription {
    #[serde(rename = "functions")]
    pub functions: Vec<String>,
    #[serde(rename = "eigenvalue")]
    pub eigenvalue: Vec<f64>,
    #[serde(rename = "eigenvector")]
    pub eigenvector: Vec<f64>,
    #[serde(rename = "variance_percentage")]
    pub variance_percentage: Vec<f64>,
    #[serde(rename = "cumulative_percentage")]
    pub cumulative_percentage: Vec<f64>,
    #[serde(rename = "canonical_correlation")]
    pub canonical_correlation: Vec<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CanonicalFunctions {
    /// Variables in the model, in analysis order. The coefficient maps below are
    /// unordered, so this is what fixes the row order of the output tables to match
    /// SPSS. Defaulted so older serialised results still deserialise.
    #[serde(default)]
    pub variables: Vec<String>,
    pub coefficients: HashMap<String, Vec<f64>>,
    #[serde(rename = "standardized_coefficients")]
    pub standardized_coefficients: HashMap<String, Vec<f64>>,
    #[serde(rename = "function_at_centroids")]
    pub function_at_centroids: HashMap<String, Vec<f64>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StructureMatrix {
    pub variables: Vec<String>,
    pub correlations: HashMap<String, Vec<f64>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ClassificationResults {
    #[serde(rename = "original_classification")]
    pub original_classification: HashMap<String, Vec<i32>>,
    #[serde(rename = "cross_validated_classification")]
    pub cross_validated_classification: Option<HashMap<String, Vec<i32>>>,
    #[serde(rename = "original_percentage")]
    pub original_percentage: HashMap<String, Vec<f64>>,
    #[serde(rename = "cross_validated_percentage")]
    pub cross_validated_percentage: Option<HashMap<String, Vec<f64>>>,
    /// Cases the selection variable leaves out (the testing part of a split),
    /// classified with the functions from the selected cases. `None` when no
    /// selection variable is in use or no unselected case could be classified.
    #[serde(rename = "unselected_classification", default)]
    pub unselected_classification: Option<HashMap<String, Vec<i32>>>,
    #[serde(rename = "unselected_percentage", default)]
    pub unselected_percentage: Option<HashMap<String, Vec<f64>>>,
    /// "Ungrouped cases" row of the (selected) Original block: predicted-group counts
    /// of the cases with a missing or out-of-range group code, in group order. `None`
    /// when there is no such case.
    #[serde(rename = "ungrouped_classification", default)]
    pub ungrouped_classification: Option<Vec<i32>>,
    #[serde(rename = "ungrouped_percentage", default)]
    pub ungrouped_percentage: Option<Vec<f64>>,
    /// The same row of the "Cases Not Selected" block.
    #[serde(rename = "unselected_ungrouped_classification", default)]
    pub unselected_ungrouped_classification: Option<Vec<i32>>,
    #[serde(rename = "unselected_ungrouped_percentage", default)]
    pub unselected_ungrouped_percentage: Option<Vec<f64>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BoxMTest {
    #[serde(rename = "box_m")]
    pub box_m: f64,
    #[serde(rename = "f_approx")]
    pub f_approx: f64,
    pub df1: f64,
    pub df2: f64,
    #[serde(rename = "p_value")]
    pub p_value: f64,
    pub note: String,
    // Intermediate values of the computation; not sent to the frontend.
    #[serde(skip_serializing)]
    pub debug_p: usize,
    #[serde(skip_serializing)]
    pub debug_k: usize,
    #[serde(skip_serializing)]
    pub debug_c1: f64,
    #[serde(skip_serializing)]
    pub debug_c2: f64,
    #[serde(skip_serializing)]
    pub debug_b: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PooledMatrices {
    pub variables: Vec<String>,
    #[serde(rename = "covariance")]
    pub covariance: HashMap<String, HashMap<String, f64>>,
    #[serde(rename = "correlation")]
    pub correlation: HashMap<String, HashMap<String, f64>>,
    #[serde(rename = "note_df")]
    pub note_df: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CovarianceMatrices {
    pub groups: Vec<String>,
    pub variables: Vec<String>,
    #[serde(rename = "matrices")]
    pub matrices: HashMap<String, HashMap<String, HashMap<String, f64>>>,
    #[serde(rename = "note_df")]
    pub note_df: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LogDeterminants {
    pub groups: Vec<String>,
    pub ranks: Vec<i32>,
    #[serde(rename = "log_determinants")]
    pub log_determinants: Vec<f64>,
    #[serde(rename = "rank_pooled")]
    pub rank_pooled: i32,
    #[serde(rename = "pooled_log_determinant")]
    pub pooled_log_determinant: f64,
    pub note: String,
    // Intermediate values of the computation; not sent to the frontend.
    #[serde(skip_serializing)]
    pub debug_variables: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StepwiseStatistics {
    /// Which method was used: "wilks", "unexplained", "mahalanobis", "f_ratio", "raos_v"
    pub method: String,
    /// Number of groups (k)
    #[serde(rename = "num_groups")]
    pub num_groups: usize,
    #[serde(rename = "variables_entered")]
    pub variables_entered: Vec<String>,
    #[serde(rename = "variables_removed")]
    pub variables_removed: Vec<Option<String>>,
    #[serde(rename = "min_d_squared")]
    pub min_d_squared: Vec<f64>,
    /// Per-step "Between Groups" pair (Mahalanobis & Smallest F methods)
    #[serde(rename = "between_groups")]
    pub between_groups: Vec<String>,
    #[serde(rename = "wilks_lambda")]
    pub wilks_lambda: Vec<f64>,
    #[serde(rename = "f_to_enter")]
    pub f_to_enter: Vec<f64>,
    #[serde(rename = "f_to_enter_df1")]
    pub f_to_enter_df1: Vec<i32>,
    /// f64: for the Wilks' Lambda method this is Rao's F df2, fractional when the
    /// F is approximate.
    #[serde(rename = "f_to_enter_df2")]
    pub f_to_enter_df2: Vec<f64>,
    #[serde(rename = "significance")]
    pub significance: Vec<f64>,
    /// Model's Wilks F (Rao's F) per step — for the Wilks' Lambda summary table
    #[serde(rename = "wilks_exact_f")]
    pub wilks_exact_f: Vec<f64>,
    #[serde(rename = "wilks_exact_df1")]
    pub wilks_exact_df1: Vec<i32>,
    /// Rao's F df2, kept fractional (not truncated) when the F is approximate.
    #[serde(rename = "wilks_exact_df2")]
    pub wilks_exact_df2: Vec<f64>,
    #[serde(rename = "wilks_exact_sig")]
    pub wilks_exact_sig: Vec<f64>,
    /// Whether Rao's F is exact at this step (min(p, g − 1) ≤ 2). When false the
    /// output heads it "Approximate F", as SPSS does.
    #[serde(rename = "wilks_f_exact", default)]
    pub wilks_f_exact: Vec<bool>,
    /// Rao's V cumulative statistic (for Rao's V method)
    #[serde(rename = "raos_v")]
    pub raos_v: Vec<f64>,
    /// Chi-squared approx. significance of cumulative Rao's V (for Rao's V method)
    #[serde(rename = "raos_v_sig")]
    pub raos_v_sig: Vec<f64>,
    /// df of that chi-square: (variables in the model after the step) × (k − 1)
    #[serde(rename = "raos_v_df", default)]
    pub raos_v_df: Vec<f64>,
    /// Change in V (ΔV) between steps (for Rao's V method)
    #[serde(rename = "change_in_v")]
    pub change_in_v: Vec<f64>,
    /// Approximate significance of change in V (for Rao's V method)
    #[serde(rename = "change_sig")]
    pub change_sig: Vec<f64>,
    #[serde(rename = "variables_in_analysis")]
    pub variables_in_analysis: HashMap<String, Vec<VariableInAnalysis>>,
    #[serde(rename = "variables_not_in_analysis")]
    pub variables_not_in_analysis: HashMap<String, Vec<VariableNotInAnalysis>>,
    #[serde(rename = "pairwise_comparisons")]
    pub pairwise_comparisons: HashMap<String, HashMap<String, Vec<PairwiseComparison>>>,
    pub note: StepwiseNote,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StepwiseNote {
    pub max_steps: String,
    pub min_f_to_enter: String,
    pub max_f_to_remove: String,
    /// "Minimum Rao's V to enter is …" — empty for every method except Rao's V.
    pub min_v_to_enter: String,
    pub note: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VariableInAnalysis {
    pub variable: String,
    pub tolerance: f64,
    #[serde(rename = "min_tolerance")]
    pub min_tolerance: f64,
    #[serde(rename = "f_to_remove")]
    pub f_to_remove: f64,
    #[serde(rename = "f_to_enter")]
    pub f_to_enter: f64,
    #[serde(rename = "wilks_lambda")]
    pub wilks_lambda: f64,
    /// Min D Squared for Mahalanobis method (0.0 for other methods)
    pub min_d_squared: f64,
    /// Between Groups label for Mahalanobis method (e.g. "1 and 2")
    pub between_groups: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VariableNotInAnalysis {
    pub variable: String,
    pub tolerance: f64,
    #[serde(rename = "min_tolerance")]
    pub min_tolerance: f64,
    #[serde(rename = "f_to_enter")]
    pub f_to_enter: f64,
    #[serde(rename = "wilks_lambda")]
    pub wilks_lambda: f64,
    /// Min D Squared for Mahalanobis method (0.0 for other methods)
    pub min_d_squared: f64,
    /// Between Groups label for Mahalanobis method (e.g. "1 and 2")
    pub between_groups: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PairwiseComparison {
    pub step: i32,
    pub group_name: String,
    pub f_value: f64,
    pub significance: f64,
    /// Numerator degrees of freedom of F: p, the number of variables in the model.
    pub df1: i32,
    /// Denominator degrees of freedom of F: n − g − p + 1.
    pub df2: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WilksLambdaTest {
    #[serde(rename = "test_of_functions")]
    pub test_of_functions: Vec<String>,
    #[serde(rename = "wilks_lambda")]
    pub wilks_lambda: Vec<f64>,
    #[serde(rename = "chi_square")]
    pub chi_square: Vec<f64>,
    pub df: Vec<i32>,
    pub significance: Vec<f64>,
}

/// Cross-validated casewise statistics (leave-one-out classification)
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CrossValidatedCasewiseStatistics {
    #[serde(rename = "case_number")]
    pub case_number: Vec<usize>,
    #[serde(rename = "actual_group")]
    pub actual_group: Vec<String>,
    #[serde(rename = "predicted_group")]
    pub predicted_group: Vec<String>,
    #[serde(rename = "highest_group")]
    pub highest_group: HighestGroupStatistics,
    #[serde(rename = "second_highest_group")]
    pub second_highest_group: HighestGroupStatistics,
    /// No discriminant scores for cross-validated (SPSS shows blank)
    #[serde(rename = "discriminant_scores")]
    pub discriminant_scores: Option<Vec<ScoreValue>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScoreValue {
    pub function: String,
    pub values: Vec<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CasewiseStatistics {
    #[serde(rename = "case_number")]
    pub case_number: Vec<usize>,
    #[serde(rename = "actual_group")]
    pub actual_group: Vec<String>,
    #[serde(rename = "predicted_group")]
    pub predicted_group: Vec<String>,
    #[serde(rename = "highest_group")]
    pub highest_group: HighestGroupStatistics,
    #[serde(rename = "second_highest_group")]
    pub second_highest_group: HighestGroupStatistics,
    #[serde(rename = "discriminant_scores")]
    pub discriminant_scores: HashMap<String, Vec<f64>>,
    /// Cross-validated (leave-one-out) casewise statistics
    /// Only present when config.classify.leave is true
    #[serde(rename = "cross_validated")]
    pub cross_validated: Option<CrossValidatedCasewiseStatistics>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HighestGroupStatistics {
    #[serde(rename = "p_value")]
    pub p_value: Vec<f64>,
    pub df: Vec<usize>,
    #[serde(rename = "p_g_equals_d")]
    pub p_g_equals_d: Vec<f64>,
    #[serde(rename = "squared_mahalanobis_distance")]
    pub squared_mahalanobis_distance: Vec<f64>,
    pub group: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PriorProbabilities {
    /// Actual group values (the grouping variable's category codes), matching
    /// SPSS's "Prior Probabilities for Groups" first column.
    pub groups: Vec<String>,
    #[serde(rename = "prior_probabilities")]
    pub prior_probabilities: Vec<f64>,
    #[serde(rename = "cases_used")]
    pub cases_used: HashMap<String, Vec<usize>>,
    pub total: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ClassificationFunctionCoefficients {
    /// Group labels (the grouping variable's own codes), one per column.
    pub groups: Vec<String>,
    pub variables: Vec<String>,
    pub coefficients: HashMap<String, Vec<f64>>,
    #[serde(rename = "constant_terms")]
    pub constant_terms: Vec<f64>,
}

/// Lightweight per-case scores for scatter plot rendering.
/// Uses the same discriminant_scores key format as CasewiseStatistics.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScatterData {
    pub actual_group: Vec<String>,
    pub discriminant_scores: HashMap<String, Vec<f64>>,
}
