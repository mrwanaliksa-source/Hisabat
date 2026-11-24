import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { deleteOwnerAdvance } from "./actions";
import { OwnerAdvanceForm } from "./OwnerAdvanceForm";

export default async function OwnersPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!canManage(role)) redirect("/");
  const [{ data: banks }, { data: owners }, { data: rows }, { data: projects }, { data: byProj }, { data: ext }] = await Promise.all([
    supabase.from("accounts").select("id,code,name_ar,name_en,project_id").eq("company_id", company.id).eq("is_bank", true).eq("is_active", true).order("code"),
    supabase.from("v_owner_advances").select("owner_id,name,share_pct,is_active,advanced,repaid,balance").eq("company_id", company.id).order("name"),
    supabase.from("owner_advances").select("id,owner_id,kind,account_id,adv_date,amount,notes,project_id,ext_who").eq("company_id", company.id)
      .order("adv_date", { ascending: false }).order("created_at", { ascending: false }).limit(300),
    supabase.from("projects").select("id,code,name_ar,name_en").eq("company_id", company.id).order("code"),
    supabase.from("v_owner_advances_by_project").select("owner_id,name,project_id,balance").eq("company_id", company.id),
    supabase.from("external_funds").select("counterparty").eq("company_id", company.id).not("counterparty", "is", null).limit(500),
  ]);
  const pcode = new Map((projects ?? []).map((p) => [p.id, p.code]));
  const bn = new Map((banks ?? []).map((b) => [b.id, `${b.code} · ${(lang === "en" && b.name_en) || b.name_ar}`]));
  const bankOpt = (banks ?? []).map((b) => ({ id: b.id, name: `${bn.get(b.id)}${b.project_id ? ` — ${t.own.moneyOf} ${(projects ?? []).find((p) => p.id === b.project_id)?.code ?? ""}` : ""}` }));
  const on = new Map((owners ?? []).map((o) => [o.owner_id, o.name]));
  const act = (owners ?? []).filter((o) => o.is_active);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1 className="page-title">{t.own.adv}</h1>
        <div className="actions">
          {role === "admin" && <Link href="/settings#owners" className="btn ghost">{t.own.manage}</Link>}
          <Link href="/cash" className="btn ghost">{t.back}</Link>
        </div>
      </div>
      {sp.err && <p className="alert error">{sp.err}</p>}
      {sp.ok && <p className="alert ok">✓ {sp.ok === "deleted" ? t.mv.deleted : t.mv.saved}</p>}
      <p className="muted small">{t.own.advHint}</p>

      {act.length === 0 ? <p className="alert warn">{t.own.none}</p> : (
        <OwnerAdvanceForm t={t} owners={act.map((o) => ({ id: o.owner_id, name: `${o.name} (${Number(o.share_pct)}٪)` }))} banks={bankOpt}
          projects={(projects ?? []).map((p) => ({ id: p.id, name: `${p.code} · ${(lang === "en" && p.name_en) || p.name_ar}` }))}
          payers={[...new Set((ext ?? []).map((x) => x.counterparty as string))]} />
      )}

      {owners && owners.length > 0 && (
        <section className="card">
          <h2>{t.own.title}</h2>
          <table>
            <thead><tr><th>{t.own.name}</th><th className="n">{t.own.pct}</th><th className="n">{t.own.advanced}</th><th className="n">{t.own.repaid}</th><th className="n">{t.own.balance}</th></tr></thead>
            <tbody>{owners.map((o) => (
              <tr key={o.owner_id} className={o.is_active ? "" : "muted"}>
                <td><b>{o.name}</b></td><td className="n num">{Number(o.share_pct)}٪</td>
                <td className="n num">{money(o.advanced)}</td><td className="n num">{money(o.repaid)}</td>
                <td className="n num"><b className={Number(o.balance) > 0.004 ? "warn-text" : ""}>{money(o.balance)}</b></td>
              </tr>))}</tbody>
          </table>
        </section>
      )}

      {byProj && byProj.some((x) => x.project_id && Math.abs(Number(x.balance)) > 0.004) && (
        <section className="card">
          <h2>{t.own.byProject}</h2>
          <table>
            <thead><tr><th>{t.own.name}</th><th>{t.own.project}</th><th className="n">{t.own.balance}</th></tr></thead>
            <tbody>{byProj.filter((x) => Math.abs(Number(x.balance)) > 0.004).sort((a, b) => (a.name + (a.project_id ?? "")).localeCompare(b.name + (b.project_id ?? ""))).map((x) => (
              <tr key={`${x.owner_id}-${x.project_id}`}><td><b>{x.name}</b></td>
                <td className="num">{x.project_id ? pcode.get(x.project_id) ?? "—" : t.own.noProject.replace("— ", "")}</td>
                <td className="n num"><b className="warn-text">{money(x.balance)}</b></td></tr>))}</tbody>
          </table>
        </section>
      )}

      <section className="card">
        <h2>{t.own.list}</h2>
        {rows && rows.length > 0 ? (
          <div className="table-wrap"><table>
            <thead><tr><th>{t.cash.date}</th><th>{t.own.name}</th><th>{t.own.kind}</th><th>{t.own.project}</th><th>{t.own.source}</th><th>{t.mv.notes}</th><th className="n">{t.cash.payAmount}</th>{role === "admin" && <th />}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td className="num">{r.adv_date}</td><td><b>{on.get(r.owner_id)}</b></td><td>{t.own.k[r.kind as "advance" | "repay"]}</td>
                <td className="num">{r.project_id ? pcode.get(r.project_id) ?? "—" : "—"}</td>
                <td>{r.account_id ? bn.get(r.account_id) : `${t.own.outside} (${r.ext_who ?? ""})`}</td><td className="muted">{r.notes}</td>
                <td className={`n num ${r.kind === "advance" ? "warn-text" : ""}`}>{r.kind === "advance" ? "−" : "+"}{money(r.amount)}</td>
                {role === "admin" && <td>
                  <form action={deleteOwnerAdvance} className="inline-form">
                    <input type="hidden" name="id" value={r.id} />
                    <input name="reason" required placeholder={t.exp.reason} className="pw-input" />
                    <button className="btn ghost sm danger" data-act="delete-owner-advance">✕</button>
                  </form></td>}
              </tr>))}</tbody>
          </table></div>
        ) : <p className="muted">{t.mv.none}</p>}
      </section>
    </div>
  );
}
