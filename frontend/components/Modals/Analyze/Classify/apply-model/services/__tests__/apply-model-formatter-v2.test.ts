// AGENTS_V2.md §10.4 — baris ringkasan model untuk fitur Text (Fase A3).
// Baris `Text source` dll. berasal dari Rust (`model_summary.parameters`) dan dirender apa adanya.

import type { ApplyModelRawResult } from "@/components/Modals/Analyze/Classify/apply-model/types/apply-model-worker";
import {
  buildApplyModelSummaryTable,
  transformApplyModelResult,
} from "@/components/Modals/Analyze/Classify/apply-model/services/apply-model-formatter";
import { ApplyModelOutputDefault } from "@/components/Modals/Analyze/Classify/apply-model/constants/apply-model-default";

const rawFixture = require("@/components/Modals/Analyze/Classify/apply-model/services/__fixtures__/apply-model-raw-result.json") as ApplyModelRawResult;

const textSummary: ApplyModelRawResult["model_summary"] = {
  ...rawFixture.model_summary,
  features: [],
  parameters: [
    { label: "Text source", value: "vector" },
    { label: "Text likelihood", value: "multinomial" },
    { label: "Text features zero-filled", value: "2" },
  ],
};

const rowsOf = (table: ReturnType<typeof buildApplyModelSummaryTable>) =>
  table.rows.map((row) => [row.rowHeader[0], row.value]);

describe("buildApplyModelSummaryTable — Text", () => {
  it("vector: baris Rust (Text source/likelihood/zero-filled) + 'Word-Vector Columns' dari TS", () => {
    const table = buildApplyModelSummaryTable(textSummary, "File: m.json", {
      source: "vector",
      totalColumns: 5,
      mappedColumns: 3,
    });
    const rows = rowsOf(table);

    expect(rows).toContainEqual(["Text source", "vector"]);
    expect(rows).toContainEqual(["Text likelihood", "multinomial"]);
    expect(rows).toContainEqual(["Text features zero-filled", "2"]);
    expect(rows).toContainEqual(["Word-Vector Columns", "3 of 5 vector columns found; 2 treated as 0."]);
    expect(rows.some(([label]) => label === "Feature")).toBe(false);
  });

  it("raw: 'Text Variable' memuat variabel model dan variabel dataset", () => {
    const table = buildApplyModelSummaryTable(textSummary, "File: m.json", {
      source: "raw",
      modelVariable: "Teks",
      datasetVariable: "Tweet",
    });

    expect(rowsOf(table)).toContainEqual(["Text Variable", "Teks → Tweet (raw text)"]);
  });

  it("tanpa pemetaan Text (model v1): tabel identik dengan sebelum v2", () => {
    const before = buildApplyModelSummaryTable(rawFixture.model_summary, "File: m.json");
    const labels = rowsOf(before).map(([label]) => label);

    expect(labels).not.toContain("Text Variable");
    expect(labels).not.toContain("Word-Vector Columns");
    expect(before).toEqual(buildApplyModelSummaryTable(rawFixture.model_summary, "File: m.json", undefined));
  });

  it("transformApplyModelResult meneruskan context.textMapping ke Model Summary", () => {
    const result = transformApplyModelResult(
      rawFixture,
      ApplyModelOutputDefault,
      {
        sourceLabel: "File: m.json",
        savedColumns: [],
        textMapping: { source: "raw", modelVariable: null, datasetVariable: "Tweet" },
      }
    );
    const summary = result.tables.find((table) => table.key === "apply_model_summary");

    expect(summary && rowsOf(summary)).toContainEqual(["Text Variable", "- → Tweet (raw text)"]);
  });
});
