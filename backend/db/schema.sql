-- ======================================================
-- نظام تحضير أعضاء هيئة التدريس - Database Schema
-- ======================================================

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  name_en TEXT
);

CREATE TABLE IF NOT EXISTS semesters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0
);

-- كل المستخدمين (Admin / Faculty / Monitor) في جدول واحد بأدوار مختلفة
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_number TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','faculty','monitor')),
  department_id INTEGER REFERENCES departments(id),
  email TEXT,
  password_hash TEXT,               -- NULL حتى أول تسجيل دخول
  must_set_password INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT,
  name TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id)
);

-- جدول محاضرات كل عضو
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  faculty_id INTEGER NOT NULL REFERENCES users(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  semester_id INTEGER NOT NULL REFERENCES semesters(id),
  day_of_week INTEGER NOT NULL, -- 0=الأحد ... 6=السبت
  start_time TEXT NOT NULL,     -- HH:MM
  end_time TEXT NOT NULL,       -- HH:MM
  section TEXT,
  department_id INTEGER REFERENCES departments(id)
);

-- سجل الحضور الفعلي لكل محاضرة في تاريخ معيّن
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id),
  faculty_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,             -- YYYY-MM-DD
  status TEXT NOT NULL DEFAULT 'absent' CHECK(status IN ('present','excused','absent')),
  check_in_time TEXT,
  lat REAL,
  lng REAL,
  distance_meters REAL,
  verified INTEGER DEFAULT 0,
  marked_by TEXT DEFAULT 'self',  -- 'self' أو 'monitor:<user_id>'
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(schedule_id, date)
);

CREATE TABLE IF NOT EXISTS excuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attendance_id INTEGER NOT NULL REFERENCES attendance(id),
  type TEXT NOT NULL CHECK(type IN ('health','family','other')),
  notes TEXT,
  excuse_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS university_location (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT DEFAULT 'الموقع الرئيسي',
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  radius_km REAL NOT NULL DEFAULT 5
);
