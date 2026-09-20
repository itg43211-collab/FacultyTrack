import React, { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { api } from "../api";
import { useToast } from "../ToastContext";

export default function AdminSemesters() {
  const [semesters, setSemesters] = useState(null);
  const [form, setForm] = useState({ name: "", start_date: "", end_date: "" });
  const [error, setError] = useState("");
  const showToast = useToast();

  async function load() {
    const res = await api.get("/admin/semesters");
    setSemesters(res.semesters);
  }

  useEffect(() => { load(); }, []);

  async function createSemester(e) {
    e.preventDefault();
    setError("");
    if (!form.name || !form.start_date || !form.end_date) {
      setError("جميع الحقول مطلوبة");
      return;
    }
    try {
      await api.post("/admin/semesters", form);
      setForm({ name: "", start_date: "", end_date: "" });
      showToast("تم إنشاء الفصل الدراسي");
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function activate(id) {
    await api.post(`/admin/semesters/${id}/activate`, {});
    showToast("تم تفعيل الفصل الدراسي");
    load();
  }

  async function deactivate(id) {
    await api.post(`/admin/semesters/${id}/deactivate`, {});
    showToast("تم إيقاف الفصل الدراسي");
    load();
  }

  async function remove(id) {
    if (!window.confirm("حذف الفصل الدراسي نهائي وسيحذف معه كل الجداول وسجلات الحضور والأعذار المرتبطة به. متأكد؟")) return;
    try {
      await api.delete(`/admin/semesters/${id}`);
      showToast("تم حذف الفصل الدراسي نهائيًا");
      load();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  return (
    <Layout>
      <div className="page-header">
        <h1>الفصول الدراسية</h1>
        <p>لا يمكن تسجيل حضور لمحاضرات فصل غير مفعّل. فصل واحد فقط يكون فعّالًا في كل مرة.</p>
      </div>

      <div className="panel">
        <h2>إنشاء فصل دراسي جديد</h2>
        {error && <div className="error-box">{error}</div>}
        <form onSubmit={createSemester} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
          <div className="field" style={{ minWidth: 220 }}>
            <label>اسم الفصل</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="الفصل الدراسي الأول 2026/2027" />
          </div>
          <div className="field">
            <label>تاريخ البداية</label>
            <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </div>
          <div className="field">
            <label>تاريخ النهاية</label>
            <input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          </div>
          <button className="btn btn-primary" style={{ height: 40 }}>إنشاء</button>
        </form>
      </div>

      <div className="panel">
        <h2>كل الفصول الدراسية</h2>
        {!semesters ? (
          <div className="empty-state">جارٍ التحميل...</div>
        ) : semesters.length === 0 ? (
          <div className="empty-state">لا توجد فصول دراسية بعد</div>
        ) : (
          <table className="data-table">
            <thead><tr><th>الاسم</th><th>البداية</th><th>النهاية</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {semesters.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td className="num">{s.start_date}</td>
                  <td className="num">{s.end_date}</td>
                  <td><span className={`badge ${s.is_active ? "present" : "pending"}`}>{s.is_active ? "فعّال" : "غير فعّال"}</span></td>
                  <td>
                    {s.is_active ? (
                      <button className="btn btn-outline btn-sm" onClick={() => deactivate(s.id)}>إيقاف</button>
                    ) : (
                      <button className="btn btn-primary btn-sm" onClick={() => activate(s.id)}>تفعيل</button>
                    )}
                    {" "}
                    <button
                      className="btn btn-ghost btn-sm"
                      title="حذف نهائي"
                      onClick={() => remove(s.id)}
                      style={{ color: "#c0392b" }}
                    >
                      🗑 حذف
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}