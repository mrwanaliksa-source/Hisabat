import { cookies } from "next/headers";

export type Lang = "ar" | "en";

export async function getLang(): Promise<Lang> {
  const v = (await cookies()).get("lang")?.value;
  return v === "en" ? "en" : "ar";
}

const ar = {
  appName: "حسابات",
  login: "تسجيل الدخول", email: "البريد الإلكتروني", password: "كلمة المرور",
  loginBtn: "دخول", loggingIn: "جارٍ الدخول…", loginError: "البريد أو كلمة المرور غير صحيحة",
  logout: "خروج",
  noCompany: "حسابك غير مربوط بأي شركة بعد. اطلب من الأدمن إضافتك.",
  nav: {
    home: "الرئيسية", projects: "المشروعات", sales: "المبيعات", purchases: "المشتريات والمصروفات",
    cash: "المقبوضات والمدفوعات", review: "المراجعة", reports: "التقارير", settings: "الإعدادات",
  },
  role: { admin: "أدمن", reviewer: "مراجع", entry: "مدخل بيانات" },
  dashboard: "لوحة التحكم",
  kpi: {
    sales: "المبيعات قبل الضريبة", costs: "التكاليف والمصروفات", cash: "السيولة (بنك وصندوق)",
    vat: "صافي ضريبة القيمة المضافة", partner: "مستحق للشركاء",
  },
  kpiHidden: "المؤشرات المالية متاحة للمراجع والأدمن.",
  shortcuts: { addInvoice: "إضافة فاتورة", captureExpense: "تصوير مصروف", receipt: "تسجيل تحصيل", payment: "تسجيل سداد" },
  sar: "ر.س",
  projects: "المشروعات", newProject: "مشروع جديد", noProjects: "لا توجد مشروعات بعد.",
  col: {
    code: "الكود", name: "المشروع", customer: "العميل", contract: "قيمة العقد", certified: "أعمال معتمدة",
    advOut: "دفعة مقدمة غير مستردة", retOut: "محتجز قائم", status: "الحالة", profit: "إجمالي الربح",
  },
  status: { active: "نشط", on_hold: "متوقف", completed: "مكتمل", closed: "مغلق" },
  form: {
    basics: "بيانات المشروع", code: "كود المشروع", nameAr: "اسم المشروع بالعربية", nameEn: "اسم المشروع بالإنجليزية",
    customer: "العميل", chooseCustomer: "اختر عميلًا قائمًا", orNewCustomer: "أو أضف عميلًا جديدًا",
    newCustomerName: "اسم العميل الجديد", customerVat: "الرقم الضريبي للعميل", government: "جهة حكومية",
    contractValue: "قيمة العقد قبل الضريبة", startDate: "تاريخ البداية", endDate: "تاريخ النهاية",
    manager: "مدير المشروع", budget: "الموازنة التقديرية للتكاليف",
    terms: "الدفعة المقدمة والمحتجز", advancePct: "نسبة الدفعة المقدمة %", recoveryPct: "نسبة الاسترداد من كل مستخلص %",
    retentionPct: "نسبة المحتجز %", retentionCap: "سقف المحتجز % من العقد (اختياري)",
    releaseTerms: "شروط الإفراج عن المحتجز", releaseHint: "مثال: 50% عند الاستلام الابتدائي و50% عند النهائي",
    vatNote: "الضريبة تحسب على قيمة الأعمال بعد استرداد الدفعة المقدمة وقبل خصم المحتجز (المعالجة المعتمدة).",
    partner: "الشركة الشريكة", hasPartner: "يوجد شركة شريكة في هذا المشروع",
    choosePartner: "اختر شريكًا قائمًا", newPartnerName: "اسم الشركة الشريكة الجديدة",
    sharePct: "نسبة الشريك %", partnerFrom: "تاريخ سريان الاتفاق",
    partnerNote: "تحسب الحصة عند كل تحصيل فعلي، من الصافي بعد استبعاد الضريبة، وتسجل تكلفة على المشروع.",
    preview: "مثال على مستخلص", workValue: "قيمة أعمال تجريبية",
    recovery: "استرداد الدفعة المقدمة", vatBase: "وعاء الضريبة", vat: "الضريبة 15%",
    retention: "المحتجز", due: "المطلوب تحصيله", netDue: "منه صافي بدون ضريبة", partnerShare: "حصة الشريك عند التحصيل الكامل",
    save: "حفظ المشروع", saving: "جارٍ الحفظ…", cancel: "إلغاء", none: "—",
  },
  detail: {
    terms: "الشروط", balances: "الأرصدة", advanceAmount: "قيمة الدفعة المقدمة", advInvoiced: "دفعة مقدمة مفوترة",
    advRecovered: "مسترد", retHeld: "محتجز", retReleased: "مفرج عنه", partnerShareTitle: "حصة الشريك",
    entitled: "مستحق", settled: "مسدد", outstanding: "المتبقي", noPartner: "لا يوجد شريك في هذا المشروع.",
    documents: "مستندات المبيعات", noDocs: "لا توجد مستندات مبيعات بعد — تأتي في المرحلة التالية.",
    revenue: "الإيرادات", directCosts: "التكاليف المباشرة", partnerCost: "تكلفة حصة الشريك", grossProfit: "إجمالي الربح",
    profitability: "الربحية",
  },
  soon: "قيد البناء", soonText: "هذه الشاشة ضمن المراحل القادمة من البناء.",
  back: "رجوع",
};

type Dict = typeof ar;

const en: Dict = {
  appName: "Hisabat",
  login: "Sign in", email: "Email", password: "Password",
  loginBtn: "Sign in", loggingIn: "Signing in…", loginError: "Wrong email or password",
  logout: "Sign out",
  noCompany: "Your account is not linked to a company yet. Ask an admin to add you.",
  nav: {
    home: "Home", projects: "Projects", sales: "Sales", purchases: "Purchases & expenses",
    cash: "Receipts & payments", review: "Review", reports: "Reports", settings: "Settings",
  },
  role: { admin: "Admin", reviewer: "Reviewer", entry: "Data entry" },
  dashboard: "Dashboard",
  kpi: {
    sales: "Sales excl. VAT", costs: "Costs & expenses", cash: "Cash (bank & cash)",
    vat: "Net VAT", partner: "Owed to partners",
  },
  kpiHidden: "Financial figures are visible to reviewers and admins.",
  shortcuts: { addInvoice: "Add invoice", captureExpense: "Capture expense", receipt: "Record receipt", payment: "Record payment" },
  sar: "SAR",
  projects: "Projects", newProject: "New project", noProjects: "No projects yet.",
  col: {
    code: "Code", name: "Project", customer: "Customer", contract: "Contract value", certified: "Certified works",
    advOut: "Advance not recovered", retOut: "Retention held", status: "Status", profit: "Gross profit",
  },
  status: { active: "Active", on_hold: "On hold", completed: "Completed", closed: "Closed" },
  form: {
    basics: "Project details", code: "Project code", nameAr: "Name (Arabic)", nameEn: "Name (English)",
    customer: "Customer", chooseCustomer: "Choose an existing customer", orNewCustomer: "or add a new customer",
    newCustomerName: "New customer name", customerVat: "Customer VAT number", government: "Government entity",
    contractValue: "Contract value excl. VAT", startDate: "Start date", endDate: "End date",
    manager: "Project manager", budget: "Estimated cost budget",
    terms: "Advance payment & retention", advancePct: "Advance payment %", recoveryPct: "Recovery % per claim",
    retentionPct: "Retention %", retentionCap: "Retention cap % of contract (optional)",
    releaseTerms: "Retention release terms", releaseHint: "e.g. 50% at provisional and 50% at final acceptance",
    vatNote: "VAT is charged on work value after advance recovery and before retention (adopted method).",
    partner: "Partner company", hasPartner: "This project has a partner company",
    choosePartner: "Choose an existing partner", newPartnerName: "New partner company name",
    sharePct: "Partner share %", partnerFrom: "Agreement effective from",
    partnerNote: "The share is calculated on every actual collection, net of VAT, and booked as a project cost.",
    preview: "Sample progress claim", workValue: "Sample work value",
    recovery: "Advance recovery", vatBase: "VAT base", vat: "VAT 15%",
    retention: "Retention", due: "Due from customer", netDue: "of which net of VAT", partnerShare: "Partner share on full collection",
    save: "Save project", saving: "Saving…", cancel: "Cancel", none: "—",
  },
  detail: {
    terms: "Terms", balances: "Balances", advanceAmount: "Advance amount", advInvoiced: "Advance invoiced",
    advRecovered: "Recovered", retHeld: "Retention held", retReleased: "Released", partnerShareTitle: "Partner share",
    entitled: "Entitled", settled: "Settled", outstanding: "Outstanding", noPartner: "No partner on this project.",
    documents: "Sales documents", noDocs: "No sales documents yet — they come in the next phase.",
    revenue: "Revenue", directCosts: "Direct costs", partnerCost: "Partner share cost", grossProfit: "Gross profit",
    profitability: "Profitability",
  },
  soon: "Under construction", soonText: "This screen is part of the upcoming build phases.",
  back: "Back",
};

export function dict(lang: Lang): Dict {
  return lang === "en" ? en : ar;
}
export type { Dict };

export function money(v: number | string | null | undefined): string {
  const n = Number(v ?? 0);
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
export function pct(v: number | string | null | undefined): string {
  const n = Number(v ?? 0) * 100;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n)}%`;
}
