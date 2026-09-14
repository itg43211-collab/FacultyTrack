const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

// نستخدم node:sqlite المدمجة داخل Node.js نفسه (بدون better-sqlite3)
// لتفادي الحاجة لتجميع (compile) وحدات native التي تتطلب Python/Visual Studio.
// متوفرة افتراضيًا في Node.js 22.5+ وما بعدها.

const DB_PATH = path.join(__dirname, "attendance.sqlite");
const isNew = !fs.existsSync(DB_PATH);

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// تنفيذ الـ schema دائمًا (CREATE TABLE IF NOT EXISTS آمنة للتكرار)
const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
db.exec(schema);

module.exports = { db, isNew };
