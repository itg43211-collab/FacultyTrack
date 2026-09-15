# نظام تحضير أعضاء هيئة التدريس — جامعة القصيم (نسخة Supabase)

نظام ويب متكامل وفعّال لتسجيل حضور أعضاء هيئة التدريس للمحاضرات، مع التحقق
التلقائي من الوقت، الموقع الجغرافي (GPS)، وجدول المحاضرات المسجَّل —
يعمل الآن **100% على Supabase** بدون أي سيرفر خارجي.

---

## 1. البنية المعمارية (Architecture)

```
┌──────────────────────┐    HTTPS (supabase-js)   ┌───────────────────────────┐
│   Frontend (React)   │ ────────────────────────▶│       Supabase             │
│   Vite + RTL         │                          │  • Auth  (جلسات + كلمات    │
│   لا منطق أمنيًا      │ ◀──────────────────────── │    المرور بتقنية آمنة)     │
└──────────────────────┘   JWT يُدار تلقائيًا       │  • PostgreSQL + RLS       │
                                                      │  • Edge Function (api)    │
                                                      │    كل التحقق الأمني هنا    │
                                                      └───────────────────────────┘
```

- **Frontend:** React (Vite)، RTL كامل، بدون أي منطق أمني على العميل —
  حالة زر "تحضير" والمسافة الجغرافية والصلاحيات كلها تُحسب في السيرفر.
- **Auth:** Supabase Auth (بدون bcrypt/JWT يدوي). تسجيل الدخول
  بالرقم الوظيفي → يُجلب البريد من جدول `profiles` → `signInWithPassword`.
- **Database:** PostgreSQL عبر Supabase مع Row Level Security.
- **Backend:** Edge Function واحدة اسمها `api` تعمل كبديل كامل لسيرفر
  Express السابق: RBAC، نافذة الوقت، GPS، الاستيراد، التقارير.

> ملاحظة: مجلد `backend/` (Express + SQLite) وملف `firestore.rules` من
> النسخة السابقة لم يعودا مطلوبين — كل شيء أصبح على Supabase.

---

## 2. ملفات Supabase الأساسية

| الملف | الوصف |
|---|---|
| `supabase/migrations/0001_init.sql` | الـ Schema الكامل + RLS + بيانات ابتدائية (أقسام + موقع الجامعة) |
| `supabase/functions/api/index.ts` | كل الـ API: مسارات Faculty / Admin / Monitor + المصادقة |
| `supabase/config.toml` | إعداد المشروع + إعداد الدالة (`verify_jwt = false` لأن التحقق يتم داخل الدالة) |
| `frontend/src/api.js` | طبقة الطلبات — توجه كل نداء إلى Edge Function بجلسة Supabase |
| `frontend/src/lib/supabase.js` | عميل supabase-js (URL + Publishable Key من `.env`) |

### الجداول
| الجدول | الوصف |
|---|---|
| `profiles` | كل المستخدمين (admin / faculty / monitor) — مرتبط مباشرة بـ `auth.users` |
| `departments` | الأقسام الأكاديمية |
| `semesters` | الفصول الدراسية (فصل واحد فقط "فعّال" — مضمون بتريغر قاعدة البيانات) |
| `courses` | المقررات الدراسية |
| `schedules` | جدول محاضرات كل عضو (يوم، وقت بداية/نهاية، شعبة) |
| `attendance` | سجل الحضور الفعلي لكل محاضرة/تاريخ (GPS، مسافة، وقت) |
| `excuses` | أعذار الغياب المرتبطة بسجل حضور |
| `university_location` | إحداثيات الجامعة والنطاق المسموح (Radius) |

---

## 3. خطوات التشغيل (Setup)

### أ) قاعدة البيانات
```bash
supabase link --project-ref twtafhhclbzzltyovtez   # أو مشروعك
supabase db push                                   # ينفّذ migrations/0001_init.sql
```

### ب) نشر الـ Edge Function
```bash
supabase functions deploy api --no-verify-jwt
```
> `--no-verify-jwt` مطلوب لأن مسارَي `/auth/bootstrap-admin` و
> `/auth/first-login-setup` عامان — والتحقق من الجلسة يتم **داخل** الدالة
> لكل مسار محمي.

### ج) إنشاء حساب المدير الأول (مرة واحدة فقط)
يعمل فقط إذا لم يوجد أي admin في النظام:
```bash
curl -X POST "https://twtafhhclbzzltyovtez.supabase.co/functions/v1/api/auth/bootstrap-admin" \
  -H "Content-Type: application/json" \
  -d '{"employee_number":"ADMIN001","full_name":"مدير النظام","email":"admin@qu.edu.sa","password":"Admin@12345"}'
```

### د) الواجهة
```bash
cd frontend
# تأكد من frontend/.env:
#   VITE_SUPABASE_URL=https://twtafhhclbzzltyovtez.supabase.co
#   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
npm install
npm run dev       # http://localhost:5173
npm run build     # نسخة الإنتاج في dist/ للنشر على أي استضافة ثابتة
```

### إ) بعد الدخول
من لوحة الـ Admin: أضف المستخدمين (يتطلب **البريد الإلكتروني** لكل مستخدم
لأنه مُعرّف حساب Supabase Auth)، ثم فعّل فصلًا دراسيًا، ارفع الجداول،
وحدّث **موقع الجامعة الفعلي** من صفحة "موقع الجامعة" — الإحداثيات
الافتراضية وهمية.

**تدفقة أول دخول للمستخدم الجديد:** المدير ينشئ الحساب (كلمة مرور مؤقتة
عشوائية) → عند أول دخول يُطلب من العضو تعيين كلمة مرور جديدة عبر
`/auth/first-login-setup` → يدخل مباشرة.

---

## 4. آلية عمل التحضير (Flow)

1. العضو يفتح Dashboard فتظهر له محاضرات اليوم فقط (بحسب جدوله والفصل
   الفعّال). كل حسابات الوقت تُنفَّذ بتوقيت **Asia/Riyadh** في قاعدة
   البيانات — لا يعتمد على ساعة جهاز المستخدم إطلاقًا.
2. زر "تحضير" يُفعَّل تلقائيًا فقط ضمن نافذة (بداية المحاضرة − 15 دقيقة)
   حتى (نهاية المحاضرة + 15 دقيقة) — تُحسب في السيرفر.
3. عند الضغط يطلب المتصفح صلاحية GPS ثم يرسل الإحداثيات إلى
   `POST /faculty/attendance/check-in`.
4. الـ Edge Function تتحقق بالترتيب: أن المحاضرة ضمن جدول العضو، مطابقة
   اليوم، النافذة الزمنية، عدم تكرار الحضور، والمسافة (Haversine) من موقع
   الجامعة المخزَّن أقل من أو تساوي النطاق المسموح.
5. عند نجاح كل الشروط يُسجَّل الحضور مع الوقت والإحداثيات والمسافة.

---

## 5. رفع البيانات (CSV)

> 💡 نماذج جاهزة في مجلد `templates/` (UTF-8 مع BOM يفتحها Excel بالعربية).

> ✅ تلقائي: النظام يكتشف ترميز الملف (UTF-8 أو Windows-1256) والفاصل
> (`,` أو `;` أو Tab) — ارفع ملف Excel مباشرة بدون تعديل يدوي.

### استيراد أعضاء هيئة التدريس
من لوحة Admin ← "المستخدمون" ← CSV بالأعمدة:
```
الرقم الوظيفي,الاسم,القسم
1003,د. خالد المطيري,علوم الحاسب
```
(أو: `employee_number,full_name,department_name`)
يُنشأ لكل عضو حساب دخول تلقائيًا ببريد مؤقت (`الرقم الوظيفي@attendance.local`)
يعيّن العضو كلمة مروره عند أول دخول، ويمكنه تغيير بريده حينها.

### استيراد الجداول
من لوحة Admin ← "الجداول والمقررات" ← CSV بالأعمدة:
```
الرقم الوظيفي,اسم المقرر,رمز المقرر,اليوم,وقت البداية,وقت النهاية,الشعبة
1003,هياكل البيانات,CS210,الأحد,09:00,10:00,1
```
(أو بالأعمدة الإنجليزية. يجب تفعيل فصل دراسي أولًا.)

> ⚠️ في نسخة Supabase يدعم الاستيراد **CSV فقط** (الطريقة الموصى بها
> والمضمونة سابقًا). رفع PDF يعرض رسالة توضح كيفية التحويل.

---

## 6. الأمان المطبَّق

- كلمات المرور يديرها **Supabase Auth** بالكامل — لا يوجد password_hash
  في قاعدة البيانات ولا JWT يدوي.
- كل التحقق من الصلاحيات (RBAC) في الـ Edge Function عبر جدول `profiles`
  وليس في الواجهة.
- **RLS مفعّل على كل الجداول**: الواجهة (anon/authenticated) تستطيع فقط
  قراءة `profiles` اللازمة لتدفقة الدخول (وصفه الخاص لكل مستخدم) —
  بقية الجداول لا يمكن الوصول إليها إلا عبر الـ Edge Function
  (service role).
- مراقب القسم مقيَّد فعليًا بـ `department_id` في كل استعلام.
- منع التحضير خارج النطاق/الوقت/الجدول/التكرار — كله مفروض من السيرفر
  بتوقيت الرياض.
- تعطيل الحساب (status = disabled) يمنع الجلسة حتى لو كانت كلمة المرور صحيحة.

---

## 7. هيكل الملفات

```
project/
├── supabase/
│   ├── migrations/0001_init.sql     (Schema + RLS + بيانات ابتدائية)
│   ├── functions/api/index.ts       (كل الـ API — بديل Express)
│   └── config.toml
├── frontend/
│   ├── .env                         (VITE_SUPABASE_URL + PUBLISHABLE_KEY)
│   └── src/
│       ├── pages/                   (Login, FacultyDashboard, Admin*, Monitor*)
│       ├── AuthContext.jsx          (جلسة Supabase Auth)
│       ├── api.js                   (كل الطلبات → Edge Function)
│       └── lib/supabase.js
├── templates/                       (نماذج CSV جاهزة)
└── README.md
```

---

## 8. التوسعات المستقبلية المقترحة

- إرسال بريد فعلي عند إعادة تعيين كلمة المرور (Supabase Auth يوفره من لوحة
  المشروع مباشرة — فعّل SMTP من Authentication ← Emails).
- رفع مرفقات للأعذار عبر Supabase Storage (الحقل جاهز في الـ Schema).
- صفحة موافقة/رفض الأعذار من لوحة الـ Admin (الجدول والحالة `pending` جاهزان).
- تصدير PDF للتقارير (حاليًا CSV يفتح مباشرة في Excel).
