import Link from "next/link";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { Icon } from "@/components/Icon";

type TB = { account_id: string; type: string; balance: number; debit: number; credit: number };

export default async function Dashboard() {
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  const manager = canManage(role);

  let kpis: { label: string; value: number; icon: string; tone?: string }[] = [];
  if (manager) {
    const [{ data: tb }, { data: accts }, { data: partners }] = await Promise.all([
      supabase.from("v_trial_balance").select("account_id,type,balance,debit,credit").eq("company_id", company.id),
      supabase.from("accounts").select("id,system_key,is_bank").eq("company_id", company.id),
      supabase.from("v_partner_balances").select("outstanding").eq("company_id", company.id),
    ]);
    const byId = new Map((accts ?? []).map((a) => [a.id, a]));
    const rows = (tb ?? []) as TB[];
    const sum = (f: (r: TB) => boolean, v: (r: TB) => number) => rows.filter(f).reduce((s, r) => s + Number(v(r)), 0);
    const key = (r: TB) => byId.get(r.account_id)?.system_key;
    kpis = [
      { label: t.kpi.sales, value: sum((r) => r.type === "revenue", (r) => -r.balance), icon: "reports" },
      { label: t.kpi.costs, value: sum((r) => r.type === "expense", (r) => r.balance), icon: "purchases" },
      { label: t.kpi.cash, value: sum((r) => !!byId.get(r.account_id)?.is_bank, (r) => r.balance), icon: "cash" },
      {
        label: t.kpi.vat,
        value: sum((r) => key(r) === "vat_output", (r) => -r.balance) - sum((r) => key(r) === "vat_input", (r) => r.balance),
        icon: "sales",
      },
      { label: t.kpi.partner, value: (partners ?? []).reduce((s, p) => s + Number(p.outstanding), 0), icon: "projects" },
    ];
  }

  const { data: projects } = await supabase
    .from("v_project_advance_retention")
    .select("project_id,code,name_ar,contract_value,works_certified,advance_outstanding,retention_outstanding")
    .eq("company_id", company.id)
    .order("code")
    .limit(8);

  return (
    <div className="stack-lg">
      <h1 className="page-title">{t.dashboard}</h1>

      {manager ? (
        <section className="kpis">
          {kpis.map((k) => (
            <div key={k.label} className="kpi">
              <span className="kpi-icon"><Icon name={k.icon} /></span>
              <span className="kpi-label">{k.label}</span>
              <span className="kpi-value num">{money(k.value)} <small>{t.sar}</small></span>
            </div>
          ))}
        </section>
      ) : (
        <p className="muted">{t.kpiHidden}</p>
      )}

      <section className="shortcuts">
        <Link href="/sales" className="btn primary"><Icon name="plus" /> {t.shortcuts.addInvoice}</Link>
        <Link href="/purchases" className="btn primary"><Icon name="camera" /> {t.shortcuts.captureExpense}</Link>
        <Link href="/cash" className="btn soft"><Icon name="in" /> {t.shortcuts.receipt}</Link>
        <Link href="/cash" className="btn soft"><Icon name="out" /> {t.shortcuts.payment}</Link>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{t.projects}</h2>
          <Link href="/projects" className="link">{t.projects} {lang === "ar" ? "←" : "→"}</Link>
        </div>
        {projects && projects.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t.col.code}</th><th>{t.col.name}</th><th className="n">{t.col.contract}</th>
                  <th className="n">{t.col.certified}</th><th className="n">{t.col.advOut}</th><th className="n">{t.col.retOut}</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.project_id}>
                    <td><Link href={`/projects/${p.project_id}`} className="link num">{p.code}</Link></td>
                    <td>{p.name_ar}</td>
                    <td className="n num">{money(p.contract_value)}</td>
                    <td className="n num">{money(p.works_certified)}</td>
                    <td className="n num">{money(p.advance_outstanding)}</td>
                    <td className="n num">{money(p.retention_outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">{t.noProjects}</p>
        )}
      </section>
    </div>
  );
}
