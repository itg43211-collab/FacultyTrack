import React, { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { api } from "../api";

export default function AdminOverview() {
  const [stats, setStats] = useState(null);
  const [selectedDept, setSelectedDept] = useState(null);
  const [members, setMembers] = useState(null);
  const [selectedMember, setSelectedMember] = useState(null);
  const [history, setHistory] = useState(null);

  useEffect(() => {
    api.get("/admin/stats/overview").then(setStats);
  }, []);

  async function openDept(dept) {
    setSelectedDept(dept);
    setMembers(null);
    setSelectedMember(null);
    const res = await api.get(`/admin/stats/departments/${dept.id}/members`);
    setMembers(res.members);
  }

  async function openMember(m) {
    setSelectedMember(m);
    const res = await api.get(`/admin/stats/members/${m.id}/history`);
    setHistory(res.history);
  }

  if (!stats) return <Layout><div className="empty-state">جارٍ التحميل...</div></Layout>;

  return (
    <Layout>
      <div className="page-header">
        <h1>نظرة عامة</h1>
        <p>ملخص الحضور والغياب على مستوى الجامعة</p>
      </div>

      <div className="stat-row">
        <div className="stat-box"><div className="n num">{stats.total_faculty}</div><div className="l">أعضاء هيئة التدريس</div></div>
        <div className="stat-box"><div className="n num">{stats.total_lectures}</div><div className="l">إجمالي المحاضرات المجدولة</div></div>
        <div className="stat-box"><div className="n num">{stats.present_today}</div><div className="l">الحضور اليوم</div></div>
        <div className="stat-box"><div className="n num">{stats.excused_total}</div><div className="l">غياب بعذر</div></div>
        <div className="stat-box"><div className="n num">{stats.absent_total}</div><div className="l">غياب بدون عذر</div></div>
        <div className="stat-box"><div className="n num">{stats.attendance_rate}%</div><div className="l">نسبة الحضور العامة</div></div>
      </div>

      <div className="panel">
        <h2>الأقسام</h2>
        <div className="dept-grid">
          {stats.departments.map((d) => (
            <div key={d.id} className="dept-card" onClick={() => openDept(d)}>
              <h3>{d.name}</h3>
              <div className="rate num">{d.attendance_rate}%</div>
              <div className="sub">عدد الأعضاء: {d.member_count}</div>
            </div>
          ))}
        </div>
      </div>

      {selectedDept && (
        <div className="panel">
          <h2>أعضاء قسم {selectedDept.name}</h2>
          {!members ? (
            <div className="empty-state">جارٍ التحميل...</div>
          ) : members.length === 0 ? (
            <div className="empty-state">لا يوجد أعضاء في هذا القسم</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>الاسم</th><th>الرقم الوظيفي</th><th>محاضرات</th><th>حضور</th><th>غياب بعذر</th><th>غياب بدون عذر</th><th>النسبة</th><th></th></tr>
              </thead>
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
                    <td><button className="btn btn-outline btn-sm" onClick={() => openMember(m)}>التفاصيل</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {selectedMember && (
        <div className="panel">
          <h2>سجل {selectedMember.full_name}</h2>
          {!history ? (
            <div className="empty-state">جارٍ التحميل...</div>
          ) : (
            <table className="data-table">
              <thead><tr><th>التاريخ</th><th>المقرر</th><th>وقت المحاضرة</th><th>وقت التحضير</th><th>الحالة</th></tr></thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i}>
                    <td className="num">{h.date}</td>
                    <td>{h.course_name}</td>
                    <td className="num">{h.start_time} - {h.end_time}</td>
                    <td className="num">{h.check_in_time || "-"}</td>
                    <td><span className={`badge ${h.status}`}>{h.status}</span></td>
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
