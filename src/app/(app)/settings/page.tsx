import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { dict, getLang } from "@/lib/i18n";
import { addMember, updateMember, saveCompany, createUser, resetPassword, addCompany, saveAccess, addBank, linkBank, saveOwner } from "./actions";
import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { displayLogin } from "@/lib/username";

const ROLES = ["admin", "reviewer", "entry", "expense", "custody"] as const;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role, user, memberships } = await getContext();
  if (!company) return null;
  if (role !== "admin") redirect("/");

  const [{ data: members }, { data: co }] = await Promise.all([
    supabase.from("memberships").select("user_id,role,is_active").eq("company_id", company.id),
    supabase.from("companies").select("custody_approver_1,custody_approver_2,vat_period,slug").eq("id", company.id).maybeSingle(),
  ]);
  const [{ data: bankAccts }, { data: projList }] = await Promise.all([
    supabase.from("accounts").select("id,code,name_ar,project_id").eq("company_id", company.id).eq("is_bank", true).order("code"),
    supabase.from("projects").select("id,code,name_ar").eq("company_id", company.id).neq("status", "closed").order("code"),
  ]);
  const { data: owners } = await supabase.from("company_owners").select("id,name,share_pct,is_active").eq("company_id", company.id).order("created_at");
  const ownTotal = (owners ?? []).filter((o) => o.is_active).reduce((a, o) => a + Number(o.share_pct), 0);
  // companies where I am admin → access matrix
  const adminCos = memberships.filter((m) => m.role === "admin").map((m) => m.company);
  const { data: allMem } = adminCos.length
    ? await supabase.from("memberships").select("company_id,user_id,role,is_active").in("company_id", adminCos.map((c) => c.id))
    : { data: [] };
  const matrixIds = [...new Set((allMem ?? []).map((m) => m.user_id))];
  const { data: matrixProfiles } = matrixIds.length ? await supabase.from("profiles").select("id,full_name").in("id", matrixIds) : { data: [] };
  const roleOf = (c: string, u: string) => (allMem ?? []).find((m) => m.company_id === c && m.user_id === u && m.is_active)?.role ?? "none";
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  const coName = (c: { name_ar: string; name_en: string | null }) => (lang === "en" && c.name_en) || c.name_ar;
  const ids = [...new Set([...(members ?? []).map((m) => m.user_id), ...matrixIds])];
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
      {sp.ok && <p className="alert ok">✓ {sp.ok === "company" ? t.co.added : sp.ok === "access" ? t.co.saved : t.set.saved}</p>}

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
          <label className="field"><span>{t.co.slug}</span>
            <input name="slug" dir="ltr" defaultValue={co?.slug ?? ""} />
            <small className="muted num">{origin}/login?c={co?.slug ?? ""}</small></label>
          <label className="field"><span>{t.set.vatPeriod}</span>
            <select name="vat_period" defaultValue={co?.vat_period ?? "quarterly"}>
              <option value="monthly">{t.pp.monthly}</option><option value="quarterly">{t.pp.quarterly}</option>
            </select></label>
        </div>
        <button className="btn primary self-start" data-act="save-company">{t.set.save}</button>
      </form>

      <section className="card stack" id="owners">
        <h2>{t.own.title}</h2>
        <p className="muted small">{t.own.hint}</p>
        {owners && owners.length > 0 && (
          <table>
            <thead><tr><th>{t.own.name}</th><th className="n">{t.own.pct}</th><th>{t.own.active}</th><th /></tr></thead>
            <tbody>
              {owners.map((o) => (
                <tr key={o.id} className={o.is_active ? "" : "muted"}>
                  <td><input form={`o-${o.id}`} name="name" defaultValue={o.name} required /></td>
                  <td className="n"><input form={`o-${o.id}`} name="pct" defaultValue={String(Number(o.share_pct))} dir="ltr" inputMode="decimal" className="pw-input" /></td>
                  <td><input form={`o-${o.id}`} type="checkbox" name="active" value="1" defaultChecked={o.is_active} /></td>
                  <td><form id={`o-${o.id}`} action={saveOwner}><input type="hidden" name="id" value={o.id} />
                    <button className="btn ghost sm" data-act="save-owner">{t.set.save}</button></form></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><th>{t.own.total}</th><th className={`n num ${ownTotal > 100.0005 ? "warn-text" : ""}`}>{ownTotal.toLocaleString("en", { maximumFractionDigits: 3 })}٪</th><th colSpan={2} /></tr></tfoot>
          </table>
        )}
        <form action={saveOwner} className="grid-3 mt">
          <label className="field"><span>{t.own.name}<b className="req"> *</b></span><input name="name" required /></label>
          <label className="field"><span>{t.own.pct}</span><input name="pct" dir="ltr" inputMode="decimal" placeholder="0" /></label>
          <div className="field"><span>&nbsp;</span><button className="btn primary" data-act="add-owner">{t.own.add}</button></div>
        </form>
      </section>

      <section className="card stack" id="banks">
        <h2>{t.parts.banks}</h2>
        <p className="muted small">{t.parts.bankHint}</p>
        <table>
          <tbody>
            {(bankAccts ?? []).map((b) => (
              <tr key={b.id}>
                <td className="num muted">{b.code}</td><td><b>{b.name_ar}</b></td>
                <td>
                  <form action={linkBank} className="inline-form">
                    <input type="hidden" name="account" value={b.id} />
                    <select name="project" defaultValue={b.project_id ?? ""}>
                      <option value="">{t.parts.general}</option>
                      {(projList ?? []).map((pj) => <option key={pj.id} value={pj.id}>{t.parts.holds} {pj.code} · {pj.name_ar}</option>)}
                    </select>
                    <button className="btn ghost sm" data-act="link-bank">{t.set.save}</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={addBank} className="grid-3 mt">
          <label className="field"><span>{t.parts.bankName}<b className="req"> *</b></span><input name="name" required /></label>
          <label className="field"><span>{t.parts.holds}</span>
            <select name="project" defaultValue=""><option value="">{t.parts.general}</option>
              {(projList ?? []).map((pj) => <option key={pj.id} value={pj.id}>{pj.code} · {pj.name_ar}</option>)}</select></label>
          <div className="field"><span>&nbsp;</span><button className="btn primary" data-act="add-bank">{t.parts.addBank}</button></div>
        </form>
      </section>

      {adminCos.length > 0 && (
        <section className="card" id="access">
          <h2>{t.co.access}</h2>
          <p className="muted small">{t.co.accessHint}</p>
          <div className="table-wrap">
            <table className="access-matrix">
              <thead><tr><th>{t.cus.holder}</th><th>{t.set.login}</th>{adminCos.map((c) => <th key={c.id}>{coName(c)}</th>)}</tr></thead>
              <tbody>
                {matrixIds.map((uid) => (
                  <tr key={uid}>
                    <td>{matrixProfiles?.find((p) => p.id === uid)?.full_name ?? uid.slice(0, 8)} {uid === user.id && <span className="muted small">({t.set.you})</span>}</td>
                    <td className="num muted">{logins.get(uid) ?? ""}</td>
                    {adminCos.map((c) => {
                      const r = roleOf(c.id, uid);
                      return (
                        <td key={c.id}>
                          {uid === user.id ? <span className="chip tiny">{r === "none" ? "—" : t.role[r as keyof typeof t.role]}</span> : (
                            <form action={saveAccess} className="inline-form">
                              <input type="hidden" name="company" value={c.id} />
                              <input type="hidden" name="user" value={uid} />
                              <select name="role" defaultValue={r} className={r === "none" ? "muted" : ""}>
                                <option value="none">{t.co.none}</option>
                                {ROLES.map((x) => <option key={x} value={x}>{t.role[x]}</option>)}
                              </select>
                              <button className="btn ghost sm" data-act="access">{t.set.save}</button>
                            </form>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card stack" id="companies">
        <h2>{t.co.companies}</h2>
        <table>
          <tbody>
            {memberships.map((m) => (
              <tr key={m.company.id}>
                <td><b>{coName(m.company)}</b></td>
                <td><span className="chip tiny">{t.role[m.role]}</span></td>
                <td className="num muted small" dir="ltr">{m.company.slug ? `${origin}/login?c=${m.company.slug}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={addCompany} className="stack mt">
          <h3>{t.co.add}</h3>
          <p className="muted small">{t.co.addHint}</p>
          <div className="grid-2">
            <label className="field"><span>{t.co.nameAr}<b className="req"> *</b></span><input name="name_ar" required /></label>
            <label className="field"><span>{t.co.nameEn}</span><input name="name_en" dir="ltr" /></label>
            <label className="field"><span>{t.co.slug}<b className="req"> *</b></span>
              <input name="slug" required dir="ltr" autoCapitalize="none" />
              <small className="muted">{t.co.slugHint}</small></label>
            <label className="field"><span>{t.co.vat}</span><input name="vat_number" dir="ltr" inputMode="numeric" /></label>
          </div>
          <button className="btn primary self-start" data-act="add-company">{t.co.add}</button>
        </form>
      </section>
    </div>
  );
}
