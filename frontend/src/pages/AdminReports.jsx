import React, { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { api, downloadBlob } from "../api";
import { useToast } from "../ToastContext";

const STATUS_LABEL = { present: "حاضر", excused: "غائب بعذر", absent: "غائب بدون عذر" };

export default function AdminReports() {
  const [departments, setDepartments] = useState([]);
  const [members, setMembers] = useState([]);
  const [filters, setFilters] = useState({ from: "", to: "", department_id: "", faculty_id: "", status: "" });
  const [rows, setRows] = useState(null);
  const showToast = useToast();

  useEffect(() => {
    api.get("/admin/departments").then((res) => setDepartments(res.departments));
    api.get("/admin/users").then((res) => setMembers(res.users.filter((u) => u.role === "faculty")));
  }, []);

  function buildQuery(extra = {}) {
    const params = new URLSearchParams();
    Object.entries({ ...filters, ...extra }).forEach(([k, v]) => { if (v) params.set(k, v); });
    return params.toString();
  }

  async function runReport(e) {
    e.preventDefault();
    const res = await api.get(`/admin/reports?${buildQuery()}`);
    setRows(res.rows);
  }

  async function exportCsv() {
    try {
      const blob = await api.get(`/admin/reports?${buildQuery({ format: "csv" })}`);
      downloadBlob(blob, "attendance_report.csv");
    } catch (err) {
      showToast("تعذر تصدير التقرير", "error");
    }
  }

  function printReport() {
    window.print();
  }

  return (
    <Layout>
      <div className="page-header">
        <h1>التقارير</h1>
        <p>فلترة سجلات الحضور والغياب حسب التاريخ والقسم والعضو، مع إمكانية الطباعة والتصدير</p>
      </div>

      <div className="panel">
        <form onSubmit={runReport} className="filter-row">
          <div className="field">
            <label>من تاريخ</label>
            <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          </div>
          <div className="field">
            <label>إلى تاريخ</label>
            <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </div>
          <div className="field">
            <label>القسم</label>
            <select value={filters.department_id} onChange={(e) => setFilters({ ...filters, department_id: e.target.value })}>
              <option value="">جميع الأقسام</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>العضو</label>
            <select value={filters.faculty_id} onChange={(e) => setFilters({ ...filters, faculty_id: e.target.value })}>
              <option value="">جميع الأعضاء</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>الحالة</label>
            <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">كل الحالات</option>
              <option value="present">حاضر</option>
              <option value="excused">غائب بعذر</option>
              <option value="absent">غائب بدون عذر</option>
            </select>
          </div>
          <button className="btn btn-primary">عرض التقرير</button>
        </form>

        {rows && (
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <button className="btn btn-outline btn-sm" onClick={exportCsv}>تصدير Excel/CSV</button>
            <button className="btn btn-outline btn-sm" onClick={printReport}>طباعة</button>
          </div>
        )}

        {rows && (
          rows.length === 0 ? (
            <div className="empty-state">لا توجد نتائج مطابقة</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>الاسم</th><th>الرقم الوظيفي</th><th>القسم</th><th>المقرر</th><th>التاريخ</th><th>وقت المحاضرة</th><th>وقت التحضير</th><th>الحالة</th><th>نوع العذر</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.full_name}</td>
                    <td className="num">{r.employee_number}</td>
                    <td>{r.department_name || "-"}</td>
                    <td>{r.course_name}</td>
                    <td className="num">{r.date}</td>
                    <td className="num">{r.start_time} - {r.end_time}</td>
                    <td className="num">{r.check_in_time || "-"}</td>
                    <td><span className={`badge ${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                    <td>{r.excuse_type || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </Layout>
  );
}
