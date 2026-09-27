use nalgebra::{DMatrix, DVector};
use statrs::distribution::{ChiSquared, ContinuousCDF};

use crate::links::inverse_link;
use crate::model::scale_sigma;
use crate::optimizer::enforce_threshold_monotonicity;
use crate::optimizer::{starting_values_general, starting_values_location_only};
use crate::stats::statistics::multinomial_log_likelihood_constant;
use crate::types::{
    EstimationOptions, FitResult, IterationHistoryRow, ParallelLinesTest, PlumError,
    PlumParameters, PlumSpec, ScaleType,
};
use crate::utils::{clamp_prob, dot, max_abs_vector, EPS};

#[derive(Clone, Debug)]
struct NonParallelParameters {
    theta: Vec<f64>,
    beta_by_split: Vec<Vec<f64>>,
    tau: Vec<f64>,
}

pub fn fit_non_parallel_location_only(
    data: &crate::types::AggregatedData,
    spec: &PlumSpec,
    options: &EstimationOptions,
    parallel_fit: Option<&FitResult>,
) -> Result<FitResult, PlumError> {
    fit_non_parallel(data, spec, options, parallel_fit)
}

pub fn fit_non_parallel(
    data: &crate::types::AggregatedData,
    spec: &PlumSpec,
    options: &EstimationOptions,
    parallel_fit: Option<&FitResult>,
) -> Result<FitResult, PlumError> {
    let t = spec.threshold_count();
    let p = spec.location_parameter_count();
    let s = spec.scale_parameter_count();

    if spec.category_count < 3 || p == 0 {
        return Err(PlumError::InvalidInput(
            "Test of parallel lines is not applicable because the response has fewer than 3 categories or there are no slope parameters.".to_string(),
        ));
    }

    let (initial_theta, initial_beta, initial_tau) = if let Some(fit) = parallel_fit {
        (fit.params.theta.clone(), fit.params.beta.clone(), fit.params.tau.clone())
    } else {
        let parallel_start = if spec.scale_type == ScaleType::NonConstant {
            let loc_start = starting_values_location_only(data, spec);
            let dummy_fit = FitResult {
                params: loc_start,
                information: None,
                covariance: None,
                correlation: None,
                log_likelihood: 0.0,
                minus2_log_likelihood: 0.0,
                converged: false,
                iterations: 0,
                iteration_history: Vec::new(),
                last_abs_change_minus2_log_likelihood: None,
                last_max_abs_change_parameters: None,
                warnings: Vec::new(),
            };
            starting_values_general(&dummy_fit, spec)
        } else {
            starting_values_location_only(data, spec)
        };
        (parallel_start.theta, parallel_start.beta, parallel_start.tau)
    };

    let mut params = NonParallelParameters {
        theta: initial_theta,
        beta_by_split: vec![initial_beta; t],
        tau: initial_tau,
    };
    apply_non_parallel_threshold_monotonicity(&mut params);

    let mut vec = params_to_vector(&params, spec);
    let mut ll = non_parallel_log_likelihood(&params, data, spec);
    let mut converged = false;
    let mut iterations_run = 0;
    let mut last_abs_change_minus2_log_likelihood = None;
    let mut last_max_abs_change_parameters = None;
    let mut warnings = Vec::new();

    println!(
        "[ORDINAL][PARALLEL_LINES][START] t={}, p={}, total_params={}, max_iter={}",
        t,
        p,
        vec.len(),
        options.max_iterations
    );

    for iter in 0..options.max_iterations {
        let grad = non_parallel_gradient(&params, data, spec);
        let grad_norm = max_abs_vector(&grad);
        if grad_norm < options.gradient_tolerance {
            println!(
                "[ORDINAL][PARALLEL_LINES][CONVERGENCE] Reached gradient tolerance ({:.2e} < {:.2e}) at iteration {}",
                grad_norm, options.gradient_tolerance, iter
            );
            converged = true;
            break;
        }

        let information = non_parallel_expected_information(&params, data, spec);
        let direction = solve_linear_system(&information, &grad).unwrap_or_else(|| {
            warnings.push("Parallel lines general model used gradient fallback because the information matrix was singular.".to_string());
            scaled_gradient_direction(&grad)
        });

        let previous_vec = vec.clone();
        let previous_ll = ll;
        let step =
            non_parallel_step_halving(&vec, &direction, ll, data, spec, options.max_step_halving);

        vec = step.0;
        ll = step.1;
        params = vector_to_params(&vec, t, p, s, spec);
        iterations_run = iter + 1;

        let ll_diff = (ll - previous_ll).abs();
        let delta_max = max_abs_vector(&(vec.clone() - previous_vec));
        last_abs_change_minus2_log_likelihood = Some(ll_diff * 2.0);
        last_max_abs_change_parameters = Some(delta_max);

        println!(
            "[ORDINAL][PARALLEL_LINES][ITER] iter={}, -2LL={:.6}, delta_ll={:.2e}, delta_param={:.2e}, grad_norm={:.2e}",
            iterations_run,
            -2.0 * ll,
            ll_diff,
            delta_max,
            grad_norm
        );

        if ll_diff < options.convergence_tolerance || delta_max < options.parameter_tolerance {
            println!(
                "[ORDINAL][PARALLEL_LINES][CONVERGENCE] Converged at iteration {} (delta_ll={:.2e}, delta_param={:.2e})",
                iterations_run, ll_diff, delta_max
            );
            converged = true;
            break;
        }
    }

    let final_params = params;
    let final_ll = non_parallel_log_likelihood(&final_params, data, spec);

    if !converged {
        warnings.push("The general model may be unstable or failed to converge.".to_string());
    }

    let log_likelihood_constant = multinomial_log_likelihood_constant(data);
    let final_complete_ll = final_ll + log_likelihood_constant;

    println!(
        "[ORDINAL][PARALLEL_LINES][GENERAL_LL] {{\"logLikelihood\":{},\"completeLogLikelihood\":{},\"minus2LogLikelihood\":{},\"minus2CompleteLogLikelihood\":{},\"converged\":{}}}",
        final_ll,
        final_complete_ll,
        -2.0 * final_ll,
        -2.0 * final_complete_ll,
        converged
    );

    Ok(FitResult {
        params: PlumParameters {
            theta: final_params.theta,
            beta: flatten_beta(&final_params.beta_by_split),
            tau: final_params.tau,
        },
        information: None,
        covariance: None,
        correlation: None,
        log_likelihood: final_ll,
        minus2_log_likelihood: -2.0 * final_ll,
        converged,
        iterations: iterations_run,
        iteration_history: Vec::<IterationHistoryRow>::new(),
        last_abs_change_minus2_log_likelihood,
        last_max_abs_change_parameters,
        warnings,
    })
}

pub fn test_parallel_lines(
    parallel_fit: &FitResult,
    non_parallel_fit: &FitResult,
    p: usize,
    j: usize,
) -> ParallelLinesTest {
    let raw_chi_square =
        parallel_fit.minus2_log_likelihood - non_parallel_fit.minus2_log_likelihood;
    let chi_square = if raw_chi_square < 0.0 && raw_chi_square.abs() < 1e-8 {
        0.0
    } else {
        raw_chi_square
    };
    let df = (j as f64 - 2.0) * p as f64;
    let sig = if df > 0.0 {
        let chi = ChiSquared::new(df).unwrap();
        Some(1.0 - chi.cdf(chi_square.max(0.0)))
    } else {
        None
    };

    println!(
        "[ORDINAL][PARALLEL_LINES][RESULT] {{\"parallelMinus2LL\":{:.4},\"generalMinus2LL\":{:.4},\"chiSquare\":{:.4},\"df\":{},\"sig\":{:?},\"converged\":{}}}",
        parallel_fit.minus2_log_likelihood,
        non_parallel_fit.minus2_log_likelihood,
        chi_square,
        df,
        sig,
        non_parallel_fit.converged
    );

    ParallelLinesTest {
        minus2_log_likelihood_parallel: parallel_fit.minus2_log_likelihood,
        minus2_log_likelihood_non_parallel: non_parallel_fit.minus2_log_likelihood,
        chi_square,
        df,
        sig,
        converged: non_parallel_fit.converged,
    }
}

fn params_to_vector(params: &NonParallelParameters, spec: &PlumSpec) -> DVector<f64> {
    let mut values = Vec::with_capacity(
        params.theta.len()
            + params
                .beta_by_split
                .iter()
                .map(|beta| beta.len())
                .sum::<usize>()
            + if spec.scale_type == ScaleType::NonConstant {
                params.tau.len()
            } else {
                0
            },
    );
    values.extend_from_slice(&params.theta);
    for beta in &params.beta_by_split {
        values.extend_from_slice(beta);
    }
    if spec.scale_type == ScaleType::NonConstant {
        values.extend_from_slice(&params.tau);
    }
    DVector::from_vec(values)
}

fn vector_to_params(
    vec: &DVector<f64>,
    threshold_count: usize,
    p: usize,
    s: usize,
    spec: &PlumSpec,
) -> NonParallelParameters {
    let theta = vec.rows(0, threshold_count).iter().cloned().collect();
    let mut beta_by_split = Vec::with_capacity(threshold_count);
    for split in 0..threshold_count {
        let start = threshold_count + split * p;
        beta_by_split.push(vec.rows(start, p).iter().cloned().collect());
    }
    let tau = if spec.scale_type == ScaleType::NonConstant && s > 0 {
        let start = threshold_count + threshold_count * p;
        vec.rows(start, s).iter().cloned().collect()
    } else {
        Vec::new()
    };
    let mut params = NonParallelParameters {
        theta,
        beta_by_split,
        tau,
    };
    apply_non_parallel_threshold_monotonicity(&mut params);
    params
}

fn flatten_beta(beta_by_split: &[Vec<f64>]) -> Vec<f64> {
    let mut beta = Vec::new();
    for split_beta in beta_by_split {
        beta.extend_from_slice(split_beta);
    }
    beta
}

fn apply_non_parallel_threshold_monotonicity(params: &mut NonParallelParameters) {
    enforce_threshold_monotonicity(&mut params.theta);
}

fn non_parallel_log_likelihood(
    params: &NonParallelParameters,
    data: &crate::types::AggregatedData,
    spec: &PlumSpec,
) -> f64 {
    let mut ll = 0.0;
    for subpop in &data.subpopulations {
        let pi = non_parallel_cell_probabilities(params, &subpop.x, &subpop.z, spec);
        for (count, prob) in subpop.counts.iter().zip(pi.iter()) {
            if *count > 0.0 {
                ll += count * prob.max(EPS).ln();
            }
        }
    }
    ll
}

fn non_parallel_cell_probabilities(
    params: &NonParallelParameters,
    x: &[f64],
    z: &[f64],
    spec: &PlumSpec,
) -> Vec<f64> {
    let t = spec.threshold_count();
    let mut gamma = Vec::with_capacity(t);
    let sigma = scale_sigma(z, &params.tau, spec.scale_type);

    for split in 0..t {
        let eta = (params.theta[split] - dot(x, &params.beta_by_split[split])) / sigma;
        let mut value = clamp_prob(inverse_link(eta, spec.link_function));
        if split > 0 && value <= gamma[split - 1] {
            value = (gamma[split - 1] + EPS).min(1.0 - EPS);
        }
        gamma.push(value);
    }

    let mut pi = vec![0.0; t + 1];
    pi[0] = clamp_prob(gamma[0]);
    for idx in 1..t {
        pi[idx] = clamp_prob(gamma[idx] - gamma[idx - 1]);
    }
    pi[t] = clamp_prob(1.0 - gamma[t - 1]);

    let sum: f64 = pi.iter().sum();
    if sum > EPS {
        for value in &mut pi {
            *value = clamp_prob(*value / sum);
        }
    }
    pi
}

/// Analytical gradient computation for the general (non-parallel) model.
/// Dimension: K = T (thresholds) + T * P (slopes per split) + S (optional scale).
fn non_parallel_gradient(
    params: &NonParallelParameters,
    data: &crate::types::AggregatedData,
    spec: &PlumSpec,
) -> DVector<f64> {
    let t = spec.threshold_count();
    let p = spec.location_parameter_count();
    let s = if spec.scale_type == ScaleType::NonConstant {
        spec.scale_parameter_count()
    } else {
        0
    };
    let k = t + t * p + s;
    let mut grad = DVector::zeros(k);

    for subpop in &data.subpopulations {
        let sigma = scale_sigma(&subpop.z, &params.tau, spec.scale_type);
        let mut eta = Vec::with_capacity(t);
        let mut gprime = Vec::with_capacity(t);

        for j in 0..t {
            let eta_j = (params.theta[j] - dot(&subpop.x, &params.beta_by_split[j])) / sigma;
            eta.push(eta_j);
            gprime.push(crate::links::d_inverse_link(eta_j, spec.link_function));
        }

        let pi = non_parallel_cell_probabilities(params, &subpop.x, &subpop.z, spec);

        for param_index in 0..k {
            let mut dgamma = vec![0.0; t];
            if param_index < t {
                let j = param_index;
                dgamma[j] = gprime[j] / sigma;
            } else if param_index < t + t * p {
                let offset = param_index - t;
                let split = offset / p;
                let r = offset % p;
                dgamma[split] = -gprime[split] * subpop.x[r] / sigma;
            } else if s > 0 {
                let s_idx = param_index - t - t * p;
                let coeff = -subpop.z[s_idx];
                for j in 0..t {
                    dgamma[j] = gprime[j] * coeff * eta[j];
                }
            }

            let mut dpi = vec![0.0; t + 1];
            if t > 0 {
                dpi[0] = dgamma[0];
                for j in 1..t {
                    dpi[j] = dgamma[j] - dgamma[j - 1];
                }
                dpi[t] = -dgamma[t - 1];
            }

            let mut sum = 0.0;
            for idx in 0..subpop.counts.len() {
                let count = subpop.counts[idx];
                if count > 0.0 {
                    let prob = if pi[idx] > EPS { pi[idx] } else { EPS };
                    sum += count * dpi[idx] / prob;
                }
            }
            grad[param_index] += sum;
        }
    }

    grad
}

/// Analytical expected Fisher information matrix for the general (non-parallel) model.
/// Dimension: K x K where K = T + T * P + S.
fn non_parallel_expected_information(
    params: &NonParallelParameters,
    data: &crate::types::AggregatedData,
    spec: &PlumSpec,
) -> DMatrix<f64> {
    let t = spec.threshold_count();
    let p = spec.location_parameter_count();
    let s = if spec.scale_type == ScaleType::NonConstant {
        spec.scale_parameter_count()
    } else {
        0
    };
    let k = t + t * p + s;
    let mut info = DMatrix::zeros(k, k);

    for subpop in &data.subpopulations {
        let m = subpop.marginal_count;
        if m <= 0.0 {
            continue;
        }

        let sigma = scale_sigma(&subpop.z, &params.tau, spec.scale_type);
        let mut eta = Vec::with_capacity(t);
        let mut gprime = Vec::with_capacity(t);

        for j in 0..t {
            let eta_j = (params.theta[j] - dot(&subpop.x, &params.beta_by_split[j])) / sigma;
            eta.push(eta_j);
            gprime.push(crate::links::d_inverse_link(eta_j, spec.link_function));
        }

        let pi = non_parallel_cell_probabilities(params, &subpop.x, &subpop.z, spec);

        let mut dpis = Vec::with_capacity(k);
        for param_index in 0..k {
            let mut dgamma = vec![0.0; t];
            if param_index < t {
                let j = param_index;
                dgamma[j] = gprime[j] / sigma;
            } else if param_index < t + t * p {
                let offset = param_index - t;
                let split = offset / p;
                let r = offset % p;
                dgamma[split] = -gprime[split] * subpop.x[r] / sigma;
            } else if s > 0 {
                let s_idx = param_index - t - t * p;
                let coeff = -subpop.z[s_idx];
                for j in 0..t {
                    dgamma[j] = gprime[j] * coeff * eta[j];
                }
            }

            let mut dpi = vec![0.0; t + 1];
            if t > 0 {
                dpi[0] = dgamma[0];
                for j in 1..t {
                    dpi[j] = dgamma[j] - dgamma[j - 1];
                }
                dpi[t] = -dgamma[t - 1];
            }
            dpis.push(dpi);
        }

        let cat_len = t + 1;
        for c in 0..cat_len {
            let prob = if pi[c] > EPS { pi[c] } else { EPS };
            let weight = m / prob;
            for a in 0..k {
                let dpi_a = dpis[a][c];
                if dpi_a.abs() < 1e-15 {
                    continue;
                }
                for b in a..k {
                    let dpi_b = dpis[b][c];
                    if dpi_b.abs() < 1e-15 {
                        continue;
                    }
                    let val = weight * dpi_a * dpi_b;
                    info[(a, b)] += val;
                }
            }
        }
    }

    for a in 0..k {
        for b in 0..a {
            info[(a, b)] = info[(b, a)];
        }
    }

    if max_abs_vector(&info.diagonal().clone_owned()) == 0.0 {
        info += DMatrix::identity(k, k) * 1e-12;
    }

    info
}

fn solve_linear_system(matrix: &DMatrix<f64>, gradient: &DVector<f64>) -> Option<DVector<f64>> {
    let mut info = matrix.clone();
    let mut ridge = 1e-8;
    for _ in 0..5 {
        if let Some(solution) = info.clone().lu().solve(gradient) {
            if solution.iter().all(|value| value.is_finite()) {
                return Some(solution);
            }
        }
        let n = info.nrows();
        for i in 0..n {
            info[(i, i)] += ridge;
        }
        ridge *= 10.0;
    }
    None
}

fn scaled_gradient_direction(gradient: &DVector<f64>) -> DVector<f64> {
    let max_grad = max_abs_vector(gradient).max(1.0);
    gradient / max_grad
}

fn non_parallel_step_halving(
    current: &DVector<f64>,
    direction: &DVector<f64>,
    current_ll: f64,
    data: &crate::types::AggregatedData,
    spec: &PlumSpec,
    max_step_halving: usize,
) -> (DVector<f64>, f64) {
    let t = spec.threshold_count();
    let p = spec.location_parameter_count();
    let s = spec.scale_parameter_count();
    let mut step = 1.0;
    let mut best_vec = current.clone();
    let mut best_ll = current_ll;

    for _ in 0..max_step_halving.max(1) {
        let candidate = current + direction * step;
        let candidate_params = vector_to_params(&candidate, t, p, s, spec);
        let candidate_vec = params_to_vector(&candidate_params, spec);
        let candidate_ll = non_parallel_log_likelihood(&candidate_params, data, spec);

        if candidate_ll.is_finite() && candidate_ll >= best_ll {
            best_vec = candidate_vec;
            best_ll = candidate_ll;
            break;
        }
        step *= 0.5;
    }

    (best_vec, best_ll)
}
