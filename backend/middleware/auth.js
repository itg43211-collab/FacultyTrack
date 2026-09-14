const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-in-production";

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "غير مصرح: يرجى تسجيل الدخول" });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, employee_number, role, department_id }
    next();
  } catch (e) {
    return res.status(401).json({ error: "الجلسة منتهية، يرجى تسجيل الدخول مجددًا" });
  }
}

// يسمح فقط لأدوار معينة بالوصول
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "لا تملك صلاحية الوصول لهذا المورد" });
    }
    next();
  };
}

module.exports = { authRequired, requireRole, JWT_SECRET };
