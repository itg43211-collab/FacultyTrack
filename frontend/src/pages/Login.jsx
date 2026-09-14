import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { api } from "../api";
import { useAuth } from "../AuthContext";

import BrandMark from "../components/BrandMark";

const ROLE_HOME = {
  admin: "/admin",
  faculty: "/faculty",
  monitor: "/monitor",
};

export default function Login() {
  const [step, setStep] = useState("employee"); // employee | password | setup

  const [employeeNumber, setEmployeeNumber] = useState("");
  const [fullName, setFullName] = useState("");

  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  const [email, setEmail] = useState("");
  const [profile, setProfile] = useState(null);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  // =========================================================
  // الخطوة 1: التحقق من الرقم الوظيفي من جدول profiles
  // =========================================================
  async function handleCheckEmployee(e) {
    e.preventDefault();
    setError("");

    const employee = employeeNumber.trim(); await supabase.auth.signOut();
    if (!employee) {
      setError("الرجاء إدخال الرقم الوظيفي");
      return;
    }

    setLoading(true);
    try {
      const { data, error: profileError } = await supabase
        .from("profiles")
        .select(
          "id, employee_number, full_name, role, status, email, must_set_password"
        )
        .eq("employee_number", employee)
        .maybeSingle();

      if (profileError) {
        setError(
          profileError.message || "حدث خطأ أثناء التحقق من الرقم الوظيفي"
        );
        return;
      }

      if (!data) {
        setError("الرقم الوظيفي غير موجود");
        return;
      }

      if (data.status === "disabled") {
        setError("هذا الحساب معطّل. يرجى مراجعة إدارة النظام.");
        return;
      }

      setProfile(data);
      setFullName(data.full_name || "المستخدم");

      // الحساب لم يُفعَّل بعد => أول تسجيل دخول (إعداد كلمة المرور)
      if (data.must_set_password) {
        setEmail(data.email || "");
        setStep("setup");
      } else if (data.email) {
        setEmail(data.email);
        setStep("password");
      } else {
        setError("لا يوجد بريد إلكتروني مرتبط بهذا الحساب — راجع إدارة النظام");
      }
    } catch (err) {
      setError(err?.message || "حدث خطأ أثناء التحقق من بيانات الموظف");
    } finally {
      setLoading(false);
    }
  }

  // =========================================================
  // الخطوة 2: تسجيل الدخول عبر Supabase Auth
  // =========================================================
  async function handlePasswordLogin(e) {
    e.preventDefault();
    setError("");

    if (!password) {
      setError("الرجاء إدخال كلمة المرور");
      return;
    }
    if (!profile?.email) {
      setError("لا يوجد بريد إلكتروني مرتبط بهذا الحساب");
      return;
    }

    setLoading(true);
    try {
      const result = await login(employeeNumber.trim(), password);
      const user = result?.user;

      if (!user) {
        setError("تعذر الحصول على بيانات المستخدم");
        return;
      }
      if (!user.role) {
        setError("تم تسجيل الدخول، ولكن لم يتم تحديد صلاحية المستخدم");
        return;
      }

      const destination = ROLE_HOME[user.role];
      if (!destination) {
        setError("صلاحية المستخدم غير معروفة");
        return;
      }

      navigate(destination, { replace: true });
    } catch (err) {
      setError(err?.message || "حدث خطأ أثناء تسجيل الدخول");
    } finally {
      setLoading(false);
    }
  }

  // =========================================================
  // أول تسجيل دخول: إعداد كلمة المرور عبر Edge Function
  // (الحساب أنشأه المدير بكلمة مرور مؤقتة — يُعيّن العضو كلمة مروره هنا)
  // =========================================================
  async function handleSetup(e) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("يجب أن تتكون كلمة المرور من 8 أحرف على الأقل");
      return;
    }
    if (password !== password2) {
      setError("كلمتا المرور غير متطابقتين");
      return;
    }
    if (!profile) {
      setError("بيانات الموظف غير موجودة");
      return;
    }

    setLoading(true);
    try {
      // Edge Function تعيّن كلمة المرور في Supabase Auth
      await api.post("/auth/first-login-setup", {
        employee_number: employeeNumber.trim(),
        password,
        email: email.trim() || undefined,
      });

      // تسجيل دخول مباشر بعد الإعداد
      const result = await login(employeeNumber.trim(), password);
      const user = result?.user;
      const destination = user?.role ? ROLE_HOME[user.role] : null;

      if (!destination) {
        setError("تم إعداد الحساب، ولكن تعذر تحديد الصلاحية — سجّل الدخول من جديد");
        setStep("employee");
        return;
      }

      navigate(destination, { replace: true });
    } catch (err) {
      setError(err?.message || "حدث خطأ أثناء إنشاء الحساب");
    } finally {
      setLoading(false);
    }
  }

  // =========================================================
  // الرجوع إلى بداية تسجيل الدخول
  // =========================================================
  function resetToStart() {
    setStep("employee");
    setPassword("");
    setPassword2("");
    setEmail("");
    setProfile(null);
    setFullName("");
    setError("");
  }

  // =========================================================
  // واجهة تسجيل الدخول
  // =========================================================
  return (
    <div className="auth-shell">
      <div className="auth-lattice">
        <BrandMark size={460} />
      </div>

      <div className="auth-card">
        <div className="auth-brand">
          <BrandMark size={34} />

          <div>
            <strong>نظام تحضير أعضاء هيئة التدريس</strong>
            <span>جامعة القصيم</span>
          </div>
        </div>

        {error && <div className="error-box">{error}</div>}

        {/* الخطوة 1: الرقم الوظيفي */}
        {step === "employee" && (
          <form onSubmit={handleCheckEmployee}>
            <div className="field">
              <label>الرقم الوظيفي</label>
              <input
                autoFocus
                value={employeeNumber}
                onChange={(e) => setEmployeeNumber(e.target.value)}
                placeholder="مثال: 1001"
                disabled={loading}
              />
            </div>

            <button type="submit" className="submit-btn" disabled={loading}>
              {loading ? "جارٍ التحقق..." : "متابعة"}
            </button>
          </form>
        )}

        {/* الخطوة 2: كلمة المرور */}
        {step === "password" && (
          <form onSubmit={handlePasswordLogin}>
            <div className="info-box">
              مرحبًا {fullName}، أدخل كلمة المرور لإكمال الدخول
            </div>

            <div className="field">
              <label>كلمة المرور</label>
              <input
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>

            <button type="submit" className="submit-btn" disabled={loading}>
              {loading ? "جارٍ الدخول..." : "تسجيل الدخول"}
            </button>

            <button
              type="button"
              className="link-btn"
              onClick={resetToStart}
              disabled={loading}
            >
              رقم وظيفي مختلف؟
            </button>
          </form>
        )}

        {/* أول تسجيل دخول: إعداد كلمة المرور */}
        {step === "setup" && (
          <form onSubmit={handleSetup}>
            <div className="info-box">
              مرحبًا {fullName}، هذا أول تسجيل دخول لك. الرجاء إنشاء كلمة مرور
              لحسابك
              {profile?.email ? " ومراجعة بريدك الإلكتروني" : " وإدخال بريدك الإلكتروني"}.
            </div>

            <div className="field">
              <label>كلمة المرور الجديدة</label>
              <input
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="field">
              <label>تأكيد كلمة المرور</label>
              <input
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="field">
              <label>البريد الإلكتروني</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@qu.edu.sa"
                disabled={loading}
              />
            </div>

            <button type="submit" className="submit-btn" disabled={loading}>
              {loading ? "جارٍ الحفظ..." : "إنشاء الحساب والدخول"}
            </button>

            <button
              type="button"
              className="link-btn"
              onClick={resetToStart}
              disabled={loading}
            >
              رقم وظيفي مختلف؟
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
