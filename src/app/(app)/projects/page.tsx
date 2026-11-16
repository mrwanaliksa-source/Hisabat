import Link from "next/link";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { Icon } from "@/components/Icon";

export default async function ProjectsPage() {
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;

  const [{ data: projects }, { data: balances }] = await Promise.all([
    supabase.from("projects")
      .select("id,code,name_ar,name_en,status,contract_value,customer:parties(name_ar,name_en)")
      .eq("company_id", company.id).order("code"),
    supabase.from("v_project_advance_retention")
      .select("project_id,works_certified,advance_outstanding,retention_outstanding")
      .eq("company_id", company.id),
  ]);
  const bal = new Map((balances ?? []).map((b) => [b.project_id, b]));

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1 className="page-title">{t.projects}</h1>
        {canManage(role) && (
          <Link href="/projects/new" className="btn primary"><Icon name="plus" /> {t.newProject}</Link>
        )}
      </div>

      <section className="card">
        {projects && projects.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t.col.code}</th><th>{t.col.name}</th><th>{t.col.customer}</th>
                  <th className="n">{t.col.contract}</th><th className="n">{t.col.certified}</th>
                  <th className="n">{t.col.advOut}</th><th className="n">{t.col.retOut}</th><th>{t.col.status}</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const b = bal.get(p.id);
                  const cust = p.customer as unknown as { name_ar: string; name_en: string | null } | null;
                  return (
                    <tr key={p.id}>
                      <td><Link href={`/projects/${p.id}`} className="link num">{p.code}</Link></td>
                      <td><Link href={`/projects/${p.id}`}>{(lang === "en" && p.name_en) || p.name_ar}</Link></td>
                      <td>{cust ? (lang === "en" && cust.name_en) || cust.name_ar : "—"}</td>
                      <td className="n num">{money(p.contract_value)}</td>
                      <td className="n num">{money(b?.works_certified)}</td>
                      <td className="n num">{money(b?.advance_outstanding)}</td>
                      <td className="n num">{money(b?.retention_outstanding)}</td>
                      <td><span className={`chip st-${p.status}`}>{t.status[p.status as keyof typeof t.status]}</span></td>
                    </tr>
                  );
                })}
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
