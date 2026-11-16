import { setLanguage } from "@/app/actions";
import type { Lang } from "@/lib/i18n";

export function LangSwitch({ lang }: { lang: Lang }) {
  return (
    <form action={setLanguage} className="lang-switch">
      <button name="lang" value="ar" className={lang === "ar" ? "on" : ""} lang="ar">العربية</button>
      <span aria-hidden>|</span>
      <button name="lang" value="en" className={lang === "en" ? "on" : ""} lang="en">English</button>
    </form>
  );
}
