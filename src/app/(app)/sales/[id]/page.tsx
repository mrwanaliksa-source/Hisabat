import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money, pct } from "@/lib/i18n";
import { docAction } from "./actions";

type Params = Promise<{ id: string }>;
type SP = Promise<{ err?: string; ok?: string }>;

export default async function SalesDocPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role, user } = await getContext();
  if (!company) return null;
  const manager = canManage(role);

  const { data: d } = await supabase.from("sales_documents")
    .select("*, project:projects(id,code,name_ar,name_en), customer:parties(id,name_ar,name_en)")
    .eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!d) notFound();
  const posted = d.status === "posted";

  // authoritative numbers: stored once posted, server preview before that
  let n = {
    advance_recovery: d.advance_recovery, retention: d.retention, vat_base: d.vat_base, vat_amount: d.vat_amount,
    invoice_total: d.invoice_total, collectible_total: d.collectible_total, collectible_net: d.collectible_net,
    total_matches: d.printed_total == null || Math.abs(Number(d.printed_total) - Number(d.invoice_total)) <= 0.05,
  };
  let previewError = "";
  if (!posted) {
    const { data: pv, error } = await supabase.rpc("preview_sales_document", { p_doc: id });
    if (error) previewError = error.message; else n = pv;
  }

  const [{ data: allocs }, { data: shares }, { data: lines }] = await Promise.all([
    manager ? supabase.from("receipt_allocations").select("id,amount,created_at,receipt:receipts(receipt_date,reference)").eq("sales_document_id", id) : Promise.resolve({ data: null }),
    manager ? supabase.from("partner_entitlements").select("id,collected_amount,net_collected,share_pct,amount,partner:parties(name_ar,name_en)").eq("sales_document_id", id) : Promise.resolve({ data: null }),
    manager && d.journal_entry_id ? supabase.from("journal_lines").select("id,debit,credit,account:accounts(code,name_ar,name_en)").eq("entry_id", d.journal_entry_id) : Promise.resolve({ data: null }),
  ]);
  const collected = (allocs ?? []).reduce((s, a) => s + Number(a.amount), 0);

  type N = { name_ar: string; name_en: string | null; code?: string; id?: string };
  const nm = (x: unknown) => { const v = x as N | null; return v ? (lang === "en" && v.name_en) || v.name_ar : "—"; };
  const proj = d.project as unknown as N;
  const cust = d.customer as unknown as N;
  const isClaim = d.doc_type === "progress_claim";
  const isRelease = d.doc_type === "retention_release";
  const canSubmit = (d.status === "draft" || d.status === "needs_info") && (manager || d.created_by === user.id);

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <p className="eyebrow">{t.docType[d.doc_type as keyof typeof t.docType]} · <span className="num">{d.issuer_ref || "—"}</span></p>
          <h1 className="page-title"><Link href={`/projects/${proj.id}`}>{proj.code} · {nm(proj)}</Link></h1>
          <p className="muted">{nm(cust)} · <span className="num">{d.issue_date}</span></p>
        </div>
        <span className={`chip big ds-${d.status}`}>{t.docStatus[d.status as keyof typeof t.docStatus]}</span>
      </div>

      {sp.err && <p className="alert error">{sp.err}</p>}
      {sp.ok === "approve" && <p className="alert ok">✓ {t.sales.posted}</p>}
      {d.review_reason && <p className="alert warn"><b>{t.sales.reviewReason}:</b> {d.review_reason}</p>}
      {previewError && <p className="alert error">{previewError}</p>}

      <div className="grid-2 top">
        <section className="card">
          <h2>{posted ? t.sales.calc : t.sales.authoritative}</h2>
          <dl className="kv">
            <div><dt>{isRelease ? t.sales.releaseValue : t.sales.workValue}</dt><dd className="num">{money(d.work_value)}</dd></div>
            {Number(d.discount) > 0 && <div><dt>{t.sales.discount}</dt><dd className="num">({money(d.discount)})</dd></div>}
            {isClaim && <div><dt>{t.form.recovery}</dt><dd className="num">({money(n.advance_recovery)})</dd></div>}
            {!isRelease && <div><dt>{t.form.vatBase}</dt><dd className="num">{money(n.vat_base)}</dd></div>}
            {!isRelease && <div><dt>{t.form.vat}</dt><dd className="num">{money(n.vat_amount)}</dd></div>}
            <div className="hl"><dt>{t.sales.invoiceTotal}</dt><dd className="num">{money(n.invoice_total)}</dd></div>
            {isClaim && <div><dt>{t.form.retention}</dt><dd className="num">({money(n.retention)})</dd></div>}
            <div className="hl"><dt>{t.form.due}</dt><dd className="num">{money(n.collectible_total)}</dd></div>
            <div><dt>{t.form.netDue}</dt><dd className="num">{money(n.collectible_net)}</dd></div>
            {d.printed_total != null && (
              <div><dt>{t.sales.printedTotal}</dt><dd className="num">{money(d.printed_total)} {n.total_matches ? "✓" : "⚠"}</dd></div>
            )}
          </dl>
          {d.printed_total != null && !n.total_matches && <p className="alert warn">{t.sales.totalMismatch}</p>}
        </section>

        <section className="card stack">
          <h2>{t.col.status}</h2>
          {canSubmit && (
            <div className="actions wrap">
              <form action={docAction}>
                <input type="hidden" name="id" value={id} /><input type="hidden" name="what" value="submit" />
                <button className="btn primary" data-act="submit">{t.sales.submit}</button>
              </form>
              {d.status === "draft" && (
                <form action={docAction}>
                  <input type="hidden" name="id" value={id} /><input type="hidden" name="what" value="delete" />
                  <button className="btn ghost danger" data-act="delete">{t.sales.deleteDraft}</button>
                </form>
              )}
            </div>
          )}
          {d.status === "submitted" && manager && (
            <>
              <form action={docAction}>
                <input type="hidden" name="id" value={id} /><input type="hidden" name="what" value="approve" />
                <button className="btn primary block" data-act="approve">{t.sales.approve}</button>
              </form>
              <form action={docAction} className="stack">
                <input type="hidden" name="id" value={id} />
                <div className="grid-2">
                  <label className="field"><span>{t.col.status}</span>
                    <select name="what" defaultValue="needs_info">
                      <option value="needs_info">{t.sales.needsInfo}</option>
                      <option value="reject">{t.sales.reject}</option>
                    </select>
                  </label>
                  <label className="field"><span>{t.sales.reason}<b className="req"> *</b></span><input name="reason" required /></label>
                </div>
                <button className="btn ghost" data-act="decide">{t.sales.needsInfo} / {t.sales.reject}</button>
              </form>
            </>
          )}
          {posted && manager && (
            <>
              <dl className="kv">
                <div><dt>{t.sales.collected}</dt><dd className="num">{money(collected)}</dd></div>
                <div className="hl"><dt>{t.sales.balance}</dt><dd className="num">{money(Number(d.collectible_total) - collected)}</dd></div>
              </dl>
              {Number(d.collectible_total) - collected > 0.004 && (
                <Link className="btn primary" href={`/cash/receipt/new?customer=${cust.id}`}>{t.sales.recordReceipt}</Link>
              )}
            </>
          )}
          {d.notes && <p className="muted small">{t.sales.notes}: {d.notes}</p>}
        </section>
      </div>

      {posted && manager && (
        <div className="grid-2 top">
          <section className="card">
            <h2>{t.sales.allocations}</h2>
            {allocs && allocs.length > 0 ? (
              <table>
                <tbody>
                  {allocs.map((a) => {
                    const r = a.receipt as unknown as { receipt_date: string; reference: string | null };
                    return <tr key={a.id}><td className="num">{r?.receipt_date}</td><td className="num">{r?.reference ?? "—"}</td><td className="n num">{money(a.amount)}</td></tr>;
                  })}
                </tbody>
              </table>
            ) : <p className="muted">{t.sales.noAllocations}</p>}
          </section>
          <section className="card">
            <h2>{t.sales.partnerShares}</h2>
            {shares && shares.length > 0 ? (
              <table>
                <thead><tr><th>{t.cash.partner}</th><th className="n">{t.sales.collected}</th><th className="n">{t.form.netDue}</th><th className="n">%</th><th className="n">{t.detail.entitled}</th></tr></thead>
                <tbody>
                  {shares.map((s) => (
                    <tr key={s.id}>
                      <td>{nm(s.partner)}</td><td className="n num">{money(s.collected_amount)}</td>
                      <td className="n num">{money(s.net_collected)}</td><td className="n num">{pct(s.share_pct)}</td>
                      <td className="n num"><b>{money(s.amount)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="muted">—</p>}
          </section>
        </div>
      )}

      {lines && lines.length > 0 && (
        <section className="card">
          <h2>{t.sales.journal}</h2>
          <table>
            <thead><tr><th>{t.sales.account}</th><th className="n">{t.sales.debit}</th><th className="n">{t.sales.credit}</th></tr></thead>
            <tbody>
              {lines.map((l) => {
                const a = l.account as unknown as { code: string; name_ar: string; name_en: string | null };
                return (
                  <tr key={l.id}>
                    <td><span className="num muted">{a.code}</span> {nm(a)}</td>
                    <td className="n num">{Number(l.debit) ? money(l.debit) : ""}</td>
                    <td className="n num">{Number(l.credit) ? money(l.credit) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
