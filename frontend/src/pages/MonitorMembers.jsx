import React, { useEffect, useState, useCallback } from "react";
import Layout from "../components/Layout";
import { api } from "../api";
import { useToast } from "../ToastContext";

const STATUS_LABEL = { present: "حاضر", excused: "غائب بعذر", absent: "غائب بدون عذر" };

export default function MonitorMembers() {
  const [members, setMembers] = useState(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState(null);
  const [filters, setFilters] = useState({ from: "", to: "", status: "" });
  const showToast = useToast();

  const loadMembers = useCallback(async (q) => {
    const res = await api.get(`/monitor/members${q ? `?search=${encodeURIComponent(q)}` : ""}`);
    setMembers(res.members);
  }, []);

  useEffect(() => { loadMembers(""); }, [loadMembers]);

  async function openMember(m) {
    setSelected(m);
    setHistory(null);
    const res = await api.get(`/monitor/members/${m.id}/history`);
    setHistory(res.history);
  }

  async function applyFilters() {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
    const res = await api.get(`/monitor/members/${selected.id}/history?${params.toString()}`);
    setHistory(res.history);
  }

  async function overrideStatus(recordId, status) {
    try {
      await api.post(`/monitor/attendance/${recordId}/override`, { status });
      showToast("تم تحديث حالة الحضور");
      applyFilters();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  return (
    <Layout>
      <div className="page-header">
        <h1>أعضاء القسم</h1>
        <p>يمكنك تعديل حالة الحضور لأي عضو في أي وقت إذا تعذّر عليه التحضير بنفسه</p>
      </div>

      <div className="panel">
        <div className="filter-row">
          <div className="field" style={{ flex: 1 }}>
            <label>البحث بالاسم أو الرقم الوظيفي</label>
            <input value={search} onChange={(e) => { setSearch(e.target.value); loadMembers(e.target.value); }} placeholder="ابحث..." />
          </div>
        </div>
        {!members ? (
          <div className="empty-state">جارٍ التحميل...</div>
        ) : members.length === 0 ? (
          <div className="empty-state">لا يوجد نتائج</div>
        ) : (
          <table className="data-table">
            <thead><tr><th>الاسم</th><th>الرقم الوظيفي</th><th>محاضرات</th><th>حضور</th><th>غياب بعذر</th><th>غياب بدون عذر</th><th>النسبة</th><th></th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>{m.full_name}</td>
                  <td className="num">{m.employee_number}</td>
                  <td className="num">{m.total_lectures}</td>
                  <td className="num">{m.present}</td>
                  <td className="num">{m.excused}</td>
                  <td className="num">{m.absent}</td>
                  <td className="num">{m.attendance_rate}%</td>
                  <td><button className="btn btn-outline btn-sm" onClick={() => openMember(m)}>عرض السجل</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <div className="panel">
          <h2>سجل {selected.full_name}</h2>
          <div className="filter-row">
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
                <option value="">الكل</option>
                <option value="present">حاضر</option>
                <option value="excused">غائب بعذر</option>
                <option value="absent">غائب بدون عذر</option>
              </select>
            </div>
            <button className="btn btn-outline" onClick={applyFilters}>تطبيق</button>
          </div>

          {!history ? (
            <div className="empty-state">جارٍ التحميل...</div>
          ) : history.length === 0 ? (
            <div className="empty-state">لا يوجد سجل مطابق</div>
          ) : (
            <table className="data-table">
              <thead><tr><th>التاريخ</th><th>المقرر</th><th>وقت المحاضرة</th><th>وقت التحضير</th><th>الحالة</th><th>تعديل الحالة</th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="num">{h.date}</td>
                    <td>{h.course_name}</td>
                    <td className="num">{h.start_time} - {h.end_time}</td>
                    <td className="num">{h.check_in_time || "-"}</td>
                    <td><span className={`badge ${h.status}`}>{STATUS_LABEL[h.status]}</span></td>
                    <td>
                      <select defaultValue="" onChange={(e) => { if (e.target.value) { overrideStatus(h.id, e.target.value); e.target.value = ""; } }}>
                        <option value="">اختر...</option>
                        <option value="present">تحويل إلى حاضر</option>
                        <option value="excused">تحويل إلى غائب بعذر</option>
                        <option value="absent">تحويل إلى غائب بدون عذر</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Layout>
  );
}
