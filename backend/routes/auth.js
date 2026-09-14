const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { db } = require("../db");
const { JWT_SECRET } = require("../middleware/auth");

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      employee_number: user.employee_number,
      full_name: user.full_name,
      role: user.role,
      department_id: user.department_id,
    },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
}

/**
 * الخطوة 1: التحقق من الرقم الوظيفي قبل تسجيل الدخول
 * - إذا لم يكن موجودًا مسبقًا => خطأ "الحساب غير موجود"
 * - إذا كان موجودًا لكنه لم يُنشئ كلمة مرور بعد => يُطلب منه إعداد الحساب (أول دخول)
 * - إذا كان موجودًا وله كلمة مرور => يُطلب إدخال كلمة المرور
 */
router.post("/check-employee", (req, res) => {
  const { employee_number } = req.body;
  if (!employee_number) {
    return res.status(400).json({ error: "الرجاء إدخال الرقم الوظيفي" });
  }

  const user = db
    .prepare("SELECT * FROM users WHERE employee_number = ?")
    .get(employee_number.trim());

  if (!user) {
    return res.status(404).json({ error: "الحساب غير موجود. تأكد من الرقم الوظيفي أو راجع إدارة النظام." });
  }

  if (user.status === "disabled") {
    return res.status(403).json({ error: "هذا الحساب معطّل. يرجى مراجعة إدارة النظام." });
  }

  return res.json({
    exists: true,
    needs_setup: !!user.must_set_password,
    full_name: user.full_name,
    role: user.role,
  });
});

/**
 * الخطوة 2أ: أول تسجيل دخول -> إنشاء كلمة المرور + البريد الإلكتروني
 */
router.post("/first-login-setup", (req, res) => {
  const { employee_number, password, email } = req.body;

  if (!employee_number || !password) {
    return res.status(400).json({ error: "الرجاء إدخال الرقم الوظيفي وكلمة المرور" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "يجب أن تتكون كلمة المرور من 8 أحرف على الأقل" });
  }

  const user = db
    .prepare("SELECT * FROM users WHERE employee_number = ?")
    .get(employee_number.trim());

  if (!user) {
    return res.status(404).json({ error: "الحساب غير موجود" });
  }
  if (!user.must_set_password) {
    return res.status(400).json({ error: "تم إعداد هذا الحساب مسبقًا، يرجى تسجيل الدخول بكلمة المرور" });
  }

  const password_hash = bcrypt.hashSync(password, 10);
  db.prepare(
    "UPDATE users SET password_hash = ?, email = COALESCE(?, email), must_set_password = 0 WHERE id = ?"
  ).run(password_hash, email || null, user.id);

  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
  const token = signToken(updated);
  return res.json({ token, user: sanitizeUser(updated) });
});

/**
 * الخطوة 2ب: تسجيل الدخول العادي (رقم وظيفي + كلمة مرور)
 */
router.post("/login", (req, res) => {
  const { employee_number, password } = req.body;
  if (!employee_number || !password) {
    return res.status(400).json({ error: "الرجاء إدخال الرقم الوظيفي وكلمة المرور" });
  }

  const user = db
    .prepare("SELECT * FROM users WHERE employee_number = ?")
    .get(employee_number.trim());

  if (!user) return res.status(404).json({ error: "الحساب غير موجود" });
  if (user.status === "disabled") return res.status(403).json({ error: "هذا الحساب معطّل" });
  if (user.must_set_password) {
    return res.status(400).json({ error: "الرجاء إكمال إعداد الحساب أولاً (أول تسجيل دخول)" });
  }

  const ok = bcrypt.compareSync(password, user.password_hash || "");
  if (!ok) return res.status(401).json({ error: "كلمة المرور خاطئة" });

  const token = signToken(user);
  return res.json({ token, user: sanitizeUser(user) });
});

function sanitizeUser(u) {
  const { password_hash, ...rest } = u;
  return rest;
}

module.exports = router;
