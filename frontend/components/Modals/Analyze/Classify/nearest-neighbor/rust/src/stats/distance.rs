use std::cmp::Ordering;

const NEIGHBOR_TIE_EPSILON: f64 = 1e-12;

/// Calculates distance between two points using specified metric.
pub fn calculate_distance(point1: &[f64], point2: &[f64], use_euclidean: bool) -> f64 {
    calculate_distance_with_weights(point1, point2, use_euclidean, None)
}

/// Calculates distance between two points using optional per-feature weights.
pub fn calculate_distance_with_weights(
    point1: &[f64],
    point2: &[f64],
    use_euclidean: bool,
    feature_weights: Option<&[f64]>,
) -> f64 {
    let min_len = point1.len().min(point2.len());

    if use_euclidean {
        let sum_squared = (0..min_len)
            .filter_map(|i| {
                if !point1[i].is_finite() || !point2[i].is_finite() {
                    return None;
                }

                let diff = point1[i] - point2[i];
                let weight = feature_weights
                    .and_then(|weights| weights.get(i).copied())
                    .unwrap_or(1.0);
                Some(weight * diff * diff)
            })
            .sum::<f64>();

        sum_squared.sqrt()
    } else {
        (0..min_len)
            .filter_map(|i| {
                if !point1[i].is_finite() || !point2[i].is_finite() {
                    return None;
                }

                let weight = feature_weights
                    .and_then(|weights| weights.get(i).copied())
                    .unwrap_or(1.0);
                Some(weight * (point1[i] - point2[i]).abs())
            })
            .sum::<f64>()
    }
}

pub fn find_k_nearest_neighbors(
    query_point: &[f64],
    data_matrix: &[Vec<f64>],
    indices: &[usize],
    k: usize,
    use_euclidean: bool,
    original_case_indices: Option<&[usize]>,
) -> Vec<(usize, f64)> {
    find_k_nearest_neighbors_with_weights(
        query_point,
        data_matrix,
        indices,
        k,
        use_euclidean,
        original_case_indices,
        None,
    )
}

pub fn find_k_nearest_neighbors_with_weights(
    query_point: &[f64],
    data_matrix: &[Vec<f64>],
    indices: &[usize],
    k: usize,
    use_euclidean: bool,
    original_case_indices: Option<&[usize]>,
    feature_weights: Option<&[f64]>,
) -> Vec<(usize, f64)> {
    let mut distances: Vec<(usize, f64)> = indices
        .iter()
        .filter_map(|&idx| {
            if idx < data_matrix.len() {
                let distance = calculate_distance_with_weights(
                    query_point,
                    &data_matrix[idx],
                    use_euclidean,
                    feature_weights,
                );
                Some((idx, distance))
            } else {
                None
            }
        })
        .collect();

    let k = k.max(1);

    // Partition so the k smallest (per the same total order used below) end up
    // in the first k slots, without paying for a full sort of every candidate.
    if distances.len() > k {
        distances.select_nth_unstable_by(k - 1, |a, b| {
            compare_neighbors(a, b, original_case_indices)
        });
        distances.truncate(k);
    }

    distances.sort_by(|a, b| compare_neighbors(a, b, original_case_indices));
    distances
}

fn compare_neighbors(
    left: &(usize, f64),
    right: &(usize, f64),
    original_case_indices: Option<&[usize]>,
) -> Ordering {
    let distance_order = if !left.1.is_finite() && !right.1.is_finite() {
        Ordering::Equal
    } else if !left.1.is_finite() {
        Ordering::Greater
    } else if !right.1.is_finite() {
        Ordering::Less
    } else if (left.1 - right.1).abs()
        <= NEIGHBOR_TIE_EPSILON * left.1.abs().max(right.1.abs()).max(1.0)
    {
        // Relative, so equal distances on unnormalized large-valued features
        // (e.g. 80111.98141016427 vs 80111.98141016423) still count as ties.
        Ordering::Equal
    } else {
        left.1.partial_cmp(&right.1).unwrap_or(Ordering::Equal)
    };

    distance_order.then_with(|| {
        let left_case_idx = original_case_indices
            .and_then(|indices| indices.get(left.0).copied())
            .unwrap_or(left.0);
        let right_case_idx = original_case_indices
            .and_then(|indices| indices.get(right.0).copied())
            .unwrap_or(right.0);

        right_case_idx
            .cmp(&left_case_idx)
            .then_with(|| right.0.cmp(&left.0))
    })
}

pub fn calculate_euclidean_distance(point1: &[f64], point2: &[f64]) -> f64 {
    calculate_distance(point1, point2, true)
}

pub fn calculate_manhattan_distance(point1: &[f64], point2: &[f64]) -> f64 {
    calculate_distance(point1, point2, false)
}

#[cfg(test)]
mod tests {
    use super::{
        calculate_distance_with_weights, calculate_euclidean_distance,
        calculate_manhattan_distance, compare_neighbors, find_k_nearest_neighbors,
        find_k_nearest_neighbors_with_weights,
    };

    #[test]
    fn euclidean_and_manhattan_match_sklearn_metrics() {
        let a = [0.0, 0.0];
        let b = [3.0, 4.0];

        assert_eq!(calculate_euclidean_distance(&a, &b), 5.0);
        assert_eq!(calculate_manhattan_distance(&a, &b), 7.0);
    }

    #[test]
    fn full_one_hot_nominal_mismatch_contributes_per_dimension() {
        let android = [1.0, 0.0, 0.0];
        let desktop = [0.0, 0.0, 1.0];

        assert_eq!(
            calculate_euclidean_distance(&android, &desktop),
            2.0_f64.sqrt()
        );
        assert_eq!(calculate_manhattan_distance(&android, &desktop), 2.0);
    }

    #[test]
    fn weighted_euclidean_and_manhattan_apply_feature_weights() {
        let a = [0.0, 0.0];
        let b = [3.0, 4.0];
        let weights = [0.25, 0.75];

        assert_eq!(
            calculate_distance_with_weights(&a, &b, true, Some(&weights)),
            (0.25_f64 * 9.0 + 0.75_f64 * 16.0).sqrt()
        );
        assert_eq!(
            calculate_distance_with_weights(&a, &b, false, Some(&weights)),
            0.25 * 3.0 + 0.75 * 4.0
        );
    }

    #[test]
    fn nearest_neighbors_break_distance_ties_by_original_case_index_descending() {
        let data_matrix = vec![vec![0.0], vec![1.0], vec![1.0], vec![1.0]];
        let original_case_indices = vec![10, 20, 40, 30];
        let neighbors = find_k_nearest_neighbors(
            &data_matrix[0],
            &data_matrix,
            &[1, 2, 3],
            3,
            true,
            Some(&original_case_indices),
        );

        assert_eq!(
            neighbors.iter().map(|(idx, _)| *idx).collect::<Vec<_>>(),
            vec![2, 3, 1]
        );
    }

    #[test]
    fn equal_distances_on_large_unnormalized_values_are_ties() {
        // A and B mirror the query, so both are exactly equally far, but the
        // computed distances differ in the last digits (…427 vs …423).
        let query = vec![124434.84, 482001.42];
        let a = vec![188310.68, 530352.29];
        let b = vec![60559.0, 433650.55];
        assert_ne!(
            calculate_euclidean_distance(&query, &a),
            calculate_euclidean_distance(&query, &b)
        );

        // As a tie, the case with the larger original index (A) comes first.
        let data_matrix = vec![query.clone(), a, b];
        let original_case_indices = vec![0, 2, 1];
        let neighbors =
            find_k_nearest_neighbors(&query, &data_matrix, &[1, 2], 1, true, Some(&original_case_indices));

        assert_eq!(neighbors.iter().map(|(idx, _)| *idx).collect::<Vec<_>>(), vec![1]);
    }

    #[test]
    fn nearest_neighbors_treat_almost_equal_distances_as_ties() {
        let data_matrix = vec![vec![0.0], vec![1.0], vec![1.0 + 5e-13]];
        let original_case_indices = vec![0, 1, 2];
        let neighbors = find_k_nearest_neighbors(
            &data_matrix[0],
            &data_matrix,
            &[1, 2],
            2,
            false,
            Some(&original_case_indices),
        );

        assert_eq!(
            neighbors.iter().map(|(idx, _)| *idx).collect::<Vec<_>>(),
            vec![2, 1]
        );
    }

    #[test]
    fn distance_skips_non_finite_dimensions_and_defaults_missing_weights_to_one() {
        let a = [0.0, f64::NAN, 2.0];
        let b = [3.0, 10.0, 6.0];
        let weights = [0.25];

        assert_eq!(
            calculate_distance_with_weights(&a, &b, true, Some(&weights)),
            (0.25_f64 * 9.0 + 16.0).sqrt()
        );
        assert_eq!(
            calculate_distance_with_weights(&a, &b, false, Some(&weights)),
            0.25 * 3.0 + 4.0
        );
    }

    #[test]
    fn nearest_neighbors_ignore_invalid_indices_and_keep_one_neighbor_when_k_is_zero() {
        let data_matrix = vec![vec![0.0], vec![3.0], vec![1.0]];
        let neighbors =
            find_k_nearest_neighbors(&data_matrix[0], &data_matrix, &[99, 1, 2], 0, true, None);

        assert_eq!(neighbors, vec![(2, 1.0)]);
    }

    #[test]
    fn nearest_neighbors_sort_non_finite_distances_last() {
        let data_matrix = vec![vec![0.0], vec![1.0], vec![2.0]];
        let weights = [-1.0];
        let neighbors = find_k_nearest_neighbors_with_weights(
            &data_matrix[0],
            &data_matrix,
            &[1, 2],
            2,
            true,
            None,
            Some(&weights),
        );

        assert!(neighbors[0].1.is_nan());
        assert!(neighbors[1].1.is_nan());
        assert_eq!(
            neighbors.iter().map(|(idx, _)| *idx).collect::<Vec<_>>(),
            vec![2, 1]
        );
    }

    /// Reference implementation using a full sort, kept only to cross-check
    /// the `select_nth_unstable_by` fast path against many random inputs.
    fn find_k_nearest_neighbors_via_full_sort(
        query_point: &[f64],
        data_matrix: &[Vec<f64>],
        indices: &[usize],
        k: usize,
        use_euclidean: bool,
        original_case_indices: Option<&[usize]>,
        feature_weights: Option<&[f64]>,
    ) -> Vec<(usize, f64)> {
        let mut distances: Vec<(usize, f64)> = indices
            .iter()
            .filter_map(|&idx| {
                if idx < data_matrix.len() {
                    let distance = calculate_distance_with_weights(
                        query_point,
                        &data_matrix[idx],
                        use_euclidean,
                        feature_weights,
                    );
                    Some((idx, distance))
                } else {
                    None
                }
            })
            .collect();

        distances.sort_by(|a, b| compare_neighbors(a, b, original_case_indices));
        distances.into_iter().take(k.max(1)).collect()
    }

    /// Small deterministic LCG so this test has no extra dependency and is
    /// still reproducible across runs.
    fn next_lcg(state: &mut u64) -> u64 {
        *state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        *state
    }

    #[test]
    fn partial_selection_matches_full_sort_reference_across_random_inputs() {
        let mut state = 0x1234_5678_9abc_def0_u64;

        for trial in 0..200 {
            let num_points = 1 + (next_lcg(&mut state) % 40) as usize;
            let num_dims = 1 + (next_lcg(&mut state) % 4) as usize;
            let k = 1 + (next_lcg(&mut state) % (num_points as u64 + 3));

            let data_matrix: Vec<Vec<f64>> = (0..num_points)
                .map(|_| {
                    (0..num_dims)
                        .map(|_| {
                            // Bias values into a small range so exact and
                            // near-tied distances occur often in practice.
                            ((next_lcg(&mut state) % 7) as f64) - 3.0
                        })
                        .collect()
                })
                .collect();

            let query_point: Vec<f64> = (0..num_dims)
                .map(|_| ((next_lcg(&mut state) % 7) as f64) - 3.0)
                .collect();

            let indices: Vec<usize> = (0..num_points).collect();
            let original_case_indices: Vec<usize> = (0..num_points)
                .map(|_| (next_lcg(&mut state) % 1000) as usize)
                .collect();
            let use_euclidean = next_lcg(&mut state) % 2 == 0;

            let fast = find_k_nearest_neighbors_with_weights(
                &query_point,
                &data_matrix,
                &indices,
                k as usize,
                use_euclidean,
                Some(&original_case_indices),
                None,
            );
            let reference = find_k_nearest_neighbors_via_full_sort(
                &query_point,
                &data_matrix,
                &indices,
                k as usize,
                use_euclidean,
                Some(&original_case_indices),
                None,
            );

            assert_eq!(
                fast, reference,
                "trial {trial} diverged (num_points={num_points}, k={k}, use_euclidean={use_euclidean})"
            );
        }
    }
}
