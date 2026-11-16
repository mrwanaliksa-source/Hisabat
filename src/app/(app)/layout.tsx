import { getContext } from "@/lib/context";
import { dict, getLang } from "@/lib/i18n";
import { Sidebar, type NavItem } from "@/components/Sidebar";
import { LangSwitch } from "@/components/LangSwitch";
import { Icon } from "@/components/Icon";
import { setCompany, signOut } from "@/app/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  const t = dict(lang);
  const ctx = await getContext();

  const items: NavItem[] = [
    { href: "/", label: t.nav.home, icon: "home", ready: true },
    { href: "/projects", label: t.nav.projects, icon: "projects", ready: true },
    { href: "/sales", label: t.nav.sales, icon: "sales", ready: false },
    { href: "/purchases", label: t.nav.purchases, icon: "purchases", ready: false },
    { href: "/cash", label: t.nav.cash, icon: "cash", ready: false },
    { href: "/review", label: t.nav.review, icon: "review", ready: false },
    { href: "/reports", label: t.nav.reports, icon: "reports", ready: false },
    { href: "/settings", label: t.nav.settings, icon: "settings", ready: false },
  ];

  const companyName = ctx.company ? (lang === "en" && ctx.company.name_en) || ctx.company.name_ar : "";

  return (
    <div className="shell">
      <Sidebar items={items} appName={t.appName} />
      <div className="main">
        <header className="topbar">
          <div className="topbar-company">
            {ctx.memberships.length > 1 ? (
              <form action={setCompany} className="company-switch">
                <select name="company" defaultValue={ctx.company?.id}>
                  {ctx.memberships.map((m) => (
                    <option key={m.company.id} value={m.company.id}>
                      {(lang === "en" && m.company.name_en) || m.company.name_ar}
                    </option>
                  ))}
                </select>
                <button className="btn ghost sm">↻</button>
              </form>
            ) : (
              <strong>{companyName}</strong>
            )}
            {ctx.role && <span className="chip">{t.role[ctx.role]}</span>}
          </div>
          <div className="topbar-end">
            <LangSwitch lang={lang} />
            <span className="user">{ctx.displayName}</span>
            <form action={signOut}>
              <button className="btn ghost sm" title={t.logout}><Icon name="logout" size={18} /> <span className="hide-sm">{t.logout}</span></button>
            </form>
          </div>
        </header>
        <main className="content">
          {ctx.company ? children : <div className="card empty">{t.noCompany}</div>}
        </main>
      </div>
    </div>
  );
}
