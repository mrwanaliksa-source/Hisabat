import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { ReportHeader } from "@/components/ReportHeader";

export default async function AdvancesReport() {
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!canManage(role)) redirect("/");
  const { data } = await supabase.from("v_project_advance_retention").select("*").eq("company_id", company.id).order("code");
  const rows = (data ?? []).filter((r) => Number(r.advance_amount) || Number(r.advance_invoiced) || Number(r.retention_held));
  const sum = (k: string) => rows.reduce((s, r) => s + Number((r as Record<string, unknown>)[k] ?? 0), 0);
  const cols = ["contract_value", "works_certified", "advance_invoiced", "advance_recovered", "advance_outstanding", "retention_held", "retention_released", "retention_outstanding"];
  const heads = [t.col.contract, t.col.certified, t.detail.advInvoiced, t.detail.advRecovered, t.col.advOut, t.detail.retHeld, t.detail.retReleased, t.col.retOut];
  return (
    <div className="stack-lg" id="report">
      <ReportHeader t={t} title={t.rep.adv.t} desc={t.rep.adv.d} name="advances-retention" />
      <section className="card">
        {rows.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>{t.col.code}</th><th>{t.col.name}</th>{heads.map((h) => <th key={h} className="n">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.project_id}><td><Link className="link num" href={`/projects/${r.project_id}`}>{r.code}</Link></td><td>{r.name_ar}</td>
                {cols.map((c) => <td key={c} className={`n num ${c.endsWith("outstanding") ? "strong" : ""}`}>{money((r as Record<string, unknown>)[c] as number)}</td>)}</tr>))}</tbody>
            <tfoot><tr><th colSpan={2}>{t.rep.total}</th>{cols.map((c) => <th key={c} className="n num">{money(sum(c))}</th>)}</tr></tfoot>
          </table></div>
        ) : <p className="muted">{t.rep.none}</p>}
      </section>
    </div>
  );
}
