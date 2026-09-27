//! Classify → Use Covariance Matrix → Separate-groups (SPSS /CLASSIFY=SEPARATE).
//!
//! SPSS classifies a case from its canonical discriminant scores f. With the
//! default (pooled) matrix every group shares the pooled within-groups covariance
//! of the functions, which is the identity, so the distance to a group is the
//! Euclidean distance to its centroid. With Separate-groups each group j uses its
//! own covariance matrix Σⱼ of the functions:
//!
//!   χ²ⱼ = (f − f̄ⱼ)' Σⱼ⁻¹ (f − f̄ⱼ)
//!   P(Gⱼ | f) ∝ Pⱼ · |Σⱼ|^(-1/2) · exp(−χ²ⱼ / 2)
//!
//! The matrices are those of the discriminant functions, not of the original
//! variables, so this is not quadratic discriminant analysis. A singular Σⱼ is
//! replaced, as in SPSS, by the submatrix Σⱼ* of the functions that are not
//! linearly dependent on the preceding ones.
//!
//! Leave-one-out classification is not affected: SPSS cross-validates only the
//! linear (pooled) rule.

use std::collections::HashMap;

use nalgebra::{ DMatrix, DVector };

use crate::models::{
    result::{ CanonicalFunctions, GroupFunctionCovariance, SeparateGroupsClassification },
    AnalysisData,
    DiscriminantConfig,
};

use super::core::{
    box_m_test_for,
    calculate_canonical_functions,
    calculate_covariance,
    calculate_discriminant_scores,
    calculate_eigen_statistics,
    classification_case_values,
    extract_analyzed_dataset,
    get_stepwise_selected_variables,
    log_determinants_for,
    push_analysis_warning,
    AnalyzedDataset,
    EPSILON,
};

/// One group's matrices for the Separate-groups rule.
#[derive(Debug, Clone)]
pub struct GroupScoreRule {
    pub n: usize,
    /// Σⱼ, m × m.
    pub covariance: DMatrix<f64>,
    /// Σⱼ*⁻¹ padded to m × m with zeros for the functions left out.
    pub inverse: DMatrix<f64>,
    /// ln|Σⱼ*|.
    pub log_det: f64,
    /// Functions kept in Σⱼ*.
    pub rank: usize,
}

/// The Separate-groups rule, one entry per group in `dataset.group_labels` order.
#[derive(Debug, Clone)]
pub struct SeparateGroupsRule {
    pub groups: Vec<GroupScoreRule>,
}

/// A case's fit to one group.
#[derive(Debug, Clone, Copy)]
pub struct GroupFit {
    /// Squared distance to the group centroid in discriminant space.
    pub d2: f64,
    /// ln P(group) − ½·ln|Σⱼ| − ½·d2: the log posterior up to a shared constant.
    pub log_score: f64,
    /// Degrees of freedom of d2's chi-square distribution.
    pub df: usize,
}

/// Distance of a case's discriminant `scores` to every group centroid, and the
/// matching unnormalised log posterior, in `group_labels` order.
///
/// `rule = None` is the pooled rule used by default: Σⱼ = I, so d2 is Euclidean in
/// function space and df is the number of functions.
pub fn fit_groups(
    scores: &[f64],
    canonical: &CanonicalFunctions,
    group_labels: &[String],
    priors: &[f64],
    rule: Option<&SeparateGroupsRule>
) -> Vec<GroupFit> {
    group_labels
        .iter()
        .enumerate()
        .map(|(g_idx, group)| {
            let centroid = canonical.function_at_centroids.get(group);
            let diff: Vec<f64> = scores
                .iter()
                .enumerate()
                .map(|(f, &s)| s - centroid.and_then(|c| c.get(f)).copied().unwrap_or(0.0))
                .collect();

            let group_rule = rule.and_then(|r| r.groups.get(g_idx));
            let (mut d2, log_det, df) = match group_rule {
                Some(gr) => {
                    let m = diff.len().min(gr.inverse.nrows());
                    let mut q = 0.0;
                    for i in 0..m {
                        for j in 0..m {
                            q += diff[i] * gr.inverse[(i, j)] * diff[j];
                        }
                    }
                    (q, gr.log_det, gr.rank)
                }
                None => (diff.iter().map(|d| d * d).sum::<f64>(), 0.0, scores.len()),
            };
            if d2.is_nan() {
                d2 = f64::MAX;
            }

            let prior = priors.get(g_idx).copied().unwrap_or(1.0 / (group_labels.len() as f64));
            GroupFit {
                d2,
                log_score: prior.ln() - 0.5 * log_det - 0.5 * d2,
                df,
            }
        })
        .collect()
}

/// The Separate-groups rule for this analysis, or `None` when classification uses
/// the pooled within-groups matrix.
pub fn separate_groups_rule(
    data: &AnalysisData,
    config: &DiscriminantConfig
) -> Result<Option<SeparateGroupsRule>, String> {
    if !config.classify.sep_group {
        return Ok(None);
    }
    let (_, rule) = build_score_dataset_and_rule(data, config)?;
    Ok(Some(rule))
}

/// The tables SPSS adds for Separate-groups: each group's covariance matrix of the
/// canonical discriminant functions, their log determinants, and Box's M on them.
pub fn calculate_separate_groups_classification(
    data: &AnalysisData,
    config: &DiscriminantConfig
) -> Result<SeparateGroupsClassification, String> {
    let (score_dataset, rule) = build_score_dataset_and_rule(data, config)?;
    let function_names = score_variable_names(rule.groups.first().map_or(0, |g| g.covariance.nrows()));

    let log_determinants = log_determinants_for(
        &score_dataset,
        &function_names,
        "The ranks and natural logarithms of determinants printed are those of the group covariance matrices of the canonical discriminant functions.".to_string()
    );

    let box_m_test = match
        box_m_test_for(
            &score_dataset,
            &function_names,
            "separate_groups_box_m",
            "Tests null hypothesis of equal population covariance matrices of canonical discriminant functions."
        )
    {
        Ok(test) => Some(test),
        Err(e) => {
            push_analysis_warning(
                "separate_groups_box_m",
                format!("Box's M for the canonical discriminant functions: {}", e)
            );
            None
        }
    };

    let to_rows = |m: &DMatrix<f64>| -> Vec<Vec<f64>> {
        (0..m.nrows()).map(|i| (0..m.ncols()).map(|j| m[(i, j)]).collect()).collect()
    };

    let groups = score_dataset.group_labels
        .iter()
        .zip(rule.groups.iter())
        .map(|(group, gr)| GroupFunctionCovariance {
            group: group.clone(),
            n: gr.n,
            covariance: to_rows(&gr.covariance),
            inverse: to_rows(&gr.inverse),
            log_determinant: gr.log_det,
            rank: gr.rank,
        })
        .collect();

    Ok(SeparateGroupsClassification {
        functions: (1..=function_names.len()).map(|k| k.to_string()).collect(),
        groups,
        log_determinants,
        box_m_test,
    })
}

fn score_variable_names(num_functions: usize) -> Vec<String> {
    (1..=num_functions).map(|k| format!("Function {}", k)).collect()
}

/// Discriminant scores of the analysis cases, laid out as a dataset whose
/// "variables" are the functions, plus the Separate-groups rule built from it.
/// Mean-substituted cases are classified but never estimate the matrices, so they
/// are left out here.
fn build_score_dataset_and_rule(
    data: &AnalysisData,
    config: &DiscriminantConfig
) -> Result<(AnalyzedDataset, SeparateGroupsRule), String> {
    let dataset = extract_analyzed_dataset(data, config)?;
    let grouping_var = &config.main.grouping_variable;
    let variables: Vec<String> = if config.main.stepwise {
        get_stepwise_selected_variables(data, config)?
    } else {
        config.main.independent_variables
            .iter()
            .filter(|v| *v != grouping_var)
            .cloned()
            .collect()
    };

    let canonical = calculate_canonical_functions(data, config)?;
    let num_functions = calculate_eigen_statistics(data, config)?.eigenvalue.len();
    if num_functions == 0 {
        return Err("Separate-groups classification needs at least one discriminant function.".into());
    }
    let function_names = score_variable_names(num_functions);

    let mut group_data: HashMap<String, HashMap<String, Vec<f64>>> = function_names
        .iter()
        .map(|f| (f.clone(), HashMap::new()))
        .collect();
    let mut group_means: HashMap<String, HashMap<String, f64>> = HashMap::new();
    let mut overall_sums = vec![0.0; num_functions];
    let mut total_cases = 0usize;

    for group in &dataset.group_labels {
        let cases = classification_case_values(&dataset, group, &variables, &[]);
        let scores: Vec<Vec<f64>> = cases
            .iter()
            .map(|values| calculate_discriminant_scores(values, &canonical, &variables, num_functions))
            .collect();

        let mut means = HashMap::new();
        for (f, name) in function_names.iter().enumerate() {
            let column: Vec<f64> = scores.iter().map(|s| s[f]).collect();
            let mean = if column.is_empty() {
                0.0
            } else {
                column.iter().sum::<f64>() / (column.len() as f64)
            };
            overall_sums[f] += column.iter().sum::<f64>();
            means.insert(name.clone(), mean);
            group_data.get_mut(name).unwrap().insert(group.clone(), column);
        }
        group_means.insert(group.clone(), means);
        total_cases += scores.len();
    }

    let overall_means = function_names
        .iter()
        .enumerate()
        .map(|(f, name)| {
            let mean = if total_cases > 0 { overall_sums[f] / (total_cases as f64) } else { 0.0 };
            (name.clone(), mean)
        })
        .collect();

    let score_dataset = AnalyzedDataset {
        group_data,
        group_labels: dataset.group_labels.clone(),
        group_means,
        overall_means,
        num_groups: dataset.num_groups,
        total_cases,
    };

    let mut groups = Vec::with_capacity(score_dataset.group_labels.len());
    for group in &score_dataset.group_labels {
        let n = score_dataset.group_data[&function_names[0]]
            .get(group)
            .map_or(0, |v| v.len());

        let mut covariance = DMatrix::zeros(num_functions, num_functions);
        if n >= 2 {
            for (i, fi) in function_names.iter().enumerate() {
                for (j, fj) in function_names.iter().enumerate() {
                    covariance[(i, j)] = calculate_covariance(
                        &score_dataset.group_data[fi][group],
                        &score_dataset.group_data[fj][group],
                        Some(score_dataset.group_means[group][fi]),
                        Some(score_dataset.group_means[group][fj])
                    );
                }
            }
        }

        let kept = independent_functions(&covariance);
        let (inverse, log_det) = pseudo_inverse(&covariance, &kept);

        if n < 2 {
            push_analysis_warning(
                "separate_groups",
                format!(
                    "Separate-groups classification: group {} has fewer than two cases, so its covariance matrix of the canonical discriminant functions is undefined; its cases are classified by prior probability alone.",
                    group
                )
            );
        } else if kept.len() < num_functions {
            push_analysis_warning(
                "separate_groups",
                format!(
                    "Separate-groups classification: the covariance matrix of the canonical discriminant functions of group {} is singular (rank {} of {}). As SPSS does, that group is classified with function(s) {} only — those not linearly dependent on preceding functions.",
                    group,
                    kept.len(),
                    num_functions,
                    kept.iter().map(|k| (k + 1).to_string()).collect::<Vec<_>>().join(", ")
                )
            );
        }

        groups.push(GroupScoreRule {
            n,
            covariance,
            inverse,
            log_det,
            rank: kept.len(),
        });
    }

    Ok((score_dataset, SeparateGroupsRule { groups }))
}

/// SPSS's pseudo-inverse rule: walk the functions in order and keep function k only
/// when it is not linearly dependent on the functions already kept, i.e. its
/// variance left over after regressing on them is not (numerically) zero. Function 1
/// is dropped only when its own variance is zero.
fn independent_functions(covariance: &DMatrix<f64>) -> Vec<usize> {
    let m = covariance.nrows();
    let mut kept: Vec<usize> = Vec::new();

    for k in 0..m {
        let variance = covariance[(k, k)];
        let residual = if kept.is_empty() {
            variance
        } else {
            let sub = submatrix(covariance, &kept);
            let cross = DVector::from_iterator(
                kept.len(),
                kept.iter().map(|&i| covariance[(i, k)])
            );
            // `sub` is positive definite: each kept function had a positive residual.
            match sub.cholesky() {
                Some(chol) => variance - cross.dot(&chol.solve(&cross)),
                None => 0.0,
            }
        };

        if residual > EPSILON && residual > EPSILON * variance.abs() {
            kept.push(k);
        }
    }

    kept
}

/// Inverse and log determinant of the submatrix over `kept`, the inverse padded
/// back to the full size with zeros.
fn pseudo_inverse(covariance: &DMatrix<f64>, kept: &[usize]) -> (DMatrix<f64>, f64) {
    let m = covariance.nrows();
    let mut inverse = DMatrix::zeros(m, m);
    if kept.is_empty() {
        return (inverse, 0.0);
    }

    let sub = submatrix(covariance, kept);
    match sub.cholesky() {
        Some(chol) => {
            let log_det = 2.0 * chol.l().diagonal().iter().map(|d| d.ln()).sum::<f64>();
            let sub_inv = chol.inverse();
            for (a, &i) in kept.iter().enumerate() {
                for (b, &j) in kept.iter().enumerate() {
                    inverse[(i, j)] = sub_inv[(a, b)];
                }
            }
            (inverse, log_det)
        }
        None => (inverse, 0.0),
    }
}

fn submatrix(matrix: &DMatrix<f64>, indices: &[usize]) -> DMatrix<f64> {
    DMatrix::from_fn(indices.len(), indices.len(), |a, b| matrix[(indices[a], indices[b])])
}
