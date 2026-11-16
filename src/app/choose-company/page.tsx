import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { dict, getLang } from "@/lib/i18n";
import { LangSwitch } from "@/components/LangSwitch";
import { signOut } from "@/app/actions";

export default async function ChooseCompany({ searchParams }: { searchParams: Promise<{ c?: string; denied?: string }> }) {
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const ctx = await getContext();
  const ms = ctx.memberships;

  // direct link (?c=slug): straight in if allowed
  const wanted = sp.c?.trim().toLowerCase();
  const hit = wanted ? ms.find((m) => (m.company.slug ?? "").toLowerCase() === wanted) : null;
  if (hit) redirect(`/choose-company/go?id=${hit.company.id}`);
  const denied = !!sp.denied || (!!wanted && !hit);
  // one company and nothing to warn about → in
  if (ms.length === 1 && !denied) redirect(`/choose-company/go?id=${ms[0].company.id}`);

  const nm = (c: { name_ar: string; name_en: string | null }) => (lang === "en" && c.name_en) || c.name_ar;
  return (
    <div className="login-wrap">
      <div className="card login-card stack">
        <div className="page-head"><h1 className="page-title">{t.co.choose}</h1><LangSwitch lang={lang} /></div>
        {denied && <p className="alert error">{t.co.noAccess}</p>}
        {ms.length > 0 ? (
          <>
            <p className="muted small">{t.co.chooseHint}</p>
            <div className="company-list">
              {ms.map((m) => (
                <a key={m.company.id} className="company-pick" href={`/choose-company/go?id=${m.company.id}`} data-act="pick">
                  <b>{nm(m.company)}</b>
                  <span className="chip tiny">{t.role[m.role]}</span>
                </a>
              ))}
            </div>
          </>
        ) : <p className="muted">{t.noCompany}</p>}
        <form action={signOut}><button className="btn ghost sm">{t.logout}</button></form>
      </div>
    </div>
  );
}
