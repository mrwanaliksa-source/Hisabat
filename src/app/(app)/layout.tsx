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

  const all: (NavItem & { key: string })[] = [
    { key: "home", href: "/", label: t.nav.home, icon: "home", ready: true },
    { key: "projects", href: "/projects", label: t.nav.projects, icon: "projects", ready: true },
    { key: "sales", href: "/sales", label: t.nav.sales, icon: "sales", ready: true },
    { key: "purchases", href: "/purchases", label: t.nav.purchases, icon: "purchases", ready: true },
    { key: "custody", href: "/custody", label: t.nav.custody, icon: "camera", ready: true },
    { key: "cash", href: "/cash", label: t.nav.cash, icon: "cash", ready: true },
    { key: "review", href: "/review", label: t.nav.review, icon: "review", ready: true },
    { key: "reports", href: "/reports", label: t.nav.reports, icon: "reports", ready: true },
    { key: "settings", href: "/settings", label: t.nav.settings, icon: "settings", ready: true },
  ];
  const allowed: Record<string, string[]> = {
    admin: all.map((i) => i.key),
    reviewer: all.map((i) => i.key).filter((k) => k !== "settings"),
    entry: ["home", "projects", "sales", "review"],
    expense: ["home", "purchases", "custody"],
    custody: ["home", "custody"],
  };
  const items: NavItem[] = all.filter((i) => (allowed[ctx.role ?? ""] ?? ["home"]).includes(i.key));

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
