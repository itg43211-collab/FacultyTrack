import React, { useEffect, useState, useCallback } from "react";
import Layout from "../components/Layout";
import { api } from "../api";
import { supabase } from "../lib/supabase";
import { useToast } from "../ToastContext";

const STATUS_LABEL = { present: "حاضر", excused: "غائب بعذر", absent: "غائب بدون عذر", pending: "بانتظار الوقت" };
const BUTTON_LABEL = {
  available: "تحضير",
  not_started: "لم يبدأ وقت التحضير",
  done: "تم التحضير",
  closed: "انتهى وقت التحضير",
  excused: "مسجّل بعذر",
};

function statusClass(status) {
  if (status === "present") return "present";
  if (status === "excused") return "excused";
  if (status === "absent") return "absent";
  return "pending";
}

export default function FacultyDashboard() {
  const [data, setData] = useState(null);
  const [checkingId, setCheckingId] = useState(null);
  const [excuseFor, setExcuseFor] = useState(null); // schedule_id
  const showToast = useToast();

  const load = useCallback(async () => {
    const res = await api.get("/faculty/dashboard");
    setData(res);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCheckIn(scheduleId) {
    if (!navigator.geolocation) {
      showToast("متصفحك لا يدعم تحديد الموقع GPS", "error");
      return;
    }
    setCheckingId(scheduleId);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await api.post("/faculty/attendance/check-in", {
            schedule_id: scheduleId,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });
          showToast(res.message);
          await load();
        } catch (err) {
          showToast(err.message, "error");
        } finally {
          setCheckingId(null);
        }
      },
      (geoErr) => {
        setCheckingId(null);
        if (geoErr.code === geoErr.PERMISSION_DENIED) {
          showToast("تم رفض صلاحية الوصول إلى الموقع. يجب السماح بالوصول لتسجيل الحضور.", "error");
        } else {
          showToast("تعذر تحديد موقعك. تأكد من تفعيل GPS وحاول مجددًا.", "error");
        }
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  if (!data) return <Layout><div className="empty-state">جارٍ التحميل...</div></Layout>;

  return (
    <Layout>
      <div className="page-header">
        <h1>مرحبًا، {data.full_name}</h1>
        <p>{data.department} · {data.semester || "لا يوجد فصل دراسي فعّال"}</p>
      </div>

      <div className="stat-row">
        <div className="stat-box"><div className="n num">{data.today_lecture_count}</div><div className="l">محاضرات اليوم</div></div>
        <div className="stat-box"><div className="n num">{data.done_count}</div><div className="l">تم تحضيرها</div></div>
        <div className="stat-box"><div className="n num">{data.absent_count}</div><div className="l">غياب</div></div>
      </div>

      <div className="panel">
        <h2>محاضرات اليوم</h2>
        {data.lectures.length === 0 ? (
          <div className="empty-state">لا توجد محاضرات مجدولة لك اليوم.</div>
        ) : (
          <div className="lecture-list">
            {data.lectures.map((l) => (
              <div key={l.schedule_id} className={`lecture-card status-${statusClass(l.status)}`}>
                <div className="lecture-info">
                  <div className="course">{l.course_name} {l.course_code ? `(${l.course_code})` : ""} {l.section ? `- شعبة ${l.section}` : ""}</div>
                  <div className="meta">
                    <span className="num">{l.start_time} - {l.end_time}</span>
                    {l.check_in_time && <> · وقت التحضير: <span className="num">{l.check_in_time}</span></>}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className={`badge ${statusClass(l.status)}`}>{STATUS_LABEL[l.status] || l.status}</span>
                  {l.button_state === "available" ? (
                    <button
                      className="btn btn-primary"
                      onClick={() => handleCheckIn(l.schedule_id)}
                      disabled={checkingId === l.schedule_id}
                    >
                      {checkingId === l.schedule_id ? "جارٍ التحقق من الموقع..." : "تحضير"}
                    </button>
                  ) : l.button_state === "closed" ? (
                    <button className="btn btn-outline" onClick={() => setExcuseFor(l.schedule_id)}>
                      تسجيل عذر
                    </button>
                  ) : (
                    <button className="btn btn-ghost" disabled>{BUTTON_LABEL[l.button_state]}</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {excuseFor && (
        <ExcuseModal
          scheduleId={excuseFor}
          onClose={() => setExcuseFor(null)}
          onSaved={async () => {
            setExcuseFor(null);
            showToast("تم تسجيل العذر بنجاح");
            await load();
          }}
        />
      )}
    </Layout>
  );
}

function ExcuseModal({ scheduleId, onClose, onSaved }) {
  const [type, setType] = useState("health");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      let attachment_path = null;
      if (file) {
        const { data: { user } } = await supabase.auth.getUser();
        const safeName = file.name.replace(/[^\w.\-]/g, "_");
        const path = `${user.id}/${Date.now()}-${safeName}`;
        const { error: uploadErr } = await supabase.storage
          .from("excuse-attachments")
          .upload(path, file, { upsert: false });
        if (uploadErr) throw new Error("تعذر رفع المرفق: " + uploadErr.message);
        attachment_path = path;
      }
      await api.post("/faculty/excuses", { schedule_id: scheduleId, date, type, notes, attachment_path });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <h2 style={{ marginTop: 0 }}>تسجيل عذر عن الغياب</h2>
        {error && <div className="error-box">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label>تاريخ المحاضرة</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label>نوع العذر</label>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="health">عذر صحي</option>
              <option value="family">عذر عائلي</option>
              <option value="other">أخرى</option>
            </select>
          </div>
          <div className="field">
            <label>ملاحظات</label>
            <textarea rows="3" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: "100%", padding: 10, border: "1px solid var(--line)", borderRadius: 4 }} />
          </div>
          <div className="field">
            <label>مرفق (اختياري) — مثل تقرير طبي أو ما يثبت العذر</label>
            <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files[0] || null)} />
            <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 4 }}>
              المرفق يظهر للمدير ومراقب القسم فقط.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>إلغاء</button>
            <button className="btn btn-primary" disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ العذر"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

const overlayStyle = {
  position: "fixed", inset: 0, background: "rgba(19,19,61,0.45)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20,
};
const modalStyle = {
  background: "#fff", borderRadius: 6, padding: 24, width: "100%", maxWidth: 420,
};