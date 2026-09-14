import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";
import BrandMark from "./BrandMark";

const NAV = {
  faculty: [
    {
      to: "/faculty",
      label: "محاضراتي اليوم",
      end: true,
    },
    {
      to: "/faculty/history",
      label: "سجل الحضور",
    },
  ],

  admin: [
    {
      to: "/admin",
      label: "نظرة عامة",
      end: true,
    },
    {
      to: "/admin/users",
      label: "المستخدمون وأعضاء التدريس",
    },
    {
      to: "/admin/schedules",
      label: "الجداول والمقررات",
    },
    {
      to: "/admin/semesters",
      label: "الفصول الدراسية",
    },
    {
      to: "/admin/location",
      label: "موقع الجامعة",
    },
    {
      to: "/admin/reports",
      label: "التقارير",
    },
  ],

  monitor: [
    {
      to: "/monitor",
      label: "نظرة عامة",
      end: true,
    },
    {
      to: "/monitor/members",
      label: "أعضاء القسم",
    },
    {
      to: "/monitor/reports",
      label: "التقارير",
    },
  ],
};

const ROLE_LABEL = {
  admin: "مدير النظام",
  faculty: "عضو هيئة تدريس",
  monitor: "مراقب قسم",
};

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) {
    return null;
  }

  const items = NAV[user.role] || [];

  async function handleLogout() {
    try {
      await logout();
    } catch (error) {
      console.error("Logout Error:", error);
    } finally {
      navigate("/login", { replace: true });
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark size={28} />

          <div className="brand-text">
            <strong>نظام التحضير</strong>
            <span>جامعة القصيم</span>
          </div>
        </div>

        <div className="nav-group">
          <div className="nav-label">
            {ROLE_LABEL[user.role] || "المستخدم"}
          </div>

          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `nav-item${isActive ? " active" : ""}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="who">
            <strong>
              {user.full_name || user.name || user.email}
            </strong>

            {user.employee_number && (
              <span>{user.employee_number}</span>
            )}
          </div>

          <button
            type="button"
            className="logout-btn"
            onClick={handleLogout}
          >
            تسجيل الخروج
          </button>
        </div>
      </aside>

      <main className="main">
        {children}
      </main>
    </div>
  );
}

