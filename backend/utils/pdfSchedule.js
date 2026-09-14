const DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const HEADER_WORDS = [
  "الرقم الوظيفي", "employee_number", "اسم المقرر", "course_name",
  "اليوم", "day", "وقت البداية", "start_time",
];

/** يقسّم سطرًا واحدًا إلى حقول، بترتيب أولوية: "|" ثم Tab ثم مسافتين فأكثر */
function splitFields(line) {
  if (line.includes("|")) return line.split("|").map((s) => s.trim());
  if (line.includes("\t")) return line.split("\t").map((s) => s.trim());
  return line.split(/\s{2,}/).map((s) => s.trim());
}

function looksLikeHeader(fields) {
  return fields.some((f) => HEADER_WORDS.some((w) => f.includes(w)));
}

function looksLikeDataRow(fields) {
  // نتحقق أن أحد الحقول على الأقل يحتوي اسم يوم عربي أو رقم وظيفي محتمل
  return fields.some((f) => DAY_NAMES.includes(f)) || fields.some((f) => /^\d{3,}$/.test(f));
}

/**
 * يحوّل نص PDF مستخرج إلى مصفوفة سجلات بنفس شكل سجلات CSV
 * الترتيب المتوقع لكل سطر (7 حقول، اتركها فارغة بين "||" إن لم تتوفر):
 * employee_number | course_name | course_code | day | start_time | end_time | section
 */
function parsePdfScheduleText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const records = [];
  for (const line of lines) {
    const fields = splitFields(line);
    if (fields.length < 5) continue; // تجاهل عناوين/أرقام صفحات ونحوها
    if (looksLikeHeader(fields)) continue;
    if (!looksLikeDataRow(fields)) continue;

    let employee_number, course_name, course_code, day, start_time, end_time, section;

    if (fields.length >= 7) {
      [employee_number, course_name, course_code, day, start_time, end_time, section] = fields;
    } else if (fields.length === 6) {
      [employee_number, course_name, day, start_time, end_time, section] = fields;
      course_code = "";
    } else {
      // 5 حقول: بدون رمز مقرر ولا شعبة
      [employee_number, course_name, day, start_time, end_time] = fields;
      course_code = "";
      section = "";
    }

    records.push({
      employee_number: employee_number || "",
      course_name: course_name || "",
      course_code: course_code || "",
      day: day || "",
      start_time: start_time || "",
      end_time: end_time || "",
      section: section || "",
    });
  }
  return records;
}

module.exports = { parsePdfScheduleText };
