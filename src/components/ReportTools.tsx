"use client";

/** Export every table on the page (or #report) as one CSV that Excel opens correctly, and print. */
export function ReportTools({ name, exportLabel, printLabel }: { name: string; exportLabel: string; printLabel: string }) {
  function exportCsv() {
    const root = document.getElementById("report") ?? document.body;
    const lines: string[] = [];
    root.querySelectorAll("table").forEach((table, i) => {
      if (i > 0) lines.push("");
      const title = table.closest("section")?.querySelector("h2")?.textContent?.trim();
      if (title) lines.push(`"${title.replace(/"/g, '""')}"`);
      table.querySelectorAll("tr").forEach((tr) => {
        const cells = Array.from(tr.querySelectorAll("th,td")).map((c) => {
          const raw = (c.textContent ?? "").trim();
          const num = raw.replace(/,/g, "").replace(/^\((.*)\)$/, "-$1");
          const v = /^-?\d+(\.\d+)?$/.test(num) ? num : raw;
          return `"${v.replace(/"/g, '""')}"`;
        });
        if (cells.length) lines.push(cells.join(","));
      });
    });
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <div className="actions no-print">
      <button type="button" className="btn soft sm" onClick={exportCsv}>⬇ {exportLabel}</button>
      <button type="button" className="btn ghost sm" onClick={() => window.print()}>🖨 {printLabel}</button>
    </div>
  );
}
