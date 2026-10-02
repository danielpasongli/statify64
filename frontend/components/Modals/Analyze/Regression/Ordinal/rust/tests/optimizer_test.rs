use nalgebra::DVector;
use statify_ordinal::{has_converged, EstimationOptions, IterationState, PlumParameters};

// Helper function untuk membentuk IterationState sintetis
// theta_val merepresentasikan parameter threshold, grad_val merepresentasikan norma gradien
fn create_state(ll: f64, grad_val: f64, param_val: f64) -> IterationState {
    IterationState {
        log_likelihood: ll,
        gradient: DVector::from_vec(vec![grad_val]),
        params: PlumParameters {
            theta: vec![param_val],
            beta: vec![],
            tau: vec![],
        },
    }
}

#[test]
fn test_path_1_converged_by_likelihood() {
    // Path 1: Predikat 1 (Node 5) bernilai True (ll_diff < convergence_tolerance)
    let mut opts = EstimationOptions::default();
    opts.convergence_tolerance = 1e-4;
    opts.gradient_tolerance = 1e-4;
    opts.parameter_tolerance = 1e-4;

    // delta LL = 0.00005 < 1e-4 (TRUE)
    // gradient & param dibuat besar agar predikat 2 & 3 FALSE
    let prev = create_state(-150.00000, 1.0, 1.0);
    let next = create_state(-150.00005, 1.0, 1.0);

    let result = has_converged(&prev, &next, &opts);
    assert!(result, "Jalur 1 harus menghasilkan konvergen via Log-Likelihood");
}

#[test]
fn test_path_2_converged_by_gradient() {
    // Path 2: Predikat 1 False, Predikat 2 (Node 6) True (grad_max < gradient_tolerance)
    let mut opts = EstimationOptions::default();
    opts.convergence_tolerance = 1e-4;
    opts.gradient_tolerance = 1e-3;
    opts.parameter_tolerance = 1e-4;

    // delta LL = 0.5 >= 1e-4 (FALSE)
    // grad_max = 0.0002 < 1e-3 (TRUE)
    // delta param dibuat besar (1.0 >= 1e-4) (FALSE)
    let prev = create_state(-150.0, 1.0, 1.0);
    let next = create_state(-149.5, 0.0002, 2.0);

    let result = has_converged(&prev, &next, &opts);
    assert!(result, "Jalur 2 harus menghasilkan konvergen via Gradien");
}

#[test]
fn test_path_3_converged_by_parameter_delta() {
    // Path 3: Predikat 1 False, Predikat 2 False, Predikat 3 (Node 7) True (delta_max < parameter_tolerance)
    let mut opts = EstimationOptions::default();
    opts.convergence_tolerance = 1e-4;
    opts.gradient_tolerance = 1e-4;
    opts.parameter_tolerance = 1e-4;

    // delta LL = 0.1 >= 1e-4 (FALSE)
    // grad_max = 0.2 >= 1e-4 (FALSE)
    // delta param = 0.00001 < 1e-4 (TRUE)
    let prev = create_state(-150.0, 0.5, 1.00000);
    let next = create_state(-149.9, 0.2, 1.00001);

    let result = has_converged(&prev, &next, &opts);
    assert!(result, "Jalur 3 harus menghasilkan konvergen via Parameter Delta");
}

#[test]
fn test_path_4_not_converged() {
    // Path 4: Seluruh predikat (Node 5, 6, 7) bernilai False
    let mut opts = EstimationOptions::default();
    opts.convergence_tolerance = 1e-4;
    opts.gradient_tolerance = 1e-4;
    opts.parameter_tolerance = 1e-4;

    // delta LL = 10.0 >= 1e-4 (FALSE)
    // grad_max = 4.0 >= 1e-4 (FALSE)
    // delta param = 0.5 >= 1e-4 (FALSE)
    let prev = create_state(-150.0, 5.0, 2.0);
    let next = create_state(-140.0, 4.0, 1.5);

    let result = has_converged(&prev, &next, &opts);
    assert!(!result, "Jalur 4 harus mengembalikan false (iterasi wajib berlanjut)");
}