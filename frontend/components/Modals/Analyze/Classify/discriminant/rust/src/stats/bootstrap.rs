//! Bootstrap resampling for discriminant analysis.
//!
//! Implements case resampling (simple or stratified-by-group) with a seeded
//! Mersenne Twister, re-fits the canonical discriminant functions on each
//! resample, and summarises the standardized canonical discriminant function
//! coefficients with Bias, Std. Error and a confidence interval (Percentile or
//! BCa) — mirroring SPSS's "Bootstrap" output for those coefficients.
//!
//! Notes / scope:
//! - The model (selected variable set) is held fixed at the main analysis's
//!   selection; resampling perturbs the coefficient estimates, not the variable
//!   selection. This matches the common "bootstrap the fitted model" approach.
//! - Discriminant function signs are arbitrary per fit, and functions whose
//!   eigenvalues are close can come out in a different order, so every refit is
//!   matched to the original functions (reordered and reflected) before its
//!   coefficients are pooled — without this the bootstrap distribution would be
//!   meaningless (bimodal ±, or a mix of two functions).

use std::collections::HashMap;

use nalgebra::DMatrix;
use rand_mt::Mt;
use statrs::distribution::{ContinuousCDF, Normal};

use crate::models::{
    data::DataValue,
    result::{BootstrapCoefficient, BootstrapResults},
    AnalysisData, DiscriminantConfig,
};

use super::core::{
    calculate_between_groups_sscp, calculate_group_means, calculate_overall_means,
    calculate_pooled_within_matrix, extract_analyzed_dataset, get_stepwise_selected_variables,
    group_row_indices, process_discriminant_coefficients, push_analysis_warning,
    solve_eigenvalue_problem, AnalyzedDataset,
};

/// One resampled/observed case: its group label, the stratum it is drawn from
/// under stratified sampling, and predictor values (in the same order as the
/// variable list of the model).
#[derive(Clone)]
struct Case {
    group: String,
    stratum: String,
    values: Vec<f64>,
}

/// Top-level bootstrap entry point. Returns `Err` when bootstrap is not
/// requested or the data is insufficient for a stable fit.
pub fn calculate_bootstrap(
    data: &AnalysisData,
    config: &DiscriminantConfig,
) -> Result<BootstrapResults, String> {
    if !config.bootstrap.perform_boot_strapping {
        return Err("Bootstrap not requested".to_string());
    }

    let n_samples = config.bootstrap.num_of_samples;
    if n_samples <= 0 {
        return Err("Number of bootstrap samples must be greater than 0".to_string());
    }

    let dataset = extract_analyzed_dataset(data, config)?;
    let variables = get_stepwise_selected_variables(data, config)?;
    if variables.is_empty() {
        return Err("No variables available for bootstrap".to_string());
    }

    let num_functions = std::cmp::min(dataset.num_groups.saturating_sub(1), variables.len());
    if num_functions == 0 {
        return Err("No discriminant functions available for bootstrap".to_string());
    }

    // Original solution — reference for function matching, bias and BCa.
    let (orig_unstd, orig_std) = canonical_coeffs_from_dataset(&dataset, &variables, num_functions)
        .ok_or_else(|| "Failed to compute original canonical coefficients".to_string())?;
    let reference = MatchReference {
        functions: function_vectors(&orig_unstd, &variables, num_functions),
        pooled: calculate_pooled_within_matrix(&dataset, &variables),
    };

    let mut cases = extract_cases(&dataset, &variables);

    // Strata Variables (bootstrap dialog): when the user picked any, the strata
    // are the crossed cells of those variables, as in the SPSS syntax
    // /SAMPLING METHOD=STRATIFIED STRATA=varlist. With none picked the stratum
    // stays the grouping variable, which is what extract_cases set.
    let mut strata_labels: Vec<String> = Vec::new();
    if config.bootstrap.stratified {
        let wanted: Vec<String> = config
            .bootstrap
            .strata_variables
            .clone()
            .unwrap_or_default()
            .into_iter()
            .filter(|v| !v.trim().is_empty())
            .collect();

        if !wanted.is_empty() {
            match strata_keys_for_cases(data, config, &dataset, &wanted) {
                Some(keyed)
                    if keyed.len() == cases.len() &&
                        keyed
                            .iter()
                            .zip(cases.iter())
                            .all(|((g, _), c)| g == &c.group) => {
                    for (case, (_, key)) in cases.iter_mut().zip(keyed.into_iter()) {
                        case.stratum = key;
                    }
                    strata_labels = wanted;
                }
                _ => {
                    push_analysis_warning(
                        "Warning: calculate_bootstrap",
                        "Strata variable values could not be matched to the analysis cases, so the bootstrap was stratified by the grouping variable instead."
                            .to_string(),
                    );
                }
            }
        }
    }

    // Mersenne Twister, seeded when the user set a seed.
    let seed: u32 = if config.bootstrap.seed {
        config.bootstrap.seed_value as u32
    } else {
        rand::random::<u32>()
    };
    let mut rng = Mt::new(seed);

    let stratified = config.bootstrap.stratified;
    let p = variables.len();

    // samples[var][function] = bootstrap estimates of the standardized coefficient.
    let mut samples: Vec<Vec<Vec<f64>>> =
        vec![vec![Vec::with_capacity(n_samples as usize); num_functions]; p];

    let mut valid_samples: i32 = 0;
    let mut skipped_samples: i32 = 0;
    let mut reordered_samples: i32 = 0;

    for _ in 0..n_samples {
        let resampled = if stratified {
            resample_stratified(&cases, &mut rng)
        } else {
            resample_simple(&cases, &mut rng)
        };

        let ds = dataset_from_cases(&resampled, &variables, &dataset.group_labels);
        // A resample that lost a group cannot support num_functions functions:
        // fitting it anyway yields an arbitrary extra function and inflates the
        // Std. Error and the CI. Such resamples are dropped, and the number of
        // resamples actually used is reported with the table.
        if ds.num_groups != dataset.num_groups {
            skipped_samples += 1;
            continue;
        }

        if let Some((unstd, std)) = canonical_coeffs_from_dataset(&ds, &variables, num_functions) {
            valid_samples += 1;
            let matching = match_to_original(
                &reference,
                &function_vectors(&unstd, &variables, num_functions),
            );
            if matching.order.iter().enumerate().any(|(f, &k)| f != k) {
                reordered_samples += 1;
            }
            for (vi, var) in variables.iter().enumerate() {
                if let Some(coefs) = std.get(var) {
                    for f in 0..num_functions {
                        let val =
                            coefs.get(matching.order[f]).copied().unwrap_or(0.0) * matching.signs[f];
                        samples[vi][f].push(val);
                    }
                }
            }
        } else {
            skipped_samples += 1;
        }
    }

    if skipped_samples > 0 {
        push_analysis_warning(
            "Warning: calculate_bootstrap",
            format!(
                "{} of {} bootstrap samples were dropped because a group was lost in the resample or the functions could not be fitted. The results are based on the remaining {}.",
                skipped_samples,
                n_samples,
                valid_samples
            ),
        );
    }

    let use_bca = config.bootstrap.bca;
    let level = if config.bootstrap.level > 0.0 {
        config.bootstrap.level
    } else {
        95.0
    };
    let alpha = 1.0 - level / 100.0;

    // Jackknife acceleration per (variable, function) for BCa.
    let accel = if use_bca {
        Some(jackknife_acceleration(
            &cases,
            &variables,
            &dataset.group_labels,
            num_functions,
            &reference,
        ))
    } else {
        None
    };

    let mut standardized = Vec::with_capacity(p);
    for (vi, var) in variables.iter().enumerate() {
        let mut original = vec![0.0; num_functions];
        let mut bias = vec![0.0; num_functions];
        let mut std_error = vec![0.0; num_functions];
        let mut ci_lower = vec![0.0; num_functions];
        let mut ci_upper = vec![0.0; num_functions];

        for f in 0..num_functions {
            let orig = orig_std.get(var).and_then(|c| c.get(f)).copied().unwrap_or(0.0);
            original[f] = orig;

            let est = &samples[vi][f];
            if est.is_empty() {
                continue;
            }

            // Bias = mean of the B estimates − original estimate; Std. Error = their
            // standard deviation.
            let mean = est.iter().sum::<f64>() / est.len() as f64;
            bias[f] = mean - orig;
            std_error[f] = std_dev(est, mean);

            let (lo, hi) = if use_bca {
                let a = accel.as_ref().map(|m| m[vi][f]).unwrap_or(0.0);
                bca_interval(est, orig, a, alpha)
            } else {
                percentile_interval(est, alpha)
            };
            ci_lower[f] = lo;
            ci_upper[f] = hi;
        }

        standardized.push(BootstrapCoefficient {
            variable: var.clone(),
            original,
            bias,
            std_error,
            ci_lower,
            ci_upper,
        });
    }

    let functions: Vec<String> = (1..=num_functions)
        .map(|i| format!("Function {}", i))
        .collect();

    Ok(BootstrapResults {
        num_samples: n_samples,
        valid_samples,
        reordered_samples,
        level,
        ci_method: if use_bca { "BCa".to_string() } else { "Percentile".to_string() },
        sampling: if stratified { "Stratified".to_string() } else { "Simple".to_string() },
        strata_variables: strata_labels,
        functions,
        variables,
        standardized,
    })
}

/// Fit the canonical discriminant functions on a dataset and return the
/// (unstandardized, standardized) coefficient maps. Mirrors the math of
/// `calculate_eigen_statistics` + `calculate_canonical_functions` but operates
/// directly on an `AnalyzedDataset` (no I/O, no stepwise) so it can be called
/// thousands of times cheaply. Returns `None` if the fit is not possible.
fn canonical_coeffs_from_dataset(
    dataset: &AnalyzedDataset,
    variables: &[String],
    num_functions: usize,
) -> Option<(HashMap<String, Vec<f64>>, HashMap<String, Vec<f64>>)> {
    let df_within = dataset.total_cases as i64 - dataset.num_groups as i64;
    if df_within <= 0 || num_functions == 0 {
        return None;
    }

    let pooled = calculate_pooled_within_matrix(dataset, variables);
    let between = calculate_between_groups_sscp(dataset, variables);

    // Raw within SSCP = pooled covariance * df_within.
    let mut w_sscp = pooled.clone();
    w_sscp *= df_within as f64;

    let (_eigenvalues, eigenvectors) = solve_eigenvalue_problem(&w_sscp, &between, num_functions);

    // Scale eigenvectors by sqrt(df_within), matching calculate_eigen_statistics.
    let scale = (df_within as f64).sqrt();
    let scaled: Vec<Vec<f64>> = eigenvectors
        .iter()
        .map(|row| row.iter().map(|v| v * scale).collect())
        .collect();

    let (unstd, std) = process_discriminant_coefficients(
        &scaled,
        variables,
        &pooled,
        &dataset.overall_means,
        num_functions,
    );

    Some((unstd, std))
}

/// Reconstruct the per-case observations from the dataset (variable order
/// preserved). Each group contributes its cases in storage (index) order.
fn extract_cases(dataset: &AnalyzedDataset, variables: &[String]) -> Vec<Case> {
    let mut cases = Vec::new();
    for group in &dataset.group_labels {
        let n = dataset
            .group_data
            .get(&variables[0])
            .and_then(|g| g.get(group))
            .map_or(0, |v| v.len());

        for i in 0..n {
            let values: Vec<f64> = variables
                .iter()
                .map(|var| {
                    dataset
                        .group_data
                        .get(var)
                        .and_then(|g| g.get(group))
                        .and_then(|v| v.get(i))
                        .copied()
                        .unwrap_or(0.0)
                })
                .collect();
            cases.push(Case {
                group: group.clone(),
                stratum: group.clone(),
                values,
            });
        }
    }
    cases
}

/// Stratum key of every analysis case, paired with the group label the case
/// belongs to, in the same order as `extract_cases` returns them.
///
/// The case order of `extract_cases` is: groups in `group_labels` order, and
/// within a group the rows in storage order. That is exactly the order in which
/// `extract_grouped_data` collected the rows, so rebuilding the same group to
/// row-index map here recovers which row each case came from. `data` is the
/// filtered data, so every row it still holds is an analysis case.
///
/// Returns `None` when the strata values are unavailable; the caller also
/// verifies the group labels line up before trusting the result.
fn strata_keys_for_cases(
    data: &AnalysisData,
    config: &DiscriminantConfig,
    dataset: &AnalyzedDataset,
    strata_variables: &[String],
) -> Option<Vec<(String, String)>> {
    let strata_data = data.strata_data.as_ref()?;
    if strata_data.is_empty() {
        return None;
    }

    // Same labelling and range rules as extract_grouped_data.
    let group_mappings = group_row_indices(
        data,
        &config.main.grouping_variable,
        config.define_range.min_range,
        config.define_range.max_range,
    );

    // Rows of each strata variable, located by name like extract_grouped_data
    // does, with the positional fallback for data organised by variable slot.
    let mut columns: Vec<&Vec<crate::models::data::DataRecord>> =
        Vec::with_capacity(strata_variables.len());
    for (vi, var_name) in strata_variables.iter().enumerate() {
        let column = strata_data
            .iter()
            .find(|rows| rows.iter().any(|row| row.values.contains_key(var_name)))
            .or_else(|| strata_data.get(vi))?;
        columns.push(column);
    }

    let mut keys = Vec::with_capacity(dataset.total_cases);
    for group in &dataset.group_labels {
        let indices = group_mappings.get(group)?;
        for &idx in indices {
            let mut parts: Vec<String> = Vec::with_capacity(columns.len());
            for (vi, var_name) in strata_variables.iter().enumerate() {
                let value = columns[vi].get(idx).and_then(|row| row.values.get(var_name));
                parts.push(match value {
                    Some(DataValue::Number(num)) => num.to_string(),
                    Some(DataValue::Text(text)) => text.clone(),
                    Some(DataValue::Boolean(b)) => b.to_string(),
                    // A missing strata value forms its own cell rather than
                    // silently joining another one.
                    _ => "(missing)".to_string(),
                });
            }
            // Unit separator: cannot appear in a data value, so distinct
            // combinations cannot collide.
            keys.push((group.clone(), parts.join("")));
        }
    }

    Some(keys)
}

/// Build an `AnalyzedDataset` from a set of (resampled) cases, recomputing group
/// and overall means. Group order follows `group_order`, restricted to groups
/// actually present.
fn dataset_from_cases(
    cases: &[Case],
    variables: &[String],
    group_order: &[String],
) -> AnalyzedDataset {
    // group_data[var][group] = Vec<f64>
    let mut group_data: HashMap<String, HashMap<String, Vec<f64>>> = HashMap::new();
    for var in variables {
        group_data.insert(var.clone(), HashMap::new());
    }

    for case in cases {
        for (vi, var) in variables.iter().enumerate() {
            group_data
                .get_mut(var)
                .unwrap()
                .entry(case.group.clone())
                .or_default()
                .push(case.values[vi]);
        }
    }

    // Present groups, in the original order.
    let present: std::collections::HashSet<&String> = cases.iter().map(|c| &c.group).collect();
    let group_labels: Vec<String> = group_order
        .iter()
        .filter(|g| present.contains(*g))
        .cloned()
        .collect();

    let group_means = calculate_group_means(&group_data, &group_labels, variables);
    let overall_means = calculate_overall_means(&group_data, &group_labels, variables);

    AnalyzedDataset {
        group_data,
        group_labels: group_labels.clone(),
        group_means,
        overall_means,
        num_groups: group_labels.len(),
        total_cases: cases.len(),
    }
}

/// Draw a uniform random index in `0..n` from the Mersenne Twister. Uses the
/// generator's inherent `next_u32` to avoid coupling to a specific `rand`
/// trait version; modulo bias is negligible for resampling.
fn next_index(rng: &mut Mt, n: usize) -> usize {
    (rng.next_u32() as usize) % n
}

/// Simple bootstrap: draw `cases.len()` cases uniformly with replacement.
fn resample_simple(cases: &[Case], rng: &mut Mt) -> Vec<Case> {
    let n = cases.len();
    (0..n).map(|_| cases[next_index(rng, n)].clone()).collect()
}

/// Stratified bootstrap: within each stratum, draw nᵢ cases with replacement so
/// stratum sizes are preserved. The stratum is the grouping variable unless the
/// user picked Strata Variables, in which case it is their crossed cells.
/// Strata are visited in first-appearance order, so a given seed always produces
/// the same draws.
fn resample_stratified(cases: &[Case], rng: &mut Mt) -> Vec<Case> {
    let mut order: Vec<&String> = Vec::new();
    let mut by_stratum: HashMap<&String, Vec<&Case>> = HashMap::new();
    for c in cases {
        if !by_stratum.contains_key(&c.stratum) {
            order.push(&c.stratum);
        }
        by_stratum.entry(&c.stratum).or_default().push(c);
    }

    let mut out = Vec::with_capacity(cases.len());
    for stratum in order {
        if let Some(stratum_cases) = by_stratum.get(stratum) {
            let m = stratum_cases.len();
            for _ in 0..m {
                out.push(stratum_cases[next_index(rng, m)].clone());
            }
        }
    }
    out
}

/// The original solution that every refit is matched to: its unstandardized
/// coefficient vectors and the pooled within-groups covariance that measures them.
struct MatchReference {
    /// [function][variable], in `variables` order.
    functions: Vec<Vec<f64>>,
    pooled: DMatrix<f64>,
}

/// How a refit maps onto the original functions: original function `f` is the
/// refit's function `order[f]`, multiplied by `signs[f]`.
struct FunctionMatching {
    order: Vec<usize>,
    signs: Vec<f64>,
}

/// Unstandardized coefficient vectors, [function][variable] in `variables` order.
fn function_vectors(
    unstd: &HashMap<String, Vec<f64>>,
    variables: &[String],
    num_functions: usize,
) -> Vec<Vec<f64>> {
    (0..num_functions)
        .map(|f| {
            variables
                .iter()
                .map(|var| unstd.get(var).and_then(|c| c.get(f)).copied().unwrap_or(0.0))
                .collect()
        })
        .collect()
}

/// Match a refit's functions to the original ones.
///
/// Similarity is the pooled within-groups correlation of the two functions'
/// scores, r = aᵀSb / √(aᵀSa · bᵀSb), with S the original pooled covariance.
/// Unlike a raw dot product of the coefficients it does not depend on the scale
/// of the predictors (a dot product weights each predictor by 1/variance, so the
/// one with the smallest SD decides the sign). The order is the assignment that
/// maximizes Σ|r|, which undoes swaps between functions with close eigenvalues;
/// each matched function is then reflected so that r ≥ 0.
fn match_to_original(reference: &MatchReference, refit: &[Vec<f64>]) -> FunctionMatching {
    let s = &reference.pooled;
    let quad = |a: &[f64], b: &[f64]| -> f64 {
        let mut sum = 0.0;
        for i in 0..a.len() {
            for j in 0..b.len() {
                sum += a[i] * s[(i, j)] * b[j];
            }
        }
        sum
    };

    let orig_norms: Vec<f64> = reference.functions.iter().map(|a| quad(a, a).sqrt()).collect();
    let refit_norms: Vec<f64> = refit.iter().map(|b| quad(b, b).sqrt()).collect();

    let corr: Vec<Vec<f64>> = reference
        .functions
        .iter()
        .zip(&orig_norms)
        .map(|(a, &na)| {
            refit
                .iter()
                .zip(&refit_norms)
                .map(|(b, &nb)| {
                    let r = quad(a, b) / (na * nb);
                    if r.is_finite() { r } else { 0.0 }
                })
                .collect()
        })
        .collect();

    let weights: Vec<Vec<f64>> =
        corr.iter().map(|row| row.iter().map(|r| r.abs()).collect()).collect();
    let order = best_assignment(&weights);
    let signs = order
        .iter()
        .enumerate()
        .map(|(f, &k)| if corr[f][k] < 0.0 { -1.0 } else { 1.0 })
        .collect();

    FunctionMatching { order, signs }
}

/// Assignment of rows to columns that maximizes Σ w[row][order[row]], for a
/// square matrix (Hungarian algorithm, O(m³)).
fn best_assignment(w: &[Vec<f64>]) -> Vec<usize> {
    let n = w.len();
    if n == 0 {
        return Vec::new();
    }

    // Minimize cost = -w with the 1-based potentials of the standard formulation:
    // p[j] is the row assigned to column j, way[j] the previous column on the
    // augmenting path.
    let cost = |i: usize, j: usize| -> f64 {
        let v = w[i - 1][j - 1];
        if v.is_finite() { -v } else { 0.0 }
    };
    let mut u = vec![0.0_f64; n + 1];
    let mut v = vec![0.0_f64; n + 1];
    let mut p = vec![0_usize; n + 1];
    let mut way = vec![0_usize; n + 1];

    for i in 1..=n {
        p[0] = i;
        let mut j0 = 0_usize;
        let mut minv = vec![f64::INFINITY; n + 1];
        let mut used = vec![false; n + 1];
        loop {
            used[j0] = true;
            let i0 = p[j0];
            let mut delta = f64::INFINITY;
            let mut j1 = 0_usize;
            for j in 1..=n {
                if !used[j] {
                    let cur = cost(i0, j) - u[i0] - v[j];
                    if cur < minv[j] {
                        minv[j] = cur;
                        way[j] = j0;
                    }
                    if minv[j] < delta {
                        delta = minv[j];
                        j1 = j;
                    }
                }
            }
            for j in 0..=n {
                if used[j] {
                    u[p[j]] += delta;
                    v[j] -= delta;
                } else {
                    minv[j] -= delta;
                }
            }
            j0 = j1;
            if p[j0] == 0 {
                break;
            }
        }
        loop {
            let j1 = way[j0];
            p[j0] = p[j1];
            j0 = j1;
            if j0 == 0 {
                break;
            }
        }
    }

    let mut order = vec![0_usize; n];
    for j in 1..=n {
        if p[j] > 0 {
            order[p[j] - 1] = j - 1;
        }
    }
    order
}

/// Standard deviation of the bootstrap estimates, s = √[Σ(θ*ᵦ − θ̄*)² / (B − 1)];
/// 0 when B < 2.
fn std_dev(values: &[f64], mean: f64) -> f64 {
    let n = values.len();
    if n < 2 {
        return 0.0;
    }
    let ss: f64 = values.iter().map(|&v| (v - mean).powi(2)).sum();
    (ss / (n as f64 - 1.0)).sqrt()
}

/// Type-7 (linear interpolation) quantile of an already-sorted slice x₀ ≤ … ≤ xₙ₋₁:
///
/// h = (n − 1) · q,   Q(q) = x₍⌊h⌋₎ + (h − ⌊h⌋) · (x₍⌈h⌉₎ − x₍⌊h⌋₎)
fn quantile_sorted(sorted: &[f64], q: f64) -> f64 {
    let n = sorted.len();
    if n == 0 {
        return 0.0;
    }
    if n == 1 {
        return sorted[0];
    }
    let q = q.clamp(0.0, 1.0);
    let h = (n as f64 - 1.0) * q;
    let lo = h.floor() as usize;
    let hi = h.ceil() as usize;
    if lo == hi {
        sorted[lo]
    } else {
        sorted[lo] + (h - lo as f64) * (sorted[hi] - sorted[lo])
    }
}

/// Percentile confidence interval [Q(α/2), Q(1 − α/2)] of the bootstrap estimates,
/// α = 1 − level / 100.
fn percentile_interval(estimates: &[f64], alpha: f64) -> (f64, f64) {
    let mut sorted = estimates.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let lo = quantile_sorted(&sorted, alpha / 2.0);
    let hi = quantile_sorted(&sorted, 1.0 - alpha / 2.0);
    (lo, hi)
}

/// Bias-corrected and accelerated (BCa) confidence interval (Efron, 1987):
///
/// z₀ = Φ⁻¹(#{θ*ᵦ < θ̂} / B)
/// α₁ = Φ(z₀ + (z₀ + z_{α/2})   / (1 − a · (z₀ + z_{α/2})))
/// α₂ = Φ(z₀ + (z₀ + z_{1−α/2}) / (1 − a · (z₀ + z_{1−α/2})))
/// CI = [Q(α₁), Q(α₂)]
///
/// θ̂ = original estimate, a = jackknife acceleration (`jackknife_acceleration`),
/// Q = Type-7 quantile. The proportion is kept within [10⁻⁶, 1 − 10⁻⁶] so that z₀
/// stays finite.
fn bca_interval(estimates: &[f64], original: f64, accel: f64, alpha: f64) -> (f64, f64) {
    let n = estimates.len();
    if n < 2 {
        return (original, original);
    }

    let mut sorted = estimates.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let normal = match Normal::new(0.0, 1.0) {
        Ok(d) => d,
        Err(_) => return percentile_interval(estimates, alpha),
    };

    // Bias-correction z0 from the proportion of estimates below the original.
    let below = estimates.iter().filter(|&&v| v < original).count() as f64;
    let prop = (below / n as f64).clamp(1e-6, 1.0 - 1e-6);
    let z0 = normal.inverse_cdf(prop);

    let z_lo = normal.inverse_cdf(alpha / 2.0);
    let z_hi = normal.inverse_cdf(1.0 - alpha / 2.0);

    let adjust = |z: f64| -> f64 {
        let num = z0 + z;
        let denom = 1.0 - accel * num;
        let p = z0 + num / denom;
        normal.cdf(p).clamp(0.0, 1.0)
    };

    let lo = quantile_sorted(&sorted, adjust(z_lo));
    let hi = quantile_sorted(&sorted, adjust(z_hi));
    (lo, hi)
}

/// Jackknife acceleration `a` for every (variable, function), needed by BCa.
/// Leaves out one case at a time, re-fits, matches the functions to the original
/// (same rule as the resamples), and applies the standard skewness-of-jackknife
/// formula
///
/// a = Σᵢ (θ̄ − θ₍ᵢ₎)³ / (6 · [Σᵢ (θ̄ − θ₍ᵢ₎)²]^(3/2))
///
/// θ₍ᵢ₎ = estimate without case i, θ̄ = mean of the θ₍ᵢ₎.
fn jackknife_acceleration(
    cases: &[Case],
    variables: &[String],
    group_order: &[String],
    num_functions: usize,
    reference: &MatchReference,
) -> Vec<Vec<f64>> {
    let p = variables.len();
    let n = cases.len();

    // theta[var][function] = Vec of leave-one-out standardized estimates.
    let mut theta: Vec<Vec<Vec<f64>>> = vec![vec![Vec::with_capacity(n); num_functions]; p];

    for skip in 0..n {
        let subset: Vec<Case> = cases
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != skip)
            .map(|(_, c)| c.clone())
            .collect();

        let ds = dataset_from_cases(&subset, variables, group_order);
        // Same rule as the resampling loop: a subset that lost a group cannot
        // support num_functions functions.
        if ds.num_groups != group_order.len() {
            continue;
        }

        if let Some((unstd, std)) = canonical_coeffs_from_dataset(&ds, variables, num_functions) {
            let matching =
                match_to_original(reference, &function_vectors(&unstd, variables, num_functions));
            for (vi, var) in variables.iter().enumerate() {
                if let Some(coefs) = std.get(var) {
                    for f in 0..num_functions {
                        theta[vi][f].push(
                            coefs.get(matching.order[f]).copied().unwrap_or(0.0)
                                * matching.signs[f],
                        );
                    }
                }
            }
        }
    }

    let mut accel = vec![vec![0.0; num_functions]; p];
    for vi in 0..p {
        for f in 0..num_functions {
            let vals = &theta[vi][f];
            if vals.len() < 2 {
                continue;
            }
            let mean = vals.iter().sum::<f64>() / vals.len() as f64;
            // Efron's a = Σ(θ̄ − θᵢ)³ / (6·[Σ(θ̄ − θᵢ)²]^{3/2}). The cube keeps the
            // sign, so the difference must be (mean − θᵢ), not (θᵢ − mean).
            let mut num = 0.0;
            let mut den = 0.0;
            for &v in vals {
                let d = mean - v;
                num += d.powi(3);
                den += d.powi(2);
            }
            let denom = 6.0 * den.powf(1.5);
            accel[vi][f] = if denom.abs() > 1e-12 { num / denom } else { 0.0 };
        }
    }

    accel
}

#[cfg(test)]
mod tests {
    use super::*;

    fn brute_force_best(w: &[Vec<f64>]) -> f64 {
        fn go(w: &[Vec<f64>], row: usize, used: &mut Vec<bool>) -> f64 {
            if row == w.len() {
                return 0.0;
            }
            let mut best = f64::NEG_INFINITY;
            for j in 0..w.len() {
                if !used[j] {
                    used[j] = true;
                    best = best.max(w[row][j] + go(w, row + 1, used));
                    used[j] = false;
                }
            }
            best
        }
        go(w, 0, &mut vec![false; w.len()])
    }

    #[test]
    fn best_assignment_matches_brute_force() {
        let mut state: u32 = 12345;
        let mut next = || {
            state = state.wrapping_mul(1664525).wrapping_add(1013904223);
            state as f64 / u32::MAX as f64
        };
        for m in 1..=6 {
            for _ in 0..50 {
                let w: Vec<Vec<f64>> = (0..m).map(|_| (0..m).map(|_| next()).collect()).collect();
                let order = best_assignment(&w);
                let mut seen = order.clone();
                seen.sort();
                assert_eq!(seen, (0..m).collect::<Vec<_>>(), "not a permutation");
                let total: f64 = order.iter().enumerate().map(|(i, &j)| w[i][j]).sum();
                assert!((total - brute_force_best(&w)).abs() < 1e-12);
            }
        }
    }

    #[test]
    fn match_undoes_swap_and_reflection() {
        let reference = MatchReference {
            functions: vec![vec![1.0, 0.0, 0.2], vec![0.0, 1.0, -0.3]],
            pooled: DMatrix::from_row_slice(3, 3, &[4.0, 1.0, 0.5, 1.0, 900.0, 3.0, 0.5, 3.0, 0.08]),
        };
        // Refit = original functions swapped, the second one reflected, rescaled.
        let refit = vec![vec![0.0, -2.0, 0.6], vec![1.1, 0.0, 0.22]];
        let m = match_to_original(&reference, &refit);
        assert_eq!(m.order, vec![1, 0]);
        assert_eq!(m.signs, vec![1.0, -1.0]);
    }
}
