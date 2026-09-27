pub use super::distance::*;
pub use super::normalization::*;
pub use super::prediction::*;
pub use super::split::*;

use crate::models::{config::KnnConfig, data::KnnData};

/// Relative tolerance for comparing computed errors. It absorbs floating point
/// rounding (e.g. 10/70 stored as 0.14285714285714285) while real differences
/// between errors are at least one case, i.e. 1/N of the scale.
pub const ERROR_TOLERANCE: f64 = 1e-9;

/// True when two computed errors are equal up to floating point rounding.
pub fn errors_equal(left: f64, right: f64) -> bool {
    (left - right).abs() <= ERROR_TOLERANCE * left.abs().max(right.abs()).max(1.0)
}

/// Classification error rate in percent, computed from counts with a single
/// rounding step.
pub fn error_rate_percent(incorrect: usize, total: usize) -> f64 {
    incorrect as f64 / total as f64 * 100.0
}

/// Index of the candidate with the lowest error; errors equal up to rounding
/// count as tied and the smallest k wins, as SPSS specifies.
pub fn lowest_error_smallest_k<I>(candidates: I) -> Option<usize>
where
    I: IntoIterator<Item = (usize, f64)>,
{
    let candidates = candidates.into_iter().collect::<Vec<_>>();
    let min_error = candidates
        .iter()
        .map(|&(_, error)| error)
        .min_by(|left, right| left.total_cmp(right))?;

    candidates
        .iter()
        .enumerate()
        .filter(|(_, &(_, error))| errors_equal(error, min_error))
        .min_by_key(|(_, &(k, _))| k)
        .map(|(index, _)| index)
}

/// Fixes the per-run context before any preprocessing, so every step of one
/// analysis (feature selection, k selection, final model, outputs) shares the
/// same valid cases and the same training/holdout split. Without a user seed
/// the split stays random: a fresh seed is drawn for each run.
pub fn prepare_run_config(config: &KnnConfig) -> KnnConfig {
    let mut run_config = config.clone();

    if !config.partition.set_seed && run_config.run.partition_seed.is_none() {
        run_config.run.partition_seed = Some(rand::random::<u32>() as i64);
    }

    if run_config.run.case_filter_features.is_none() {
        run_config.run.case_filter_features =
            Some(super::feature_selection::feature_universe(config));
    }

    run_config
}

pub fn determine_effective_k(knn_data: &KnnData, config: &KnnConfig) -> Result<usize, String> {
    let requested_k = config.neighbors.specify_k.max(1) as usize;
    let available_neighbors = knn_data.training_indices.len().saturating_sub(1).max(1);

    Ok(requested_k.min(available_neighbors))
}

#[cfg(test)]
mod tests {
    use super::{error_rate_percent, errors_equal, lowest_error_smallest_k};

    #[test]
    fn error_rate_percent_is_computed_from_counts() {
        assert_eq!(error_rate_percent(7, 70), 10.0);
        assert_eq!(error_rate_percent(0, 70), 0.0);
        assert_eq!(error_rate_percent(70, 70), 100.0);
    }

    #[test]
    fn errors_equal_absorbs_rounding_but_not_one_case_differences() {
        assert!(errors_equal(61.11111111111111, 61.111111111111114));
        assert!(errors_equal(80111.98141016427, 80111.98141016423));
        assert!(!errors_equal(error_rate_percent(10, 70), error_rate_percent(9, 70)));
        assert!(!errors_equal(
            error_rate_percent(1, 100_000),
            error_rate_percent(2, 100_000)
        ));
    }

    #[test]
    fn lowest_error_prefers_smallest_k_among_rounding_ties() {
        // CV averages that are equal in exact arithmetic but differ in the last
        // bit: SPSS picks the smallest k.
        let candidates = vec![(3, 61.111111111111114), (4, 70.0), (5, 61.11111111111111)];
        assert_eq!(lowest_error_smallest_k(candidates), Some(0));

        let candidates = vec![(3, 20.0), (4, 18.571428571428573), (5, 18.571428571428573)];
        assert_eq!(lowest_error_smallest_k(candidates), Some(1));

        assert_eq!(lowest_error_smallest_k(Vec::<(usize, f64)>::new()), None);
    }
}
