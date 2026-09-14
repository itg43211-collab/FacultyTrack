import React, { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { api } from "../api";
import { useToast } from "../ToastContext";

const ROLE_LABEL = { admin: "مدير", faculty: "عضو هيئة تدريس", monitor: "مراقب قسم" };

export default function AdminUsers() {
  const [users, setUsers] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const showToast = useToast();

  async function load() {
    const [u, d] = await Promise.all([api.get("/admin/users"), api.get("/admin/departments")]);
    setUsers(u.users);
    setDepartments(d.departments);
  }

  useEffect(() => { load(); }, []);

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await api.postForm("/admin/faculty/import", fd);
      setImportResult(res);
      showToast(res.message);
      await load();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      e.target.value = "";
    }
  }

  async function toggleStatus(u) {
    const newStatus = u.status === "active" ? "disabled" : "active";
    await api.put(`/admin/users/${u.id}/status`, { status: newStatus });
    showToast("تم تحديث حالة الحساب");
    load();
  }

  async function resetPassword(u) {
    await api.post(`/admin/users/${u.id}/reset-password`, {});
    showToast("تمت إعادة تعيين الحساب، سيُطلب من العضو إعداد كلمة مرور جديدة");
    load();
  }

  return (
    <Layout>
      <div className="page-header">
        <h1>المستخدمون وأعضاء هيئة التدريس</h1>
        <p>إدارة الحسابات ورفع بيانات الأعضاء دفعة واحدة عبر ملف CSV</p>
      </div>

      <div className="panel">
        <h2>رفع بيانات أعضاء هيئة التدريس (CSV)</h2>
        <p style={{ fontSize: 13, color: "var(--ink-dim)", marginTop: -8, marginBottom: 14 }}>
          أعمدة الملف المطلوبة: <code>employee_number, full_name, department_name</code> — يُنشأ لكل عضو حساب دخول تلقائيًا ببريد مؤقت يمكنه تغييره عند أول دخول
        </p>
        <input type="file" accept=".csv" onChange={handleFile} />
        {importResult && (
          <div style={{ marginTop: 14 }}>
            <div className="info-box">تم استيراد {importResult.imported} عضو</div>
            {importResult.errors?.length > 0 && (
              <div className="error-box">
                <div style={{ marginBottom: 6, fontWeight: 600 }}>ملاحظات ({importResult.errors.length}):</div>
                {importResult.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>كل المستخدمين</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>إضافة مستخدم</button>
        </div>
        {!users ? (
          <div className="empty-state">جارٍ التحميل...</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>الاسم</th><th>الرقم الوظيفي</th><th>الدور</th><th>القسم</th><th>الحالة</th><th></th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.full_name}</td>
                  <td className="num">{u.employee_number}</td>
                  <td>{ROLE_LABEL[u.role]}</td>
                  <td>{u.department_name || "-"}</td>
                  <td><span className={`badge ${u.status === "active" ? "present" : "absent"}`}>{u.status === "active" ? "مفعّل" : "معطّل"}</span></td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <button className="btn btn-outline btn-sm" onClick={() => toggleStatus(u)}>
                      {u.status === "active" ? "تعطيل" : "تفعيل"}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => resetPassword(u)}>إعادة تعيين</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <AddUserModal departments={departments} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); showToast("تمت إضافة المستخدم"); }} />
      )}
    </Layout>
  );
}

function AddUserModal({ departments, onClose, onSaved }) {
  const [form, setForm] = useState({ employee_number: "", full_name: "", role: "faculty", department_id: "", email: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post("/admin/users", { ...form, department_id: form.department_id || null });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(19,19,61,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 6, padding: 24, width: "100%", maxWidth: 420 }}>
        <h2 style={{ marginTop: 0 }}>إضافة مستخدم جديد</h2>
        {error && <div className="error-box">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label>الرقم الوظيفي</label>
            <input value={form.employee_number} onChange={(e) => setForm({ ...form, employee_number: e.target.value })} required />
          </div>
          <div className="field">
            <label>الاسم الكامل</label>
            <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
          </div>
          <div className="field">
            <label>الدور</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="faculty">عضو هيئة تدريس</option>
              <option value="monitor">مراقب قسم</option>
              <option value="admin">مدير النظام</option>
            </select>
          </div>
          <div className="field">
            <label>القسم</label>
            <select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
              <option value="">بدون قسم</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>البريد الإلكتروني (مطلوب لحساب الدخول)</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@qu.edu.sa" required />
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>إلغاء</button>
            <button className="btn btn-primary" disabled={saving}>{saving ? "جارٍ الحفظ..." : "إضافة"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
