import React, { useState } from "react";
import Layout from "../components/Layout";
import { api } from "../api";
import { useToast } from "../ToastContext";

export default function MonitorSchedules() {
  const [result, setResult] = useState(null);
  const showToast = useToast();

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await api.postForm("/monitor/schedules/import", fd);
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
        <h1>جدول محاضرات القسم</h1>
        <p>رفع جدول محاضرات أعضاء قسمك فقط، دفعة واحدة، وربطه تلقائيًا بالرقم الوظيفي</p>
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
          <code>section / الشعبة</code>، و<code>full_name / الاسم</code> — إن وُجد رقم
          وظيفي غير مسجَّل بعد وتوفّر عمود الاسم في نفس السطر، يُنشأ للعضو حساب تلقائيًا
          (بريد مؤقت وكلمة مرور يعدّها بنفسه عند أول دخول) **داخل قسمك أنت فقط**، فلا
          حاجة لعمود القسم أصلًا.
        </p>
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 0, marginBottom: 14 }}>
          قيمة "اليوم" تُقبل كاسم عربي (الأحد، الاثنين/الإثنين بأي رسم للهمزة...)
          أو كرقم من 0 إلى 6 (0 = الأحد). وقت البداية/النهاية بصيغة{" "}
          <code>HH:MM</code> على مدار 24 ساعة (صفر بادئ اختياري، مثل <code>8:00</code>{" "}
          أو <code>08:00</code>).
          <br />
          إذا كان الرقم الوظيفي مسجّلًا مسبقًا في قسم آخر، سيتم تجاهل ذلك السطر — التعديل
          هذا مقيّد بأعضاء قسمك فقط.
          <br />
          إعادة رفع نفس الملف لاحقًا آمنة: أي محاضرة موجودة مسبقًا بنفس البيانات
          تمامًا تُتجاهل بدل تكرارها.
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