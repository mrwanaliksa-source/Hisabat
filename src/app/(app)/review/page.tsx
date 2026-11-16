import Link from "next/link";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { docAction } from "../sales/[id]/actions";

export default async function ReviewPage() {
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  const manager = canManage(role);

  const { data: docs } = await supabase.from("sales_documents")
    .select("id,doc_type,issuer_ref,issue_date,status,work_value,review_reason,project:projects(code,name_ar,name_en)")
    .eq("company_id", company.id).in("status", manager ? ["submitted"] : ["submitted", "needs_info", "rejected"])
    .order("submitted_at", { ascending: true });
  type N = { name_ar: string; name_en: string | null; code: string };

  return (
    <div className="stack-lg">
      <h1 className="page-title">{t.review.title}</h1>
      <section className="card">
        {docs && docs.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>{t.sales.docType}</th><th>{t.sales.issuerRef}</th><th>{t.sales.project}</th><th>{t.sales.issueDate}</th>
                  <th className="n">{t.sales.workValue}</th><th>{t.col.status}</th><th /></tr>
              </thead>
              <tbody>
                {docs.map((d) => {
                  const p = d.project as unknown as N;
                  return (
                    <tr key={d.id}>
                      <td>{t.docType[d.doc_type as keyof typeof t.docType]}</td>
                      <td className="num">{d.issuer_ref ?? "—"}</td>
                      <td><span className="num">{p.code}</span> {(lang === "en" && p.name_en) || p.name_ar}</td>
                      <td className="num">{d.issue_date}</td>
                      <td className="n num">{money(d.work_value)}</td>
                      <td><span className={`chip ds-${d.status}`}>{t.docStatus[d.status as keyof typeof t.docStatus]}</span></td>
                      <td className="actions">
                        <Link className="btn ghost sm" href={`/sales/${d.id}`}>{t.review.open}</Link>
                        {manager && d.status === "submitted" && (
                          <form action={docAction}>
                            <input type="hidden" name="id" value={d.id} /><input type="hidden" name="what" value="approve" />
                            <button className="btn primary sm" data-act="approve">{t.sales.approve}</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">{t.review.empty}</p>}
      </section>
    </div>
  );
}
