import { AnalysisSection } from "../types/ordinal";
import { OrdinalFormatterContext } from "./formatter_context";
import { createSection, fmtSig, safeFixed } from "./formatter_utils";

export const formatCaseProcessingSummary = (
  context: OrdinalFormatterContext
): AnalysisSection[] => {
  const { result, wantSummaryStatistics } = context;
  if (!wantSummaryStatistics || !result.summaryStatistics || !result.metadata?.caseProcessingSummary) {
    return [];
  }

  const summary = result.metadata.caseProcessingSummary;
  const total = Number(summary.totalN ?? 0);
  const valid = Number(summary.validN ?? 0);
  const missing = Number(summary.missingN ?? Math.max(0, total - valid));
  const totalSafe = total > 0 ? total : valid + missing;
  const variableLabel = summary.variableLabel || "Ordinal Regression";
  const formatPercent = (fraction: number) =>
    Number.isFinite(fraction) ? `${(fraction * 100).toFixed(1)}%` : "0.0%";
  const nToPercent = (n: number) => valid > 0 ? n / valid : 0;

  const rows = Array.isArray(summary.categories)
    ? summary.categories.map((category: any) => ({
      rowHeader: [variableLabel, String(category.label ?? "")],
      n: Number(category.n ?? 0),
      percent: formatPercent(
        typeof category.percent === "number" ? category.percent : nToPercent(Number(category.n ?? 0))
      ),
    }))
    : [];

  if (Array.isArray(summary.factors)) {
    for (const factor of summary.factors) {
      const factorLabel = factor.variableLabel || factor.variableName || "Factor";
      if (!Array.isArray(factor.levels)) continue;

      factor.levels.forEach((level: any) => {
        const n = Number(level.n ?? 0);
        rows.push({
          rowHeader: [factorLabel, String(level.label ?? level.value ?? "")],
          n,
          percent: formatPercent(
            typeof level.percent === "number" ? level.percent : nToPercent(n)
          ),
        });
      });
    }
  }

  rows.push({
    rowHeader: ["Overall", "Valid"],
    n: valid,
    percent: formatPercent(totalSafe > 0 ? valid / totalSafe : 0),
  });
  rows.push({
    rowHeader: ["Overall", "Missing"],
    n: missing,
    percent: formatPercent(totalSafe > 0 ? missing / totalSafe : 0),
  });
  rows.push({
    rowHeader: ["Overall", "Total"],
    n: totalSafe,
    percent: "100.0%",
  });

  return [
    createSection(
      "ordinal_case_processing_summary",
      "Case Processing Summary",
      {
        columnHeaders: [
          { header: "N", key: "n" },
          { header: "Percent", key: "percent" },
        ],
        rows,
      },
      {
        description: "Ringkasan jumlah kasus valid dan missing dalam analisis.",
      }
    ),
  ];
};

export const formatModelFittingInformation = (
  context: OrdinalFormatterContext
): AnalysisSection[] => {
  const { result, wantSummaryStatistics, linkFunctionNote } = context;
  if (!wantSummaryStatistics || !result.summaryStatistics) {
    return [];
  }

  const sumStats = result.summaryStatistics;
  const model = sumStats.model;
  const interceptOnly = sumStats.interceptOnly;
  const modelChiSquare = sumStats.modelChiSquare;

  if (!model || !interceptOnly || !modelChiSquare) {
    return [];
  }

  return [
    createSection(
      "ordinal_model_fitting_information",
      "Model Fitting Information",
      {
        columnHeaders: [
          { header: "Model", key: "rh1" },
          { header: "-2 Log Likelihood", key: "neg2ll" },
          { header: "Chi-Square", key: "chiSquare" },
          { header: "df", key: "df" },
          { header: "Sig.", key: "sig" },
        ],
        rows: [
          {
            rowHeader: ["Intercept Only"],
            neg2ll: safeFixed(interceptOnly.minus2LogLikelihood),
            chiSquare: ".",
            df: ".",
            sig: ".",
          },
          {
            rowHeader: ["Final"],
            neg2ll: safeFixed(model.minus2LogLikelihood),
            chiSquare: safeFixed(modelChiSquare.chiSquare),
            df: safeFixed(modelChiSquare.df, 0),
            sig: fmtSig(modelChiSquare.sig),
          },
        ],
      },
      {
        description: "Uji Simultan dengan H₀ menyatakan semua variabel independen tidak berpengaruh terhadap variabel dependen. Tolak H₀ jika nilai Sig. < α (0.05). ",
        note: linkFunctionNote,
      }
    ),
  ];
};

export const formatGoodnessOfFit = (
  context: OrdinalFormatterContext
): AnalysisSection[] => {
  const { result, wantGoodnessOfFit, linkFunctionNote } = context;
  if (!wantGoodnessOfFit || !result.goodnessOfFit) {
    return [];
  }

  const pearson = result.goodnessOfFit.pearson;
  const deviance = result.goodnessOfFit.deviance;
  if (!pearson || !deviance) {
    return [];
  }

  return [
    createSection(
      "ordinal_goodness_of_fit",
      "Goodness-of-Fit",
      {
        columnHeaders: [
          { header: "", key: "rh1" },
          { header: "Chi-Square", key: "chiSquare" },
          { header: "df", key: "df" },
          { header: "Sig.", key: "sig" },
        ],
        rows: [
          {
            rowHeader: ["Pearson"],
            chiSquare: safeFixed(pearson.chiSquare),
            df: safeFixed(pearson.df, 0),
            sig: fmtSig(pearson.sig),
          },
          {
            rowHeader: ["Deviance"],
            chiSquare: safeFixed(deviance.chiSquare),
            df: safeFixed(deviance.df, 0),
            sig: fmtSig(deviance.sig),
          },
        ],
      },
      {
        description: "Uji Kesesuaian Model dengan H₀ menyatakan model cocok dengan data (hasil observasi sesuai dengan prediksi). Terima H₀ jika nilai Sig. > α (0.05).",
        note: linkFunctionNote,
      }
    ),
  ];
};

export const formatPseudoRSquare = (
  context: OrdinalFormatterContext
): AnalysisSection[] => {
  const { result, wantSummaryStatistics, linkFunctionNote } = context;
  const pseudo = result.summaryStatistics?.pseudoRSquare;
  if (!wantSummaryStatistics || !pseudo) {
    return [];
  }

  return [
    createSection(
      "ordinal_pseudo_r_square",
      "Pseudo R-Square",
      {
        columnHeaders: [
          { header: "Pseudo R-Square", key: "rh1" },
          { header: "Value", key: "value" },
        ],
        rows: [
          {
            rowHeader: ["Cox and Snell"],
            value: safeFixed(pseudo.coxSnell),
          },
          {
            rowHeader: ["Nagelkerke"],
            value: safeFixed(pseudo.nagelkerke),
          },
          {
            rowHeader: ["McFadden"],
            value: safeFixed(pseudo.mcfadden),
          },
        ],
      },
      {
        description: "Koefisien Pseudo R-Square mengukur proporsi seberapa besar variabel independen dapat menjelaskan variabel dependen dalam model.",
        note: linkFunctionNote,
      }
    ),
  ];
};
