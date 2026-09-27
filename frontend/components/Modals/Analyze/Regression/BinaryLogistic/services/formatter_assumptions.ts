import type { LogisticResult, AnalysisSection } from "../types/binary-logistic";
import { createSection, safeFixed, fmtSig, fmtPSig } from "./formatter_utils";

// Single-reference decision threshold for collinearity (see VIF hypothesis
// note below for the full citation). Kept as one constant so the table
// title, legend, description and hypothesis note can't drift out of sync.
const VIF_THRESHOLD = 10;

// Decision rule tested by the VIF/GVIF table, shown once alongside the
// results. This is a diagnostic decision rule, not an inferential
// significance test (there is no sampling distribution/p-value for VIF),
// but it is phrased as H0/H1 to match how collinearity is conventionally
// reported in the literature and stated per Hair et al. (2010), the most
// widely used single reference for this cutoff.
const getVifHypothesisNote = (isGvif: boolean): string => {
  const base =
    "H0: no serious multicollinearity among predictors (Tolerance > 0.10, equivalently VIF < 10).";
  if (!isGvif) return base;
  return (
    base +
    "\nFor predictors with 3+ categories, the equivalent cutoff on the adjusted GVIF^(1/(2·Df)) scale is √10 ≈ 3.16, following the scaling convention in Fox, J., & Monette, G. (1992)."
  );
};

// Helper untuk menentukan Concern Level berdasarkan nilai VIF.
// When the table is on the GVIF^(1/(2*Df)) scale (any term has df > 1),
// the threshold is sqrt-adjusted (VIF>=10 <=> GVIF^(1/(2*Df)) >= sqrt(10)),
// the standard adaptation since that value is already a square-root-scaled
// quantity - comparing it against the raw VIF threshold would understate
// collinearity for every variable in the table, not just the multi-df ones.
const getConcernLevel = (vif: number, isGvif?: boolean): string => {
  const threshold = isGvif ? Math.sqrt(VIF_THRESHOLD) : VIF_THRESHOLD;
  return vif >= threshold ? "Problematic" : "Acceptable";
};

// Helper untuk membuat deskripsi dinamis VIF
const generateAssumptionDescription = (vifData: any[]): string => {
  const isGvif = vifData.some((r) => r.is_gvif);
  const metricLabel = isGvif ? "GVIF^(1/2Df)" : "VIF";
  const threshold = isGvif ? Math.sqrt(VIF_THRESHOLD) : VIF_THRESHOLD;
  const problematic = vifData.filter((r) => r.vif >= threshold);
  if (problematic.length > 0) {
    const vars = problematic
      .map((r) => `${r.variable} (${metricLabel}=${safeFixed(r.vif)})`)
      .join(", ");
    return `H0 is rejected for: ${vars}. These variable(s) have ${metricLabel} values at or above ${safeFixed(threshold, 2)}, indicating a multicollinearity problem serious enough to distort their coefficient estimates and standard errors.`;
  }
  return `H0 is not rejected for any predictor (all ${metricLabel} values are below ${safeFixed(threshold, 2)}) — no serious multicollinearity problem is indicated.`;
};

// Helper untuk membuat deskripsi dinamis Box-Tidwell
// References: Box & Tidwell (1962), Fox (1997), Fox & Weisberg (2011)
const generateBoxTidwellDescription = (boxTidwellData: any[]): string => {
  if (!boxTidwellData || boxTidwellData.length === 0) return "";

  const testedVars = boxTidwellData.filter((row: any) => !row.skipped);
  const skippedVars = boxTidwellData.filter((row: any) => row.skipped);

  const parts: string[] = [];

  if (testedVars.length > 0) {
    const violatedVars = testedVars.filter((row: any) => row.is_significant);
    if (violatedVars.length > 0) {
      const details = violatedVars
        .map((v: any) => `${v.variable} (z=${safeFixed(v.score_z ?? 0, 3)}, ${fmtPSig(v.sig)})`)
        .join(", ");
      parts.push(
        `H0 rejected (linearity assumption violated) for: ${details}. ` +
          `A significant interaction term (X·ln(X)) indicates that the relationship between this predictor and the logit is not linear. ` +
          `Consider applying a power/log transformation or treating these variables as categorical.`
      );
    } else {
      parts.push(
        "H0 not rejected for any tested predictor (all p (Sig.) > .05), " +
          "consistent with a linear relationship between each continuous predictor and the logit."
      );
    }
  }

  if (skippedVars.length > 0) {
    const skippedNames = skippedVars.map((v: any) => v.variable).join(", ");
    parts.push(
      `Note: ${skippedVars.length} variable(s) were excluded (${skippedNames}). ` +
        `The Box-Tidwell test only applies to continuous predictors with sufficient variation.`
    );
  }

  if (parts.length === 0) {
    parts.push(
      "No continuous predictors were eligible for the Box-Tidwell test."
    );
  }

  return parts.join(" ");
};

export const formatAssumptionTests = (
  result: LogisticResult,
): { sections: AnalysisSection[] } => {
  const sections: AnalysisSection[] = [];
  const assumptions = result.assumption_tests;

  if (!assumptions) return { sections };

  // --- 1. Variance Inflation Factors (VIF) ---
  // (No separate raw predictor Correlation Matrix here - redundant with
  // the Correlation of Estimates table already shown in Block 1, and VIF/
  // GVIF already covers multicollinearity more directly.)
  if (assumptions.vif && assumptions.vif.length > 0) {
    // When any predictor has df > 1 (a 3+ category factor), R's car::vif()
    // switches its WHOLE table to 3 columns - GVIF, Df, GVIF^(1/(2*Df)) -
    // for every row, single-df terms included, so the scale stays
    // comparable across the table rather than mixing raw VIF and GVIF
    // units. Mirrored here, in that column order.
    const isGvif = assumptions.vif.some((row) => row.is_gvif);
    const adjHeader = "GVIF^(1/2Df)"; // cleaner than R's literal "GVIF^(1/(2*Df))"

    const vifColumnHeaders: any[] = [
      { header: "Variable", key: "var" },
      { header: "Tolerance", key: "tol" },
    ];
    if (isGvif) {
      vifColumnHeaders.push(
        { header: "GVIF", key: "gvif" },
        { header: "Df", key: "df" },
        { header: adjHeader, key: "vif" },
      );
    } else {
      vifColumnHeaders.push({ header: "VIF", key: "vif" });
    }
    vifColumnHeaders.push({ header: "Concern Level", key: "concern" });

    const vifData = {
      columnHeaders: vifColumnHeaders,
      rows: assumptions.vif.map((row) => ({
        rowHeader: [row.variable],
        var: row.variable,
        tol: safeFixed(row.tolerance),
        gvif: safeFixed(row.gvif ?? row.vif),
        vif: safeFixed(row.vif),
        df: (row.df ?? 1).toString(),
        concern: getConcernLevel(row.vif, row.is_gvif),
      })),
    };

    // Buat Deskripsi Dinamis VIF
    const dynamicDesc = generateAssumptionDescription(assumptions.vif);

    sections.push(
      createSection(
        "assumption_vif",
        // Table title must track the metric actually reported: GVIF once any
        // predictor has df > 1, plain VIF otherwise.
        isGvif ? "Collinearity Statistics (GVIF)" : "Collinearity Statistics (VIF)",
        vifData,
        {
          note: getVifHypothesisNote(isGvif),
          description: isGvif
            ? `${dynamicDesc} Note: one or more predictors are categorical with 3+ categories, so this table reports Generalized VIF (GVIF) instead of the standard VIF, adjusted for degrees of freedom (${adjHeader}) alongside the raw GVIF with the adjusted column comparable across all variables regardless of df.`
            : dynamicDesc,
        },
      ),
    );

    // --- 2. Legend VIF ---
    // Single reference (Hair et al., 2010) instead of the previously
    // unattributed 4-tier scale, per feedback that mixed conventions across
    // sources caused inconsistent interpretation. Range is sqrt-adjusted to
    // match the GVIF^(1/2Df) scale when applicable.
    const fmtRange = (n: number) => safeFixed(isGvif ? Math.sqrt(n) : n, isGvif ? 2 : 0);
    const legendData = {
      columnHeaders: [
        { header: "Criterion", key: "level" },
        { header: `${isGvif ? adjHeader : "VIF"} Range`, key: "range" },
        { header: "Tolerance Range", key: "tol" },
        { header: "Interpretation", key: "interp" },
      ],
      rows: [
        {
          rowHeader: ["Acceptable"],
          level: "Acceptable (H0 not rejected)",
          range: `< ${fmtRange(VIF_THRESHOLD)}`,
          tol: "> 0.10",
          interp: "No serious multicollinearity problem.",
        },
        {
          rowHeader: ["Problematic"],
          level: "Problematic (H0 rejected)",
          range: `≥ ${fmtRange(VIF_THRESHOLD)}`,
          tol: "≤ 0.10",
          interp: "Multicollinearity problem indicated; coefficient estimates and standard errors may be unstable.",
        },
      ],
    };

    sections.push(
      createSection(
        "assumption_vif_legend",
        isGvif ? "GVIF Interpretation Guide" : "VIF Interpretation Guide",
        legendData,
        {
          description:
            "Single-reference decision criterion for interpreting collinearity statistics (Hair, Black, Babin, & Anderson, 2010, Multivariate Data Analysis, 7th ed.).",
        },
      ),
    );
  }

  // --- 3. Box-Tidwell Test (R-style output: Fox & Weisberg 2011) ---
  if (assumptions.box_tidwell && assumptions.box_tidwell.length > 0) {
    // Separate tested vs skipped for cleaner output
    const testedRows = assumptions.box_tidwell.filter(
      (row: any) => !row.skipped
    );
    const skippedRows = assumptions.box_tidwell.filter(
      (row: any) => row.skipped
    );

    // --- Main results table (matches R's car::boxTidwell output) ---
    if (testedRows.length > 0) {
      const btData = {
        columnHeaders: [
          { header: "Variable", key: "var" },
          { header: "Interaction Term", key: "interaction" },
          { header: "B", key: "b" },
          { header: "S.E.", key: "se" },
          { header: "Score Statistic (z)", key: "score_z" },
          { header: "df", key: "df" },
          { header: "Sig.", key: "sig" },
        ],
        rows: testedRows.map((row: any) => {
          const sig = row.sig ?? 1.0;

          return {
            rowHeader: [row.variable],
            var: row.variable,
            interaction: row.interaction_term || `${row.variable} × ln(${row.variable})`,
            b: safeFixed(row.b_interaction ?? 0),
            se: safeFixed(row.se_interaction ?? 0),
            score_z: safeFixed(row.score_z ?? 0),
            df: String(row.df ?? 1),
            sig: fmtSig(sig),
          };
        }),
      };

      const btDescription = generateBoxTidwellDescription(
        assumptions.box_tidwell
      );

      sections.push(
        createSection(
          "assumption_box_tidwell",
          "Box-Tidwell Test for Linearity of the Logit",
          btData,
          {
            note:
              "H0: the relationship between the predictor and the logit is linear (the coefficient of the X·ln(X) interaction term equals 0).",
            description: btDescription,
          }
        )
      );
    }

    // --- Skipped variables table ---
    if (skippedRows.length > 0) {
      const skippedData = {
        columnHeaders: [
          { header: "Variable", key: "var" },
          { header: "Reason", key: "reason" },
          { header: "Note", key: "note" },
        ],
        rows: skippedRows.map((row: any) => ({
          rowHeader: [row.variable],
          var: row.variable,
          reason: row.skip_reason || "Not Applicable",
          note: row.note || "",
        })),
      };

      sections.push(
        createSection(
          "assumption_box_tidwell_excluded",
          "Variables Excluded from Box-Tidwell Test",
          skippedData,
          {
            description:
              "The following variables were excluded because the Box-Tidwell test only applies to continuous predictors with sufficient variation.",
          }
        )
      );
    }
  }

  return { sections };
};
