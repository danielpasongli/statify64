//! Implementation of variable selection methods for discriminant analysis.
//!
//! This module provides implementations of different methods for
//! computing F-to-enter and F-to-remove statistics in stepwise discriminant analysis.

use super::core::{
    calculate_min_mahalanobis_distance, calculate_overall_wilks_lambda, calculate_raos_v,
    calculate_univariate_f, AnalyzedDataset, MethodType,
};

/// Calculate F-to-enter for a variable based on the selected method
///
/// # Parameters
/// * `variable` - The variable to test
/// * `dataset` - The analyzed dataset
/// * `current_variables` - Variables currently in the model
/// * `method_type` - The method to use
///
/// # Returns
/// A tuple of (F-to-enter, Wilks' lambda), or an error if Wilks' lambda cannot be computed
pub fn calculate_variable_f_to_enter(
    variable: &str,
    dataset: &AnalyzedDataset,
    current_variables: &[String],
    method_type: MethodType,
) -> Result<(f64, f64), String> {
    match method_type {
        MethodType::Wilks => calculate_f_to_enter_wilks(variable, dataset, current_variables),
        MethodType::Unexplained => {
            calculate_f_to_enter_unexplained(variable, dataset, current_variables)
        }
        MethodType::Mahalanobis => {
            calculate_f_to_enter_mahalanobis(variable, dataset, current_variables)
        }
        MethodType::FRatio => calculate_f_to_enter_fratio(variable, dataset, current_variables),
        MethodType::Raos => calculate_f_to_enter_raos(variable, dataset, current_variables),
    }
}

/// Calculate F-to-remove for a variable based on the selected method
///
/// # Parameters
/// * `variable` - The variable to test
/// * `dataset` - The analyzed dataset
/// * `current_variables` - Variables currently in the model
/// * `method_type` - The method to use
///
/// # Returns
/// A tuple of (F-to-remove, Wilks' lambda), or an error if Wilks' lambda cannot be computed
pub fn calculate_variable_f_to_remove(
    variable: &str,
    dataset: &AnalyzedDataset,
    current_variables: &[String],
    method_type: MethodType,
) -> Result<(f64, f64), String> {
    match method_type {
        MethodType::Wilks => calculate_f_to_remove_wilks(variable, dataset, current_variables),
        MethodType::Unexplained => {
            calculate_f_to_remove_unexplained(variable, dataset, current_variables)
        }
        MethodType::Mahalanobis => {
            calculate_f_to_remove_mahalanobis(variable, dataset, current_variables)
        }
        MethodType::FRatio => calculate_f_to_remove_fratio(variable, dataset, current_variables),
        MethodType::Raos => calculate_f_to_remove_raos(variable, dataset, current_variables),
    }
}

/// F to Enter of a candidate: the partial F shared by every stepwise method,
///
/// F = [(Λ_q − Λ_{q+1}) / Λ_{q+1}] · (n − g − q) / (g − 1),   df = (g − 1, n − g − q)
///
/// Λ_q = Wilks' lambda of the q variables in the model, Λ_{q+1} = with the candidate
/// added. At q = 0 this is the univariate F. The Wilks method enters the candidate
/// with the smallest Λ_{q+1}.
///
/// # Parameters
/// * `variable` - The variable to test
/// * `dataset` - The analyzed dataset
/// * `current_variables` - Variables currently in the model
///
/// # Returns
/// A tuple of (F-to-enter, Wilks' lambda)
fn calculate_f_to_enter_wilks(
    variable: &str,
    dataset: &AnalyzedDataset,
    current_variables: &[String],
) -> Result<(f64, f64), String> {
    if current_variables.is_empty() {
        return Ok(calculate_univariate_f(variable, dataset));
    }

    let current_wilks = calculate_overall_wilks_lambda(dataset, current_variables)?;

    let mut new_variables = current_variables.to_vec();
    new_variables.push(variable.to_string());
    let new_wilks = calculate_overall_wilks_lambda(dataset, &new_variables)?;

    // Partial F for adding one variable to a model with q variables:
    // F = ((Λ_q - Λ_{q+1}) / Λ_{q+1}) × (n - g - q) / (g - 1), df = (g - 1, n - g - q),
    // where q = current_variables.len() (candidate excluded). At q = 0 this is the
    // univariate F (df2 = n - g). Computed in f64 so a small n cannot underflow usize.
    let df1 = dataset.num_groups as f64 - 1.0;
    let df2 = dataset.total_cases as f64
        - dataset.num_groups as f64
        - current_variables.len() as f64;

    // Divided by Λ_{q+1}, the lambda after entry.
    let f_value = if df1 > 0.0 && df2 > 0.0 && new_wilks < current_wilks && new_wilks > 0.0 {
        (((current_wilks - new_wilks) / new_wilks) * df2) / df1
    } else {
        0.0
    };

    Ok((f_value, new_wilks))
}

/// F to Remove of a variable in the model: the partial F shared by every stepwise
/// method,
///
/// F = [(Λ_{p−1} − Λ_p) / Λ_p] · (n − g − p + 1) / (g − 1),   df = (g − 1, n − g − p + 1)
///
/// Λ_p = Wilks' lambda of the p variables in the model, Λ_{p−1} = without the
/// variable (1 when it is the only one).
///
/// # Parameters
/// * `variable` - The variable to test
/// * `dataset` - The analyzed dataset
/// * `current_variables` - Variables currently in the model
///
/// # Returns
/// A tuple of (F-to-remove, Wilks' lambda)
fn calculate_f_to_remove_wilks(
    variable: &str,
    dataset: &AnalyzedDataset,
    current_variables: &[String],
) -> Result<(f64, f64), String> {
    // Calculate Wilks' lambda for current model
    let current_wilks = calculate_overall_wilks_lambda(dataset, current_variables)?;

    // Calculate Wilks' lambda with variable removed
    let reduced_variables: Vec<String> = current_variables
        .iter()
        .filter(|&v| v != variable)
        .cloned()
        .collect();

    let reduced_wilks = if reduced_variables.is_empty() {
        1.0
    } else {
        calculate_overall_wilks_lambda(dataset, &reduced_variables)?
    };

    // F-to-remove formula: F = ((Λ_R - Λ_C) / Λ_C) × (df2 / df1)
    // where Λ_R = Wilks' lambda of reduced model (var removed)
    //       Λ_C = Wilks' lambda of current model (var included)
    // df1 = g - 1, df2 = n - g - p + 1 with p = current_variables.len() (variable included).
    // Removing from a p-variable model is entering into a (p - 1)-variable model, so this
    // equals the F-to-enter df2 = n - g - q with q = p - 1.
    let df1 = dataset.num_groups as f64 - 1.0;
    let df2 = dataset.total_cases as f64
        - dataset.num_groups as f64
        - current_variables.len() as f64
        + 1.0;

    let f_value = if df1 > 0.0 && df2 > 0.0 && reduced_wilks > current_wilks && current_wilks > 0.0 {
        (((reduced_wilks - current_wilks) / current_wilks) * df2) / df1
    } else {
        0.0
    };

    Ok((f_value, reduced_wilks))
}

/// Calculate F-to-enter using Unexplained Variance method
///
/// Returns the standard partial Wilks F-to-enter (identical to the Wilks method),
/// which is what SPSS shows in the "F to Enter" column and gates entry on. The
/// method statistic itself (Residual Variance = Σ_{i<j} 4 / (4 + D²_ij), see
/// `calculate_total_unexplained_variation`) only ranks candidates and is computed
/// in analyze_variables_not_in_model.
///
/// # Parameters
/// * `variable` - The candidate variable to test
/// * `dataset` - The analyzed dataset
/// * `current_variables` - Variables currently in the model
///
/// # Returns
/// A tuple of (partial F-to-enter, Wilks' lambda after entry)
fn calculate_f_to_enter_unexplained(
    variable: &str,
    dataset: &AnalyzedDataset,
    current_variables: &[String],
) -> Result<(f64, f64), String> {
    // SPSS shows the standard partial Wilks F in the "F to Enter" column for the
    // Unexplained Variance method, and gates entry on it (FIN = 3.84). The method
    // statistic ("Residual Variance") only ranks candidates and is computed in
    // analyze_variables_not_in_model (stored in min_d_squared).
    calculate_f_to_enter_wilks(variable, dataset, current_variables)
}

/// Calculate F-to-remove using Unexplained Variance method
///
/// Returns the standard partial Wilks F-to-remove (identical to the Wilks method).
/// The "Residual Variance" column for variables in the model is computed separately.
///
/// # Parameters
/// * `variable` - The variable in the model to test
/// * `dataset` - The analyzed dataset
/// * `current_variables` - Variables currently in the model
///
/// # Returns
/// A tuple of (partial F-to-remove, Wilks' lambda of the reduced model)
fn calculate_f_to_remove_unexplained(
    variable: &str,
    dataset: &AnalyzedDataset,
    current_variables: &[String],
) -> Result<(f64, f64), String> {
    // Standard partial Wilks F-to-remove (FOUT = 2.71 gate). The "Residual
    // Variance" column for variables in the model is computed separately.
    calculate_f_to_remove_wilks(variable, dataset, current_variables)
}

/// Calculate F-to-enter using Mahalanobis Distance method
///
/// This method maximizes the minimum squared Mahalanobis distance D² between any
/// two groups. The F returned is the standard partial Wilks F-to-enter (entry
/// gate); the ranking statistic is min D² after entry, returned negated so that
/// lower = better, like Wilks' lambda.
///
/// # Parameters
/// * `variable` - The variable to test
/// * `dataset` - The analyzed dataset
/// * `current_variables` - Variables currently in the model
///
/// # Returns
/// A tuple of (partial F-to-enter, −min D² after entry)
fn calculate_f_to_enter_mahalanobis(
    variable: &str,
    dataset: &AnalyzedDataset,
    current_variables: &[String],
) -> Result<(f64, f64), String> {
    // 1. Entry gate: the partial Wilks F to Enter (df and the empty model are handled
    //    there).
    let (f_value, _) = calculate_f_to_enter_wilks(variable, dataset, current_variables)?;

    // 2. Ranking: smallest D² between two groups with the candidate added.
    let mut new_variables = current_variables.to_vec();
    new_variables.push(variable.to_string());

    let new_min_d2 = calculate_min_mahalanobis_distance(dataset, &new_variables);

    // 3. Returned as −min D², so that a smaller value ranks better, as with Wilks' lambda.
    let wilks_lambda = -new_min_d2;

    Ok((f_value, wilks_lambda))
}

/// Calculate F-to-remove using Mahalanobis Distance method
///
/// The F returned is the standard partial Wilks F-to-remove (removal gate); the
/// second value is min D² of the reduced model, negated (1.0 when removing the
/// variable leaves the model empty).
///
/// # Parameters
/// * `variable` - The variable to test
/// * `dataset` - The analyzed dataset
/// * `current_variables` - Variables currently in the model
///
/// # Returns
/// A tuple of (partial F-to-remove, −min D² of the reduced model)
fn calculate_f_to_remove_mahalanobis(
    variable: &str,
    dataset: &AnalyzedDataset,
    current_variables: &[String],
) -> Result<(f64, f64), String> {
    // 1. Removal gate: the partial Wilks F to Remove.
    let (f_value, _) = calculate_f_to_remove_wilks(variable, dataset, current_variables)?;

    // 2. Ranking: smallest D² between two groups without the variable.
    let reduced_variables: Vec<String> = current_variables
        .iter()
        .filter(|&v| v != variable)
        .cloned()
        .collect();

    let reduced_min_d2 = if reduced_variables.is_empty() {
        0.0
    } else {
        calculate_min_mahalanobis_distance(dataset, &reduced_variables)
    };

    let wilks_lambda = if reduced_variables.is_empty() {
        1.0
    } else {
        -reduced_min_d2
    };

    Ok((f_value, wilks_lambda))
}

/// Calculate F-to-enter using Smallest F Ratio method
///
/// This method maximizes the minimum pairwise F ratio between any two groups.
/// The F returned here is the standard partial Wilks F-to-enter (entry gate), not
/// the pairwise F ratio.
///
/// # Parameters
/// * `variable` - The variable to test
/// * `dataset` - The analyzed dataset
/// * `current_variables` - Variables currently in the model
///
/// # Returns
/// A tuple of (partial F-to-enter, Wilks' lambda after entry)
fn calculate_f_to_enter_fratio(
    variable: &str,
    dataset: &AnalyzedDataset,
    current_variables: &[String],
) -> Result<(f64, f64), String> {
    // SPSS shows the standard partial Wilks F in the "F to Enter" column for the
    // Smallest F Ratio method, and gates entry on it (FIN = 3.84). The method
    // statistic ("Min. F" + Between Groups) only ranks candidates and is computed
    // in analyze_variables_not_in_model (stored in min_d_squared / between_groups).
    calculate_f_to_enter_wilks(variable, dataset, current_variables)
}

/// Calculate F-to-remove using Smallest F Ratio method
///
/// Returns the standard partial Wilks F-to-remove (identical to the Wilks method),
/// not the pairwise F ratio. The "Min. F" column for variables in the model is
/// computed separately.
///
/// # Parameters
/// * `variable` - The variable in the model to test
/// * `dataset` - The analyzed dataset
/// * `current_variables` - Variables currently in the model
///
/// # Returns
/// A tuple of (partial F-to-remove, Wilks' lambda of the reduced model)
fn calculate_f_to_remove_fratio(
    variable: &str,
    dataset: &AnalyzedDataset,
    current_variables: &[String],
) -> Result<(f64, f64), String> {
    // Standard partial Wilks F-to-remove (FOUT = 2.71 gate). The "Min. F" column
    // for variables in the model is computed separately.
    calculate_f_to_remove_wilks(variable, dataset, current_variables)
}

/// Calculate F-to-enter using Rao's V method
///
/// Returns (partial_wilks_f, proxy_for_V_with) where:
/// - partial_wilks_f: the standard partial F-to-enter (what SPSS shows in the "F to Enter"
///   column for Rao's V; same partial-Wilks formula used by every method).
/// - proxy_for_V_with: 1/(1 + V_with/n), so that raosVFromProxy() in the formatter can
///   recover the cumulative Rao's V after entry (V_with = V(M ∪ {x})).
///
/// Selection of which variable to enter is done on ΔV stored separately in
/// VariableNotInAnalysis.min_d_squared by analyze_variables_not_in_model.
fn calculate_f_to_enter_raos(
    variable: &str,
    dataset: &AnalyzedDataset,
    current_variables: &[String],
) -> Result<(f64, f64), String> {
    // V_with for the proxy (displayed as "Rao's V" column via raosVFromProxy in formatter)
    let mut new_variables = current_variables.to_vec();
    new_variables.push(variable.to_string());
    let new_v = calculate_raos_v(dataset, &new_variables);

    // "F to Enter" column: partial Wilks F — same as every other stepwise method
    let (partial_f, _) = calculate_f_to_enter_wilks(variable, dataset, current_variables)?;

    let wilks_lambda = if new_v > 0.0 {
        1.0 / (1.0 + new_v / (dataset.total_cases as f64))
    } else {
        1.0
    };

    Ok((partial_f, wilks_lambda))
}

/// Calculate F-to-remove using Rao's V method
///
/// Returns (partial_wilks_f, proxy_for_V_reduced) where:
/// - partial_wilks_f: the standard partial F-to-remove (what SPSS shows in the "F to Remove"
///   column; same partial-Wilks formula used by every method).
/// - proxy_for_V_reduced: 1/(1 + V_reduced/n), so raosVFromProxy() in the formatter recovers
///   V(M \ {v}) — the "Rao's V" column in Variables in the Analysis table.
///
/// calculate_f_to_remove_wilks handles the single-variable case (reduced = empty → lambda = 1.0).
fn calculate_f_to_remove_raos(
    variable: &str,
    dataset: &AnalyzedDataset,
    current_variables: &[String],
) -> Result<(f64, f64), String> {
    // "F to Remove" column: partial Wilks F
    let (partial_f, _) = calculate_f_to_remove_wilks(variable, dataset, current_variables)?;

    // V of reduced model: for the "Rao's V" column via raosVFromProxy
    let reduced_variables: Vec<String> = current_variables
        .iter()
        .filter(|&v| v != variable)
        .cloned()
        .collect();

    let reduced_v = if reduced_variables.is_empty() {
        0.0
    } else {
        calculate_raos_v(dataset, &reduced_variables)
    };

    let wilks_lambda = if reduced_v > 0.0 {
        1.0 / (1.0 + reduced_v / (dataset.total_cases as f64))
    } else {
        1.0
    };

    Ok((partial_f, wilks_lambda))
}
