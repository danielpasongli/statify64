use wasm_bindgen::prelude::*;
use crate::GARCH;
use crate::time_series::garch::optimizer::estimate_igarch_lbfgs;

#[wasm_bindgen]
impl GARCH {
    /// IGARCH(p,q) — Integrated GARCH (Pure EViews formulation: ω=0, Σ α_i + Σ β_j = 1)
    pub fn estimate_igarch(&mut self) {
        let (mu_opt, omega_opt, alpha_opt, beta_opt, variance, log_lik, se) =
            estimate_igarch_lbfgs(&self.data, self.p, self.q);

        let max_lag = self.p.max(self.q).max(1);
        let n_eff = self.data.len() - max_lag;

        // Number of independent parameters: mu + (q + p - 1) theta parameters
        let k_indep = self.p + self.q;
        let aic = -2.0 * log_lik + 2.0 * k_indep as f64;
        let bic = -2.0 * log_lik + (k_indep as f64) * (n_eff as f64).ln();

        self.set_mu(mu_opt);
        self.set_omega(omega_opt);
        self.set_alpha(alpha_opt);
        self.set_beta(beta_opt);
        self.set_variance(variance);
        self.set_log_likelihood(log_lik);
        self.set_aic(aic);
        self.set_bic(bic);

        // Calculate z-stats and p-values for parameters in se: [mu, alpha_1..q, beta_1..p]
        let mut coefs = vec![mu_opt];
        coefs.extend(self.get_alpha());
        coefs.extend(self.get_beta());

        let (z_stats, p_values) = crate::time_series::garch::optimizer::compute_z_and_p(&coefs, &se);

        // Set mu
        self.set_mu_se(se[0]);
        self.set_mu_z(z_stats[0]);
        self.set_mu_p(p_values[0]);

        // Set omega (fixed at 0 in EViews IGARCH)
        self.set_omega_se(0.0);
        self.set_omega_z(0.0);
        self.set_omega_p(1.0);

        // Set alpha
        let mut alpha_se = Vec::new();
        let mut alpha_z = Vec::new();
        let mut alpha_p = Vec::new();
        for i in 0..self.q {
            let idx = 1 + i;
            if idx < se.len() {
                alpha_se.push(se[idx]);
                alpha_z.push(z_stats[idx]);
                alpha_p.push(p_values[idx]);
            } else {
                alpha_se.push(0.0);
                alpha_z.push(0.0);
                alpha_p.push(1.0);
            }
        }
        self.set_alpha_se(alpha_se);
        self.set_alpha_z(alpha_z);
        self.set_alpha_p(alpha_p);

        // Set beta
        let mut beta_se = Vec::new();
        let mut beta_z = Vec::new();
        let mut beta_p = Vec::new();
        for j in 0..self.p {
            let idx = 1 + self.q + j;
            if idx < se.len() {
                beta_se.push(se[idx]);
                beta_z.push(z_stats[idx]);
                beta_p.push(p_values[idx]);
            } else {
                beta_se.push(0.0);
                beta_z.push(0.0);
                beta_p.push(1.0);
            }
        }
        self.set_beta_se(beta_se);
        self.set_beta_z(beta_z);
        self.set_beta_p(beta_p);
    }
}
