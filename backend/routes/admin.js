const express = require("express");
const multer = require("multer");
const { parse } = require("csv-parse/sync");
const pdfParse = require("pdf-parse");
const { Parser: CsvParser } = require("json2csv");
const { db } = require("../db");
const { authRequired, requireRole } = require("../middleware/auth");
const { todayDateStr } = require("../utils/time");
const { parsePdfScheduleText } = require("../utils/pdfSchedule");
const { decodeCsvBuffer, detectDelimiter } = require("../utils/csvDecode");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(authRequired, requireRole("admin"));

/* ---------------- الأقسام ---------------- */
router.get("/departments", (req, res) => {
  res.json({ departments: db.prepare("SELECT * FROM departments ORDER BY name").all() });
});

router.post("/departments", (req, res) => {
  const { name, name_en } = req.body;
  if (!name) return res.status(400).json({ error: "اسم القسم مطلوب" });
  try {
    const info = db.prepare("INSERT INTO departments (name, name_en) VALUES (?, ?)").run(name, name_en || null);
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: "القسم موجود مسبقًا" });
  }
});

/* ---------------- الفصول الدراسية ---------------- */
router.get("/semesters", (req, res) => {
  res.json({ semesters: db.prepare("SELECT * FROM semesters ORDER BY start_date DESC").all() });
});

router.post("/semesters", (req, res) => {
  const { name, start_date, end_date } = req.body;
  if (!name || !start_date || !end_date) {
    return res.status(400).json({ error: "جميع الحقول مطلوبة" });
  }
  const info = db
    .prepare("INSERT INTO semesters (name, start_date, end_date, is_active) VALUES (?, ?, ?, 0)")
    .run(name, start_date, end_date);
  res.json({ id: info.lastInsertRowid });
});

router.post("/semesters/:id/activate", (req, res) => {
  db.prepare("UPDATE semesters SET is_active = 0").run();
  db.prepare("UPDATE semesters SET is_active = 1 WHERE id = ?").run(req.params.id);
  res.json({ message: "تم تفعيل الفصل الدراسي" });
});

router.post("/semesters/:id/deactivate", (req, res) => {
  db.prepare("UPDATE semesters SET is_active = 0 WHERE id = ?").run(req.params.id);
  res.json({ message: "تم إيقاف الفصل الدراسي" });
});

/* ---------------- موقع الجامعة ---------------- */
router.get("/location", (req, res) => {
  res.json({ location: db.prepare("SELECT * FROM university_location ORDER BY id LIMIT 1").get() });
});

router.put("/location", (req, res) => {
  const { lat, lng, radius_km, name } = req.body;
  const existing = db.prepare("SELECT * FROM university_location ORDER BY id LIMIT 1").get();
  if (existing) {
    db.prepare("UPDATE university_location SET lat=?, lng=?, radius_km=?, name=? WHERE id=?").run(
      lat, lng, radius_km, name || existing.name, existing.id
    );
  } else {
    db.prepare("INSERT INTO university_location (name, lat, lng, radius_km) VALUES (?, ?, ?, ?)").run(
      name || "الموقع الرئيسي", lat, lng, radius_km
    );
  }
  res.json({ message: "تم تحديث موقع الجامعة" });
});

/* ---------------- إدارة المستخدمين / رفع بيانات الأعضاء ---------------- */
router.get("/users", (req, res) => {
  const users = db
    .prepare(
      `SELECT u.id, u.employee_number, u.full_name, u.role, u.status, u.email, u.must_set_password,
              d.name as department_name
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       ORDER BY u.role, u.full_name`
    )
    .all();
  res.json({ users });
});

router.post("/users", (req, res) => {
  const { employee_number, full_name, role, department_id, email } = req.body;
  if (!employee_number || !full_name || !role) {
    return res.status(400).json({ error: "بيانات ناقصة" });
  }
  if (!["admin", "faculty", "monitor"].includes(role)) {
    return res.status(400).json({ error: "دور غير صحيح" });
  }
  try {
    const info = db
      .prepare(
        `INSERT INTO users (employee_number, full_name, role, department_id, email, must_set_password, status)
         VALUES (?, ?, ?, ?, ?, 1, 'active')`
      )
      .run(employee_number, full_name, role, department_id || null, email || null);
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: "الرقم الوظيفي مستخدم مسبقًا" });
  }
});

router.put("/users/:id/status", (req, res) => {
  const { status } = req.body;
  if (!["active", "disabled"].includes(status)) {
    return res.status(400).json({ error: "حالة غير صحيحة" });
  }
  db.prepare("UPDATE users SET status = ? WHERE id = ?").run(status, req.params.id);
  res.json({ message: "تم تحديث حالة الحساب" });
});

router.post("/users/:id/reset-password", (req, res) => {
  db.prepare("UPDATE users SET password_hash = NULL, must_set_password = 1 WHERE id = ?").run(req.params.id);
  res.json({ message: "تمت إعادة تعيين الحساب، سيُطلب من العضو إعداد كلمة مرور جديدة عند الدخول القادم" });
});

/** رفع ملف CSV لأعضاء هيئة التدريس: full_name, employee_number, department_name */
router.post("/faculty/import", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "الرجاء إرفاق ملف CSV" });

  let records;
  try {
    const text = decodeCsvBuffer(req.file.buffer);
    const delimiter = detectDelimiter(text);
    records = parse(text, { columns: true, skip_empty_lines: true, trim: true, bom: true, delimiter });
    // نُطبّع مفاتيح كل صف (نُزيل أي مسافات زائدة حول اسم العمود، شائعة في ملفات Excel العربية)
    records = records.map((r) => {
      const clean = {};
      for (const [k, v] of Object.entries(r)) clean[k.trim()] = v;
      return clean;
    });
  } catch (e) {
    return res.status(400).json({ error: "تعذر قراءة الملف، تأكد من صيغة CSV" });
  }

  const errors = [];
  const toInsert = [];
  const seenNumbers = new Set();

  records.forEach((r, idx) => {
    const rowNum = idx + 2; // +1 للعناوين +1 للفهرسة من 1
    const employee_number = (r.employee_number || r["الرقم الوظيفي"] || "").toString().trim();
    const full_name = (r.full_name || r["الاسم"] || "").toString().trim();
    const department_name = (r.department_name || r["القسم"] || r["التخصص"] || "").toString().trim();

    if (!employee_number || !full_name) {
      errors.push(`السطر ${rowNum}: بيانات ناقصة (الاسم أو الرقم الوظيفي)`);
      return;
    }
    if (seenNumbers.has(employee_number)) {
      errors.push(`السطر ${rowNum}: الرقم الوظيفي ${employee_number} مكرر داخل الملف`);
      return;
    }
    const existing = db.prepare("SELECT id FROM users WHERE employee_number = ?").get(employee_number);
    if (existing) {
      errors.push(`السطر ${rowNum}: الرقم الوظيفي ${employee_number} موجود مسبقًا في النظام`);
      return;
    }
    seenNumbers.add(employee_number);

    let department_id = null;
    if (department_name) {
      const dept = db.prepare("SELECT id FROM departments WHERE name = ?").get(department_name);
      if (dept) department_id = dept.id;
      else errors.push(`السطر ${rowNum}: القسم "${department_name}" غير موجود (سيُضاف العضو بدون قسم)`);
    }

    toInsert.push({ employee_number, full_name, department_id });
  });

  if (errors.length > 0 && req.query.strict === "true") {
    return res.status(400).json({ error: "تم رصد أخطاء في الملف", errors });
  }

  const insertStmt = db.prepare(
    `INSERT INTO users (employee_number, full_name, role, department_id, must_set_password, status)
     VALUES (?, ?, 'faculty', ?, 1, 'active')`
  );
  db.exec("BEGIN");
  try {
    for (const row of toInsert) {
      insertStmt.run(row.employee_number, row.full_name, row.department_id);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  res.json({
    message: `تم استيراد ${toInsert.length} عضو بنجاح`,
    imported: toInsert.length,
    errors,
  });
});

/**
 * رفع جداول المحاضرات عبر CSV أو PDF.
 * صيغة PDF المطلوبة: كل محاضرة في سطر منفصل، والحقول مفصولة بـ "|":
 *   employee_number|course_name|course_code|day|start_time|end_time|section
 * مثال: 1001|قواعد البيانات|CS101|الأحد|08:00|09:00|1
 */
router.post("/schedules/import", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "الرجاء إرفاق ملف CSV أو PDF" });
  const activeSemester = db.prepare("SELECT * FROM semesters WHERE is_active = 1").get();
  if (!activeSemester) return res.status(400).json({ error: "لا يوجد فصل دراسي فعّال لربط الجدول به" });

  const filename = (req.file.originalname || "").toLowerCase();
  const isPdf = req.file.mimetype === "application/pdf" || filename.endsWith(".pdf");

  let records;
  try {
    if (isPdf) {
      const data = await pdfParse(req.file.buffer);
      records = parsePdfScheduleText(data.text);
      if (records.length === 0) {
        return res.status(400).json({
          error:
            "لم يتم العثور على أي سطر بيانات صالح داخل الملف. تأكد أن كل محاضرة في سطر مستقل، " +
            "والحقول مفصولة بـ \"|\" بهذا الترتيب: " +
            "الرقم الوظيفي|اسم المقرر|رمز المقرر|اليوم|وقت البداية|وقت النهاية|الشعبة",
        });
      }
    } else {
      const text = decodeCsvBuffer(req.file.buffer);
      const delimiter = detectDelimiter(text);
      records = parse(text, { columns: true, skip_empty_lines: true, trim: true, bom: true, delimiter });
      records = records.map((r) => {
        const clean = {};
        for (const [k, v] of Object.entries(r)) clean[k.trim()] = v;
        return clean;
      });
    }
  } catch (e) {
    return res.status(400).json({ error: isPdf ? "تعذر قراءة ملف PDF" : "تعذر قراءة الملف، تأكد من صيغة CSV" });
  }

  const DAY_MAP = { "الأحد": 0, "الاثنين": 1, "الثلاثاء": 2, "الأربعاء": 3, "الخميس": 4, "الجمعة": 5, "السبت": 6 };
  const errors = [];
  let importedCount = 0;

  records.forEach((r, idx) => {
    const rowNum = idx + (isPdf ? 1 : 2);
    const employee_number = (r.employee_number || r["الرقم الوظيفي"] || "").toString().trim();
    const course_name = (r.course_name || r["اسم المقرر"] || "").toString().trim();
    const course_code = (r.course_code || r["رمز المقرر"] || "").toString().trim();
    const dayRaw = (r.day || r["اليوم"] || "").toString().trim();
    const start_time = (r.start_time || r["وقت البداية"] || "").toString().trim();
    const end_time = (r.end_time || r["وقت النهاية"] || "").toString().trim();
    const section = (r.section || r["الشعبة"] || "").toString().trim();

    if (!employee_number || !course_name || !dayRaw || !start_time || !end_time) {
      errors.push(`السطر ${rowNum}: بيانات ناقصة`);
      return;
    }

    const faculty = db.prepare("SELECT * FROM users WHERE employee_number = ? AND role='faculty'").get(employee_number);
    if (!faculty) {
      errors.push(`السطر ${rowNum}: لا يوجد عضو هيئة تدريس بالرقم الوظيفي ${employee_number}`);
      return;
    }

    const day_of_week = DAY_MAP[dayRaw] !== undefined ? DAY_MAP[dayRaw] : (isNaN(Number(dayRaw)) ? null : Number(dayRaw));
    if (day_of_week === null) {
      errors.push(`السطر ${rowNum}: قيمة اليوم "${dayRaw}" غير صحيحة`);
      return;
    }

    let course = db.prepare("SELECT * FROM courses WHERE name = ? AND department_id IS ?").get(course_name, faculty.department_id);
    if (!course) {
      const info = db
        .prepare("INSERT INTO courses (code, name, department_id) VALUES (?, ?, ?)")
        .run(course_code || null, course_name, faculty.department_id);
      course = { id: info.lastInsertRowid };
    }

    db.prepare(
      `INSERT INTO schedules (faculty_id, course_id, semester_id, day_of_week, start_time, end_time, section, department_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(faculty.id, course.id, activeSemester.id, day_of_week, start_time, end_time, section || null, faculty.department_id);

    importedCount++;
  });

  res.json({ message: `تم استيراد ${importedCount} محاضرة`, imported: importedCount, errors });
});

/* ---------------- الإحصائيات العامة ---------------- */
router.get("/stats/overview", (req, res) => {
  const totalFaculty = db.prepare("SELECT COUNT(*) c FROM users WHERE role='faculty'").get().c;
  const totalLectures = db.prepare("SELECT COUNT(*) c FROM schedules").get().c;
  const today = todayDateStr();
  const presentToday = db.prepare("SELECT COUNT(*) c FROM attendance WHERE date=? AND status='present'").get(today).c;
  const excusedTotal = db.prepare("SELECT COUNT(*) c FROM attendance WHERE status='excused'").get().c;
  const absentTotal = db.prepare("SELECT COUNT(*) c FROM attendance WHERE status='absent'").get().c;
  const totalAttendanceRows = db.prepare("SELECT COUNT(*) c FROM attendance").get().c;
  const presentTotal = db.prepare("SELECT COUNT(*) c FROM attendance WHERE status='present'").get().c;
  const attendanceRate = totalAttendanceRows > 0 ? Math.round((presentTotal / totalAttendanceRows) * 100) : 0;

  const depts = db.prepare("SELECT * FROM departments ORDER BY name").all().map((d) => {
    const memberCount = db.prepare("SELECT COUNT(*) c FROM users WHERE department_id=? AND role='faculty'").get(d.id).c;
    const deptTotal = db
      .prepare(
        `SELECT COUNT(*) c FROM attendance a JOIN schedules s ON s.id=a.schedule_id WHERE s.department_id=?`
      )
      .get(d.id).c;
    const deptPresent = db
      .prepare(
        `SELECT COUNT(*) c FROM attendance a JOIN schedules s ON s.id=a.schedule_id WHERE s.department_id=? AND a.status='present'`
      )
      .get(d.id).c;
    return {
      id: d.id,
      name: d.name,
      member_count: memberCount,
      attendance_rate: deptTotal > 0 ? Math.round((deptPresent / deptTotal) * 100) : 0,
    };
  });

  res.json({
    total_faculty: totalFaculty,
    total_lectures: totalLectures,
    present_today: presentToday,
    excused_total: excusedTotal,
    absent_total: absentTotal,
    attendance_rate: attendanceRate,
    departments: depts,
  });
});

router.get("/stats/departments/:id/members", (req, res) => {
  const deptId = req.params.id;
  const members = db.prepare("SELECT * FROM users WHERE department_id=? AND role='faculty'").all(deptId);
  const result = members.map((m) => memberStats(m));
  res.json({ members: result });
});

function memberStats(m) {
  const total = db
    .prepare(`SELECT COUNT(*) c FROM attendance WHERE faculty_id=?`)
    .get(m.id).c;
  const present = db.prepare(`SELECT COUNT(*) c FROM attendance WHERE faculty_id=? AND status='present'`).get(m.id).c;
  const excused = db.prepare(`SELECT COUNT(*) c FROM attendance WHERE faculty_id=? AND status='excused'`).get(m.id).c;
  const absent = db.prepare(`SELECT COUNT(*) c FROM attendance WHERE faculty_id=? AND status='absent'`).get(m.id).c;
  return {
    id: m.id,
    full_name: m.full_name,
    employee_number: m.employee_number,
    total_lectures: total,
    present,
    excused,
    absent,
    attendance_rate: total > 0 ? Math.round((present / total) * 100) : 0,
  };
}

router.get("/stats/members/:id/history", (req, res) => {
  const rows = db
    .prepare(
      `SELECT a.date, a.status, a.check_in_time, c.name as course_name, s.start_time, s.end_time
       FROM attendance a JOIN schedules s ON s.id=a.schedule_id JOIN courses c ON c.id=s.course_id
       WHERE a.faculty_id=? ORDER BY a.date DESC`
    )
    .all(req.params.id);
  res.json({ history: rows });
});

/* ---------------- التقارير ---------------- */
router.get("/reports", (req, res) => {
  const { from, to, department_id, faculty_id, status, format } = req.query;

  let query = `
    SELECT u.full_name, u.employee_number, d.name as department_name, c.name as course_name,
           a.date, s.start_time, s.end_time, a.check_in_time, a.status,
           (SELECT type FROM excuses WHERE attendance_id = a.id ORDER BY id DESC LIMIT 1) as excuse_type
    FROM attendance a
    JOIN schedules s ON s.id = a.schedule_id
    JOIN users u ON u.id = a.faculty_id
    JOIN courses c ON c.id = s.course_id
    LEFT JOIN departments d ON d.id = s.department_id
    WHERE 1=1
  `;
  const params = [];
  if (from) { query += " AND a.date >= ?"; params.push(from); }
  if (to) { query += " AND a.date <= ?"; params.push(to); }
  if (department_id) { query += " AND s.department_id = ?"; params.push(department_id); }
  if (faculty_id) { query += " AND a.faculty_id = ?"; params.push(faculty_id); }
  if (status) { query += " AND a.status = ?"; params.push(status); }
  query += " ORDER BY a.date DESC, s.start_time";

  const rows = db.prepare(query).all(...params);

  if (format === "csv") {
    const fields = [
      { label: "الاسم", value: "full_name" },
      { label: "الرقم الوظيفي", value: "employee_number" },
      { label: "القسم", value: "department_name" },
      { label: "المقرر", value: "course_name" },
      { label: "التاريخ", value: "date" },
      { label: "وقت المحاضرة", value: (r) => `${r.start_time} - ${r.end_time}` },
      { label: "وقت التحضير", value: "check_in_time" },
      { label: "الحالة", value: "status" },
      { label: "نوع العذر", value: "excuse_type" },
    ];
    const parser = new CsvParser({ fields, withBOM: true });
    const csv = parser.parse(rows);
    res.header("Content-Type", "text/csv; charset=utf-8");
    res.attachment("attendance_report.csv");
    return res.send(csv);
  }

  res.json({ rows });
});

module.exports = router;
