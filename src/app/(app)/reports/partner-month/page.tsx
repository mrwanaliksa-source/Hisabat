import { redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { ReportHeader } from "@/components/ReportHeader";

type SP = Promise<{ month?: string; partner?: string }>;

export default async function PartnerMonth({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!canManage(role)) redirect("/");
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : new Date().toISOString().slice(0, 7);
  const from = `${month}-01`;
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);

  const [{ data: projects }, { data: partners }, { data: sales }, { data: purch }] = await Promise.all([
    supabase.from("projects").select("id,code,contract_holder,holder_partner_id").eq("company_id", company.id),
    supabase.from("parties").select("id,name_ar,name_en").eq("company_id", company.id).eq("kind", "partner").order("name_ar"),
    supabase.from("sales_documents").select("id,project_id,doc_type,issuer_ref,issue_date,supply_date,payment_order_date,vat_base,vat_amount,invoice_total,customer:parties!sales_documents_customer_id_fkey(is_government)")
      .eq("company_id", company.id).eq("status", "posted"),
    supabase.from("purchase_documents").select("id,project_id,doc_number,issue_date,net_amount,vat_amount,eligible_vat,total_amount,vat_owner_partner,vat_owner_project,supplier:parties!purchase_documents_supplier_id_fkey(name_ar,vat_number)")
      .eq("company_id", company.id).eq("status", "posted").gte("issue_date", from).lte("issue_date", end),
  ]);
  const proj = new Map((projects ?? []).map((p) => [p.id, p]));
  const holder = (pid: string | null) => { const p = pid ? proj.get(pid) : null; return p?.contract_holder === "partner" ? (p.holder_partner_id as string) : null; };
  const name = (p: { name_ar: string; name_en: string | null }) => (lang === "en" && p.name_en) || p.name_ar;
  const inMonth = (d: string) => d >= from && d <= end;

  type S = { id: string; date: string; ref: string; project: string; type: string; base: number; vat: number; total: number };
  type P = { id: string; date: string; ref: string; project: string; supplier: string; net: number; ded: number; total: number };
  const book = new Map<string, { s: S[]; p: P[] }>();
  const bucket = (o: string) => { if (!book.has(o)) book.set(o, { s: [], p: [] }); return book.get(o)!; };

  for (const d of sales ?? []) {
    const gov = (d.customer as unknown as { is_government: boolean } | null)?.is_government;
    const date = (gov && d.payment_order_date) || d.supply_date || d.issue_date;
    const o = holder(d.project_id);
    if (!o || !inMonth(date)) continue;
    bucket(o).s.push({ id: d.id, date, ref: d.issuer_ref ?? "—", project: proj.get(d.project_id)?.code ?? "", type: t.docType[d.doc_type as keyof typeof t.docType],
      base: Number(d.vat_base), vat: Number(d.vat_amount), total: Number(d.invoice_total) });
  }
  for (const d of purch ?? []) {
    const vp = d.vat_owner_project ?? d.project_id;
    const o = d.vat_owner_partner || holder(vp);
    if (!o) continue;
    const s = d.supplier as unknown as { name_ar: string; vat_number: string | null } | null;
    bucket(o).p.push({ id: d.id, date: d.issue_date, ref: d.doc_number?.startsWith("NA-") ? "—" : d.doc_number ?? "—", project: d.project_id ? proj.get(d.project_id)?.code ?? "" : "—",
      supplier: s?.name_ar ?? "", net: Number(d.net_amount), ded: Number(d.eligible_vat), total: Number(d.total_amount) });
  }
  const owners = (partners ?? []).filter((p) => book.has(p.id) && (!sp.partner || sp.partner === p.id));
  const sum = <T,>(a: T[], f: (x: T) => number) => a.reduce((s, x) => s + f(x), 0);

  return (
    <div className="stack-lg" id="report">
      <ReportHeader t={t} title={`${t.rep.pm.t} — ${month}`} desc={t.rep.pm.d} name={`partner-month-${month}`}
        extra={<>
          <label className="field"><span>{t.rep.pm.month}</span><input type="month" name="month" defaultValue={month} /></label>
          <label className="field"><span>{t.rep.pm.partner}</span>
            <select name="partner" defaultValue={sp.partner ?? ""}><option value="">{t.rep.pm.all}</option>
              {(partners ?? []).map((p) => <option key={p.id} value={p.id}>{name(p)}</option>)}</select></label>
        </>} />
      {owners.length === 0 && <section className="card"><p className="muted">{t.rep.pm.none}</p></section>}
      {owners.map((pt) => {
        const b = book.get(pt.id)!;
        b.s.sort((x, y) => x.date.localeCompare(y.date)); b.p.sort((x, y) => x.date.localeCompare(y.date));
        const out = sum(b.s, (x) => x.vat), inp = sum(b.p, (x) => x.ded);
        return (
          <section key={pt.id} className="card stack" data-partner={pt.id}>
            <h2>{name(pt)}</h2>
            <dl className="kv">
              <div><dt>{t.rep.pm.out}</dt><dd className="num">{money(out)}</dd></div>
              <div><dt>{t.rep.pm.inp}</dt><dd className="num">{money(inp)}</dd></div>
              <div className="hl"><dt>{t.rep.pm.net}</dt><dd className="num"><b>{money(out - inp)}</b></dd></div>
            </dl>
            <h3>{t.rep.pm.sales} ({b.s.length})</h3>
            {b.s.length > 0 ? (
              <div className="table-wrap"><table>
                <thead><tr><th>{t.cash.date}</th><th>{t.rep.pm.ref}</th><th>{t.rep.pm.project}</th><th>{t.rep.pm.type}</th>
                  <th className="n">{t.rep.pm.before}</th><th className="n">{t.rep.pm.vat}</th><th className="n">{t.rep.pm.total}</th></tr></thead>
                <tbody>{b.s.map((x) => (
                  <tr key={x.id}><td className="num">{x.date}</td><td className="num"><a href={`/sales/${x.id}`}>{x.ref}</a></td><td className="num">{x.project}</td><td>{x.type}</td>
                    <td className="n num">{money(x.base)}</td><td className="n num">{money(x.vat)}</td><td className="n num">{money(x.total)}</td></tr>))}</tbody>
                <tfoot><tr><th colSpan={4}>{t.rep.total}</th><th className="n num">{money(sum(b.s, (x) => x.base))}</th><th className="n num">{money(out)}</th><th className="n num">{money(sum(b.s, (x) => x.total))}</th></tr></tfoot>
              </table></div>
            ) : <p className="muted">—</p>}
            <h3>{t.rep.pm.purch} ({b.p.length})</h3>
            {b.p.length > 0 ? (
              <div className="table-wrap"><table>
                <thead><tr><th>{t.cash.date}</th><th>{t.rep.pm.supplier}</th><th>{t.rep.pm.ref}</th><th>{t.rep.pm.project}</th>
                  <th className="n">{t.rep.pm.before}</th><th className="n">{t.rep.pm.ded}</th><th className="n">{t.rep.pm.total}</th></tr></thead>
                <tbody>{b.p.map((x) => (
                  <tr key={x.id}><td className="num">{x.date}</td><td><a href={`/purchases/${x.id}`}>{x.supplier}</a></td><td className="num">{x.ref}</td><td className="num">{x.project}</td>
                    <td className="n num">{money(x.net)}</td><td className="n num">{money(x.ded)}</td><td className="n num">{money(x.total)}</td></tr>))}</tbody>
                <tfoot><tr><th colSpan={4}>{t.rep.total}</th><th className="n num">{money(sum(b.p, (x) => x.net))}</th><th className="n num">{money(inp)}</th><th className="n num">{money(sum(b.p, (x) => x.total))}</th></tr></tfoot>
              </table></div>
            ) : <p className="muted">—</p>}
          </section>
        );
      })}
    </div>
  );
}
