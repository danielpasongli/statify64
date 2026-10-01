use nalgebra::DMatrix;
use statrs::distribution::{ChiSquared, ContinuousCDF, Normal};
use statrs::function::gamma::ln_gamma;

use crate::model::{cell_probabilities, cumulative_probabilities};
use crate::types::{
    AggregatedData, CellInfo, FitResult, FitStat, GoodnessOfFit, ModelChiSquare, ModelSummaryRow,
    CollinearityDiagnosticsResult, CorrelationRow, EncodedPredictorBlock, GvifOptions, GvifRow,
    ParameterEstimateRow, PlumError, PlumSpec, ProbabilityRow, PseudoRSquare, SummaryStatistics,
    VifRow,
};
use crate::utils::EPS;

#[allow(non_upper_case_globals)]
pub const excluding_log_likelihood: &str = "KERNEL";
#[allow(non_upper_case_globals)]
pub const including_log_likelihood: &str = "SPSS_COMPATIBLE";

pub fn multinomial_log_likelihood_constant(data: &AggregatedData) -> f64 {
    let mut constant = 0.0;
    for subpop in &data.subpopulations {
        let n = subpop.marginal_count;
        if n > 0.0 {
            constant += ln_gamma(n + 1.0);
            for count in &subpop.counts {
                if *count > 0.0 {
                    constant -= ln_gamma(*count + 1.0);
                } else {
                    constant -= ln_gamma(1.0);
                }
            }
        }
    }
    constant
}

pub fn displayed_log_likelihood(kernel: f64, constant: f64, mode: &str) -> f64 {
    if mode == including_log_likelihood {
        kernel + constant
    } else {
        kernel
    }
}

pub fn covariance_matrix(information: &DMatrix<f64>) -> Result<DMatrix<f64>, PlumError> {
    information
        .clone()
        .try_inverse()
        .ok_or_else(|| PlumError::StatisticsError("Tidak bisa invert information matrix".to_string()))
}

pub fn correlation_matrix(covariance: &DMatrix<f64>) -> DMatrix<f64> {
    let mut corr = covariance.clone();
    let n = covariance.nrows();
    for i in 0..n {
        for j in 0..n {
            let denom = (covariance[(i, i)] * covariance[(j, j)]).sqrt();
            corr[(i, j)] = if denom > 0.0 { covariance[(i, j)] / denom } else { 0.0 };
        }
    }
    corr
}

/// Menghitung VIF (Variance Inflation Factor) dengan OLS auxiliary regression
/// Sesuai logika binary logistic regression:
/// VIF_j = 1 / (1 - R_j^2), Tolerance_j = 1 - R_j^2
pub fn calculate_vif(
    x: &DMatrix<f64>,
    feature_names: &[String],
) -> (Vec<VifRow>, Vec<String>) {
    let (rows, cols) = x.shape();
    let mut warnings = Vec::new();

    if cols < 2 {
        warnings.push("VIF requires at least two independent variables.".to_string());
        return (vec![], warnings);
    }

    let mut results = Vec::with_capacity(cols);

    for i in 0..cols {
        let y_curr = x.column(i).into_owned();

        // 1. Matriks desain auxiliary: Intercept (1.0) + semua kolom selain i
        let mut predictors_vec = Vec::with_capacity(rows * cols);
        for _ in 0..rows {
            predictors_vec.push(1.0);
        }
        for j in 0..cols {
            if i == j {
                continue;
            }
            predictors_vec.extend(x.column(j).iter());
        }

        let x_design = DMatrix::from_vec(rows, cols, predictors_vec);
        let xt = x_design.transpose();
        let xtx = &xt * &x_design;

        let var_name = if i < feature_names.len() {
            feature_names[i].clone()
        } else {
            format!("Var_{}", i + 1)
        };

        let (tolerance, vif) = match xtx.try_inverse() {
            Some(xtx_inv) => {
                let xty = &xt * &y_curr;
                let b = &xtx_inv * &xty;

                let y_pred = &x_design * b;
                let y_mean = y_curr.mean();

                let sst: f64 = y_curr.iter().map(|&v| (v - y_mean).powi(2)).sum();
                let sse: f64 = (y_curr - y_pred).iter().map(|&v| v.powi(2)).sum();

                let r_sq = if sst.abs() < 1e-9 {
                    1.0
                } else {
                    1.0 - (sse / sst)
                };

                let r_sq = r_sq.max(0.0).min(1.0);
                let tol = 1.0 - r_sq;
                let v = if tol < 1e-9 { 1000.0 } else { 1.0 / tol };

                (tol, v)
            }
            None => {
                warnings.push(format!(
                    "Singular matrix detected for {}; perfect multicollinearity exists.",
                    var_name
                ));
                (0.0, 999.9)
            }
        };

        results.push(VifRow {
            variable: var_name,
            tolerance,
            vif,
        });
    }

    (results, warnings)
}

/// Menghitung Pearson Correlation Matrix antar-variabel prediktor
pub fn calculate_correlation_matrix(
    x: &DMatrix<f64>,
    feature_names: &[String],
) -> Result<Vec<CorrelationRow>, String> {
    let (rows, cols) = x.shape();
    if rows < 2 {
        return Err("Not enough data points".to_string());
    }

    let mut result_rows = Vec::with_capacity(cols);
    let mut means = Vec::with_capacity(cols);
    let mut std_devs = Vec::with_capacity(cols);

    for j in 0..cols {
        let col = x.column(j);
        let mean = col.mean();
        let variance = col.iter().map(|&v| (v - mean).powi(2)).sum::<f64>() / ((rows - 1) as f64);
        let std_dev = variance.sqrt();
        means.push(mean);
        std_devs.push(std_dev);
    }

    for i in 0..cols {
        let mut row_values = Vec::with_capacity(cols);
        for j in 0..cols {
            if i == j {
                row_values.push(1.0);
            } else {
                let col_i = x.column(i);
                let col_j = x.column(j);

                let mean_i = means[i];
                let mean_j = means[j];
                let sd_i = std_devs[i];
                let sd_j = std_devs[j];

                let covariance: f64 = col_i
                    .iter()
                    .zip(col_j.iter())
                    .map(|(&val_i, &val_j)| (val_i - mean_i) * (val_j - mean_j))
                    .sum::<f64>()
                    / ((rows - 1) as f64);

                let corr = if sd_i.abs() < 1e-9 || sd_j.abs() < 1e-9 {
                    0.0
                } else {
                    covariance / (sd_i * sd_j)
                };

                row_values.push(corr.max(-1.0).min(1.0));
            }
        }

        let var_name = if i < feature_names.len() {
            feature_names[i].clone()
        } else {
            format!("Var_{}", i + 1)
        };

        result_rows.push(CorrelationRow {
            variable: var_name,
            values: row_values,
        });
    }

    Ok(result_rows)
}

/// Menghitung diagnostik multikolinearitas lengkap sesuai binary logistic (VIF + Correlation Matrix)
pub fn compute_collinearity_diagnostics(
    x: &DMatrix<f64>,
    feature_names: &[String],
) -> CollinearityDiagnosticsResult {
    let (vif_rows, mut warnings) = calculate_vif(x, feature_names);
    let corr_matrix = match calculate_correlation_matrix(x, feature_names) {
        Ok(matrix) => matrix,
        Err(err) => {
            warnings.push(err);
            Vec::new()
        }
    };

    CollinearityDiagnosticsResult {
        vif: vif_rows,
        correlation_matrix: corr_matrix,
        warnings,
        rows: Vec::new(),
    }
}

pub fn compute_gvif_diagnostics(
    x: &DMatrix<f64>,
    blocks: Vec<EncodedPredictorBlock>,
    options: GvifOptions,
) -> CollinearityDiagnosticsResult {
    let mut warnings = Vec::new();
    let mut rows = Vec::new();

    if blocks.len() < 2 || x.ncols() < 2 {
        warnings.push(
            "GVIF cannot be computed because at least two encoded predictor columns are required."
                .to_string(),
        );
        return CollinearityDiagnosticsResult { rows, warnings, ..Default::default() };
    }

    let mut kept_columns = Vec::new();
    let mut old_to_new = vec![None; x.ncols()];
    for col in 0..x.ncols() {
        let mean = (0..x.nrows()).map(|row| x[(row, col)]).sum::<f64>() / x.nrows() as f64;
        let ss = (0..x.nrows())
            .map(|row| {
                let centered = x[(row, col)] - mean;
                centered * centered
            })
            .sum::<f64>();
        if ss > 1e-12 && ss.is_finite() {
            old_to_new[col] = Some(kept_columns.len());
            kept_columns.push(col);
        }
    }

    if kept_columns.len() != x.ncols() {
        warnings.push(
            "One or more encoded predictor columns have zero variance and were excluded from GVIF computation."
                .to_string(),
        );
    }

    if kept_columns.len() < 2 {
        warnings.push(
            "GVIF cannot be computed because at least two encoded predictor columns are required."
                .to_string(),
        );
        return CollinearityDiagnosticsResult { rows, warnings, ..Default::default() };
    }

    let filtered_blocks: Vec<EncodedPredictorBlock> = blocks
        .into_iter()
        .filter_map(|block| {
            let column_indices = block
                .column_indices
                .into_iter()
                .filter_map(|idx| old_to_new.get(idx).copied().flatten())
                .collect::<Vec<_>>();
            if column_indices.is_empty() {
                None
            } else {
                Some(EncodedPredictorBlock {
                    column_indices,
                    ..block
                })
            }
        })
        .collect();

    if filtered_blocks.len() < 2 {
        warnings.push(
            "GVIF cannot be computed because at least two encoded predictor columns are required."
                .to_string(),
        );
        return CollinearityDiagnosticsResult { rows, warnings, ..Default::default() };
    }

    let filtered_x = DMatrix::from_fn(x.nrows(), kept_columns.len(), |row, col| {
        x[(row, kept_columns[col])]
    });
    let r = design_correlation_matrix(&filtered_x);
    let mut ridge_warning_added = false;
    let logdet_r = match stable_logdet(&r, options.ridge_lambda, &mut ridge_warning_added) {
        Some(value) => value,
        None => return CollinearityDiagnosticsResult { rows, warnings, ..Default::default() },
    };

    for block in filtered_blocks {
        let block_indices = block.column_indices.clone();
        let other_indices = (0..r.ncols())
            .filter(|idx| !block_indices.contains(idx))
            .collect::<Vec<_>>();
        if other_indices.is_empty() {
            continue;
        }

        let r_block = submatrix(&r, &block_indices);
        let r_other = submatrix(&r, &other_indices);
        let logdet_block = stable_logdet(&r_block, options.ridge_lambda, &mut ridge_warning_added);
        let logdet_other = stable_logdet(&r_other, options.ridge_lambda, &mut ridge_warning_added);
        let (Some(logdet_block), Some(logdet_other)) = (logdet_block, logdet_other) else {
            continue;
        };

        let df = block_indices.len();
        let log_gvif = logdet_block + logdet_other - logdet_r;
        let mut gvif = log_gvif.exp();
        if !gvif.is_finite() {
            continue;
        }
        if gvif < 1.0 && gvif > 0.999_999_999 {
            gvif = 1.0;
        }
        gvif = gvif.max(1.0);
        let adjusted_gvif = gvif.powf(1.0 / (2.0 * df as f64));
        if !adjusted_gvif.is_finite() {
            continue;
        }

        let interpretation = if adjusted_gvif < 2.0 {
            "Safe"
        } else if adjusted_gvif < 5.0 {
            "Attention"
        } else {
            "Serious multicollinearity"
        };

        rows.push(GvifRow {
            predictor: block.predictor_name,
            predictor_type: block.predictor_type,
            df,
            gvif,
            adjusted_gvif,
            interpretation: interpretation.to_string(),
        });
    }

    if ridge_warning_added {
        warnings.push(
            "Correlation matrix was near-singular; a small ridge regularization was applied."
                .to_string(),
        );
    }

    CollinearityDiagnosticsResult { rows, warnings, ..Default::default() }
}

fn design_correlation_matrix(x: &DMatrix<f64>) -> DMatrix<f64> {
    let cols = x.ncols();
    let rows = x.nrows();
    let mut centered = x.clone();
    let mut scales = vec![0.0; cols];

    for col in 0..cols {
        let mean = (0..rows).map(|row| x[(row, col)]).sum::<f64>() / rows as f64;
        let ss = (0..rows)
            .map(|row| {
                centered[(row, col)] = x[(row, col)] - mean;
                centered[(row, col)] * centered[(row, col)]
            })
            .sum::<f64>();
        scales[col] = ss.sqrt();
    }

    DMatrix::from_fn(cols, cols, |i, j| {
        if i == j {
            1.0
        } else if scales[i] > 0.0 && scales[j] > 0.0 {
            let cross = (0..rows)
                .map(|row| centered[(row, i)] * centered[(row, j)])
                .sum::<f64>();
            (cross / (scales[i] * scales[j])).clamp(-1.0, 1.0)
        } else {
            0.0
        }
    })
}

fn stable_logdet(matrix: &DMatrix<f64>, ridge_lambda: f64, ridge_used: &mut bool) -> Option<f64> {
    if matrix.nrows() == 0 {
        return Some(0.0);
    }

    if let Some(logdet) = cholesky_logdet(matrix) {
        if logdet.is_finite() && logdet > 1e-12_f64.ln() {
            return Some(logdet);
        }
    }

    let mut regularized = matrix.clone();
    for idx in 0..regularized.nrows() {
        regularized[(idx, idx)] += ridge_lambda;
    }
    *ridge_used = true;

    if let Some(logdet) = cholesky_logdet(&regularized) {
        return Some(logdet);
    }

    let det = regularized.lu().determinant().abs();
    if det.is_finite() && det > 0.0 {
        Some(det.ln())
    } else {
        None
    }
}

fn cholesky_logdet(matrix: &DMatrix<f64>) -> Option<f64> {
    matrix.clone().cholesky().and_then(|chol| {
        let diag = chol.l().diagonal();
        if diag.iter().any(|value| !value.is_finite() || *value <= 0.0) {
            None
        } else {
            Some(2.0 * diag.iter().map(|value| value.ln()).sum::<f64>())
        }
    })
}

fn submatrix(matrix: &DMatrix<f64>, indices: &[usize]) -> DMatrix<f64> {
    DMatrix::from_fn(indices.len(), indices.len(), |row, col| {
        matrix[(indices[row], indices[col])]
    })
}

pub fn parameter_statistics(
    fit: &FitResult,
    spec: &PlumSpec,
    alpha: f64,
) -> (Vec<ParameterEstimateRow>, Vec<String>) {
    let mut warnings = Vec::new();
    let covariance = match &fit.covariance {
        Some(matrix) => Some(matrix.clone()),
        None => None,
    };

    if covariance.is_none() {
        warnings.push("Covariance matrix tidak tersedia".to_string());
    }

    let mut rows = Vec::new();
    let normal = Normal::new(0.0, 1.0).unwrap();
    let z = normal.inverse_cdf(1.0 - alpha / 2.0);

    let mut idx = 0;
    for j in 0..spec.threshold_count() {
        let estimate = fit.params.theta[j];
        let stats = parameter_row(
            "Threshold",
            &format!("[{} = {}]", spec.response_variable, spec.category_label(j)),
            estimate,
            idx,
            covariance.as_ref(),
            z,
            &mut warnings,
        );
        rows.push(stats);
        idx += 1;
    }

    for (r, name) in spec.feature_names.iter().enumerate() {
        let estimate = fit.params.beta[r];
        let stats = parameter_row(
            "Location",
            name,
            estimate,
            idx,
            covariance.as_ref(),
            z,
            &mut warnings,
        );
        rows.push(stats);
        idx += 1;
    }

    for (s, name) in spec.scale_feature_names.iter().enumerate() {
        if s >= fit.params.tau.len() {
            break;
        }
        let estimate = fit.params.tau[s];
        let stats = parameter_row(
            "Scale",
            name,
            estimate,
            idx,
            covariance.as_ref(),
            z,
            &mut warnings,
        );
        rows.push(stats);
        idx += 1;
    }

    (rows, warnings)
}

fn parameter_row(
    group: &str,
    variable: &str,
    estimate: f64,
    index: usize,
    covariance: Option<&DMatrix<f64>>,
    z: f64,
    warnings: &mut Vec<String>,
) -> ParameterEstimateRow {
    let mut std_error = None;
    let mut wald = None;
    let mut sig = None;
    let mut lower = None;
    let mut upper = None;
    let df = Some(1.0);
    if let Some(covariance) = covariance {
        let diag = covariance[(index, index)];
        if diag.is_finite() && diag > 0.0 {
            let se = diag.sqrt();
            std_error = Some(se);
            if se > 0.0 {
                let w = (estimate / se).powi(2);
                wald = Some(w);
                let chi = ChiSquared::new(1.0).unwrap();
                sig = Some(1.0 - chi.cdf(w));
                lower = Some(estimate - z * se);
                upper = Some(estimate + z * se);
            }
        } else {
            warnings.push("Diagonal covariance negatif".to_string());
        }
    }

    ParameterEstimateRow {
        group: group.to_string(),
        variable: variable.to_string(),
        estimate,
        std_error,
        wald,
        degrees_of_freedom: df,
        sig,
        lower,
        upper,
        is_redundant: Some(false),
    }
}

pub fn model_fit_statistics(
    final_fit: &FitResult,
    intercept_fit: &FitResult,
    spec: &PlumSpec,
    method_label: &str,
    n: f64,
    log_likelihood_constant: f64,
    display_mode: &str,
) -> SummaryStatistics {
    let model_ll_displayed =
        displayed_log_likelihood(final_fit.log_likelihood, log_likelihood_constant, display_mode);
    let intercept_ll_displayed =
        displayed_log_likelihood(intercept_fit.log_likelihood, log_likelihood_constant, display_mode);

    let model = ModelSummaryRow {
        minus2_log_likelihood: -2.0 * model_ll_displayed,
        log_likelihood: model_ll_displayed,
        converged: final_fit.converged,
        iterations: final_fit.iterations,
        method: method_label.to_string(),
    };

    let intercept_only = crate::types::InterceptOnlyRow {
        minus2_log_likelihood: -2.0 * intercept_ll_displayed,
        log_likelihood: intercept_ll_displayed,
    };

    let chi_square = 2.0 * (final_fit.log_likelihood - intercept_fit.log_likelihood);
    let df = (spec.parameter_count() as f64) - (spec.threshold_count() as f64);
    let sig = if df > 0.0 {
        let chi = ChiSquared::new(df).unwrap();
        Some(1.0 - chi.cdf(chi_square))
    } else {
        None
    };

    let model_chi_square = ModelChiSquare {
        chi_square,
        df,
        sig,
    };

    let pseudo_r_square = pseudo_r_squares(final_fit.log_likelihood, intercept_fit.log_likelihood, n);

    SummaryStatistics {
        model,
        intercept_only,
        model_chi_square,
        pseudo_r_square,
    }
}

pub fn pseudo_r_squares(final_ll: f64, intercept_ll: f64, n: f64) -> PseudoRSquare {
    let cox_snell = 1.0 - ((2.0 / n) * (intercept_ll - final_ll)).exp();
    let denom = 1.0 - ((2.0 / n) * intercept_ll).exp();
    let nagelkerke = if denom.abs() > EPS { cox_snell / denom } else { 0.0 };
    let mcfadden = if intercept_ll.abs() > EPS {
        1.0 - (final_ll / intercept_ll)
    } else {
        0.0
    };
    PseudoRSquare {
        cox_snell,
        nagelkerke,
        mcfadden,
    }
}

pub fn goodness_of_fit(
    fit: &FitResult,
    data: &AggregatedData,
    spec: &PlumSpec,
) -> (GoodnessOfFit, Vec<String>) {
    let mut pearson = 0.0;
    let mut deviance = 0.0;
    let mut warnings = Vec::new();

    for subpop in &data.subpopulations {
        let cumulative = cumulative_probabilities(&fit.params, subpop, spec);
        let probs = cell_probabilities(&cumulative);
        for (obs, prob) in subpop.counts.iter().zip(probs.iter()) {
            let expected = subpop.marginal_count * prob;
            if expected > 0.0 {
                pearson += (obs - expected).powi(2) / expected;
            }
            if *obs > 0.0 && expected > 0.0 {
                deviance += 2.0 * obs * (obs / expected).ln();
            }
        }
    }
    deviance = deviance.max(0.0);

    let df = (data.subpopulations.len() as f64) * (spec.category_count as f64 - 1.0)
        - (spec.parameter_count() as f64);
    let sig_pearson = if df > 0.0 {
        let chi = ChiSquared::new(df).unwrap();
        Some(1.0 - chi.cdf(pearson))
    } else {
        warnings.push("df goodness-of-fit <= 0".to_string());
        None
    };
    let sig_deviance = if df > 0.0 {
        let chi = ChiSquared::new(df).unwrap();
        Some(1.0 - chi.cdf(deviance))
    } else {
        None
    };

    (
        GoodnessOfFit {
            pearson: FitStat {
                chi_square: pearson,
                df,
                sig: sig_pearson,
            },
            deviance: FitStat {
                chi_square: deviance,
                df,
                sig: sig_deviance,
            },
        },
        warnings,
    )
}

pub fn predicted_cell_counts(
    fit: &FitResult,
    data: &AggregatedData,
    spec: &PlumSpec,
) -> Vec<CellInfo> {
    let mut rows = Vec::new();
    for (idx, subpop) in data.subpopulations.iter().enumerate() {
        let cumulative = cumulative_probabilities(&fit.params, subpop, spec);
        let probs = cell_probabilities(&cumulative);
        for (cat_idx, prob) in probs.iter().enumerate() {
            let expected = subpop.marginal_count * prob;
            let observed = subpop.counts[cat_idx];
            let residual = observed - expected;
            let std = if expected > 0.0 {
                Some(residual / expected.sqrt())
            } else {
                None
            };
            rows.push(CellInfo {
                subpopulation: idx + 1,
                category: spec.category_label(cat_idx),
                observed,
                predicted: expected,
                residual,
                standardized_residual: std,
                x: subpop.x.clone(),
                z: subpop.z.clone(),
            });
        }
    }
    rows
}

pub fn predicted_probabilities(
    fit: &FitResult,
    data: &AggregatedData,
    spec: &PlumSpec,
) -> Vec<ProbabilityRow> {
    let mut rows = Vec::new();
    for (idx, subpop) in data.subpopulations.iter().enumerate() {
        let cumulative = cumulative_probabilities(&fit.params, subpop, spec);
        let probs = cell_probabilities(&cumulative);
        for (cat_idx, prob) in probs.iter().enumerate() {
            rows.push(ProbabilityRow {
                subpopulation: idx + 1,
                category: spec.category_label(cat_idx),
                probability: *prob,
                x: subpop.x.clone(),
                z: subpop.z.clone(),
            });
        }
    }
    rows
}

pub fn actual_probabilities(
    data: &AggregatedData,
    spec: &PlumSpec,
) -> Vec<ProbabilityRow> {
    let mut rows = Vec::new();
    for (idx, subpop) in data.subpopulations.iter().enumerate() {
        if subpop.marginal_count <= 0.0 {
            continue;
        }
        for (cat_idx, count) in subpop.counts.iter().enumerate() {
            rows.push(ProbabilityRow {
                subpopulation: idx + 1,
                category: spec.category_label(cat_idx),
                probability: count / subpop.marginal_count,
                x: subpop.x.clone(),
                z: subpop.z.clone(),
            });
        }
    }
    rows
}

pub fn predicted_categories(
    fit: &FitResult,
    data: &AggregatedData,
    spec: &PlumSpec,
) -> Vec<crate::types::PredictedCategoryRow> {
    let mut rows = Vec::new();
    for (idx, subpop) in data.subpopulations.iter().enumerate() {
        let cumulative = cumulative_probabilities(&fit.params, subpop, spec);
        let probs = cell_probabilities(&cumulative);
        let mut best_idx = 0;
        let mut best_prob = -1.0;
        for (cat_idx, prob) in probs.iter().enumerate() {
            if *prob > best_prob {
                best_prob = *prob;
                best_idx = cat_idx;
            }
        }
        rows.push(crate::types::PredictedCategoryRow {
            subpopulation: idx + 1,
            category: spec.category_label(best_idx),
            probability: best_prob,
            x: subpop.x.clone(),
            z: subpop.z.clone(),
        });
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;
    use nalgebra::DMatrix;

    #[test]
    fn test_calculate_vif_and_correlation() {
        // Create 2 independent variables that are moderately correlated
        let x = DMatrix::from_row_slice(
            6,
            2,
            &[
                1.0, 2.0,
                2.0, 3.0,
                3.0, 5.0,
                4.0, 7.0,
                5.0, 8.0,
                6.0, 10.0,
            ],
        );
        let names = vec!["X1".to_string(), "X2".to_string()];
        let diag = compute_collinearity_diagnostics(&x, &names);

        assert_eq!(diag.vif.len(), 2);
        assert_eq!(diag.vif[0].variable, "X1");
        assert_eq!(diag.vif[1].variable, "X2");
        assert!(diag.vif[0].vif >= 1.0);
        assert!(diag.vif[0].tolerance <= 1.0 && diag.vif[0].tolerance > 0.0);

        assert_eq!(diag.correlation_matrix.len(), 2);
        assert_eq!(diag.correlation_matrix[0].variable, "X1");
        assert!((diag.correlation_matrix[0].values[0] - 1.0).abs() < 1e-9);
        assert!((diag.correlation_matrix[1].values[1] - 1.0).abs() < 1e-9);
        assert!(diag.correlation_matrix[0].values[1] > 0.9);
    }

    #[test]
    fn test_perfect_multicollinearity_handling() {
        // Perfectly correlated: X2 = 2 * X1
        let x = DMatrix::from_row_slice(
            4,
            2,
            &[
                1.0, 2.0,
                2.0, 4.0,
                3.0, 6.0,
                4.0, 8.0,
            ],
        );
        let names = vec!["A".to_string(), "B".to_string()];
        let diag = compute_collinearity_diagnostics(&x, &names);

        assert_eq!(diag.vif.len(), 2);
        assert_eq!(diag.vif[0].tolerance, 0.0);
        assert_eq!(diag.vif[0].vif, 1000.0);
    }
}

