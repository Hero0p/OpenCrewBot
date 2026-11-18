// The shared Files folder (a temporary one in tests) and the chart drawer.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FILES_DIR, FileAccessError, fileUrl, listFiles, readSpreadsheet, safeFilePath, saveChart, saveReport, saveUpload } from "@/lib/server/files";
import { renderChartSvg, validateChart } from "@/lib/server/charts";

describe("safeFilePath", () => {
  it("allows paths inside the Files folder", () => {
    expect(safeFilePath("uploads/sales.csv")).toBe(join(FILES_DIR, "uploads", "sales.csv"));
  });

  it("refuses paths that escape the Files folder", () => {
    for (const bad of ["../opencrewbot.db", "uploads/../../secret", "..\\..\\.env"]) {
      expect(() => safeFilePath(bad), bad).toThrow(FileAccessError);
    }
  });

  it("treats a leading slash as inside the folder, not the disk root", () => {
    expect(safeFilePath("/uploads/a.csv")).toBe(join(FILES_DIR, "uploads", "a.csv"));
  });
});

describe("readSpreadsheet", () => {
  writeFileSync(
    join(FILES_DIR, "uploads", "funnel.csv"),
    ["region,leads,paid,revenue", "North,100,10,5000", "South,200,12,6000", 'West,"50",,1500', "East,150,30,15000"].join("\n"),
  );

  it("summarises every column over all rows", () => {
    const data = readSpreadsheet("uploads/funnel.csv");
    expect(data.rowCount).toBe(4);
    const leads = data.columns.find((c) => c.name === "leads");
    expect(leads).toMatchObject({ type: "number", sum: 500, min: 50, max: 200, mean: 125 });
    expect(data.columns.find((c) => c.name === "paid")).toMatchObject({ type: "number", blanks: 1 });
    expect(data.columns.find((c) => c.name === "region")).toMatchObject({ type: "text", examples: ["North", "South", "West", "East"] });
  });

  it("returns only the requested number of rows, and says it cut them", () => {
    const data = readSpreadsheet("uploads/funnel.csv", 2);
    expect(data.rows).toHaveLength(2);
    expect(data.truncated).toBe(true);
  });

  it("explains missing files and non-CSV files", () => {
    expect(() => readSpreadsheet("uploads/nope.csv")).toThrow(/list_files/);
    expect(() => readSpreadsheet("uploads/notes.md")).toThrow(/Only \.csv/);
  });
});

describe("saving files", () => {
  it("saves reports and charts without overwriting, and lists them", () => {
    const first = saveReport("Q3 Sales Review", "Body");
    const second = saveReport("Q3 Sales Review", "Body");
    expect(first.path).toBe("reports/q3-sales-review.md");
    expect(second.path).toBe("reports/q3-sales-review-2.md");
    expect(readFileSync(join(FILES_DIR, first.path), "utf8")).toBe("# Q3 Sales Review\n\nBody");
    expect(first.url).toBe(fileUrl(first.path));
    const chart = saveChart("Leads", "<svg/>");
    expect(existsSync(join(FILES_DIR, chart.path))).toBe(true);
    expect(listFiles().map((f) => f.path)).toEqual(expect.arrayContaining([first.path, second.path, chart.path]));
  });

  it("accepts only safe upload types", () => {
    expect(saveUpload("Sales Data.csv", Buffer.from("a,b\n1,2"))).toBe("uploads/sales-data.csv");
    expect(() => saveUpload("evil.svg", Buffer.from("<svg/>"))).toThrow(/Only/);
    expect(() => saveUpload("page.html", Buffer.from("<script/>"))).toThrow(/Only/);
  });
});

describe("charts", () => {
  const spec = { title: "Revenue by region", type: "bar" as const, labels: ["North", "South"], series: [{ name: "Revenue", values: [5000, 6000] }] };

  it("draws an SVG with one bar per value", () => {
    const svg = renderChartSvg(spec);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.match(/<rect x=/g)?.length).toBe(2); // the bars (the white background rect has no x)
    expect(svg).toContain("Revenue by region");
  });

  it("escapes text, so a chart can't carry markup", () => {
    const svg = renderChartSvg({ ...spec, title: '<script>alert("x")</script>', labels: ["<b>", "&"] });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("rejects series that don't match the labels", () => {
    expect(() => validateChart({ ...spec, series: [{ name: "Revenue", values: [1] }] })).toThrow(/must match/);
  });
});
