import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { dateRange, daysBetween } from "@/lib/reports";
import { ReportTools } from "@/components/ReportTools";

type SP = Promise<{ tab?: string; from?: string; to?: string; project?: string; pay?: string }>;
const TABS = ["overview", "invoices", "statement", "advances"] as const;
const r2 = (n: number) => Math.round(n * 100) / 100;

export default async function SupplierFile({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!canManage(role)) redirect("/purchases");
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? sp.tab! : "overview";
  const range = dateRange(sp);

  const { data: s } = await supabase.from("parties").select("id,name_ar,name_en,vat_number").eq("id", id).eq("company_id", company.id).eq("kind", "supplier").maybeSingle();
  if (!s) notFound();
  const [{ data: docs }, { data: pays }, { data: advs }, { data: cms }, { data: projects }] = await Promise.all([
    supabase.from("purchase_documents").select("id,doc_number,issue_date,project_id,net_amount,vat_amount,eligible_vat,total_amount,status,details,attachment_path")
      .eq("company_id", company.id).eq("supplier_id", id).neq("status", "rejected").order("issue_date", { ascending: false }).limit(2000),
    supabase.from("supplier_payments").select("id,purchase_document_id,pay_date,amount,reference,advance_id,account:accounts(code,name_ar)")
      .eq("company_id", company.id).eq("supplier_id", id).limit(5000),
    supabase.from("v_supplier_advances").select("id,pay_date,amount,applied,balance,notes,reference,project_id").eq("company_id", company.id).eq("supplier_id", id).order("pay_date"),
    supabase.from("v_supplier_commitments").select("id,title,total_amount,paid,remaining,closed_at,project_id").eq("company_id", company.id).eq("supplier_id", id).order("created_at"),
    supabase.from("projects").select("id,code").eq("company_id", company.id),
  ]);
  const pcode = new Map((projects ?? []).map((p) => [p.id, p.code]));
  const name = (lang === "en" && s.name_en) || s.name_ar;
  const registered = !!s.vat_number && /^3\d{13}3$/.test(s.vat_number);
  const posted = (docs ?? []).filter((d) => d.status === "posted");
  const paidOf = new Map<string, number>();
  for (const p of pays ?? []) if (p.purchase_document_id) paidOf.set(p.purchase_document_id, r2((paidOf.get(p.purchase_document_id) ?? 0) + Number(p.amount)));
  const leftOf = (d: { id: string; total_amount: number }) => r2(Number(d.total_amount) - (paidOf.get(d.id) ?? 0));
  const today = new Date().toISOString().slice(0, 10);

  // ---- overview figures
  const dueInv = r2(posted.reduce((a, d) => a + Math.max(leftOf(d), 0), 0));
  const advAvail = r2((advs ?? []).reduce((a, x) => a + Number(x.balance), 0));
  const unpaid = posted.filter((d) => leftOf(d) > 0.004).sort((a, b) => a.issue_date.localeCompare(b.issue_date));
  const oldest = unpaid[0];
  const inRange = (d: string) => d >= range.from && d <= range.to;
  const paidPeriod = r2((pays ?? []).filter((p) => !p.advance_id && inRange(p.pay_date)).reduce((a, p) => a + Number(p.amount), 0)
    + (advs ?? []).filter((a) => inRange(a.pay_date)).reduce((a, x) => a + Number(x.amount), 0));
  const vatIssues = registered ? posted.filter((d) => Number(d.vat_amount) > 0 && Number(d.eligible_vat) < Number(d.vat_amount) - 0.004) : [];

  // ---- invoice statuses
  const payStatus = (d: { id: string; total_amount: number }) => { const l = leftOf(d); return l <= 0.004 ? "paid" : l < Number(d.total_amount) - 0.004 ? "partial" : "unpaid"; };
  const vatStatus = (d: { vat_amount: number; eligible_vat: number | null }) => {
    const v = Number(d.vat_amount), e = Number(d.eligible_vat ?? 0);
    if (!registered) return v > 0 ? "check" : "none";
    if (v <= 0) return "none";
    return e >= v - 0.004 ? "ok" : e > 0 ? "partial" : "nonDed";
  };
  const invRows = (docs ?? []).filter((d) => inRange(d.issue_date) && (!sp.project || (sp.project === "general" ? !d.project_id : d.project_id === sp.project))
    && (!sp.pay || payStatus(d) === sp.pay));

  // ---- statement: invoices (+), payments & advances (−); advance applications shown with no effect
  type Line = { date: string; kind: keyof typeof t.sup.mv; ref: string; desc: string; debit: number; credit: number; project: string; href?: string; info?: boolean };
  const lines: Line[] = [
    ...posted.map((d) => ({ date: d.issue_date, kind: "invoice" as const, ref: d.doc_number?.startsWith("NA-") ? "—" : d.doc_number, desc: d.details ?? "",
      debit: 0, credit: Number(d.total_amount), project: d.project_id ? pcode.get(d.project_id) ?? "" : t.sup.general, href: `/purchases/${d.id}` })),
    ...(pays ?? []).map((p) => {
      const a = p.account as unknown as { code: string; name_ar: string } | null;
      const d = posted.find((x) => x.id === p.purchase_document_id);
      return { date: p.pay_date, kind: (p.advance_id ? "applied" : "payment") as Line["kind"], ref: p.advance_id ? "" : p.reference ?? "", info: !!p.advance_id,
        desc: p.advance_id ? t.sup.appliedNote : `${a ? `${a.code} · ${a.name_ar}` : ""}${d ? ` — ${d.doc_number?.startsWith("NA-") ? d.details ?? "" : d.doc_number}` : ""}`,
        debit: p.advance_id ? 0 : Number(p.amount), credit: 0, project: d?.project_id ? pcode.get(d.project_id) ?? "" : "", href: d ? `/purchases/${d.id}` : undefined };
    }),
    ...(advs ?? []).map((a) => ({ date: a.pay_date, kind: "advance" as const, ref: a.reference ?? "", desc: a.notes ?? "", debit: Number(a.amount), credit: 0,
      project: a.project_id ? pcode.get(a.project_id) ?? "" : "", href: `/purchases/advance/${a.id}` })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "invoice" ? -1 : 1));
  const opening = r2(lines.filter((l) => l.date < range.from).reduce((a, l) => a + l.credit - l.debit, 0));
  let run = opening;
  const stmt = lines.filter((l) => inRange(l.date)).map((l) => { run = r2(run + l.credit - l.debit); return { ...l, bal: run }; });

  const q = (o: Record<string, string | undefined>) => {
    const u = new URLSearchParams(); const all = { from: sp.from, to: sp.to, project: sp.project, pay: sp.pay, tab, ...o };
    Object.entries(all).forEach(([k, v]) => { if (v) u.set(k, v); }); return `/purchases/suppliers/${id}?${u.toString()}`;
  };
  const sum = <T,>(a: T[], f: (x: T) => number) => r2(a.reduce((x, y) => x + f(y), 0));
  const projOpts = [...new Set((docs ?? []).map((d) => d.project_id ?? "general"))];

  return (
    <div className="stack-lg" id="report">
      <div className="page-head">
        <div>
          <p className="eyebrow no-print"><Link href="/purchases/suppliers">{t.sup.title}</Link> · {t.sup.file}</p>
          <h1 className="page-title">{name}</h1>
          <p className="muted">{s.vat_number ? <span className="num">{t.sup.vat}: {s.vat_number}</span> : t.sup.noVatSupplier}</p>
        </div>
        <ReportTools name={`supplier-${tab}`} exportLabel={t.rep.export} printLabel={t.rep.print} />
      </div>

      <nav className="tabs no-print" aria-label={t.sup.file}>
        {TABS.map((k) => <Link key={k} href={q({ tab: k })} className={tab === k ? "on" : ""} data-tab={k}>{t.sup.tabs[k]}</Link>)}
      </nav>

      {tab !== "advances" && (
        <form className="filters no-print" method="get">
          <input type="hidden" name="tab" value={tab} />
          <label className="field"><span>{t.rep.from}</span><input type="date" name="from" defaultValue={range.from} /></label>
          <label className="field"><span>{t.rep.to}</span><input type="date" name="to" defaultValue={range.to} /></label>
          {tab === "invoices" && <>
            <label className="field"><span>{t.sup.project}</span>
              <select name="project" defaultValue={sp.project ?? ""}><option value="">{t.sup.allStatus}</option>
                {projOpts.map((p) => <option key={p} value={p}>{p === "general" ? t.sup.general : pcode.get(p)}</option>)}</select></label>
            <label className="field"><span>{t.sup.payStatus}</span>
              <select name="pay" defaultValue={sp.pay ?? ""}><option value="">{t.sup.allStatus}</option>
                {(["unpaid", "partial", "paid"] as const).map((k) => <option key={k} value={k}>{t.sup.ps[k]}</option>)}</select></label>
          </>}
          <button className="btn primary sm">{t.rep.apply}</button>
        </form>
      )}
      <p className="print-only muted">{t.sup.tabs[tab as keyof typeof t.sup.tabs]} · {t.rep.from} <span className="num">{range.from}</span> {t.rep.to} <span className="num">{range.to}</span></p>

      {tab === "overview" && (
        <section className="card">
          <dl className="kv">
            <div><dt>{t.sup.dueInv}</dt><dd className="num">{money(dueInv)}</dd></div>
            <div><dt>{t.sup.advAvail}</dt><dd className="num">{advAvail > 0.004 ? `(${money(advAvail)})` : money(0)}</dd></div>
            <div className="hl"><dt>{t.sup.netDue}</dt><dd className="num"><b>{money(r2(dueInv - advAvail))}</b></dd></div>
            <div><dt>{t.sup.oldest}</dt><dd>{oldest ? <><Link className="link num" href={`/purchases/${oldest.id}`}>{oldest.issue_date}</Link> · <span className="num">{daysBetween(oldest.issue_date, today)}</span> {t.sup.days} · <span className="num">{money(leftOf(oldest))}</span></> : "—"}</dd></div>
            <div><dt>{t.sup.paidPeriod}</dt><dd className="num">{money(paidPeriod)}</dd></div>
            {registered && <div><dt>{t.sup.vatIssues}</dt><dd className="num">{vatIssues.length} · {money(sum(vatIssues, (d) => Number(d.vat_amount) - Number(d.eligible_vat ?? 0)))}</dd></div>}
            <div><dt>{t.sup.invoices}</dt><dd className="num">{posted.length} · {money(sum(posted, (d) => Number(d.total_amount)))}</dd></div>
          </dl>
          <p className="muted small">{t.sup.balNote}</p>
        </section>
      )}

      {tab === "invoices" && (
        <section className="card">
          <h2>{t.sup.tabs.invoices} ({invRows.length})</h2>
          {invRows.length > 0 ? (
            <div className="table-wrap"><table>
              <thead><tr><th>{t.sup.no}</th><th>{t.sup.issued}</th><th>{t.sup.project}</th><th className="n">{t.sup.net}</th><th className="n">{t.sup.vatAmt}</th>
                <th className="n">{t.sup.totalAmt}</th><th className="n">{t.sup.paid}</th><th className="n">{t.sup.left}</th><th>{t.sup.payStatus}</th><th>{t.sup.vatStatus}</th><th>{t.sup.review}</th></tr></thead>
              <tbody>{invRows.map((d) => {
                const diff = r2(Number(d.total_amount) - Number(d.net_amount) - Number(d.vat_amount));
                const ps = payStatus(d), vs = vatStatus(d);
                return (
                  <tr key={d.id}>
                    <td className="num"><Link className="link" href={`/purchases/${d.id}`}>{d.doc_number?.startsWith("NA-") ? (d.details ?? "—") : d.doc_number}</Link>
                      {d.attachment_path && <a href={`/purchases/${d.id}/photo`} target="_blank" rel="noreferrer" className="photo-link no-print"> 📷</a>}
                      {Math.abs(diff) > 0.01 && <span className="chip tiny warn" title={t.sup.mismatch}> {t.sup.mismatch} {money(diff)}</span>}</td>
                    <td className="num">{d.issue_date}</td>
                    <td className="num">{d.project_id ? pcode.get(d.project_id) : t.sup.general}</td>
                    <td className="n num">{money(d.net_amount)}</td><td className="n num">{money(d.vat_amount)}</td><td className="n num">{money(d.total_amount)}</td>
                    <td className="n num">{money(paidOf.get(d.id) ?? 0)}</td>
                    <td className="n num">{leftOf(d) > 0.004 ? <b className="warn-text">{money(leftOf(d))}</b> : money(0)}</td>
                    <td><span className={`chip tiny ps-${ps}`}>{t.sup.ps[ps]}</span></td>
                    <td><span className={`chip tiny ${vs === "check" || vs === "nonDed" ? "warn" : ""}`}>{t.sup.vs[vs]}</span></td>
                    <td><span className={`chip tiny ds-${d.status}`}>{t.docStatus[d.status as keyof typeof t.docStatus]}</span></td>
                  </tr>);
              })}</tbody>
              <tfoot><tr><th colSpan={3}>{t.rep.total}</th>
                <th className="n num">{money(sum(invRows, (d) => Number(d.net_amount)))}</th><th className="n num">{money(sum(invRows, (d) => Number(d.vat_amount)))}</th>
                <th className="n num">{money(sum(invRows, (d) => Number(d.total_amount)))}</th><th className="n num">{money(sum(invRows, (d) => paidOf.get(d.id) ?? 0))}</th>
                <th className="n num">{money(sum(invRows.filter((d) => d.status === "posted"), (d) => Math.max(leftOf(d), 0)))}</th><th colSpan={3} /></tr></tfoot>
            </table></div>
          ) : <p className="muted">{t.sup.noRows}</p>}
        </section>
      )}

      {tab === "statement" && (
        <section className="card">
          <h2>{t.sup.tabs.statement} — {name}</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>{t.sup.date}</th><th>{t.sup.move}</th><th>{t.sup.ref}</th><th>{t.sup.desc}</th><th>{t.sup.project}</th>
              <th className="n">{t.sup.debit}</th><th className="n">{t.sup.credit}</th><th className="n">{t.sup.balance}</th></tr></thead>
            <tbody>
              <tr className="hl"><td className="num">{range.from}</td><td colSpan={6}><b>{t.sup.opening}</b></td><td className="n num"><b>{money(opening)}</b></td></tr>
              {stmt.map((l, i) => (
                <tr key={i} className={l.info ? "muted" : ""}>
                  <td className="num">{l.date}</td><td>{t.sup.mv[l.kind]}</td>
                  <td className="num">{l.href ? <Link className="link" href={l.href}>{l.ref || "—"}</Link> : l.ref || "—"}</td>
                  <td className="small desc-cell" title={l.desc}>{l.desc}</td><td className="num">{l.project}</td>
                  <td className="n num">{l.debit ? money(l.debit) : ""}</td><td className="n num">{l.credit ? money(l.credit) : ""}</td>
                  <td className="n num">{money(l.bal)}</td>
                </tr>))}
            </tbody>
            <tfoot><tr><th colSpan={5}>{t.rep.total}</th><th className="n num">{money(sum(stmt, (l) => l.debit))}</th><th className="n num">{money(sum(stmt, (l) => l.credit))}</th>
              <th className="n num">{money(stmt.length ? stmt[stmt.length - 1].bal : opening)}</th></tr></tfoot>
          </table></div>
          <p className="muted small">{t.sup.balNote}</p>
        </section>
      )}

      {tab === "advances" && (<>
        <section className="card">
          <h2>{t.sup.advList}</h2>
          {advs && advs.length > 0 ? (
            <table>
              <thead><tr><th>{t.sup.date}</th><th>{t.sup.project}</th><th>{t.sup.desc}</th><th className="n">{t.sup.totalAmt}</th><th className="n">{t.sup.paid}</th><th className="n">{t.sup.advLeft}</th></tr></thead>
              <tbody>{advs.map((a) => (
                <tr key={a.id}><td className="num"><Link className="link" href={`/purchases/advance/${a.id}`}>{a.pay_date}</Link></td>
                  <td className="num">{a.project_id ? pcode.get(a.project_id) : "—"}</td><td className="small">{a.notes ?? ""}</td>
                  <td className="n num">{money(a.amount)}</td><td className="n num">{money(a.applied)}</td>
                  <td className="n num">{Number(a.balance) > 0.004 ? <b className="warn-text">{money(a.balance)}</b> : money(0)}</td></tr>))}</tbody>
              <tfoot><tr><th colSpan={3}>{t.rep.total}</th><th className="n num">{money(sum(advs, (a) => Number(a.amount)))}</th>
                <th className="n num">{money(sum(advs, (a) => Number(a.applied)))}</th><th className="n num">{money(advAvail)}</th></tr></tfoot>
            </table>
          ) : <p className="muted">{t.sup.noRows}</p>}
        </section>
        <section className="card">
          <h2>{t.sup.cmList}</h2>
          {cms && cms.length > 0 ? (
            <table>
              <thead><tr><th>{t.cm.title1}</th><th>{t.sup.project}</th><th className="n">{t.cm.total}</th><th className="n">{t.cm.paid}</th><th className="n">{t.cm.remaining}</th></tr></thead>
              <tbody>{cms.map((c) => (
                <tr key={c.id} className={c.closed_at ? "muted" : ""}><td>{c.title}</td><td className="num">{c.project_id ? pcode.get(c.project_id) : "—"}</td>
                  <td className="n num">{money(c.total_amount)}</td><td className="n num">{money(c.paid)}</td>
                  <td className="n num">{c.closed_at ? t.cm.closed : <b>{money(c.remaining)}</b>}</td></tr>))}</tbody>
            </table>
          ) : <p className="muted">{t.sup.noRows}</p>}
        </section>
      </>)}
    </div>
  );
}
