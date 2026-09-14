// ============================================================
// طبقة الـ API — نسخة Supabase 100%
// ============================================================
// كل الطلبات تذهب مباشرة إلى Edge Function (api) على مشروع Supabase
// بدون أي سيرفر Express. توثيق الطلبات يتم بجلسة Supabase Auth
// (لا يوجد JWT يدوي / localStorage token).
// الواجهة القديمة للصفحات (api.get/post/put/postForm) بقيت كما هي
// حتى لا تتغير أي صفحة من صفحات النظام.
// ============================================================

import { supabase } from "./lib/supabase";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
if (!SUPABASE_URL) {
  throw new Error(
    "VITE_SUPABASE_URL غير معرّف — تأكد من ملف frontend/.env"
  );
}

const BASE = `${SUPABASE_URL}/functions/v1/api`;

async function getSessionToken() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

// تحويل ملف CSV المرفوع إلى JSON (اسم الملف + محتوى base64)
// لأن Edge Functions لا تستقبل multipart/form-data هنا.
const IMPORT_PATHS = ["/admin/faculty/import", "/admin/schedules/import"];

async function formDataToPayload(fd) {
  const file = fd.get("file");
  if (!file) throw new Error("الرجاء إرفاق ملف CSV");
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return { filename: file.name, content_b64: btoa(binary) };
}

async function request(path, { method = "GET", body, isForm = false } = {}) {
  const headers = {};
  const token = await getSessionToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (!isForm) headers["Content-Type"] = "application/json";

  let payload = body;
  if (isForm && body instanceof FormData && IMPORT_PATHS.includes(path)) {
    payload = await formDataToPayload(body);
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: payload !== undefined && payload !== null
      ? (isForm && !(payload instanceof Object) ? payload : JSON.stringify(payload))
      : undefined,
  });

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("text/csv")) {
    if (!res.ok) throw new Error("تعذر تنزيل التقرير");
    return res.blob();
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "حدث خطأ غير متوقع");
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body }),
  put: (path, body) => request(path, { method: "PUT", body }),
  postForm: (path, formData) =>
    request(path, { method: "POST", body: formData, isForm: true }),
  // التوكن يُدار الآن بالكامل عبر Supabase Auth — لا حاجة لهذه الدوال
  setToken: () => {},
  clearToken: () => {},
  getToken: () => getSessionToken(),
};

export function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
