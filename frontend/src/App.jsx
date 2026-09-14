import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext";
import { ToastProvider } from "./ToastContext";

import Login from "./pages/Login";
import FacultyDashboard from "./pages/FacultyDashboard";
import FacultyHistory from "./pages/FacultyHistory";
import AdminOverview from "./pages/AdminOverview";
import AdminUsers from "./pages/AdminUsers";
import AdminSchedules from "./pages/AdminSchedules";
import AdminSemesters from "./pages/AdminSemesters";
import AdminLocation from "./pages/AdminLocation";
import AdminReports from "./pages/AdminReports";
import MonitorDashboard from "./pages/MonitorDashboard";
import MonitorMembers from "./pages/MonitorMembers";
import MonitorReports from "./pages/MonitorReports";

const ROLE_HOME = { admin: "/admin", faculty: "/faculty", monitor: "/monitor" };

function RequireRole({ role, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={ROLE_HOME[user.role] || "/login"} replace />;
  return children;
}

function RootRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={ROLE_HOME[user.role] || "/login"} replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route path="/faculty" element={<RequireRole role="faculty"><FacultyDashboard /></RequireRole>} />
      <Route path="/faculty/history" element={<RequireRole role="faculty"><FacultyHistory /></RequireRole>} />

      <Route path="/admin" element={<RequireRole role="admin"><AdminOverview /></RequireRole>} />
      <Route path="/admin/users" element={<RequireRole role="admin"><AdminUsers /></RequireRole>} />
      <Route path="/admin/schedules" element={<RequireRole role="admin"><AdminSchedules /></RequireRole>} />
      <Route path="/admin/semesters" element={<RequireRole role="admin"><AdminSemesters /></RequireRole>} />
      <Route path="/admin/location" element={<RequireRole role="admin"><AdminLocation /></RequireRole>} />
      <Route path="/admin/reports" element={<RequireRole role="admin"><AdminReports /></RequireRole>} />

      <Route path="/monitor" element={<RequireRole role="monitor"><MonitorDashboard /></RequireRole>} />
      <Route path="/monitor/members" element={<RequireRole role="monitor"><MonitorMembers /></RequireRole>} />
      <Route path="/monitor/reports" element={<RequireRole role="monitor"><MonitorReports /></RequireRole>} />

      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<RootRedirect />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppRoutes />
      </ToastProvider>
    </AuthProvider>
  );
}
