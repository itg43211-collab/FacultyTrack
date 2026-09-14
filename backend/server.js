require("dotenv").config();
const express = require("express");
const cors = require("cors");

require("./db"); // يضمن تنفيذ الـ schema عند الإقلاع

const authRoutes = require("./routes/auth");
const facultyRoutes = require("./routes/faculty");
const adminRoutes = require("./routes/admin");
const monitorRoutes = require("./routes/monitor");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/faculty", facultyRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/monitor", monitorRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "خطأ غير متوقع في الخادم" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ API server running on http://localhost:${PORT}`);
});
