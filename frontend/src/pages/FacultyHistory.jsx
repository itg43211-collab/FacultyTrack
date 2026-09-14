import React, { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { api } from "../api";

const STATUS_LABEL = { present: "حاضر", excused: "غائب بعذر", absent: "غائب بدون عذر" };

export default function FacultyHistory() {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    api.get("/faculty/history").then((res) => setRows(res.history));
  }, []);

  return (
    <Layout>
      <div className="page-header">
        <h1>سجل الحضور والغياب</h1>
        <p>عرض كامل لجميع محاضراتك المسجّلة</p>
      </div>
      <div className="panel">
        {!rows ? (
          <div className="empty-state">جارٍ التحميل...</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">لا يوجد سجل حضور بعد</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>المقرر</th>
                <th>وقت المحاضرة</th>
                <th>وقت التحضير</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="num">{r.date}</td>
                  <td>{r.course_name}</td>
                  <td className="num">{r.start_time} - {r.end_time}</td>
                  <td className="num">{r.check_in_time || "-"}</td>
                  <td><span className={`badge ${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}
