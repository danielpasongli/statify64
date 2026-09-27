/* tslint:disable */
/* eslint-disable */

export class ARDL {
  free(): void;
  [Symbol.dispose](): void;
  estimate_ardl_ecm(): void;
  /**
   * Pesaran ARDL Bounds Test for Cointegration
   * F-statistic untuk test: H0: No long-run relationship
   */
  calculate_bounds_test(unrestricted_ssr: number, restricted_ssr: number, n_obs: number): BoundsTestResult;
  /**
   * Calculate standard errors for long-run coefficients (Delta method)
   * SE(θ_j) ≈ SE(short_run) / (1 - Σα_i)  (simplified)
   */
  calculate_long_run_se(short_run_se: Float64Array): Float64Array;
  /**
   * Calculate long-run coefficients from ARDL short-run estimates
   * Long-run: θ_j = (Σβ_{j,k}) / (1 - Σα_i)
   */
  calculate_long_run_coefficients(short_run_coef: Float64Array): Float64Array;
  get_n_vars(): number;
  get_bg_stat(): number;
  get_bp_stat(): number;
  get_jb_stat(): number;
  get_bg_p_value(): number;
  get_bp_p_value(): number;
  get_jb_p_value(): number;
  get_adf_p_value(): number;
  get_lr_p_values(): Float64Array;
  get_sr_p_values(): Float64Array;
  get_lr_r_squared(): number;
  get_lr_residuals(): Float64Array;
  get_sr_r_squared(): number;
  get_sr_residuals(): Float64Array;
  get_adf_statistic(): number;
  get_lr_std_errors(): Float64Array;
  get_sr_std_errors(): Float64Array;
  get_lr_f_statistic(): number;
  get_sr_f_statistic(): number;
  get_is_cointegrated(): boolean;
  get_lr_coefficients(): Float64Array;
  get_lr_t_statistics(): Float64Array;
  get_sr_coefficients(): Float64Array;
  get_sr_t_statistics(): Float64Array;
  get_lr_adj_r_squared(): number;
  get_sr_adj_r_squared(): number;
  constructor(y: Float64Array, x_flat: Float64Array, n_vars: number, p: number, q_flat: Uint32Array);
  get_x(var_index: number, obs_index: number): number;
  get_n_obs(): number;
}

export class ArchLMResult {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  lm_statistic: number;
  p_value: number;
  has_arch_effect: boolean;
  f_statistic: number;
  f_p_value: number;
}

export class Arima {
  free(): void;
  [Symbol.dispose](): void;
  get_ar_coef(): Float64Array;
  get_i_order(): number;
  get_ma_coef(): Float64Array;
  get_res_var(): number;
  set_ar_coef(ar_coef: Float64Array): void;
  set_ma_coef(ma_coef: Float64Array): void;
  set_res_var(res_var: number): void;
  get_ar_order(): number;
  get_constant(): number;
  get_ma_order(): number;
  set_constant(constant: number): void;
  constructor(data: Float64Array, ar_order: number, i_order: number, ma_order: number);
  get_data(): Float64Array;
  set_data(data: Float64Array): void;
  forecast(): Float64Array;
  estimate_se(): Float64Array;
  intercept_se(): number;
  coeficient_se(): Float64Array;
  t_stat(): Float64Array;
  p_value(): Float64Array;
  res_variance(): number;
  res_sum_of_square(): number;
  est_res(intercept: number, ar: Float64Array, ma: Float64Array, data: Float64Array): Float64Array;
  estimate_coef(): Float64Array;
  calculate_dw(): number;
  calculate_r2(): number;
  calculate_aic(): number;
  calculate_hqc(): number;
  calculate_mse(): number;
  calculate_sbc(): number;
  calculate_sse(): number;
  calculate_sst(): number;
  calculate_f_prob(): number;
  calculate_f_stat(): number;
  calculate_r2_adj(): number;
  calculate_sd_dep(): number;
  calculate_se_reg(): number;
  calculate_mean_dep(): number;
  selection_criteria(): Float64Array;
  calculate_log_likelihood(): number;
  forecasting_evaluation(): any;
}

export class AugmentedDickeyFuller {
  free(): void;
  [Symbol.dispose](): void;
  calculate_pvalue(): number;
  calculate_test_stat(): number;
  calculate_critical_value(): Float64Array;
  get_se_vec(): Float64Array;
  set_se_vec(se_vec: Float64Array): void;
  get_equation(): string;
  get_sel_crit(): Float64Array;
  set_equation(equation: string): void;
  set_sel_crit(sel_crit: Float64Array): void;
  get_test_stat(): number;
  set_test_stat(test_stat: number): void;
  get_p_value_vec(): Float64Array;
  set_p_value_vec(p_value_vec: Float64Array): void;
  get_test_stat_vec(): Float64Array;
  set_test_stat_vec(test_stat_vec: Float64Array): void;
  constructor(data: Float64Array, equation: string, level: string, lag: number);
  get_b(): number;
  set_b(b: number): void;
  get_se(): number;
  set_se(se: number): void;
  get_lag(): number;
  get_data(): Float64Array;
  set_data(data: Float64Array): void;
  get_b_vec(): Float64Array;
  get_level(): string;
  set_b_vec(b_vec: Float64Array): void;
  set_level(level: string): void;
}

export class Autocorrelation {
  free(): void;
  [Symbol.dispose](): void;
  get_acf_se(): Float64Array;
  set_acf_se(acf_se: Float64Array): void;
  get_pacf_se(): Float64Array;
  set_pacf_se(pacf_se: Float64Array): void;
  get_pvalue_lb(): Float64Array;
  set_pvalue_lb(pvalue_lb: Float64Array): void;
  constructor(data: Float64Array, lag: number);
  get_lb(): Float64Array;
  set_lb(lb: Float64Array): void;
  get_acf(): Float64Array;
  get_lag(): number;
  set_acf(acf: Float64Array): void;
  set_lag(lag: number): void;
  get_data(): Float64Array;
  get_pacf(): Float64Array;
  set_data(data: Float64Array): void;
  set_pacf(pacf: Float64Array): void;
  get_df_lb(): Uint32Array;
  set_df_lb(df_lb: Uint32Array): void;
  calculate_acf(difference: Float64Array): Float64Array;
  calculate_acf_se(autocorelate: Float64Array): Float64Array;
  calculate_pacf(autocorrelate: Float64Array): Float64Array;
  calculate_pacf_se(partial_autocorelate: Float64Array): Float64Array;
  calculate_bartlet_left(se: Float64Array, alpha: number): Float64Array;
  calculate_bartlet_right(se: Float64Array, alpha: number): Float64Array;
  df_ljung_box(ljung_box: Float64Array): Uint32Array;
  pvalue_ljung_box(ljung_box: Float64Array): Float64Array;
  calculate_ljung_box(autocorrelate: Float64Array): Float64Array;
  autocorelate(difference: string, use_seasonal: boolean, seasonally: number): void;
}

export class BoundsTestResult {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  f_statistic: number;
  has_cointegration: boolean;
}

export class CointegrationResult {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  adf_statistic: number;
  is_cointegrated: boolean;
}

export class Decomposition {
  free(): void;
  [Symbol.dispose](): void;
  linear_trend(deseasonalizing: Float64Array): Float64Array;
  exponential_trend(deseasonalizing: Float64Array): Float64Array;
  calculate_multiplicative_trend_component(trend: string, deseasonalizing: Float64Array): Float64Array;
  multiplicative_decomposition(trend: string): Float64Array;
  calculate_additive_trend_component(centered_ma: Float64Array): Float64Array;
  calculate_additive_seasonal_component(detrended: Float64Array): Float64Array;
  additive_decomposition(): Float64Array;
  get_period(): number;
  get_trend_equation(): string;
  set_trend_equation(trend_equation: string): void;
  get_trend_component(): Float64Array;
  set_trend_component(trend_component: Float64Array): void;
  get_seasonal_indices(): Float64Array;
  set_seasonal_indices(seasonal_indices: Float64Array): void;
  get_seasonal_component(): Float64Array;
  set_seasonal_component(seasonal_component: Float64Array): void;
  get_irregular_component(): Float64Array;
  set_irregular_component(irregular_component: Float64Array): void;
  constructor(data: Float64Array, period: number);
  get_data(): Float64Array;
  calculate_multiplicative_seasonal_component(centered_ma: Float64Array): Float64Array;
  calculate_centered_moving_average(): Float64Array;
  decomposition_evaluation(forecast: Float64Array): any;
}

export class DickeyFuller {
  free(): void;
  [Symbol.dispose](): void;
  get_se_vec(): Float64Array;
  set_se_vec(se_vec: Float64Array): void;
  get_equation(): string;
  get_sel_crit(): Float64Array;
  set_equation(equation: string): void;
  set_sel_crit(sel_crit: Float64Array): void;
  get_test_stat(): number;
  set_test_stat(test_stat: number): void;
  get_p_value_vec(): Float64Array;
  set_p_value_vec(p_value_vec: Float64Array): void;
  get_test_stat_vec(): Float64Array;
  set_test_stat_vec(test_stat_vec: Float64Array): void;
  constructor(data: Float64Array, equation: string, level: string);
  get_b(): number;
  set_b(b: number): void;
  get_se(): number;
  set_se(se: number): void;
  get_data(): Float64Array;
  set_data(data: Float64Array): void;
  get_b_vec(): Float64Array;
  get_level(): string;
  set_b_vec(b_vec: Float64Array): void;
  set_level(level: string): void;
  calculate_pvalue(): number;
  calculate_test_stat(): number;
  calculate_critical_value(): Float64Array;
}

export class ECM {
  free(): void;
  [Symbol.dispose](): void;
  get_bg_stat(): number;
  get_bp_stat(): number;
  get_jb_stat(): number;
  /**
   * Run the full ECM chain:
   * 1. Long-run OLS: Y = c + β₁X₁ + ...
   * 2. Cointegration test (ADF on residuals)
   * 3. Short-run ECM: ΔY = α + γ·ECT(-1) + φ·ΔX + ε
   * 4. Classical Assumptions on ECM residuals
   */
  estimate_ecm(): void;
  get_r_squared(): number;
  get_bg_p_value(): number;
  get_bp_p_value(): number;
  get_jb_p_value(): number;
  get_adf_p_value(): number;
  get_lr_p_values(): Float64Array;
  get_ecm_p_values(): Float64Array;
  get_lr_r_squared(): number;
  get_lr_residuals(): Float64Array;
  get_adf_statistic(): number;
  get_ecm_r_squared(): number;
  get_ecm_residuals(): Float64Array;
  get_lr_std_errors(): Float64Array;
  get_ecm_std_errors(): Float64Array;
  /**
   * For backward compat with old bivariate structs
   */
  get_long_run_beta0(): number;
  get_long_run_beta1(): number;
  get_lr_f_statistic(): number;
  get_ecm_f_statistic(): number;
  get_is_cointegrated(): boolean;
  get_lr_coefficients(): Float64Array;
  get_lr_t_statistics(): Float64Array;
  get_ecm_coefficients(): Float64Array;
  get_ecm_t_statistics(): Float64Array;
  get_lr_adj_r_squared(): number;
  get_ecm_adj_r_squared(): number;
  constructor(y: Float64Array, x_flat: Float64Array, n_x: number, max_lag_adf: number, max_lag_ecm: number);
}

export class GARCH {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Calculate log-likelihood: LL = -0.5 Σ(ln(σ²_t) + ε²_t/σ²_t)
   */
  calculate_log_likelihood(variance: Float64Array): number;
  /**
   * IGARCH(p,q) — Integrated GARCH
   *
   * Model: σ²_t = ω + Σ α_i·ε²_{t-i} + Σ β_j·σ²_{t-j}
   * dengan restriksi: Σ α_i + Σ β_j = 1
   *
   * Estimasi: L-BFGS menggunakan stick-breaking parameterization.
   */
  estimate_igarch(): void;
  /**
   * Calculate conditional variance: σ²_t = ω + Σα_i·ε²_{t-i} + Σβ_j·σ²_{t-j}
   */
  calculate_variance(omega: number, alpha: Float64Array, beta: Float64Array): Float64Array;
  get_beta_p(): Float64Array;
  get_beta_z(): Float64Array;
  set_beta_p(p: Float64Array): void;
  set_beta_z(z: Float64Array): void;
  get_alpha_p(): Float64Array;
  get_alpha_z(): Float64Array;
  get_beta_se(): Float64Array;
  get_gamma_p(): Float64Array;
  get_gamma_z(): Float64Array;
  get_omega_p(): number;
  get_omega_z(): number;
  set_alpha_p(p: Float64Array): void;
  set_alpha_z(z: Float64Array): void;
  set_beta_se(se: Float64Array): void;
  set_gamma_p(p: Float64Array): void;
  set_gamma_z(z: Float64Array): void;
  set_omega_p(p: number): void;
  set_omega_z(z: number): void;
  get_alpha_se(): Float64Array;
  get_gamma_se(): Float64Array;
  get_omega_se(): number;
  get_variance(): Float64Array;
  set_alpha_se(se: Float64Array): void;
  set_gamma_se(se: Float64Array): void;
  set_omega_se(se: number): void;
  set_variance(variance: Float64Array): void;
  get_residuals(): Float64Array;
  get_log_likelihood(): number;
  set_log_likelihood(ll: number): void;
  constructor(data: Float64Array, p: number, q: number);
  get_p(): number;
  get_q(): number;
  get_mu(): number;
  set_mu(mu: number): void;
  get_aic(): number;
  get_bic(): number;
  set_aic(aic: number): void;
  set_bic(bic: number): void;
  get_beta(): Float64Array;
  get_data(): Float64Array;
  get_mu_p(): number;
  get_mu_z(): number;
  set_beta(beta: Float64Array): void;
  set_mu_p(p: number): void;
  set_mu_z(z: number): void;
  get_alpha(): Float64Array;
  get_gamma(): Float64Array;
  get_mu_se(): number;
  get_omega(): number;
  set_alpha(alpha: Float64Array): void;
  set_gamma(gamma: Float64Array): void;
  set_mu_se(se: number): void;
  set_omega(omega: number): void;
  /**
   * Calculate AIC: -2·LL + 2·k
   */
  calculate_aic(log_likelihood: number): number;
  /**
   * Calculate BIC: -2·LL + k·ln(n)
   */
  calculate_bic(log_likelihood: number, n: number): number;
  /**
   * Estimasi GARCH(p,q) via L-BFGS dengan analytical gradient.
   */
  estimate(): void;
  /**
   * EGARCH(p,q) — Exponential GARCH
   *
   * Model: log(σ²_t) = ω + Σ[α_i·|z_{t-i}| + γ_i·z_{t-i}] + Σ β_j·log(σ²_{t-j})
   * dimana z_t = ε_t/σ_t (standardized residual)
   *
   * Keunggulan EGARCH:
   *   - σ² selalu positif tanpa constraint eksplisit (karena exp())
   *   - γ_i menangkap leverage effect (bad news impact lebih besar)
   *
   * Estimasi: L-BFGS dengan analytical gradient pada log-variance recursion.
   */
  estimate_egarch(): void;
  /**
   * Hitung conditional variance untuk EGARCH secara manual (untuk inspeksi).
   * Memerlukan parameter lengkap dari luar (biasanya setelah estimate_egarch).
   */
  calculate_egarch_variance(omega: number, alpha: Float64Array, gamma: Float64Array, beta: Float64Array): Float64Array;
  /**
   * TGARCH(p,q) / GJR-GARCH — Threshold GARCH
   *
   * Model: σ²_t = ω + Σ(α_i + γ_i·I_{t-i})·ε²_{t-i} + Σ β_j·σ²_{t-j}
   * dimana I_{t-i} = 1 jika ε_{t-i} < 0 (leverage effect indicator)
   *
   * Interpretasi γ_i:
   *   - γ_i > 0: bad news (ε < 0) meningkatkan volatilitas lebih besar
   *   - γ_i = 0: simetrik (sama dengan GARCH standar)
   *
   * Estimasi: L-BFGS dengan analytical gradient.
   */
  estimate_tgarch(): void;
  /**
   * Hitung conditional variance untuk TGARCH secara manual (untuk inspeksi).
   */
  calculate_tgarch_variance(omega: number, alpha: Float64Array, gamma: Float64Array, beta: Float64Array): Float64Array;
  /**
   * ARCH-LM Test (Engle 1982)
   * H0: No ARCH effects (α_1 = α_2 = ... = α_q = 0)
   * Auxiliary regression: e²_t = β_0 + β_1·e²_{t-1} + ... + β_q·e²_{t-q}
   * Test statistics:
   *   Obs*R² (LM stat) ~ Chi²(q)   [matches EViews "Obs*R-squared"]
   *   F-stat ~ F(q, n-q-1)          [matches EViews "F-statistic"]
   */
  static arch_lm_test(residuals: Float64Array, lags: number): ArchLMResult;
}

export class MultipleLinearRegression {
  free(): void;
  [Symbol.dispose](): void;
  calculate_dw(): number;
  calculate_r2(): number;
  calculate_aic(): number;
  calculate_hqc(): number;
  calculate_mse(): number;
  calculate_sbc(): number;
  calculate_sse(): number;
  calculate_sst(): number;
  calculate_f_prob(): number;
  calculate_f_stat(): number;
  calculate_r2_adj(): number;
  calculate_sd_dep(): number;
  calculate_se_reg(): number;
  calculate_mean_dep(): number;
  calculate_log_likelihood(): number;
  calculate_regression(): void;
  calculate_pvalue(): Float64Array;
  calculate_t_stat(): Float64Array;
  calculate_standard_error(): Float64Array;
  get_constant(): boolean;
  set_constant(constant: boolean): void;
  get_y_prediction(): Float64Array;
  set_y_prediction(y_prediction: Float64Array): void;
  constructor(x: any, y: Float64Array);
  get_y(): Float64Array;
  get_beta(): Float64Array;
  set_beta(beta: Float64Array): void;
  readonly get_x: any;
}

export class NoInterceptLinearRegression {
  free(): void;
  [Symbol.dispose](): void;
  calculate_dw(): number;
  calculate_r2(): number;
  calculate_aic(): number;
  calculate_hqc(): number;
  calculate_mse(): number;
  calculate_sbc(): number;
  calculate_sse(): number;
  calculate_sst(): number;
  calculate_f_prob(): number;
  calculate_f_stat(): number;
  calculate_r2_adj(): number;
  calculate_sd_dep(): number;
  calculate_se_reg(): number;
  calculate_mean_dep(): number;
  calculate_log_likelihood(): number;
  calculate_pvalue(): number;
  calculate_t_stat(): number;
  calculate_regression(): void;
  calculate_standard_error(): number;
  get_y_prediction(): Float64Array;
  set_y_prediction(y_prediction: Float64Array): void;
  constructor(x: Float64Array, y: Float64Array);
  get_b(): number;
  get_y(): Float64Array;
  set_b(b: number): void;
  readonly get_x: Float64Array;
}

export class OLSResult {
  private constructor();
  free(): void;
  [Symbol.dispose](): void;
  get_fitted(): Float64Array;
  get_p_values(): Float64Array;
  get_residuals(): Float64Array;
  get_std_errors(): Float64Array;
  get_coefficients(): Float64Array;
  get_t_statistics(): Float64Array;
  get_beta0(): number;
  get_beta1(): number;
  n_obs: number;
  n_params: number;
  r_squared: number;
  adj_r_squared: number;
  f_statistic: number;
  sse: number;
}

export class SimpleExponentialRegression {
  free(): void;
  [Symbol.dispose](): void;
  calculate_regression(): void;
  get_y_prediction(): Float64Array;
  set_y_prediction(y_prediction: Float64Array): void;
  constructor(x: Float64Array, y: Float64Array);
  get_x(): Float64Array;
  get_y(): Float64Array;
  get_b0(): number;
  get_b1(): number;
  set_b0(b0: number): void;
  set_b1(b1: number): void;
}

export class SimpleLinearRegression {
  free(): void;
  [Symbol.dispose](): void;
  calculate_dw(): number;
  calculate_r2(): number;
  calculate_aic(): number;
  calculate_hqc(): number;
  calculate_mse(): number;
  calculate_sbc(): number;
  calculate_sse(): number;
  calculate_sst(): number;
  calculate_f_prob(): number;
  calculate_f_stat(): number;
  calculate_r2_adj(): number;
  calculate_sd_dep(): number;
  calculate_se_reg(): number;
  calculate_mean_dep(): number;
  calculate_log_likelihood(): number;
  calculate_pvalue(): Float64Array;
  calculate_t_stat(): Float64Array;
  calculate_regression(): void;
  calculate_standard_error(): Float64Array;
  get_y_prediction(): Float64Array;
  set_y_prediction(y_prediction: Float64Array): void;
  constructor(x: Float64Array, y: Float64Array);
  get_x(): Float64Array;
  get_y(): Float64Array;
  get_b0(): number;
  get_b1(): number;
  set_b0(b0: number): void;
  set_b1(b1: number): void;
}

export class Smoothing {
  free(): void;
  [Symbol.dispose](): void;
  smoothing_evaluation(forecast: Float64Array): any;
  constructor(data: Float64Array);
  get_data(): Float64Array;
  set_data(data: Float64Array): void;
  calculate_des(alpha: number): Float64Array;
  calculate_ses(alpha: number): Float64Array;
  calculate_holt(alpha: number, beta: number): Float64Array;
  calculate_winter(alpha: number, beta: number, gamma: number, period: number): Float64Array;
  calculate_dma(distance: number): Float64Array;
  calculate_sma(distance: number): Float64Array;
}

export function get_gamma_0_tab1(): Float64Array;

export function get_t(): string[];

export function innov_alg(q: number, data: Float64Array): Float64Array;

export function partial_kj(k: number, j: number, partial_autocorrelate: Float64Array): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_arima_free: (a: number, b: number) => void;
  readonly arima_get_ar_coef: (a: number) => [number, number];
  readonly arima_get_ar_order: (a: number) => number;
  readonly arima_get_constant: (a: number) => number;
  readonly arima_get_data: (a: number) => [number, number];
  readonly arima_get_i_order: (a: number) => number;
  readonly arima_get_ma_coef: (a: number) => [number, number];
  readonly arima_get_ma_order: (a: number) => number;
  readonly arima_get_res_var: (a: number) => number;
  readonly arima_new: (a: number, b: number, c: number, d: number, e: number) => number;
  readonly arima_set_ar_coef: (a: number, b: number, c: number) => void;
  readonly arima_set_constant: (a: number, b: number) => void;
  readonly arima_set_data: (a: number, b: number, c: number) => void;
  readonly arima_set_ma_coef: (a: number, b: number, c: number) => void;
  readonly arima_set_res_var: (a: number, b: number) => void;
  readonly get_gamma_0_tab1: () => [number, number];
  readonly __wbg_autocorrelation_free: (a: number, b: number) => void;
  readonly __wbg_smoothing_free: (a: number, b: number) => void;
  readonly autocorrelation_calculate_acf: (a: number, b: number, c: number) => [number, number];
  readonly autocorrelation_calculate_acf_se: (a: number, b: number, c: number) => [number, number];
  readonly autocorrelation_calculate_bartlet_left: (a: number, b: number, c: number, d: number) => [number, number];
  readonly autocorrelation_calculate_bartlet_right: (a: number, b: number, c: number, d: number) => [number, number];
  readonly autocorrelation_calculate_ljung_box: (a: number, b: number, c: number) => [number, number];
  readonly autocorrelation_calculate_pacf: (a: number, b: number, c: number) => [number, number];
  readonly autocorrelation_calculate_pacf_se: (a: number, b: number, c: number) => [number, number];
  readonly autocorrelation_df_ljung_box: (a: number, b: number, c: number) => [number, number];
  readonly autocorrelation_get_acf: (a: number) => [number, number];
  readonly autocorrelation_get_acf_se: (a: number) => [number, number];
  readonly autocorrelation_get_data: (a: number) => [number, number];
  readonly autocorrelation_get_df_lb: (a: number) => [number, number];
  readonly autocorrelation_get_lag: (a: number) => number;
  readonly autocorrelation_get_lb: (a: number) => [number, number];
  readonly autocorrelation_get_pacf: (a: number) => [number, number];
  readonly autocorrelation_get_pacf_se: (a: number) => [number, number];
  readonly autocorrelation_get_pvalue_lb: (a: number) => [number, number];
  readonly autocorrelation_new: (a: number, b: number, c: number) => number;
  readonly autocorrelation_pvalue_ljung_box: (a: number, b: number, c: number) => [number, number];
  readonly autocorrelation_set_acf: (a: number, b: number, c: number) => void;
  readonly autocorrelation_set_acf_se: (a: number, b: number, c: number) => void;
  readonly autocorrelation_set_data: (a: number, b: number, c: number) => void;
  readonly autocorrelation_set_df_lb: (a: number, b: number, c: number) => void;
  readonly autocorrelation_set_lag: (a: number, b: number) => void;
  readonly autocorrelation_set_lb: (a: number, b: number, c: number) => void;
  readonly autocorrelation_set_pacf: (a: number, b: number, c: number) => void;
  readonly autocorrelation_set_pacf_se: (a: number, b: number, c: number) => void;
  readonly autocorrelation_set_pvalue_lb: (a: number, b: number, c: number) => void;
  readonly partial_kj: (a: number, b: number, c: number, d: number) => number;
  readonly smoothing_get_data: (a: number) => [number, number];
  readonly smoothing_new: (a: number, b: number) => number;
  readonly smoothing_set_data: (a: number, b: number, c: number) => void;
  readonly smoothing_smoothing_evaluation: (a: number, b: number, c: number) => any;
  readonly __wbg_ecm_free: (a: number, b: number) => void;
  readonly __wbg_get_olsresult_adj_r_squared: (a: number) => number;
  readonly __wbg_get_olsresult_f_statistic: (a: number) => number;
  readonly __wbg_get_olsresult_n_obs: (a: number) => number;
  readonly __wbg_get_olsresult_n_params: (a: number) => number;
  readonly __wbg_get_olsresult_r_squared: (a: number) => number;
  readonly __wbg_get_olsresult_sse: (a: number) => number;
  readonly __wbg_olsresult_free: (a: number, b: number) => void;
  readonly __wbg_set_olsresult_adj_r_squared: (a: number, b: number) => void;
  readonly __wbg_set_olsresult_f_statistic: (a: number, b: number) => void;
  readonly __wbg_set_olsresult_n_obs: (a: number, b: number) => void;
  readonly __wbg_set_olsresult_n_params: (a: number, b: number) => void;
  readonly __wbg_set_olsresult_r_squared: (a: number, b: number) => void;
  readonly __wbg_set_olsresult_sse: (a: number, b: number) => void;
  readonly ecm_estimate_ecm: (a: number) => void;
  readonly ecm_get_adf_p_value: (a: number) => number;
  readonly ecm_get_adf_statistic: (a: number) => number;
  readonly ecm_get_bg_p_value: (a: number) => number;
  readonly ecm_get_bg_stat: (a: number) => number;
  readonly ecm_get_bp_p_value: (a: number) => number;
  readonly ecm_get_bp_stat: (a: number) => number;
  readonly ecm_get_ecm_adj_r_squared: (a: number) => number;
  readonly ecm_get_ecm_coefficients: (a: number) => [number, number];
  readonly ecm_get_ecm_f_statistic: (a: number) => number;
  readonly ecm_get_ecm_p_values: (a: number) => [number, number];
  readonly ecm_get_ecm_r_squared: (a: number) => number;
  readonly ecm_get_ecm_residuals: (a: number) => [number, number];
  readonly ecm_get_ecm_std_errors: (a: number) => [number, number];
  readonly ecm_get_ecm_t_statistics: (a: number) => [number, number];
  readonly ecm_get_is_cointegrated: (a: number) => number;
  readonly ecm_get_jb_p_value: (a: number) => number;
  readonly ecm_get_jb_stat: (a: number) => number;
  readonly ecm_get_long_run_beta0: (a: number) => number;
  readonly ecm_get_long_run_beta1: (a: number) => number;
  readonly ecm_get_lr_adj_r_squared: (a: number) => number;
  readonly ecm_get_lr_coefficients: (a: number) => [number, number];
  readonly ecm_get_lr_f_statistic: (a: number) => number;
  readonly ecm_get_lr_p_values: (a: number) => [number, number];
  readonly ecm_get_lr_r_squared: (a: number) => number;
  readonly ecm_get_lr_residuals: (a: number) => [number, number];
  readonly ecm_get_lr_std_errors: (a: number) => [number, number];
  readonly ecm_get_lr_t_statistics: (a: number) => [number, number];
  readonly ecm_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
  readonly olsresult_get_beta0: (a: number) => number;
  readonly olsresult_get_beta1: (a: number) => number;
  readonly olsresult_get_coefficients: (a: number) => [number, number];
  readonly olsresult_get_fitted: (a: number) => [number, number];
  readonly olsresult_get_p_values: (a: number) => [number, number];
  readonly olsresult_get_residuals: (a: number) => [number, number];
  readonly olsresult_get_std_errors: (a: number) => [number, number];
  readonly olsresult_get_t_statistics: (a: number) => [number, number];
  readonly ecm_get_r_squared: (a: number) => number;
  readonly __wbg_augmenteddickeyfuller_free: (a: number, b: number) => void;
  readonly __wbg_dickeyfuller_free: (a: number, b: number) => void;
  readonly __wbg_simpleexponentialregression_free: (a: number, b: number) => void;
  readonly augmenteddickeyfuller_calculate_critical_value: (a: number) => [number, number];
  readonly augmenteddickeyfuller_calculate_pvalue: (a: number) => number;
  readonly augmenteddickeyfuller_calculate_test_stat: (a: number) => number;
  readonly augmenteddickeyfuller_get_b: (a: number) => number;
  readonly augmenteddickeyfuller_get_b_vec: (a: number) => [number, number];
  readonly augmenteddickeyfuller_get_data: (a: number) => [number, number];
  readonly augmenteddickeyfuller_get_equation: (a: number) => [number, number];
  readonly augmenteddickeyfuller_get_lag: (a: number) => number;
  readonly augmenteddickeyfuller_get_level: (a: number) => [number, number];
  readonly augmenteddickeyfuller_get_p_value_vec: (a: number) => [number, number];
  readonly augmenteddickeyfuller_get_se: (a: number) => number;
  readonly augmenteddickeyfuller_get_se_vec: (a: number) => [number, number];
  readonly augmenteddickeyfuller_get_sel_crit: (a: number) => [number, number];
  readonly augmenteddickeyfuller_get_test_stat: (a: number) => number;
  readonly augmenteddickeyfuller_get_test_stat_vec: (a: number) => [number, number];
  readonly augmenteddickeyfuller_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
  readonly augmenteddickeyfuller_set_b: (a: number, b: number) => void;
  readonly augmenteddickeyfuller_set_b_vec: (a: number, b: number, c: number) => void;
  readonly augmenteddickeyfuller_set_data: (a: number, b: number, c: number) => void;
  readonly augmenteddickeyfuller_set_equation: (a: number, b: number, c: number) => void;
  readonly augmenteddickeyfuller_set_level: (a: number, b: number, c: number) => void;
  readonly augmenteddickeyfuller_set_p_value_vec: (a: number, b: number, c: number) => void;
  readonly augmenteddickeyfuller_set_se: (a: number, b: number) => void;
  readonly augmenteddickeyfuller_set_se_vec: (a: number, b: number, c: number) => void;
  readonly augmenteddickeyfuller_set_sel_crit: (a: number, b: number, c: number) => void;
  readonly augmenteddickeyfuller_set_test_stat: (a: number, b: number) => void;
  readonly augmenteddickeyfuller_set_test_stat_vec: (a: number, b: number, c: number) => void;
  readonly decomposition_additive_decomposition: (a: number) => [number, number];
  readonly decomposition_calculate_additive_seasonal_component: (a: number, b: number, c: number) => [number, number];
  readonly decomposition_calculate_additive_trend_component: (a: number, b: number, c: number) => [number, number];
  readonly decomposition_calculate_multiplicative_trend_component: (a: number, b: number, c: number, d: number, e: number) => [number, number];
  readonly decomposition_exponential_trend: (a: number, b: number, c: number) => [number, number];
  readonly decomposition_linear_trend: (a: number, b: number, c: number) => [number, number];
  readonly decomposition_multiplicative_decomposition: (a: number, b: number, c: number) => [number, number];
  readonly dickeyfuller_calculate_critical_value: (a: number) => [number, number];
  readonly dickeyfuller_calculate_pvalue: (a: number) => number;
  readonly dickeyfuller_calculate_test_stat: (a: number) => number;
  readonly dickeyfuller_get_b_vec: (a: number) => [number, number];
  readonly dickeyfuller_get_data: (a: number) => [number, number];
  readonly dickeyfuller_get_equation: (a: number) => [number, number];
  readonly dickeyfuller_get_level: (a: number) => [number, number];
  readonly dickeyfuller_get_p_value_vec: (a: number) => [number, number];
  readonly dickeyfuller_get_se_vec: (a: number) => [number, number];
  readonly dickeyfuller_get_sel_crit: (a: number) => [number, number];
  readonly dickeyfuller_get_test_stat_vec: (a: number) => [number, number];
  readonly dickeyfuller_new: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
  readonly dickeyfuller_set_b_vec: (a: number, b: number, c: number) => void;
  readonly dickeyfuller_set_data: (a: number, b: number, c: number) => void;
  readonly dickeyfuller_set_equation: (a: number, b: number, c: number) => void;
  readonly dickeyfuller_set_level: (a: number, b: number, c: number) => void;
  readonly dickeyfuller_set_p_value_vec: (a: number, b: number, c: number) => void;
  readonly dickeyfuller_set_se_vec: (a: number, b: number, c: number) => void;
  readonly dickeyfuller_set_sel_crit: (a: number, b: number, c: number) => void;
  readonly dickeyfuller_set_test_stat_vec: (a: number, b: number, c: number) => void;
  readonly garch_calculate_log_likelihood: (a: number, b: number, c: number) => number;
  readonly garch_estimate_igarch: (a: number) => void;
  readonly simpleexponentialregression_calculate_regression: (a: number) => void;
  readonly simpleexponentialregression_get_x: (a: number) => [number, number];
  readonly simpleexponentialregression_get_y: (a: number) => [number, number];
  readonly simpleexponentialregression_get_y_prediction: (a: number) => [number, number];
  readonly simpleexponentialregression_new: (a: number, b: number, c: number, d: number) => number;
  readonly simpleexponentialregression_set_y_prediction: (a: number, b: number, c: number) => void;
  readonly dickeyfuller_set_b: (a: number, b: number) => void;
  readonly dickeyfuller_set_se: (a: number, b: number) => void;
  readonly dickeyfuller_set_test_stat: (a: number, b: number) => void;
  readonly simpleexponentialregression_set_b0: (a: number, b: number) => void;
  readonly simpleexponentialregression_set_b1: (a: number, b: number) => void;
  readonly dickeyfuller_get_b: (a: number) => number;
  readonly dickeyfuller_get_se: (a: number) => number;
  readonly dickeyfuller_get_test_stat: (a: number) => number;
  readonly simpleexponentialregression_get_b0: (a: number) => number;
  readonly simpleexponentialregression_get_b1: (a: number) => number;
  readonly arima_calculate_aic: (a: number) => number;
  readonly arima_calculate_dw: (a: number) => number;
  readonly arima_calculate_f_prob: (a: number) => number;
  readonly arima_calculate_f_stat: (a: number) => number;
  readonly arima_calculate_hqc: (a: number) => number;
  readonly arima_calculate_log_likelihood: (a: number) => number;
  readonly arima_calculate_mean_dep: (a: number) => number;
  readonly arima_calculate_mse: (a: number) => number;
  readonly arima_calculate_r2: (a: number) => number;
  readonly arima_calculate_r2_adj: (a: number) => number;
  readonly arima_calculate_sbc: (a: number) => number;
  readonly arima_calculate_sd_dep: (a: number) => number;
  readonly arima_calculate_se_reg: (a: number) => number;
  readonly arima_calculate_sse: (a: number) => number;
  readonly arima_calculate_sst: (a: number) => number;
  readonly arima_coeficient_se: (a: number) => [number, number];
  readonly arima_est_res: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
  readonly arima_estimate_coef: (a: number) => [number, number];
  readonly arima_estimate_se: (a: number) => [number, number];
  readonly arima_forecast: (a: number) => [number, number];
  readonly arima_forecasting_evaluation: (a: number) => any;
  readonly arima_intercept_se: (a: number) => number;
  readonly arima_p_value: (a: number) => [number, number];
  readonly arima_res_sum_of_square: (a: number) => number;
  readonly arima_res_variance: (a: number) => number;
  readonly arima_selection_criteria: (a: number) => [number, number];
  readonly arima_t_stat: (a: number) => [number, number];
  readonly garch_calculate_variance: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
  readonly __wbg_garch_free: (a: number, b: number) => void;
  readonly garch_get_aic: (a: number) => number;
  readonly garch_get_alpha: (a: number) => [number, number];
  readonly garch_get_alpha_p: (a: number) => [number, number];
  readonly garch_get_alpha_se: (a: number) => [number, number];
  readonly garch_get_alpha_z: (a: number) => [number, number];
  readonly garch_get_beta: (a: number) => [number, number];
  readonly garch_get_beta_p: (a: number) => [number, number];
  readonly garch_get_beta_se: (a: number) => [number, number];
  readonly garch_get_beta_z: (a: number) => [number, number];
  readonly garch_get_bic: (a: number) => number;
  readonly garch_get_data: (a: number) => [number, number];
  readonly garch_get_gamma: (a: number) => [number, number];
  readonly garch_get_gamma_p: (a: number) => [number, number];
  readonly garch_get_gamma_se: (a: number) => [number, number];
  readonly garch_get_gamma_z: (a: number) => [number, number];
  readonly garch_get_log_likelihood: (a: number) => number;
  readonly garch_get_mu: (a: number) => number;
  readonly garch_get_mu_p: (a: number) => number;
  readonly garch_get_mu_se: (a: number) => number;
  readonly garch_get_mu_z: (a: number) => number;
  readonly garch_get_omega: (a: number) => number;
  readonly garch_get_omega_p: (a: number) => number;
  readonly garch_get_omega_se: (a: number) => number;
  readonly garch_get_omega_z: (a: number) => number;
  readonly garch_get_p: (a: number) => number;
  readonly garch_get_q: (a: number) => number;
  readonly garch_get_residuals: (a: number) => [number, number];
  readonly garch_get_variance: (a: number) => [number, number];
  readonly garch_new: (a: number, b: number, c: number, d: number) => number;
  readonly garch_set_aic: (a: number, b: number) => void;
  readonly garch_set_alpha: (a: number, b: number, c: number) => void;
  readonly garch_set_alpha_p: (a: number, b: number, c: number) => void;
  readonly garch_set_alpha_se: (a: number, b: number, c: number) => void;
  readonly garch_set_alpha_z: (a: number, b: number, c: number) => void;
  readonly garch_set_beta: (a: number, b: number, c: number) => void;
  readonly garch_set_beta_p: (a: number, b: number, c: number) => void;
  readonly garch_set_beta_se: (a: number, b: number, c: number) => void;
  readonly garch_set_beta_z: (a: number, b: number, c: number) => void;
  readonly garch_set_bic: (a: number, b: number) => void;
  readonly garch_set_gamma: (a: number, b: number, c: number) => void;
  readonly garch_set_gamma_p: (a: number, b: number, c: number) => void;
  readonly garch_set_gamma_se: (a: number, b: number, c: number) => void;
  readonly garch_set_gamma_z: (a: number, b: number, c: number) => void;
  readonly garch_set_log_likelihood: (a: number, b: number) => void;
  readonly garch_set_mu: (a: number, b: number) => void;
  readonly garch_set_mu_p: (a: number, b: number) => void;
  readonly garch_set_mu_se: (a: number, b: number) => void;
  readonly garch_set_mu_z: (a: number, b: number) => void;
  readonly garch_set_omega: (a: number, b: number) => void;
  readonly garch_set_omega_p: (a: number, b: number) => void;
  readonly garch_set_omega_se: (a: number, b: number) => void;
  readonly garch_set_omega_z: (a: number, b: number) => void;
  readonly garch_set_variance: (a: number, b: number, c: number) => void;
  readonly simplelinearregression_calculate_aic: (a: number) => number;
  readonly simplelinearregression_calculate_dw: (a: number) => number;
  readonly simplelinearregression_calculate_f_prob: (a: number) => number;
  readonly simplelinearregression_calculate_f_stat: (a: number) => number;
  readonly simplelinearregression_calculate_hqc: (a: number) => number;
  readonly simplelinearregression_calculate_log_likelihood: (a: number) => number;
  readonly simplelinearregression_calculate_mean_dep: (a: number) => number;
  readonly simplelinearregression_calculate_mse: (a: number) => number;
  readonly simplelinearregression_calculate_r2: (a: number) => number;
  readonly simplelinearregression_calculate_r2_adj: (a: number) => number;
  readonly simplelinearregression_calculate_sbc: (a: number) => number;
  readonly simplelinearregression_calculate_sd_dep: (a: number) => number;
  readonly simplelinearregression_calculate_se_reg: (a: number) => number;
  readonly simplelinearregression_calculate_sse: (a: number) => number;
  readonly simplelinearregression_calculate_sst: (a: number) => number;
  readonly smoothing_calculate_des: (a: number, b: number) => [number, number];
  readonly smoothing_calculate_holt: (a: number, b: number, c: number) => [number, number];
  readonly smoothing_calculate_ses: (a: number, b: number) => [number, number];
  readonly smoothing_calculate_winter: (a: number, b: number, c: number, d: number, e: number) => [number, number];
  readonly __wbg_ardl_free: (a: number, b: number) => void;
  readonly ardl_calculate_bounds_test: (a: number, b: number, c: number, d: number) => number;
  readonly ardl_calculate_long_run_coefficients: (a: number, b: number, c: number) => [number, number];
  readonly ardl_calculate_long_run_se: (a: number, b: number, c: number) => [number, number];
  readonly ardl_estimate_ardl_ecm: (a: number) => [number, number];
  readonly ardl_get_adf_p_value: (a: number) => number;
  readonly ardl_get_adf_statistic: (a: number) => number;
  readonly ardl_get_bg_p_value: (a: number) => number;
  readonly ardl_get_bg_stat: (a: number) => number;
  readonly ardl_get_bp_p_value: (a: number) => number;
  readonly ardl_get_bp_stat: (a: number) => number;
  readonly ardl_get_is_cointegrated: (a: number) => number;
  readonly ardl_get_jb_p_value: (a: number) => number;
  readonly ardl_get_jb_stat: (a: number) => number;
  readonly ardl_get_lr_adj_r_squared: (a: number) => number;
  readonly ardl_get_lr_coefficients: (a: number) => [number, number];
  readonly ardl_get_lr_f_statistic: (a: number) => number;
  readonly ardl_get_lr_p_values: (a: number) => [number, number];
  readonly ardl_get_lr_r_squared: (a: number) => number;
  readonly ardl_get_lr_residuals: (a: number) => [number, number];
  readonly ardl_get_lr_std_errors: (a: number) => [number, number];
  readonly ardl_get_lr_t_statistics: (a: number) => [number, number];
  readonly ardl_get_n_obs: (a: number) => number;
  readonly ardl_get_n_vars: (a: number) => number;
  readonly ardl_get_sr_adj_r_squared: (a: number) => number;
  readonly ardl_get_sr_coefficients: (a: number) => [number, number];
  readonly ardl_get_sr_f_statistic: (a: number) => number;
  readonly ardl_get_sr_p_values: (a: number) => [number, number];
  readonly ardl_get_sr_r_squared: (a: number) => number;
  readonly ardl_get_sr_residuals: (a: number) => [number, number];
  readonly ardl_get_sr_std_errors: (a: number) => [number, number];
  readonly ardl_get_sr_t_statistics: (a: number) => [number, number];
  readonly ardl_get_x: (a: number, b: number, c: number) => number;
  readonly ardl_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
  readonly garch_calculate_aic: (a: number, b: number) => number;
  readonly garch_calculate_bic: (a: number, b: number, c: number) => number;
  readonly garch_calculate_egarch_variance: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
  readonly garch_calculate_tgarch_variance: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
  readonly garch_estimate: (a: number) => void;
  readonly garch_estimate_egarch: (a: number) => void;
  readonly garch_estimate_tgarch: (a: number) => void;
  readonly get_t: () => [number, number];
  readonly innov_alg: (a: number, b: number, c: number) => [number, number];
  readonly multiplelinearregression_calculate_aic: (a: number) => number;
  readonly multiplelinearregression_calculate_dw: (a: number) => number;
  readonly multiplelinearregression_calculate_f_prob: (a: number) => number;
  readonly multiplelinearregression_calculate_f_stat: (a: number) => number;
  readonly multiplelinearregression_calculate_hqc: (a: number) => number;
  readonly multiplelinearregression_calculate_log_likelihood: (a: number) => number;
  readonly multiplelinearregression_calculate_mean_dep: (a: number) => number;
  readonly multiplelinearregression_calculate_mse: (a: number) => number;
  readonly multiplelinearregression_calculate_r2: (a: number) => number;
  readonly multiplelinearregression_calculate_r2_adj: (a: number) => number;
  readonly multiplelinearregression_calculate_regression: (a: number) => void;
  readonly multiplelinearregression_calculate_sbc: (a: number) => number;
  readonly multiplelinearregression_calculate_sd_dep: (a: number) => number;
  readonly multiplelinearregression_calculate_se_reg: (a: number) => number;
  readonly multiplelinearregression_calculate_sse: (a: number) => number;
  readonly multiplelinearregression_calculate_sst: (a: number) => number;
  readonly __wbg_decomposition_free: (a: number, b: number) => void;
  readonly __wbg_nointerceptlinearregression_free: (a: number, b: number) => void;
  readonly autocorrelation_autocorelate: (a: number, b: number, c: number, d: number, e: number) => void;
  readonly decomposition_calculate_centered_moving_average: (a: number) => [number, number];
  readonly decomposition_calculate_multiplicative_seasonal_component: (a: number, b: number, c: number) => [number, number];
  readonly decomposition_decomposition_evaluation: (a: number, b: number, c: number) => any;
  readonly decomposition_get_data: (a: number) => [number, number];
  readonly decomposition_get_irregular_component: (a: number) => [number, number];
  readonly decomposition_get_period: (a: number) => number;
  readonly decomposition_get_seasonal_component: (a: number) => [number, number];
  readonly decomposition_get_seasonal_indices: (a: number) => [number, number];
  readonly decomposition_get_trend_component: (a: number) => [number, number];
  readonly decomposition_get_trend_equation: (a: number) => [number, number];
  readonly decomposition_new: (a: number, b: number, c: number) => number;
  readonly decomposition_set_irregular_component: (a: number, b: number, c: number) => void;
  readonly decomposition_set_seasonal_component: (a: number, b: number, c: number) => void;
  readonly decomposition_set_seasonal_indices: (a: number, b: number, c: number) => void;
  readonly decomposition_set_trend_component: (a: number, b: number, c: number) => void;
  readonly decomposition_set_trend_equation: (a: number, b: number, c: number) => void;
  readonly garch_arch_lm_test: (a: number, b: number, c: number) => number;
  readonly nointerceptlinearregression_calculate_aic: (a: number) => number;
  readonly nointerceptlinearregression_calculate_dw: (a: number) => number;
  readonly nointerceptlinearregression_calculate_f_prob: (a: number) => number;
  readonly nointerceptlinearregression_calculate_f_stat: (a: number) => number;
  readonly nointerceptlinearregression_calculate_hqc: (a: number) => number;
  readonly nointerceptlinearregression_calculate_log_likelihood: (a: number) => number;
  readonly nointerceptlinearregression_calculate_mean_dep: (a: number) => number;
  readonly nointerceptlinearregression_calculate_mse: (a: number) => number;
  readonly nointerceptlinearregression_calculate_pvalue: (a: number) => number;
  readonly nointerceptlinearregression_calculate_r2: (a: number) => number;
  readonly nointerceptlinearregression_calculate_r2_adj: (a: number) => number;
  readonly nointerceptlinearregression_calculate_regression: (a: number) => void;
  readonly nointerceptlinearregression_calculate_sbc: (a: number) => number;
  readonly nointerceptlinearregression_calculate_sd_dep: (a: number) => number;
  readonly nointerceptlinearregression_calculate_se_reg: (a: number) => number;
  readonly nointerceptlinearregression_calculate_sse: (a: number) => number;
  readonly nointerceptlinearregression_calculate_sst: (a: number) => number;
  readonly nointerceptlinearregression_calculate_standard_error: (a: number) => number;
  readonly nointerceptlinearregression_calculate_t_stat: (a: number) => number;
  readonly nointerceptlinearregression_get_b: (a: number) => number;
  readonly nointerceptlinearregression_get_x: (a: number) => [number, number];
  readonly nointerceptlinearregression_get_y: (a: number) => [number, number];
  readonly nointerceptlinearregression_get_y_prediction: (a: number) => [number, number];
  readonly nointerceptlinearregression_new: (a: number, b: number, c: number, d: number) => number;
  readonly nointerceptlinearregression_set_b: (a: number, b: number) => void;
  readonly nointerceptlinearregression_set_y_prediction: (a: number, b: number, c: number) => void;
  readonly smoothing_calculate_dma: (a: number, b: number) => [number, number];
  readonly smoothing_calculate_sma: (a: number, b: number) => [number, number];
  readonly __wbg_archlmresult_free: (a: number, b: number) => void;
  readonly __wbg_boundstestresult_free: (a: number, b: number) => void;
  readonly __wbg_cointegrationresult_free: (a: number, b: number) => void;
  readonly __wbg_get_archlmresult_f_p_value: (a: number) => number;
  readonly __wbg_get_archlmresult_f_statistic: (a: number) => number;
  readonly __wbg_get_archlmresult_has_arch_effect: (a: number) => number;
  readonly __wbg_get_archlmresult_lm_statistic: (a: number) => number;
  readonly __wbg_get_archlmresult_p_value: (a: number) => number;
  readonly __wbg_get_boundstestresult_has_cointegration: (a: number) => number;
  readonly __wbg_multiplelinearregression_free: (a: number, b: number) => void;
  readonly __wbg_set_archlmresult_f_p_value: (a: number, b: number) => void;
  readonly __wbg_set_archlmresult_f_statistic: (a: number, b: number) => void;
  readonly __wbg_set_archlmresult_has_arch_effect: (a: number, b: number) => void;
  readonly __wbg_set_archlmresult_lm_statistic: (a: number, b: number) => void;
  readonly __wbg_set_archlmresult_p_value: (a: number, b: number) => void;
  readonly __wbg_set_boundstestresult_has_cointegration: (a: number, b: number) => void;
  readonly __wbg_simplelinearregression_free: (a: number, b: number) => void;
  readonly multiplelinearregression_calculate_pvalue: (a: number) => [number, number];
  readonly multiplelinearregression_calculate_standard_error: (a: number) => [number, number];
  readonly multiplelinearregression_calculate_t_stat: (a: number) => [number, number];
  readonly multiplelinearregression_get_beta: (a: number) => [number, number];
  readonly multiplelinearregression_get_constant: (a: number) => number;
  readonly multiplelinearregression_get_x: (a: number) => any;
  readonly multiplelinearregression_get_y: (a: number) => [number, number];
  readonly multiplelinearregression_get_y_prediction: (a: number) => [number, number];
  readonly multiplelinearregression_new: (a: any, b: number, c: number) => number;
  readonly multiplelinearregression_set_beta: (a: number, b: number, c: number) => void;
  readonly multiplelinearregression_set_constant: (a: number, b: number) => void;
  readonly multiplelinearregression_set_y_prediction: (a: number, b: number, c: number) => void;
  readonly simplelinearregression_calculate_pvalue: (a: number) => [number, number];
  readonly simplelinearregression_calculate_regression: (a: number) => void;
  readonly simplelinearregression_calculate_standard_error: (a: number) => [number, number];
  readonly simplelinearregression_calculate_t_stat: (a: number) => [number, number];
  readonly simplelinearregression_get_b0: (a: number) => number;
  readonly simplelinearregression_get_b1: (a: number) => number;
  readonly simplelinearregression_get_x: (a: number) => [number, number];
  readonly simplelinearregression_get_y: (a: number) => [number, number];
  readonly simplelinearregression_get_y_prediction: (a: number) => [number, number];
  readonly simplelinearregression_new: (a: number, b: number, c: number, d: number) => number;
  readonly simplelinearregression_set_b0: (a: number, b: number) => void;
  readonly simplelinearregression_set_b1: (a: number, b: number) => void;
  readonly simplelinearregression_set_y_prediction: (a: number, b: number, c: number) => void;
  readonly __wbg_set_boundstestresult_f_statistic: (a: number, b: number) => void;
  readonly __wbg_set_cointegrationresult_adf_statistic: (a: number, b: number) => void;
  readonly __wbg_set_cointegrationresult_is_cointegrated: (a: number, b: number) => void;
  readonly __wbg_get_cointegrationresult_is_cointegrated: (a: number) => number;
  readonly __wbg_get_boundstestresult_f_statistic: (a: number) => number;
  readonly __wbg_get_cointegrationresult_adf_statistic: (a: number) => number;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __externref_drop_slice: (a: number, b: number) => void;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
