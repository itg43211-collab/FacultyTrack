import React, { useState } from "react";
import Layout from "../components/Layout";
import { api, downloadBlob } from "../api";
import { useToast } from "../ToastContext";

const STATUS_LABEL = { present: "حاضر", excused: "غائب بعذر", absent: "غائب بدون عذر" };

async function viewAttachment(excuseId, showToast) {
  try {
    const res = await api.get(`/monitor/excuses/${excuseId}/attachment-url`);
    window.open(res.url, "_blank", "noopener,noreferrer");
  } catch (err) {
    showToast(err.message, "error");
  }
}

export default function MonitorReports() {
  const [filters, setFilters] = useState({ from: "", to: "", status: "" });
  const [rows, setRows] = useState(null);
  const showToast = useToast();

  function buildQuery(extra = {}) {
    const params = new URLSearchParams();
    Object.entries({ ...filters, ...extra }).forEach(([k, v]) => { if (v) params.set(k, v); });
    return params.toString();
  }

  async function runReport(e) {
    e.preventDefault();
    const res = await api.get(`/monitor/reports?${buildQuery()}`);
    setRows(res.rows);
  }

  async function exportCsv() {
    try {
      const blob = await api.get(`/monitor/reports?${buildQuery({ format: "csv" })}`);
      downloadBlob(blob, "department_report.csv");
    } catch (err) {
      showToast("تعذر تصدير التقرير", "error");
    }
  }

  return (
    <Layout>
      <div className="page-header">
        <h1>تقارير القسم</h1>
        <p>تقارير حضور وغياب مقيّدة بأعضاء قسمك فقط</p>
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
            <button className="btn btn-outline btn-sm" onClick={() => window.print()}>طباعة</button>
          </div>
        )}

        {rows && (
          rows.length === 0 ? (
            <div className="empty-state">لا توجد نتائج مطابقة</div>
          ) : (
            <table className="data-table">
              <thead><tr><th>الاسم</th><th>الرقم الوظيفي</th><th>المقرر</th><th>التاريخ</th><th>وقت المحاضرة</th><th>وقت التحضير</th><th>الحالة</th><th>المرفق</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.full_name}</td>
                    <td className="num">{r.employee_number}</td>
                    <td>{r.course_name}</td>
                    <td className="num">{r.date}</td>
                    <td className="num">{r.start_time} - {r.end_time}</td>
                    <td className="num">{r.check_in_time || "-"}</td>
                    <td><span className={`badge ${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                    <td>
                      {r.has_attachment ? (
                        <button className="btn btn-outline btn-sm" onClick={() => viewAttachment(r.excuse_id, showToast)}>
                          عرض المرفق
                        </button>
                      ) : "-"}
                    </td>
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