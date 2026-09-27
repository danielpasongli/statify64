import init, { GARCH, ECM, ARDL } from "./timeseries.js";

self.onmessage = async (e) => {
    const { type, payload } = e.data;
    
    try {
        await init(new URL("./timeseries_bg.wasm?v=" + Date.now(), import.meta.url));
        
        let result = {};
        
        // Helper to format numbers to 4 decimal places
        const fmt = (n) => typeof n === 'number' ? n.toFixed(4) : n;
        const fmtArray = (arr) => arr.map(n => typeof n === 'number' ? n.toFixed(4) : n);

        const computeDiagnostics = (model, data, residuals, p, q, modelType) => {
            const n = data.length;
            const k_mean = 1; // Intercept C
            
            let k_var = 1 + p + q;
            if (modelType === "EGARCH" || modelType === "TGARCH") {
                k_var = 1 + 2 * q + p;
            } else if (modelType === "ARCH") {
                k_var = 1 + q;
            } else if (modelType === "IGARCH") {
                k_var = p + q; // 1 (omega) + p + q - 1 (sum restriction)
            }
            
            const k_total = k_mean + k_var;
            const mean_y = data.reduce((sum, val) => sum + val, 0) / n;
            const sst = data.reduce((sum, val) => sum + Math.pow(val - mean_y, 2), 0);
            const sd_y = Math.sqrt(sst / (n - 1));
            const sse = residuals.reduce((sum, val) => sum + val * val, 0);
            const se_reg = Math.sqrt(sse / (n - k_mean));
            const r2 = sst > 0 ? (1 - sse / sst) : 0;
            const adj_r2 = r2;
            
            let dw_num = 0;
            for (let t = 1; t < n; t++) {
                dw_num += Math.pow(residuals[t] - residuals[t-1], 2);
            }
            const dw = sse > 0 ? (dw_num / sse) : 0;
            const ll = model.get_log_likelihood();
            
            const aic = (-2 * ll + 2 * k_total) / n;
            const bic = (-2 * ll + k_total * Math.log(n)) / n;
            const hq = (-2 * ll + 2 * k_total * Math.log(Math.log(n))) / n;
            
            return {
                rSquared: fmt(r2),
                adjRSquared: fmt(adj_r2),
                seRegression: fmt(se_reg),
                sumSquaredResid: fmt(sse),
                logLikelihood: fmt(ll),
                durbinWatson: fmt(dw),
                meanDependentVar: fmt(mean_y),
                sdDependentVar: fmt(sd_y),
                aic: fmt(aic),
                bic: fmt(bic),
                hq: fmt(hq)
            };
        };

        const normalCDF = (x) => {
            const t = 1.0 / (1.0 + 0.2316419 * Math.abs(x));
            const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
            const pdf = Math.exp(-x * x / 2.0) / Math.sqrt(2.0 * Math.PI);
            return x >= 0.0 ? 1.0 - pdf * poly : pdf * poly;
        };

        const fDistPValue = (f, df1, df2) => {
            if (f <= 0) return 1.0;
            const d = 2.0 / (9.0 * df1);
            const e = 2.0 / (9.0 * df2);
            const A = 1.0 - e;
            const B = 1.0 - d;
            const C = Math.pow(f, 1.0 / 3.0);
            const num = A * C - B;
            const den = Math.sqrt(e * C * C + d);
            if (den === 0) return 1.0;
            const z = num / den;
            return 1.0 - normalCDF(z);
        };

        const computeRegressionDiagnostics = (y, residuals, nParams) => {
            const n = y.length;
            const k = nParams;
            
            const mean_y = y.reduce((sum, val) => sum + val, 0) / n;
            const sst = y.reduce((sum, val) => sum + Math.pow(val - mean_y, 2), 0);
            const sd_y = n > 1 ? Math.sqrt(sst / (n - 1)) : 0;
            const sse = residuals.reduce((sum, val) => sum + val * val, 0);
            const se_reg = n > k ? Math.sqrt(sse / (n - k)) : 0;
            
            const r2 = sst > 0 ? (1 - sse / sst) : 0;
            const adj_r2 = n > k && sst > 0 ? (1 - (sse / (n - k)) / (sst / (n - 1))) : r2;
            
            const f_stat = (n > k && k > 1) ? ((sst - sse) / (k - 1)) / (sse / (n - k)) : 0;
            const f_pval = (n > k && k > 1) ? fDistPValue(f_stat, k - 1, n - k) : 1.0;

            const ll = -0.5 * n * (1.0 + Math.log(2.0 * Math.PI) + Math.log(sse / n));

            const aic = (-2.0 * ll + 2.0 * k) / n;
            const bic = (-2.0 * ll + k * Math.log(n)) / n;
            const hq = (-2.0 * ll + 2.0 * k * Math.log(Math.log(n))) / n;

            let dw_num = 0;
            for (let t = 1; t < n; t++) {
                dw_num += Math.pow(residuals[t] - residuals[t-1], 2);
            }
            const dw = sse > 0 ? (dw_num / sse) : 0;

            return {
                rSquared: fmt(r2),
                adjRSquared: fmt(adj_r2),
                seRegression: fmt(se_reg),
                sumSquaredResid: fmt(sse),
                logLikelihood: fmt(ll),
                fStatistic: fmt(f_stat),
                probFStatistic: fmt(f_pval),
                meanDependentVar: fmt(mean_y),
                sdDependentVar: fmt(sd_y),
                aic: fmt(aic),
                bic: fmt(bic),
                hq: fmt(hq),
                durbinWatson: fmt(dw)
            };
        };

        const computeCorrelogram = (resids, maxLags = 16) => {
            const n_res = resids.length;
            if (n_res < 5) return [];

            const mean_res = resids.reduce((a, b) => a + b, 0) / n_res;
            let c0 = 0;
            for (let t = 0; t < n_res; t++) {
                const dev = resids[t] - mean_res;
                c0 += dev * dev;
            }
            if (c0 === 0) return [];

            const acf = [];
            const lagsCount = Math.min(maxLags, Math.floor(n_res / 4));

            for (let k = 1; k <= lagsCount; k++) {
                let ck = 0;
                for (let t = k; t < n_res; t++) {
                    ck += (resids[t] - mean_res) * (resids[t - k] - mean_res);
                }
                acf.push(ck / c0);
            }

            const pacf = Array(lagsCount).fill(0);
            const phi = Array(lagsCount + 1).fill(0).map(() => Array(lagsCount + 1).fill(0));

            if (lagsCount >= 1) {
                pacf[0] = acf[0];
                phi[1][1] = acf[0];
            }

            for (let k = 2; k <= lagsCount; k++) {
                let num = acf[k - 1];
                let den = 1.0;
                for (let j = 1; j <= k - 1; j++) {
                    num -= phi[k - 1][j] * acf[k - 1 - j];
                    den -= phi[k - 1][j] * acf[j - 1];
                }
                const val = den !== 0 ? num / den : 0;
                phi[k][k] = val;
                pacf[k - 1] = val;

                for (let j = 1; j <= k - 1; j++) {
                    phi[k][j] = phi[k - 1][j] - val * phi[k - 1][k - j];
                }
            }

            const chiSquarePVal = (x_val, df_val) => {
                if (x_val <= 0) return 1.0;
                if (df_val === 1) {
                    const z = Math.sqrt(x_val);
                    return 2.0 * (1.0 - normalCDF(z));
                }
                if (df_val === 2) {
                    return Math.exp(-x_val / 2.0);
                }
                const z = (Math.pow(x_val / df_val, 1.0 / 3.0) - (1.0 - 2.0 / (9.0 * df_val))) / Math.sqrt(2.0 / (9.0 * df_val));
                return 1.0 - normalCDF(z);
            };

            const rows = [];
            let qSum = 0;

            for (let k = 1; k <= lagsCount; k++) {
                const r_k = acf[k - 1];
                qSum += (r_k * r_k) / (n_res - k);
                const qStat = n_res * (n_res + 2) * qSum;
                const qPVal = chiSquarePVal(qStat, k);

                rows.push({
                    lag: k,
                    ac: fmt(r_k),
                    pac: fmt(pacf[k - 1]),
                    qStat: fmt(qStat),
                    prob: fmt(qPVal)
                });
            }

            return rows;
        };


        if (type === "GARCH" || type === "ARCH") {
            const { data, p, q } = payload;
            const effectiveP = type === "ARCH" ? 0 : p;
            const model = new GARCH(new Float64Array(data), effectiveP, q);
            model.estimate();
            
            result = {
                modelType: type,
                p: effectiveP, q,
                coefficients: {
                    mu: fmt(model.get_mu()),
                    mu_se: fmt(model.get_mu_se()),
                    mu_z: fmt(model.get_mu_z()),
                    mu_p: fmt(model.get_mu_p()),
                    
                    omega: fmt(model.get_omega()),
                    omega_se: fmt(model.get_omega_se()),
                    omega_z: fmt(model.get_omega_z()),
                    omega_p: fmt(model.get_omega_p()),

                    alpha: fmtArray(Array.from(model.get_alpha())),
                    alpha_se: fmtArray(Array.from(model.get_alpha_se())),
                    alpha_z: fmtArray(Array.from(model.get_alpha_z())),
                    alpha_p: fmtArray(Array.from(model.get_alpha_p())),

                    beta: effectiveP > 0 ? fmtArray(Array.from(model.get_beta())) : undefined,
                    beta_se: effectiveP > 0 ? fmtArray(Array.from(model.get_beta_se())) : undefined,
                    beta_z: effectiveP > 0 ? fmtArray(Array.from(model.get_beta_z())) : undefined,
                    beta_p: effectiveP > 0 ? fmtArray(Array.from(model.get_beta_p())) : undefined,
                },
                diagnostics: computeDiagnostics(model, Array.from(model.get_data()), Array.from(model.get_residuals()), effectiveP, q, type),
                variance: Array.from(model.get_variance()),
                residuals: Array.from(model.get_residuals()),
                data: Array.from(model.get_data())
            };
            model.free();
        } 
        else if (type === "EGARCH") {
            const { data, p, q } = payload;
            const model = new GARCH(new Float64Array(data), p, q);
            
            // Check if estimate_egarch exists (it should if WASM matches source)
            if (typeof model.estimate_egarch === 'function') {
                model.estimate_egarch();
            } else {
                 console.warn("estimate_egarch not found on GARCH object. Running estimate() instead.");
                 model.estimate();
            }
           
            result = {
                modelType: type,
                p, q,
                coefficients: {
                    mu: fmt(model.get_mu()),
                    mu_se: fmt(model.get_mu_se()),
                    mu_z: fmt(model.get_mu_z()),
                    mu_p: fmt(model.get_mu_p()),

                    omega: fmt(model.get_omega()),
                    omega_se: fmt(model.get_omega_se()),
                    omega_z: fmt(model.get_omega_z()),
                    omega_p: fmt(model.get_omega_p()),

                    alpha: fmtArray(Array.from(model.get_alpha())),
                    alpha_se: fmtArray(Array.from(model.get_alpha_se())),
                    alpha_z: fmtArray(Array.from(model.get_alpha_z())),
                    alpha_p: fmtArray(Array.from(model.get_alpha_p())),

                    gamma: fmtArray(Array.from(model.get_gamma())),
                    gamma_se: fmtArray(Array.from(model.get_gamma_se())),
                    gamma_z: fmtArray(Array.from(model.get_gamma_z())),
                    gamma_p: fmtArray(Array.from(model.get_gamma_p())),

                    beta: fmtArray(Array.from(model.get_beta())),
                    beta_se: fmtArray(Array.from(model.get_beta_se())),
                    beta_z: fmtArray(Array.from(model.get_beta_z())),
                    beta_p: fmtArray(Array.from(model.get_beta_p())),
                },
                diagnostics: computeDiagnostics(model, Array.from(model.get_data()), Array.from(model.get_residuals()), p, q, type),
                variance: Array.from(model.get_variance()),
                residuals: Array.from(model.get_residuals()),
                data: Array.from(model.get_data())
            };
            model.free();
        }
        else if (type === "TGARCH") {
             const { data, p, q } = payload;
             const model = new GARCH(new Float64Array(data), p, q);
             
             if (typeof model.estimate_tgarch === 'function') {
                model.estimate_tgarch();
             } else {
                 console.warn("estimate_tgarch not found on GARCH object. Running estimate() instead.");
                 model.estimate();
             }

             result = {
                modelType: type,
                p, q,
                coefficients: {
                    mu: fmt(model.get_mu()),
                    mu_se: fmt(model.get_mu_se()),
                    mu_z: fmt(model.get_mu_z()),
                    mu_p: fmt(model.get_mu_p()),

                    omega: fmt(model.get_omega()),
                    omega_se: fmt(model.get_omega_se()),
                    omega_z: fmt(model.get_omega_z()),
                    omega_p: fmt(model.get_omega_p()),

                    alpha: fmtArray(Array.from(model.get_alpha())),
                    alpha_se: fmtArray(Array.from(model.get_alpha_se())),
                    alpha_z: fmtArray(Array.from(model.get_alpha_z())),
                    alpha_p: fmtArray(Array.from(model.get_alpha_p())),

                    gamma: fmtArray(Array.from(model.get_gamma())),
                    gamma_se: fmtArray(Array.from(model.get_gamma_se())),
                    gamma_z: fmtArray(Array.from(model.get_gamma_z())),
                    gamma_p: fmtArray(Array.from(model.get_gamma_p())),

                    beta: fmtArray(Array.from(model.get_beta())),
                    beta_se: fmtArray(Array.from(model.get_beta_se())),
                    beta_z: fmtArray(Array.from(model.get_beta_z())),
                    beta_p: fmtArray(Array.from(model.get_beta_p())),
                },
                diagnostics: computeDiagnostics(model, Array.from(model.get_data()), Array.from(model.get_residuals()), p, q, type),
                variance: Array.from(model.get_variance()),
                residuals: Array.from(model.get_residuals()),
                data: Array.from(model.get_data())
             };
             model.free();
        } 
        else if (type === "IGARCH") {
              const { data, p, q } = payload;
              const model = new GARCH(new Float64Array(data), p, q);
              
              if (typeof model.estimate_igarch === 'function') {
                 model.estimate_igarch();
              } else {
                  console.warn("estimate_igarch not found on GARCH object. Running estimate() instead.");
                  model.estimate();
              }

              result = {
                 modelType: type,
                 p, q,
                 coefficients: {
                     mu: fmt(model.get_mu()),
                     mu_se: fmt(model.get_mu_se()),
                     mu_z: fmt(model.get_mu_z()),
                     mu_p: fmt(model.get_mu_p()),

                     omega: fmt(model.get_omega()),
                     omega_se: fmt(model.get_omega_se()),
                     omega_z: fmt(model.get_omega_z()),
                     omega_p: fmt(model.get_omega_p()),

                     alpha: fmtArray(Array.from(model.get_alpha())),
                     alpha_se: fmtArray(Array.from(model.get_alpha_se())),
                     alpha_z: fmtArray(Array.from(model.get_alpha_z())),
                     alpha_p: fmtArray(Array.from(model.get_alpha_p())),

                     beta: fmtArray(Array.from(model.get_beta())),
                     beta_se: fmtArray(Array.from(model.get_beta_se())),
                     beta_z: fmtArray(Array.from(model.get_beta_z())),
                     beta_p: fmtArray(Array.from(model.get_beta_p())),
                 },
                 diagnostics: computeDiagnostics(model, Array.from(model.get_data()), Array.from(model.get_residuals()), p, q, type),
                 variance: Array.from(model.get_variance()),
                 residuals: Array.from(model.get_residuals()),
                 data: Array.from(model.get_data())
              };
              model.free();
         }
        else if (type === "ECM") {
            const { y, x, n_vars, max_lag_adf, max_lag_ecm } = payload;
            const model = new ECM(new Float64Array(y), new Float64Array(x), n_vars, max_lag_adf, max_lag_ecm);
            model.estimate_ecm();
            
            const y_arr = Array.from(y);
            const delta_y = [];
            for (let i = 1; i < y_arr.length; i++) {
                delta_y.push(y_arr[i] - y_arr[i-1]);
            }
            const lrCoefs = Array.from(model.get_lr_coefficients());
            const lrResids = Array.from(model.get_lr_residuals());
            const ecmCoefs = Array.from(model.get_ecm_coefficients());
            const ecmResids = Array.from(model.get_ecm_residuals());

            result = {
                longRun: {
                    coefficients: fmtArray(lrCoefs),
                    stdErrors: fmtArray(Array.from(model.get_lr_std_errors())),
                    tStats: fmtArray(Array.from(model.get_lr_t_statistics())),
                    pValues: fmtArray(Array.from(model.get_lr_p_values())),
                    residuals: lrResids,
                    rSquared: fmt(model.get_lr_r_squared()),
                    adjRSquared: fmt(model.get_lr_adj_r_squared()),
                    fStat: fmt(model.get_lr_f_statistic()),
                    diagnostics: computeRegressionDiagnostics(y_arr, lrResids, lrCoefs.length),
                },
                cointegration: {
                    adfStat: fmt(model.get_adf_statistic()),
                    pValue: fmt(model.get_adf_p_value()),
                    isCointegrated: model.get_is_cointegrated(),
                },
                ecm: {
                    coefficients: fmtArray(ecmCoefs),
                    stdErrors: fmtArray(Array.from(model.get_ecm_std_errors())),
                    tStats: fmtArray(Array.from(model.get_ecm_t_statistics())),
                    pValues: fmtArray(Array.from(model.get_ecm_p_values())),
                    residuals: ecmResids,
                    rSquared: fmt(model.get_ecm_r_squared()),
                    adjRSquared: fmt(model.get_ecm_adj_r_squared()),
                    fStat: fmt(model.get_ecm_f_statistic()),
                    diagnostics: computeRegressionDiagnostics(delta_y, ecmResids, ecmCoefs.length),
                },
                diagnostics: {
                    jarqueBera: { stat: fmt(model.get_jb_stat()), prob: fmt(model.get_jb_p_value()) },
                    breuschGodfrey: { stat: fmt(model.get_bg_stat()), prob: fmt(model.get_bg_p_value()) },
                    breuschPagan: { stat: fmt(model.get_bp_stat()), prob: fmt(model.get_bp_p_value()) }
                },
                correlogram: computeCorrelogram(ecmResids, 16)
            };
            model.free();
        }
        else if (type === "ARDL") {
            const { y, x, n_vars, p, q, autoSelect, maxP = 4, maxQ = 4, selectionCriterion = 'aic' } = payload;
            const y_arr = Array.from(y);
            
            // Reconstruct 2D X arrays
            const x_arrays = [];
            const n_obs = y_arr.length;
            for (let k = 0; k < n_vars; k++) {
                x_arrays.push(Array.from(x.slice(k * n_obs, (k + 1) * n_obs)));
            }

            const invertMatrix = (M) => {
                const n_dim = M.length;
                const A = M.map((row, i) => {
                    const r = [...row];
                    for (let j = 0; j < n_dim; j++) r.push(i === j ? 1 : 0);
                    return r;
                });
                for (let i = 0; i < n_dim; i++) {
                    let maxRow = i;
                    for (let k = i + 1; k < n_dim; k++) {
                        if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
                    }
                    if (Math.abs(A[maxRow][i]) < 1e-12) return null;
                    [A[i], A[maxRow]] = [A[maxRow], A[i]];
                    const pivot = A[i][i];
                    for (let j = 0; j < 2 * n_dim; j++) A[i][j] /= pivot;
                    for (let k = 0; k < n_dim; k++) {
                        if (k !== i) {
                            const factor = A[k][i];
                            for (let j = 0; j < 2 * n_dim; j++) A[k][j] -= factor * A[i][j];
                        }
                    }
                }
                return A.map(row => row.slice(n_dim));
            };

            const fitUnrestrictedARDL = (p_val, q_arr) => {
                const max_q = Math.max(...q_arr);
                const max_lag = Math.max(p_val, max_q);
                const eff_n = n_obs - max_lag;

                if (eff_n < 5) return null;

                const varNames = [];
                for (let i = 1; i <= p_val; i++) {
                    varNames.push(`Y(-${i})`);
                }
                for (let k = 0; k < n_vars; k++) {
                    for (let j = 0; j <= q_arr[k]; j++) {
                        const lagStr = j === 0 ? "" : `(-${j})`;
                        varNames.push(`X${n_vars > 1 ? (k + 1) : ""}${lagStr}`);
                    }
                }
                varNames.push("C");

                const k_cols = varNames.length;
                if (eff_n <= k_cols) return null;

                const y_vec = [];
                const x_mat = [];

                for (let t = max_lag; t < n_obs; t++) {
                    y_vec.push(y_arr[t]);
                    const row = [];
                    for (let i = 1; i <= p_val; i++) {
                        row.push(y_arr[t - i]);
                    }
                    for (let k = 0; k < n_vars; k++) {
                        for (let j = 0; j <= q_arr[k]; j++) {
                            row.push(x_arrays[k][t - j]);
                        }
                    }
                    row.push(1.0);
                    x_mat.push(row);
                }

                const xtx = Array(k_cols).fill(0).map(() => Array(k_cols).fill(0));
                const xty = Array(k_cols).fill(0);

                for (let r = 0; r < eff_n; r++) {
                    for (let i = 0; i < k_cols; i++) {
                        xty[i] += x_mat[r][i] * y_vec[r];
                        for (let j = 0; j < k_cols; j++) {
                            xtx[i][j] += x_mat[r][i] * x_mat[r][j];
                        }
                    }
                }

                const xtx_inv = invertMatrix(xtx);
                if (!xtx_inv) return null;

                const coefs = Array(k_cols).fill(0);
                for (let i = 0; i < k_cols; i++) {
                    for (let j = 0; j < k_cols; j++) {
                        coefs[i] += xtx_inv[i][j] * xty[j];
                    }
                }

                const residuals = [];
                let sse = 0;
                for (let r = 0; r < eff_n; r++) {
                    let fitVal = 0;
                    for (let i = 0; i < k_cols; i++) {
                        fitVal += x_mat[r][i] * coefs[i];
                    }
                    const res = y_vec[r] - fitVal;
                    residuals.push(res);
                    sse += res * res;
                }

                const df = eff_n - k_cols;
                const sigma2 = sse / df;

                const stdErrors = [];
                const tStats = [];
                const pValues = [];

                for (let i = 0; i < k_cols; i++) {
                    const se = Math.sqrt(Math.max(0, sigma2 * xtx_inv[i][i]));
                    stdErrors.push(se);
                    const t = se > 0 ? coefs[i] / se : 0;
                    tStats.push(t);
                    const pVal = 2.0 * (1.0 - normalCDF(Math.abs(t)));
                    pValues.push(pVal);
                }

                const mean_y = y_vec.reduce((a, b) => a + b, 0) / eff_n;
                const sst = y_vec.reduce((a, b) => a + Math.pow(b - mean_y, 2), 0);
                const sd_y = eff_n > 1 ? Math.sqrt(sst / (eff_n - 1)) : 0;
                const se_reg = Math.sqrt(sse / df);

                const r2 = sst > 0 ? (1 - sse / sst) : 0;
                const adj_r2 = sst > 0 ? (1 - (sse / df) / (sst / (eff_n - 1))) : r2;

                const f_stat = (k_cols > 1 && sse > 0) ? ((sst - sse) / (k_cols - 1)) / (sse / df) : 0;
                const f_pval = (k_cols > 1) ? fDistPValue(f_stat, k_cols - 1, df) : 1.0;

                const ll = -0.5 * eff_n * (1.0 + Math.log(2.0 * Math.PI) + Math.log(sse / eff_n));

                const aic_val = (-2.0 * ll + 2.0 * k_cols) / eff_n;
                const bic_val = (-2.0 * ll + k_cols * Math.log(eff_n)) / eff_n;
                const hq_val = (-2.0 * ll + 2.0 * k_cols * Math.log(Math.log(eff_n))) / eff_n;

                let dw_num = 0;
                for (let t = 1; t < eff_n; t++) {
                    dw_num += Math.pow(residuals[t] - residuals[t-1], 2);
                }
                const dw = sse > 0 ? (dw_num / sse) : 0;

                let sum_alpha = 0;
                for (let i = 0; i < p_val; i++) {
                    sum_alpha += coefs[i];
                }
                const denom = 1.0 - sum_alpha;

                let varIdxCounter = p_val;
                const lrCoefs = [];
                for (let k = 0; k < n_vars; k++) {
                    let sum_gamma = 0;
                    for (let j = 0; j <= q_arr[k]; j++) {
                        sum_gamma += coefs[varIdxCounter];
                        varIdxCounter++;
                    }
                    const lr_val = Math.abs(denom) > 1e-8 ? sum_gamma / denom : 0;
                    lrCoefs.push(lr_val);
                }
                const constCoef = coefs[coefs.length - 1];
                const lrIntercept = Math.abs(denom) > 1e-8 ? constCoef / denom : 0;

                const fittedVals = [];
                for (let r = 0; r < eff_n; r++) {
                    let fitVal = 0;
                    for (let i = 0; i < k_cols; i++) {
                        fitVal += x_mat[r][i] * coefs[i];
                    }
                    fittedVals.push(fitVal);
                }

                return {
                    p: p_val,
                    q_arr,
                    varNames,
                    coefficients: coefs,
                    stdErrors,
                    tStats,
                    pValues,
                    residuals,
                    fitted: fittedVals,
                    actual: y_vec,
                    effObs: eff_n,
                    aicRaw: aic_val,
                    bicRaw: bic_val,
                    hqRaw: hq_val,
                    logLikelihoodRaw: ll,
                    diagnostics: {
                        rSquared: fmt(r2),
                        adjRSquared: fmt(adj_r2),
                        seRegression: fmt(se_reg),
                        sumSquaredResid: fmt(sse),
                        logLikelihood: fmt(ll),
                        fStatistic: fmt(f_stat),
                        probFStatistic: fmt(f_pval),
                        meanDependentVar: fmt(mean_y),
                        sdDependentVar: fmt(sd_y),
                        aic: fmt(aic_val),
                        bic: fmt(bic_val),
                        hq: fmt(hq_val),
                        durbinWatson: fmt(dw)
                    },
                    longRunDerived: {
                        intercept: lrIntercept,
                        coefficients: lrCoefs,
                        speedOfAdjustment: sum_alpha - 1
                    }
                };
            };

            const computeCorrelogram = (resids, maxLags = 16) => {
                const n_res = resids.length;
                if (n_res < 5) return [];

                const mean_res = resids.reduce((a, b) => a + b, 0) / n_res;
                let c0 = 0;
                for (let t = 0; t < n_res; t++) {
                    const dev = resids[t] - mean_res;
                    c0 += dev * dev;
                }
                if (c0 === 0) return [];

                const acf = [];
                const lagsCount = Math.min(maxLags, Math.floor(n_res / 4));

                for (let k = 1; k <= lagsCount; k++) {
                    let ck = 0;
                    for (let t = k; t < n_res; t++) {
                        ck += (resids[t] - mean_res) * (resids[t - k] - mean_res);
                    }
                    acf.push(ck / c0);
                }

                const pacf = Array(lagsCount).fill(0);
                const phi = Array(lagsCount + 1).fill(0).map(() => Array(lagsCount + 1).fill(0));

                if (lagsCount >= 1) {
                    pacf[0] = acf[0];
                    phi[1][1] = acf[0];
                }

                for (let k = 2; k <= lagsCount; k++) {
                    let num = acf[k - 1];
                    let den = 1.0;
                    for (let j = 1; j <= k - 1; j++) {
                        num -= phi[k - 1][j] * acf[k - 1 - j];
                        den -= phi[k - 1][j] * acf[j - 1];
                    }
                    const val = den !== 0 ? num / den : 0;
                    phi[k][k] = val;
                    pacf[k - 1] = val;

                    for (let j = 1; j <= k - 1; j++) {
                        phi[k][j] = phi[k - 1][j] - val * phi[k - 1][k - j];
                    }
                }

                const chiSquarePVal = (x_val, df_val) => {
                    if (x_val <= 0) return 1.0;
                    if (df_val === 1) {
                        const z = Math.sqrt(x_val);
                        return 2.0 * (1.0 - normalCDF(z));
                    }
                    if (df_val === 2) {
                        return Math.exp(-x_val / 2.0);
                    }
                    const z = (Math.pow(x_val / df_val, 1.0 / 3.0) - (1.0 - 2.0 / (9.0 * df_val))) / Math.sqrt(2.0 / (9.0 * df_val));
                    return 1.0 - normalCDF(z);
                };

                const rows = [];
                let qSum = 0;

                for (let k = 1; k <= lagsCount; k++) {
                    const r_k = acf[k - 1];
                    qSum += (r_k * r_k) / (n_res - k);
                    const qStat = n_res * (n_res + 2) * qSum;
                    const qPVal = chiSquarePVal(qStat, k);

                    rows.push({
                        lag: k,
                        ac: fmt(r_k),
                        pac: fmt(pacf[k - 1]),
                        qStat: fmt(qStat),
                        prob: fmt(qPVal)
                    });
                }

                return rows;
            };

            let selectedP = p || 1;
            let selectedQ = q || Array(n_vars).fill(1);
            let evaluatedModels = [];
            let mainUnrestrictedModel = null;

            if (autoSelect) {
                const max_p_val = Math.max(1, maxP || 4);
                const max_q_val = Math.max(0, maxQ || 4);

                for (let p_i = 1; p_i <= max_p_val; p_i++) {
                    for (let q_i = 0; q_i <= max_q_val; q_i++) {
                        const q_vec = Array(n_vars).fill(q_i);
                        const fitM = fitUnrestrictedARDL(p_i, q_vec);
                        if (fitM) {
                            evaluatedModels.push(fitM);
                        }
                    }
                }

                if (evaluatedModels.length > 0) {
                    const critKey = selectionCriterion === 'bic' ? 'bicRaw' : selectionCriterion === 'hq' ? 'hqRaw' : 'aicRaw';
                    evaluatedModels.sort((a, b) => a[critKey] - b[critKey]);
                    mainUnrestrictedModel = evaluatedModels[0];
                    selectedP = mainUnrestrictedModel.p;
                    selectedQ = mainUnrestrictedModel.q_arr;
                }
            }

            if (!mainUnrestrictedModel) {
                const q_vec = Array.isArray(selectedQ) ? selectedQ : Array(n_vars).fill(selectedQ[0] || 1);
                mainUnrestrictedModel = fitUnrestrictedARDL(selectedP, q_vec);
            }

            // Estimate WASM ARDL model with selected P and Q
            const model = new ARDL(
                new Float64Array(y), 
                new Float64Array(x), 
                n_vars, 
                selectedP, 
                new Uint32Array(selectedQ)
            );
            model.estimate_ardl_ecm();
            
            const q_arr = Array.from(selectedQ);
            const max_q = Math.max(...q_arr);
            const max_lag_val = Math.max(selectedP, max_q);
            const start_idx = max_lag_val + 1;
            const y_sr = [];
            for (let t = start_idx; t < y_arr.length; t++) {
                y_sr.push(y_arr[t] - y_arr[t-1]);
            }

            const lrCoefs = Array.from(model.get_lr_coefficients());
            const lrResids = Array.from(model.get_lr_residuals());
            const srCoefs = Array.from(model.get_sr_coefficients());
            const srResids = Array.from(model.get_sr_residuals());

            const correlogramData = mainUnrestrictedModel ? computeCorrelogram(mainUnrestrictedModel.residuals) : [];

            result = {
                selectedModelName: `ARDL(${selectedP}, ${selectedQ.join(', ')})`,
                selectedP,
                selectedQ,
                evaluatedModelsCount: evaluatedModels.length,
                selectionCriterion: selectionCriterion.toUpperCase(),
                correlogram: correlogramData,
                unrestrictedModel: mainUnrestrictedModel ? {
                    varNames: mainUnrestrictedModel.varNames,
                    coefficients: fmtArray(mainUnrestrictedModel.coefficients),
                    stdErrors: fmtArray(mainUnrestrictedModel.stdErrors),
                    tStats: fmtArray(mainUnrestrictedModel.tStats),
                    pValues: fmtArray(mainUnrestrictedModel.pValues),
                    residuals: mainUnrestrictedModel.residuals,
                    fitted: mainUnrestrictedModel.fitted,
                    actual: mainUnrestrictedModel.actual,
                    effObs: mainUnrestrictedModel.effObs,
                    diagnostics: mainUnrestrictedModel.diagnostics,
                    longRunDerived: {
                        intercept: fmt(mainUnrestrictedModel.longRunDerived.intercept),
                        coefficients: fmtArray(mainUnrestrictedModel.longRunDerived.coefficients),
                        speedOfAdjustment: fmt(mainUnrestrictedModel.longRunDerived.speedOfAdjustment)
                    }
                } : null,
                longRun: {
                    coefficients: fmtArray(lrCoefs),
                    stdErrors: fmtArray(Array.from(model.get_lr_std_errors())),
                    tStats: fmtArray(Array.from(model.get_lr_t_statistics())),
                    pValues: fmtArray(Array.from(model.get_lr_p_values())),
                    residuals: lrResids,
                    rSquared: fmt(model.get_lr_r_squared()),
                    adjRSquared: fmt(model.get_lr_adj_r_squared()),
                    fStat: fmt(model.get_lr_f_statistic()),
                    diagnostics: computeRegressionDiagnostics(y_arr, lrResids, lrCoefs.length),
                },
                cointegration: {
                    statistic: fmt(model.get_adf_statistic()),
                    pValue: fmt(model.get_adf_p_value()),
                    isCointegrated: model.get_is_cointegrated(),
                },
                shortRun: {
                    coefficients: fmtArray(srCoefs),
                    stdErrors: fmtArray(Array.from(model.get_sr_std_errors())),
                    tStats: fmtArray(Array.from(model.get_sr_t_statistics())),
                    pValues: fmtArray(Array.from(model.get_sr_p_values())),
                    residuals: srResids,
                    rSquared: fmt(model.get_sr_r_squared()),
                    adjRSquared: fmt(model.get_sr_adj_r_squared()),
                    fStat: fmt(model.get_sr_f_statistic()),
                    diagnostics: computeRegressionDiagnostics(y_sr, srResids, srCoefs.length),
                },
                diagnostics: {
                    jarqueBera: { stat: fmt(model.get_jb_stat()), prob: fmt(model.get_jb_p_value()) },
                    breuschGodfrey: { stat: fmt(model.get_bg_stat()), prob: fmt(model.get_bg_p_value()) },
                    breuschPagan: { stat: fmt(model.get_bp_stat()), prob: fmt(model.get_bp_p_value()) }
                }
            };
            model.free();
        }
        else if (type === "ARCH_LM") {
            const { residuals, lags } = payload;
            
            const lmResult = GARCH.arch_lm_test(new Float64Array(residuals), lags);
            
            result = {
                statistic: fmt(lmResult.lm_statistic),      // Obs*R-squared
                pValue: fmt(lmResult.p_value),               // Prob. Chi-Square
                fStatistic: fmt(lmResult.f_statistic),       // F-statistic
                fPValue: fmt(lmResult.f_p_value),            // Prob. F
                isHomoscedastic: !lmResult.has_arch_effect,
                testName: "ARCH-LM Test",
                lags: lags,
            };
            
            lmResult.free();
        }
        
        self.postMessage({ status: "success", result });
        
    } catch (err) {
        console.error("Worker Error:", err);
        self.postMessage({ status: "error", error: err.message || err.toString() });
    }
};
