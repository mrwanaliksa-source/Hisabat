import Link from "next/link";
import { getContext } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { Icon } from "@/components/Icon";

export default async function SalesPage() {
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company } = await getContext();
  if (!company) return null;

  const [{ data: docs }, { data: bal }] = await Promise.all([
    supabase.from("sales_documents")
      .select("id,doc_type,issuer_ref,issue_date,status,work_value,collectible_total,project:projects(code,name_ar,name_en),customer:parties(name_ar,name_en)")
      .eq("company_id", company.id).order("issue_date", { ascending: false }).order("created_at", { ascending: false }).limit(200),
    supabase.from("v_sales_document_balances").select("id,collected,balance").eq("company_id", company.id),
  ]);
  const b = new Map((bal ?? []).map((x) => [x.id, x]));
  type N = { name_ar: string; name_en: string | null; code?: string };
  const nm = (x: unknown) => { const v = x as N | null; return v ? (lang === "en" && v.name_en) || v.name_ar : "—"; };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1 className="page-title">{t.sales.title}</h1>
        <Link href="/sales/new" className="btn primary"><Icon name="plus" /> {t.sales.newDoc}</Link>
      </div>
      <section className="card">
        {docs && docs.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t.sales.issuerRef}</th><th>{t.sales.docType}</th><th>{t.sales.project}</th><th>{t.cash.customer}</th>
                  <th>{t.sales.issueDate}</th><th className="n">{t.sales.workValue}</th><th className="n">{t.form.due}</th>
                  <th className="n">{t.sales.collected}</th><th className="n">{t.sales.balance}</th><th>{t.col.status}</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => {
                  const x = b.get(d.id);
                  const posted = d.status === "posted";
                  return (
                    <tr key={d.id}>
                      <td><Link className="link num" href={`/sales/${d.id}`}>{d.issuer_ref || "—"}</Link></td>
                      <td><Link href={`/sales/${d.id}`}>{t.docType[d.doc_type as keyof typeof t.docType]}</Link></td>
                      <td><span className="num">{(d.project as unknown as N)?.code}</span> {nm(d.project)}</td>
                      <td>{nm(d.customer)}</td>
                      <td className="num">{d.issue_date}</td>
                      <td className="n num">{money(d.work_value)}</td>
                      <td className="n num">{posted ? money(d.collectible_total) : "—"}</td>
                      <td className="n num">{posted ? money(x?.collected) : "—"}</td>
                      <td className="n num">{posted ? money(x?.balance) : "—"}</td>
                      <td><span className={`chip ds-${d.status}`}>{t.docStatus[d.status as keyof typeof t.docStatus]}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">{t.sales.noDocs}</p>}
      </section>
    </div>
  );
}
