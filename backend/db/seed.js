const bcrypt = require("bcryptjs");
const { db } = require("./index");

function seed() {
  const deptCount = db.prepare("SELECT COUNT(*) AS c FROM departments").get().c;
  if (deptCount === 0) {
    const insertDept = db.prepare(
      "INSERT INTO departments (name, name_en) VALUES (?, ?)"
    );
    insertDept.run("علوم الحاسب", "Computer Science");
    insertDept.run("تقنية المعلومات", "Information Technology");
    insertDept.run("الرياضيات", "Mathematics");
    console.log("✔ تم إنشاء الأقسام الافتراضية");
  }

  const csDept = db.prepare("SELECT id FROM departments WHERE name = ?").get("علوم الحاسب");

  const userCount = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  if (userCount === 0) {
    const adminHash = bcrypt.hashSync("Admin@12345", 10);
    db.prepare(
      `INSERT INTO users (employee_number, full_name, role, department_id, email, password_hash, must_set_password, status)
       VALUES (?, ?, 'admin', NULL, ?, ?, 0, 'active')`
    ).run("ADMIN001", "مدير النظام", "admin@qu.edu.sa", adminHash);

    // عضو مراقب قسم (بدون كلمة مرور بعد - أول دخول)
    db.prepare(
      `INSERT INTO users (employee_number, full_name, role, department_id, must_set_password, status)
       VALUES (?, ?, 'monitor', ?, 1, 'active')`
    ).run("MON001", "مراقب قسم علوم الحاسب", csDept.id);

    // أعضاء هيئة تدريس تجريبيين (بدون كلمة مرور - يفعّلون حسابهم بأنفسهم)
    db.prepare(
      `INSERT INTO users (employee_number, full_name, role, department_id, must_set_password, status)
       VALUES (?, ?, 'faculty', ?, 1, 'active')`
    ).run("1001", "د. أحمد الغامدي", csDept.id);

    db.prepare(
      `INSERT INTO users (employee_number, full_name, role, department_id, must_set_password, status)
       VALUES (?, ?, 'faculty', ?, 1, 'active')`
    ).run("1002", "د. سارة العتيبي", csDept.id);

    console.log("✔ تم إنشاء المستخدمين الافتراضيين");
    console.log("  Admin  -> employee_number: ADMIN001 / password: Admin@12345");
    console.log("  Monitor-> employee_number: MON001 (يحتاج أول تسجيل دخول)");
    console.log("  Faculty-> employee_number: 1001 أو 1002 (يحتاج أول تسجيل دخول)");
  }

  const courseCount = db.prepare("SELECT COUNT(*) AS c FROM courses").get().c;
  if (courseCount === 0) {
    const insertCourse = db.prepare(
      "INSERT INTO courses (code, name, department_id) VALUES (?, ?, ?)"
    );
    const c1 = insertCourse.run("CS101", "أنظمة قواعد البيانات", csDept.id);
    const c2 = insertCourse.run("CS205", "تطوير الويب", csDept.id);
    console.log("✔ تم إنشاء المقررات الافتراضية");

    const semCount = db.prepare("SELECT COUNT(*) AS c FROM semesters").get().c;
    if (semCount === 0) {
      const sem = db
        .prepare(
          `INSERT INTO semesters (name, start_date, end_date, is_active) VALUES (?, ?, ?, 1)`
        )
        .run("الفصل الدراسي الأول 2026/2027", "2026-08-30", "2026-12-25");

      const faculty1 = db.prepare("SELECT id FROM users WHERE employee_number = '1001'").get();
      const faculty2 = db.prepare("SELECT id FROM users WHERE employee_number = '1002'").get();

      const insertSchedule = db.prepare(
        `INSERT INTO schedules (faculty_id, course_id, semester_id, day_of_week, start_time, end_time, section, department_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      // اليوم الحالي (0=أحد) لتسهيل الاختبار الفوري + أيام أخرى
      const today = new Date().getDay(); // JS: 0=Sunday .. matches our scheme
      insertSchedule.run(faculty1.id, c1.lastInsertRowid, sem.lastInsertRowid, today, "08:00", "09:00", "1", csDept.id);
      insertSchedule.run(faculty1.id, c2.lastInsertRowid, sem.lastInsertRowid, 1, "10:00", "11:00", "2", csDept.id);
      insertSchedule.run(faculty2.id, c2.lastInsertRowid, sem.lastInsertRowid, today, "13:00", "14:00", "1", csDept.id);
      console.log("✔ تم إنشاء الفصل الدراسي والجداول الافتراضية (محاضرة اليوم متاحة للاختبار الفوري)");
    }
  }

  const locCount = db.prepare("SELECT COUNT(*) AS c FROM university_location").get().c;
  if (locCount === 0) {
    // إحداثيات افتراضية (الرياض) - يجب على الـ Admin تعديلها لموقع الجامعة الفعلي
    db.prepare(
      `INSERT INTO university_location (name, lat, lng, radius_km) VALUES (?, ?, ?, ?)`
    ).run("جامعة القصيم", 26.3260, 43.9750, 5);
    console.log("✔ تم إنشاء موقع الجامعة الافتراضي (يجب تعديله من لوحة الـ Admin)");
  }
}

seed();
console.log("✅ Seeding complete");
