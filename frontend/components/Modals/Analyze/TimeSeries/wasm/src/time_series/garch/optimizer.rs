use liblbfgs::lbfgs;
use crate::time_series::ecm::ols_helper::invert_matrix;

const LOG_2_PI: f64 = 1.8378770664093454; // ln(2*pi)

// Helper standard normal CDF & error function for p-value calculation
fn normal_cdf(x: f64) -> f64 {
    0.5 * (1.0 + erf(x / 2.0_f64.sqrt()))
}

fn erf(x: f64) -> f64 {
    let a1 = 0.254829592;
    let a2 = -0.284496736;
    let a3 = 1.421413741;
    let a4 = -1.453152027;
    let a5 = 1.061405429;
    let p = 0.3275911;

    let sign = if x < 0.0 { -1.0 } else { 1.0 };
    let x = x.abs();

    let t = 1.0 / (1.0 + p * x);
    let y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * (-x * x).exp();

    sign * y
}

fn safe_sigmoid(x: f64) -> f64 {
    if x >= 0.0 {
        1.0 / (1.0 + (-x).exp())
    } else {
        let ex = x.exp();
        ex / (1.0 + ex)
    }
}

// Helper: compute z-stat and p-value from coefficients and standard errors
pub(crate) fn compute_z_and_p(coef: &[f64], se: &[f64]) -> (Vec<f64>, Vec<f64>) {
    let n = coef.len();
    let mut z_stats = vec![0.0; n];
    let mut p_values = vec![1.0; n];
    for i in 0..n {
        let s = se[i];
        if s > 0.0 {
            let z = coef[i] / s;
            z_stats[i] = z;
            p_values[i] = 2.0 * (1.0 - normal_cdf(z.abs()));
        }
    }
    (z_stats, p_values)
}

// Data Scaler for robust numeric optimization (rescaling sample std to ~1.0)
struct DataScaler {
    scale_factor: f64,
}

impl DataScaler {
    fn new(data: &[f64]) -> Self {
        let n = data.len();
        if n == 0 {
            return Self {
                scale_factor: 1.0,
            };
        }
        let sample_mean = data.iter().sum::<f64>() / n as f64;
        let sample_var =
            data.iter().map(|&r| (r - sample_mean).powi(2)).sum::<f64>() / n.max(1) as f64;

        let scale_factor = if sample_var > 1e-12 {
            let std = sample_var.sqrt();
            if std < 0.01 || std > 100.0 {
                1.0 / std
            } else {
                1.0
            }
        } else {
            1.0
        };

        Self {
            scale_factor,
        }
    }

    fn scale(&self, data: &[f64]) -> Vec<f64> {
        if (self.scale_factor - 1.0).abs() < 1e-10 {
            data.to_vec()
        } else {
            data.iter().map(|&y| y * self.scale_factor).collect()
        }
    }
}

// Matrix invert fallback with diagonal regularization if singular
fn invert_matrix_safe(mat: &[Vec<f64>]) -> Option<Vec<f64>> {
    if let Some(inv) = invert_matrix(mat) {
        return Some(inv.into_iter().flatten().collect());
    }
    // Try adding small diagonal ridge regularization
    let n = mat.len();
    let mut reg = mat.to_vec();
    for i in 0..n {
        reg[i][i] += 1e-6;
    }
    invert_matrix(&reg).map(|inv| inv.into_iter().flatten().collect())
}

// =====================================================================
// GARCH(p,q) — Analytical Gradient & OPG Standard Errors
// =====================================================================
// Parameter layout:
//   x = [mu, ln(ω), ln(α₁..q), theta_beta₁..p]
//   where beta_j = 0.999 * sigmoid(theta_beta_j)
fn garch_neg_ll_and_grad(
    data: &[f64],
    x: &[f64],
    p: usize,
    q: usize,
    var_buf: &mut Vec<f64>,
    grad: &mut [f64],
) -> f64 {
    let n = data.len();
    let n_params = 2 + q + p;
    let max_lag = p.max(q).max(1);

    for &val in x.iter() {
        if val.is_nan() || val.is_infinite() {
            for g in grad.iter_mut() {
                *g = 0.0;
            }
            return 1e15;
        }
    }

    let mu = x[0];
    let omega = x[1].exp();
    let alpha: Vec<f64> = (1..=q).map(|i| x[1 + i].exp()).collect();
    let beta: Vec<f64> = (1..=p)
        .map(|j| 0.999 * safe_sigmoid(x[1 + q + j]))
        .collect();

    let persistence = alpha.iter().sum::<f64>() + beta.iter().sum::<f64>();
    let mut penalty = 0.0;
    let limit = 0.999;
    if persistence >= limit {
        let diff = persistence - limit;
        penalty = 1e5 * diff * diff;
    }

    let residuals: Vec<f64> = data.iter().map(|&r| r - mu).collect();
    let var_uncon: f64 =
        (residuals.iter().map(|r| r * r).sum::<f64>() / n as f64).max(1e-8);

    var_buf.clear();
    for _ in 0..max_lag {
        var_buf.push(var_uncon);
    }

    for g in grad.iter_mut() {
        *g = 0.0;
    }

    let win = p.max(1);
    let mut dvar_win: Vec<Vec<f64>> = vec![vec![0.0f64; n_params]; win];
    let mut neg_ll = 0.0f64;

    for t in max_lag..n {
        let mut var_t = omega;
        for (i, &ai) in alpha.iter().enumerate() {
            var_t += ai * residuals[t - 1 - i].powi(2);
        }
        for (j, &bj) in beta.iter().enumerate() {
            var_t += bj * var_buf[t - 1 - j];
        }
        if var_t.is_nan() {
            for g in grad.iter_mut() {
                *g = 0.0;
            }
            return 1e15;
        }
        var_t = var_t.clamp(1e-10, 1e12);
        var_buf.push(var_t);

        let cur_slot = t % win;
        let mut dvar_cur = vec![0.0f64; n_params];

        // ∂σ²_t/∂mu
        let mut d_mu = 0.0;
        for (i, &ai) in alpha.iter().enumerate() {
            d_mu += -2.0 * ai * residuals[t - 1 - i];
        }
        for (j, &bj) in beta.iter().enumerate() {
            d_mu += bj * dvar_win[(t - 1 - j) % win][0];
        }
        dvar_cur[0] = d_mu;

        // ∂σ²_t/∂ω
        let mut d_omega = 1.0;
        for (j, &bj) in beta.iter().enumerate() {
            d_omega += bj * dvar_win[(t - 1 - j) % win][1];
        }
        dvar_cur[1] = d_omega;

        // ∂σ²_t/∂α_i
        for i in 0..q {
            let k = 2 + i;
            let mut d_alpha = residuals[t - 1 - i].powi(2);
            for (j, &bj) in beta.iter().enumerate() {
                d_alpha += bj * dvar_win[(t - 1 - j) % win][k];
            }
            dvar_cur[k] = d_alpha;
        }

        // ∂σ²_t/∂β_j
        for j in 0..p {
            let k = 2 + q + j;
            let mut d_beta = var_buf[t - 1 - j];
            for (j2, &bj2) in beta.iter().enumerate() {
                d_beta += bj2 * dvar_win[(t - 1 - j2) % win][k];
            }
            dvar_cur[k] = d_beta;
        }

        for val in dvar_cur.iter_mut() {
            *val = val.clamp(-1e8, 1e8);
        }

        let eps = residuals[t];
        let eps2 = eps.powi(2);
        let factor = 0.5 * (1.0 - eps2 / var_t) / var_t;

        let mut g_t = vec![0.0; n_params];
        g_t[0] = factor * dvar_cur[0] - eps / var_t;
        g_t[1] = factor * dvar_cur[1] * omega;
        for i in 0..q {
            g_t[2 + i] = factor * dvar_cur[2 + i] * alpha[i];
        }
        for j in 0..p {
            let bj = beta[j];
            let d_beta_d_theta = bj * (1.0 - bj / 0.999);
            g_t[2 + q + j] = factor * dvar_cur[2 + q + j] * d_beta_d_theta;
        }

        for k in 0..n_params {
            grad[k] += g_t[k];
        }

        neg_ll += 0.5 * (var_t.ln() + eps2 / var_t);
        dvar_win[cur_slot] = dvar_cur;
    }

    if persistence >= limit {
        let diff = persistence - limit;
        let factor_penalty = 2.0 * 1e5 * diff;
        for i in 0..q {
            grad[2 + i] += factor_penalty * alpha[i];
        }
        for j in 0..p {
            let bj = beta[j];
            let d_beta_d_theta = bj * (1.0 - bj / 0.999);
            grad[2 + q + j] += factor_penalty * d_beta_d_theta;
        }
    }

    neg_ll + penalty
}

fn compute_garch_opg_se(
    data: &[f64],
    p: usize,
    q: usize,
    mu: f64,
    omega: f64,
    alpha: &[f64],
    beta: &[f64],
) -> Option<Vec<f64>> {
    let n = data.len();
    let n_params = 2 + q + p;
    let max_lag = p.max(q).max(1);

    let residuals: Vec<f64> = data.iter().map(|&r| r - mu).collect();
    let var_uncon: f64 = (residuals.iter().map(|r| r * r).sum::<f64>() / n as f64).max(1e-8);

    let mut var_buf = Vec::with_capacity(n);
    for _ in 0..max_lag {
        var_buf.push(var_uncon);
    }

    let win = p.max(1);
    let mut dvar_win: Vec<Vec<f64>> = vec![vec![0.0f64; n_params]; win];
    let mut opg_matrix = vec![vec![0.0f64; n_params]; n_params];

    for t in max_lag..n {
        let mut var_t = omega;
        for (i, &ai) in alpha.iter().enumerate() {
            var_t += ai * residuals[t - 1 - i].powi(2);
        }
        for (j, &bj) in beta.iter().enumerate() {
            var_t += bj * var_buf[t - 1 - j];
        }
        if var_t.is_nan() {
            return None;
        }
        var_t = var_t.clamp(1e-10, 1e12);
        var_buf.push(var_t);

        let cur_slot = t % win;
        let mut dvar_cur = vec![0.0f64; n_params];

        let mut d_mu = 0.0;
        for (i, &ai) in alpha.iter().enumerate() {
            d_mu += -2.0 * ai * residuals[t - 1 - i];
        }
        for (j, &bj) in beta.iter().enumerate() {
            d_mu += bj * dvar_win[(t - 1 - j) % win][0];
        }
        dvar_cur[0] = d_mu;

        let mut d_omega = 1.0;
        for (j, &bj) in beta.iter().enumerate() {
            d_omega += bj * dvar_win[(t - 1 - j) % win][1];
        }
        dvar_cur[1] = d_omega;

        for i in 0..q {
            let k = 2 + i;
            let mut d_alpha = residuals[t - 1 - i].powi(2);
            for (j, &bj) in beta.iter().enumerate() {
                d_alpha += bj * dvar_win[(t - 1 - j) % win][k];
            }
            dvar_cur[k] = d_alpha;
        }

        for j in 0..p {
            let k = 2 + q + j;
            let mut d_beta = var_buf[t - 1 - j];
            for (j2, &bj2) in beta.iter().enumerate() {
                d_beta += bj2 * dvar_win[(t - 1 - j2) % win][k];
            }
            dvar_cur[k] = d_beta;
        }

        let eps = residuals[t];
        let eps2 = eps.powi(2);
        let factor = 0.5 * (1.0 - eps2 / var_t) / var_t;

        let mut g_t = vec![0.0; n_params];
        g_t[0] = factor * dvar_cur[0] - eps / var_t;
        g_t[1] = factor * dvar_cur[1];
        for i in 0..q {
            g_t[2 + i] = factor * dvar_cur[2 + i];
        }
        for j in 0..p {
            g_t[2 + q + j] = factor * dvar_cur[2 + q + j];
        }

        for k in 0..n_params {
            for l in 0..n_params {
                opg_matrix[k][l] += g_t[k] * g_t[l];
            }
        }
        dvar_win[cur_slot] = dvar_cur;
    }

    let inv_flat = invert_matrix_safe(&opg_matrix)?;
    let mut se = vec![0.0; n_params];
    for k in 0..n_params {
        se[k] = inv_flat[k * n_params + k].max(0.0).sqrt();
    }

    Some(se)
}

pub(crate) fn estimate_garch_lbfgs(
    raw_data: &[f64],
    p: usize,
    q: usize,
) -> (f64, f64, Vec<f64>, Vec<f64>, Vec<f64>, f64, Vec<f64>) {
    let n = raw_data.len();
    let n_params = 2 + q + p;
    let max_lag = p.max(q).max(1);

    if n < 10 {
        let vu = raw_data.iter().map(|r| r * r).sum::<f64>() / n.max(1) as f64;
        return (0.0, vu * 0.1, vec![0.1; q], vec![0.8; p], vec![vu; n], 0.0, vec![0.0; n_params]);
    }

    let scaler = DataScaler::new(raw_data);
    let data = scaler.scale(raw_data);
    let s = scaler.scale_factor;

    let sample_mean: f64 = data.iter().sum::<f64>() / n as f64;
    let residuals_init: Vec<f64> = data.iter().map(|&r| r - sample_mean).collect();
    let var_uncon: f64 = residuals_init.iter().map(|r| r * r).sum::<f64>() / n as f64;

    // Multi-start initial guesses for small N or non-convergence prevention
    let initial_candidates: Vec<(f64, f64)> = vec![
        (0.10_f64, 0.80_f64),
        (0.05_f64, 0.90_f64),
        (0.20_f64, 0.65_f64),
    ];

    let mut best_ll = -1e18;
    let mut best_x = vec![0.0f64; n_params];

    for (alpha_init, beta_init) in initial_candidates {
        let alpha_init: f64 = alpha_init;
        let beta_init: f64 = beta_init;
        let mut x_cand = vec![0.0f64; n_params];
        x_cand[0] = sample_mean;
        x_cand[1] = (var_uncon * (1.0 - alpha_init - beta_init).max(0.01_f64)).max(1e-6_f64).ln();
        for i in 1..=q {
            x_cand[1 + i] = alpha_init.ln();
        }
        for j in 1..=p {
            let b_val = (beta_init / 0.999_f64).clamp(0.001_f64, 0.999_f64);
            x_cand[1 + q + j] = (b_val / (1.0 - b_val)).ln(); // inverse logit
        }

        let mut var_buf = Vec::with_capacity(n);
        let _ = lbfgs()
            .with_max_iterations(500)
            .with_epsilon(1e-7)
            .minimize(
                &mut x_cand,
                |x_cur, gx| {
                    let neg_ll = garch_neg_ll_and_grad(&data, x_cur, p, q, &mut var_buf, gx);
                    Ok(neg_ll)
                },
                |_| false,
            );

        // Evaluate candidate log likelihood
        let mu_c = x_cand[0];
        let omega_c = x_cand[1].exp();
        let alpha_c: Vec<f64> = (1..=q).map(|i| x_cand[1 + i].exp()).collect();
        let beta_c: Vec<f64> = (1..=p).map(|j| 0.999 * safe_sigmoid(x_cand[1 + q + j])).collect();

        let residuals_c: Vec<f64> = data.iter().map(|&r| r - mu_c).collect();
        let mut v_buf_c = vec![var_uncon; max_lag];
        for t in max_lag..n {
            let mut vt = omega_c;
            for (i, &ai) in alpha_c.iter().enumerate() {
                vt += ai * residuals_c[t - 1 - i].powi(2);
            }
            for (j, &bj) in beta_c.iter().enumerate() {
                vt += bj * v_buf_c[t - 1 - j];
            }
            v_buf_c.push(vt.clamp(1e-10, 1e12));
        }

        let n_eff = n - max_lag;
        let ll_c: f64 = v_buf_c
            .iter()
            .zip(residuals_c.iter())
            .skip(max_lag)
            .filter(|(&v, _)| v > 0.0)
            .map(|(&v, &e)| -0.5 * (v.ln() + e.powi(2) / v))
            .sum::<f64>()
            + (n_eff as f64) * (-0.5 * LOG_2_PI);

        if ll_c > best_ll && !ll_c.is_nan() {
            best_ll = ll_c;
            best_x = x_cand;
        }
    }

    let mu_opt = best_x[0] / s;
    let omega_opt = best_x[1].exp() / (s * s);
    let alpha_opt: Vec<f64> = (1..=q).map(|i| best_x[1 + i].exp()).collect();
    let beta_opt: Vec<f64> = (1..=p).map(|j| 0.999 * safe_sigmoid(best_x[1 + q + j])).collect();

    // Recompute final variance buffer on raw data
    let residuals_opt: Vec<f64> = raw_data.iter().map(|&r| r - mu_opt).collect();
    let var_uncon_opt = (residuals_opt.iter().map(|r| r * r).sum::<f64>() / n as f64).max(1e-10);

    let mut var_buf = vec![var_uncon_opt; max_lag];
    for t in max_lag..n {
        let mut vt = omega_opt;
        for (i, &ai) in alpha_opt.iter().enumerate() {
            vt += ai * residuals_opt[t - 1 - i].powi(2);
        }
        for (j, &bj) in beta_opt.iter().enumerate() {
            vt += bj * var_buf[t - 1 - j];
        }
        var_buf.push(vt.clamp(1e-12, 1e12));
    }

    let n_eff = n - max_lag;
    let log_lik_unadj: f64 = var_buf
        .iter()
        .zip(residuals_opt.iter())
        .skip(max_lag)
        .filter(|(&v, _)| v > 0.0)
        .map(|(&v, &e)| -0.5 * (v.ln() + e.powi(2) / v))
        .sum();
    let log_lik = log_lik_unadj + (n_eff as f64) * (-0.5 * LOG_2_PI);

    let mut se = compute_garch_opg_se(&data, p, q, best_x[0], best_x[1].exp(), &alpha_opt, &beta_opt)
        .unwrap_or_else(|| vec![0.0; n_params]);

    // Rescale standard errors back to raw data scale
    se[0] /= s;
    se[1] /= s * s;

    (mu_opt, omega_opt, alpha_opt, beta_opt, var_buf, log_lik, se)
}

// =====================================================================
// EGARCH(p,q) — Anti-NaN & Persistence Bounded
// =====================================================================
// Parameter layout:
//   x = [mu, ω, ln(α₁..q), γ₁..q, theta_beta₁..p]
//   where beta_j = 0.999 * tanh(theta_beta_j)
// Note: EGARCH now uses EViews convention (alpha*|z|, no E|z| subtraction)
// so SQRT_2_OVER_PI is no longer needed in the recursion.
fn egarch_neg_ll_and_grad(
    data: &[f64],
    x: &[f64],
    p: usize,
    q: usize,
    h_buf: &mut Vec<f64>,
    var_buf: &mut Vec<f64>,
    grad: &mut [f64],
) -> f64 {
    let n = data.len();
    for &val in x.iter() {
        if val.is_nan() || val.is_infinite() {
            for g in grad.iter_mut() {
                *g = 0.0;
            }
            return 1e15;
        }
    }
    let n_params = 1 + 1 + 2 * q + p;
    let max_lag = p.max(q).max(1);

    let mu = x[0];
    let omega = x[1];
    let alpha: Vec<f64> = (1..=q).map(|i| x[1 + i].exp()).collect();
    let gamma_v: Vec<f64> = (1..=q).map(|i| x[1 + q + i]).collect();
    let beta: Vec<f64> = (1 + 2 * q + 1..=1 + 2 * q + p).map(|i| 0.999 * x[i].tanh()).collect();

    let residuals: Vec<f64> = data.iter().map(|&r| r - mu).collect();
    let var_uncon: f64 =
        (residuals.iter().map(|r| r * r).sum::<f64>() / n as f64).max(1e-8);
    let h_uncon = var_uncon.ln().clamp(-20.0, 20.0);

    h_buf.clear();
    var_buf.clear();
    for _ in 0..max_lag {
        h_buf.push(h_uncon);
        var_buf.push(var_uncon);
    }

    for g in grad.iter_mut() {
        *g = 0.0;
    }

    let win = p.max(1);
    let mut dh_win: Vec<Vec<f64>> = vec![vec![0.0f64; n_params]; win];
    let mut neg_ll = 0.0f64;

    for t in max_lag..n {
        let mut h_t = omega;
        for (i, (&ai, &gi)) in alpha.iter().zip(gamma_v.iter()).enumerate() {
            let sigma_prev = var_buf[t - 1 - i].max(1e-12).sqrt();
            let z_prev = (residuals[t - 1 - i] / sigma_prev).clamp(-10.0, 10.0);
            // EViews convention: h_t = omega + alpha*|z| + gamma*z + beta*h_{t-1}
            // (no E|z| subtraction — makes omega directly equal to EViews C(2))
            h_t += ai * z_prev.abs() + gi * z_prev;
        }
        for (j, &bj) in beta.iter().enumerate() {
            h_t += bj * h_buf[t - 1 - j];
        }
        if h_t.is_nan() {
            for g in grad.iter_mut() {
                *g = 0.0;
            }
            return 1e15;
        }
        h_t = h_t.clamp(-30.0, 30.0);
        let var_t = h_t.exp().clamp(1e-10, 1e12);
        h_buf.push(h_t);
        var_buf.push(var_t);

        let cur_slot = t % win;
        let mut dh_cur = vec![0.0f64; n_params];

        // ∂h_t/∂mu
        let mut d_mu = 0.0;
        for (j, &bj) in beta.iter().enumerate() {
            d_mu += bj * dh_win[(t - 1 - j) % win][0];
        }
        dh_cur[0] = d_mu;

        // ∂h_t/∂ω
        let mut d_omega = 1.0;
        for (j, &bj) in beta.iter().enumerate() {
            d_omega += bj * dh_win[(t - 1 - j) % win][1];
        }
        dh_cur[1] = d_omega;

        // ∂h_t/∂α_i
        for i in 0..q {
            let k = 2 + i;
            let sigma_prev = var_buf[t - 1 - i].max(1e-12).sqrt();
            let z_prev = (residuals[t - 1 - i] / sigma_prev).clamp(-10.0, 10.0);
            // ∂h_t/∂α_i: d(alpha*|z|)/d(ln alpha) = alpha*|z| (EViews convention, no E|z| term)
            let mut d_alpha = z_prev.abs();
            for (j, &bj) in beta.iter().enumerate() {
                d_alpha += bj * dh_win[(t - 1 - j) % win][k];
            }
            dh_cur[k] = d_alpha;
        }

        // ∂h_t/∂γ_i
        for i in 0..q {
            let k = 2 + q + i;
            let sigma_prev = var_buf[t - 1 - i].max(1e-12).sqrt();
            let z_prev = (residuals[t - 1 - i] / sigma_prev).clamp(-10.0, 10.0);
            let mut d_gamma = z_prev;
            for (j, &bj) in beta.iter().enumerate() {
                d_gamma += bj * dh_win[(t - 1 - j) % win][k];
            }
            dh_cur[k] = d_gamma;
        }

        // ∂h_t/∂β_j
        for j in 0..p {
            let k = 2 + 2 * q + j;
            let mut d_beta = h_buf[t - 1 - j];
            for (j2, &bj2) in beta.iter().enumerate() {
                d_beta += bj2 * dh_win[(t - 1 - j2) % win][k];
            }
            dh_cur[k] = d_beta;
        }

        for val in dh_cur.iter_mut() {
            *val = val.clamp(-1e8, 1e8);
        }

        let eps = residuals[t];
        let eps2 = eps.powi(2);
        let factor = 0.5 * (1.0 - eps2 / var_t);

        let mut g_t = vec![0.0; n_params];
        g_t[0] = factor * dh_cur[0] - eps / var_t;
        g_t[1] = factor * dh_cur[1];
        for i in 0..q {
            g_t[2 + i] = factor * dh_cur[2 + i] * alpha[i];
        }
        for i in 0..q {
            g_t[2 + q + i] = factor * dh_cur[2 + q + i];
        }
        for j in 0..p {
            let bj = beta[j];
            let d_beta_d_theta = 0.999 - (bj * bj) / 0.999;
            g_t[2 + 2 * q + j] = factor * dh_cur[2 + 2 * q + j] * d_beta_d_theta;
        }

        for k in 0..n_params {
            grad[k] += g_t[k];
        }

        neg_ll += 0.5 * (h_t + eps2 / var_t);
        dh_win[cur_slot] = dh_cur;
    }

    neg_ll
}

fn compute_egarch_opg_se(
    data: &[f64],
    p: usize,
    q: usize,
    mu: f64,
    omega: f64,
    alpha: &[f64],
    gamma_v: &[f64],
    beta: &[f64],
) -> Option<Vec<f64>> {
    let n = data.len();
    let n_params = 1 + 1 + 2 * q + p;
    let max_lag = p.max(q).max(1);

    let residuals: Vec<f64> = data.iter().map(|&r| r - mu).collect();
    let var_uncon: f64 = (residuals.iter().map(|r| r * r).sum::<f64>() / n as f64).max(1e-8);
    let h_uncon = var_uncon.ln().clamp(-20.0, 20.0);

    let mut h_buf = Vec::with_capacity(n);
    let mut var_buf = Vec::with_capacity(n);
    for _ in 0..max_lag {
        h_buf.push(h_uncon);
        var_buf.push(var_uncon);
    }

    let win = p.max(1);
    let mut dh_win: Vec<Vec<f64>> = vec![vec![0.0f64; n_params]; win];
    let mut opg_matrix = vec![vec![0.0f64; n_params]; n_params];

    for t in max_lag..n {
        let mut h_t = omega;
        for (i, (&ai, &gi)) in alpha.iter().zip(gamma_v.iter()).enumerate() {
            let sigma_prev = var_buf[t - 1 - i].max(1e-12).sqrt();
            let z_prev = (residuals[t - 1 - i] / sigma_prev).clamp(-10.0, 10.0);
            // EViews convention: no E|z| subtraction
            h_t += ai * z_prev.abs() + gi * z_prev;
        }
        for (j, &bj) in beta.iter().enumerate() {
            h_t += bj * h_buf[t - 1 - j];
        }
        if h_t.is_nan() {
            return None;
        }
        h_t = h_t.clamp(-30.0, 30.0);
        let var_t = h_t.exp().clamp(1e-10, 1e12);
        h_buf.push(h_t);
        var_buf.push(var_t);

        let cur_slot = t % win;
        let mut dh_cur = vec![0.0f64; n_params];

        let mut d_mu = 0.0;
        for (j, &bj) in beta.iter().enumerate() {
            d_mu += bj * dh_win[(t - 1 - j) % win][0];
        }
        dh_cur[0] = d_mu;

        let mut d_omega = 1.0;
        for (j, &bj) in beta.iter().enumerate() {
            d_omega += bj * dh_win[(t - 1 - j) % win][1];
        }
        dh_cur[1] = d_omega;

        for i in 0..q {
            let k = 2 + i;
            let sigma_prev = var_buf[t - 1 - i].max(1e-12).sqrt();
            let z_prev = (residuals[t - 1 - i] / sigma_prev).clamp(-10.0, 10.0);
            // EViews convention: d_alpha = |z| (no E|z| subtraction)
            let mut d_alpha = z_prev.abs();
            for (j, &bj) in beta.iter().enumerate() {
                d_alpha += bj * dh_win[(t - 1 - j) % win][k];
            }
            dh_cur[k] = d_alpha;
        }

        for i in 0..q {
            let k = 2 + q + i;
            let sigma_prev = var_buf[t - 1 - i].max(1e-12).sqrt();
            let z_prev = (residuals[t - 1 - i] / sigma_prev).clamp(-10.0, 10.0);
            let mut d_gamma = z_prev;
            for (j, &bj) in beta.iter().enumerate() {
                d_gamma += bj * dh_win[(t - 1 - j) % win][k];
            }
            dh_cur[k] = d_gamma;
        }

        for j in 0..p {
            let k = 2 + 2 * q + j;
            let mut d_beta = h_buf[t - 1 - j];
            for (j2, &bj2) in beta.iter().enumerate() {
                d_beta += bj2 * dh_win[(t - 1 - j2) % win][k];
            }
            dh_cur[k] = d_beta;
        }

        let eps = residuals[t];
        let eps2 = eps.powi(2);
        let factor = 0.5 * (1.0 - eps2 / var_t);

        let mut g_t = vec![0.0; n_params];
        g_t[0] = factor * dh_cur[0] - eps / var_t;
        g_t[1] = factor * dh_cur[1];
        for i in 0..q {
            g_t[2 + i] = factor * dh_cur[2 + i];
        }
        for i in 0..q {
            g_t[2 + q + i] = factor * dh_cur[2 + q + i];
        }
        for j in 0..p {
            g_t[2 + 2 * q + j] = factor * dh_cur[2 + 2 * q + j];
        }

        for k in 0..n_params {
            for l in 0..n_params {
                opg_matrix[k][l] += g_t[k] * g_t[l];
            }
        }
        dh_win[cur_slot] = dh_cur;
    }

    let inv_flat = invert_matrix_safe(&opg_matrix)?;
    let mut se = vec![0.0; n_params];
    for k in 0..n_params {
        se[k] = inv_flat[k * n_params + k].max(0.0).sqrt();
    }

    Some(se)
}

pub(crate) fn estimate_egarch_lbfgs(
    raw_data: &[f64],
    p: usize,
    q: usize,
) -> (f64, f64, Vec<f64>, Vec<f64>, Vec<f64>, Vec<f64>, f64, Vec<f64>) {
    let n = raw_data.len();
    let n_params = 1 + 1 + 2 * q + p;
    let max_lag = p.max(q).max(1);

    if n < 10 {
        let vu = raw_data.iter().map(|r| r * r).sum::<f64>() / n.max(1) as f64;
        return (0.0, 0.0, vec![0.3; q], vec![-0.1; q], vec![0.85; p], vec![vu; n], 0.0, vec![0.0; n_params]);
    }

    let scaler = DataScaler::new(raw_data);
    let data = scaler.scale(raw_data);
    let s = scaler.scale_factor;

    let sample_mean: f64 = data.iter().sum::<f64>() / n as f64;
    let residuals_init: Vec<f64> = data.iter().map(|&r| r - sample_mean).collect();
    let var_uncon: f64 = residuals_init.iter().map(|r| r * r).sum::<f64>() / n as f64;
    let h_uncon = var_uncon.max(1e-8).ln();

    let mut x = vec![0.0f64; n_params];
    x[0] = sample_mean;
    x[1] = h_uncon * 0.15;
    for i in 1..=q {
        x[1 + i] = 0.20_f64.ln();
    }
    for i in 1..=q {
        x[1 + q + i] = -0.05;
    }
    for j in 1..=p {
        let beta_target = 0.85_f64;
        x[1 + 2 * q + j] = ((beta_target / 0.999).clamp(-0.99, 0.99)).atanh();
    }

    let mut h_buf = Vec::with_capacity(n);
    let mut var_buf = Vec::with_capacity(n);

    let _ = lbfgs()
        .with_max_iterations(500)
        .with_epsilon(1e-7)
        .minimize(
            &mut x,
            |x_cur, gx| {
                let neg_ll = egarch_neg_ll_and_grad(&data, x_cur, p, q, &mut h_buf, &mut var_buf, gx);
                Ok(neg_ll)
            },
            |_| false,
        );

    let mu_scaled = x[0];
    let omega_scaled = x[1];
    let alpha_opt: Vec<f64> = (1..=q).map(|i| x[1 + i].exp()).collect();
    let gamma_opt: Vec<f64> = (1..=q).map(|i| x[1 + q + i]).collect();
    let beta_opt: Vec<f64> = (1 + 2 * q + 1..=1 + 2 * q + p).map(|i| 0.999 * x[i].tanh()).collect();

    let sum_beta: f64 = beta_opt.iter().sum();

    // Restore raw data parameters:
    let mu_opt = mu_scaled / s;
    // EGARCH omega back-transform: omega_orig = omega_scaled - (1 - sum_beta) * ln(s^2)
    // This is because h_t = omega + alpha*|z| + gamma*z + beta*h_{t-1}
    // When data is scaled by s: h_scaled = h_orig + 2*ln(s)
    // So omega_orig = omega_scaled - (1 - sum_beta) * ln(s^2)
    // BUT since DataScaler only activates for extreme std (<0.01 or >100),
    // for standard returns s=1.0, ln(s^2)=0, so omega_orig = omega_scaled directly
    let omega_opt = if (s - 1.0).abs() < 1e-10 {
        omega_scaled
    } else {
        omega_scaled - (1.0 - sum_beta) * (s * s).ln()
    };

    // Recompute final variance on raw data
    let residuals_opt: Vec<f64> = raw_data.iter().map(|&r| r - mu_opt).collect();
    let var_uncon_opt = (residuals_opt.iter().map(|r| r * r).sum::<f64>() / n as f64).max(1e-10);
    let h_uncon_opt = var_uncon_opt.ln();

    h_buf.clear();
    var_buf.clear();
    for _ in 0..max_lag {
        h_buf.push(h_uncon_opt);
        var_buf.push(var_uncon_opt);
    }
    for t in max_lag..n {
        let mut h_t = omega_opt;
        for (i, (&ai, &gi)) in alpha_opt.iter().zip(gamma_opt.iter()).enumerate() {
            let sigma_prev = var_buf[t - 1 - i].max(1e-12).sqrt();
            let z_prev = (residuals_opt[t - 1 - i] / sigma_prev).clamp(-10.0, 10.0);
            // EViews convention: no E|z| subtraction
            h_t += ai * z_prev.abs() + gi * z_prev;
        }
        for (j, &bj) in beta_opt.iter().enumerate() {
            h_t += bj * h_buf[t - 1 - j];
        }
        h_t = h_t.clamp(-30.0, 30.0);
        let var_t = h_t.exp().clamp(1e-12, 1e12);
        h_buf.push(h_t);
        var_buf.push(var_t);
    }

    let n_eff = n - max_lag;
    let log_lik_unadj: f64 = h_buf
        .iter()
        .zip(var_buf.iter())
        .zip(residuals_opt.iter())
        .skip(max_lag)
        .map(|((&h, &v), &e)| -0.5 * (h + e * e / v))
        .sum();
    let log_lik = log_lik_unadj + (n_eff as f64) * (-0.5 * LOG_2_PI);

    let mut se = compute_egarch_opg_se(&data, p, q, mu_scaled, omega_scaled, &alpha_opt, &gamma_opt, &beta_opt)
        .unwrap_or_else(|| vec![0.0; n_params]);

    se[0] /= s;

    (mu_opt, omega_opt, alpha_opt, gamma_opt, beta_opt, var_buf, log_lik, se)
}

// =====================================================================
// TGARCH(p,q) / GJR-GARCH — Free Gamma (allows negative leverage)
// =====================================================================
// Parameter layout:
//   x = [mu, ln(ω), ln(α₁..q), γ₁..q (free/unconstrained), theta_beta₁..p]
//   gamma is UNCONSTRAINED (not exp()) to allow EViews-compatible negative values
fn tgarch_neg_ll_and_grad(
    data: &[f64],
    x: &[f64],
    p: usize,
    q: usize,
    var_buf: &mut Vec<f64>,
    grad: &mut [f64],
) -> f64 {
    let n = data.len();
    for &val in x.iter() {
        if val.is_nan() || val.is_infinite() {
            for g in grad.iter_mut() {
                *g = 0.0;
            }
            return 1e15;
        }
    }
    let n_params = 2 + 2 * q + p;
    let max_lag = p.max(q).max(1);

    let mu = x[0];
    let omega = x[1].exp();
    let alpha: Vec<f64> = (1..=q).map(|i| x[1 + i].exp()).collect();
    // gamma is FREE (unconstrained) — matches EViews TARCH which allows negative gamma
    let gamma_v: Vec<f64> = (1..=q).map(|i| x[1 + q + i]).collect();
    let beta: Vec<f64> = (1 + 2 * q + 1..=1 + 2 * q + p)
        .map(|i| 0.999 * safe_sigmoid(x[i]))
        .collect();

    // Persistence for TGARCH: E[alpha + gamma/2 + beta] assuming 50% negative shocks
    let persistence = alpha.iter().sum::<f64>()
        + 0.5 * gamma_v.iter().map(|g| g.max(0.0)).sum::<f64>()
        + beta.iter().sum::<f64>();
    let mut penalty = 0.0;
    let limit = 0.999;
    if persistence >= limit {
        let diff = persistence - limit;
        penalty = 1e5 * diff * diff;
    }

    let residuals: Vec<f64> = data.iter().map(|&r| r - mu).collect();
    let var_uncon: f64 =
        (residuals.iter().map(|r| r * r).sum::<f64>() / n as f64).max(1e-8);

    var_buf.clear();
    for _ in 0..max_lag {
        var_buf.push(var_uncon);
    }

    for g in grad.iter_mut() {
        *g = 0.0;
    }

    let win = p.max(1);
    let mut dvar_win: Vec<Vec<f64>> = vec![vec![0.0f64; n_params]; win];
    let mut neg_ll = 0.0f64;

    for t in max_lag..n {
        let mut var_t = omega;
        for (i, (&ai, &gi)) in alpha.iter().zip(gamma_v.iter()).enumerate() {
            let eps_prev = residuals[t - 1 - i];
            let indicator = if eps_prev < 0.0 { 1.0 } else { 0.0 };
            var_t += (ai + gi * indicator) * eps_prev * eps_prev;
        }
        for (j, &bj) in beta.iter().enumerate() {
            var_t += bj * var_buf[t - 1 - j];
        }
        if var_t.is_nan() {
            for g in grad.iter_mut() {
                *g = 0.0;
            }
            return 1e15;
        }
        var_t = var_t.clamp(1e-10, 1e12);
        var_buf.push(var_t);

        let cur_slot = t % win;
        let mut dvar_cur = vec![0.0f64; n_params];

        // ∂σ²_t/∂mu
        let mut d_mu = 0.0;
        for (i, (&ai, &gi)) in alpha.iter().zip(gamma_v.iter()).enumerate() {
            let eps_prev = residuals[t - 1 - i];
            let indicator = if eps_prev < 0.0 { 1.0 } else { 0.0 };
            d_mu += -2.0 * (ai + gi * indicator) * eps_prev;
        }
        for (j, &bj) in beta.iter().enumerate() {
            d_mu += bj * dvar_win[(t - 1 - j) % win][0];
        }
        dvar_cur[0] = d_mu;

        // ∂σ²_t/∂ω
        let mut d_omega = 1.0;
        for (j, &bj) in beta.iter().enumerate() {
            d_omega += bj * dvar_win[(t - 1 - j) % win][1];
        }
        dvar_cur[1] = d_omega;

        // ∂σ²_t/∂α_i
        for i in 0..q {
            let k = 2 + i;
            let mut d_alpha = residuals[t - 1 - i].powi(2);
            for (j, &bj) in beta.iter().enumerate() {
                d_alpha += bj * dvar_win[(t - 1 - j) % win][k];
            }
            dvar_cur[k] = d_alpha;
        }

        // ∂σ²_t/∂γ_i
        for i in 0..q {
            let k = 2 + q + i;
            let eps_prev = residuals[t - 1 - i];
            let indicator = if eps_prev < 0.0 { 1.0 } else { 0.0 };
            let mut d_gamma = indicator * eps_prev * eps_prev;
            for (j, &bj) in beta.iter().enumerate() {
                d_gamma += bj * dvar_win[(t - 1 - j) % win][k];
            }
            dvar_cur[k] = d_gamma;
        }

        // ∂σ²_t/∂β_j
        for j in 0..p {
            let k = 2 + 2 * q + j;
            let mut d_beta = var_buf[t - 1 - j];
            for (j2, &bj2) in beta.iter().enumerate() {
                d_beta += bj2 * dvar_win[(t - 1 - j2) % win][k];
            }
            dvar_cur[k] = d_beta;
        }

        for val in dvar_cur.iter_mut() {
            *val = val.clamp(-1e8, 1e8);
        }

        let eps = residuals[t];
        let eps2 = eps.powi(2);
        let factor = 0.5 * (1.0 - eps2 / var_t) / var_t;

        let mut g_t = vec![0.0; n_params];
        g_t[0] = factor * dvar_cur[0] - eps / var_t;
        g_t[1] = factor * dvar_cur[1] * omega;
        for i in 0..q {
            g_t[2 + i] = factor * dvar_cur[2 + i] * alpha[i];
        }
        for i in 0..q {
            // gamma is free (no chain rule multiplier since gamma_v[i] = x[1+q+i] directly)
            g_t[2 + q + i] = factor * dvar_cur[2 + q + i];
        }
        for j in 0..p {
            let bj = beta[j];
            let d_beta_d_theta = bj * (1.0 - bj / 0.999);
            g_t[2 + 2 * q + j] = factor * dvar_cur[2 + 2 * q + j] * d_beta_d_theta;
        }

        for k in 0..n_params {
            grad[k] += g_t[k];
        }

        neg_ll += 0.5 * (var_t.ln() + eps2 / var_t);
        dvar_win[cur_slot] = dvar_cur;
    }

    if persistence >= limit {
        let diff = persistence - limit;
        let factor_penalty = 2.0 * 1e5 * diff;
        for i in 0..q {
            grad[2 + i] += factor_penalty * alpha[i];
        }
        for i in 0..q {
            // Only penalize positive gamma contribution (gamma * 0.5 if positive)
            if gamma_v[i] > 0.0 {
                grad[2 + q + i] += factor_penalty * 0.5;
            }
        }
        for j in 0..p {
            let bj = beta[j];
            let d_beta_d_theta = bj * (1.0 - bj / 0.999);
            grad[2 + 2 * q + j] += factor_penalty * d_beta_d_theta;
        }
    }

    neg_ll + penalty
}

fn compute_tgarch_opg_se(
    data: &[f64],
    p: usize,
    q: usize,
    mu: f64,
    omega: f64,
    alpha: &[f64],
    gamma_v: &[f64],
    beta: &[f64],
) -> Option<Vec<f64>> {
    let n = data.len();
    let n_params = 2 + 2 * q + p;
    let max_lag = p.max(q).max(1);

    let residuals: Vec<f64> = data.iter().map(|&r| r - mu).collect();
    let var_uncon: f64 = (residuals.iter().map(|r| r * r).sum::<f64>() / n as f64).max(1e-8);

    let mut var_buf = Vec::with_capacity(n);
    for _ in 0..max_lag {
        var_buf.push(var_uncon);
    }

    let win = p.max(1);
    let mut dvar_win: Vec<Vec<f64>> = vec![vec![0.0f64; n_params]; win];
    let mut opg_matrix = vec![vec![0.0f64; n_params]; n_params];

    for t in max_lag..n {
        let mut var_t = omega;
        for (i, (&ai, &gi)) in alpha.iter().zip(gamma_v.iter()).enumerate() {
            let eps_prev = residuals[t - 1 - i];
            let indicator = if eps_prev < 0.0 { 1.0 } else { 0.0 };
            // gamma is free — clamp contribution so variance stays positive
            var_t += ai * eps_prev * eps_prev + (gi * indicator * eps_prev * eps_prev).max(-ai * eps_prev * eps_prev * 0.999);
        }
        for (j, &bj) in beta.iter().enumerate() {
            var_t += bj * var_buf[t - 1 - j];
        }
        if var_t.is_nan() {
            return None;
        }
        var_t = var_t.clamp(1e-10, 1e12);
        var_buf.push(var_t);

        let cur_slot = t % win;
        let mut dvar_cur = vec![0.0f64; n_params];

        let mut d_mu = 0.0;
        for (i, (&ai, &gi)) in alpha.iter().zip(gamma_v.iter()).enumerate() {
            let eps_prev = residuals[t - 1 - i];
            let indicator = if eps_prev < 0.0 { 1.0 } else { 0.0 };
            d_mu += -2.0 * (ai + gi * indicator) * eps_prev;
        }
        for (j, &bj) in beta.iter().enumerate() {
            d_mu += bj * dvar_win[(t - 1 - j) % win][0];
        }
        dvar_cur[0] = d_mu;

        let mut d_omega = 1.0;
        for (j, &bj) in beta.iter().enumerate() {
            d_omega += bj * dvar_win[(t - 1 - j) % win][1];
        }
        dvar_cur[1] = d_omega;

        for i in 0..q {
            let k = 2 + i;
            let mut d_alpha = residuals[t - 1 - i].powi(2);
            for (j, &bj) in beta.iter().enumerate() {
                d_alpha += bj * dvar_win[(t - 1 - j) % win][k];
            }
            dvar_cur[k] = d_alpha;
        }

        for i in 0..q {
            let k = 2 + q + i;
            let eps_prev = residuals[t - 1 - i];
            let indicator = if eps_prev < 0.0 { 1.0 } else { 0.0 };
            let mut d_gamma = indicator * eps_prev * eps_prev;
            for (j, &bj) in beta.iter().enumerate() {
                d_gamma += bj * dvar_win[(t - 1 - j) % win][k];
            }
            dvar_cur[k] = d_gamma;
        }

        for j in 0..p {
            let k = 2 + 2 * q + j;
            let mut d_beta = var_buf[t - 1 - j];
            for (j2, &bj2) in beta.iter().enumerate() {
                d_beta += bj2 * dvar_win[(t - 1 - j2) % win][k];
            }
            dvar_cur[k] = d_beta;
        }

        let eps = residuals[t];
        let eps2 = eps.powi(2);
        let factor = 0.5 * (1.0 - eps2 / var_t) / var_t;

        let mut g_t = vec![0.0; n_params];
        g_t[0] = factor * dvar_cur[0] - eps / var_t;
        g_t[1] = factor * dvar_cur[1];
        for i in 0..q {
            g_t[2 + i] = factor * dvar_cur[2 + i];
        }
        for i in 0..q {
            g_t[2 + q + i] = factor * dvar_cur[2 + q + i];
        }
        for j in 0..p {
            g_t[2 + 2 * q + j] = factor * dvar_cur[2 + 2 * q + j];
        }

        for k in 0..n_params {
            for l in 0..n_params {
                opg_matrix[k][l] += g_t[k] * g_t[l];
            }
        }
        dvar_win[cur_slot] = dvar_cur;
    }

    let inv_flat = invert_matrix_safe(&opg_matrix)?;
    let mut se = vec![0.0; n_params];
    for k in 0..n_params {
        se[k] = inv_flat[k * n_params + k].max(0.0).sqrt();
    }

    Some(se)
}

pub(crate) fn estimate_tgarch_lbfgs(
    raw_data: &[f64],
    p: usize,
    q: usize,
) -> (f64, f64, Vec<f64>, Vec<f64>, Vec<f64>, Vec<f64>, f64, Vec<f64>) {
    let n = raw_data.len();
    let n_params = 2 + 2 * q + p;
    let max_lag = p.max(q).max(1);

    if n < 10 {
        let vu = raw_data.iter().map(|r| r * r).sum::<f64>() / n.max(1) as f64;
        return (0.0, vu * 0.1, vec![0.05; q], vec![0.08; q], vec![0.85; p], vec![vu; n], 0.0, vec![0.0; n_params]);
    }

    let scaler = DataScaler::new(raw_data);
    let data = scaler.scale(raw_data);
    let s = scaler.scale_factor;

    let sample_mean: f64 = data.iter().sum::<f64>() / n as f64;
    let residuals_init: Vec<f64> = data.iter().map(|&r| r - sample_mean).collect();
    let var_uncon: f64 = residuals_init.iter().map(|r| r * r).sum::<f64>() / n as f64;

    let mut x = vec![0.0f64; n_params];
    x[0] = sample_mean;
    x[1] = (var_uncon * 0.05).max(1e-6).ln();
    for i in 1..=q {
        x[1 + i] = 0.05_f64.ln();
    }
    for i in 1..=q {
        // gamma starts at small positive value (free parameter, unconstrained)
        x[1 + q + i] = 0.05;
    }
    for j in 1..=p {
        let b_val = (0.85_f64 / 0.999).clamp(0.001, 0.999);
        x[1 + 2 * q + j] = (b_val / (1.0 - b_val)).ln();
    }

    let mut var_buf = Vec::with_capacity(n);
    let _ = lbfgs()
        .with_max_iterations(500)
        .with_epsilon(1e-7)
        .minimize(
            &mut x,
            |x_cur, gx| {
                let neg_ll = tgarch_neg_ll_and_grad(&data, x_cur, p, q, &mut var_buf, gx);
                Ok(neg_ll)
            },
            |_| false,
        );

    let mu_scaled = x[0];
    let omega_scaled = x[1].exp();
    let alpha_opt: Vec<f64> = (1..=q).map(|i| x[1 + i].exp()).collect();
    // gamma is free (unconstrained) — matches EViews TARCH output
    let gamma_opt: Vec<f64> = (1..=q).map(|i| x[1 + q + i]).collect();
    let beta_opt: Vec<f64> = (1 + 2 * q + 1..=1 + 2 * q + p)
        .map(|i| 0.999 * safe_sigmoid(x[i]))
        .collect();

    let mu_opt = mu_scaled / s;
    let omega_opt = omega_scaled / (s * s);

    // Recompute final variance on raw data
    let residuals_opt: Vec<f64> = raw_data.iter().map(|&r| r - mu_opt).collect();
    let var_uncon_opt = (residuals_opt.iter().map(|r| r * r).sum::<f64>() / n as f64).max(1e-10);

    var_buf.clear();
    for _ in 0..max_lag {
        var_buf.push(var_uncon_opt);
    }
    for t in max_lag..n {
        let mut vt = omega_opt;
        for (i, (&ai, &gi)) in alpha_opt.iter().zip(gamma_opt.iter()).enumerate() {
            let eps_prev = residuals_opt[t - 1 - i];
            let indicator = if eps_prev < 0.0 { 1.0 } else { 0.0 };
            vt += ai * eps_prev * eps_prev + gi * indicator * eps_prev * eps_prev;
        }
        for (j, &bj) in beta_opt.iter().enumerate() {
            vt += bj * var_buf[t - 1 - j];
        }
        var_buf.push(vt.max(1e-12));
    }

    let n_eff = n - max_lag;
    let log_lik_unadj: f64 = var_buf
        .iter()
        .zip(residuals_opt.iter())
        .skip(max_lag)
        .filter(|(&v, _)| v > 0.0)
        .map(|(&v, &e)| -0.5 * (v.ln() + e.powi(2) / v))
        .sum();
    let log_lik = log_lik_unadj + (n_eff as f64) * (-0.5 * LOG_2_PI);

    let mut se = compute_tgarch_opg_se(&data, p, q, mu_scaled, omega_scaled, &alpha_opt, &gamma_opt, &beta_opt)
        .unwrap_or_else(|| vec![0.0; n_params]);

    se[0] /= s;
    se[1] /= s * s;

    (mu_opt, omega_opt, alpha_opt, gamma_opt, beta_opt, var_buf, log_lik, se)
}

// =====================================================================
// IGARCH(p,q) — Integrated GARCH Model with Full Variance Recursion
// =====================================================================

// Stick-breaking map: maps unconstrained theta (size k-1) to w (sums to 1, non-negative, size k).
fn stick_breaking_with_jacobian(theta: &[f64]) -> (Vec<f64>, Vec<Vec<f64>>) {
    let k = theta.len() + 1;
    let mut w = vec![0.0; k];
    let mut s = vec![0.0; k - 1];
    let mut remaining = 1.0;
    for i in 0..k - 1 {
        s[i] = safe_sigmoid(theta[i]);
        w[i] = remaining * s[i];
        remaining -= w[i];
    }
    w[k - 1] = remaining;

    let mut jacobian = vec![vec![0.0; k - 1]; k];
    for i in 0..k {
        for j in 0..k - 1 {
            if j < i {
                jacobian[i][j] = -w[i] * s[j];
            } else if j == i {
                jacobian[i][j] = w[i] * (1.0 - s[j]);
            } else {
                jacobian[i][j] = 0.0;
            }
        }
    }
    (w, jacobian)
}

fn igarch_neg_ll_and_grad(
    data: &[f64],
    x: &[f64],
    p: usize,
    q: usize,
    var_buf: &mut Vec<f64>,
    grad: &mut [f64],
) -> f64 {
    // EViews IGARCH: ω=0 (no variance constant)
    // Formula: σ²_t = Σαᵢ·ε²_{t-i} + Σβⱼ·σ²_{t-j}, Σα+Σβ=1
    // Parameter layout: x = [mu, theta_1...theta_{k_terms-1}]
    let n = data.len();
    let k_terms = q + p;
    // No omega: n_params = 1 (mu) + (k_terms-1) thetas
    let n_params = k_terms; // = 1 + (k_terms - 1)
    let max_lag = p.max(q).max(1);

    for &val in x.iter() {
        if val.is_nan() || val.is_infinite() {
            for g in grad.iter_mut() { *g = 0.0; }
            return 1e15;
        }
    }

    let mu = x[0];
    // theta vector: x[1..n_params] (size k_terms-1)
    let theta = &x[1..n_params];
    let (w, jacobian) = stick_breaking_with_jacobian(theta);
    let alpha = &w[0..q];
    let beta = &w[q..q + p];

    let residuals: Vec<f64> = data.iter().map(|&r| r - mu).collect();
    let var_uncon: f64 = (residuals.iter().map(|r| r * r).sum::<f64>() / n as f64).max(1e-8);

    var_buf.clear();
    for _ in 0..max_lag {
        var_buf.push(var_uncon);
    }

    for g in grad.iter_mut() { *g = 0.0; }

    let win = p.max(1);
    // Natural params: mu + alpha_1..q + beta_1..p (no omega)
    let n_natural = 1 + k_terms;
    let mut dvar_win: Vec<Vec<f64>> = vec![vec![0.0f64; n_natural]; win];
    let mut neg_ll = 0.0f64;
    let mut grad_natural = vec![0.0; n_natural];

    for t in max_lag..n {
        // NO omega term
        let mut var_t = 0.0_f64;
        for (i, &ai) in alpha.iter().enumerate() {
            var_t += ai * residuals[t - 1 - i].powi(2);
        }
        for (j, &bj) in beta.iter().enumerate() {
            var_t += bj * var_buf[t - 1 - j];
        }
        if var_t.is_nan() || var_t <= 0.0 {
            for g in grad.iter_mut() { *g = 0.0; }
            return 1e15;
        }
        var_t = var_t.clamp(1e-10, 1e12);
        var_buf.push(var_t);

        let cur_slot = t % win;
        let mut dvar_cur = vec![0.0f64; n_natural];

        // ∂σ²_t/∂μ
        let mut d_mu = 0.0;
        for (i, &ai) in alpha.iter().enumerate() {
            d_mu += -2.0 * ai * residuals[t - 1 - i];
        }
        for (j, &bj) in beta.iter().enumerate() {
            d_mu += bj * dvar_win[(t - 1 - j) % win][0];
        }
        dvar_cur[0] = d_mu;

        // ∂σ²_t/∂α_i (index 1..=q in natural)
        for i in 0..q {
            let k_idx = 1 + i;
            let mut d_alpha = residuals[t - 1 - i].powi(2);
            for (j, &bj) in beta.iter().enumerate() {
                d_alpha += bj * dvar_win[(t - 1 - j) % win][k_idx];
            }
            dvar_cur[k_idx] = d_alpha;
        }

        // ∂σ²_t/∂β_j (index 1+q..=1+q+p in natural)
        for j in 0..p {
            let k_idx = 1 + q + j;
            let mut d_beta = var_buf[t - 1 - j];
            for (j2, &bj2) in beta.iter().enumerate() {
                d_beta += bj2 * dvar_win[(t - 1 - j2) % win][k_idx];
            }
            dvar_cur[k_idx] = d_beta;
        }

        for val in dvar_cur.iter_mut() {
            *val = val.clamp(-1e8, 1e8);
        }

        let eps = residuals[t];
        let eps2 = eps.powi(2);
        let factor = 0.5 * (1.0 - eps2 / var_t) / var_t;

        let mut g_t = vec![0.0; n_natural];
        g_t[0] = factor * dvar_cur[0] - eps / var_t;
        for i in 0..q {
            g_t[1 + i] = factor * dvar_cur[1 + i];
        }
        for j in 0..p {
            g_t[1 + q + j] = factor * dvar_cur[1 + q + j];
        }

        for k_idx in 0..n_natural {
            grad_natural[k_idx] += g_t[k_idx];
        }

        neg_ll += 0.5 * (var_t.ln() + eps2 / var_t);
        dvar_win[cur_slot] = dvar_cur;
    }

    // Chain rule: theta -> (alpha, beta) via stick-breaking Jacobian
    grad[0] = grad_natural[0]; // mu gradient unchanged
    for j in 0..k_terms - 1 {
        let mut g_theta = 0.0;
        for i in 0..k_terms {
            g_theta += grad_natural[1 + i] * jacobian[i][j];
        }
        grad[1 + j] = g_theta;
    }

    neg_ll
}

fn compute_igarch_opg_se(
    data: &[f64],
    p: usize,
    q: usize,
    mu: f64,
    theta: &[f64],
) -> Option<Vec<f64>> {
    // EViews IGARCH: ω=0, natural params = [mu, alpha_1..q, beta_1..p]
    // phi params (optimized) = [mu, theta_1..k_terms-1]
    let n = data.len();
    let k_terms = q + p;
    let n_phi = k_terms;         // [mu, theta_1..k_terms-1]
    let n_psi = 1 + k_terms;    // [mu, alpha_1..q, beta_1..p]
    let max_lag = p.max(q).max(1);

    let (w, jacobian) = stick_breaking_with_jacobian(theta);
    let alpha = &w[0..q];
    let beta = &w[q..q + p];

    let residuals: Vec<f64> = data.iter().map(|&r| r - mu).collect();
    let var_uncon: f64 = (residuals.iter().map(|r| r * r).sum::<f64>() / n as f64).max(1e-8);

    let mut var_buf = Vec::with_capacity(n);
    for _ in 0..max_lag { var_buf.push(var_uncon); }

    let win = p.max(1);
    let mut dvar_win: Vec<Vec<f64>> = vec![vec![0.0f64; n_psi]; win];
    let mut opg_matrix = vec![vec![0.0f64; n_phi]; n_phi];

    for t in max_lag..n {
        // No omega
        let mut var_t = 0.0_f64;
        for (i, &ai) in alpha.iter().enumerate() {
            var_t += ai * residuals[t - 1 - i].powi(2);
        }
        for (j, &bj) in beta.iter().enumerate() {
            var_t += bj * var_buf[t - 1 - j];
        }
        if var_t.is_nan() || var_t <= 0.0 { return None; }
        var_t = var_t.clamp(1e-10, 1e12);
        var_buf.push(var_t);

        let cur_slot = t % win;
        let mut dvar_cur = vec![0.0f64; n_psi];

        // ∂σ²_t/∂μ
        let mut d_mu = 0.0;
        for (i, &ai) in alpha.iter().enumerate() {
            d_mu += -2.0 * ai * residuals[t - 1 - i];
        }
        for (j, &bj) in beta.iter().enumerate() {
            d_mu += bj * dvar_win[(t - 1 - j) % win][0];
        }
        dvar_cur[0] = d_mu;

        for i in 0..q {
            let k_idx = 1 + i;
            let mut d_alpha = residuals[t - 1 - i].powi(2);
            for (j, &bj) in beta.iter().enumerate() {
                d_alpha += bj * dvar_win[(t - 1 - j) % win][k_idx];
            }
            dvar_cur[k_idx] = d_alpha;
        }

        for j in 0..p {
            let k_idx = 1 + q + j;
            let mut d_beta = var_buf[t - 1 - j];
            for (j2, &bj2) in beta.iter().enumerate() {
                d_beta += bj2 * dvar_win[(t - 1 - j2) % win][k_idx];
            }
            dvar_cur[k_idx] = d_beta;
        }

        let eps = residuals[t];
        let eps2 = eps.powi(2);
        let factor = 0.5 * (1.0 - eps2 / var_t) / var_t;

        let mut g_t_phi = vec![0.0; n_phi];
        g_t_phi[0] = factor * dvar_cur[0] - eps / var_t;

        for j in 0..k_terms - 1 {
            let mut g_theta = 0.0;
            for i in 0..k_terms {
                g_theta += factor * dvar_cur[1 + i] * jacobian[i][j];
            }
            g_t_phi[1 + j] = g_theta;
        }

        for k_idx in 0..n_phi {
            for l_idx in 0..n_phi {
                opg_matrix[k_idx][l_idx] += g_t_phi[k_idx] * g_t_phi[l_idx];
            }
        }
        dvar_win[cur_slot] = dvar_cur;
    }

    let inv_flat = invert_matrix_safe(&opg_matrix)?;

    // Map from phi-space (optimized) to psi-space (natural: mu, alphas, betas)
    // J_psi[mu] = [1, 0, 0...], J_psi[alpha_i] = [0, jacobian[i][0..k-1]]
    let mut j_psi = vec![vec![0.0f64; n_phi]; n_psi];
    j_psi[0][0] = 1.0; // mu
    for i in 0..k_terms {
        for j in 0..k_terms - 1 {
            j_psi[1 + i][1 + j] = jacobian[i][j];
        }
    }

    let mut se = vec![0.0; n_psi];
    for k_idx in 0..n_psi {
        let mut var_k = 0.0;
        for r in 0..n_phi {
            for c in 0..n_phi {
                var_k += j_psi[k_idx][r] * inv_flat[r * n_phi + c] * j_psi[k_idx][c];
            }
        }
        se[k_idx] = var_k.max(0.0).sqrt();
    }

    Some(se)
}

pub(crate) fn estimate_igarch_lbfgs(
    raw_data: &[f64],
    p: usize,
    q: usize,
) -> (f64, f64, Vec<f64>, Vec<f64>, Vec<f64>, f64, Vec<f64>) {
    // EViews IGARCH: no omega (pure integrated), σ²_t = Σαᵢ·ε²_{t-i} + Σβⱼ·σ²_{t-j}
    // Parameter vector: x = [mu, theta_1..theta_{k_terms-1}]
    let n = raw_data.len();
    let k_terms = q + p;
    let n_params = k_terms; // 1 (mu) + (k_terms-1) thetas
    let n_psi = 1 + k_terms; // [mu, alpha_1..q, beta_1..p]
    let max_lag = p.max(q).max(1);

    if n < 10 {
        let vu = raw_data.iter().map(|r| r * r).sum::<f64>() / n.max(1) as f64;
        // Return omega=0.0 (interface compat), alpha small, beta large
        return (0.0, 0.0, vec![0.1; q], vec![0.9; p], vec![vu; n], 0.0, vec![0.0; n_psi]);
    }

    // No DataScaler needed since there's no omega to unscale
    let sample_mean: f64 = raw_data.iter().sum::<f64>() / n as f64;
    let residuals_init: Vec<f64> = raw_data.iter().map(|&r| r - sample_mean).collect();
    let _var_uncon: f64 = residuals_init.iter().map(|r| r * r).sum::<f64>() / n as f64;

    // Multi-start: try different alpha starting points
    // sigmoid(-1.386)≈0.20, sigmoid(-0.847)≈0.30, sigmoid(-0.405)≈0.40, sigmoid(0.0)=0.50
    let igarch_inits: &[f64] = &[-2.197, -1.386, -0.847, -0.405, 0.0, 0.847];
    // logit: 0.10, 0.20, 0.30, 0.40, 0.50, 0.70
    let mut best_ll_ig = -1e18_f64;
    let mut best_x_ig = vec![0.0f64; n_params];

    for &theta_init in igarch_inits {
        let mut x_cand = vec![0.0f64; n_params];
        x_cand[0] = sample_mean;
        for i in 0..k_terms - 1 {
            x_cand[1 + i] = theta_init;
        }

        let mut var_buf_cand = Vec::with_capacity(n);
        let _ = lbfgs()
            .with_max_iterations(500)
            .with_epsilon(1e-8)
            .minimize(
                &mut x_cand,
                |x_cur, gx| {
                    let neg_ll = igarch_neg_ll_and_grad(raw_data, x_cur, p, q, &mut var_buf_cand, gx);
                    Ok(neg_ll)
                },
                |_| false,
            );

        // Quick log-likelihood evaluation for this candidate
        let mu_c = x_cand[0];
        let theta_c = &x_cand[1..n_params];
        let (w_c, _) = stick_breaking_with_jacobian(theta_c);
        let alpha_c = &w_c[0..q];
        let beta_c = &w_c[q..q+p];
        let resid_c: Vec<f64> = raw_data.iter().map(|&r| r - mu_c).collect();
        let vu_c = (resid_c.iter().map(|r| r*r).sum::<f64>() / n as f64).max(1e-8);
        let mut vbuf_c = vec![vu_c; max_lag];
        for t in max_lag..n {
            let mut vt = 0.0_f64;
            for (i, &ai) in alpha_c.iter().enumerate() { vt += ai * resid_c[t-1-i].powi(2); }
            for (j, &bj) in beta_c.iter().enumerate() { vt += bj * vbuf_c[t-1-j]; }
            vbuf_c.push(vt.clamp(1e-10, 1e12));
        }
        let ll_c: f64 = vbuf_c.iter().zip(resid_c.iter()).skip(max_lag)
            .filter(|(&v, _)| v > 0.0)
            .map(|(&v, &e)| -0.5 * (v.ln() + e*e/v))
            .sum::<f64>() + (n - max_lag) as f64 * (-0.5 * LOG_2_PI);

        if ll_c > best_ll_ig && !ll_c.is_nan() {
            best_ll_ig = ll_c;
            best_x_ig = x_cand;
        }
    }

    let x = best_x_ig;
    let mu_opt = x[0];
    let theta_opt = &x[1..n_params];
    let (w_opt, _) = stick_breaking_with_jacobian(theta_opt);
    let alpha_opt = w_opt[0..q].to_vec();
    let beta_opt = w_opt[q..q + p].to_vec();

    // Recompute final variance on raw data (no omega)
    let residuals_opt: Vec<f64> = raw_data.iter().map(|&r| r - mu_opt).collect();
    let var_uncon_opt = (residuals_opt.iter().map(|r| r * r).sum::<f64>() / n as f64).max(1e-10);

    let mut var_buf = Vec::with_capacity(n);
    for _ in 0..max_lag { var_buf.push(var_uncon_opt); }
    for t in max_lag..n {
        let mut vt = 0.0_f64;
        for (i, &ai) in alpha_opt.iter().enumerate() {
            vt += ai * residuals_opt[t - 1 - i].powi(2);
        }
        for (j, &bj) in beta_opt.iter().enumerate() {
            vt += bj * var_buf[t - 1 - j];
        }
        var_buf.push(vt.clamp(1e-12, 1e12));
    }

    let n_eff = n - max_lag;
    let log_lik_unadj: f64 = var_buf
        .iter()
        .zip(residuals_opt.iter())
        .skip(max_lag)
        .filter(|(&v, _)| v > 0.0)
        .map(|(&v, &e)| -0.5 * (v.ln() + e.powi(2) / v))
        .sum();
    let log_lik = log_lik_unadj + (n_eff as f64) * (-0.5 * LOG_2_PI);

    let se = compute_igarch_opg_se(raw_data, p, q, mu_opt, theta_opt)
        .unwrap_or_else(|| vec![0.0; n_psi]);

    // Return omega=0.0 (interface compat: caller expects (mu, omega, alpha, beta, var_buf, log_lik, se))
    (mu_opt, 0.0, alpha_opt, beta_opt, var_buf, log_lik, se)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn generate_test_data(n: usize, mu: f64, omega: f64, alpha: f64, beta: f64) -> Vec<f64> {
        let mut data = Vec::with_capacity(n);
        let mut sigma2 = omega / (1.0 - alpha - beta).max(0.01);
        let mut eps = 0.0;
        let mut state: u64 = 987654321;
        let mut next_u = || {
            state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((state >> 11) as f64) / (9007199254740992.0)
        };

        for _ in 0..n {
            let u1 = next_u().max(1e-10);
            let u2 = next_u();
            let z = (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos();
            sigma2 = (omega + alpha * eps * eps + beta * sigma2).clamp(1e-6, 1e4);
            eps = z * sigma2.sqrt();
            data.push(mu + eps);
        }
        data
    }

    #[test]
    fn test_garch_small_n35() {
        let data = generate_test_data(35, 0.05, 0.1, 0.15, 0.7);
        let (mu, omega, alpha, beta, _, log_lik, _se) = estimate_garch_lbfgs(&data, 1, 1);
        assert!(!mu.is_nan());
        assert!(!omega.is_nan() && omega > 0.0);
        assert!(!alpha[0].is_nan());
        assert!(!beta[0].is_nan());
        assert!(!log_lik.is_nan());
    }

    #[test]
    fn test_igarch_n250_unlocked() {
        let data = generate_test_data(250, 0.05, 0.05, 0.20, 0.80);
        let (mu, omega, alpha, beta, _, _log_lik, _se) = estimate_igarch_lbfgs(&data, 1, 1);
        assert!(!mu.is_nan());
        assert!(!omega.is_nan());
        // Verify IGARCH parameters move away from 0.5000 / 0.5000
        assert!(
            (alpha[0] - 0.5).abs() > 0.01 || (beta[0] - 0.5).abs() > 0.01,
            "IGARCH alpha/beta stuck at initial 0.5: alpha={}, beta={}",
            alpha[0],
            beta[0]
        );
    }

    #[test]
    fn test_egarch_large_n15000_no_nan() {
        let data = generate_test_data(15000, 0.01, 0.05, 0.15, 0.85);
        let (mu, omega, alpha, gamma, beta, _, log_lik, _se) = estimate_egarch_lbfgs(&data, 1, 1);
        assert!(!mu.is_nan(), "EGARCH mu is NaN");
        assert!(!omega.is_nan(), "EGARCH omega is NaN");
        assert!(!alpha[0].is_nan(), "EGARCH alpha is NaN");
        assert!(!gamma[0].is_nan(), "EGARCH gamma is NaN");
        assert!(!beta[0].is_nan(), "EGARCH beta is NaN");
        assert!(!log_lik.is_nan(), "EGARCH log_lik is NaN");
    }

    #[test]
    fn test_tgarch_large_n15000_no_nan() {
        let data = generate_test_data(15000, 0.01, 0.05, 0.10, 0.80);
        let (mu, omega, alpha, gamma, beta, _, log_lik, _se) = estimate_tgarch_lbfgs(&data, 1, 1);
        assert!(!mu.is_nan(), "TGARCH mu is NaN");
        assert!(!omega.is_nan(), "TGARCH omega is NaN");
        assert!(!alpha[0].is_nan(), "TGARCH alpha is NaN");
        assert!(!gamma[0].is_nan(), "TGARCH gamma is NaN");
        assert!(!beta[0].is_nan(), "TGARCH beta is NaN");
        assert!(!log_lik.is_nan(), "TGARCH log_lik is NaN");
    }
}
