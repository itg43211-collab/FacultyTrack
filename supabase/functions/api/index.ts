// ============================================================
// نظام تحضير أعضاء هيئة التدريس — Supabase Edge Function (API)
// ============================================================
// بديل كامل لسيرفر Express السابق:
//   • JWT عبر Supabase Auth (بدون bcrypt/jsonwebtoken)
//   • PostgreSQL عبر postgres.js (بدون SQLite)
//   • RBAC عبر جدول profiles
//   • كل التحقق الأمني (نافذة الوقت، GPS، الأدوار) هنا في السيرفر
//
// النشر:
//   supabase functions deploy api --no-verify-jwt
// (نستخدم --no-verify-jwt لأن بعض المسارات عامة
//  مثل /auth/bootstrap-admin و /auth/first-login-setup،
//  والتحقق من الجلسة يتم داخل الدالة نفسها لكل مسار محمي.)
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import postgres from "npm:postgres@3.4.5";

// ---------- الإعدادات ----------
const TZ = "Asia/Riyadh"; // المنطقة الزمنية المرجعية لكل حسابات الوقت
const GRACE_MINUTES = 15; // نافذة التحضير: (البداية - 15) إلى (النهاية + 15)

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DB_URL = Deno.env.get("DATABASE_URL") ?? "";


const sql = postgres(DB_URL, {
  max: 1, // transaction pooler
  prepare: false,
  ssl: DB_URL.includes("localhost") || DB_URL.includes("127.0.0.1")
    ? false
    : "require",
});

// عميل service role لإدارة حسابات Auth (إنشاء مستخدمين / تعيين كلمة مرور)
const adminAuth = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
};

// ---------- أدوات ----------
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { ...corsHeaders } });

const fail = (error: string, status = 400, extra?: Record<string, unknown>) =>
  json({ error, ...extra }, status);

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Haversine بالمتر */
function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** حالة نافذة التحضير بالنسبة لدقائق السيرفر الحالية */
function windowStatus(
  startTime: string,
  endTime: string,
  nowMinutes: number,
): "not_started" | "open" | "ended" {
  const windowStart = toMinutes(startTime) - GRACE_MINUTES;
  const windowEnd = toMinutes(endTime) + GRACE_MINUTES;
  if (nowMinutes < windowStart) return "not_started";
  if (nowMinutes > windowEnd) return "ended";
  return "open";
}

/** معلومات "الآن" في توقيت الرياض من قاعدة البيانات (المصدر الموحد للوقت) */
async function nowInfo() {
  const [row] = await sql`
    select
      to_char(now() at time zone ${TZ}, 'YYYY-MM-DD')   as today,
      extract(dow from now() at time zone ${TZ})::int   as dow,
      (extract(hour from now() at time zone ${TZ}) * 60
        + extract(minute from now() at time zone ${TZ}))::int as minutes,
      to_char(now() at time zone ${TZ}, 'HH24:MI:SS')   as clock
  `;
  return row as { today: string; dow: number; minutes: number; clock: string };
}

// ---------- CSV ----------
function decodeCsvBuffer(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // ترميز Windows-1256 الشائع عند حفظ Excel CSV على ويندوز عربي
    return new TextDecoder("windows-1256").decode(bytes);
  }
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = {
    ",": (firstLine.match(/,/g) ?? []).length,
    ";": (firstLine.match(/;/g) ?? []).length,
    "\t": (firstLine.match(/\t/g) ?? []).length,
  };
  let best = ",", bestCount = counts[","];
  for (const [delim, count] of Object.entries(counts)) {
    if (count > bestCount) best = delim, bestCount = count;
  }
  return best;
}

function parseCsv(
  text: string,
  delimiter: string,
): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [], field = "", i = 0, inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') field += '"', i += 2;
        else inQuotes = false, i += 1;
      } else field += ch, i += 1;
      continue;
    }
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === delimiter) { cur.push(field); field = ""; i += 1; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      cur.push(field);
      if (cur.length > 1 || cur[0] !== "") rows.push(cur);
      cur = []; field = ""; i += 1; continue;
    }
    field += ch; i += 1;
  }
  if (field !== "" || cur.length) { cur.push(field); rows.push(cur); }
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, idx) => o[h] = (r[idx] ?? "").trim());
    return o;
  });
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(
  fields: { label: string; value: string | ((r: Record<string, unknown>) => unknown) }[],
  rows: Record<string, unknown>[],
): string {
  const head = fields.map((f) => csvEscape(f.label)).join(",");
  const body = rows.map((r) =>
    fields.map((f) =>
      csvEscape(typeof f.value === "function" ? f.value(r) : r[f.value])
    ).join(",")
  ).join("\r\n");
  return "\ufeff" + head + "\r\n" + body; // BOM ليفتح مباشرة في Excel بالعربية
}

// ---------- المصادقة ----------
type Profile = {
  id: string;
  employee_number: string;
  full_name: string;
  role: "admin" | "faculty" | "monitor";
  department_id: number | null;
  email: string | null;
  must_set_password: boolean;
  status: string;
};

async function getProfile(req: Request): Promise<Profile | null> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const scoped = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error } = await scoped.auth.getUser();
  if (error || !user) return null;
  const [profile] = await sql`
    select id, employee_number, full_name, role, department_id, email,
           must_set_password, status
      from profiles where id = ${user.id}
  `;
  return (profile as Profile) ?? null;
}

async function requireProfile(req: Request, roles: string[]) {
  const profile = await getProfile(req);
  if (!profile) {
    return {
      error: json(
        { error: "غير مصرح: يرجى تسجيل الدخول" },
        401,
      ),
    } as const;
  }
  if (profile.status === "disabled") {
    return {
      error: fail("هذا الحساب معطّل. يرجى مراجعة إدارة النظام.", 403),
    } as const;
  }
  if (!roles.includes(profile.role)) {
    return {
      error: fail("لا تملك صلاحية الوصول لهذا المورد", 403),
    } as const;
  }
  return { profile } as const;
}

// ============================================================
// المسارات
// ============================================================
const routes: {
  method: string;
  pattern: RegExp;
  handler: (c: Ctx) => Promise<Response>;
}[] = [];

type Ctx = {
  req: Request;
  url: URL;
  body: Record<string, unknown>;
  params: Record<string, string>;
  profile: Profile | null; // null للمسارات العامة
};

function route(
  method: string,
  path: string,
  handler: (c: Ctx) => Promise<Response>,
) {
  // :param → (?<param>[^/]+)
  const regex = new RegExp(
    "^" + path.replace(/:[^/]+/g, (m) => `(?<${m.slice(1)}>[^/]+)`) + "$",
  );
  routes.push({ method, pattern: regex, handler });
}

// ---------------- عام (بدون تسجيل دخول) ----------------

route("GET", "/health", async () => json({ ok: true }));

/** إنشاء حساب المدير الأول — يعمل فقط إذا لم يوجد أي admin بعد */
route("POST", "/auth/bootstrap-admin", async (c) => {
  const { employee_number, full_name, email, password } = c.body as Record<string, string>;
  if (!employee_number || !full_name || !email || !password) {
    return fail("جميع الحقول مطلوبة (الرقم الوظيفي، الاسم، البريد، كلمة المرور)");
  }
  if (String(password).length < 8) {
    return fail("يجب أن تتكون كلمة المرور من 8 أحرف على الأقل");
  }
  const [existingAdmin] = await sql`
    select count(*)::int as c from profiles where role = 'admin'
  `;
  if (existingAdmin.c > 0) {
    return fail("يوجد مدير للنظام بالفعل — استخدم تسجيل الدخول العادي", 403);
  }
  const [dup] = await sql`
    select 1 from profiles where employee_number = ${String(employee_number).trim()}
  `;
  if (dup) return fail("الرقم الوظيفي مستخدم مسبقًا", 409);

  const emailNorm = String(email).trim().toLowerCase();
  const { data: created, error: createErr } = await adminAuth.auth.admin
    .createUser({
      email: emailNorm,
      password: String(password),
      email_confirm: true,
    });
  if (createErr || !created?.user) {
    return fail(createErr?.message ?? "تعذر إنشاء حساب الدخول", 500);
  }
  const [profile] = await sql`
    insert into profiles
      (id, employee_number, full_name, role, department_id, email, must_set_password, status)
    values
      (${created.user.id}, ${String(employee_number).trim()}, ${String(full_name).trim()},
       'admin', null, ${emailNorm}, false, 'active')
    returning id
  `;
  return json({ id: profile.id, message: "تم إنشاء حساب المدير بنجاح" }, 201);
});

/** أول تسجيل دخول: إعداد كلمة المرور للحساب الذي أنشأه المدير */
route("POST", "/auth/first-login-setup", async (c) => {
  const { employee_number, password, email } = c.body as Record<string, string>;
  const emp = String(employee_number ?? "").trim();
  if (!emp || !password) {
    return fail("الرجاء إدخال الرقم الوظيفي وكلمة المرور");
  }
  if (String(password).length < 8) {
    return fail("يجب أن تتكون كلمة المرور من 8 أحرف على الأقل");
  }
  const [profile] = await sql`
    select * from profiles where employee_number = ${emp}
  `;
  if (!profile) return fail("الحساب غير موجود", 404);
  if (profile.status === "disabled") {
    return fail("هذا الحساب معطّل. يرجى مراجعة إدارة النظام.", 403);
  }
  if (!profile.must_set_password) {
    return fail("تم إعداد هذا الحساب مسبقًا، يرجى تسجيل الدخول بكلمة المرور", 400);
  }

  // البريد: يبقى البريد المسجَّل من المدير، أو يُحدَّث إن أدخل المستخدم بريدًا جديدًا
  let emailNorm = String(profile.email ?? "").trim().toLowerCase();
  if (email && String(email).trim()) {
    const candidate = String(email).trim().toLowerCase();
    if (candidate !== emailNorm) {
      const [emailTaken] = await sql`
        select 1 from profiles where email = ${candidate} and id <> ${profile.id}
      `;
      if (emailTaken) return fail("البريد الإلكتروني مستخدم من حساب آخر", 409);
      const [authUser] = await sql`
        select 1 from auth.users where email = ${candidate}
      `;
      if (authUser) return fail("البريد الإلكتروني مستخدم مسبقًا", 409);
      emailNorm = candidate;
    }
  }
  if (!emailNorm) return fail("لا يوجد بريد إلكتروني مرتبط بهذا الحساب — راجع إدارة النظام");

  // تعيين كلمة المرور في Supabase Auth + تحديث البريد
  const { error: updErr } = await adminAuth.auth.admin.updateUserById(
    profile.id,
    { password: String(password), email: emailNorm, email_confirm: true },
  );
  if (updErr) return fail(updErr.message ?? "تعذر إعداد كلمة المرور", 500);

  await sql`
    update profiles
       set must_set_password = false, email = ${emailNorm}
     where id = ${profile.id}
  `;

  return json({
    message: "تم إعداد حسابك بنجاح، يمكنك الآن تسجيل الدخول",
    email: emailNorm,
  });
});

// ---------------- عضو هيئة التدريس (faculty) ----------------

route("GET", "/faculty/dashboard", async (c) => {
  const profile = c.profile!;
  const t = await nowInfo();
  const [semester] = await sql`
    select id, name from semesters where is_active = true limit 1
  `;
  if (!semester) {
    return json({
      full_name: profile.full_name,
      employee_number: profile.employee_number,
      department: null,
      semester: null,
      today_lecture_count: 0,
      done_count: 0,
      absent_count: 0,
      lectures: [],
    });
  }
  const [dept] = profile.department_id
    ? await sql`select name from departments where id = ${profile.department_id}`
    : [null];

  const lectures = await sql`
    select s.id as schedule_id, s.start_time, s.end_time, s.section,
           c.name as course_name, c.code as course_code
      from schedules s
      join courses c on c.id = s.course_id
     where s.faculty_id = ${profile.id}
       and s.semester_id = ${semester.id}
       and s.day_of_week = ${t.dow}
     order by s.start_time
  `;
  const ids = lectures.map((l) => l.schedule_id);
  const attRows = ids.length
    ? await sql`
        select * from attendance
         where schedule_id = any(${ids}::bigint[]) and date = ${t.today}
      `
    : [];
  type Att = {
    schedule_id: number | string;
    status: string;
    check_in_time: string | null;
  };
  const attBySchedule = new Map<number, Att>(
    (attRows as unknown as Att[]).map((a) => [Number(a.schedule_id), a]),
  );

  const lecturesOut = lectures.map((l) => {
    const att = attBySchedule.get(Number(l.schedule_id));
    const wStatus = windowStatus(l.start_time, l.end_time, t.minutes);
    let buttonState = "not_started";
    if (att && att.status === "present") buttonState = "done";
    else if (att && att.status === "excused") buttonState = "excused";
    else if (wStatus === "open") buttonState = "available";
    else if (wStatus === "ended") buttonState = "closed";
    return {
      schedule_id: Number(l.schedule_id),
      course_name: l.course_name,
      course_code: l.course_code,
      section: l.section,
      start_time: l.start_time,
      end_time: l.end_time,
      status: att ? att.status : (wStatus === "ended" ? "absent" : "pending"),
      button_state: buttonState,
      check_in_time: att ? att.check_in_time : null,
    };
  });

  return json({
    full_name: profile.full_name,
    employee_number: profile.employee_number,
    department: dept ? dept.name : null,
    semester: semester.name,
    today_lecture_count: lecturesOut.length,
    done_count: lecturesOut.filter((l) => l.status === "present").length,
    absent_count: lecturesOut.filter((l) => l.status === "absent").length,
    lectures: lecturesOut,
  });
});

/** تسجيل الحضور عبر GPS — كل التحقق هنا في السيرفر */
route("POST", "/faculty/attendance/check-in", async (c) => {
  const profile = c.profile!;
  const { schedule_id, lat, lng } = c.body as Record<string, number>;
  if (schedule_id === undefined || lat === undefined || lng === undefined) {
    return fail("بيانات ناقصة: يلزم رقم المحاضرة والموقع الجغرافي");
  }
  if (typeof lat !== "number" || typeof lng !== "number") {
    return fail("إحداثيات الموقع غير صحيحة");
  }

  const t = await nowInfo();
  const [semester] = await sql`
    select id from semesters where is_active = true limit 1
  `;
  if (!semester) return fail("لا يوجد فصل دراسي فعّال حاليًا");

  // 1) المحاضرة ضمن جدول هذا العضو فعلًا
  const [schedule] = await sql`
    select s.*, c.name as course_name
      from schedules s
      join courses c on c.id = s.course_id
     where s.id = ${Number(schedule_id)}
       and s.faculty_id = ${profile.id}
       and s.semester_id = ${semester.id}
  `;
  if (!schedule) return fail("هذه المحاضرة غير موجودة ضمن جدولك", 404);

  // 2) اليوم مطابق ليوم المحاضرة
  if (Number(schedule.day_of_week) !== t.dow) {
    return fail("هذه المحاضرة ليست مجدولة لهذا اليوم");
  }

  // 3) النافذة الزمنية (توقيت السيرفر/الرياض فقط)
  const wStatus = windowStatus(schedule.start_time, schedule.end_time, t.minutes);
  if (wStatus === "not_started") {
    return fail("لم يبدأ وقت التحضير لهذه المحاضرة بعد");
  }
  if (wStatus === "ended") {
    return fail("انتهى وقت التحضير المسموح لهذه المحاضرة");
  }

  // 4) منع التحضير المكرر
  const [existing] = await sql`
    select * from attendance
     where schedule_id = ${Number(schedule_id)} and date = ${t.today}
  `;
  if (existing && existing.status === "present") {
    return fail("تم تسجيل حضورك مسبقًا لهذه المحاضرة");
  }

  // 5) التحقق الجغرافي من موقع الجامعة المخزَّن في السيرفر فقط
  const [loc] = await sql`
    select * from university_location order by id limit 1
  `;
  if (!loc) {
    return fail("لم يتم إعداد موقع الجامعة بعد، راجع إدارة النظام", 500);
  }
  const distance = distanceMeters(lat, lng, loc.lat, loc.lng);
  const radiusMeters = loc.radius_km * 1000;
  if (distance > radiusMeters) {
    return fail("لا يمكن تسجيل الحضور لأنك خارج نطاق الجامعة.", 403, {
      distance_meters: Math.round(distance),
      allowed_radius_meters: radiusMeters,
    });
  }

  const checkInTime = t.clock;
  if (existing) {
    await sql`
      update attendance
         set status = 'present', check_in_time = ${checkInTime},
             lat = ${lat}, lng = ${lng}, distance_meters = ${distance},
             verified = true, marked_by = 'self'
       where id = ${existing.id}
    `;
  } else {
    await sql`
      insert into attendance
        (schedule_id, faculty_id, date, status, check_in_time, lat, lng, distance_meters, verified, marked_by)
      values
        (${Number(schedule_id)}, ${profile.id}, ${t.today}, 'present',
         ${checkInTime}, ${lat}, ${lng}, ${distance}, true, 'self')
    `;
  }

  return json({
    message: "تم تسجيل حضورك بنجاح.",
    course_name: schedule.course_name,
    check_in_time: checkInTime,
    distance_meters: Math.round(distance),
  });
});

/** تسجيل عذر عن محاضرة معينة (تاريخ محدد) */
route("POST", "/faculty/excuses", async (c) => {
  const profile = c.profile!;
  const { schedule_id, date, type, notes } = c.body as Record<string, string>;
  if (!schedule_id || !date || !type) {
    return fail("بيانات ناقصة لتسجيل العذر");
  }
  if (!["health", "family", "other"].includes(type)) {
    return fail("نوع عذر غير صحيح");
  }
  const [schedule] = await sql`
    select * from schedules
     where id = ${Number(schedule_id)} and faculty_id = ${profile.id}
  `;
  if (!schedule) return fail("المحاضرة غير موجودة ضمن جدولك", 404);

  await sql.begin(async (tx) => {
    const [attendance] = await tx`
      select * from attendance
       where schedule_id = ${Number(schedule_id)} and date = ${date}
    `;
    let attendanceId: number;
    if (!attendance) {
      const [ins] = await tx`
        insert into attendance (schedule_id, faculty_id, date, status, marked_by)
        values (${Number(schedule_id)}, ${profile.id}, ${date}, 'excused', 'self')
        returning id
      `;
      attendanceId = Number(ins.id);
    } else {
      await tx`update attendance set status = 'excused' where id = ${attendance.id}`;
      attendanceId = Number(attendance.id);
    }
    await tx`
      insert into excuses (attendance_id, type, notes, excuse_date, status)
      values (${attendanceId}, ${type}, ${notes || null}, ${date}, 'pending')
    `;
  });

  return json({ message: "تم تسجيل العذر بنجاح، بانتظار المراجعة" });
});

/** سجل الحضور الكامل للعضو */
route("GET", "/faculty/history", async (c) => {
  const profile = c.profile!;
  const rows = await sql`
    select a.date::text as date, a.status, a.check_in_time, c.name as course_name,
           s.start_time, s.end_time
      from attendance a
      join schedules s on s.id = a.schedule_id
      join courses c on c.id = s.course_id
     where a.faculty_id = ${profile.id}
     order by a.date desc
  `;
  return json({ history: rows });
});

// ---------------- المدير (admin) ----------------

route("GET", "/admin/departments", async () => {
  const departments = await sql`select * from departments order by name`;
  return json({ departments });
});

route("POST", "/admin/departments", async (c) => {
  const { name, name_en } = c.body as Record<string, string>;
  if (!name) return fail("اسم القسم مطلوب");
  const [dup] = await sql`select 1 from departments where name = ${String(name).trim()}`;
  if (dup) return fail("القسم موجود مسبقًا");
  const [row] = await sql`
    insert into departments (name, name_en) values (${String(name).trim()}, ${name_en || null})
    returning id
  `;
  return json({ id: Number(row.id) });
});

route("GET", "/admin/semesters", async () => {
  const semesters = await sql`select * from semesters order by start_date desc`;
  return json({ semesters });
});

route("POST", "/admin/semesters", async (c) => {
  const { name, start_date, end_date } = c.body as Record<string, string>;
  if (!name || !start_date || !end_date) return fail("جميع الحقول مطلوبة");
  const [row] = await sql`
    insert into semesters (name, start_date, end_date, is_active)
    values (${String(name).trim()}, ${start_date}, ${end_date}, false)
    returning id
  `;
  return json({ id: Number(row.id) });
});

route("POST", "/admin/semesters/:id/activate", async (c) => {
  // التريغر يضمن إيقاف بقية الفصول تلقائيًا
  const [row] = await sql`
    update semesters set is_active = true where id = ${Number(c.params.id)}
    returning id
  `;
  if (!row) return fail("الفصل الدراسي غير موجود", 404);
  return json({ message: "تم تفعيل الفصل الدراسي" });
});

route("POST", "/admin/semesters/:id/deactivate", async (c) => {
  await sql`update semesters set is_active = false where id = ${Number(c.params.id)}`;
  return json({ message: "تم إيقاف الفصل الدراسي" });
});

route("GET", "/admin/location", async () => {
  const [location] = await sql`select * from university_location order by id limit 1`;
  return json({ location: location ?? null });
});

route("PUT", "/admin/location", async (c) => {
  const { lat, lng, radius_km, name } = c.body as Record<string, number | string>;
  if (lat === undefined || lng === undefined || radius_km === undefined) {
    return fail("الإحداثيات والنطاق مطلوبة");
  }
  const [existing] = await sql`select * from university_location order by id limit 1`;
  if (existing) {
    await sql`
      update university_location
         set lat = ${Number(lat)}, lng = ${Number(lng)},
             radius_km = ${Number(radius_km)},
             name = ${name || existing.name}
       where id = ${existing.id}
    `;
  } else {
    await sql`
      insert into university_location (name, lat, lng, radius_km)
      values (${name || "الموقع الرئيسي"}, ${Number(lat)}, ${Number(lng)}, ${Number(radius_km)})
    `;
  }
  return json({ message: "تم تحديث موقع الجامعة" });
});

route("GET", "/admin/users", async () => {
  const users = await sql`
    select u.id, u.employee_number, u.full_name, u.role, u.status, u.email,
           u.must_set_password, u.department_id, d.name as department_name
      from profiles u
      left join departments d on d.id = u.department_id
     order by u.role, u.full_name
  `;
  return json({ users });
});

/** إنشاء مستخدم: ينشئ حساب Supabase Auth بكلمة مرور مؤقتة + صف في profiles */
route("POST", "/admin/users", async (c) => {
  const { employee_number, full_name, role, department_id, email } =
    c.body as Record<string, string>;
  const emp = String(employee_number ?? "").trim();
  const name = String(full_name ?? "").trim();
  const emailNorm = String(email ?? "").trim().toLowerCase();

  if (!emp || !name || !role) return fail("بيانات ناقصة");
  if (!["admin", "faculty", "monitor"].includes(role)) return fail("دور غير صحيح");
  if (!emailNorm) {
    return fail("البريد الإلكتروني مطلوب لإنشاء حساب الدخول في Supabase");
  }

  const [dupEmp] = await sql`select 1 from profiles where employee_number = ${emp}`;
  if (dupEmp) return fail("الرقم الوظيفي مستخدم مسبقًا", 409);
  const [dupEmail] = await sql`select 1 from profiles where email = ${emailNorm}`;
  if (dupEmail) return fail("البريد الإلكتروني مستخدم مسبقًا", 409);

  // كلمة مرور مؤقتة عشوائية — يفرض على المستخدم تغييرها عند أول دخول
  const tempPassword =
    `${crypto.randomUUID()}Aa1!`;

  const { data: created, error: createErr } = await adminAuth.auth.admin
    .createUser({
      email: emailNorm,
      password: tempPassword,
      email_confirm: true,
    });
  if (createErr || !created?.user) {
    return fail(createErr?.message ?? "تعذر إنشاء حساب الدخول", 500);
  }

  const deptId = department_id ? Number(department_id) : null;
  try {
    const [row] = await sql`
      insert into profiles
        (id, employee_number, full_name, role, department_id, email, must_set_password, status)
      values
        (${created.user.id}, ${emp}, ${name}, ${role}, ${deptId}, ${emailNorm}, true, 'active')
      returning id
    `;
    return json({ id: row.id });
  } catch (e) {
    // تنظيف حساب Auth إن فشل إنشاء البروفايل
    await adminAuth.auth.admin.deleteUser(created.user.id);
    console.error("profile insert failed:", e);
    return fail("تعذر إنشاء بيانات المستخدم", 500);
  }
});

route("PUT", "/admin/users/:id/status", async (c) => {
  const { status } = c.body as Record<string, string>;
  if (!["active", "disabled"].includes(status)) return fail("حالة غير صحيحة");
  await sql`update profiles set status = ${status} where id = ${c.params.id}`;
  return json({ message: "تم تحديث حالة الحساب" });
});

/** إعادة تعيين: يطلب من العضو إعداد كلمة مرور جديدة عند الدخول القادم */
route("POST", "/admin/users/:id/reset-password", async (c) => {
  await sql`
    update profiles set must_set_password = true where id = ${c.params.id}
  `;
  return json({
    message: "تمت إعادة تعيين الحساب، سيُطلب من العضو إعداد كلمة مرور جديدة عند الدخول القادم",
  });
});

/** استيراد CSV لأعضاء هيئة التدريس */
route("POST", "/admin/faculty/import", async (c) => {
  const payload = await readImportPayload(c);
  if ("error" in payload) return payload.error as Response;
  const records = payload.records;
  const strict = c.url.searchParams.get("strict") === "true";

  const errors: string[] = [];
  type ToInsert = {
    employee_number: string;
    full_name: string;
    department_id: number | null;
  };
  const toInsert: ToInsert[] = [];
  const seen = new Set<string>();

  const departments = await sql`select id, name from departments`;
  const deptByName = new Map<string, number>(
    (departments as unknown as { id: number; name: string }[]).map((d) => [
      String(d.name).trim(),
      Number(d.id),
    ]),
  );

  for (let idx = 0; idx < records.length; idx++) {
    const r = records[idx];
    const rowNum = idx + 2;
    const employee_number = String(r.employee_number ?? r["الرقم الوظيفي"] ?? "").trim();
    const full_name = String(r.full_name ?? r["الاسم"] ?? "").trim();
    const department_name = String(
      r.department_name ?? r["القسم"] ?? r["التخصص"] ?? "",
    ).trim();

    if (!employee_number || !full_name) {
      errors.push(`السطر ${rowNum}: بيانات ناقصة (الاسم أو الرقم الوظيفي)`);
      continue;
    }
    if (seen.has(employee_number)) {
      errors.push(`السطر ${rowNum}: الرقم الوظيفي ${employee_number} مكرر داخل الملف`);
      continue;
    }
    seen.add(employee_number);
    const [existing] = await sql`
      select 1 from profiles where employee_number = ${employee_number}
    `;
    if (existing) {
      // ليس خطأ يوقف الاستيراد — يسمح بإعادة رفع نفس ملف الأعضاء لاحقًا بأمان
      errors.push(`السطر ${rowNum}: الرقم الوظيفي ${employee_number} موجود مسبقًا — تم تجاهله`);
      continue;
    }
    let department_id: number | null = null;
    if (department_name) {
      department_id = deptByName.get(department_name) ?? null;
      if (!department_id) {
        const [createdDept] = await sql`
          insert into departments (name) values (${department_name})
          on conflict (name) do update set name = excluded.name
          returning id
        `;
        department_id = Number(createdDept.id);
        deptByName.set(department_name, department_id);
      }
    }
    toInsert.push({ employee_number, full_name, department_id });
  }

  if (errors.length > 0 && strict) {
    return fail("تم رصد أخطاء في الملف", 400, { errors });
  }

  let imported = 0;
  for (const row of toInsert) {
    // بريد مؤقت فريد يُستخدم كمعرّف لحساب الدخول — يمكن للعضو تغييره عند أول دخول.
    // (سجل الدخول يتم بالرقم الوظيفي، والبريد مجرد مُعرّف لـ Supabase Auth)
    const email = `${row.employee_number}@attendance.local`;
    const { data: created, error: createErr } = await adminAuth.auth.admin
      .createUser({ email, password: tempPassword(), email_confirm: true });
    if (createErr || !created?.user) {
      errors.push(`تعذر إنشاء حساب دخول للعضو ${row.employee_number}`);
      continue;
    }
    try {
      await sql`
        insert into profiles
          (id, employee_number, full_name, role, department_id, email, must_set_password, status)
        values
          (${created.user.id}, ${row.employee_number}, ${row.full_name},
           'faculty', ${row.department_id}, ${email}, true, 'active')
      `;
      imported++;
    } catch {
      await adminAuth.auth.admin.deleteUser(created.user.id);
      errors.push(`تعذر حفظ بيانات العضو ${row.employee_number}`);
    }
  }

  return json({
    message: `تم استيراد ${imported} عضو بنجاح`,
    imported,
    errors,
  });
});

/** خريطة أسماء الأيام (تقبل الرسمين "الإثنين"/"الاثنين" وغيرها من فروق الهمزة) */
const DAY_MAP: Record<string, number> = {
  "الاحد": 0, "الأحد": 0,
  "الاثنين": 1, "الإثنين": 1,
  "الثلاثاء": 2, "الثلاثاء ": 2,
  "الاربعاء": 3, "الأربعاء": 3,
  "الخميس": 4,
  "الجمعة": 5,
  "السبت": 6,
};

/** تطبيع نص الوقت: يقبل بدون صفر بادئ (8:00)، مع ثوانٍ (08:00:00)،
 *  ومع لاحقة ص/م أو AM/PM فيحوّلها لصيغة 24 ساعة. لا "يخمّن" صباحاً/مساءً
 *  عند غياب أي مؤشر — فقط يعيد الصياغة لصيغة HH:MM القياسية. */
function normalizeTime(raw: string): string | null {
  let v = String(raw ?? "").trim();
  if (!v) return null;
  let meridiem: "am" | "pm" | null = null;
  const arabicSuffix = v.match(/\s*(ص|م)\s*$/);
  if (arabicSuffix) {
    meridiem = arabicSuffix[1] === "م" ? "pm" : "am";
    v = v.slice(0, arabicSuffix.index).trim();
  } else {
    const enSuffix = v.match(/\s*(am|pm)\s*$/i);
    if (enSuffix) {
      meridiem = enSuffix[1].toLowerCase() as "am" | "pm";
      v = v.slice(0, enSuffix.index).trim();
    }
  }
  const m = v.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** استيراد CSV لجداول المحاضرات — يقبل أيضًا الملف الموحّد (الرقم الوظيفي +
 *  الاسم + القسم + بيانات المحاضرة في نفس السطر): إن لم يوجد عضو بهذا الرقم
 *  الوظيفي ووُجد عمود "الاسم"، يُنشأ العضو تلقائيًا (بنفس منطق استيراد
 *  الأعضاء) قبل إضافة محاضرته. الأقسام غير الموجودة تُنشأ تلقائيًا بالاسم
 *  الوارد في الملف. إعادة رفع نفس الملف لاحقًا آمنة: المحاضرات المطابقة
 *  تمامًا لمحاضرة موجودة تُتجاهل بدل تكرارها، والأعضاء الموجودون يُتجاهَلون. */
route("POST", "/admin/schedules/import", async (c) => {
  const [activeSemester] = await sql`
    select * from semesters where is_active = true limit 1
  `;
  if (!activeSemester) return fail("لا يوجد فصل دراسي فعّال لربط الجدول به");

  const payload = await readImportPayload(c);
  if ("error" in payload) return payload.error as Response;
  const records = payload.records;

  const errors: string[] = [];

  // ---------- المرحلة 1: قراءة وتنظيف كل الصفوف بالذاكرة (بدون أي استعلام قاعدة بيانات) ----------
  type ParsedRow = {
    rowNum: number;
    employee_number: string;
    full_name: string;
    department_name: string;
    course_name: string;
    course_code: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    section: string;
  };
  const parsed: ParsedRow[] = [];

  for (let idx = 0; idx < records.length; idx++) {
    const r = records[idx];
    const rowNum = idx + 2;
    const employee_number = String(r.employee_number ?? r["الرقم الوظيفي"] ?? "").trim();
    const full_name = String(r.full_name ?? r["الاسم"] ?? "").trim();
    const department_name = String(r.department_name ?? r["القسم"] ?? "").trim();
    const course_name = String(r.course_name ?? r["اسم المقرر"] ?? "").trim();
    const course_code = String(r.course_code ?? r["رمز المقرر"] ?? "").trim();
    const dayRaw = String(r.day ?? r["اليوم"] ?? "").trim();
    const start_time = normalizeTime(String(r.start_time ?? r["وقت البداية"] ?? ""));
    const end_time = normalizeTime(String(r.end_time ?? r["وقت النهاية"] ?? ""));
    const section = String(r.section ?? r["الشعبة"] ?? "").trim();

    if (!employee_number || !course_name || !dayRaw || !start_time || !end_time) {
      errors.push(`السطر ${rowNum}: بيانات ناقصة أو صيغة وقت غير صحيحة`);
      continue;
    }
    const day_of_week = DAY_MAP[dayRaw] !== undefined
      ? DAY_MAP[dayRaw]
      : (isNaN(Number(dayRaw)) ? null : Number(dayRaw));
    if (day_of_week === null || day_of_week === undefined || day_of_week < 0 || day_of_week > 6) {
      errors.push(`السطر ${rowNum}: قيمة اليوم "${dayRaw}" غير صحيحة`);
      continue;
    }
    parsed.push({
      rowNum, employee_number, full_name, department_name, course_name,
      course_code, day_of_week, start_time, end_time, section,
    });
  }

  // ---------- المرحلة 2: الأقسام — تحميل الموجود، إنشاء الناقص دفعة واحدة ----------
  const deptRows = await sql`select id, name from departments`;
  const deptByName = new Map<string, number>(
    (deptRows as unknown as { id: number; name: string }[]).map((d) => [String(d.name).trim(), Number(d.id)]),
  );
  const neededDeptNames = [...new Set(
    parsed.filter((p) => p.department_name).map((p) => p.department_name),
  )].filter((n) => !deptByName.has(n));
  if (neededDeptNames.length) {
    const insertedDepts = await sql`
      insert into departments ${sql(neededDeptNames.map((name) => ({ name })), "name")}
      on conflict (name) do update set name = excluded.name
      returning id, name
    `;
    for (const d of insertedDepts as unknown as { id: number; name: string }[]) {
      deptByName.set(String(d.name).trim(), Number(d.id));
    }
  }

  // ---------- المرحلة 3: الأعضاء — تحميل الموجود، إنشاء الناقص ----------
  const employeeNumbers = [...new Set(parsed.map((p) => p.employee_number))];
  const existingProfiles = employeeNumbers.length
    ? await sql`
        select * from profiles
         where employee_number = any(${employeeNumbers}::text[]) and role = 'faculty'
      `
    : [];
  type ProfileRow = { id: string; employee_number: string; department_id: number | null };
  const facultyByEmp = new Map<string, ProfileRow>(
    (existingProfiles as unknown as ProfileRow[]).map((p) => [String(p.employee_number).trim(), p]),
  );

  // أول ظهور لكل رقم وظيفي غير مسجَّل بعد (مع اسمه) — نستخدمه لإنشاء الأعضاء الناقصين
  const newMembers = new Map<string, { full_name: string; department_id: number | null }>();
  for (const p of parsed) {
    if (facultyByEmp.has(p.employee_number) || newMembers.has(p.employee_number)) continue;
    if (!p.full_name) {
      errors.push(`السطر ${p.rowNum}: لا يوجد عضو هيئة تدريس بالرقم الوظيفي ${p.employee_number}`);
      continue;
    }
    newMembers.set(p.employee_number, {
      full_name: p.full_name,
      department_id: p.department_name ? deptByName.get(p.department_name) ?? null : null,
    });
  }

  let createdMembers = 0;
  if (newMembers.size) {
    const toInsertProfiles: {
      id: string; employee_number: string; full_name: string; role: string;
      department_id: number | null; email: string; must_set_password: boolean; status: string;
    }[] = [];
    // إنشاء حسابات Auth (لا يوجد إنشاء دفعي في Supabase Auth) — بالتوازي على دفعات لتقليل الوقت الكلي
    const memberEntries = [...newMembers.entries()];
    const CONCURRENCY = 10;
    for (let i = 0; i < memberEntries.length; i += CONCURRENCY) {
      const batch = memberEntries.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(async ([employee_number, info]) => {
        const email = `${employee_number}@attendance.local`;
        const { data: created, error: createErr } = await adminAuth.auth.admin
          .createUser({ email, password: tempPassword(), email_confirm: true });
        if (createErr || !created?.user) return { ok: false as const, employee_number };
        return {
          ok: true as const,
          profile: {
            id: created.user.id, employee_number, full_name: info.full_name, role: "faculty",
            department_id: info.department_id, email, must_set_password: true, status: "active",
          },
        };
      }));
      for (const r of results) {
        if (r.ok) toInsertProfiles.push(r.profile);
        else errors.push(`تعذر إنشاء حساب دخول للعضو ${r.employee_number}`);
      }
    }
    if (toInsertProfiles.length) {
      const insertedProfiles = await sql`
        insert into profiles ${
          sql(
            toInsertProfiles,
            "id", "employee_number", "full_name", "role",
            "department_id", "email", "must_set_password", "status",
          )
        }
        returning *
      `;
      for (const p of insertedProfiles as unknown as ProfileRow[]) {
        facultyByEmp.set(String(p.employee_number).trim(), p);
      }
      createdMembers = insertedProfiles.length;
    }
  }

  // بعد إنشاء الأعضاء: استبعاد أي صف ما زال بلا عضو مطابق (فشل إنشاء الحساب)
  const rowsWithFaculty = parsed.filter((p) => facultyByEmp.has(p.employee_number));

  // ---------- المرحلة 4: المقررات — تحميل الموجود، إنشاء الناقص دفعة واحدة ----------
  const existingCourses = await sql`select id, code, name, department_id from courses`;
  type CourseRow = { id: number; code: string | null; name: string; department_id: number | null };
  const courseKey = (name: string, deptId: number | null) => `${name}::${deptId ?? "null"}`;
  const courseByKey = new Map<string, CourseRow>(
    (existingCourses as unknown as CourseRow[]).map((cRow) => [courseKey(cRow.name, cRow.department_id), cRow]),
  );

  const newCourses = new Map<string, { code: string | null; name: string; department_id: number | null }>();
  for (const p of rowsWithFaculty) {
    const faculty = facultyByEmp.get(p.employee_number)!;
    const key = courseKey(p.course_name, faculty.department_id);
    if (courseByKey.has(key) || newCourses.has(key)) continue;
    newCourses.set(key, { code: p.course_code || null, name: p.course_name, department_id: faculty.department_id });
  }
  if (newCourses.size) {
    const insertedCourses = await sql`
      insert into courses ${sql([...newCourses.values()], "code", "name", "department_id")}
      on conflict (name, department_id) do update set name = excluded.name
      returning *
    `;
    for (const cRow of insertedCourses as unknown as CourseRow[]) {
      courseByKey.set(courseKey(cRow.name, cRow.department_id), cRow);
    }
  }

  // ---------- المرحلة 5: المحاضرات — استبعاد المكرر، إدراج الباقي دفعة واحدة ----------
  const existingSchedules = await sql`
    select faculty_id, course_id, day_of_week, start_time, end_time, section
      from schedules where semester_id = ${activeSemester.id}
  `;
  type ExistingSchedule = {
    faculty_id: string; course_id: number; day_of_week: number;
    start_time: string; end_time: string; section: string | null;
  };
  const scheduleKey = (
    facultyId: string, courseId: number, day: number, start: string, end: string, section: string | null,
  ) => `${facultyId}|${courseId}|${day}|${start}|${end}|${section ?? ""}`;
  const existingScheduleKeys = new Set(
    (existingSchedules as unknown as ExistingSchedule[]).map((s) =>
      scheduleKey(s.faculty_id, s.course_id, s.day_of_week, s.start_time, s.end_time, s.section)
    ),
  );

  const toInsertSchedules: {
    faculty_id: string; course_id: number; semester_id: number; day_of_week: number;
    start_time: string; end_time: string; section: string | null; department_id: number | null;
  }[] = [];
  let skippedDuplicate = 0;
  const seenInFile = new Set<string>();
  for (const p of rowsWithFaculty) {
    const faculty = facultyByEmp.get(p.employee_number)!;
    const course = courseByKey.get(courseKey(p.course_name, faculty.department_id))!;
    const section = p.section || null;
    const key = scheduleKey(faculty.id, course.id, p.day_of_week, p.start_time, p.end_time, section);
    if (existingScheduleKeys.has(key) || seenInFile.has(key)) {
      skippedDuplicate++;
      continue;
    }
    seenInFile.add(key);
    toInsertSchedules.push({
      faculty_id: faculty.id, course_id: course.id, semester_id: activeSemester.id,
      day_of_week: p.day_of_week, start_time: p.start_time, end_time: p.end_time,
      section, department_id: faculty.department_id,
    });
  }

  let imported = 0;
  if (toInsertSchedules.length) {
    const insertedSchedules = await sql`
      insert into schedules ${
        sql(
          toInsertSchedules,
          "faculty_id", "course_id", "semester_id", "day_of_week",
          "start_time", "end_time", "section", "department_id",
        )
      }
      returning id
    `;
    imported = insertedSchedules.length;
  }

  return json({
    message: `تم استيراد ${imported} محاضرة` +
      (createdMembers ? ` + إنشاء ${createdMembers} عضو جديد` : "") +
      (skippedDuplicate ? ` (تم تجاهل ${skippedDuplicate} محاضرة مكررة)` : ""),
    imported,
    created_members: createdMembers,
    skipped_duplicate: skippedDuplicate,
    errors,
  });
});

/** الإحصائيات العامة */
route("GET", "/admin/stats/overview", async () => {
  const t = await nowInfo();
  const [counters] = await sql`
    select
      (select count(*)::int from profiles where role = 'faculty') as total_faculty,
      (select count(*)::int from schedules) as total_lectures,
      (select count(*)::int from attendance where date = ${t.today} and status = 'present') as present_today,
      (select count(*)::int from attendance where status = 'excused') as excused_total,
      (select count(*)::int from attendance where status = 'absent') as absent_total,
      (select count(*)::int from attendance) as total_rows,
      (select count(*)::int from attendance where status = 'present') as present_total
  `;
  const depts = await sql`
    select d.id, d.name,
           (select count(*)::int from profiles p
             where p.department_id = d.id and p.role = 'faculty') as member_count,
           (select count(*)::int from attendance a
             join schedules s on s.id = a.schedule_id
            where s.department_id = d.id) as dept_total,
           (select count(*)::int from attendance a
             join schedules s on s.id = a.schedule_id
            where s.department_id = d.id and a.status = 'present') as dept_present
      from departments d
     order by d.name
  `;
  return json({
    total_faculty: counters.total_faculty,
    total_lectures: counters.total_lectures,
    present_today: counters.present_today,
    excused_total: counters.excused_total,
    absent_total: counters.absent_total,
    attendance_rate: counters.total_rows > 0
      ? Math.round((counters.present_total / counters.total_rows) * 100)
      : 0,
    departments: depts.map((d) => ({
      id: Number(d.id),
      name: d.name,
      member_count: Number(d.member_count),
      attendance_rate: Number(d.dept_total) > 0
        ? Math.round((Number(d.dept_present) / Number(d.dept_total)) * 100)
        : 0,
    })),
  });
});

route("GET", "/admin/stats/departments/:id/members", async (c) => {
  const members = await memberStats(Number(c.params.id));
  return json({ members });
});

route("GET", "/admin/stats/members/:id/history", async (c) => {
  const history = await sql`
    select a.date::text as date, a.status, a.check_in_time, c.name as course_name,
           s.start_time, s.end_time
      from attendance a
      join schedules s on s.id = a.schedule_id
      join courses c on c.id = s.course_id
     where a.faculty_id = ${c.params.id}
     order by a.date desc
  `;
  return json({ history });
});

/** تقارير المدير (JSON أو CSV) */
route("GET", "/admin/reports", async (c) => {
  const q = c.url.searchParams;
  const from = q.get("from"), to = q.get("to"), status = q.get("status");
  const department_id = q.get("department_id");
  const faculty_id = q.get("faculty_id");
  const format = q.get("format");

  const rows = await sql`
    select u.full_name, u.employee_number, d.name as department_name,
           c.name as course_name, a.date::text as date, s.start_time, s.end_time,
           a.check_in_time, a.status,
           (select type from excuses
             where attendance_id = a.id order by id desc limit 1) as excuse_type
      from attendance a
      join schedules s on s.id = a.schedule_id
      join profiles u on u.id = a.faculty_id
      join courses c on c.id = s.course_id
      left join departments d on d.id = s.department_id
     where (${from}::date is null or a.date >= ${from}::date)
       and (${to}::date is null or a.date <= ${to}::date)
       and (${department_id}::bigint is null or s.department_id = ${department_id}::bigint)
       and (${faculty_id}::uuid is null or a.faculty_id = ${faculty_id}::uuid)
       and (${status}::text is null or a.status = ${status}::text)
     order by a.date desc, s.start_time
  `;

  if (format === "csv") {
    const csv = toCsv(
      [
        { label: "الاسم", value: "full_name" },
        { label: "الرقم الوظيفي", value: "employee_number" },
        { label: "القسم", value: "department_name" },
        { label: "المقرر", value: "course_name" },
        { label: "التاريخ", value: "date" },
        { label: "وقت المحاضرة", value: (r) => `${r.start_time} - ${r.end_time}` },
        { label: "وقت التحضير", value: "check_in_time" },
        { label: "الحالة", value: "status" },
        { label: "نوع العذر", value: "excuse_type" },
      ],
      rows as unknown as Record<string, unknown>[],
    );
    return new Response(csv, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="attendance_report.csv"',
      },
    });
  }
  return json({ rows });
});

// ---------------- مراقب القسم (monitor) ----------------

route("GET", "/monitor/dashboard", async (c) => {
  const deptId = c.profile!.department_id;
  if (!deptId) return fail("لا يوجد قسم مرتبط بهذا الحساب");
  const t = await nowInfo();
  const [row] = await sql`
    select
      (select count(*)::int from profiles
        where department_id = ${deptId} and role = 'faculty') as member_count,
      (select count(*)::int from schedules
        where department_id = ${deptId} and day_of_week = ${t.dow}) as today_lectures,
      (select count(*)::int from attendance a
        join schedules s on s.id = a.schedule_id
       where s.department_id = ${deptId} and a.date = ${t.today}
         and a.status = 'present') as present_today,
      (select count(*)::int from attendance a
        join schedules s on s.id = a.schedule_id
       where s.department_id = ${deptId} and a.date = ${t.today}
         and a.status = 'absent') as absent_today,
      (select count(*)::int from attendance a
        join schedules s on s.id = a.schedule_id
       where s.department_id = ${deptId}) as total_att,
      (select count(*)::int from attendance a
        join schedules s on s.id = a.schedule_id
       where s.department_id = ${deptId} and a.status = 'present') as present_att
  `;
  return json({
    member_count: Number(row.member_count),
    today_lecture_count: Number(row.today_lectures),
    present_today: Number(row.present_today),
    absent_today: Number(row.absent_today),
    attendance_rate: Number(row.total_att) > 0
      ? Math.round((Number(row.present_att) / Number(row.total_att)) * 100)
      : 0,
  });
});

route("GET", "/monitor/members", async (c) => {
  const deptId = c.profile!.department_id;
  const search = (c.url.searchParams.get("search") ?? "").toLowerCase();
  const members = await sql`
    select id, full_name, employee_number
      from profiles
     where department_id = ${deptId} and role = 'faculty'
     order by full_name
  `;
  const filtered = search
    ? members.filter((m) =>
        String(m.full_name).toLowerCase().includes(search) ||
        String(m.employee_number).includes(search)
      )
    : members;

  const ids = filtered.map((m) => m.id as string);
  const stats = ids.length
    ? await sql`
        select faculty_id,
               count(*)::int as total,
               (count(*) filter (where status = 'present'))::int as present,
               (count(*) filter (where status = 'excused'))::int as excused,
               (count(*) filter (where status = 'absent'))::int as absent
          from attendance
         where faculty_id = any(${ids}::uuid[])
         group by faculty_id
      `
    : [];
  type StatRow = { faculty_id: string; total: number; present: number; excused: number; absent: number };
  const statsBy = new Map<string, StatRow>(
    (stats as unknown as StatRow[]).map((s) => [s.faculty_id as string, s]),
  );

  return json({
    members: filtered.map((m) => {
      const s = statsBy.get(m.id as string) ?? { total: 0, present: 0, excused: 0, absent: 0 };
      const total = Number(s.total);
      return {
        id: m.id,
        full_name: m.full_name,
        employee_number: m.employee_number,
        total_lectures: total,
        present: Number(s.present),
        excused: Number(s.excused),
        absent: Number(s.absent),
        attendance_rate: total > 0
          ? Math.round((Number(s.present) / total) * 100)
          : 0,
      };
    }),
  });
});

route("GET", "/monitor/members/:id/history", async (c) => {
  const deptId = c.profile!.department_id;
  const [member] = await sql`
    select * from profiles
     where id = ${c.params.id} and department_id = ${deptId}
  `;
  if (!member) return fail("العضو غير موجود ضمن قسمك", 404);

  const q = c.url.searchParams;
  const from = q.get("from"), to = q.get("to"), status = q.get("status");
  const history = await sql`
    select a.id, a.date::text as date, a.status, a.check_in_time, c.name as course_name,
           s.start_time, s.end_time
      from attendance a
      join schedules s on s.id = a.schedule_id
      join courses c on c.id = s.course_id
     where a.faculty_id = ${c.params.id}
       and (${from}::date is null or a.date >= ${from}::date)
       and (${to}::date is null or a.date <= ${to}::date)
       and (${status}::text is null or a.status = ${status}::text)
     order by a.date desc
  `;
  return json({
    member: { full_name: member.full_name, employee_number: member.employee_number },
    history,
  });
});

/** تعديل حالة عضو (override) — مقيّد بقسم المراقب */
route("POST", "/monitor/attendance/:attendance_id/override", async (c) => {
  const deptId = c.profile!.department_id;
  const { status } = c.body as Record<string, string>;
  if (!["present", "excused", "absent"].includes(status)) {
    return fail("حالة غير صحيحة");
  }
  const [attendance] = await sql`
    select a.* from attendance a
      join schedules s on s.id = a.schedule_id
     where a.id = ${Number(c.params.attendance_id)}
       and s.department_id = ${deptId}
  `;
  if (!attendance) return fail("السجل غير موجود ضمن قسمك", 404);
  await sql`
    update attendance
       set status = ${status}, marked_by = ${"monitor:" + c.profile!.id}
     where id = ${attendance.id}
  `;
  return json({ message: "تم تحديث حالة الحضور" });
});

/** إنشاء/تحديث سجل حضور يدوي لمحاضرة وتاريخ معيّن */
route("POST", "/monitor/attendance/manual", async (c) => {
  const deptId = c.profile!.department_id;
  const { schedule_id, date, status } = c.body as Record<string, string>;
  if (!schedule_id || !date || !status) return fail("بيانات ناقصة");
  if (!["present", "excused", "absent"].includes(status)) {
    return fail("حالة غير صحيحة");
  }
  const [schedule] = await sql`
    select * from schedules
     where id = ${Number(schedule_id)} and department_id = ${deptId}
  `;
  if (!schedule) return fail("المحاضرة غير موجودة ضمن قسمك", 404);

  const markedBy = "monitor:" + c.profile!.id;
  const [existing] = await sql`
    select * from attendance
     where schedule_id = ${Number(schedule_id)} and date = ${date}
  `;
  if (existing) {
    await sql`
      update attendance set status = ${status}, marked_by = ${markedBy}
       where id = ${existing.id}
    `;
  } else {
    await sql`
      insert into attendance (schedule_id, faculty_id, date, status, marked_by)
      values (${Number(schedule_id)}, ${schedule.faculty_id}, ${date}, ${status}, ${markedBy})
    `;
  }
  return json({ message: "تم تحديث السجل" });
});

/** تقارير المراقب (JSON أو CSV) — مقيّدة بقسمه */
route("GET", "/monitor/reports", async (c) => {
  const deptId = c.profile!.department_id;
  const q = c.url.searchParams;
  const from = q.get("from"), to = q.get("to"), status = q.get("status");
  const format = q.get("format");

  const rows = await sql`
    select u.full_name, u.employee_number, c.name as course_name, a.date::text as date,
           s.start_time, s.end_time, a.check_in_time, a.status
      from attendance a
      join schedules s on s.id = a.schedule_id
      join profiles u on u.id = a.faculty_id
      join courses c on c.id = s.course_id
     where s.department_id = ${deptId}
       and (${from}::date is null or a.date >= ${from}::date)
       and (${to}::date is null or a.date <= ${to}::date)
       and (${status}::text is null or a.status = ${status}::text)
     order by a.date desc
  `;

  if (format === "csv") {
    const csv = toCsv(
      [
        { label: "الاسم", value: "full_name" },
        { label: "الرقم الوظيفي", value: "employee_number" },
        { label: "المقرر", value: "course_name" },
        { label: "التاريخ", value: "date" },
        { label: "وقت المحاضرة", value: (r) => `${r.start_time} - ${r.end_time}` },
        { label: "وقت التحضير", value: "check_in_time" },
        { label: "الحالة", value: "status" },
      ],
      rows as unknown as Record<string, unknown>[],
    );
    return new Response(csv, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="department_report.csv"',
      },
    });
  }
  return json({ rows });
});

// ---------- أدوات مشتركة ----------

function tempPassword() {
  return `${crypto.randomUUID()}Aa1!`;
}

/** قراءة ملف مرفوع (JSON فيه filename + content_b64) وفك ترميزه وتحويله لسجلات CSV */
async function readImportPayload(
  c: Ctx,
): Promise<
  { records: Record<string, string>[] } | { error: Response }
> {
  const { filename, content_b64 } = c.body as Record<string, string>;
  if (!content_b64) {
    return { error: fail("الرجاء إرفاق ملف CSV") };
  }
  const name = String(filename ?? "").toLowerCase();
  if (name.endsWith(".pdf")) {
    return {
      error: fail(
        'في نسخة Supabase يُدعم استيراد CSV فقط (وهو الطريقة الموصى بها والمضمونة). ' +
          'احفظ الجدول كملف CSV ثم ارفعه.',
      ),
    };
  }
  let bytes: Uint8Array;
  try {
    const bin = atob(content_b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return { error: fail("تعذر قراءة محتوى الملف") };
  }
  let records: Record<string, string>[];
  try {
    const text = decodeCsvBuffer(bytes);
    const delimiter = detectDelimiter(text);
    records = parseCsv(text.replace(/^\ufeff/, ""), delimiter);
  } catch {
    return { error: fail("تعذر قراءة الملف، تأكد من صيغة CSV") };
  }
  if (!records.length) {
    return { error: fail("الملف فارغ أو لا يحتوي صفوف بيانات صالحة") };
  }
  return { records };
}

async function memberStats(deptId: number) {
  const members = await sql`
    select id, full_name, employee_number from profiles
     where department_id = ${deptId} and role = 'faculty'
  `;
  const ids = members.map((m) => m.id as string);
  const stats = ids.length
    ? await sql`
        select faculty_id,
               count(*)::int as total,
               (count(*) filter (where status = 'present'))::int as present,
               (count(*) filter (where status = 'excused'))::int as excused,
               (count(*) filter (where status = 'absent'))::int as absent
          from attendance
         where faculty_id = any(${ids}::uuid[])
         group by faculty_id
      `
    : [];
  type StatRow = { faculty_id: string; total: number; present: number; excused: number; absent: number };
  const statsBy = new Map<string, StatRow>(
    (stats as unknown as StatRow[]).map((s) => [s.faculty_id as string, s]),
  );
  return members.map((m) => {
    const s = statsBy.get(m.id as string) ?? { total: 0, present: 0, excused: 0, absent: 0 };
    const total = Number(s.total);
    return {
      id: m.id,
      full_name: m.full_name,
      employee_number: m.employee_number,
      total_lectures: total,
      present: Number(s.present),
      excused: Number(s.excused),
      absent: Number(s.absent),
      attendance_rate: total > 0
        ? Math.round((Number(s.present) / total) * 100)
        : 0,
    };
  });
}

// ============================================================
// الطلب الرئيسي
// ============================================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  let pathname = url.pathname.replace(/\/+$/, "");
  // استخراج المسار بعد بادئة الدالة (يدعم /functions/v1/api/... محليًا وسحابيًا)
  const marker = "/api";
  const idx = pathname.indexOf(marker);
  if (idx !== -1) pathname = pathname.slice(idx + marker.length) || "/";

  let body: Record<string, unknown> = {};
  if (req.method === "POST" || req.method === "PUT") {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const match = r.pattern.exec(pathname);
    if (!match) continue;

    const publicRoute =
      pathname === "/health" ||
      pathname === "/auth/bootstrap-admin" ||
      pathname === "/auth/first-login-setup";

    let profile: Profile | null = null;
    if (!publicRoute) {
      const auth = await requireProfile(req, allowedRolesFor(pathname));
      if ("error" in auth) return auth.error;
      profile = auth.profile;
    }

    try {
      return await r.handler({
        req,
        url,
        body,
        params: (match.groups ?? {}) as Record<string, string>,
        profile,
      });
    } catch (e) {
      console.error("handler error:", e);
      return fail("DEBUG: " + (e?.message ?? String(e)), 500);
    }
  }

  return fail("المسار غير موجود", 404);
});

/** الأدوار المسموح بها لكل مجموعة مسارات */
function allowedRolesFor(pathname: string): string[] {
  if (pathname.startsWith("/faculty/")) return ["faculty"];
  if (pathname.startsWith("/admin/")) return ["admin"];
  if (pathname.startsWith("/monitor/")) return ["monitor"];
  return ["admin", "faculty", "monitor"];
}