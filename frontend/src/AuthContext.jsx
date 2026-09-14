
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";

import { supabase } from "./lib/supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  // تحميل بيانات المستخدم من جدول profiles
  const loadProfile = useCallback(async (authUser) => {
    if (!authUser) {
      setUser(null);
      return null;
    }

    try {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", authUser.id)
        .maybeSingle();

      if (error) {
        console.error("❌ Profile Error:", error);
      }

      const userData = {
        id: authUser.id,
        email: authUser.email,
        ...(profile || {}),
      };

      setUser(userData);

      return userData;
    } catch (error) {
      console.error("❌ Failed to load profile:", error);

      const userData = {
        id: authUser.id,
        email: authUser.email,
      };

      setUser(userData);

      return userData;
    }
  }, []);

  // التحقق من جلسة Supabase عند تشغيل التطبيق
  useEffect(() => {
    let mounted = true;

    async function initializeAuth() {
      try {
        const {
          data: { session: currentSession },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          console.error("❌ Get Session Error:", error);
        }

        if (!mounted) return;

        setSession(currentSession);

        if (currentSession?.user) {
          await loadProfile(currentSession.user);
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error("❌ Auth initialization error:", error);

        if (mounted) {
          setSession(null);
          setUser(null);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    initializeAuth();

    // متابعة تغيّر حالة تسجيل الدخول
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!mounted) return;

      console.log("🔐 Auth event:", event);

      setSession(newSession);

      if (newSession?.user) {
        await loadProfile(newSession.user);
      } else {
        setUser(null);
      }

      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  // تسجيل الدخول باستخدام الرقم الوظيفي وكلمة المرور
  const login = useCallback(
    async (employeeNumber, password) => {
      try {
        console.log("🔵 Login attempt:", employeeNumber);

        // البحث عن الموظف في profiles
        const {
          data: profile,
          error: profileError,
        } = await supabase
          .from("profiles")
          .select("*")
          .eq("employee_number", employeeNumber)
          .maybeSingle();

        if (profileError) {
          console.error("❌ Profile Login Error:", profileError);
          throw new Error(profileError.message);
        }

        if (!profile) {
          throw new Error("الرقم الوظيفي غير موجود");
        }

        if (!profile.email) {
          throw new Error(
            "لا يوجد بريد إلكتروني مرتبط بهذا الرقم الوظيفي"
          );
        }

        console.log("✅ Employee found:", profile.email);

        // تسجيل الدخول باستخدام Supabase Auth
        const {
          data,
          error: authError,
        } = await supabase.auth.signInWithPassword({
          email: profile.email,
          password,
        });

        if (authError) {
          console.error("❌ Supabase Auth Error:", authError);
          throw new Error(authError.message);
        }

        if (!data?.session || !data?.user) {
          throw new Error("تعذر إنشاء جلسة تسجيل الدخول");
        }

        setSession(data.session);

        // تحميل بيانات profile بعد تسجيل الدخول
        const userData = await loadProfile(data.user);

        return {
          user:
            userData || {
              id: data.user.id,
              email: data.user.email,
            },
          session: data.session,
        };
      } catch (error) {
        console.error("❌ Login Error:", error);
        throw error;
      }
    },
    [loadProfile]
  );

  // تسجيل الخروج
  const logout = useCallback(async () => {
    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        throw error;
      }

      setUser(null);
      setSession(null);
    } catch (error) {
      console.error("❌ Logout Error:", error);
      throw error;
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// Hook لاستخدام بيانات المصادقة في بقية التطبيق
export const useAuth = () => {
  return useContext(AuthContext);
};

