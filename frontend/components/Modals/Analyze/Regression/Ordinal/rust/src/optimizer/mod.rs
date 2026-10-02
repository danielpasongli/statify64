pub mod parallel;

use nalgebra::{DMatrix, DVector};

use crate::derivatives::{expected_information, gradient, hessian};
use crate::likelihood::log_likelihood;
use crate::types::{
    EstimationMethod, EstimationOptions, FitResult, IterationHistoryOptions, IterationHistoryRow,
    IterationState, PlumError, PlumParameters, PlumSpec, ScaleType, StepResult,
};
use crate::utils::{clamp_prob, max_abs_vector};

pub fn fit_plum(
    data: &crate::types::AggregatedData,
    spec: &PlumSpec,
    options: &EstimationOptions,
    history_options: &IterationHistoryOptions,
) -> Result<FitResult, PlumError> {
    if spec.is_location_only() {
        fit_location_only(data, spec, options, history_options)
    } else {
        fit_general(data, spec, options, history_options)
    }
}

pub fn fit_location_only(
    data: &crate::types::AggregatedData,
    spec: &PlumSpec,
    options: &EstimationOptions,
    history_options: &IterationHistoryOptions,
) -> Result<FitResult, PlumError> {
    let mut params = starting_values_location_only(data, spec);
    let mut history = Vec::new();
    let warnings = Vec::new();
    let mut converged = false;
    let mut iterations_run = 0;
    let mut last_abs_change_minus2_log_likelihood = None;
    let mut last_max_abs_change_parameters = None;
    let mut last_step_halvings = 0;
    let history_every = history_options.every.max(1);

    let mut prev_state: Option<IterationState> = None;

    let initial_ll = log_likelihood(&params, data, spec);
    if history_options.enabled {
        push_iteration_history(&mut history, 0, 0, initial_ll, &params);
    }

    for iter in 0..options.max_iterations {
        let ll = log_likelihood(&params, data, spec);
        let grad = gradient(&params, data, spec);

        let information = match options.method {
            EstimationMethod::FisherScoring => expected_information(&params, data, spec),
            EstimationMethod::NewtonRaphson => -hessian(&params, data, spec),
        };

        let delta = solve_linear_system(&information, &grad)
            .ok_or_else(|| PlumError::OptimizationError("Matrix singular".to_string()))?;

        let step_result = step_halving(&params, &delta, ll, data, spec, options);

        params = step_result.params.clone();
        iterations_run = iter + 1;
        last_step_halvings = step_result.step_halving_count;

        let next_state = IterationState {
            log_likelihood: step_result.log_likelihood,
            params: params.clone(),
            gradient: grad.clone(),
        };

        if let Some(prev) = &prev_state {
            let ll_diff = (next_state.log_likelihood - prev.log_likelihood).abs();
            let delta_max = max_parameter_delta(&prev.params, &next_state.params);
            last_abs_change_minus2_log_likelihood = Some(ll_diff * 2.0);
            last_max_abs_change_parameters = Some(delta_max);
            if has_converged(prev, &next_state, options) {
                converged = true;
                break;
            }
        }
        prev_state = Some(next_state);

        if history_options.enabled && (iterations_run % history_every == 0) {
            push_iteration_history(
                &mut history,
                iterations_run,
                step_result.step_halving_count,
                step_result.log_likelihood,
                &params,
            );
        }
    }

    let final_ll = log_likelihood(&params, data, spec);
    let final_information = match options.method {
        EstimationMethod::FisherScoring => expected_information(&params, data, spec),
        EstimationMethod::NewtonRaphson => -hessian(&params, data, spec),
    };
    let info_matrix = Some(final_information);

    if history_options.enabled {
        let final_iteration = iterations_run;
        let last_logged = history.last().map(|row| row.iteration);
        if last_logged != Some(final_iteration) {
            push_iteration_history(
                &mut history,
                final_iteration,
                last_step_halvings,
                final_ll,
                &params,
            );
        }
    }

    Ok(FitResult {
        params,
        information: info_matrix,
        covariance: None,
        correlation: None,
        log_likelihood: final_ll,
        minus2_log_likelihood: -2.0 * final_ll,
        converged,
        iterations: iterations_run,
        iteration_history: history,
        last_abs_change_minus2_log_likelihood,
        last_max_abs_change_parameters,
        warnings,
    })
}

pub fn fit_general(
    data: &crate::types::AggregatedData,
    spec: &PlumSpec,
    options: &EstimationOptions,
    history_options: &IterationHistoryOptions,
) -> Result<FitResult, PlumError> {
    let location_spec = spec.as_location_only();
    let history_off = IterationHistoryOptions::disabled();
    let location_fit = fit_location_only(data, &location_spec, options, &history_off)?;
    let mut params = starting_values_general(&location_fit, spec);

    let mut history = Vec::new();
    let warnings = Vec::new();
    let mut converged = false;
    let mut prev_state: Option<IterationState> = None;
    let mut iterations_run = 0;
    let mut last_abs_change_minus2_log_likelihood = None;
    let mut last_max_abs_change_parameters = None;
    let mut last_step_halvings = 0;
    let history_every = history_options.every.max(1);

    let initial_ll = log_likelihood(&params, data, spec);
    if history_options.enabled {
        push_iteration_history(&mut history, 0, 0, initial_ll, &params);
    }

    for iter in 0..options.max_iterations {
        let ll = log_likelihood(&params, data, spec);
        let grad = gradient(&params, data, spec);

        let information = match options.method {
            EstimationMethod::FisherScoring => expected_information(&params, data, spec),
            EstimationMethod::NewtonRaphson => -hessian(&params, data, spec),
        };

        let delta = solve_linear_system(&information, &grad)
            .ok_or_else(|| PlumError::OptimizationError("Matrix singular".to_string()))?;

        let step_result = step_halving(&params, &delta, ll, data, spec, options);

        params = step_result.params.clone();
        iterations_run = iter + 1;
        last_step_halvings = step_result.step_halving_count;

        let next_state = IterationState {
            log_likelihood: step_result.log_likelihood,
            params: params.clone(),
            gradient: grad.clone(),
        };

        if let Some(prev) = &prev_state {
            let ll_diff = (next_state.log_likelihood - prev.log_likelihood).abs();
            let delta_max = max_parameter_delta(&prev.params, &next_state.params);
            last_abs_change_minus2_log_likelihood = Some(ll_diff * 2.0);
            last_max_abs_change_parameters = Some(delta_max);
            if has_converged(prev, &next_state, options) {
                converged = true;
                break;
            }
        }
        prev_state = Some(next_state);

        if history_options.enabled && (iterations_run % history_every == 0) {
            push_iteration_history(
                &mut history,
                iterations_run,
                step_result.step_halving_count,
                step_result.log_likelihood,
                &params,
            );
        }
    }

    let final_ll = log_likelihood(&params, data, spec);
    let final_information = match options.method {
        EstimationMethod::FisherScoring => expected_information(&params, data, spec),
        EstimationMethod::NewtonRaphson => -hessian(&params, data, spec),
    };
    let info_matrix = Some(final_information);

    if history_options.enabled {
        let final_iteration = iterations_run;
        let last_logged = history.last().map(|row| row.iteration);
        if last_logged != Some(final_iteration) {
            push_iteration_history(
                &mut history,
                final_iteration,
                last_step_halvings,
                final_ll,
                &params,
            );
        }
    }

    Ok(FitResult {
        params,
        information: info_matrix,
        covariance: None,
        correlation: None,
        log_likelihood: final_ll,
        minus2_log_likelihood: -2.0 * final_ll,
        converged,
        iterations: iterations_run,
        iteration_history: history,
        last_abs_change_minus2_log_likelihood,
        last_max_abs_change_parameters,
        warnings,
    })
}

pub fn starting_values_location_only(
    data: &crate::types::AggregatedData,
    spec: &PlumSpec,
) -> PlumParameters {
    let mut theta = Vec::with_capacity(spec.threshold_count());
    let mut cumulative = vec![0.0; spec.threshold_count()];
    let mut running = 0.0;
    for j in 0..spec.threshold_count() {
        let mut total = 0.0;
        for subpop in &data.subpopulations {
            total += subpop.counts[j];
        }
        running += total;
        cumulative[j] = running / data.total_count.max(1.0);
    }

    for value in cumulative {
        let value = clamp_prob(value);
        theta.push(crate::links::link(value, spec.link_function));
    }

    PlumParameters {
        theta,
        beta: vec![0.0; spec.location_parameter_count()],
        tau: Vec::new(),
    }
}

pub fn starting_values_general(location_fit: &FitResult, spec: &PlumSpec) -> PlumParameters {
    let mut params = location_fit.params.clone();
    if spec.scale_type == ScaleType::NonConstant {
        params.tau = vec![0.0; spec.scale_parameter_count()];
    }
    params
}

pub fn enforce_threshold_monotonicity(theta: &mut [f64]) -> usize {
    if theta.len() <= 1 {
        return 0;
    }
    let mut adjustments = 0;
    let mut changed = true;
    while changed {
        changed = false;
        for j in 0..theta.len() - 1 {
            if theta[j] > theta[j + 1] {
                let avg = (theta[j] + theta[j + 1]) / 2.0;
                theta[j] = avg;
                theta[j + 1] = avg;
                adjustments += 1;
                changed = true;
            }
        }
    }
    adjustments
}

pub fn apply_threshold_monotonicity_adjustment(params: &mut PlumParameters) -> usize {
    enforce_threshold_monotonicity(&mut params.theta)
}

pub fn step_halving(
    current_params: &PlumParameters,
    delta: &DVector<f64>,
    current_ll: f64,
    data: &crate::types::AggregatedData,
    spec: &PlumSpec,
    options: &EstimationOptions,
) -> StepResult {
    let mut step = 1.0;
    let mut best_params = current_params.clone();
    let mut best_ll = current_ll;
    let mut best_delta = delta.clone();
    let mut best_adjustments = 0;
    let mut step_halving_count = 0;

    for _ in 0..options.max_step_halving {
        let candidate = current_params.to_vector(spec) + delta * step;
        let mut params = PlumParameters::from_vector(&candidate, spec);
        let adjustments = apply_threshold_monotonicity_adjustment(&mut params);
        let ll = log_likelihood(&params, data, spec);
        if ll.is_finite() && ll >= best_ll {
            best_params = params;
            best_ll = ll;
            best_delta = delta.clone() * step;
            best_adjustments = adjustments;
            break;
        }
        step *= 0.5;
        step_halving_count += 1;
    }

    StepResult {
        params: best_params,
        log_likelihood: best_ll,
        step,
        step_halving_count,
        threshold_adjustments: best_adjustments,
        delta: best_delta,
    }
}

fn push_iteration_history(
    history: &mut Vec<IterationHistoryRow>,
    iteration: usize,
    step_halvings: usize,
    log_likelihood: f64,
    params: &PlumParameters,
) {
    history.push(IterationHistoryRow {
        iteration,
        step_halvings,
        minus2_log_likelihood: -2.0 * log_likelihood,
        minus2_log_likelihood_displayed: -2.0 * log_likelihood,
        threshold: params.theta.clone(),
        location: params.beta.clone(),
        scale: params.tau.clone(),
    });
}

pub fn has_converged(
    prev: &IterationState,
    next: &IterationState,
    options: &EstimationOptions,
) -> bool {
    let ll_diff = (next.log_likelihood - prev.log_likelihood).abs();
    let grad_max = max_abs_vector(&next.gradient);
    let delta_max = max_parameter_delta(&prev.params, &next.params);
    ll_diff < options.convergence_tolerance
        || grad_max < options.gradient_tolerance
        || delta_max < options.parameter_tolerance
}

fn max_parameter_delta(prev: &PlumParameters, next: &PlumParameters) -> f64 {
    let mut max_delta: f64 = 0.0;
    for (a, b) in prev.theta.iter().zip(next.theta.iter()) {
        max_delta = max_delta.max((a - b).abs());
    }
    for (a, b) in prev.beta.iter().zip(next.beta.iter()) {
        max_delta = max_delta.max((a - b).abs());
    }
    for (a, b) in prev.tau.iter().zip(next.tau.iter()) {
        max_delta = max_delta.max((a - b).abs());
    }
    max_delta
}

fn solve_linear_system(matrix: &DMatrix<f64>, gradient: &DVector<f64>) -> Option<DVector<f64>> {
    let mut info = matrix.clone();
    let mut ridge = 1e-8;
    for _ in 0..3 {
        if let Some(solution) = info.clone().lu().solve(gradient) {
            return Some(solution);
        }
        let n = info.nrows();
        for i in 0..n {
            info[(i, i)] += ridge;
        }
        ridge *= 10.0;
    }
    None
}
