const express = require("express");
const { Parser: CsvParser } = require("json2csv");
const { db } = require("../db");
const { authRequired, requireRole } = require("../middleware/auth");
const { todayDateStr } = require("../utils/time");

const router = express.Router();
router.use(authRequired, requireRole("monitor"));

// كل الاستعلامات هنا مقيّدة بـ department_id الخاص بالمراقب فقط (لا يرى أقسامًا أخرى)
router.get("/dashboard", (req, res) => {
  const deptId = req.user.department_id;
  if (!deptId) return res.status(400).json({ error: "لا يوجد قسم مرتبط بهذا الحساب" });

  const memberCount = db.prepare("SELECT COUNT(*) c FROM users WHERE department_id=? AND role='faculty'").get(deptId).c;
  const today = todayDateStr();
  const todayLectures = db
    .prepare(`SELECT COUNT(*) c FROM schedules WHERE department_id=? AND day_of_week=?`)
    .get(deptId, new Date().getDay()).c;
  const presentToday = db
    .prepare(
      `SELECT COUNT(*) c FROM attendance a JOIN schedules s ON s.id=a.schedule_id
       WHERE s.department_id=? AND a.date=? AND a.status='present'`
    )
    .get(deptId, today).c;
  const absentToday = db
    .prepare(
      `SELECT COUNT(*) c FROM attendance a JOIN schedules s ON s.id=a.schedule_id
       WHERE s.department_id=? AND a.date=? AND a.status='absent'`
    )
    .get(deptId, today).c;

  const totalAtt = db
    .prepare(`SELECT COUNT(*) c FROM attendance a JOIN schedules s ON s.id=a.schedule_id WHERE s.department_id=?`)
    .get(deptId).c;
  const presentAtt = db
    .prepare(
      `SELECT COUNT(*) c FROM attendance a JOIN schedules s ON s.id=a.schedule_id WHERE s.department_id=? AND a.status='present'`
    )
    .get(deptId).c;

  res.json({
    member_count: memberCount,
    today_lecture_count: todayLectures,
    present_today: presentToday,
    absent_today: absentToday,
    attendance_rate: totalAtt > 0 ? Math.round((presentAtt / totalAtt) * 100) : 0,
  });
});

router.get("/members", (req, res) => {
  const deptId = req.user.department_id;
  const { search } = req.query;
  let members = db.prepare("SELECT * FROM users WHERE department_id=? AND role='faculty'").all(deptId);
  if (search) {
    const q = search.toLowerCase();
    members = members.filter(
      (m) => m.full_name.toLowerCase().includes(q) || m.employee_number.includes(q)
    );
  }
  const result = members.map((m) => {
    const total = db.prepare(`SELECT COUNT(*) c FROM attendance WHERE faculty_id=?`).get(m.id).c;
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
  });
  res.json({ members: result });
});

router.get("/members/:id/history", (req, res) => {
  const deptId = req.user.department_id;
  const member = db.prepare("SELECT * FROM users WHERE id=? AND department_id=?").get(req.params.id, deptId);
  if (!member) return res.status(404).json({ error: "العضو غير موجود ضمن قسمك" });

  const { from, to, status } = req.query;
  let query = `
    SELECT a.id, a.date, a.status, a.check_in_time, c.name as course_name, s.start_time, s.end_time
    FROM attendance a JOIN schedules s ON s.id=a.schedule_id JOIN courses c ON c.id=s.course_id
    WHERE a.faculty_id=?`;
  const params = [member.id];
  if (from) { query += " AND a.date>=?"; params.push(from); }
  if (to) { query += " AND a.date<=?"; params.push(to); }
  if (status) { query += " AND a.status=?"; params.push(status); }
  query += " ORDER BY a.date DESC";

  const rows = db.prepare(query).all(...params);
  res.json({ member: { full_name: member.full_name, employee_number: member.employee_number }, history: rows });
});

/**
 * صلاحية مراقب القسم: تعديل حالة عضو غائب إلى حاضر في أي وقت
 * (يُستخدم عندما يتعذر على العضو تسجيل حضوره بنفسه)
 */
router.post("/attendance/:attendance_id/override", (req, res) => {
  const deptId = req.user.department_id;
  const { status } = req.body; // 'present' | 'excused' | 'absent'
  if (!["present", "excused", "absent"].includes(status)) {
    return res.status(400).json({ error: "حالة غير صحيحة" });
  }

  const attendance = db
    .prepare(
      `SELECT a.* FROM attendance a JOIN schedules s ON s.id=a.schedule_id WHERE a.id=? AND s.department_id=?`
    )
    .get(req.params.attendance_id, deptId);
  if (!attendance) return res.status(404).json({ error: "السجل غير موجود ضمن قسمك" });

  db.prepare("UPDATE attendance SET status=?, marked_by=? WHERE id=?").run(
    status,
    `monitor:${req.user.id}`,
    attendance.id
  );
  res.json({ message: "تم تحديث حالة الحضور" });
});

/** إنشاء سجل حضور يدويًا (إن لم يكن موجودًا) لمحاضرة/تاريخ معيّن */
router.post("/attendance/manual", (req, res) => {
  const deptId = req.user.department_id;
  const { schedule_id, date, status } = req.body;
  if (!schedule_id || !date || !status) return res.status(400).json({ error: "بيانات ناقصة" });

  const schedule = db.prepare("SELECT * FROM schedules WHERE id=? AND department_id=?").get(schedule_id, deptId);
  if (!schedule) return res.status(404).json({ error: "المحاضرة غير موجودة ضمن قسمك" });

  const existing = db.prepare("SELECT * FROM attendance WHERE schedule_id=? AND date=?").get(schedule_id, date);
  if (existing) {
    db.prepare("UPDATE attendance SET status=?, marked_by=? WHERE id=?").run(status, `monitor:${req.user.id}`, existing.id);
  } else {
    db.prepare(
      "INSERT INTO attendance (schedule_id, faculty_id, date, status, marked_by) VALUES (?, ?, ?, ?, ?)"
    ).run(schedule_id, schedule.faculty_id, date, status, `monitor:${req.user.id}`);
  }
  res.json({ message: "تم تحديث السجل" });
});

router.get("/reports", (req, res) => {
  const deptId = req.user.department_id;
  const { from, to, status, format } = req.query;
  let query = `
    SELECT u.full_name, u.employee_number, c.name as course_name, a.date, s.start_time, s.end_time,
           a.check_in_time, a.status
    FROM attendance a JOIN schedules s ON s.id=a.schedule_id JOIN users u ON u.id=a.faculty_id
    JOIN courses c ON c.id=s.course_id
    WHERE s.department_id=?`;
  const params = [deptId];
  if (from) { query += " AND a.date>=?"; params.push(from); }
  if (to) { query += " AND a.date<=?"; params.push(to); }
  if (status) { query += " AND a.status=?"; params.push(status); }
  query += " ORDER BY a.date DESC";

  const rows = db.prepare(query).all(...params);

  if (format === "csv") {
    const fields = [
      { label: "الاسم", value: "full_name" },
      { label: "الرقم الوظيفي", value: "employee_number" },
      { label: "المقرر", value: "course_name" },
      { label: "التاريخ", value: "date" },
      { label: "وقت المحاضرة", value: (r) => `${r.start_time} - ${r.end_time}` },
      { label: "وقت التحضير", value: "check_in_time" },
      { label: "الحالة", value: "status" },
    ];
    const parser = new CsvParser({ fields, withBOM: true });
    const csv = parser.parse(rows);
    res.header("Content-Type", "text/csv; charset=utf-8");
    res.attachment("department_report.csv");
    return res.send(csv);
  }

  res.json({ rows });
});

module.exports = router;
