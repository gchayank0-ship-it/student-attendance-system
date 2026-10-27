
const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create database folder
const databaseDir = path.join(__dirname, "database");

if (!fs.existsSync(databaseDir)) {
  fs.mkdirSync(databaseDir, { recursive: true });
}

// SQLite database
const db = new Database(
  path.join(databaseDir, "attendance.db")
);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Database tables
db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    roll_number TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    department TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    attendance_date TEXT NOT NULL,
    period INTEGER NOT NULL CHECK(period BETWEEN 1 AND 7),
    status TEXT NOT NULL CHECK(status IN ('Present', 'Absent')),
    UNIQUE(student_id, attendance_date, period),
    FOREIGN KEY(student_id) REFERENCES students(id)
      ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS working_periods (
    attendance_date TEXT NOT NULL,
    period INTEGER NOT NULL CHECK(period BETWEEN 1 AND 7),
    PRIMARY KEY(attendance_date, period)
  );
`);

const PERIODS_PER_DAY = 7;
const ATTENDANCE_THRESHOLD = 75;

// Helpers
function isValidDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
    return false;
  }

  const parsed = new Date(`${date}T00:00:00Z`);

  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date;
}

function isValidMonth(month) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month || "");
}

function getMonthlyReport(month) {
  const [year, monthNumber] = month.split("-");
  const startDate = `${month}-01`;

  const nextMonthDate = new Date(
    Date.UTC(Number(year), Number(monthNumber), 1)
  );

  const endDate = nextMonthDate.toISOString().slice(0, 10);

  const workingPeriods = db.prepare(`
    SELECT COUNT(*) AS total
    FROM working_periods
    WHERE attendance_date >= ?
      AND attendance_date < ?
  `).get(startDate, endDate).total;

  const students = db.prepare(`
    SELECT
      s.id,
      s.roll_number,
      s.name,
      s.department,
      SUM(
        CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END
      ) AS present
    FROM students s
    LEFT JOIN attendance a
      ON a.student_id = s.id
      AND a.attendance_date >= ?
      AND a.attendance_date < ?
    GROUP BY s.id
    ORDER BY s.roll_number
  `).all(startDate, endDate);

  return students.map((student) => {
    const present = Number(student.present || 0);
    const absent = Math.max(0, workingPeriods - present);
    const percentage = workingPeriods > 0
      ? Number(((present / workingPeriods) * 100).toFixed(2))
      : 0;

    return {
      id: student.id,
      roll_number: student.roll_number,
      name: student.name,
      department: student.department,
      working_periods: workingPeriods,
      present,
      absent,
      attendance_percentage: percentage,
      low_attendance:
        workingPeriods > 0 &&
        percentage < ATTENDANCE_THRESHOLD
    };
  });
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    message: "Attendance API is running"
  });
});

// Get all students
app.get("/api/students", (req, res) => {
  const students = db.prepare(`
    SELECT * FROM students ORDER BY roll_number
  `).all();

  res.json(students);
});

// Add student
app.post("/api/students", (req, res) => {
  const rollNumber = String(req.body.roll_number || "").trim();
  const name = String(req.body.name || "").trim();
  const department = String(req.body.department || "").trim();

  if (!rollNumber || !name || !department) {
    return res.status(400).json({
      error: "Roll number, name and department are required."
    });
  }

  try {
    const result = db.prepare(`
      INSERT INTO students (roll_number, name, department)
      VALUES (?, ?, ?)
    `).run(rollNumber, name, department);

    res.status(201).json({
      message: "Student added successfully",
      id: result.lastInsertRowid
    });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({
        error: "This roll number already exists."
      });
    }

    res.status(500).json({ error: "Could not add student." });
  }
});

// Edit student
app.put("/api/students/:id", (req, res) => {
  const rollNumber = String(req.body.roll_number || "").trim();
  const name = String(req.body.name || "").trim();
  const department = String(req.body.department || "").trim();

  if (!rollNumber || !name || !department) {
    return res.status(400).json({
      error: "Roll number, name and department are required."
    });
  }

  try {
    const result = db.prepare(`
      UPDATE students
      SET roll_number = ?, name = ?, department = ?
      WHERE id = ?
    `).run(rollNumber, name, department, req.params.id);

    if (!result.changes) {
      return res.status(404).json({ error: "Student not found." });
    }

    res.json({ message: "Student updated successfully." });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({
        error: "This roll number already exists."
      });
    }

    res.status(500).json({ error: "Could not update student." });
  }
});

// Delete student
app.delete("/api/students/:id", (req, res) => {
  const result = db.prepare(`
    DELETE FROM students WHERE id = ?
  `).run(req.params.id);

  if (!result.changes) {
    return res.status(404).json({ error: "Student not found." });
  }

  res.json({ message: "Student deleted successfully." });
});

// Get attendance for a selected date
app.get("/api/attendance", (req, res) => {
  const { date } = req.query;

  if (!isValidDate(date)) {
    return res.status(400).json({
      error: "Provide a valid date in YYYY-MM-DD format."
    });
  }

  const students = db.prepare(`
    SELECT
      s.id,
      s.roll_number,
      s.name,
      s.department
    FROM students s
    ORDER BY s.roll_number
  `).all();

  const records = db.prepare(`
    SELECT student_id, period, status
    FROM attendance
    WHERE attendance_date = ?
  `).all(date);

  const working = db.prepare(`
    SELECT period
    FROM working_periods
    WHERE attendance_date = ?
  `).all(date).map((row) => row.period);

  res.json({
    date,
    working_periods: working,
    students: students.map((student) => ({
      ...student,
      attendance: Object.fromEntries(
        records
          .filter((record) => record.student_id === student.id)
          .map((record) => [record.period, record.status])
      )
    }))
  });
});

// Save or correct attendance for a date
app.post("/api/attendance/bulk", (req, res) => {
  const { date, attendance, working_periods } = req.body;

  if (!isValidDate(date)) {
    return res.status(400).json({
      error: "Provide a valid date in YYYY-MM-DD format."
    });
  }

  if (!Array.isArray(attendance) ||
      !Array.isArray(working_periods) ||
      working_periods.some(
        (p) => !Number.isInteger(p) || p < 1 || p > 7
      ) ||
      new Set(working_periods).size !== working_periods.length) {
    return res.status(400).json({
      error: "Attendance and working periods must be valid arrays."
    });
  }

  const saveAttendance = db.transaction(() => {
    const validStudents = new Set(
      db.prepare("SELECT id FROM students").all()
        .map((student) => student.id)
    );

    for (const record of attendance) {
      if (!Number.isInteger(Number(record.student_id)) ||
          !validStudents.has(Number(record.student_id)) ||
          !Number.isInteger(Number(record.period)) ||
          !working_periods.includes(Number(record.period)) ||
          !["Present", "Absent"].includes(record.status)) {
        throw new Error("Invalid student or attendance record.");
      }
    }

    // Replace the saved working-period schedule for this date.
    db.prepare(`
      DELETE FROM working_periods WHERE attendance_date = ?
    `).run(date);

    const addWorkingPeriod = db.prepare(`
      INSERT INTO working_periods (attendance_date, period)
      VALUES (?, ?)
    `);

    for (const period of working_periods) {
      addWorkingPeriod.run(date, period);
    }

    // Remove old records for periods no longer marked as working.
    if (working_periods.length > 0) {
      const placeholders = working_periods.map(() => "?").join(",");

      db.prepare(`
        DELETE FROM attendance
        WHERE attendance_date = ?
          AND period NOT IN (${placeholders})
      `).run(date, ...working_periods);
    } else {
      db.prepare(`
        DELETE FROM attendance WHERE attendance_date = ?
      `).run(date);
    }

    const saveRecord = db.prepare(`
      INSERT INTO attendance
        (student_id, attendance_date, period, status)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(student_id, attendance_date, period)
      DO UPDATE SET status = excluded.status
    `);

    for (const record of attendance) {
      saveRecord.run(
        Number(record.student_id),
        date,
        Number(record.period),
        record.status
      );
    }
  });

  try {
    saveAttendance();
    res.json({ message: "Attendance saved successfully." });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Daily attendance history
app.get("/api/attendance/history", (req, res) => {
  const { month } = req.query;

  if (!isValidMonth(month)) {
    return res.status(400).json({
      error: "Provide a valid month in YYYY-MM format."
    });
  }

  const records = db.prepare(`
    SELECT
      attendance_date,
      COUNT(*) AS recorded_periods,
      SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) AS present,
      SUM(CASE WHEN status = 'Absent' THEN 1 ELSE 0 END) AS absent
    FROM attendance
    WHERE attendance_date LIKE ?
    GROUP BY attendance_date
    ORDER BY attendance_date
  `).all(`${month}-%`);

  res.json(records);
});

// Monthly class report
app.get("/api/reports/monthly", (req, res) => {
  const { month } = req.query;

  if (!isValidMonth(month)) {
    return res.status(400).json({
      error: "Provide a valid month in YYYY-MM format."
    });
  }

  res.json({
    month,
    attendance_threshold: ATTENDANCE_THRESHOLD,
    students: getMonthlyReport(month)
  });
});

// Individual student's monthly report
app.get("/api/reports/student/:id", (req, res) => {
  const { month } = req.query;

  if (!isValidMonth(month)) {
    return res.status(400).json({
      error: "Provide a valid month in YYYY-MM format."
    });
  }

  const student = db.prepare(`
    SELECT id, roll_number, name, department
    FROM students WHERE id = ?
  `).get(req.params.id);

  if (!student) {
    return res.status(404).json({ error: "Student not found." });
  }

  const report = getMonthlyReport(month).find(
    (item) => item.id === student.id
  );

  res.json({ month, ...report });
});

// Export monthly report as CSV
app.get("/api/reports/monthly.csv", (req, res) => {
  const { month } = req.query;

  if (!isValidMonth(month)) {
    return res.status(400).json({
      error: "Provide a valid month in YYYY-MM format."
    });
  }

  const rows = getMonthlyReport(month);

  const escapeCSV = (value) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;

  const header = [
    "Roll Number",
    "Name",
    "Department",
    "Working Periods",
    "Present",
    "Absent",
    "Attendance Percentage",
    "Low Attendance"
  ];

  const lines = [
    header,
    ...rows.map((row) => [
      row.roll_number,
      row.name,
      row.department,
      row.working_periods,
      row.present,
      row.absent,
      `${row.attendance_percentage}%`,
      row.low_attendance ? "Yes" : "No"
    ])
  ];

  const csv = lines
    .map((row) => row.map(escapeCSV).join(","))
    .join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="attendance-${month}.csv"`
  );

  res.send("\uFEFF" + csv);
});

// API fallback and frontend
app.use("/api", (req, res) => {
  res.status(404).json({ error: "API endpoint not found." });
});

app.use(express.static(path.join(__dirname, "public")));

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start server
app.listen(PORT, () => {
  console.log(`Attendance app running at http://localhost:${PORT}`);
});

// Close database gracefully
process.on("SIGINT", () => {
  db.close();
  process.exit(0);
});
