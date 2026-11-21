import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { saveSupplier } from "./actions";

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; q?: string }> }) {
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!canManage(role)) redirect("/purchases");
  const [{ data: sups }, { data: docs }, { data: bal }] = await Promise.all([
    supabase.from("parties").select("id,name_ar,vat_number").eq("company_id", company.id).eq("kind", "supplier").order("name_ar"),
    supabase.from("purchase_documents").select("id,supplier_id,total_amount").eq("company_id", company.id).eq("status", "posted"),
    supabase.from("v_purchase_balances").select("id,balance").eq("company_id", company.id),
  ]);
  const left = new Map((bal ?? []).map((b) => [b.id, Number(b.balance)]));
  const agg = new Map<string, { n: number; total: number; due: number }>();
  for (const d of docs ?? []) {
    const a = agg.get(d.supplier_id) ?? { n: 0, total: 0, due: 0 };
    a.n += 1; a.total += Number(d.total_amount); a.due += left.get(d.id) ?? 0; agg.set(d.supplier_id, a);
  }
  const q = (sp.q ?? "").trim().toLowerCase();
  const rows = (sups ?? []).filter((s) => !q || s.name_ar.toLowerCase().includes(q) || (s.vat_number ?? "").includes(q));

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1 className="page-title">{t.sup.title}</h1>
        <Link href="/purchases" className="btn ghost">{t.back}</Link>
      </div>
      {sp.err && <p className="alert error">{sp.err}</p>}
      {sp.ok && <p className="alert ok">✓ {t.set.saved}</p>}
      <p className="muted small">{t.sup.hint}</p>
      <form className="inline-form"><input name="q" defaultValue={sp.q} placeholder={t.sup.search} /><button className="btn ghost sm">🔍</button></form>
      <section className="card">
        <div className="table-wrap"><table>
          <thead><tr><th>{t.sup.name}</th><th>{t.sup.vat}</th><th className="n">{t.sup.invoices}</th><th className="n">{t.sup.total}</th><th className="n">{t.exp.balance}</th><th /></tr></thead>
          <tbody>{rows.map((s) => {
            const a = agg.get(s.id) ?? { n: 0, total: 0, due: 0 };
            const form = `f-${s.id}`;
            return (
              <tr key={s.id} id={`s-${s.id}`}>
                <td><input form={form} name="name" defaultValue={s.name_ar} required /></td>
                <td><input form={form} name="vat" defaultValue={s.vat_number ?? ""} dir="ltr" inputMode="numeric" maxLength={15} placeholder="3xxxxxxxxxxxxx3" /></td>
                <td className="n num"><Link className="link" href={`/purchases?supplier=${s.id}`}>{a.n}</Link></td>
                <td className="n num">{money(a.total)}</td>
                <td className="n num">{a.due > 0.004 ? <b className="warn-text">{money(a.due)}</b> : "—"}</td>
                <td><form id={form} action={saveSupplier}><input type="hidden" name="id" value={s.id} />
                  <button className="btn ghost sm" data-act="save-supplier">{t.set.save}</button></form></td>
              </tr>);
          })}</tbody>
        </table></div>
      </section>
    </div>
  );
}
