import { transformDiscriminantResult } from "@/components/Modals/Analyze/Classify/discriminant/services/formatter";
import { comparisonDecimals } from "@/components/Modals/Analyze/Classify/discriminant/services/discriminant-number-format";
import { useResultStore } from "@/stores/useResultStore";
import type { Table } from "@/types/Table";

// Output formatted in precision mode (see discriminant-number-format.ts) says so in
// its title, so it is never mistaken for the normal SPSS-style output.
function withPrecisionNote(title: string): string {
    const decimals = comparisonDecimals();
    return decimals ? `${title} (precision mode: ${decimals} decimals)` : title;
}

// Plain-language, one-line interpretation per table, shown in the section
// "Description". Assumption tables (and Box's M) are intentionally omitted —
// their dynamic footer note already is the interpretation.
const TABLE_INTERPRETATIONS: Record<string, string> = {
    processing_summary:
        "How many cases were valid and how many were excluded from the analysis.",
    group_statistics:
        "Mean and standard deviation of each predictor within each group, with the case count per group.",
    equality_tests:
        "Tests whether each predictor's mean differs across groups. A small Sig. (< 0.05) means the predictor separates the groups well.",
    pooled_covariance_matrix:
        "Within-groups covariances pooled across groups — the common spread used to fit the discriminant functions.",
    pooled_correlation_matrix:
        "Within-groups correlations between predictors, pooled across groups.",
    covariance_matrices:
        "Covariance of the predictors computed separately for each group.",
    log_determinants:
        "Log determinant of each group's covariance matrix; large differences suggest unequal covariances (tested by Box's M).",
    stepwise_statistics:
        "The variable entered (or removed) at each step of the stepwise selection.",
    variables_in_analysis:
        "Statistics for the variables already in the model at each step.",
    variables_not_in_analysis:
        "Statistics for the variables not yet in the model, showing which could enter next.",
    stepwise_wilks_lambda:
        "Wilks' Lambda after each step; smaller values mean better group separation.",
    pairwise_group_comparisons:
        "F test of the distance between each pair of group centroids at each step. A small Sig. (< 0.05) means the two groups are significantly separated.",
    eigenvalues:
        "Each discriminant function's eigenvalue and the share of between-group variance it explains.",
    wilks_lambda_test:
        "Tests the significance of the discriminant functions. A small Sig. (< 0.05) means they separate the groups.",
    standardized_coefficients:
        "Standardized weights showing each predictor's relative contribution to each function.",
    structure_matrix:
        "Correlations between each predictor and the functions; larger absolute values show a stronger link.",
    canonical_discriminant_function_coefficients:
        "Unstandardized weights used to compute each case's discriminant score.",
    functions_at_group_centroids:
        "Average discriminant score of each group — the group centers in discriminant space.",
    prior_probabilities:
        "Prior probability assumed for each group before classification, with the cases used.",
    classification_function_coefficients:
        "Fisher's classification coefficients; each case is assigned to the group with the highest score.",
    classification_processing_summary:
        "How many cases were processed and used in the classification step.",
    separate_groups_covariance_matrices:
        "Each group's covariance matrix of the discriminant scores. With the Separate-groups option these matrices, not the pooled one, are used to classify the cases.",
    separate_groups_log_determinants:
        "Log determinant of each group's covariance matrix of the discriminant functions; it enters the Separate-groups classification rule.",
    separate_groups_box_m_test:
        "Tests whether the groups' covariance matrices of the discriminant functions are equal. A small Sig. (< 0.05) supports classifying with separate-groups matrices.",
    casewise_statistics:
        "Per-case results: actual vs predicted group and the discriminant scores. ** marks a misclassified case.",
    classification_results:
        "Confusion matrix of actual vs predicted groups; the note gives the overall percent correctly classified.",
    bootstrap_standardized_coefficients:
        "Bootstrap bias, standard error, and confidence interval for each standardized coefficient.",
};

// Escape text so it is safe to embed in the HTML the Description editor expects
// (several notes contain "<", e.g. "VIF < 10").
function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Build the section Description (an interpretation plus every footnote) and a
// copy of the table with its footer + footnote rows stripped out, so footnotes
// show only once — in the Description.
function buildSectionDescription(
    table: Table,
    key: string,
): { description: string; cleaned: Table } {
    const parts: string[] = [];

    const base = TABLE_INTERPRETATIONS[key];
    if (base) parts.push(base);

    const footer = (table as Table & { footer?: string }).footer;
    if (typeof footer === "string" && footer.length > 0) parts.push(footer);

    // Footnote/caption rows carry only a single text rowHeader and no data cells.
    const dataRows: Table["rows"] = [];
    for (const row of table.rows) {
        const rh = (row as { rowHeader?: unknown }).rowHeader;
        const otherKeys = Object.keys(row).filter((k) => k !== "rowHeader");
        const isFootnote =
            otherKeys.length === 0 &&
            Array.isArray(rh) &&
            rh.length === 1 &&
            typeof rh[0] === "string";
        if (isFootnote) {
            parts.push(rh[0] as string);
        } else {
            dataRows.push(row);
        }
    }

    const { footer: _omit, ...rest } = table as Table & { footer?: string };
    const cleaned = { ...rest, rows: dataRows } as Table;

    const description =
        parts.length > 0
            ? parts.map((p) => `<p>${escapeHtml(p)}</p>`).join("")
            : "";

    return { description, cleaned };
}

// Output groups. Every table/plot of one run is saved as a statistic under a
// single analytic; `components` carries the group name, so the result sidebar
// shows one "Discriminant Analysis" entry that expands into these groups (same
// layout as Binary Logistic Regression).
const GROUP_ASSUMPTIONS = "Assumption Checks";
const GROUP_DATA = "Data & Group Description";
const GROUP_COVARIANCE = "Within-Groups Covariance";
const GROUP_STEPWISE = "Stepwise Statistics";
const GROUP_FUNCTIONS = "Summary of Canonical Discriminant Functions";
const GROUP_CLASSIFICATION = "Classification Statistics";
const GROUP_PLOTS = "Plots";
const GROUP_BOOTSTRAP = "Bootstrap";

const ASSUMPTION_SECTIONS = [
    { key: "assumption_summary", title: "Assumption Checks Summary" },
    { key: "assumption_multicollinearity", title: "Multicollinearity (Tolerance and VIF)" },
    { key: "assumption_multivariate_normality", title: "Multivariate Normality within Groups (Henze-Zirkler Test)" },
    { key: "assumption_univariate_normality", title: "Univariate Normality within Groups (Anderson-Darling)" },
];

// Save one formatted table as a statistic under the given analytic. Shared by
// the full-analysis save and the on-demand assumption-checks save.
async function renderDiscriminantSection(
    tables: Table[],
    analyticId: number,
    key: string,
    title: string,
    component: string,
) {
    const { addStatistic } = useResultStore.getState();
    const tableObj = tables.find((t: Table) => t.key === key);
    if (!tableObj) return;

    const { description, cleaned } = buildSectionDescription(tableObj, key);

    // The table title is the only visible heading for the table (the
    // component header shows the group name), so carry the section title in.
    await addStatistic(analyticId, {
        title,
        description: description || title,
        output_data: JSON.stringify({ tables: [{ ...cleaned, title }] }),
        components: component,
    });
}

export async function saveDiscriminantResult(rawResults: unknown) {
    const formattedResult = transformDiscriminantResult(rawResults);
    const { addLog, addAnalytic, addStatistic } = useResultStore.getState();

    const logId = await addLog({ log: "Discriminant Analysis" });
    const analyticId = await addAnalytic(logId, {
        title: withPrecisionNote("Discriminant Analysis"),
        note: "",
    });

    const renderSection = (key: string, title: string, group: string) =>
        renderDiscriminantSection(formattedResult.tables, analyticId, key, title, group);

    // Output order follows the actual workflow of a discriminant analysis so the
    // reader can follow each step from assumptions → data → model → classification.
    const sections = [
        // ── Assumption checks (run first, before fitting anything) ──
        // Order: multicollinearity → multivariate normality → univariate
        // normality → homogeneity of covariance (Log Determinants feed Box's M).
        ...ASSUMPTION_SECTIONS.map((s) => ({ ...s, group: GROUP_ASSUMPTIONS })),
        { key: "log_determinants", title: "Log Determinants", group: GROUP_ASSUMPTIONS },
        { key: "box_m_test", title: "Box's M Test Results", group: GROUP_ASSUMPTIONS },

        // ── 1. Data & group description ──
        { key: "processing_summary", title: "Analysis Case Processing Summary", group: GROUP_DATA },
        { key: "group_statistics", title: "Group Statistics", group: GROUP_DATA },
        { key: "equality_tests", title: "Tests of Equality of Group Means", group: GROUP_DATA },

        // ── 2. Within-groups covariance structure ──
        { key: "pooled_covariance_matrix", title: "Pooled Within-Groups Covariance Matrix", group: GROUP_COVARIANCE },
        { key: "pooled_correlation_matrix", title: "Pooled Within-Groups Correlation Matrix", group: GROUP_COVARIANCE },
        { key: "covariance_matrices", title: "Covariance Matrices", group: GROUP_COVARIANCE },

        // ── 3. Stepwise variable selection (stepwise method only) ──
        { key: "stepwise_statistics", title: "Variables Entered/Removed", group: GROUP_STEPWISE },
        { key: "variables_in_analysis", title: "Variables in the Analysis", group: GROUP_STEPWISE },
        { key: "variables_not_in_analysis", title: "Variables Not in the Analysis", group: GROUP_STEPWISE },
        { key: "stepwise_wilks_lambda", title: "Wilks' Lambda (Stepwise)", group: GROUP_STEPWISE },
        { key: "pairwise_group_comparisons", title: "Pairwise Group Comparisons", group: GROUP_STEPWISE },

        // ── 4. Discriminant functions (the fitted model) ──
        { key: "eigenvalues", title: "Eigenvalues", group: GROUP_FUNCTIONS },
        { key: "wilks_lambda_test", title: "Wilks' Lambda", group: GROUP_FUNCTIONS },

        // ── 5. Function coefficients & interpretation ──
        { key: "standardized_coefficients", title: "Standardized Canonical Discriminant Function Coefficients", group: GROUP_FUNCTIONS },
        { key: "structure_matrix", title: "Structure Matrix", group: GROUP_FUNCTIONS },
        { key: "canonical_discriminant_function_coefficients", title: "Canonical Discriminant Function Coefficients", group: GROUP_FUNCTIONS },
        { key: "functions_at_group_centroids", title: "Functions at Group Centroids", group: GROUP_FUNCTIONS },

        // ── 6. Classification ──
        { key: "prior_probabilities", title: "Prior Probabilities for Groups", group: GROUP_CLASSIFICATION },
        { key: "classification_function_coefficients", title: "Classification Function Coefficients", group: GROUP_CLASSIFICATION },
        { key: "classification_processing_summary", title: "Classification Processing Summary", group: GROUP_CLASSIFICATION },
        // Separate-groups covariance matrix only (Classify → Use Covariance Matrix).
        { key: "separate_groups_covariance_matrices", title: "Covariance Matrices of Canonical Discriminant Functions", group: GROUP_CLASSIFICATION },
        { key: "separate_groups_log_determinants", title: "Log Determinants (Canonical Discriminant Functions)", group: GROUP_CLASSIFICATION },
        { key: "separate_groups_box_m_test", title: "Box's M Test Results (Canonical Discriminant Functions)", group: GROUP_CLASSIFICATION },
        { key: "casewise_statistics", title: "Casewise Statistics", group: GROUP_CLASSIFICATION },
        { key: "classification_results", title: "Classification Results", group: GROUP_CLASSIFICATION },
    ];

    for (const section of sections) {
        await renderSection(section.key, section.title, section.group);
    }

    // ── 7. Discriminant-space plots (visualize the fitted functions) ──
    const scatterCharts = formattedResult.charts ?? [];

    const combinedChart = scatterCharts.find(
        (c: any) => c.chartMetadata?.description === "Combined-Groups Plot"
    );
    // With a single discriminant function the plots are histograms of the
    // Function 1 scores (as in SPSS) instead of scatterplots.
    if (combinedChart) {
        await addStatistic(analyticId, {
            title: "Combined-Groups Plot",
            description:
                combinedChart.chartType === "Stacked Histogram"
                    ? "<p>There is only one discriminant function, so this is a histogram instead of a scatterplot: the Function 1 scores of all cases, stacked by group. Little overlap between the groups' bars indicates good discrimination.</p>"
                    : "<p>Each case plotted on the first two discriminant functions, colored by group, with the group centroids (★). Tight, well-separated clusters indicate good discrimination.</p>",
            output_data: JSON.stringify({ charts: [combinedChart] }),
            components: GROUP_PLOTS,
        });
    }

    const separateCharts = scatterCharts.filter(
        (c: any) => (c.chartMetadata?.description as string)?.startsWith("Separate-Groups Plot:")
    );
    if (separateCharts.length > 0) {
        await addStatistic(analyticId, {
            title: "Separate-Groups Plots",
            description:
                separateCharts[0].chartType === "Histogram"
                    ? "<p>There is only one discriminant function, so each group gets a histogram of its Function 1 scores, with the group's mean, standard deviation and N. Useful for spotting outliers or spread within a group.</p>"
                    : "<p>One plot per group showing only that group's cases on the discriminant functions, with its centroid (★). Useful for spotting outliers or spread within a group.</p>",
            output_data: JSON.stringify({ charts: separateCharts }),
            components: GROUP_PLOTS,
        });
    }

    const territorialChart = scatterCharts.find(
        (c: any) => c.chartMetadata?.description === "Territorial Map"
    );
    if (territorialChart) {
        await addStatistic(analyticId, {
            title: "Territorial Map",
            description:
                "<p>The discriminant space (Function 1 × Function 2) split into classification regions: each region is shaded by the group a case there would be assigned to, and ★ marks the group centroids. Clear, well-separated regions indicate strong discrimination.</p>",
            output_data: JSON.stringify({ charts: [territorialChart] }),
            components: GROUP_PLOTS,
        });
    }

    // ── 8. Bootstrap robustness check (enter-together method only) — rendered
    // last as an optional add-on to the fitted model. ──
    await renderSection(
        "bootstrap_standardized_coefficients",
        "Bootstrap for Standardized Canonical Discriminant Function Coefficients",
        GROUP_BOOTSTRAP,
    );
}

// On-demand save of just the assumption checks, triggered by the "Run Assumption
// Tests" button in the Assumptions tab. Pushes the assumption tables straight to
// the Output Viewer without running (or saving) the full discriminant analysis.
export async function saveDiscriminantAssumptions(rawResults: unknown) {
    const formattedResult = transformDiscriminantResult(rawResults);
    const hasAny = ASSUMPTION_SECTIONS.some((s) =>
        formattedResult.tables.some((t) => t.key === s.key)
    );
    if (!hasAny) {
        throw new Error(
            "No assumption results were produced. Make sure a grouping variable and at least one independent variable are selected."
        );
    }

    const { addLog, addAnalytic } = useResultStore.getState();
    const logId = await addLog({ log: "Discriminant Assumption Checks" });
    const analyticId = await addAnalytic(logId, {
        title: withPrecisionNote("Discriminant Analysis: Assumption Checks"),
        note: "",
    });

    for (const section of ASSUMPTION_SECTIONS) {
        await renderDiscriminantSection(
            formattedResult.tables,
            analyticId,
            section.key,
            section.title,
            GROUP_ASSUMPTIONS,
        );
    }
}