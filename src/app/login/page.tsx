import { dict, getLang } from "@/lib/i18n";
import { LangSwitch } from "@/components/LangSwitch";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const lang = await getLang();
  const t = dict(lang);
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-top">
          <div className="brand dark">
            <span className="brand-mark" aria-hidden><i /><i /><i /></span>
            <span><b>حسابات</b><small>Hisabat</small></span>
          </div>
          <LangSwitch lang={lang} />
        </div>
        <h1>{t.login}</h1>
        <LoginForm labels={{ email: t.email, password: t.password, btn: t.loginBtn, busy: t.loggingIn, error: t.loginError }} />
      </div>
    </div>
  );
}
