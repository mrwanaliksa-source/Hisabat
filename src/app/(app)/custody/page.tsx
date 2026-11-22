import Link from "next/link";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { requestCustody } from "./actions";
import { OpenCustodyForm } from "./OpenCustodyForm";

type SP = Promise<{ new?: string; err?: string; ok?: string }>;

export default async function CustodyPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role, user } = await getContext();
  if (!company) return null;
  const manager = canManage(role);

  const [{ data: rows }, { data: co }, { data: projects }] = await Promise.all([
    supabase.from("v_custody").select("*").eq("company_id", company.id).order("created_at", { ascending: false }).limit(200),
    supabase.from("companies").select("custody_approver_1,custody_approver_2").eq("id", company.id).maybeSingle(),
    supabase.from("projects").select("id,code,name_ar,name_en").eq("company_id", company.id).neq("status", "closed").order("code"),
  ]);
  const admin = role === "admin";
  const [{ data: banks }, { data: mem }, { data: ext }] = admin ? await Promise.all([
    supabase.from("accounts").select("id,code,name_ar,name_en").eq("company_id", company.id).eq("is_bank", true).eq("is_active", true).order("code"),
    supabase.from("memberships").select("user_id").eq("company_id", company.id).eq("is_active", true),
    supabase.from("external_funds").select("counterparty").eq("company_id", company.id).not("counterparty", "is", null).limit(500),
  ]) : [{ data: null }, { data: null }, { data: null }];
  const { data: profs } = admin && mem?.length
    ? await supabase.from("profiles").select("id,full_name").in("id", mem.map((m) => m.user_id)) : { data: null };
  const a1 = co?.custody_approver_1, a2 = co?.custody_approver_2;
  const all = rows ?? [];
  const awaiting = all.filter((r) => (r.status === "pending_1" && a1 === user.id) || (r.status === "pending_2" && a2 === user.id));
  const mine = all.filter((r) => r.user_id === user.id);
  const seeAll = manager || role === "expense";
  const list = seeAll ? all : mine;
  const noApprovers = !a1 || !a2;

  const Table = ({ items }: { items: typeof all }) => (
    <div className="table-wrap">
      <table>
        <thead><tr><th>{t.cus.holder}</th><th>{t.cus.purpose}</th><th className="n">{t.cus.amount}</th>
          <th className="n">{t.cus.balance}</th><th>{t.cus.status}</th><th /></tr></thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id}>
              <td>{r.holder_name}</td>
              <td className="clip"><Link href={`/custody/${r.id}`}>{r.purpose}</Link></td>
              <td className="n num">{money(r.amount)}</td>
              <td className="n num">{r.status === "open" ? <b>{money(r.balance)}</b> : "—"}</td>
              <td><span className={`chip cs-${r.status}`}>{t.cus.st[r.status as keyof typeof t.cus.st]}</span></td>
              <td><Link className="btn ghost sm" href={`/custody/${r.id}`}>{t.review.open}</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="stack-lg">
      <h1 className="page-title">{t.cus.title}</h1>
      {sp.err && <p className="alert error">{sp.err}</p>}

      {awaiting.length > 0 && (
        <section className="card attention">
          <h2>{t.cus.awaitingMe} ({awaiting.length})</h2>
          <Table items={awaiting} />
        </section>
      )}

      {admin && (
        <details className="card" open={!!sp.new || list.length === 0}>
          <summary><h2>{t.cus.direct}</h2></summary>
          <OpenCustodyForm t={t} me={user.id}
            banks={(banks ?? []).map((b) => ({ id: b.id, name: `${b.code} · ${(lang === "en" && b.name_en) || b.name_ar}` }))}
            projects={(projects ?? []).map((p) => ({ id: p.id, name: `${p.code} · ${(lang === "en" && p.name_en) || p.name_ar}` }))}
            members={(profs ?? []).map((p) => ({ id: p.id, name: p.full_name || "—" })).sort((a, b) => a.name.localeCompare(b.name))}
            payers={[...new Set((ext ?? []).map((x) => x.counterparty as string))]} />
        </details>
      )}

      {!admin && <details className="card" open={!!sp.new || list.length === 0}>
        <summary><h2>{t.cus.request}</h2></summary>
        {noApprovers ? <p className="alert warn">{t.cus.noApprovers}</p> : (
          <form action={requestCustody} className="stack">
            <div className="grid-2">
              <label className="field"><span>{t.cus.amount}<b className="req"> *</b></span>
                <input name="amount" inputMode="decimal" dir="ltr" required placeholder="0.00" /></label>
              <label className="field"><span>{t.cus.project}</span>
                <select name="project"><option value="">—</option>
                  {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} · {(lang === "en" && p.name_en) || p.name_ar}</option>)}
                </select></label>
            </div>
            <label className="field"><span>{t.cus.purpose}<b className="req"> *</b></span><textarea name="purpose" required rows={2} /></label>
            <button className="btn primary" data-act="request">{t.cus.send}</button>
          </form>
        )}
      </details>}

      <section className="card">
        <h2>{seeAll ? t.cus.all : t.cus.mine}</h2>
        {list.length > 0 ? <Table items={list} /> : <p className="muted">{t.cus.none}</p>}
      </section>
    </div>
  );
}
