import React, { useEffect, useState } from "react";
import Layout from "../components/Layout";
import { api } from "../api";
import { useToast } from "../ToastContext";

export default function AdminLocation() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    api.get("/admin/location").then((res) => setForm(res.location));
  }, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put("/admin/location", {
        name: form.name,
        lat: parseFloat(form.lat),
        lng: parseFloat(form.lng),
        radius_km: parseFloat(form.radius_km),
      });
      showToast("تم تحديث موقع الجامعة بنجاح");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) return showToast("متصفحك لا يدعم تحديد الموقع", "error");
    navigator.geolocation.getCurrentPosition(
      (pos) => setForm({ ...form, lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => showToast("تعذر تحديد موقعك الحالي", "error")
    );
  }

  if (!form) return <Layout><div className="empty-state">جارٍ التحميل...</div></Layout>;

  return (
    <Layout>
      <div className="page-header">
        <h1>موقع الجامعة</h1>
        <p>هذه الإحداثيات والنطاق هي المرجع الوحيد للتحقق من موقع عضو هيئة التدريس عند التحضير — لا يمكن للمستخدم إدخال موقعه يدويًا.</p>
      </div>

      <div className="panel" style={{ maxWidth: 460 }}>
        <h2>إعدادات النطاق الجغرافي</h2>
        <form onSubmit={save}>
          <div className="field">
            <label>اسم الموقع</label>
            <input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Latitude (خط العرض)</label>
            <input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} />
          </div>
          <div className="field">
            <label>Longitude (خط الطول)</label>
            <input value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} />
          </div>
          <div className="field">
            <label>النطاق المسموح (كم)</label>
            <input value={form.radius_km} onChange={(e) => setForm({ ...form, radius_km: e.target.value })} />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" className="btn btn-outline" onClick={useMyLocation}>استخدام موقعي الحالي</button>
            <button className="btn btn-primary" disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ"}</button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
