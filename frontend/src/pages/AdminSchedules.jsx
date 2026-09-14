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
        <h2>رفع جدول المحاضرات (CSV أو PDF)</h2>
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: -8, marginBottom: 10 }}>
          <strong>ملف CSV</strong> — الأعمدة المطلوبة:{" "}
          <code>employee_number, course_name, course_code, day, start_time, end_time, section</code>
        </p>
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 0, marginBottom: 14 }}>
          <strong>ملف PDF</strong> — يجب أن تكون كل محاضرة في سطر مستقل، والحقول مفصولة بالرمز{" "}
          <code>|</code> بهذا الترتيب بالضبط:
          <br />
          <code>الرقم_الوظيفي|اسم_المقرر|رمز_المقرر|اليوم|وقت_البداية|وقت_النهاية|الشعبة</code>
          <br />
          مثال سطر داخل الملف: <code>1001|قواعد البيانات|CS101|الأحد|08:00|09:00|1</code>
          <br />
          إذا لم يتوفر رمز المقرر أو الشعبة، اترك المكان فارغًا بين الرمزين (<code>||</code>).
          <br />
          <span style={{ color: "#c0392b" }}>
            ملاحظة: استخراج البيانات من PDF أقل موثوقية من CSV لأن الملف نص وليس جدول بيانات حقيقي —
            التزم بتنسيق الأسطر أعلاه لضمان دقة الاستيراد.
          </span>
        </p>
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: 0, marginBottom: 14 }}>
          قيمة "اليوم" تُقبل كاسم عربي (الأحد، الاثنين...) أو كرقم من 0 إلى 6 (0 = الأحد).
          <br />
          يجب أن يكون هناك فصل دراسي مفعّل قبل رفع الجدول.
        </p>
        <input type="file" accept=".csv,.pdf" onChange={handleFile} />
        {result && (
          <div style={{ marginTop: 14 }}>
            <div className="info-box">تم استيراد {result.imported} محاضرة</div>
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
