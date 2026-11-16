# حسابات · Hisabat

بوابة داخلية لحسابات المشروعات: Next.js على Netlify، وقاعدة البيانات والدخول على Supabase.

```
/                  ← التطبيق (Next.js)
/src               ← الشاشات والكود
/database          ← ملفات SQL (تشغَّل يدويًا من Supabase)
```

---

## المرحلة 2: تشغيل التطبيق

### 1. ملف SQL الجديد (مرة واحدة)
Supabase ← SQL Editor ← New query ← الصق `database/004_create_project.sql` ← Run.
النتيجة: `Success. No rows returned`.

لو الشركة التجريبية ما زالت موجودة، شغّل أيضًا:
```sql
delete from public.companies where name_ar = 'اسم الشركة بالعربي';
update public.companies set name_en = 'Trio' where name_ar = 'تريو';
```

### 2. ارفع الكود على GitHub
افتح الـ repository على github.com ← **Add file** ← **Upload files** ← اسحب **محتويات** مجلد `hisabat` كلها (وليس المجلد نفسه) ← **Commit changes**.
لازم يكون `package.json` في أول الـ repo مباشرة.

### 3. مفاتيح Supabase
Supabase ← **Project Settings** ← **API** (أو زر **Connect** أعلى الصفحة). انسخ:
- **Project URL**
- **anon public** key (أو **publishable** key)

لا تستخدم مفتاح **service_role** أو **secret** أبدًا في Netlify.

### 4. Netlify
**Add new site** ← **Import an existing project** ← GitHub ← اختر الـ repo.
الإعدادات تتعبى لوحدها من `netlify.toml`. قبل **Deploy** افتح **Environment variables** وأضف:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | الـ Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | الـ anon / publishable key |

ثم **Deploy**. أول نشر ياخد 2–4 دقائق.

### 5. اربط رابط Netlify في Supabase
Supabase ← **Authentication** ← **URL Configuration** ← **Site URL** = رابط موقعك على Netlify (مثل `https://hisabat-xyz.netlify.app`).

### 6. جرّب
افتح الرابط ← ادخل بإيميلك وكلمة السر ← **المشروعات** ← **مشروع جديد**.
جرّب: عقد 500,000، دفعة مقدمة 20، محتجز 10، شريك 10. المثال الجانبي لازم يطلع المطلوب 82,000 وحصة الشريك 7,000.

---

## إضافة مستخدم جديد
1. Supabase ← Authentication ← Users ← Add user (فعّل Auto Confirm).
2. SQL Editor (بعد استبدال البريد والدور: `admin` أو `reviewer` أو `entry`):
```sql
insert into public.memberships(company_id, user_id, role)
select c.id, u.id, 'reviewer'
  from public.companies c, auth.users u
 where c.name_ar = 'تريو' and u.email = 'name@example.com';
```

## ما تم في هذه المرحلة
- دخول بكلمة مرور، وخروج، وحماية كل الصفحات.
- عربي ↔ English مع تحويل الاتجاه بالكامل، واللغة محفوظة لكل مستخدم.
- القائمة الجانبية بالشاشات الثماني من المواصفات (غير الجاهز عليه نقطة رمادية).
- الرئيسية: مؤشرات المبيعات والتكاليف والسيولة والضريبة ومستحق الشركاء (للمراجع والأدمن)، والاختصارات الأربعة.
- المشروعات: قائمة، وإنشاء مشروع بالدفعة المقدمة والاسترداد والمحتجز والشريك مع مثال مستخلص حي، وصفحة المشروع بالأرصدة والربحية.
- يعمل على الموبايل.

## التطوير المحلي (اختياري)
```
npm install
cp .env.example .env.local   # ثم ضع المفاتيح
npm run dev
```
