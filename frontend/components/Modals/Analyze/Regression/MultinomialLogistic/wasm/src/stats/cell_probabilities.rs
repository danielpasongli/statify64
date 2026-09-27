use crate::models::config::{AnalysisData, MultinomialConfig};
use crate::models::result::CellProbabilityItem;
use crate::stats::core::PrimaryResults;
use crate::stats::probabilities::compute_probs_with_offset;
use nalgebra::DVector;
use std::collections::HashMap;

/// Hitung Cell Probabilities (Observed and Predicted Frequencies) per subpopulasi.
///
/// Setiap subpopulasi mendefinisikan kombinasi unik dari variabel prediktor.
/// Untuk setiap kategori variabel dependen, dihitung:
///   - Observed Frequency (O_mj)
///   - Predicted Frequency (E_mj = sum_i w_i * pi_ij)
///   - Pearson Residual ( (O_mj - E_mj) / sqrt(E_mj) )
///   - Observed Percentage ( (O_mj / N_m) * 100% )
///   - Predicted Percentage ( (E_mj / N_m) * 100% )
pub fn calculate_cell_probabilities(
    data: &AnalysisData,
    primary: &PrimaryResults,
    beta: &DVector<f64>,
    config: &MultinomialConfig,
) -> Vec<CellProbabilityItem> {
    let n = primary.n_cases;
    let j_count = primary.n_categories;
    let p = primary.n_params;
    let ref_idx = primary.reference_index;
    let x = &primary.design_matrix;

    // Tentukan indeks variabel independen asli yang membentuk subpopulasi
    let n_vars = data.independent.len();
    let subpop_var_indices: Vec<usize> = match config.subpopulation_mode.as_deref() {
        Some("variableList") => config
            .subpopulation_columns
            .clone()
            .unwrap_or_default()
            .into_iter()
            .map(|idx| idx as usize)
            .filter(|&idx| idx < n_vars)
            .collect(),
        _ => (0..n_vars).collect(),
    };

    let canonical_bits = |value: f64| {
        if value == 0.0 {
            0_u64
        } else {
            value.to_bits()
        }
    };

    // Key: bit key untuk pola prediktor subpopulasi
    // Value: (subpop_first_seen_index, predictor_values, total_weight, observed_counts, expected_counts)
    let mut pattern_map: HashMap<Vec<u64>, (usize, Vec<f64>, f64, Vec<f64>, Vec<f64>)> =
        HashMap::new();
    let mut pattern_order: Vec<Vec<u64>> = Vec::new();

    for i in 0..n {
        let weight = primary.weights.get(i).copied().unwrap_or(1.0);
        if !weight.is_finite() || weight <= 0.0 {
            continue;
        }

        let probs = compute_probs_with_offset(x, beta, i, j_count, p, ref_idx);

        let key: Vec<u64> = subpop_var_indices
            .iter()
            .map(|&k| canonical_bits(data.independent[k][i]))
            .collect();

        let predictor_vals: Vec<f64> = subpop_var_indices
            .iter()
            .map(|&k| data.independent[k][i])
            .collect();

        let obs_cat = primary.y_categories[i];
        let obs_idx = primary
            .category_map
            .iter()
            .position(|&c| c == obs_cat)
            .unwrap_or(0);

        if !pattern_map.contains_key(&key) {
            pattern_order.push(key.clone());
            let next_idx = pattern_map.len();
            pattern_map.insert(
                key.clone(),
                (
                    next_idx,
                    predictor_vals,
                    0.0,
                    vec![0.0; j_count],
                    vec![0.0; j_count],
                ),
            );
        }

        let entry = pattern_map.get_mut(&key).unwrap();
        entry.2 += weight;
        entry.3[obs_idx] += weight;
        for (j, prob) in probs.iter().enumerate() {
            entry.4[j] += weight * prob;
        }
    }

    // Urutkan pola subpopulasi secara leksikografis berdasarkan nilai prediktor
    let mut sorted_entries: Vec<(Vec<f64>, f64, Vec<f64>, Vec<f64>)> = pattern_order
        .into_iter()
        .filter_map(|key| {
            pattern_map
                .remove(&key)
                .map(|(_, vals, total, obs, exp)| (vals, total, obs, exp))
        })
        .collect();

    sorted_entries.sort_by(|a, b| {
        for (v_a, v_b) in a.0.iter().zip(b.0.iter()) {
            if let Some(ord) = v_a.partial_cmp(v_b) {
                if ord != std::cmp::Ordering::Equal {
                    return ord;
                }
            }
        }
        std::cmp::Ordering::Equal
    });

    let mut result_items = Vec::new();

    for (subpop_idx, (predictor_values, total_weight, observed_counts, expected_counts)) in
        sorted_entries.into_iter().enumerate()
    {
        for j in 0..j_count {
            let cat_val = primary.category_map[j];
            let obs = observed_counts[j];
            let exp = expected_counts[j];
            let pred_prob = if total_weight > 0.0 { exp / total_weight } else { 0.0 };
            let variance = exp * (1.0 - pred_prob);
            let residual = if variance > 1e-10 {
                (obs - exp) / variance.sqrt()
            } else {
                0.0
            };

            let obs_pct = if total_weight > 0.0 {
                (obs / total_weight) * 100.0
            } else {
                0.0
            };

            let pred_pct = if total_weight > 0.0 {
                (exp / total_weight) * 100.0
            } else {
                0.0
            };

            result_items.push(CellProbabilityItem {
                subpop_index: subpop_idx,
                predictor_values: predictor_values.clone(),
                category_index: j,
                category_value: cat_val,
                observed_count: obs,
                predicted_count: exp,
                pearson_residual: residual,
                observed_percentage: obs_pct,
                predicted_percentage: pred_pct,
            });
        }
    }

    result_items
}
