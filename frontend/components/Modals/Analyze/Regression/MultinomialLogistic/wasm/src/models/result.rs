use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MultinomialResult {
    pub coefficients: Vec<Vec<f64>>, // [kategori][parameter]
    pub std_errors: Vec<Vec<f64>>,
    pub wald_stats: Vec<Vec<f64>>, // Z-stats atau Wald
    pub p_values: Vec<Vec<f64>>,
    pub exp_beta: Vec<Vec<f64>>,     // Odds Ratio
    pub exp_ci_lower: Vec<Vec<f64>>, // Exp(B) CI lower
    pub exp_ci_upper: Vec<Vec<f64>>, // Exp(B) CI upper
    pub log_likelihood: f64,
    pub null_log_likelihood: f64, // Untuk R-Square
    pub chi_square: f64,          // Model Fitting Information
    pub df: u32,
    pub p_value_model: f64,
    pub iterations: u32,
    pub converged: bool,
    pub pseudo_r_square: PseudoRSquare,
    pub goodness_of_fit: GoodnessOfFit,
    pub classification_table: ClassificationTable,
    pub likelihood_ratio_tests: Vec<LikelihoodRatioTest>,
    pub stepwise_trace: Vec<StepwiseStep>,
    pub asymptotic_covariance: Vec<Vec<f64>>,
    pub asymptotic_correlation: Vec<Vec<f64>>,
    pub cell_probabilities: Vec<CellProbabilityItem>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CellProbabilityItem {
    pub subpop_index: usize,
    pub predictor_values: Vec<f64>,
    pub category_index: usize,
    pub category_value: f64,
    pub observed_count: f64,
    pub predicted_count: f64,
    pub pearson_residual: f64,
    pub observed_percentage: f64,
    pub predicted_percentage: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StepwiseStep {
    pub step: u32,
    pub action: String,
    pub effect: String,
    pub test: String,
    pub chi_square: f64,
    pub p_value: f64,
    pub selected_effects: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PseudoRSquare {
    pub cox_snell: f64,
    pub nagelkerke: f64,
    pub mcfadden: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GoodnessOfFit {
    pub pearson_chi_square: f64,
    pub pearson_df: u32,
    pub pearson_p_value: f64,
    pub deviance: f64,
    pub deviance_df: u32,
    pub deviance_p_value: f64,
    /// Jumlah pola kovariat unik (m) — ditampilkan sebagai baris Subpopulation
    /// pada tabel Case Processing Summary, sesuai perilaku SPSS NOMREG.
    pub subpopulations_count: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationTable {
    pub observed: Vec<usize>,
    pub predicted: Vec<usize>,
    pub confusion_matrix: Vec<Vec<f64>>, // [observed][predicted], weighted counts
    pub overall_percentage: f64,
    pub category_percentages: Vec<f64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LikelihoodRatioTest {
    pub effect: String, // nama variable
    pub aic_reduced: f64,
    pub bic_reduced: f64,
    pub neg2_log_likelihood_reduced: f64,
    pub chi_square: f64,
    pub df: u32,
    pub p_value: f64,
    pub equivalent_to_final: bool,
}
