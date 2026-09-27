use nalgebra::{DMatrix, DVector};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PlumWorkerPayload {
    #[serde(rename = "analysisType")]
    pub analysis_type: String,
    pub procedure: String,
    pub version: String,
    #[serde(default)]
    pub weights: Option<Vec<f64>>,
    #[serde(default)]
    pub dependent: Option<PlumVariableSpec>,
    #[serde(default)]
    pub factors: Vec<PlumVariableSpec>,
    #[serde(default)]
    pub covariates: Vec<PlumVariableSpec>,
    #[serde(rename = "factorLevelMetadata", default)]
    pub factor_level_metadata: Vec<PlumFactorLevelMetadata>,
    pub response: PlumResponse,
    #[serde(rename = "locationModel")]
    pub location_model: PlumLocationModel,
    #[serde(rename = "scaleModel")]
    pub scale_model: PlumScaleModel,
    #[serde(rename = "estimationOptions")]
    pub estimation_options: PlumEstimationOptions,
    #[serde(rename = "outputOptions")]
    pub output_options: serde_json::Value,
    #[serde(rename = "savedVariables", default)]
    pub saved_variables: Option<PlumSavedVariableOptions>,
    #[serde(rename = "rowIndexMap", default)]
    pub row_index_map: Vec<usize>,
    #[serde(rename = "existingColumnNames", default)]
    pub existing_column_names: Vec<String>,
    pub metadata: PlumMetadata,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PlumResponse {
    #[serde(rename = "variableName")]
    pub variable_name: String,
    #[serde(rename = "columnIndex")]
    pub column_index: usize,
    #[serde(rename = "responseCategories")]
    pub response_categories: Vec<serde_json::Value>,
    #[serde(rename = "responseVector")]
    pub response_vector: Vec<f64>,
    #[serde(rename = "categoryCount")]
    pub category_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PlumLocationModel {
    pub predictors: Vec<PlumPredictor>,
    #[serde(rename = "locationDesignMatrix")]
    pub location_design_matrix: Vec<Vec<f64>>,
    #[serde(rename = "locationTermNames")]
    pub location_term_names: Vec<String>,
    #[serde(rename = "parameterCount")]
    pub parameter_count: usize,
    #[serde(rename = "factorLevelMetadata", default)]
    pub factor_level_metadata: Vec<PlumFactorLevelMetadata>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PlumScaleModel {
    pub enabled: bool,
    pub predictors: Vec<PlumPredictor>,
    #[serde(rename = "scaleDesignMatrix")]
    pub scale_design_matrix: Vec<Vec<f64>>,
    #[serde(rename = "scaleTermNames")]
    pub scale_term_names: Vec<String>,
    #[serde(rename = "parameterCount")]
    pub parameter_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PlumPredictor {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(rename = "columnIndex", default)]
    pub column_index: Option<usize>,
    pub role: String,
    pub levels: Option<Vec<serde_json::Value>>,
    #[serde(rename = "referenceCategory")]
    pub reference_category: Option<serde_json::Value>,
    #[serde(default)]
    pub variables: Option<Vec<PlumPredictorVariable>>,
    #[serde(rename = "encodedColumnCount", default)]
    pub encoded_column_count: Option<usize>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PlumPredictorVariable {
    pub name: String,
    #[serde(rename = "columnIndex", default)]
    pub column_index: Option<usize>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PlumVariableSpec {
    pub name: String,
    #[serde(rename = "columnIndex")]
    pub column_index: usize,
    #[serde(default)]
    pub r#type: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(rename = "valueLabels", default)]
    pub value_labels: Vec<PlumValueLabel>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PlumValueLabel {
    pub value: serde_json::Value,
    pub label: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PlumFactorLevelMetadata {
    #[serde(rename = "variableName")]
    pub variable_name: String,
    #[serde(rename = "levelValue")]
    pub level_value: String,
    #[serde(rename = "levelLabel", default)]
    pub level_label: Option<String>,
    #[serde(rename = "isReference")]
    pub is_reference: bool,
    #[serde(rename = "isRedundant")]
    pub is_redundant: bool,
    #[serde(rename = "parameterName")]
    pub parameter_name: String,
    #[serde(rename = "activeColumnIndex")]
    pub active_column_index: Option<usize>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PlumEstimationOptions {
    #[serde(rename = "linkFunction")]
    pub link_function: String,
    #[serde(rename = "maxIterations")]
    pub max_iterations: usize,
    #[serde(rename = "maxStepHalving")]
    pub max_step_halving: usize,
    #[serde(rename = "logLikelihoodTolerance")]
    pub log_likelihood_tolerance: f64,
    #[serde(rename = "parameterTolerance")]
    pub parameter_tolerance: f64,
    #[serde(rename = "singularityTolerance")]
    pub singularity_tolerance: f64,
    #[serde(rename = "confidenceLevel")]
    pub confidence_level: f64,
    #[serde(rename = "zeroCellAdjustment")]
    pub zero_cell_adjustment: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlumOutputOptions {
    pub goodness_of_fit: Option<bool>,
    pub summary_statistics: Option<bool>,
    pub parameter_estimates: Option<bool>,
    pub asymptotic_covariance: Option<bool>,
    pub asymptotic_correlation: Option<bool>,
    pub cell_information: Option<bool>,
    pub test_of_parallel_lines: Option<bool>,
    pub iteration_history: Option<bool>,
    pub iteration_history_step: Option<usize>,
    pub print_iteration_history: Option<bool>,
    pub iteration_history_every: Option<usize>,
    pub predicted_category: Option<bool>,
    pub predicted_probability: Option<bool>,
    pub actual_probability: Option<bool>,
    pub print_log_likelihood: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlumSavedVariableOptions {
    pub predicted_response_category: Option<bool>,
    pub predicted_category: Option<bool>,
    pub estimated_response_probabilities: Option<bool>,
    pub estimate_response_probability: Option<bool>,
    pub predicted_category_probability: Option<bool>,
    pub actual_category_probability: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PlumMetadata {
    #[serde(rename = "modelType")]
    pub model_type: String,
    #[serde(rename = "totalRows")]
    pub total_rows: usize,
    #[serde(rename = "validRows")]
    pub valid_rows: usize,
    #[serde(rename = "droppedRows")]
    pub dropped_rows: usize,
    #[serde(rename = "responseCategoryCount")]
    pub response_category_count: usize,
    #[serde(rename = "locationParameterCount")]
    pub location_parameter_count: usize,
    #[serde(rename = "scaleParameterCount")]
    pub scale_parameter_count: usize,
    #[serde(rename = "referenceCategories")]
    pub reference_categories: std::collections::HashMap<String, serde_json::Value>,
    #[serde(rename = "factorLevelMetadata", default)]
    pub factor_level_metadata: Vec<PlumFactorLevelMetadata>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PlumOutputMetadata {
    #[serde(rename = "modelType")]
    pub model_type: String,
    #[serde(rename = "totalRows")]
    pub total_rows: usize,
    #[serde(rename = "validRows")]
    pub valid_rows: usize,
    #[serde(rename = "droppedRows")]
    pub dropped_rows: usize,
    #[serde(rename = "responseCategoryCount")]
    pub response_category_count: usize,
    #[serde(rename = "locationParameterCount")]
    pub location_parameter_count: usize,
    #[serde(rename = "scaleParameterCount")]
    pub scale_parameter_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(untagged)]
pub enum Category {
    Number(f64),
    Text(String),
}

impl Category {
    pub fn as_label(&self) -> String {
        match self {
            Category::Number(v) => {
                let rounded = if v.fract().abs() < 1e-12 {
                    *v as i64
                } else {
                    *v as i64
                };
                if (rounded as f64 - *v).abs() < 1e-12 {
                    rounded.to_string()
                } else {
                    v.to_string()
                }
            }
            Category::Text(v) => v.clone(),
        }
    }
}

pub fn response_categories_to_vec(
    values: &[serde_json::Value],
) -> Result<Vec<Category>, PlumError> {
    let mut categories = Vec::with_capacity(values.len());
    for value in values {
        match value {
            serde_json::Value::Number(num) => {
                categories.push(Category::Number(num.as_f64().unwrap_or(0.0)));
            }
            serde_json::Value::String(text) => {
                categories.push(Category::Text(text.clone()));
            }
            serde_json::Value::Bool(flag) => {
                categories.push(Category::Text(flag.to_string()));
            }
            serde_json::Value::Null => {
                return Err(PlumError::InvalidInput(
                    "responseCategories mengandung null".to_string(),
                ));
            }
            other => {
                categories.push(Category::Text(other.to_string()));
            }
        }
    }
    Ok(categories)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LinkFunction {
    Logit,
    Probit,
    ComplementaryLogLog,
    NegativeLogLog,
    Cauchit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModelType {
    LocationOnly,
    General,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScaleType {
    Unity,
    NonConstant,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EstimationMethod {
    FisherScoring,
    NewtonRaphson,
}

#[derive(Clone, Debug)]
pub struct PlumSpec {
    pub response_variable: String,
    pub ordered_categories: Vec<Category>,
    pub category_count: usize,
    pub link_function: LinkFunction,
    pub model_type: ModelType,
    pub scale_type: ScaleType,
    pub feature_names: Vec<String>,
    pub scale_feature_names: Vec<String>,
    pub location_variables: Vec<String>,
    pub scale_variables: Vec<String>,
    pub factor_level_metadata: Vec<PlumFactorLevelMetadata>,
}

impl PlumSpec {
    pub fn from_input(input: &PlumWorkerPayload) -> Result<Self, PlumError> {
        let link_function =
            LinkFunction::try_from(input.estimation_options.link_function.as_str())?;
        let model_type = ModelType::try_from(input.metadata.model_type.as_str())?;
        let scale_type = if input.scale_model.enabled {
            ScaleType::NonConstant
        } else {
            ScaleType::Unity
        };

        let ordered_categories = response_categories_to_vec(&input.response.response_categories)?;

        let mut factor_level_metadata = input.location_model.factor_level_metadata.clone();
        if factor_level_metadata.is_empty() {
            factor_level_metadata = input.factor_level_metadata.clone();
        }
        if factor_level_metadata.is_empty() {
            factor_level_metadata = input.metadata.factor_level_metadata.clone();
        }

        Ok(Self {
            response_variable: input.response.variable_name.clone(),
            ordered_categories,
            category_count: input.response.category_count,
            link_function,
            model_type,
            scale_type,
            feature_names: input.location_model.location_term_names.clone(),
            scale_feature_names: input.scale_model.scale_term_names.clone(),
            location_variables: input.location_model.location_term_names.clone(),
            scale_variables: input.scale_model.scale_term_names.clone(),
            factor_level_metadata,
        })
    }

    pub fn threshold_count(&self) -> usize {
        self.category_count.saturating_sub(1)
    }

    pub fn location_parameter_count(&self) -> usize {
        self.location_variables.len()
    }

    pub fn scale_parameter_count(&self) -> usize {
        if self.scale_type == ScaleType::NonConstant {
            self.scale_variables.len()
        } else {
            0
        }
    }

    pub fn parameter_count(&self) -> usize {
        self.threshold_count() + self.location_parameter_count() + self.scale_parameter_count()
    }

    pub fn category_label(&self, idx: usize) -> String {
        self.ordered_categories
            .get(idx)
            .map(Category::as_label)
            .unwrap_or_else(|| format!("{idx}"))
    }

    pub fn is_location_only(&self) -> bool {
        self.model_type == ModelType::LocationOnly || self.scale_type == ScaleType::Unity
    }

    pub fn as_location_only(&self) -> Self {
        let mut spec = self.clone();
        spec.model_type = ModelType::LocationOnly;
        spec.scale_type = ScaleType::Unity;
        spec.scale_feature_names = Vec::new();
        spec.scale_variables = Vec::new();
        spec
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlumValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct Subpopulation {
    pub x: Vec<f64>,
    pub z: Vec<f64>,
    pub counts: Vec<f64>,
    pub cumulative_counts: Vec<f64>,
    pub marginal_count: f64,
}

#[derive(Clone, Debug)]
pub struct AggregatedData {
    pub subpopulations: Vec<Subpopulation>,
    pub total_count: f64,
    pub category_count: usize,
    pub ordered_categories: Vec<Category>,
}

#[derive(Clone, Debug, Default)]
pub struct PlumParameters {
    pub theta: Vec<f64>,
    pub beta: Vec<f64>,
    pub tau: Vec<f64>,
}

impl PlumParameters {
    pub fn from_vector(vec: &DVector<f64>, spec: &PlumSpec) -> Self {
        let t = spec.threshold_count();
        let p = spec.location_parameter_count();
        let q = spec.scale_parameter_count();
        let theta = vec.rows(0, t).iter().cloned().collect();
        let beta = vec.rows(t, p).iter().cloned().collect();
        let tau = if q > 0 {
            vec.rows(t + p, q).iter().cloned().collect()
        } else {
            Vec::new()
        };
        Self { theta, beta, tau }
    }

    pub fn to_vector(&self, spec: &PlumSpec) -> DVector<f64> {
        let mut values = Vec::with_capacity(spec.parameter_count());
        values.extend_from_slice(&self.theta);
        values.extend_from_slice(&self.beta);
        values.extend_from_slice(&self.tau);
        DVector::from_vec(values)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IterationHistoryRow {
    pub iteration: usize,
    pub step_halvings: usize,
    pub minus2_log_likelihood: f64,
    pub minus2_log_likelihood_displayed: f64,
    pub threshold: Vec<f64>,
    pub location: Vec<f64>,
    pub scale: Vec<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IterationHistoryMeta {
    pub link_function: String,
    pub iteration_history_every: usize,
    pub threshold_names: Vec<String>,
    pub location_names: Vec<String>,
    pub scale_names: Vec<String>,
    pub last_abs_change_minus2_log_likelihood: Option<f64>,
    pub last_max_abs_change_parameters: Option<f64>,
    pub converged: bool,
}

#[derive(Clone, Debug)]
pub struct IterationHistoryOptions {
    pub enabled: bool,
    pub every: usize,
}

impl IterationHistoryOptions {
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            every: 1,
        }
    }
}

#[derive(Clone, Debug)]
pub struct IterationState {
    pub log_likelihood: f64,
    pub params: PlumParameters,
    pub gradient: DVector<f64>,
}

#[derive(Clone, Debug)]
pub struct StepResult {
    pub params: PlumParameters,
    pub log_likelihood: f64,
    pub step: f64,
    pub step_halving_count: usize,
    pub threshold_adjustments: usize,
    pub delta: DVector<f64>,
}

#[derive(Clone, Debug)]
pub struct FitResult {
    pub params: PlumParameters,
    pub information: Option<DMatrix<f64>>,
    pub covariance: Option<DMatrix<f64>>,
    pub correlation: Option<DMatrix<f64>>,
    pub log_likelihood: f64,
    pub minus2_log_likelihood: f64,
    pub converged: bool,
    pub iterations: usize,
    pub iteration_history: Vec<IterationHistoryRow>,
    pub last_abs_change_minus2_log_likelihood: Option<f64>,
    pub last_max_abs_change_parameters: Option<f64>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParameterEstimateRow {
    pub group: String,
    pub variable: String,
    pub estimate: f64,
    pub std_error: Option<f64>,
    pub wald: Option<f64>,
    pub degrees_of_freedom: Option<f64>,
    pub sig: Option<f64>,
    pub lower: Option<f64>,
    pub upper: Option<f64>,
    pub is_redundant: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FitStat {
    pub chi_square: f64,
    pub df: f64,
    pub sig: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoodnessOfFit {
    pub pearson: FitStat,
    pub deviance: FitStat,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSummaryRow {
    pub minus2_log_likelihood: f64,
    pub log_likelihood: f64,
    pub converged: bool,
    pub iterations: usize,
    pub method: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterceptOnlyRow {
    pub minus2_log_likelihood: f64,
    pub log_likelihood: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelChiSquare {
    pub chi_square: f64,
    pub df: f64,
    pub sig: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PseudoRSquare {
    pub cox_snell: f64,
    pub nagelkerke: f64,
    pub mcfadden: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryStatistics {
    pub model: ModelSummaryRow,
    pub intercept_only: InterceptOnlyRow,
    pub model_chi_square: ModelChiSquare,
    pub pseudo_r_square: PseudoRSquare,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParallelLinesTest {
    pub minus2_log_likelihood_parallel: f64,
    pub minus2_log_likelihood_non_parallel: f64,
    pub chi_square: f64,
    pub df: f64,
    pub sig: Option<f64>,
    pub converged: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VifRow {
    pub variable: String,
    pub tolerance: f64,
    pub vif: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrelationRow {
    pub variable: String,
    pub values: Vec<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GvifRow {
    pub predictor: String,
    pub predictor_type: String,
    pub df: usize,
    pub gvif: f64,
    pub adjusted_gvif: f64,
    pub interpretation: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollinearityDiagnosticsResult {
    #[serde(default)]
    pub vif: Vec<VifRow>,
    #[serde(default, rename = "correlationMatrix")]
    pub correlation_matrix: Vec<CorrelationRow>,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub rows: Vec<GvifRow>,
}

#[derive(Clone, Debug)]
pub struct EncodedPredictorBlock {
    pub predictor_name: String,
    pub predictor_type: String,
    pub column_indices: Vec<usize>,
}

#[derive(Clone, Debug)]
pub struct GvifOptions {
    pub ridge_lambda: f64,
}

impl Default for GvifOptions {
    fn default() -> Self {
        Self {
            ridge_lambda: 1e-10,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CellInfo {
    pub subpopulation: usize,
    pub category: String,
    pub observed: f64,
    pub predicted: f64,
    pub residual: f64,
    pub standardized_residual: Option<f64>,
    pub x: Vec<f64>,
    pub z: Vec<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbabilityRow {
    pub subpopulation: usize,
    pub category: String,
    pub probability: f64,
    pub x: Vec<f64>,
    pub z: Vec<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PredictedCategoryRow {
    pub subpopulation: usize,
    pub category: String,
    pub probability: f64,
    pub x: Vec<f64>,
    pub z: Vec<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedVariableColumn {
    pub name: String,
    pub label: String,
    #[serde(rename = "type")]
    pub column_type: String,
    pub decimals: Option<usize>,
    pub values: Vec<Option<serde_json::Value>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedVariablesResult {
    pub batch_suffix: usize,
    pub columns: Vec<SavedVariableColumn>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlumFitOutput {
    pub converged: bool,
    pub iterations: usize,
    pub log_likelihood: f64,
    pub minus2_log_likelihood: f64,
    pub log_likelihood_constant: f64,
    pub log_likelihood_kernel: f64,
    pub log_likelihood_complete: f64,
    pub log_likelihood_displayed: f64,
    pub minus2_log_likelihood_displayed: f64,
    pub log_likelihood_display_mode: String,
    pub parameter_estimates: Vec<ParameterEstimateRow>,
    pub threshold_estimates: Vec<ParameterEstimateRow>,
    pub location_parameter_estimates: Vec<ParameterEstimateRow>,
    pub scale_parameter_estimates: Vec<ParameterEstimateRow>,
    pub iteration_history: Vec<IterationHistoryRow>,
    pub iteration_history_meta: Option<IterationHistoryMeta>,
    pub warnings: Vec<String>,
    pub metadata: PlumOutputMetadata,
    pub goodness_of_fit: Option<GoodnessOfFit>,
    pub summary_statistics: Option<SummaryStatistics>,
    pub test_of_parallel_lines: Option<ParallelLinesTest>,
    pub cell_information: Option<Vec<CellInfo>>,
    pub predicted_category: Option<Vec<PredictedCategoryRow>>,
    pub predicted_probability: Option<Vec<ProbabilityRow>>,
    pub actual_probability: Option<Vec<ProbabilityRow>>,
    pub saved_variables: Option<SavedVariablesResult>,
    pub covariance_matrix: Option<Vec<Vec<f64>>>,
    pub correlation_matrix: Option<Vec<Vec<f64>>>,
    pub errors: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct EstimationOptions {
    pub method: EstimationMethod,
    pub max_iterations: usize,
    pub max_step_halving: usize,
    pub convergence_tolerance: f64,
    pub parameter_tolerance: f64,
    pub gradient_tolerance: f64,
    pub alpha: f64,
    pub zero_cell_correction: f64,
}

impl EstimationOptions {
    pub fn from_payload(payload: Option<&PlumEstimationOptions>) -> Self {
        let mut options = EstimationOptions::default();
        if let Some(payload) = payload {
            options.max_iterations = payload.max_iterations.max(1);
            options.max_step_halving = payload.max_step_halving;
            options.convergence_tolerance = payload.log_likelihood_tolerance.max(0.0);
            options.parameter_tolerance = payload.parameter_tolerance.max(0.0);
            options.gradient_tolerance = payload.parameter_tolerance.max(0.0);
            let alpha = 1.0 - (payload.confidence_level / 100.0);
            options.alpha = alpha.clamp(0.0, 1.0);
            options.zero_cell_correction = payload.zero_cell_adjustment.max(0.0);
        }
        options
    }

    pub fn method_label(&self) -> String {
        match self.method {
            EstimationMethod::FisherScoring => "fisher_scoring".to_string(),
            EstimationMethod::NewtonRaphson => "newton_raphson".to_string(),
        }
    }
}

impl Default for EstimationMethod {
    fn default() -> Self {
        EstimationMethod::FisherScoring
    }
}

impl Default for EstimationOptions {
    fn default() -> Self {
        EstimationOptions {
            method: EstimationMethod::FisherScoring,
            max_iterations: 50,
            max_step_halving: 10,
            convergence_tolerance: 1e-6,
            parameter_tolerance: 1e-6,
            gradient_tolerance: 1e-6,
            alpha: 0.05,
            zero_cell_correction: 0.0,
        }
    }
}

impl TryFrom<&str> for LinkFunction {
    type Error = PlumError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "logit" | "Logit" => Ok(LinkFunction::Logit),
            "probit" | "Probit" => Ok(LinkFunction::Probit),
            "cloglog" | "complementary_log_log" | "Complementary Log-Log" => {
                Ok(LinkFunction::ComplementaryLogLog)
            }
            "nloglog" | "negative_log_log" | "Negative Log-Log" => Ok(LinkFunction::NegativeLogLog),
            "cauchit" | "Cauchit" => Ok(LinkFunction::Cauchit),
            _ => Err(PlumError::InvalidInput(format!(
                "Link function tidak dikenal: {value}"
            ))),
        }
    }
}

impl TryFrom<&str> for ModelType {
    type Error = PlumError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "location_only" | "location-only" => Ok(ModelType::LocationOnly),
            "general" => Ok(ModelType::General),
            _ => Err(PlumError::InvalidInput(format!(
                "Model type tidak dikenal: {value}"
            ))),
        }
    }
}

impl TryFrom<&str> for ScaleType {
    type Error = PlumError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "unity" => Ok(ScaleType::Unity),
            "nonconstant" | "non_constant" => Ok(ScaleType::NonConstant),
            _ => Err(PlumError::InvalidInput(format!(
                "Scale type tidak dikenal: {value}"
            ))),
        }
    }
}

impl TryFrom<&str> for EstimationMethod {
    type Error = PlumError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "fisher_scoring" => Ok(EstimationMethod::FisherScoring),
            "newton_raphson" => Ok(EstimationMethod::NewtonRaphson),
            _ => Err(PlumError::InvalidInput(format!(
                "Metode estimasi tidak dikenal: {value}"
            ))),
        }
    }
}

#[derive(Error, Debug)]
pub enum PlumError {
    #[error("Input tidak valid: {0}")]
    InvalidInput(String),
    #[error("Data aggregation gagal: {0}")]
    DataError(String),
    #[error("Optimisasi gagal: {0}")]
    OptimizationError(String),
    #[error("Statistik gagal: {0}")]
    StatisticsError(String),
    #[error("Model error: {0}")]
    ModelError(String),
    #[error("Not implemented: {0}")]
    NotImplemented(String),
}
