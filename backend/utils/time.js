const GRACE_MINUTES = 15;

/** يحوّل "HH:MM" إلى عدد دقائق منذ منتصف الليل */
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * يتحقق هل الوقت الحالي (server time) ضمن نافذة التحضير المسموحة
 * (بداية المحاضرة - 15 دقيقة) حتى (نهاية المحاضرة + 15 دقيقة)
 */
function isWithinAttendanceWindow(startTime, endTime, now = new Date()) {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const windowStart = toMinutes(startTime) - GRACE_MINUTES;
  const windowEnd = toMinutes(endTime) + GRACE_MINUTES;
  return nowMinutes >= windowStart && nowMinutes <= windowEnd;
}

function windowStatus(startTime, endTime, now = new Date()) {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const windowStart = toMinutes(startTime) - GRACE_MINUTES;
  const windowEnd = toMinutes(endTime) + GRACE_MINUTES;
  if (nowMinutes < windowStart) return "not_started"; // لم يبدأ وقت التحضير
  if (nowMinutes > windowEnd) return "ended"; // انتهى وقت التحضير
  return "open"; // متاح للتحضير
}

// اليوم الحالي بصيغة day_of_week نفسها المستخدمة في الجداول (0=أحد ... 6=سبت)
// JS Date.getDay(): 0=Sunday, 1=Monday ... 6=Saturday => نفس الترقيم المطلوب تمامًا
function currentDayOfWeek(now = new Date()) {
  return now.getDay();
}

function todayDateStr(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

module.exports = {
  GRACE_MINUTES,
  toMinutes,
  isWithinAttendanceWindow,
  windowStatus,
  currentDayOfWeek,
  todayDateStr,
};
