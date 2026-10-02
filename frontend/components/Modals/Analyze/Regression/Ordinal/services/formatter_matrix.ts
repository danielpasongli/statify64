import { AnalysisSection } from "../types/ordinal";
import { createSection, safeFixed } from "./formatter_utils";

type MatrixKind = "covariance" | "correlation";

/** Formats the active Rust information matrix while retaining redundant SPSS rows. */
export const formatAsymptoticMatrix = (
  estimates: any[],
  matrix: number[][],
  kind: MatrixKind,
  linkFunctionNote?: string,
): AnalysisSection => {
  const rows = Array.isArray(estimates) ? estimates : [];
  const active = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !Boolean(row?.isRedundant ?? row?.is_redundant ?? row?.df === 0));
  const groups = ["Threshold", "Location", "Scale"]
    .map((group) => ({ group, count: rows.filter((row) => (row?.group ?? "") === group).length }))
    .filter(({ count }) => count > 0);
  const leafHeaders = rows.map((row, index) => ({
    header: String(row?.variable ?? `Parameter ${index + 1}`),
    key: `p${index}`,
  }));
  const columnHeaders: any[] = [
    { header: "", children: [{ header: "", key: "rh1" }, { header: "", key: "rh2" }] },
  ];
  let offset = 0;
  for (const group of groups) {
    columnHeaders.push({ header: group.group, children: leafHeaders.slice(offset, offset + group.count) });
    offset += group.count;
  }
  // Keep a flat fallback for renderers that do not expand nested headers.
  if (offset < leafHeaders.length) columnHeaders.push(...leafHeaders.slice(offset));

  const dataRows = rows.map((row, rowIndex) => {
    const redundantRow = !active.some(({ row: activeRow }) => activeRow === row);
    const values: Record<string, string> = {};
    rows.forEach((column, columnIndex) => {
      const redundantColumn = !active.some(({ row: activeRow }) => activeRow === column);
      if (redundantRow || redundantColumn) {
        values[`p${columnIndex}`] = ".a";
        return;
      }
      const ri = active.findIndex(({ row: activeRow }) => activeRow === row);
      const ci = active.findIndex(({ row: activeRow }) => activeRow === column);
      const value = matrix?.[ri]?.[ci];
      values[`p${columnIndex}`] = safeFixed(typeof value === "number" ? value : null);
    });
    return { rowHeader: [String(row?.group ?? ""), String(row?.variable ?? `Parameter ${rowIndex + 1}`)], ...values };
  });
  const title = kind === "covariance"
    ? "Asymptotic Covariances of Parameter Estimates"
    : "Asymptotic Correlations of Parameter Estimates";
  const description = kind === "covariance"
    ? "Nilai diagonal utama merepresentasikan varians dari masing-masing penduga parameter. Nilai varians yang relatif kecil mengindikasikan tingkat presisi (standard error yang rendah) pada estimasi parameter model."
    : "Nilai diagonal utama bernilai 1, sedangkan nilai di luar diagonal merepresentasikan korelasi asimtotik antar penduga parameter model.";
  const note = [linkFunctionNote, rows.some((row) => Boolean(row?.isRedundant ?? row?.is_redundant ?? row?.df === 0))
    ? "a. One or both parameter estimates are redundant."
    : undefined].filter(Boolean).join("\n");
  return createSection(`ordinal_asymptotic_${kind}`, title, { columnHeaders, rows: dataRows }, { description, note });
};
