import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { dateRange, daysBetween } from "@/lib/reports";
import { ReportHeader } from "@/components/ReportHeader";

export default async function PayablesReport({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const { to } = dateRange(await searchParams);
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!canManage(role)) redirect("/");

  const [{ data: bal }, { data: docs }, { data: advs }] = await Promise.all([
    supabase.from("v_purchase_balances").select("id,balance").eq("company_id", company.id).gt("balance", 0),
    supabase.from("purchase_documents").select("id,issue_date,doc_number,details,total_amount,supplier_id,project:projects!purchase_documents_project_id_fkey(code),supplier:parties!purchase_documents_supplier_id_fkey(name_ar,name_en)")
      .eq("company_id", company.id).eq("status", "posted").lte("issue_date", to).order("issue_date"),
    supabase.from("v_supplier_advances").select("id,supplier_name,pay_date,notes,amount,balance").eq("company_id", company.id).gt("balance", 0).order("pay_date"),
  ]);
  const advTotal = (advs ?? []).reduce((s, a) => s + Number(a.balance), 0);
  const { data: cms } = await supabase.from("v_supplier_commitments").select("id,supplier_name,title,total_amount,paid,remaining")
    .eq("company_id", company.id).is("closed_at", null).gt("remaining", 0).order("supplier_name");
  const cmTotal = (cms ?? []).reduce((s, c) => s + Number(c.remaining), 0);
  const left = new Map((bal ?? []).map((b) => [b.id, Number(b.balance)]));
  const rows = (docs ?? []).filter((d) => (left.get(d.id) ?? 0) > 0.004);
  type N = { name_ar: string; name_en: string | null } | null;
  const bySupplier = new Map<string, { name: string; total: number }>();
  for (const d of rows) {
    const s = d.supplier as unknown as N;
    const cur = bySupplier.get(d.supplier_id) ?? { name: s ? (lang === "en" && s.name_en) || s.name_ar : "", total: 0 };
    cur.total += left.get(d.id) ?? 0; bySupplier.set(d.supplier_id, cur);
  }
  const total = rows.reduce((s, d) => s + (left.get(d.id) ?? 0), 0);

  return (
    <div className="stack-lg" id="report">
      <ReportHeader t={t} title={t.rep.payables.t} desc={t.rep.payables.d} name="supplier-payables" asOf={to} />
      <section className="card">
        <h2>{t.exp.supplier}</h2>
        {bySupplier.size ? (
          <table><tbody>{[...bySupplier.values()].map((s) => <tr key={s.name}><td>{s.name}</td><td className="n num"><b>{money(s.total)}</b></td></tr>)}</tbody>
            <tfoot><tr><th>{t.rep.total}</th><th className="n num">{money(total)}</th></tr></tfoot></table>
        ) : <p className="muted">{t.rep.none}</p>}
      </section>

      <section className="card">
        <h2>{t.cm.title}</h2>
        <p className="muted small">{t.cm.hint}</p>
        {cms && cms.length > 0 ? (
          <table>
            <thead><tr><th>{t.adv.supplier}</th><th>{t.cm.title1}</th><th className="n">{t.cm.total}</th><th className="n">{t.cm.paid}</th><th className="n">{t.cm.remaining}</th><th /></tr></thead>
            <tbody>{cms.map((c) => (
              <tr key={c.id}><td>{c.supplier_name}</td><td className="muted">{c.title}</td><td className="n num">{money(c.total_amount)}</td>
                <td className="n num">{money(c.paid)}</td><td className="n num"><b>{money(c.remaining)}</b></td>
                <td>{Number(c.remaining) > 0.004 && <Link className="btn soft sm" href={`/purchases/new?commitment=${c.id}`}>{t.cm.payPart}</Link>}</td></tr>))}</tbody>
            <tfoot><tr><th colSpan={4}>{t.rep.total}</th><th className="n num">{money(cmTotal)}</th><th /></tr></tfoot>
          </table>
        ) : <p className="muted">{t.cm.none}</p>}
      </section>

      <section className="card">
        <h2>{t.adv.title}</h2>
        <p className="muted small">{t.adv.chase}</p>
        {advs && advs.length > 0 ? (
          <table>
            <thead><tr><th>{t.adv.supplier}</th><th>{t.exp.date}</th><th>{t.adv.notes}</th><th className="n">{t.rep.aging.days}</th><th className="n">{t.adv.waiting}</th></tr></thead>
            <tbody>{advs.map((a) => (
              <tr key={a.id}><td>{a.supplier_name}</td><td className="num">{a.pay_date}</td><td className="muted">{a.notes}</td>
                <td className="n num">{daysBetween(a.pay_date, to)}</td><td className="n num"><b>{money(a.balance)}</b></td></tr>))}</tbody>
            <tfoot><tr><th colSpan={4}>{t.rep.total}</th><th className="n num">{money(advTotal)}</th></tr></tfoot>
          </table>
        ) : <p className="muted">{t.adv.none}</p>}
      </section>
      {rows.length > 0 && (
        <section className="card">
          <h2>{t.exp.title}</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>{t.exp.date}</th><th>{t.exp.supplier}</th><th>{t.exp.project}</th><th>{t.exp.details}</th>
              <th className="n">{t.rep.payables.age}</th><th className="n">{t.exp.total}</th><th className="n">{t.exp.balance}</th></tr></thead>
            <tbody>{rows.map((d) => { const s = d.supplier as unknown as N; return (
              <tr key={d.id}><td className="num">{d.issue_date}</td><td>{s ? (lang === "en" && s.name_en) || s.name_ar : ""}</td>
                <td className="num">{(d.project as unknown as { code: string } | null)?.code ?? "—"}</td>
                <td className="clip"><Link className="link" href={`/purchases/${d.id}`}>{d.details ?? d.doc_number}</Link></td>
                <td className="n num">{daysBetween(d.issue_date, to)}</td><td className="n num">{money(d.total_amount)}</td>
                <td className="n num"><b>{money(left.get(d.id))}</b></td></tr>); })}</tbody>
          </table></div>
        </section>
      )}
    </div>
  );
}
