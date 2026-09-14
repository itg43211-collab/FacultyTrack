const express = require("express");
const { db } = require("../db");
const { authRequired, requireRole } = require("../middleware/auth");
const { distanceMeters } = require("../utils/geo");
const { windowStatus, currentDayOfWeek, todayDateStr } = require("../utils/time");

const router = express.Router();
router.use(authRequired, requireRole("faculty"));

function getActiveSemester() {
  return db.prepare("SELECT * FROM semesters WHERE is_active = 1").get();
}

function getUniversityLocation() {
  return db.prepare("SELECT * FROM university_location ORDER BY id LIMIT 1").get();
}

/** بناء حالة الزر لكل محاضرة اليوم */
function buildTodayLectures(facultyId) {
  const semester = getActiveSemester();
  const today = todayDateStr();
  const dow = currentDayOfWeek();

  if (!semester) return { semester: null, lectures: [] };

  const rows = db
    .prepare(
      `SELECT s.id as schedule_id, s.start_time, s.end_time, s.section,
              c.name as course_name, c.code as course_code
       FROM schedules s
       JOIN courses c ON c.id = s.course_id
       WHERE s.faculty_id = ? AND s.semester_id = ? AND s.day_of_week = ?
       ORDER BY s.start_time`
    )
    .all(facultyId, semester.id, dow);

  const lectures = rows.map((r) => {
    const att = db
      .prepare("SELECT * FROM attendance WHERE schedule_id = ? AND date = ?")
      .get(r.schedule_id, today);

    const wStatus = windowStatus(r.start_time, r.end_time); // not_started | open | ended

    let buttonState = "not_started";
    if (att && att.status === "present") buttonState = "done";
    else if (att && att.status === "excused") buttonState = "excused";
    else if (wStatus === "open") buttonState = "available";
    else if (wStatus === "ended") buttonState = "closed"; // انتهى الوقت (غياب إن لم يُسجَّل)
    else buttonState = "not_started";

    return {
      schedule_id: r.schedule_id,
      course_name: r.course_name,
      course_code: r.course_code,
      section: r.section,
      start_time: r.start_time,
      end_time: r.end_time,
      status: att ? att.status : (wStatus === "ended" ? "absent" : "pending"),
      button_state: buttonState,
      check_in_time: att ? att.check_in_time : null,
    };
  });

  return { semester, lectures };
}

router.get("/dashboard", (req, res) => {
  const facultyId = req.user.id;
  const { semester, lectures } = buildTodayLectures(facultyId);

  const doneCount = lectures.filter((l) => l.status === "present").length;
  const absentCount = lectures.filter((l) => l.status === "absent").length;

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(facultyId);
  const dept = user.department_id
    ? db.prepare("SELECT name FROM departments WHERE id = ?").get(user.department_id)
    : null;

  res.json({
    full_name: user.full_name,
    employee_number: user.employee_number,
    department: dept ? dept.name : null,
    semester: semester ? semester.name : null,
    today_lecture_count: lectures.length,
    done_count: doneCount,
    absent_count: absentCount,
    lectures,
  });
});

/**
 * تسجيل الحضور عبر GPS
 * body: { schedule_id, lat, lng }
 */
router.post("/attendance/check-in", (req, res) => {
  const facultyId = req.user.id;
  const { schedule_id, lat, lng } = req.body;

  if (schedule_id === undefined || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: "بيانات ناقصة: يلزم رقم المحاضرة والموقع الجغرافي" });
  }
  if (typeof lat !== "number" || typeof lng !== "number") {
    return res.status(400).json({ error: "إحداثيات الموقع غير صحيحة" });
  }

  const semester = getActiveSemester();
  if (!semester) {
    return res.status(400).json({ error: "لا يوجد فصل دراسي فعّال حاليًا" });
  }

  // 1) التأكد أن المحاضرة فعلاً ضمن جدول هذا العضو
  const schedule = db
    .prepare(
      `SELECT s.*, c.name as course_name FROM schedules s
       JOIN courses c ON c.id = s.course_id
       WHERE s.id = ? AND s.faculty_id = ? AND s.semester_id = ?`
    )
    .get(schedule_id, facultyId, semester.id);

  if (!schedule) {
    return res.status(404).json({ error: "هذه المحاضرة غير موجودة ضمن جدولك" });
  }

  // 2) التأكد أن اليوم مطابق (لا يمكن تحضير محاضرة يوم آخر)
  const dow = currentDayOfWeek();
  if (schedule.day_of_week !== dow) {
    return res.status(400).json({ error: "هذه المحاضرة ليست مجدولة لهذا اليوم" });
  }

  // 3) التحقق من النافذة الزمنية (يُحسب في السيرفر فقط)
  const wStatus = windowStatus(schedule.start_time, schedule.end_time);
  if (wStatus === "not_started") {
    return res.status(400).json({ error: "لم يبدأ وقت التحضير لهذه المحاضرة بعد" });
  }
  if (wStatus === "ended") {
    return res.status(400).json({ error: "انتهى وقت التحضير المسموح لهذه المحاضرة" });
  }

  const today = todayDateStr();

  // 4) منع التحضير أكثر من مرة لنفس المحاضرة/اليوم
  const existing = db
    .prepare("SELECT * FROM attendance WHERE schedule_id = ? AND date = ?")
    .get(schedule_id, today);
  if (existing && existing.status === "present") {
    return res.status(400).json({ error: "تم تسجيل حضورك مسبقًا لهذه المحاضرة" });
  }

  // 5) التحقق الجغرافي (Haversine) من موقع الجامعة المخزّن في السيرفر فقط
  const loc = getUniversityLocation();
  if (!loc) {
    return res.status(500).json({ error: "لم يتم إعداد موقع الجامعة بعد، راجع إدارة النظام" });
  }
  const distance = distanceMeters(lat, lng, loc.lat, loc.lng);
  const radiusMeters = loc.radius_km * 1000;

  if (distance > radiusMeters) {
    // نسجل محاولة مرفوضة (اختياري) لكن لا نُغيّر الحالة إلى حاضر
    return res.status(403).json({
      error: "لا يمكن تسجيل الحضور لأنك خارج نطاق الجامعة.",
      distance_meters: Math.round(distance),
      allowed_radius_meters: radiusMeters,
    });
  }

  const now = new Date();
  const checkInTime = now.toTimeString().slice(0, 8);

  if (existing) {
    db.prepare(
      `UPDATE attendance SET status='present', check_in_time=?, lat=?, lng=?, distance_meters=?, verified=1, marked_by='self'
       WHERE id = ?`
    ).run(checkInTime, lat, lng, distance, existing.id);
  } else {
    db.prepare(
      `INSERT INTO attendance (schedule_id, faculty_id, date, status, check_in_time, lat, lng, distance_meters, verified, marked_by)
       VALUES (?, ?, ?, 'present', ?, ?, ?, ?, 1, 'self')`
    ).run(schedule_id, facultyId, today, checkInTime, lat, lng, distance);
  }

  return res.json({
    message: "تم تسجيل حضورك بنجاح.",
    course_name: schedule.course_name,
    check_in_time: checkInTime,
    distance_meters: Math.round(distance),
  });
});

/** تسجيل عذر عن محاضرة معينة (تاريخ محدد) */
router.post("/excuses", (req, res) => {
  const facultyId = req.user.id;
  const { schedule_id, date, type, notes } = req.body;

  if (!schedule_id || !date || !type) {
    return res.status(400).json({ error: "بيانات ناقصة لتسجيل العذر" });
  }
  if (!["health", "family", "other"].includes(type)) {
    return res.status(400).json({ error: "نوع عذر غير صحيح" });
  }

  const schedule = db
    .prepare("SELECT * FROM schedules WHERE id = ? AND faculty_id = ?")
    .get(schedule_id, facultyId);
  if (!schedule) return res.status(404).json({ error: "المحاضرة غير موجودة ضمن جدولك" });

  let attendance = db
    .prepare("SELECT * FROM attendance WHERE schedule_id = ? AND date = ?")
    .get(schedule_id, date);

  if (!attendance) {
    const info = db
      .prepare(
        `INSERT INTO attendance (schedule_id, faculty_id, date, status, marked_by) VALUES (?, ?, ?, 'excused', 'self')`
      )
      .run(schedule_id, facultyId, date);
    attendance = db.prepare("SELECT * FROM attendance WHERE id = ?").get(info.lastInsertRowid);
  } else {
    db.prepare("UPDATE attendance SET status = 'excused' WHERE id = ?").run(attendance.id);
  }

  db.prepare(
    `INSERT INTO excuses (attendance_id, type, notes, excuse_date, status) VALUES (?, ?, ?, ?, 'pending')`
  ).run(attendance.id, type, notes || null, date);

  res.json({ message: "تم تسجيل العذر بنجاح، بانتظار المراجعة" });
});

/** سجل الحضور الكامل للعضو */
router.get("/history", (req, res) => {
  const facultyId = req.user.id;
  const rows = db
    .prepare(
      `SELECT a.date, a.status, a.check_in_time, c.name as course_name, s.start_time, s.end_time
       FROM attendance a
       JOIN schedules s ON s.id = a.schedule_id
       JOIN courses c ON c.id = s.course_id
       WHERE a.faculty_id = ?
       ORDER BY a.date DESC`
    )
    .all(facultyId);
  res.json({ history: rows });
});

module.exports = router;
