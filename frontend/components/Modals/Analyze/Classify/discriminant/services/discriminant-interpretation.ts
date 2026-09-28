// discriminant-interpretation.ts
//
// Generate interpretive descriptions for the discriminant analysis output tables,
// based on the values returned by the WASM analysis. store.ts shows each one in
// the Description of its table, before the table footnotes.
import {
  compareGroupLabels,
  formatAssumptionStat,
  formatCount,
  formatPercent,
  formatSig,
  formatStat,
} from "@/components/Modals/Analyze/Classify/discriminant/services/discriminant-number-format";

const ALPHA = 0.05;

const pText = (p: number) => {
  const text = formatSig(p);
  return text.startsWith("<") ? `p (Sig.) < ${text.slice(1)}` : `p (Sig.) = ${text}`;
};

const joinList = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

const groupNames = (groups: string[]) =>
  groups.length === 1 ? `group ${groups[0]}` : `groups ${joinList(groups)}`;

const indexOfMax = (values: number[]) => values.reduce((best, v, i) => (v > values[best] ? i : best), 0);
const indexOfMin = (values: number[]) => values.reduce((best, v, i) => (v < values[best] ? i : best), 0);
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Last step of a stepwise per-step list (steps are not sorted in the result). */
const lastStep = (steps: any[]) => steps.reduce((a, b) => (Number(b.step) > Number(a.step) ? b : a));

/** Generate interpretation for Assumption Checks Summary */
export function generateAssumptionSummaryDescription(rows: any[]): string {
  if (!rows?.length) return "";
  const violated = rows.filter((r) => r.violated).map((r) => String(r.assumption).toLowerCase());
  if (violated.length === 0) return `All ${rows.length} checked assumptions are met.`;
  return `${rows.length - violated.length} of ${rows.length} checked assumptions are met. Not met: ${joinList(violated)}.`;
}

/** Generate interpretation for Multicollinearity (Tolerance and VIF) */
export function generateMulticollinearityDescription(mc: any): string {
  if (!mc?.variables?.length) return "";
  const high = mc.variables.filter((_: string, i: number) => mc.vif[i] >= mc.vif_threshold);
  if (high.length > 0) {
    return `VIF is ${mc.vif_threshold} or more for ${joinList(high)}, which indicates severe multicollinearity among the predictors.`;
  }
  if (mc.violated) {
    return `All VIF values are below ${mc.vif_threshold}, but the largest condition index is ${formatAssumptionStat(mc.max_condition_index)} (${mc.condition_threshold} or more), which indicates multicollinearity among the predictors.`;
  }
  const i = indexOfMax(mc.vif);
  return `All VIF values are below ${mc.vif_threshold} (highest: ${mc.variables[i]}, VIF = ${formatAssumptionStat(mc.vif[i])}), so there is no severe multicollinearity among the predictors.`;
}

/** Generate interpretation for Multivariate Normality (Henze-Zirkler) */
export function generateMultivariateNormalityDescription(mv: any): string {
  if (!mv?.groups?.length) return "";
  const groups: string[] = mv.groups;
  const rejected = groups.filter((_, i) => mv.tested[i] && !mv.normal[i]);
  const normal = groups.filter((_, i) => mv.tested[i] && mv.normal[i]);
  const untested = groups.filter((_, i) => !mv.tested[i]);
  if (rejected.length === 0 && normal.length === 0) {
    return "No group could be tested because every group has too few cases (n ≤ p).";
  }

  let text =
    rejected.length === 0
      ? "The predictors are multivariate normal in every tested group (p > .05)."
      : `Multivariate normality is rejected (p ≤ .05) in ${groupNames(rejected)}${normal.length ? ` but holds in ${groupNames(normal)}` : ""}.`;
  if (untested.length) {
    text += ` Not tested because of too few cases (n ≤ p): ${groupNames(untested)}.`;
  }
  return text;
}

/** Generate interpretation for Univariate Normality (Anderson-Darling) */
export function generateUnivariateNormalityDescription(uv: any): string {
  if (!uv?.variables?.length) return "";
  const total = uv.variables.length;
  const failed = uv.variables
    .map((v: string, i: number) => `${v} in group ${uv.groups[i]}`)
    .filter((_: string, i: number) => !uv.normal[i]);
  if (failed.length === 0) return `All ${total} predictor × group combinations are normally distributed (p > .05).`;
  const list = failed.length <= 5 ? `: ${joinList(failed)}` : "";
  return `${failed.length} of ${total} predictor × group combinations are not normally distributed (p ≤ .05)${list}.`;
}

/** Generate interpretation for Log Determinants (also used for the separate-groups table) */
export function generateLogDeterminantsDescription(ld: any): string {
  if (!ld?.groups?.length || ld.groups.length < 2) return "";
  const hi = indexOfMax(ld.log_determinants);
  const lo = indexOfMin(ld.log_determinants);
  return `Group ${ld.groups[hi]} has the largest log determinant (${formatStat(ld.log_determinants[hi])}), meaning the most dispersed covariance matrix, and group ${ld.groups[lo]} the smallest (${formatStat(ld.log_determinants[lo])}).`;
}

/** Generate interpretation for Box's M Test Results */
export function generateBoxMDescription(bm: any, ofFunctions = false): string {
  if (!bm) return "";
  const stats = `Box's M = ${formatStat(bm.box_m)}, F(${formatCount(bm.df1)}, ${formatCount(bm.df2)}) = ${formatStat(bm.f_approx)}, ${pText(bm.p_value)}`;
  const differ = bm.p_value < ALPHA;
  if (ofFunctions) {
    return `${stats}. The covariance matrices of the discriminant functions ${differ ? "differ significantly" : "do not differ significantly"} between groups.`;
  }
  return differ
    ? `${stats}. The group covariance matrices are significantly different, so the assumption of equal covariance matrices is not met.`
    : `${stats}. The group covariance matrices are not significantly different, so the assumption of equal covariance matrices is met.`;
}

/** Generate interpretation for Analysis Case Processing Summary */
export function generateProcessingSummaryDescription(ps: any): string {
  if (!ps) return "";
  let text = `Of the ${formatCount(ps.total_count)} cases, ${formatCount(ps.valid_count)} (${formatPercent(ps.valid_percent)}%) were valid and used in the analysis.`;
  if (ps.excluded_count > 0) {
    const reasons: string[] = [];
    if (ps.missing_group_codes > 0) reasons.push(`${formatCount(ps.missing_group_codes)} with missing or out-of-range group codes`);
    if (ps.missing_disc_vars > 0) reasons.push(`${formatCount(ps.missing_disc_vars)} with missing predictor values`);
    if (ps.both_missing > 0) reasons.push(`${formatCount(ps.both_missing)} with both`);
    if (ps.unselected > 0) reasons.push(`${formatCount(ps.unselected)} not selected`);
    text += ` ${formatCount(ps.excluded_count)} cases were excluded (${joinList(reasons)}).`;
  }
  return text;
}

/** Generate interpretation for Classification Processing Summary */
export function generateClassificationProcessingDescription(ps: any): string {
  if (!ps) return "";
  const processed = ps.classification_processed ?? ps.total_count;
  const used = ps.classification_used_count ?? processed;
  const extra = used - ps.valid_count;
  return `${formatCount(processed)} cases were processed and ${formatCount(used)} were used in the classification output${
    extra > 0 ? `, including ${formatCount(extra)} cases that were not used to estimate the functions` : ""
  }.`;
}

/** Generate interpretation for Group Statistics */
export function generateGroupStatisticsDescription(gs: any): string {
  if (!gs?.groups?.length) return "";
  const counts: number[] = gs.unweighted_n?.[0]?.values ?? [];
  const groups = gs.groups
    .map((g: string, i: number) => ({ g, i, n: counts[i] }))
    .filter((x: any) => x.g !== "Total");
  let text = `The analysis compares ${groups.length} groups: ${joinList(groups.map((x: any) => `group ${x.g} (n = ${formatCount(x.n)})`))}.`;

  // Predictor whose group means differ most, relative to its overall standard deviation.
  const totalIndex = gs.groups.indexOf("Total");
  if (gs.means?.length && totalIndex >= 0) {
    const meansOf = (v: string) => gs.means.find((m: any) => m.variable === v).values;
    const ranges = gs.variables.map((v: string) => {
      const values = groups.map((x: any) => meansOf(v)[x.i]);
      const sd = gs.std_deviations.find((s: any) => s.variable === v).values[totalIndex];
      return (Math.max(...values) - Math.min(...values)) / sd;
    });
    const v = gs.variables[indexOfMax(ranges)];
    const values = groups.map((x: any) => meansOf(v)[x.i]);
    const hi = indexOfMax(values);
    const lo = indexOfMin(values);
    text += ` The group means differ most on ${v}, from ${formatStat(values[lo])} in group ${groups[lo].g} to ${formatStat(values[hi])} in group ${groups[hi].g}.`;
  }
  return text;
}

/** Generate interpretation for Tests of Equality of Group Means */
export function generateEqualityTestsDescription(eq: any): string {
  if (!eq?.variables?.length) return "";
  const vars: string[] = eq.variables;
  const notSig = vars.filter((_, i) => !(eq.significance[i] < ALPHA));
  let text =
    notSig.length === 0
      ? `All ${vars.length} predictors have significantly different group means (p (Sig.) < .05).`
      : `${vars.length - notSig.length} of ${vars.length} predictors have significantly different group means (p (Sig.) < .05); ${joinList(notSig)} ${notSig.length === 1 ? "does" : "do"} not.`;
  const best = indexOfMin(eq.wilks_lambda);
  text += ` The best single discriminator is ${vars[best]} (Wilks' Lambda = ${formatStat(eq.wilks_lambda[best])}, F = ${formatStat(eq.f_values[best])}, ${pText(eq.significance[best])}).`;
  return text;
}

/** Generate interpretation for Pooled Within-Groups Covariance Matrix */
export function generatePooledCovarianceDescription(pm: any): string {
  if (!pm?.variables?.length || pm.variables.length < 2) return "";
  const variances = pm.variables.map((_: string, i: number) => pm.covariance[i].values[i].value);
  const hi = indexOfMax(variances);
  const lo = indexOfMin(variances);
  return `Within-group variances range from ${formatStat(variances[lo])} (${pm.variables[lo]}) to ${formatStat(variances[hi])} (${pm.variables[hi]}).`;
}

/** Generate interpretation for Pooled Within-Groups Correlation Matrix */
export function generatePooledCorrelationDescription(pm: any): string {
  if (!pm?.variables?.length || pm.variables.length < 2) return "";
  let best = { a: "", b: "", r: 0 };
  for (let i = 0; i < pm.variables.length; i++) {
    for (let j = i + 1; j < pm.variables.length; j++) {
      const r = pm.correlation[i].values[j].value;
      if (Math.abs(r) >= Math.abs(best.r)) best = { a: pm.variables[i], b: pm.variables[j], r };
    }
  }
  const strength = Math.abs(best.r) >= 0.7 ? "strong" : Math.abs(best.r) >= 0.3 ? "moderate" : "weak";
  return `The strongest within-group correlation is between ${best.a} and ${best.b} (r = ${formatStat(best.r)}), a ${strength} correlation.`;
}

/** Generate interpretation for Covariance Matrices */
export function generateCovarianceMatricesDescription(cm: any): string {
  const matrices = (cm?.matrices ?? []).filter((m: any) => m.group !== "Total");
  if (matrices.length < 2) return "";
  let best = { v: "", ratio: 0, lo: "", hi: "", min: 0, max: 0 };
  cm.variables.forEach((v: string, k: number) => {
    const variances = matrices.map((m: any) => m.matrix.find((row: any) => row.variable === v).values[k].value);
    const hi = indexOfMax(variances);
    const lo = indexOfMin(variances);
    const ratio = variances[hi] / variances[lo];
    if (ratio > best.ratio) {
      best = { v, ratio, lo: matrices[lo].group, hi: matrices[hi].group, min: variances[lo], max: variances[hi] };
    }
  });
  return `The variance of ${best.v} differs most between groups, from ${formatStat(best.min)} in group ${best.lo} to ${formatStat(best.max)} in group ${best.hi}.`;
}

/** Generate interpretation for Variables Entered/Removed (stepwise) */
export function generateStepwiseDescription(sw: any, predictors: string[]): string {
  const entered: string[] = (sw?.variables_entered ?? []).filter(Boolean);
  if (!entered.length) return "";
  const removed: string[] = (sw.variables_removed ?? []).filter(Boolean);

  // Replay the steps to get the final model.
  const model: string[] = [];
  sw.variables_entered.forEach((v: string | null, i: number) => {
    if (v) model.push(v);
    const r = sw.variables_removed?.[i];
    if (r && model.includes(r)) model.splice(model.indexOf(r), 1);
  });
  const notIn = predictors.filter((v) => !model.includes(v));

  let text = `The stepwise selection took ${sw.variables_entered.length} steps and entered ${joinList(entered)}, in that order.`;
  if (removed.length) text += ` Removed later: ${joinList(removed)}.`;
  text += ` The final model contains ${model.length} of ${predictors.length} predictors${
    notIn.length ? `; ${joinList(notIn)} ${notIn.length === 1 ? "is" : "are"} not included` : ""
  }.`;
  return text;
}

/** Generate interpretation for Variables in the Analysis */
export function generateVariablesInDescription(sw: any): string {
  if (!sw?.variables_in_analysis?.length) return "";
  const last = lastStep(sw.variables_in_analysis);
  const vars = last.variables ?? [];
  if (vars.length === 0) return "";
  if (vars.length === 1) return `At the final step (step ${last.step}) only ${vars[0].variable} is in the model.`;
  const f = vars.map((v: any) => v.f_to_remove);
  const hi = vars[indexOfMax(f)];
  const lo = vars[indexOfMin(f)];
  return `At the final step (step ${last.step}), ${hi.variable} has the largest F to Remove (${formatStat(hi.f_to_remove)}) and contributes most to the model, while ${lo.variable} has the smallest (${formatStat(lo.f_to_remove)}).`;
}

/** Generate interpretation for Variables Not in the Analysis */
export function generateVariablesNotInDescription(sw: any): string {
  if (!sw?.variables_not_in_analysis?.length) return "";
  const last = lastStep(sw.variables_not_in_analysis);
  const vars = last.variables ?? [];
  if (vars.length === 0) return `After the final step (step ${last.step}), all predictors are in the model.`;
  const best = vars[indexOfMax(vars.map((v: any) => v.f_to_enter))];
  return `After the final step (step ${last.step}), ${joinList(vars.map((v: any) => v.variable))} ${vars.length === 1 ? "remains" : "remain"} outside the model. The best remaining candidate, ${best.variable}, has F to Enter = ${formatStat(best.f_to_enter)}, which does not meet the entry criterion.`;
}

/** Generate interpretation for Wilks' Lambda (stepwise, per step) */
export function generateStepwiseWilksDescription(sw: any): string {
  const lambdas: number[] = sw?.wilks_lambda ?? [];
  if (!lambdas.length) return "";
  const first = lambdas[0];
  const final = lambdas[lambdas.length - 1];
  const nonSig = (sw.wilks_exact_sig ?? [])
    .map((p: number, i: number) => (p < ALPHA ? "" : String(i + 1)))
    .filter(Boolean);
  let text = `Wilks' Lambda ${final <= first ? "decreases" : "increases"} from ${formatStat(first)} at step 1 to ${formatStat(final)} at step ${lambdas.length}${
    final < first ? ", which indicates better group separation in the final model" : ""
  }.`;
  text += nonSig.length === 0
    ? " The model is significant at every step (p (Sig.) < .05)."
    : ` The model is not significant at step ${joinList(nonSig)}.`;
  return text;
}

/** Generate interpretation for Pairwise Group Comparisons */
export function generatePairwiseDescription(entries: any[]): string {
  if (!entries?.length) return "";
  const step = lastStep(entries).step;
  const pairs: Array<{ a: string; b: string; f: number; p: number }> = [];
  for (const e of entries.filter((x) => x.step === step)) {
    for (const c of e.comparisons) {
      const [a, b] = [String(e.group), String(c.group_name)].sort(compareGroupLabels);
      if (!pairs.some((x) => x.a === a && x.b === b)) pairs.push({ a, b, f: c.f_value, p: c.significance });
    }
  }
  if (!pairs.length) return "";
  const nonSig = pairs.filter((x) => !(x.p < ALPHA));
  let text =
    nonSig.length === 0
      ? `At the final step (step ${step}), all pairs of groups are significantly different (p (Sig.) < .05).`
      : `At the final step (step ${step}), ${joinList(nonSig.map((x) => `groups ${x.a} and ${x.b}`))} ${nonSig.length === 1 ? "is" : "are"} not significantly different.`;
  if (pairs.length > 1) {
    const closest = pairs[indexOfMin(pairs.map((x) => x.f))];
    text += ` Groups ${closest.a} and ${closest.b} are the closest pair (F = ${formatStat(closest.f)}).`;
  }
  return text;
}

/** Generate interpretation for Eigenvalues */
export function generateEigenvaluesDescription(ed: any): string {
  const eig: number[] = ed?.eigenvalue ?? [];
  if (!eig.length) return "";
  const parts = eig.map(
    (e, i) =>
      `Function ${i + 1} has an eigenvalue of ${formatStat(e)}, explains ${formatPercent(ed.variance_percentage[i])}% of the variance and has a canonical correlation of ${formatStat(ed.canonical_correlation[i])}`,
  );
  const r = ed.canonical_correlation[0];
  return `${parts.join("; ")}. The squared canonical correlation shows that ${formatPercent(r * r * 100)}% of the variance in the Function 1 scores is explained by the groups.`;
}

/** Generate interpretation for Wilks' Lambda (test of functions) */
export function generateWilksTestDescription(wt: any): string {
  const labels: string[] = wt?.test_of_functions ?? [];
  if (!labels.length) return "";
  const stats = `Wilks' Lambda = ${formatStat(wt.wilks_lambda[0])}, χ²(${formatCount(wt.df[0])}) = ${formatStat(wt.chi_square[0])}, ${pText(wt.significance[0])}`;
  let text = `The discriminant functions ${wt.significance[0] < ALPHA ? "significantly separate" : "do not significantly separate"} the groups (${stats}).`;
  if (labels.length > 1) {
    const nSig = wt.significance.filter((p: number) => p < ALPHA).length;
    text += ` ${nSig} of ${labels.length} functions are statistically significant.`;
  }
  return text;
}

/** Generate interpretation for Standardized Canonical Discriminant Function Coefficients */
export function generateStandardizedDescription(coefs: any[]): string {
  if (!coefs?.length) return "";
  const parts = coefs[0].values.map((_: number, f: number) => {
    const top = coefs[indexOfMax(coefs.map((c) => Math.abs(c.values[f])))];
    return `Function ${f + 1} is most strongly influenced by ${top.variable} (${formatStat(top.values[f])})`;
  });
  return `${parts.join("; ")}.`;
}

/** Generate interpretation for Structure Matrix */
export function generateStructureDescription(correlations: any[]): string {
  if (!correlations?.length) return "";
  const nf = correlations[0].values.length;
  const parts: string[] = [];
  for (let f = 0; f < nf; f++) {
    // Variables whose largest absolute correlation is with this function (marked ᵃ in the table).
    const own = correlations.filter((c) => indexOfMax(c.values.map(Math.abs)) === f);
    if (own.length) {
      parts.push(`Function ${f + 1} correlates most with ${joinList(own.map((c) => `${c.variable} (${formatStat(c.values[f])})`))}`);
    }
  }
  return `${parts.join("; ")}.`;
}

/** Generate interpretation for Canonical Discriminant Function Coefficients */
export function generateUnstandardizedDescription(coefs: any[]): string {
  if (!coefs?.length) return "";
  const constant = coefs.find((c) => c.variable === "(Constant)");
  const terms = coefs.filter((c) => c.variable !== "(Constant)");
  const equations = coefs[0].values.map((_: number, f: number) => {
    let eq = `D${f + 1} = ${formatStat(constant?.values[f] ?? 0)}`;
    for (const t of terms) {
      eq += ` ${t.values[f] < 0 ? "−" : "+"} ${formatStat(Math.abs(t.values[f]))} × ${t.variable}`;
    }
    return eq;
  });
  return `The discriminant score of each case is computed as ${equations.join("; ")}.`;
}

/** Generate interpretation for Functions at Group Centroids */
export function generateCentroidsDescription(centroids: any[]): string {
  if (!centroids?.length || centroids.length < 2) return "";
  const parts = centroids[0].values.map((_: number, f: number) => {
    const values = centroids.map((c) => c.values[f]);
    const hi = indexOfMax(values);
    const lo = indexOfMin(values);
    return `Function ${f + 1} separates group ${centroids[hi].group} (${formatStat(values[hi])}) from group ${centroids[lo].group} (${formatStat(values[lo])})`;
  });
  return `${parts.join("; ")}.`;
}

/** Generate interpretation for Prior Probabilities for Groups */
export function generatePriorsDescription(pp: any): string {
  const priors: number[] = pp?.prior_probabilities ?? [];
  if (!priors.length) return "";
  if (priors.every((p) => Math.abs(p - priors[0]) < 1e-9)) {
    return `All groups have the same prior probability (${formatStat(priors[0])}).`;
  }
  const list = pp.groups.map((g: string, i: number) => `group ${g} = ${formatStat(priors[i])}`);
  return `Prior probabilities are computed from the group sizes (${joinList(list)}), so cases are more likely to be assigned to larger groups.`;
}

/** Generate interpretation for Classification Function Coefficients */
export function generateClassificationFunctionsDescription(cfc: any): string {
  if (!cfc?.groups?.length) return "";
  return `There is one classification function for each of the ${cfc.groups.length} groups; a case is assigned to the group whose function gives the highest score.`;
}

/** Generate interpretation for Covariance Matrices of Canonical Discriminant Functions */
export function generateSeparateCovarianceDescription(sep: any): string {
  const groups = sep?.groups ?? [];
  if (groups.length < 2) return "";
  const parts = groups[0].covariance.map((_: number[], f: number) => {
    const variances = groups.map((g: any) => g.covariance[f][f]);
    const hi = indexOfMax(variances);
    const lo = indexOfMin(variances);
    return `the variance of Function ${f + 1} ranges from ${formatStat(variances[lo])} (group ${groups[lo].group}) to ${formatStat(variances[hi])} (group ${groups[hi].group})`;
  });
  return `With separate-groups classification, ${parts.join("; ")}.`;
}

/** Generate interpretation for Casewise Statistics */
export function generateCasewiseDescription(cw: any): string {
  const cases: number[] = cw?.case_number ?? [];
  if (!cases.length) return "";
  const caseList = (list: number[]) => (list.length <= 10 ? `: ${list.join(", ")}` : "");
  const isWrong = (data: any, i: number) =>
    data.actual_group[i] !== "ungrouped" && data.predicted_group[i] !== data.actual_group[i];

  const grouped = cases.filter((_, i) => cw.actual_group[i] !== "ungrouped").length;
  const wrong = cases.filter((_, i) => isWrong(cw, i));
  const atypical = cases.filter((_, i) => cw.highest_group.p_value[i] < ALPHA);

  let text =
    wrong.length === 0
      ? `None of the ${grouped} grouped cases is misclassified.`
      : `${wrong.length} of the ${grouped} grouped cases are misclassified (marked **)${caseList(wrong)}.`;
  if (atypical.length) {
    const verb = atypical.length === 1 ? "case has" : "cases have";
    text += ` ${atypical.length} ${verb} P(D>d | G=g) < .05, meaning they lie far from the centroid of their predicted group${caseList(atypical)}.`;
  }
  if (cw.cross_validated) {
    const cvWrong = cw.cross_validated.case_number.filter((_: number, i: number) => isWrong(cw.cross_validated, i));
    text += ` In cross-validation, ${cvWrong.length} cases are misclassified.`;
  }
  return text;
}

/** Generate interpretation for Classification Results */
export function generateClassificationResultsDescription(cr: any): string {
  if (!cr?.original_classification?.length) return "";
  const groups: string[] = cr.original_classification.map((r: any) => r.group).sort(compareGroupLabels);
  const rowOf = (rows: any[], g: string): number[] => rows.find((r) => r.group === g)?.counts ?? [];
  const hitRatio = (rows: any[]) => {
    const correct = sum(groups.map((g, i) => rowOf(rows, g)[i] ?? 0));
    const total = sum(groups.map((g) => sum(rowOf(rows, g))));
    return total > 0 ? (correct / total) * 100 : 0;
  };

  const hit = hitRatio(cr.original_classification);
  const perGroup = groups.map((g, i) => {
    const row = rowOf(cr.original_classification, g);
    return `group ${g}: ${formatPercent(((row[i] ?? 0) / sum(row)) * 100)}%`;
  });
  let text = `${formatPercent(hit)}% of the original grouped cases were correctly classified (${joinList(perGroup)}).`;

  // Proportional chance criterion: the sum of the squared group proportions.
  const sizes = groups.map((g) => sum(rowOf(cr.original_classification, g)));
  const chance = sum(sizes.map((n) => (n / sum(sizes)) ** 2)) * 100;
  text += ` This is ${hit > chance ? "above" : "not above"} the proportional chance criterion of ${formatPercent(chance)}%.`;

  if (cr.cross_validated_classification) {
    text += ` Cross-validation correctly classified ${formatPercent(hitRatio(cr.cross_validated_classification))}% of the cases.`;
  }
  if (cr.unselected_classification?.length) {
    text += ` Among the unselected (testing) cases, ${formatPercent(hitRatio(cr.unselected_classification))}% were correctly classified.`;
  }
  return text;
}

/** Generate interpretation for Bootstrap for Standardized Coefficients */
export function generateBootstrapDescription(b: any): string {
  if (!b?.standardized?.length) return "";
  const parts = b.standardized[0].original.map((_: number, f: number) => {
    const significant = b.standardized
      .filter((e: any) => e.ci_lower[f] > 0 || e.ci_upper[f] < 0)
      .map((e: any) => e.variable);
    return `Function ${f + 1}: ${significant.length ? joinList(significant) : "none"}`;
  });
  return `Based on ${b.valid_samples ?? b.num_samples} bootstrap samples, the coefficients whose ${b.level ?? 95}% confidence interval excludes 0 (significant) are: ${parts.join("; ")}.`;
}

/** Generate the interpretation of every table in the result, keyed by table key. */
export function interpretDiscriminantResult(data: any): Record<string, string> {
  if (!data) return {};
  const sw = data.stepwise_statistics;
  const sep = data.separate_groups_classification;
  const predictors = data.equality_tests?.variables ?? data.pooled_matrices?.variables ?? data.group_statistics?.variables ?? [];

  const generators: Record<string, () => string> = {
    assumption_summary: () => generateAssumptionSummaryDescription(data.assumption_results?.summary),
    assumption_multicollinearity: () => generateMulticollinearityDescription(data.assumption_results?.multicollinearity),
    assumption_multivariate_normality: () => generateMultivariateNormalityDescription(data.assumption_results?.multivariate_normality),
    assumption_univariate_normality: () => generateUnivariateNormalityDescription(data.assumption_results?.univariate_normality),
    log_determinants: () => generateLogDeterminantsDescription(data.log_determinants),
    box_m_test: () => generateBoxMDescription(data.box_m_test),
    processing_summary: () => generateProcessingSummaryDescription(data.processing_summary),
    group_statistics: () => generateGroupStatisticsDescription(data.group_statistics),
    equality_tests: () => generateEqualityTestsDescription(data.equality_tests),
    pooled_covariance_matrix: () => generatePooledCovarianceDescription(data.pooled_matrices),
    pooled_correlation_matrix: () => generatePooledCorrelationDescription(data.pooled_matrices),
    covariance_matrices: () => generateCovarianceMatricesDescription(data.covariance_matrices),
    stepwise_statistics: () => generateStepwiseDescription(sw, predictors),
    variables_in_analysis: () => generateVariablesInDescription(sw),
    variables_not_in_analysis: () => generateVariablesNotInDescription(sw),
    stepwise_wilks_lambda: () => generateStepwiseWilksDescription(sw),
    pairwise_group_comparisons: () => generatePairwiseDescription(sw?.pairwise_comparisons),
    eigenvalues: () => generateEigenvaluesDescription(data.eigen_description),
    wilks_lambda_test: () => generateWilksTestDescription(data.wilks_lambda_test),
    standardized_coefficients: () => generateStandardizedDescription(data.canonical_functions?.standardized_coefficients),
    structure_matrix: () => generateStructureDescription(data.structure_matrix?.correlations),
    canonical_discriminant_function_coefficients: () => generateUnstandardizedDescription(data.canonical_functions?.coefficients),
    functions_at_group_centroids: () => generateCentroidsDescription(data.canonical_functions?.function_at_centroids),
    prior_probabilities: () => generatePriorsDescription(data.prior_probabilities),
    classification_function_coefficients: () => generateClassificationFunctionsDescription(data.classification_function_coefficients),
    classification_processing_summary: () => generateClassificationProcessingDescription(data.processing_summary),
    separate_groups_covariance_matrices: () => generateSeparateCovarianceDescription(sep),
    separate_groups_log_determinants: () => generateLogDeterminantsDescription(sep?.log_determinants),
    separate_groups_box_m_test: () => generateBoxMDescription(sep?.box_m_test, true),
    casewise_statistics: () => generateCasewiseDescription(data.casewise_statistics),
    classification_results: () => generateClassificationResultsDescription(data.classification_results),
    bootstrap_standardized_coefficients: () => generateBootstrapDescription(data.bootstrap_results),
  };

  const result: Record<string, string> = {};
  for (const [key, generate] of Object.entries(generators)) {
    try {
      const text = generate();
      if (text) result[key] = text;
    } catch (error) {
      console.error(`[Discriminant] Could not generate the description of ${key}:`, error);
    }
  }
  return result;
}
