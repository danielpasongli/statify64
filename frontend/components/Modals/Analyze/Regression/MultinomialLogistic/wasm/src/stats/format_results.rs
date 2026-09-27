use crate::models::config::MultinomialConfig;
use crate::models::result::{
    CellProbabilityItem, ClassificationTable, GoodnessOfFit, LikelihoodRatioTest, MultinomialResult,
    PseudoRSquare, StepwiseStep,
};
use crate::stats::core::PrimaryResults;
use nalgebra::{DMatrix, DVector};
use statrs::distribution::{ChiSquared, ContinuousCDF, Normal};

const LOG_F64_MAX: f64 = 709.782712893384;
const SPSS_UNSTABLE_SE_THRESHOLD: f64 = 1.0e4;

/// Format hasil estimasi ke dalam struct output UI MultinomialResult.
pub fn format_results(
    beta: DVector<f64>,
    var_covar: DMatrix<f64>,
    ll: f64,
    null_ll: f64,
    iters: u32,
    conv: bool,
    primary: &PrimaryResults,
    config: &MultinomialConfig,
    classification: ClassificationTable,
    goodness_of_fit: GoodnessOfFit,
    lr_tests: Vec<LikelihoodRatioTest>,
    stepwise_trace: Vec<StepwiseStep>,
    cell_probabilities: Vec<CellProbabilityItem>,
) -> MultinomialResult {
    let J = primary.n_categories;
    let p = primary.n_params;
    let n = primary.weights.iter().copied().sum::<f64>().max(1.0);
    let normal = Normal::new(0.0, 1.0).unwrap();

    // Z critical value untuk confidence intervals
    let alpha = 1.0 - config.confidence_interval;
    let z_crit = normal.inverse_cdf(1.0 - alpha / 2.0);

    let mut coefficients = vec![vec![0.0f64; p]; J - 1];
    let mut std_errors = vec![vec![0.0f64; p]; J - 1];
    let mut wald_stats = vec![vec![0.0f64; p]; J - 1];
    let mut p_values = vec![vec![0.0f64; p]; J - 1];
    let mut exp_beta = vec![vec![0.0f64; p]; J - 1];
    let mut exp_ci_lower = vec![vec![0.0f64; p]; J - 1];
    let mut exp_ci_upper = vec![vec![0.0f64; p]; J - 1];

    let chi_sq_1 = ChiSquared::new(1.0).unwrap();

    for j in 0..(J - 1) {
        for k in 0..p {
            let idx = j * p + k;
            let coef = beta[idx];
            let base_var = var_covar[(idx, idx)];
            let se = if base_var.is_finite() && base_var >= 0.0 {
                base_var.sqrt()
            } else {
                f64::NAN
            };
            let z = if se.is_finite() && se > 0.0 {
                coef / se
            } else {
                0.0
            };
            let wald = if z.is_finite() { z * z } else { 0.0 }; // SPSS uses Wald = (β/SE)² ~ χ²(1)

            let ci_low = coef - z_crit * se;
            let ci_high = coef + z_crit * se;
            let unstable_estimate = !se.is_finite()
                || se > SPSS_UNSTABLE_SE_THRESHOLD
                || !ci_high.is_finite()
                || ci_high > LOG_F64_MAX
                || ci_low < -LOG_F64_MAX;

            coefficients[j][k] = coef;
            std_errors[j][k] = se;
            wald_stats[j][k] = wald;
            p_values[j][k] = 1.0 - chi_sq_1.cdf(wald.abs());
            // Kembalikan perilaku Exp(B) seperti sebelumnya (sesuai permintaan pengguna).
            let exp_val = coef.exp();
            exp_beta[j][k] = if !exp_val.is_finite() {
                f64::INFINITY
            } else {
                exp_val
            };
            let exp_low = ci_low.exp();
            let exp_high = ci_high.exp();
            exp_ci_lower[j][k] = if unstable_estimate || !exp_low.is_finite() {
                0.0
            } else {
                exp_low
            };
            exp_ci_upper[j][k] = if unstable_estimate || !exp_high.is_finite() {
                f64::INFINITY
            } else {
                exp_high
            };
        }
    }

    // Pseudo R-Square (SPSS-style), computed in numerically stable form.
    // Cox-Snell: 1 - exp((2/n)*(LL0 - LLM))
    // Nagelkerke: Cox-Snell / (1 - exp((2/n)*LL0))
    let cox_exp_term = ((2.0 / n) * (null_ll - ll)).exp();
    let cox_snell = (1.0 - cox_exp_term).clamp(0.0, 1.0);

    let nagelkerke_denom = 1.0 - ((2.0 * null_ll) / n).exp();
    let nagelkerke = if nagelkerke_denom.abs() > 1e-12 {
        (cox_snell / nagelkerke_denom).clamp(0.0, 1.0)
    } else {
        0.0
    };

    let mcfadden = if null_ll.abs() > 1e-12 {
        (1.0 - (ll / null_ll)).clamp(0.0, 1.0)
    } else {
        0.0
    };

    let dim = var_covar.nrows();
    let mut asymptotic_covariance = vec![vec![0.0f64; dim]; dim];
    for r in 0..dim {
        for c in 0..dim {
            asymptotic_covariance[r][c] = var_covar[(r, c)];
        }
    }

    let mut asymptotic_correlation = vec![vec![0.0f64; dim]; dim];
    for r in 0..dim {
        for c in 0..dim {
            let denom = (var_covar[(r, r)] * var_covar[(c, c)]).sqrt();
            asymptotic_correlation[r][c] = if denom > 0.0 {
                var_covar[(r, c)] / denom
            } else {
                0.0
            };
        }
    }

    MultinomialResult {
        coefficients,
        std_errors,
        wald_stats,
        p_values,
        exp_beta,
        exp_ci_lower,
        exp_ci_upper,
        log_likelihood: ll,
        null_log_likelihood: null_ll,
        chi_square: 2.0 * (ll - null_ll),
        df: ((J - 1) * (p - 1)) as u32,
        p_value_model: {
            let df_val = ((J - 1) * (p - 1)) as f64;
            if df_val > 0.0 {
                if let Ok(dist) = ChiSquared::new(df_val) {
                    1.0 - dist.cdf((2.0 * (ll - null_ll)).max(0.0))
                } else {
                    1.0
                }
            } else {
                1.0
            }
        },
        iterations: iters,
        converged: conv,
        pseudo_r_square: PseudoRSquare {
            cox_snell,
            nagelkerke,
            mcfadden,
        },
        goodness_of_fit,
        classification_table: classification,
        likelihood_ratio_tests: lr_tests,
        stepwise_trace,
        asymptotic_covariance,
        asymptotic_correlation,
        cell_probabilities,
    }
}
