/** @jest-environment jsdom */

import * as XLSX from "xlsx";
import {
  downloadTables,
  parseLinearGradient,
  portableFontFamily,
  tablesToCsv,
  tablesToWorkbook,
  tableToSheet,
  toFileBaseName,
} from "@/components/Modals/Analyze/Classify/nearest-neighbor/utils/output-export";
import { getKnnDownloadKind } from "@/components/Modals/Analyze/Classify/nearest-neighbor/components/KNNOutputDownloadMenu";

/** Same shape DataTableRenderer produces for the KNN classification table. */
function classificationTable(): HTMLTableElement {
  document.body.innerHTML = `
    <table>
      <thead>
        <tr><th colspan="5">Classification Table</th></tr>
        <tr><th rowspan="2">Partition</th><th rowspan="2">Observed</th><th colspan="3">Predicted</th></tr>
        <tr><th>No</th><th>Yes</th><th>Percent Correct</th></tr>
      </thead>
      <tbody>
        <tr><th rowspan="2">Training</th><th>No</th><td>40</td><td>3</td><td>93.0%</td></tr>
        <tr><th>Yes</th><td>4</td><td>23</td><td>85.2%</td></tr>
        <tr><th>Holdout</th><th>007</th><td>0.215</td><td>1.230E-5</td><td>Low, rare</td></tr>
      </tbody>
    </table>`;
  return document.querySelector("table") as HTMLTableElement;
}

describe("KNN table export", () => {
  it("keeps merged headers and converts displayed numbers to Excel numbers", () => {
    const sheet = tableToSheet(classificationTable());

    const merges = (sheet["!merges"] ?? []).map((range) => XLSX.utils.encode_range(range));
    expect(merges).toEqual(
      expect.arrayContaining(["A1:E1", "A2:A3", "B2:B3", "C2:E2", "A4:A5"]),
    );

    expect(sheet.A1).toMatchObject({ t: "s", v: "Classification Table" });
    expect(sheet.C4).toMatchObject({ t: "n", v: 40, z: "0" });
    expect(sheet.E4).toMatchObject({ t: "n", v: 0.93, z: "0.0%" });
    expect(sheet.C6).toMatchObject({ t: "n", v: 0.215, z: "0.000" });
    expect(sheet.D6).toMatchObject({ t: "n", v: 1.23e-5 });
    // Text that only looks numeric stays text (leading zero), and so does text.
    expect(sheet.B6).toMatchObject({ t: "s", v: "007" });
    expect(sheet.E6).toMatchObject({ t: "s", v: "Low, rare" });
    expect(sheet["!cols"]).toHaveLength(5);
  });

  it("writes a workbook that Excel readers can open again", () => {
    const workbook = tablesToWorkbook([classificationTable()], "Classification Table");
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const reopened = XLSX.read(bytes, { type: "array" });

    expect(reopened.SheetNames).toEqual(["Classification Table"]);
    const sheet = reopened.Sheets["Classification Table"];
    expect(sheet.E4.v).toBeCloseTo(0.93);
    expect(sheet.E4.w).toBe("93.0%");
    expect(sheet.B6.v).toBe("007");
  });

  it("gives every table its own, valid sheet name", () => {
    classificationTable();
    const second = classificationTable();
    const workbook = tablesToWorkbook([second, second], "Error: Summary/Holdout [x]");

    expect(workbook.SheetNames).toEqual([
      "Error Summary Holdout x 1",
      "Error Summary Holdout x 2",
    ]);
  });

  it("writes CSV with the displayed text and row headers repeated", () => {
    const lines = tablesToCsv([classificationTable()]).split("\r\n");

    expect(lines[0].startsWith("﻿")).toBe(true);
    expect(lines[0]).toBe("﻿Classification Table,,,,");
    expect(lines[3]).toBe("Training,No,40,3,93.0%");
    expect(lines[4]).toBe("Training,Yes,4,23,85.2%");
    expect(lines[5]).toBe('Holdout,007,0.215,1.230E-5,"Low, rare"');
  });

  it("downloads with a descriptive file name", () => {
    const createObjectURL = jest.fn(() => "blob:test");
    const revokeObjectURL = jest.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const names: string[] = [];
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        names.push(this.download);
      });

    const table = classificationTable();
    downloadTables([table], "csv", "Classification Table");
    downloadTables([table], "xlsx", "Classification Table");

    expect(names).toEqual([
      "knn-classification-table.csv",
      "knn-classification-table.xlsx",
    ]);
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    click.mockRestore();
  });

  it("refuses to download when there is no table", () => {
    expect(() => downloadTables([], "xlsx", "Empty")).toThrow("No table found");
  });
});

describe("KNN export helpers", () => {
  it("builds file names from statistic titles", () => {
    expect(toFileBaseName("Predictor Space")).toBe("knn-predictor-space");
    expect(toFileBaseName("k and Predictor Selection")).toBe("knn-k-and-predictor-selection");
    expect(toFileBaseName("  ")).toBe("knn-output");
  });

  it("replaces page-only web fonts with portable fonts", () => {
    expect(portableFontFamily("__Inter_d65c78, __Inter_Fallback_d65c78")).toBe(
      "Arial, Helvetica, sans-serif",
    );
    expect(portableFontFamily("ui-sans-serif, system-ui")).toBe(
      "ui-sans-serif, system-ui, Arial, Helvetica, sans-serif",
    );
  });

  it("converts CSS linear gradients (legend color scales) to SVG gradients", () => {
    // Computed style of the Predictor Space continuous-target legend.
    expect(
      parseLinearGradient(
        "linear-gradient(rgb(220, 38, 38), rgb(245, 158, 11), rgb(37, 99, 235))",
      ),
    ).toEqual({
      x1: 0.5,
      y1: 0,
      x2: 0.5,
      y2: 1,
      stops: [
        { color: "rgb(220, 38, 38)", offset: 0 },
        { color: "rgb(245, 158, 11)", offset: 0.5 },
        { color: "rgb(37, 99, 235)", offset: 1 },
      ],
    });
    expect(parseLinearGradient("linear-gradient(to right, red 20%, blue 80%)")).toEqual({
      x1: 0,
      y1: 0.5,
      x2: 1,
      y2: 0.5,
      stops: [
        { color: "red", offset: 0.2 },
        { color: "blue", offset: 0.8 },
      ],
    });
    expect(parseLinearGradient("none")).toBeNull();
    expect(parseLinearGradient("url(pattern.png)")).toBeNull();
  });

  it("offers table or image downloads based on the stored output", () => {
    expect(getKnnDownloadKind(JSON.stringify({ tables: [{ title: "T" }] }))).toBe("table");
    expect(getKnnDownloadKind({ charts: [{ chartType: "KNN Predictor Space" }] })).toBe("chart");
    expect(getKnnDownloadKind(JSON.stringify({ text: "note" }))).toBeNull();
    expect(getKnnDownloadKind("not json")).toBeNull();
  });
});
