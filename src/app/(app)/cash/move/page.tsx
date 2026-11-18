import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { MoveForm } from "./MoveForm";
import { deleteMove } from "./actions";

export default async function MovePage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!canManage(role)) redirect("/");
  const [{ data: banks }, { data: projects }, { data: tb }, { data: moves }] = await Promise.all([
    supabase.from("accounts").select("id,code,name_ar,name_en,project_id").eq("company_id", company.id).eq("is_bank", true).eq("is_active", true).order("code"),
    supabase.from("projects").select("id,code,name_ar").eq("company_id", company.id).neq("status", "closed").order("code"),
    supabase.from("v_trial_balance").select("account_id,balance").eq("company_id", company.id),
    supabase.from("account_transfers").select("id,transfer_date,amount,from_account_id,to_account_id,project_id,reference,notes")
      .eq("company_id", company.id).order("transfer_date", { ascending: false }).limit(100),
  ]);
  const bal = new Map((tb ?? []).map((r) => [r.account_id, Number(r.balance)]));
  const bn = new Map((banks ?? []).map((b) => [b.id, `${b.code} · ${(lang === "en" && b.name_en) || b.name_ar}`]));
  const pc = new Map((projects ?? []).map((p) => [p.id, p.code]));

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1 className="page-title">{t.mv.title}</h1>
        <Link href="/cash" className="btn ghost">{t.back}</Link>
      </div>
      {sp.err && <p className="alert error">{sp.err}</p>}
      {sp.ok && <p className="alert ok">✓ {sp.ok === "deleted" ? t.mv.deleted : t.mv.saved}</p>}
      <MoveForm t={t}
        banks={(banks ?? []).map((b) => ({ id: b.id, name: bn.get(b.id) ?? "", balance: bal.get(b.id) ?? 0, projectId: b.project_id }))}
        projects={(projects ?? []).map((p) => ({ id: p.id, name: `${p.code} · ${p.name_ar}` }))} />
      <section className="card">
        <h2>{t.mv.list}</h2>
        {moves && moves.length > 0 ? (
          <div className="table-wrap"><table>
            <thead><tr><th>{t.cash.date}</th><th>{t.mv.from}</th><th>{t.mv.to}</th><th>{t.mv.whose}</th><th>{t.mv.notes}</th><th className="n">{t.cash.payAmount}</th>{role === "admin" && <th />}</tr></thead>
            <tbody>{moves.map((m) => (
              <tr key={m.id}>
                <td className="num">{m.transfer_date}</td><td>{bn.get(m.from_account_id)}</td><td>{bn.get(m.to_account_id)}</td>
                <td className="num">{m.project_id ? pc.get(m.project_id) ?? "—" : t.mv.general}</td>
                <td className="muted">{[m.notes, m.reference].filter(Boolean).join(" · ")}</td>
                <td className="n num">{money(m.amount)}</td>
                {role === "admin" && <td>
                  <form action={deleteMove} className="inline-form">
                    <input type="hidden" name="id" value={m.id} />
                    <input name="reason" required placeholder={t.exp.reason} className="pw-input" />
                    <button className="btn ghost sm danger" data-act="delete-move">✕</button>
                  </form></td>}
              </tr>))}
            </tbody>
          </table></div>
        ) : <p className="muted">{t.mv.none}</p>}
      </section>
    </div>
  );
}
