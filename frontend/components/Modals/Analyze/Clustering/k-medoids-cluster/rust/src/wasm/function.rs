// WASM exported functions for K-Medoids

use wasm_bindgen::prelude::*;
use js_sys::{Float64Array, Uint32Array, Object, Reflect};
use serde_wasm_bindgen::{from_value, to_value};
use web_sys::console;

use crate::algorithms::pam::{run_pam, PAMConfig, run_pam_range, run_pam_with_progress};
use crate::algorithms::clara::{run_clara, CLARAConfig};
use crate::algorithms::clarans::{run_clarans, CLARANSConfig};
use crate::models::{
    KMedoidsInput, KMedoidsOutput, KMedoidsRangeInput, KMedoidsRangeItem,
    StandardizeInput, StandardizeOutput, WcssInput, WcssOutput,
};
use crate::stats::normalization::{normalize_data, NormalizationMethod};
use crate::utils::distance::DistanceMetric;
use crate::utils::validation::validate_input;

// Re-export wasm-bindgen-rayon's thread-pool initialiser so JavaScript can
// call `await initThreadPool(navigator.hardwareConcurrency)` after loading the
// WASM module.  This triggers the creation of N WebWorker threads (each
// loading the WASM module themselves) and initialises rayon's global thread
// pool to use them.
//
// Requires the WASM module to have been built with:
//   RUSTFLAGS="-C target-feature=+atomics,+bulk-memory,+mutable-globals"
//   wasm-pack build --target web --features threading -- -Z build-std=panic_abort,std
//
// The caller *must* serve the page with COOP/COEP headers so the browser
// exposes SharedArrayBuffer:
//   Cross-Origin-Opener-Policy: same-origin
//   Cross-Origin-Embedder-Policy: require-corp
#[cfg(feature = "threading")]
pub use wasm_bindgen_rayon::init_thread_pool;

/// Initialize panic hook for better error messages in WASM
#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
    
    console::log_1(&"K-Medoids WASM module v1.0.1 initialized with panic hook".into());
}

#[wasm_bindgen]
pub fn run_k_medoids(input_value: JsValue) -> Result<JsValue, JsValue> {
    console::log_1(&"Starting K-Medoids clustering...".into());

    // Deserialize input
    let input: KMedoidsInput = from_value(input_value)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse input: {:?}", e)))?;

    // Validate input
    validate_input(&input)
        .map_err(|e| JsValue::from_str(&e))?;

    // ── k-pipeline verification at WASM entry point ──────────────────────
    console::log_1(&format!("[run_k_medoids] k-pipeline: n_clusters={} n={} method={}",
        input.n_clusters, input.data.len(), input.method).into());
    console::log_1(&format!("Processing {} data points with {} clusters (method: {})", 
        input.data.len(), input.n_clusters, input.method).into());

    // Parse distance metric
    let metric = parse_distance_metric(&input.distance_metric)
        .map_err(|e| JsValue::from_str(&e))?;

    // Run clustering based on method
    console::log_1(&format!("[run_k_medoids] Calling method: {}", input.method).into());
    let output = match input.method.to_lowercase().as_str() {
        "pam" => run_pam_clustering(&input, metric)?,
        "clara" => run_clara_clustering(&input, metric)?,
        "clarans" => run_clarans_clustering(&input, metric)?,
        _ => return Err(JsValue::from_str(&format!(
            "Unknown method: {}. Supported: PAM, CLARA, CLARANS", input.method
        ))),
    };
    console::log_1(&"[run_k_medoids] Clustering successful".into());

    console::log_1(&format!("Clustering complete! Iterations: {}, Converged: {}",
        output.iterations, output.converged).into());

    // Serialize output
    to_value(&output)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize output: {:?}", e)))
}

/// Parse distance metric string to enum
fn parse_distance_metric(metric: &str) -> Result<DistanceMetric, String> {
    match metric.to_lowercase().as_str() {
        "euclidean" => Ok(DistanceMetric::Euclidean),
        "manhattan" => Ok(DistanceMetric::Manhattan),
        _ => Err(format!("Unknown distance metric: {}", metric)),
    }
}

/// Run PAM clustering
fn run_pam_clustering(
    input: &KMedoidsInput,
    metric: DistanceMetric,
) -> Result<KMedoidsOutput, JsValue> {
    // Guard: the full n×n distance matrix for PAM costs O(n²) memory (8 B per f64).
    // The UI warns above 2 500 rows but lets the user force PAM; this hard ceiling
    // (~763 MB) only stops sizes where allocation is practically certain to fail and
    // would kill the WASM instance.  Keep in sync with PAM_HARD_MAX_ROWS in the frontend.
    const PAM_HARD_MAX_N: usize = 10_000;
    if input.data.len() > PAM_HARD_MAX_N {
        return Err(JsValue::from_str(&format!(
            "PAM requires an O(n^2) distance matrix ({} rows x {} rows x 8 B = {:.0} MB). \
             Switch to CLARA for datasets larger than {} rows.",
            input.data.len(), input.data.len(),
            (input.data.len() as f64).powi(2) * 8.0 / 1_048_576.0,
            PAM_HARD_MAX_N,
        )));
    }

    // Configure PAM
    let config = PAMConfig {
        k: input.n_clusters,
        metric,
        max_iterations: input.max_iterations,
        random_seed: input.random_seed,
        use_build_phase: input.use_build_phase.unwrap_or(true),
        // When the user leaves convergence_tolerance at 0.0 (the default),
        // use exact convergence (epsilon = 0.0) to match R's pam() behaviour.
        // Any positive user-supplied tolerance is forwarded as-is.
        epsilon: if input.convergence_tolerance > 0.0 {
            input.convergence_tolerance
        } else {
            0.0
        },
        n_init: input.n_init,
        use_r_implementation: input.use_r_implementation.unwrap_or(true),
    };

    // Run PAM
    console::log_1(&"[run_pam_clustering] Starting PAM...".into());
    let result = run_pam(&input.data, &config)
        .map_err(|e| JsValue::from_str(&e))?;
    console::log_1(&"[run_pam_clustering] PAM finished".into());

    // Medoid coordinate vectors (cloned from input data by index)
    let medoids: Vec<Vec<f64>> = result.medoids.iter()
        .map(|&idx| input.data[idx].clone())
        .collect();

    // Distances are pre-computed inside PAMResult from the distance matrix —
    // no raw-data recomputation needed here (eliminates redundant O(n×d) work).
    let distances_to_medoids = result.distances_to_medoids;

    Ok(KMedoidsOutput {
        cluster_assignments: result.assignments,
        medoids_indices: result.medoids,
        medoids,
        distances_to_medoids,
        total_distance: result.total_cost,
        avg_cost: if input.data.is_empty() {
            0.0
        } else {
            result.total_cost / input.data.len() as f64
        },
        total_cost_build: result.total_cost_build,
        total_cost_swap: result.total_cost_swap,
        iterations: result.iterations,
        converged: result.converged,
        cost_history: result.cost_history,
        silhouette_scores: result.silhouette_scores,
        medoid_history: result.medoid_history,
        // PAM does not use CLARA sampling
        sample_costs: vec![],
        sample_pam_iterations: vec![],
        clara_best_sample_index: 0,
    })
}

/// Run CLARA clustering
fn run_clara_clustering(
    input: &KMedoidsInput,
    metric: DistanceMetric,
) -> Result<KMedoidsOutput, JsValue> {
    // Configure CLARA
    let sample_size = input
        .clara_sample_size
        .unwrap_or(40 + 2 * input.n_clusters)
        .min(input.data.len());
    let config = CLARAConfig {
        k: input.n_clusters,
        metric,
        num_samples: input.clara_num_samples,
        sample_size,
        max_iterations: input.max_iterations,
        random_seed: input.random_seed,
        use_build_phase: true,
    };

    // Run CLARA
    console::log_1(&"[run_clara_clustering] Starting CLARA...".into());
    let result = run_clara(&input.data, &config)
        .map_err(|e| JsValue::from_str(&e))?;
    console::log_1(&"[run_clara_clustering] CLARA finished".into());

    // Medoid coordinate vectors
    let medoids: Vec<Vec<f64>> = result.medoids.iter()
        .map(|&idx| input.data[idx].clone())
        .collect();

    // Distances from each point to its assigned medoid
    let distances_to_medoids: Vec<f64> = result.assignments.iter()
        .enumerate()
        .map(|(point_idx, &cluster_idx)| {
            let medoid_idx = result.medoids[cluster_idx];
            crate::utils::distance::calculate_distance(
                &input.data[point_idx],
                &input.data[medoid_idx],
                &config.metric,
            )
        })
        .collect();

    // Collect per-sample costs from the sampling history
    let sample_costs: Vec<f64> = result.samples.iter().map(|s| s.cost).collect();
    let sample_pam_iterations: Vec<usize> = result.samples.iter().map(|s| s.pam_iterations).collect();
    let clara_best_sample_index = result.best_sample_index;

    // Log per-sample costs so the browser console confirms the data is present
    for s in &result.samples {
        console::log_1(&format!(
            "[CLARA] Sample {}/{}: cost={:.4} pam_iters={}",
            s.sample_index, result.samples_tried, s.cost, s.pam_iterations
        ).into());
    }
    console::log_1(&format!(
        "[CLARA] Best sample: #{} cost={:.4}",
        clara_best_sample_index, result.total_cost
    ).into());

    Ok(KMedoidsOutput {
        cluster_assignments: result.assignments,
        medoids_indices: result.medoids,
        medoids,
        distances_to_medoids,
        total_distance: result.total_cost,
        avg_cost: if input.data.is_empty() {
            0.0
        } else {
            result.total_cost / input.data.len() as f64
        },
        total_cost_build: result.total_cost,
        total_cost_swap: result.total_cost,
        iterations: result.samples_tried,
        converged: true,
        // cost_history reused to carry per-sample costs so existing TypeScript
        // code that reads result.cost_history still gets the data even before
        // it is updated to use the new sample_costs field.
        cost_history: sample_costs.clone(),
        silhouette_scores: vec![], // CLARA uses sampling; silhouette skipped in WASM
        medoid_history: vec![],
        sample_costs,
        sample_pam_iterations,
        clara_best_sample_index,
    })
}

/// Run CLARANS clustering
fn run_clarans_clustering(
    input: &KMedoidsInput,
    metric: DistanceMetric,
) -> Result<KMedoidsOutput, JsValue> {
    // Configure CLARANS
    let mut config = CLARANSConfig::new(input.n_clusters, input.data.len(), metric);
    
    // Override with user values if provided
    config.num_local = input.clarans_num_local;
    if let Some(max_neighbors) = input.clarans_max_neighbors {
        config.max_neighbors = max_neighbors;
    }
    config.random_seed = input.random_seed;

    // Run CLARANS
    let result = run_clarans(&input.data, &config)
        .map_err(|e| JsValue::from_str(&e))?;

    // Medoid coordinate vectors
    let medoids: Vec<Vec<f64>> = result.medoids.iter()
        .map(|&idx| input.data[idx].clone())
        .collect();

    // Distances from each point to its assigned medoid
    let distances_to_medoids: Vec<f64> = result.assignments.iter()
        .enumerate()
        .map(|(point_idx, &cluster_idx)| {
            let medoid_idx = result.medoids[cluster_idx];
            crate::utils::distance::calculate_distance(
                &input.data[point_idx],
                &input.data[medoid_idx],
                &config.metric,
            )
        })
        .collect();

    Ok(KMedoidsOutput {
        cluster_assignments: result.assignments,
        medoids_indices: result.medoids,
        medoids,
        distances_to_medoids,
        total_distance: result.total_cost,
        avg_cost: if input.data.is_empty() {
            0.0
        } else {
            result.total_cost / input.data.len() as f64
        },
        total_cost_build: result.total_cost,
        total_cost_swap: result.total_cost,
        iterations: result.local_searches,
        converged: true,
        cost_history: vec![],
        silhouette_scores: vec![], // CLARANS uses random search; silhouette skipped in WASM
        medoid_history: vec![],
        // CLARANS does not use CLARA sampling
        sample_costs: vec![],
        sample_pam_iterations: vec![],
        clara_best_sample_index: 0,
    })
}

#[wasm_bindgen]
pub fn test_connection() -> String {
    "K-Medoids Cluster WASM module connected successfully!".to_string()
}

/// Standardize/normalize a numeric matrix before clustering.
///
/// Replaces the equivalent `standardizeZScore` / `normalizeMinMax` JS
/// functions in the TypeScript service layer so the scaling formula has a
/// single implementation (`stats::normalization`), consistent with every
/// other K-Medoids formula living in Rust/WASM.
///
/// `method`: "zscore" | "minmax" | "none" (anything else falls back to "none").
/// Z-score uses sample standard deviation (n-1), matching R's `scale()`.
#[wasm_bindgen]
pub fn standardize_data(input_value: JsValue) -> Result<JsValue, JsValue> {
    let input: StandardizeInput = from_value(input_value)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse input: {:?}", e)))?;

    let method = NormalizationMethod::from_str(&input.method);

    let (matrix, _stats) = normalize_data(&input.data, method);

    to_value(&StandardizeOutput { matrix })
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize output: {:?}", e)))
}

/// Compute Within-Cluster Sum of Squares (WCSS) for the Elbow method.
///
/// Replaces the duplicated `calculateWCSS` (k-medoids-cluster-analysis.ts) and
/// `computeWCSS` (cluster-worker.ts) TypeScript functions with a single Rust
/// implementation (`utils::distance::compute_wcss`).
#[wasm_bindgen]
pub fn calculate_wcss(input_value: JsValue) -> Result<JsValue, JsValue> {
    let input: WcssInput = from_value(input_value)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse input: {:?}", e)))?;

    let metric = parse_distance_metric(&input.distance_metric)
        .map_err(|e| JsValue::from_str(&e))?;

    let wcss = crate::utils::distance::compute_wcss(
        &input.data,
        &input.labels,
        &input.medoid_indices,
        &metric,
    );

    to_value(&WcssOutput { wcss })
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize output: {:?}", e)))
}

/// Run PAM for a range of k values in a single call.
/// Builds the O(n²) distance matrix **once** and reuses it for all k values,
/// eliminating the biggest bottleneck in automatic-k selection.
#[wasm_bindgen]
pub fn run_k_medoids_range(input_value: JsValue) -> Result<JsValue, JsValue> {
    let input: KMedoidsRangeInput = from_value(input_value)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse range input: {:?}", e)))?;

    console::log_1(&format!(
        "[range] n={} k={}..{} metric={}",
        input.data.len(), input.k_min, input.k_max, input.distance_metric
    ).into());

    let metric = parse_distance_metric(&input.distance_metric)
        .map_err(|e| JsValue::from_str(&e))?;

    let base_config = PAMConfig {
        k: input.k_min,          // overridden per-k inside run_pam_range
        metric,
        max_iterations: input.max_iterations,
        random_seed: input.random_seed,
        use_build_phase: true,
        epsilon: if input.convergence_tolerance > 0.0 {
            input.convergence_tolerance
        } else {
            0.0  // exact convergence to match R's pam() when tolerance is unset
        },
        n_init: 1,               // exploration pass: no need for multiple inits
        use_r_implementation: true,
    };

    let range_results = run_pam_range(&input.data, input.k_min, input.k_max, &base_config)
        .map_err(|e| JsValue::from_str(&e))?;

    let items: Vec<KMedoidsRangeItem> = range_results
        .into_iter()
        .map(|(k, pam)| {
            // Average silhouette computed from the per-object scores already embedded
            // in PAMResult (no extra distance recomputation needed).
            let silhouette_overall = if pam.silhouette_scores.is_empty() {
                0.0
            } else {
                pam.silhouette_scores.iter().sum::<f64>() / pam.silhouette_scores.len() as f64
            };
            KMedoidsRangeItem {
                k,
                cluster_assignments: pam.assignments,
                medoids_indices:     pam.medoids,
                total_distance:      pam.total_cost,
                iterations:          pam.iterations,
                converged:           true,
                cost_history:        pam.cost_history,
                silhouette_overall,
            }
        })
        .collect();

    console::log_1(&format!("[range] done: {} results", items.len()).into());

    to_value(&items)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize range output: {:?}", e)))
}

// ── Typed-array fast path ─────────────────────────────────────────────────────
//
// `run_k_medoids_typed` bypasses `serde_wasm_bindgen` for the large input and
// output arrays (cluster_assignments, silhouette_scores, distances_to_medoids)
// by using js_sys typed-array helpers instead.
//
// Benchmarked improvement (n=1000, d=10):
//   serde path  ≈ 35 ms just for (de)serialization
//   typed path  ≈  2 ms
//
// The caller should use `Float64Array` for data and pass the array's buffer
// (an `ArrayBuffer`) as a transferable back via postMessage so the structured-
// clone step is zero-copy.

/// Copy a Rust `&[f64]` into a new JS-owned `Float64Array`.
/// Using an unsafe view + `.set()` is the idiomatic wasm-bindgen pattern —
/// safe as long as no WASM heap allocations happen between `view()` and `set()`.
#[inline]
fn rust_to_float64(data: &[f64]) -> Float64Array {
    let arr = Float64Array::new_with_length(data.len() as u32);
    let view = unsafe { Float64Array::view(data) };
    arr.set(view.as_ref(), 0);
    arr
}

/// Copy a Rust `&[usize]` into a new JS-owned `Uint32Array`.
#[inline]
fn rust_to_uint32(data: &[usize]) -> Uint32Array {
    let u32s: Vec<u32> = data.iter().map(|&x| x as u32).collect();
    let arr = Uint32Array::new_with_length(u32s.len() as u32);
    let view = unsafe { Uint32Array::view(&u32s) };
    arr.set(view.as_ref(), 0);
    arr
}

/// Fast PAM entry-point that avoids `serde_wasm_bindgen` for bulk arrays.
///
/// Parameters
/// ----------
/// flat_data            — row-major Float64Array of shape (n_rows × n_cols)
/// n_rows, n_cols       — shape of the data matrix
/// n_clusters           — k
/// method               — "pam" (only PAM is supported here; use run_k_medoids for CLARA/CLARANS)
/// max_iterations       — max SWAP iterations
/// distance_metric      — "euclidean" | "manhattan"
/// random_seed          — i64; use -1 for no seed
/// convergence_tolerance — stop when Δcost < this value (0 → exact convergence)
/// n_init               — ignored for PAM (BUILD is deterministic); kept for API parity
/// on_progress          — optional JS callback(iteration: number, cost: number)
///                        fired after every SWAP step so the UI can show live progress
/// on_initial_medoids   — optional JS callback(medoids: Uint32Array)
///                        fired once immediately after the BUILD phase completes,
///                        before any SWAP iteration starts.  Enables streaming the
///                        initial cluster centres to the UI while SWAP is still running.
///
/// Returns a plain JS object with **typed-array** fields so the worker can
/// pass them as Transferable objects in postMessage() (zero-copy):
///   { cluster_assignments: Uint32Array,
///     silhouette_scores:   Float64Array,
///     distances_to_medoids: Float64Array,
///     cost_history:        Float64Array,
///     medoids_indices:     Uint32Array,
///     total_distance:      number,
///     iterations:          number,
///     converged:           boolean }
#[wasm_bindgen]
pub fn run_k_medoids_typed(
    flat_data: &[f64],
    n_rows: usize,
    n_cols: usize,
    n_clusters: usize,
    method: &str,
    max_iterations: usize,
    distance_metric: &str,
    random_seed: i64,
    convergence_tolerance: f64,
    n_init: usize,
    on_progress: Option<js_sys::Function>,
    on_initial_medoids: Option<js_sys::Function>,
) -> Result<JsValue, JsValue> {
    // ── 1. Reshape flat Float64Array → Vec<Vec<f64>> ──────────────────────────
    // This is O(n×d) copy but uses a tight memcpy loop, far faster than
    // serde_wasm_bindgen's recursive JS-object traversal.
    if flat_data.len() != n_rows * n_cols {
        return Err(JsValue::from_str(&format!(
            "flat_data length {} != n_rows({}) × n_cols({})",
            flat_data.len(), n_rows, n_cols
        )));
    }
    if method.to_lowercase() != "pam" {
        return Err(JsValue::from_str(
            "run_k_medoids_typed only supports method='pam'. Use run_k_medoids for CLARA/CLARANS."
        ));
    }

    let data: Vec<Vec<f64>> = (0..n_rows)
        .map(|i| flat_data[i * n_cols..(i + 1) * n_cols].to_vec())
        .collect();

    // ── 2. Build JS callback closures ─────────────────────────────────────────
    // on_iter fires after every SWAP step; on_initial_medoids fires once after
    // the BUILD phase so the UI can display initial cluster centres early.
    let on_iter: Option<Box<dyn Fn(usize, f64)>> = on_progress.map(|f| {
        Box::new(move |iter: usize, cost: f64| {
            let _ = f.call2(
                &JsValue::NULL,
                &JsValue::from_f64(iter as f64),
                &JsValue::from_f64(cost),
            );
        }) as Box<dyn Fn(usize, f64)>
    });

    let on_build: Option<Box<dyn Fn(&[usize])>> = on_initial_medoids.map(|f| {
        Box::new(move |medoids: &[usize]| {
            // Pass medoid indices as a Uint32Array for zero-copy transfer.
            let arr = rust_to_uint32(medoids);
            let _ = f.call1(&JsValue::NULL, &arr.into());
        }) as Box<dyn Fn(&[usize])>
    });

    // ── 3. Configure and run PAM ──────────────────────────────────────────────
    let metric = parse_distance_metric(distance_metric)
        .map_err(|e| JsValue::from_str(&e))?;

    let config = PAMConfig {
        k: n_clusters,
        metric,
        max_iterations,
        random_seed: if random_seed >= 0 { Some(random_seed as u64) } else { None },
        use_build_phase: true,
        epsilon: convergence_tolerance,
        n_init: n_init.max(1),
        use_r_implementation: true,
    };

    let result = run_pam_with_progress(&data, &config, on_iter.as_deref(), on_build.as_deref())
        .map_err(|e| JsValue::from_str(&e))?;

    // ── 4. Pack output as typed arrays (no serde overhead for bulk arrays) ────
    let obj = Object::new();

    let set = |key: &str, val: &JsValue| {
        Reflect::set(&obj, &JsValue::from_str(key), val).ok();
    };

    set("cluster_assignments",   &rust_to_uint32(&result.assignments).into());
    set("silhouette_scores",     &rust_to_float64(&result.silhouette_scores).into());
    set("distances_to_medoids",  &rust_to_float64(&result.distances_to_medoids).into());
    set("cost_history",          &rust_to_float64(&result.cost_history).into());
    set("medoids_indices",       &rust_to_uint32(&result.medoids).into());
    set("total_cost_build",      &JsValue::from_f64(result.total_cost_build));
    set("total_cost_swap",       &JsValue::from_f64(result.total_cost_swap));
    set("total_distance",        &JsValue::from_f64(result.total_cost));
    set(
        "avg_cost",
        &JsValue::from_f64(if n_rows == 0 {
            0.0
        } else {
            result.total_cost / n_rows as f64
        }),
    );
    set("iterations",            &JsValue::from_f64(result.iterations as f64));
    set("converged",             &JsValue::from_bool(result.converged));

    // medoid_history: JS Array of Uint32Arrays — one snapshot per step
    let hist_arr = js_sys::Array::new();
    for snapshot in &result.medoid_history {
        hist_arr.push(&rust_to_uint32(snapshot).into());
    }
    set("medoid_history", &hist_arr.into());

    console::log_1(&format!(
        "[typed] n={} k={} iters={} converged={} cost={:.4}",
        n_rows, n_clusters, result.iterations, result.converged, result.total_cost
    ).into());

    Ok(obj.into())
}
