import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export default {
  fetch: withSupabase(
    { auth: "user" },
    async (req, ctx) => {
      if (req.method === "OPTIONS") {
        return new Response("ok", {
          headers: corsHeaders,
        });
      }

      try {
        if (req.method !== "POST") {
          return Response.json(
            { error: "Method not allowed" },
            {
              status: 405,
              headers: corsHeaders,
            }
          );
        }

        // التحقق من المستخدم الحالي
        const {
          data: { user: authUser },
          error: authError,
        } = await ctx.supabase.auth.getUser();

        if (authError || !authUser) {
          return Response.json(
            { error: "يجب تسجيل الدخول أولًا" },
            {
              status: 401,
              headers: corsHeaders,
            }
          );
        }

        // التحقق من صلاحيات المدير
        const {
          data: adminProfile,
          error: adminError,
        } = await ctx.supabaseAdmin
          .from("profiles")
          .select("id, role, status")
          .eq("id", authUser.id)
          .maybeSingle();

        if (adminError) {
          console.error("Admin profile error:", adminError);

          return Response.json(
            { error: "تعذر التحقق من صلاحيات المدير" },
            {
              status: 500,
              headers: corsHeaders,
            }
          );
        }

        if (
          !adminProfile ||
          adminProfile.role !== "admin" ||
          adminProfile.status !== "active"
        ) {
          return Response.json(
            { error: "ليس لديك صلاحية لتنفيذ هذه العملية" },
            {
              status: 403,
              headers: corsHeaders,
            }
          );
        }

        // قراءة البيانات
        const body = await req.json();

        const employeeNumber = String(
          body.employee_number || ""
        ).trim();

        const fullName = String(
          body.full_name || ""
        ).trim();

        const email = String(
          body.email || ""
        )
          .trim()
          .toLowerCase();

        const role = String(
          body.role || "faculty"
        ).trim();

        const departmentId =
          body.department_id === null ||
          body.department_id === "" ||
          body.department_id === undefined
            ? null
            : Number(body.department_id);

        // التحقق من البيانات المطلوبة
        if (!employeeNumber) {
          return Response.json(
            { error: "الرقم الوظيفي مطلوب" },
            {
              status: 400,
              headers: corsHeaders,
            }
          );
        }

        if (!fullName) {
          return Response.json(
            { error: "الاسم الكامل مطلوب" },
            {
              status: 400,
              headers: corsHeaders,
            }
          );
        }

        if (!email) {
          return Response.json(
            { error: "البريد الإلكتروني مطلوب" },
            {
              status: 400,
              headers: corsHeaders,
            }
          );
        }

        // التحقق من الدور
        if (
          ![
            "faculty",
            "department_monitor",
            "admin",
          ].includes(role)
        ) {
          return Response.json(
            { error: "الدور المحدد غير صحيح" },
            {
              status: 400,
              headers: corsHeaders,
            }
          );
        }

        // التحقق من القسم
        if (
          departmentId !== null &&
          (!Number.isInteger(departmentId) ||
            departmentId <= 0)
        ) {
          return Response.json(
            { error: "القسم المحدد غير صحيح" },
            {
              status: 400,
              headers: corsHeaders,
            }
          );
        }

        // التحقق من عدم وجود الرقم الوظيفي
        const {
          data: existingProfile,
          error: existingError,
        } = await ctx.supabaseAdmin
          .from("profiles")
          .select("id, employee_number, email")
          .eq("employee_number", employeeNumber)
          .maybeSingle();

        if (existingError) {
          console.error(
            "Existing profile check error:",
            existingError
          );

          return Response.json(
            { error: "تعذر التحقق من الرقم الوظيفي" },
            {
              status: 500,
              headers: corsHeaders,
            }
          );
        }

        if (existingProfile) {
          return Response.json(
            { error: "الرقم الوظيفي موجود مسبقًا" },
            {
              status: 409,
              headers: corsHeaders,
            }
          );
        }

        // التحقق من عدم وجود البريد في Auth
        const {
          data: existingAuthUsers,
          error: authListError,
        } =
          await ctx.supabaseAdmin.auth.admin.listUsers({
            page: 1,
            perPage: 1000,
          });

        if (authListError) {
          console.error(
            "Auth users lookup error:",
            authListError
          );

          return Response.json(
            { error: "تعذر التحقق من البريد الإلكتروني" },
            {
              status: 500,
              headers: corsHeaders,
            }
          );
        }

        const emailExists =
          existingAuthUsers.users.some(
            (user) =>
              user.email?.toLowerCase() === email
          );

        if (emailExists) {
          return Response.json(
            { error: "البريد الإلكتروني مستخدم مسبقًا" },
            {
              status: 409,
              headers: corsHeaders,
            }
          );
        }

        // إنشاء كلمة مرور مؤقتة
        const temporaryPassword =
          `${crypto.randomUUID()}Aa1!`;

        // إنشاء مستخدم في Supabase Auth
        const {
          data: createdAuth,
          error: createAuthError,
        } =
          await ctx.supabaseAdmin.auth.admin.createUser({
            email,
            password: temporaryPassword,
            email_confirm: true,
          });

        if (
          createAuthError ||
          !createdAuth.user
        ) {
          console.error(
            "Create auth user error:",
            createAuthError
          );

          return Response.json(
            {
              error:
                createAuthError?.message ||
                "تعذر إنشاء حساب الدخول",
            },
            {
              status: 500,
              headers: corsHeaders,
            }
          );
        }

        const authUserId =
          createdAuth.user.id;

        // إنشاء Profile
        const {
          data: profile,
          error: profileInsertError,
        } = await ctx.supabaseAdmin
          .from("profiles")
          .insert({
            id: authUserId,
            employee_number: employeeNumber,
            full_name: fullName,
            email,
            department_id: departmentId,
            role,
            status: "active",
            must_set_password: true,
          })
          .select()
          .single();

        // في حال فشل إنشاء Profile نحذف مستخدم Auth
        if (profileInsertError) {
          console.error(
            "Profile insert error:",
            profileInsertError
          );

          await ctx.supabaseAdmin.auth.admin.deleteUser(
            authUserId
          );

          return Response.json(
            {
              error:
                "تعذر إنشاء بيانات المستخدم في profiles",
            },
            {
              status: 500,
              headers: corsHeaders,
            }
          );
        }

        // نجاح
        return Response.json(
          {
            success: true,
            message: "تمت إضافة المستخدم بنجاح",
            user: profile,
          },
          {
            status: 201,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      } catch (error) {
        console.error(
          "admin-users error:",
          error
        );

        return Response.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "حدث خطأ غير متوقع",
          },
          {
            status: 500,
            headers: corsHeaders,
          }
        );
      }
    }
  ),
};