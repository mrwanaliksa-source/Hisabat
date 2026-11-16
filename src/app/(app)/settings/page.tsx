import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { dict, getLang } from "@/lib/i18n";
import { addMember, updateMember, saveCompany, createUser, resetPassword } from "./actions";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { displayLogin } from "@/lib/username";

const ROLES = ["admin", "reviewer", "entry", "expense", "custody"] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role, user } = await getContext();
  if (!company) return null;
  if (role !== "admin") redirect("/");

  const [{ data: members }, { data: co }] = await Promise.all([
    supabase.from("memberships").select("user_id,role,is_active").eq("company_id", company.id),
    supabase.from("companies").select("custody_approver_1,custody_approver_2,vat_period").eq("id", company.id).maybeSingle(),
  ]);
  const ids = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length ? await supabase.from("profiles").select("id,full_name").in("id", ids) : { data: [] };
  const name = (id: string) => profiles?.find((p) => p.id === id)?.full_name ?? id.slice(0, 8);
  const admin = supabaseAdmin();
  const logins = new Map<string, string>();
  if (admin) {
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    (data?.users ?? []).filter((u) => ids.includes(u.id)).forEach((u) => logins.set(u.id, displayLogin(u.email)));
  }
  const active = (members ?? []).filter((m) => m.is_active);

  return (
    <div className="stack-lg">
      <h1 className="page-title">{t.set.title}</h1>
      {sp.err && <p className="alert error">{sp.err}</p>}
      {sp.ok && <p className="alert ok">✓ {t.set.saved}</p>}

      <section className="card">
        <h2>{t.set.members}</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t.cus.holder}</th><th>{t.set.login}</th><th>{t.set.role}</th><th>{t.col.status}</th><th />{admin && <th>{t.set.resetPassword}</th>}</tr></thead>
            <tbody>
              {(members ?? []).map((m) => (
                <tr key={m.user_id}>
                  <td>{name(m.user_id)} {m.user_id === user.id && <span className="muted small">({t.set.you})</span>}</td>
                  <td className="num muted">{logins.get(m.user_id) ?? ""}</td>
                  <td colSpan={m.user_id === user.id ? 3 : 1}>
                    {m.user_id === user.id ? <span className="chip">{t.role[m.role as keyof typeof t.role]}</span> : (
                      <form action={updateMember} className="inline-form">
                        <input type="hidden" name="user" value={m.user_id} />
                        <input type="hidden" name="active" value={String(m.is_active)} />
                        <select name="role" defaultValue={m.role}>
                          {ROLES.map((r) => <option key={r} value={r}>{t.role[r]}</option>)}
                        </select>
                        <button className="btn ghost sm" data-act="role">{t.set.save}</button>
                      </form>
                    )}
                  </td>
                  {m.user_id !== user.id && (
                    <>
                      <td><span className={`chip ${m.is_active ? "" : "st-closed"}`}>{m.is_active ? t.set.active : t.set.inactive}</span></td>
                      <td>
                        <form action={updateMember}>
                          <input type="hidden" name="user" value={m.user_id} />
                          <input type="hidden" name="role" value={m.role} />
                          <input type="hidden" name="active" value={String(!m.is_active)} />
                          <button className={`btn ghost sm ${m.is_active ? "danger" : ""}`} data-act="toggle">
                            {m.is_active ? t.set.deactivate : t.set.activate}</button>
                        </form>
                      </td>
                    </>
                  )}
                  {admin && (
                    <td>
                      <form action={resetPassword} className="inline-form">
                        <input type="hidden" name="user" value={m.user_id} />
                        <input type="password" name="password" minLength={8} required placeholder="••••••••" className="pw-input" autoComplete="new-password" />
                        <button className="btn ghost sm" data-act="reset">{t.set.resetBtn}</button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form action={createUser} className="stack mt">
          <h3>{t.set.create}</h3>
          {!admin ? <p className="alert warn">{t.set.noServiceKey}</p> : (
            <>
              <div className="grid-2">
                <label className="field"><span>{t.set.fullName}<b className="req"> *</b></span><input name="full_name" required /></label>
                <label className="field"><span>{t.set.role}</span>
                  <select name="role" defaultValue="expense">{ROLES.map((r) => <option key={r} value={r}>{t.role[r]}</option>)}</select></label>
                <label className="field"><span>{t.set.username}<b className="req"> *</b></span>
                  <input name="username" required dir="ltr" autoCapitalize="none" spellCheck={false} pattern="[a-z0-9][a-z0-9._\-]{2,29}" autoComplete="off" />
                  <small className="muted">{t.set.usernameHint}</small></label>
                <label className="field"><span>{t.set.newPassword}<b className="req"> *</b></span>
                  <input name="password" type="password" required minLength={8} dir="ltr" autoComplete="new-password" />
                  <small className="muted">{t.set.passwordHint}</small></label>
              </div>
              <button className="btn primary self-start" data-act="create">{t.set.createBtn}</button>
            </>
          )}
        </form>

        <form action={addMember} className="stack mt">
          <h3>{t.set.orExisting}</h3>
          <div className="grid-3">
            <label className="field"><span>{t.set.email}</span><input type="text" name="email" dir="ltr" autoCapitalize="none" required /></label>
            <label className="field"><span>{t.set.role}</span>
              <select name="role" defaultValue="expense">{ROLES.map((r) => <option key={r} value={r}>{t.role[r]}</option>)}</select></label>
            <div className="field"><span>&nbsp;</span><button className="btn primary" data-act="add">{t.set.add}</button></div>
          </div>
        </form>
      </section>

      <form action={saveCompany} className="card stack">
        <h2>{t.set.approvers}</h2>
        <p className="muted small">{t.set.approversHint}</p>
        <div className="grid-2">
          <label className="field"><span>{t.cus.approver1}</span>
            <select name="approver_1" defaultValue={co?.custody_approver_1 ?? ""}>
              <option value="">—</option>{active.map((m) => <option key={m.user_id} value={m.user_id}>{name(m.user_id)}</option>)}
            </select></label>
          <label className="field"><span>{t.cus.approver2}</span>
            <select name="approver_2" defaultValue={co?.custody_approver_2 ?? ""}>
              <option value="">—</option>{active.map((m) => <option key={m.user_id} value={m.user_id}>{name(m.user_id)}</option>)}
            </select></label>
          <label className="field"><span>{t.set.vatPeriod}</span>
            <select name="vat_period" defaultValue={co?.vat_period ?? "quarterly"}>
              <option value="monthly">{t.pp.monthly}</option><option value="quarterly">{t.pp.quarterly}</option>
            </select></label>
        </div>
        <button className="btn primary self-start" data-act="save-company">{t.set.save}</button>
      </form>
    </div>
  );
}
