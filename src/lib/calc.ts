// Mirror of public.calc_sales_document (method A) for live previews.
// The database recalculates on approval; these numbers are only a preview.
export type DocType = "advance" | "progress_claim" | "retention_release" | "other";
export type ProjectTerms = {
  id: string; contract_value: number; recovery_pct: number; retention_pct: number;
  retention_cap_pct: number | null; advance_outstanding: number; retention_held: number; retention_outstanding: number;
  vat_mode?: "A" | "B";   // A: VAT before retention (default) · B: VAT after retention (70% method)
};
export type Calc = {
  recovery: number; retention: number; vatBase: number; vat: number;
  invoiceTotal: number; due: number; netDue: number; error?: "release";
};

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const toNum = (v: unknown) => {
  const s = String(v ?? "").replace(/,/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).trim();
  const n = Number(s);
  return s === "" || !Number.isFinite(n) ? 0 : n;
};
export const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export function calcDoc(type: DocType, work: number, discount: number, t: ProjectTerms | null, vatRate = 0.15): Calc {
  if (type === "progress_claim" && t) {
    const recovery = Math.min(r2(work * t.recovery_pct), Math.max(t.advance_outstanding, 0));
    let retention = r2(work * t.retention_pct);
    if (t.retention_cap_pct != null) {
      retention = Math.min(retention, Math.max(r2(t.contract_value * t.retention_cap_pct) - t.retention_held, 0));
    }
    if (t.vat_mode === "B") {
      const vatBase = r2(work - discount - recovery - retention);
      const vat = r2(vatBase * vatRate);
      const invoiceTotal = r2(vatBase + vat);
      return { recovery, retention, vatBase, vat, invoiceTotal, due: invoiceTotal, netDue: vatBase };
    }
    const vatBase = r2(work - discount - recovery);
    const vat = r2(vatBase * vatRate);
    const invoiceTotal = r2(vatBase + vat);
    return { recovery, retention, vatBase, vat, invoiceTotal, due: r2(invoiceTotal - retention), netDue: r2(vatBase - retention) };
  }
  if (type === "retention_release") {
    const over = t ? work > t.retention_outstanding + 0.001 : false;
    const err = over ? ("release" as const) : undefined;
    if (t?.vat_mode === "B") {   // retention was invoiced without VAT, so VAT is due on release
      const vat = r2(work * vatRate);
      return { recovery: 0, retention: 0, vatBase: work, vat, invoiceTotal: r2(work + vat), due: r2(work + vat), netDue: work, error: err };
    }
    return { recovery: 0, retention: 0, vatBase: 0, vat: 0, invoiceTotal: work, due: work, netDue: work, error: err };
  }
  const vatBase = r2(work - discount);
  const vat = r2(vatBase * vatRate);
  const invoiceTotal = r2(vatBase + vat);
  return { recovery: 0, retention: 0, vatBase, vat, invoiceTotal, due: invoiceTotal, netDue: vatBase };
}
