const iconv = require("iconv-lite");

/**
 * فك ترميز ملف CSV مرفوع بذكاء:
 * - يجرّب UTF-8 أولًا (الترميز القياسي)
 * - إذا فشل (بايتات غير صالحة)، يفترض أن الملف محفوظ بترميز Windows-1256
 *   العربي (شائع جدًا عند حفظ Excel لملف CSV على ويندوز بلغة عربية)
 */
function decodeCsvBuffer(buffer) {
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    return decoder.decode(buffer);
  } catch (e) {
    return iconv.decode(buffer, "win1256");
  }
}

/**
 * يكتشف الفاصل المستخدم بين الأعمدة تلقائيًا بمقارنة أول سطر:
 * فاصلة عادية (,) أو فاصلة منقوطة (;) أو Tab
 * (Excel بالنسخ العربية من ويندوز يستخدم الفاصلة المنقوطة افتراضيًا)
 */
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/)[0] || "";
  const counts = {
    ",": (firstLine.match(/,/g) || []).length,
    ";": (firstLine.match(/;/g) || []).length,
    "\t": (firstLine.match(/\t/g) || []).length,
  };
  let best = ",";
  let bestCount = counts[","];
  for (const [delim, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = delim;
      bestCount = count;
    }
  }
  return best;
}

module.exports = { decodeCsvBuffer, detectDelimiter };
