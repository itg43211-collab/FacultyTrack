import React, { useState } from "react";
import Layout from "../components/Layout";
import { api } from "../api";
import { useToast } from "../ToastContext";

export default function AdminSchedules() {
  const [result, setResult] = useState(null);
  const showToast = useToast();

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await api.postForm("/admin/schedules/import", fd);
      setResult(res);
      showToast(res.message);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      e.target.value = "";
    }
  }

  return (
    <Layout>
      <div className="page-header">
        <h1>الجداول والمقررات</h1>
        <p>رفع جدول المحاضرات دفعة واحدة وربطه تلقائيًا بأعضاء هيئة التدريس عبر الرقم الوظيفي</p>
      </div>

      <div className="panel">
        <h2>رفع جدول المحاضرات (CSV)</h2>
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: -8, marginBottom: 10 }}>
          <strong>الأعمدة الأساسية (مطلوبة):</strong>{" "}
          <code>employee_number, course_name, day, start_time, end_time</code>{" "}
          — أو بأسمائها العربية:{" "}
          <code>الرقم الوظيفي، اسم المقرر، اليوم، وقت البداية، وقت النهاية</code>
        </p>
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 0, marginBottom: 10 }}>
          <strong>أعمدة اختيارية:</strong> <code>course_code / رمز المقرر</code>،{" "}
          <code>section / الشعبة</code>. وأيضًا <code>full_name / الاسم</code> و{" "}
          <code>department_name / القسم</code> — إن وُجد رقم وظيفي غير مسجَّل في النظام
          وتوفّر عمود الاسم في نفس السطر، يُنشأ للعضو حساب تلقائيًا (بريد مؤقت وكلمة
          مرور يعدّها بنفسه عند أول دخول) قبل إضافة محاضرته، فلا حاجة لرفع ملف أعضاء
          منفصل قبل ملف الجدول. الأقسام غير الموجودة تُنشأ تلقائيًا بالاسم الوارد
          في الملف.
        </p>
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 0, marginBottom: 14 }}>
          قيمة "اليوم" تُقبل كاسم عربي (الأحد، الاثنين/الإثنين بأي رسم للهمزة...)
          أو كرقم من 0 إلى 6 (0 = الأحد). وقت البداية/النهاية بصيغة{" "}
          <code>HH:MM</code> على مدار 24 ساعة (صفر بادئ اختياري، مثل <code>8:00</code>{" "}
          أو <code>08:00</code>).
          <br />
          يجب أن يكون هناك فصل دراسي مفعّل قبل رفع الجدول.
          <br />
          إعادة رفع نفس الملف لاحقًا آمنة: أي محاضرة موجودة مسبقًا بنفس البيانات
          تمامًا تُتجاهل بدل تكرارها، والأعضاء الموجودون يبقون كما هم.
        </p>
        <input type="file" accept=".csv" onChange={handleFile} />
        {result && (
          <div style={{ marginTop: 14 }}>
            <div className="info-box">
              تم استيراد {result.imported} محاضرة
              {result.created_members > 0 && ` — تم إنشاء ${result.created_members} عضو جديد`}
              {result.skipped_duplicate > 0 && ` — تم تجاهل ${result.skipped_duplicate} محاضرة مكررة`}
            </div>
            {result.errors?.length > 0 && (
              <div className="error-box">
                <div style={{ marginBottom: 6, fontWeight: 600 }}>ملاحظات ({result.errors.length}):</div>
                {result.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}