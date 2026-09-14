import React, { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { api } from "../api";

export default function MonitorDashboard() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.get("/monitor/dashboard").then(setStats);
  }, []);

  if (!stats) return <Layout><div className="empty-state">جارٍ التحميل...</div></Layout>;

  return (
    <Layout>
      <div className="page-header">
        <h1>نظرة عامة على القسم</h1>
        <p>ملخص حضور وغياب أعضاء قسمك فقط</p>
      </div>
      <div className="stat-row">
        <div className="stat-box"><div className="n num">{stats.member_count}</div><div className="l">أعضاء القسم</div></div>
        <div className="stat-box"><div className="n num">{stats.today_lecture_count}</div><div className="l">محاضرات اليوم</div></div>
        <div className="stat-box"><div className="n num">{stats.present_today}</div><div className="l">حضور اليوم</div></div>
        <div className="stat-box"><div className="n num">{stats.absent_today}</div><div className="l">غياب اليوم</div></div>
        <div className="stat-box"><div className="n num">{stats.attendance_rate}%</div><div className="l">نسبة الحضور</div></div>
      </div>
    </Layout>
  );
}
