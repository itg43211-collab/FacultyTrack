import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
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
  // الخطوة الأولى:
  // التحقق من الرقم الوظيفي من جدول profiles
  // =========================================================
  async function handleCheckEmployee(e) {
    e.preventDefault();

    setError("");

    const employee = employeeNumber.trim();

    if (!employee) {
      setError("الرجاء إدخال الرقم الوظيفي");
      return;
    }

    setLoading(true);

    try {
      console.log("🔵 Checking employee:", employee);

      const { data, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("employee_number", employee)
        .maybeSingle();

      if (profileError) {
        console.error("❌ Profile lookup error:", profileError);

        setError(
          profileError.message ||
            "حدث خطأ أثناء التحقق من الرقم الوظيفي"
        );

        return;
      }

      if (!data) {
        console.warn("⚠️ Employee not found:", employee);

        setError("الرقم الوظيفي غير موجود");
        return;
      }

      console.log("✅ Employee found:", data);

      setProfile(data);

      // محاولة الحصول على الاسم من الحقول الموجودة
      const name =
        data.full_name ||
        data.name ||
        data.display_name ||
        data.employee_name ||
        "المستخدم";

      setFullName(name);

      // إذا كان البريد موجودًا، فالحساب جاهز لتسجيل الدخول
      if (data.email) {
        console.log("📧 Email found:", data.email);

        setStep("password");
      } else {
        console.log(
          "⚠️ No email found. Moving to account setup."
        );

        setStep("setup");
      }
    } catch (err) {
      console.error("❌ Employee check error:", err);

      setError(
        err?.message ||
          "حدث خطأ أثناء التحقق من بيانات الموظف"
      );
    } finally {
      setLoading(false);
    }
  }

  // =========================================================
  // الخطوة الثانية:
  // الرقم الوظيفي
  // ↓
  // profiles
  // ↓
  // email
  // ↓
  // Supabase Auth
  // ↓
  // session
  // ↓
  // role
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
      console.log(
        "🔵 Login attempt:",
        employeeNumber.trim()
      );

      const result = await login(
        employeeNumber.trim(),
        password
      );

      // AuthContext يرجع:
      // {
      //   user,
      //   session
      // }
      if (!result?.user) {
        console.error(
          "❌ Login returned no user:",
          result
        );

        setError("تعذر الحصول على بيانات المستخدم");
        return;
      }

      const user = result.user;

      console.log("✅ Login successful:", user);
      console.log("👤 User role:", user.role);

      // التأكد من وجود صلاحية
      if (!user.role) {
        console.error(
          "❌ User has no role:",
          user
        );

        setError(
          "تم تسجيل الدخول، ولكن لم يتم تحديد صلاحية المستخدم"
        );

        return;
      }

      const destination = ROLE_HOME[user.role];

      if (!destination) {
        console.error(
          "❌ Unknown user role:",
          user.role
        );

        setError(
          "صلاحية المستخدم غير معروفة"
        );

        return;
      }

      console.log(
        "➡️ Navigating to:",
        destination
      );

      navigate(destination, {
        replace: true,
      });
    } catch (err) {
      console.error("❌ Login error:", err);

      setError(
        err?.message ||
          "حدث خطأ أثناء تسجيل الدخول"
      );
    } finally {
      setLoading(false);
    }
  }

  // =========================================================
  // إعداد أول تسجيل دخول
  // =========================================================
  async function handleSetup(e) {
    e.preventDefault();

    setError("");

    if (password.length < 8) {
      setError(
        "يجب أن تتكون كلمة المرور من 8 أحرف على الأقل"
      );
      return;
    }

    if (password !== password2) {
      setError("كلمتا المرور غير متطابقتين");
      return;
    }

    if (!email.trim()) {
      setError(
        "الرجاء إدخال البريد الإلكتروني"
      );
      return;
    }

    if (!profile) {
      setError(
        "بيانات الموظف غير موجودة"
      );
      return;
    }

    setLoading(true);

    try {
      console.log(
        "🔵 Creating Supabase Auth account..."
      );

      const {
        data: authData,
        error: signUpError,
      } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });

      if (signUpError) {
        console.error(
          "❌ Supabase signup error:",
          signUpError
        );

        setError(
          signUpError.message ||
            "تعذر إنشاء حساب الدخول"
        );

        return;
      }

      if (!authData?.user) {
        setError(
          "تعذر إنشاء حساب المستخدم"
        );

        return;
      }

      console.log(
        "✅ Supabase Auth user created:",
        authData.user.id
      );

      // =====================================================
      // تحديث profile وربطه بحساب Auth
      // =====================================================
      const {
        data: updatedProfile,
        error: updateError,
      } = await supabase
        .from("profiles")
        .update({
          id: authData.user.id,
          email: email.trim(),
        })
        .eq(
          "employee_number",
          employeeNumber.trim()
        )
        .select()
        .single();

      if (updateError) {
        console.error(
          "❌ Profile update error:",
          updateError
        );

        setError(
          "تم إنشاء حساب الدخول، لكن تعذر تحديث بيانات الملف الشخصي. تحقق من صلاحيات profiles."
        );

        return;
      }

      console.log(
        "✅ Profile updated:",
        updatedProfile
      );

      // =====================================================
      // إذا كان تأكيد البريد الإلكتروني مطلوبًا
      // =====================================================
      if (!authData.session) {
        setError(
          "تم إنشاء الحساب. تحقق من بريدك الإلكتروني لتأكيد الحساب، ثم سجل الدخول."
        );

        setStep("password");
        setEmail(email.trim());

        return;
      }

      // =====================================================
      // إذا تم إنشاء Session مباشرة
      // =====================================================
      const userProfile = updatedProfile || {
        ...profile,
        id: authData.user.id,
        email: email.trim(),
      };

      const role = userProfile.role;

      console.log(
        "👤 New account role:",
        role
      );

      if (!role) {
        setError(
          "تم إنشاء الحساب، ولكن لم يتم تحديد صلاحية المستخدم"
        );

        return;
      }

      const destination =
        ROLE_HOME[role] || "/";

      navigate(destination, {
        replace: true,
      });
    } catch (err) {
      console.error(
        "❌ First login setup error:",
        err
      );

      setError(
        err?.message ||
          "حدث خطأ أثناء إنشاء الحساب"
      );
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
            <strong>
              نظام تحضير أعضاء هيئة التدريس
            </strong>

            <span>
              جامعة القصيم
            </span>
          </div>
        </div>

        {error && (
          <div className="error-box">
            {error}
          </div>
        )}

        {/* ===================================================
            الخطوة الأولى: الرقم الوظيفي
           =================================================== */}
        {step === "employee" && (
          <form onSubmit={handleCheckEmployee}>
            <div className="field">
              <label>
                الرقم الوظيفي
              </label>

              <input
                autoFocus
                value={employeeNumber}
                onChange={(e) =>
                  setEmployeeNumber(
                    e.target.value
                  )
                }
                placeholder="مثال: 1001"
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              className="submit-btn"
              disabled={loading}
            >
              {loading
                ? "جارٍ التحقق..."
                : "متابعة"}
            </button>
          </form>
        )}

        {/* ===================================================
            الخطوة الثانية: كلمة المرور
           =================================================== */}
        {step === "password" && (
          <form onSubmit={handlePasswordLogin}>
            <div className="info-box">
              مرحبًا {fullName}، أدخل كلمة المرور لإكمال الدخول
            </div>

            <div className="field">
              <label>
                كلمة المرور
              </label>

              <input
                type="password"
                autoFocus
                value={password}
                onChange={(e) =>
                  setPassword(
                    e.target.value
                  )
                }
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              className="submit-btn"
              disabled={loading}
            >
              {loading
                ? "جارٍ الدخول..."
                : "تسجيل الدخول"}
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

        {/* ===================================================
            إعداد أول تسجيل دخول
           =================================================== */}
        {step === "setup" && (
          <form onSubmit={handleSetup}>
            <div className="info-box">
              مرحبًا {fullName}، هذا أول تسجيل دخول لك. الرجاء إنشاء كلمة مرور وإدخال بريدك الإلكتروني.
            </div>

            <div className="field">
              <label>
                كلمة المرور الجديدة
              </label>

              <input
                type="password"
                autoFocus
                value={password}
                onChange={(e) =>
                  setPassword(
                    e.target.value
                  )
                }
                disabled={loading}
              />
            </div>

            <div className="field">
              <label>
                تأكيد كلمة المرور
              </label>

              <input
                type="password"
                value={password2}
                onChange={(e) =>
                  setPassword2(
                    e.target.value
                  )
                }
                disabled={loading}
              />
            </div>

            <div className="field">
              <label>
                البريد الإلكتروني (لاستعادة كلمة المرور)
              </label>

              <input
                type="email"
                value={email}
                onChange={(e) =>
                  setEmail(
                    e.target.value
                  )
                }
                placeholder="name@qu.edu.sa"
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              className="submit-btn"
              disabled={loading}
            >
              {loading
                ? "جارٍ الحفظ..."
                : "إنشاء الحساب والدخول"}
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

