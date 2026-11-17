import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { decideCustody } from "../actions";
import { SettleForm } from "./SettleForm";

type Params = Promise<{ id: string }>;

export default async function CustodyDetail({ params, searchParams }: { params: Params; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role, user } = await getContext();
  if (!company) return null;
  const manager = canManage(role);

  const { data: c } = await supabase.from("v_custody").select("*").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!c) notFound();
  const [{ data: co }, { data: banks }, { data: settlements }, { data: projects }, { data: suppliers }, { data: req }] = await Promise.all([
    supabase.from("companies").select("custody_approver_1,custody_approver_2").eq("id", company.id).maybeSingle(),
    supabase.from("accounts").select("id,code,name_ar,name_en").eq("company_id", company.id).eq("is_bank", true).order("code"),
    supabase.from("custody_settlements").select("id,kind,amount,created_at,doc:purchase_documents(id,details,issue_date,supplier:parties!purchase_documents_supplier_id_fkey(name_ar))").eq("custody_id", id).order("created_at"),
    supabase.from("projects").select("id,code,name_ar,name_en").eq("company_id", company.id).neq("status", "closed").order("code"),
    supabase.from("parties").select("name_ar,vat_number").eq("company_id", company.id).eq("kind", "supplier").order("name_ar").limit(500),
    supabase.from("custody_requests").select("approved1_by,approved2_by,project_id").eq("id", id).maybeSingle(),
  ]);
  const { data: names } = await supabase.from("profiles").select("id,full_name")
    .in("id", [co?.custody_approver_1, co?.custody_approver_2].filter(Boolean) as string[]);
  const nameOf = (uid?: string | null) => (names ?? []).find((n) => n.id === uid)?.full_name ?? "—";
  const nm = (x: { name_ar: string; name_en: string | null }) => (lang === "en" && x.name_en) || x.name_ar;

  const myStage = (c.status === "pending_1" && co?.custody_approver_1 === user.id) ? 1
                : (c.status === "pending_2" && co?.custody_approver_2 === user.id) ? 2 : 0;
  const canSettle = c.status === "open" && (manager || role === "expense");

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <p className="eyebrow">{t.cus.title}</p>
          <h1 className="page-title">{c.holder_name} · <span className="num">{money(c.amount)}</span></h1>
          <p className="muted">{c.purpose}</p>
        </div>
        <span className={`chip big cs-${c.status}`}>{t.cus.st[c.status as keyof typeof t.cus.st]}</span>
      </div>
      {sp.err && <p className="alert error">{sp.err}</p>}
      {sp.ok && sp.ok !== "1" && <p className="alert ok">✓</p>}

      <div className="grid-2 top">
        <section className="card">
          <h2>{t.cus.approvals}</h2>
          <ol className="steps">
            <li className={req?.approved1_by ? "done" : c.status === "pending_1" ? "now" : ""}>
              <b>{t.cus.approver1}</b> · {nameOf(co?.custody_approver_1)}
              {c.approved1_at && <span className="muted small num"> · {String(c.approved1_at).slice(0, 10)}</span>}
            </li>
            <li className={req?.approved2_by ? "done" : c.status === "pending_2" ? "now" : ""}>
              <b>{t.cus.approver2}</b> · {nameOf(co?.custody_approver_2)}
              {c.disbursed_on && <span className="muted small num"> · {c.disbursed_on}</span>}
            </li>
          </ol>
          {c.status === "rejected" && <p className="alert error">{t.cus.reason}: {c.reject_reason}</p>}

          {myStage > 0 && (
            <div className="stack">
              <form action={decideCustody} className="stack">
                <input type="hidden" name="id" value={id} /><input type="hidden" name="what" value="approve" />
                {myStage === 2 && (
                  <label className="field"><span>{t.cus.payFrom}</span>
                    <select name="account" required>{(banks ?? []).map((b) => <option key={b.id} value={b.id}>{b.code} · {nm(b)}</option>)}</select></label>
                )}
                <button className="btn primary" data-act="approve">{myStage === 1 ? t.cus.approve1 : t.cus.approve2}</button>
              </form>
              <form action={decideCustody} className="stack">
                <input type="hidden" name="id" value={id} /><input type="hidden" name="what" value="reject" />
                <label className="field"><span>{t.cus.reason}<b className="req"> *</b></span><input name="reason" required /></label>
                <button className="btn ghost danger" data-act="reject">{t.cus.reject}</button>
              </form>
            </div>
          )}
        </section>

        <section className="card">
          <h2>{t.cus.balance}</h2>
          <dl className="kv">
            <div><dt>{t.cus.amount}</dt><dd className="num">{money(c.amount)}</dd></div>
            <div><dt>{t.cus.invoices}</dt><dd className="num">({money(c.invoices)})</dd></div>
            <div><dt>{t.cus.returned}</dt><dd className="num">({money(c.returned)})</dd></div>
            <div className="hl"><dt>{t.cus.balance}</dt><dd className="num">{money(c.balance)}</dd></div>
          </dl>
          {settlements && settlements.length > 0 && (
            <table className="mt">
              <tbody>
                {settlements.map((s) => {
                  const d = s.doc as unknown as { id: string; details: string | null; issue_date: string; supplier: { name_ar: string } | null } | null;
                  return (
                    <tr key={s.id}>
                      <td>{s.kind === "return" ? t.cus.returned : d ? <Link className="link" href={`/purchases/${d.id}`}>{d.supplier?.name_ar} — {d.details}</Link> : ""}</td>
                      <td className="n num">{money(s.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {canSettle && (
        <SettleForm t={t} custodyId={id} balance={Number(c.balance)} defaultProject={req?.project_id ?? ""}
          projects={(projects ?? []).map((p) => ({ id: p.id, name: `${p.code} · ${nm(p)}` }))}
          banks={(banks ?? []).map((b) => ({ id: b.id, name: `${b.code} · ${nm(b)}` }))}
          suppliers={(suppliers ?? []).map((s) => ({ name: s.name_ar, vat: s.vat_number ?? "" }))} />
      )}
      <Link href="/custody" className="btn ghost self-start">{t.back}</Link>
    </div>
  );
}
