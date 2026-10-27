
const $ = (id) => document.getElementById(id);

const dateInput = $("attendanceDate");
const monthInput = $("reportMonth");

const today = new Date();
const localDate = (d) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

dateInput.value = localDate(today);
monthInput.value = localDate(today).slice(0, 7);
$("today").textContent = today.toLocaleDateString("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric"
});

let students = [];
let attendanceData = {};
let workingPeriods = [1, 2, 3, 4, 5, 6, 7];

function showMessage(id, message, isError = false) {
  const element = $(id);
  element.textContent = message;
  element.classList.toggle("error", isError);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

// Student management
async function loadStudents() {
  students = await api("/api/students");
  $("totalStudents").textContent = students.length;

  $("studentRows").innerHTML = students.map((student) => `
    <tr>
      <td>${escapeHTML(student.roll_number)}</td>
      <td>${escapeHTML(student.name)}</td>
      <td>${escapeHTML(student.department)}</td>
      <td>
        <button class="secondary edit-student"
          data-id="${student.id}">Edit</button>
        <button class="delete-student"
          data-id="${student.id}">Delete</button>
      </td>
    </tr>
  `).join("");

  $("studentRows").querySelectorAll(".edit-student").forEach((button) => {
    button.addEventListener("click", () => editStudent(button.dataset.id));
  });

  $("studentRows").querySelectorAll(".delete-student").forEach((button) => {
    button.addEventListener("click", () => deleteStudent(button.dataset.id));
  });

  await loadAttendance();
}

$("studentForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = {
    roll_number: $("roll").value.trim(),
    name: $("name").value.trim(),
    department: $("department").value.trim()
  };

  try {
    await api("/api/students", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    $("studentForm").reset();
    showMessage("studentMessage", "Student added successfully!");
    await loadStudents();
  } catch (error) {
    showMessage("studentMessage", error.message, true);
  }
});

async function editStudent(id) {
  const student = students.find((item) => item.id === Number(id));
  if (!student) return;

  const roll = prompt("Roll number:", student.roll_number);
  if (roll === null) return;

  const name = prompt("Student name:", student.name);
  if (name === null) return;

  const department = prompt("Department:", student.department);
  if (department === null) return;

  try {
    await api(`/api/students/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        roll_number: roll.trim(),
        name: name.trim(),
        department: department.trim()
      })
    });

    showMessage("studentMessage", "Student details updated.");
    await loadStudents();
  } catch (error) {
    showMessage("studentMessage", error.message, true);
  }
}

async function deleteStudent(id) {
  const student = students.find((item) => item.id === Number(id));
  if (!student) return;

  if (!confirm(`Delete ${student.name}? Their attendance records will also be deleted.`)) {
    return;
  }

  try {
    await api(`/api/students/${id}`, { method: "DELETE" });
    showMessage("studentMessage", "Student deleted.");
    await loadStudents();
    await loadReport();
  } catch (error) {
    showMessage("studentMessage", error.message, true);
  }
}

// Daily attendance
function renderAttendance() {
  $("attendanceHead").innerHTML = `
    <tr>
      <th>Roll No.</th>
      <th>Student Name</th>
      ${[1, 2, 3, 4, 5, 6, 7]
        .map((period) => `<th>Period ${period}</th>`).join("")}
    </tr>
  `;

  $("attendanceRows").innerHTML = students.map((student) => `
    <tr>
      <td>${escapeHTML(student.roll_number)}</td>
      <td>${escapeHTML(student.name)}</td>
      ${[1, 2, 3, 4, 5, 6, 7].map((period) => {
        const status = attendanceData[student.id]?.[period] || "";
        return `
          <td>
            <select data-student="${student.id}" data-period="${period}"
              aria-label="${escapeHTML(student.name)} period ${period}">
              <option value="" ${status === "" ? "selected" : ""}>— Select —</option>
              <option value="Present" ${status === "Present" ? "selected" : ""}>Present</option>
              <option value="Absent" ${status === "Absent" ? "selected" : ""}>Absent</option>
            </select>
          </td>
        `;
      }).join("")}
    </tr>
  `).join("");

  $("selectedDateLabel").textContent = dateInput.value || "—";
}

async function loadAttendance() {
  if (!dateInput.value) return;

  try {
    const data = await api(
      `/api/attendance?date=${encodeURIComponent(dateInput.value)}`
    );

    attendanceData = {};

    for (const student of data.students) {
      attendanceData[student.id] = { ...student.attendance };
    }

    // Previously saved schedule, or all seven periods for a new date.
    workingPeriods = data.working_periods.length
      ? data.working_periods
      : [1, 2, 3, 4, 5, 6, 7];

    renderAttendance();
    showMessage("attendanceMessage", "Attendance loaded for " + dateInput.value);
  } catch (error) {
    showMessage("attendanceMessage", error.message, true);
  }
}

function setAllAttendance(status) {
  for (const student of students) {
    attendanceData[student.id] = {};

    for (const period of workingPeriods) {
      attendanceData[student.id][period] = status;
    }
  }

  renderAttendance();
}

$("allPresent").addEventListener("click", () => setAllAttendance("Present"));
$("allAbsent").addEventListener("click", () => setAllAttendance("Absent"));
$("loadAttendance").addEventListener("click", loadAttendance);
dateInput.addEventListener("change", loadAttendance);

$("attendanceRows").addEventListener("change", (event) => {
  const select = event.target;

  if (!select.matches("select[data-student]")) return;

  const studentId = select.dataset.student;
  const period = Number(select.dataset.period);
  const status = select.value;

  attendanceData[studentId] ||= {};

  if (status) {
    attendanceData[studentId][period] = status;
  } else {
    delete attendanceData[studentId][period];
  }
});

$("saveAttendance").addEventListener("click", async () => {
  if (!dateInput.value) {
    showMessage("attendanceMessage", "Select an attendance date.", true);
    return;
  }

  const attendance = [];

  for (const student of students) {
    for (const period of workingPeriods) {
      const status = attendanceData[student.id]?.[period];

      if (status) {
        attendance.push({
          student_id: student.id,
          period,
          status
        });
      }
    }
  }

  try {
    await api("/api/attendance/bulk", {
      method: "POST",
      body: JSON.stringify({
        date: dateInput.value,
        attendance,
        working_periods: workingPeriods
      })
    });

    showMessage("attendanceMessage", "Attendance saved successfully!");
    await loadReport();
  } catch (error) {
    showMessage("attendanceMessage", error.message, true);
  }
});

// Monthly reports
async function loadReport() {
  const month = monthInput.value;
  if (!month) return;

  try {
    const data = await api(
      `/api/reports/monthly?month=${encodeURIComponent(month)}`
    );

    $("reportRows").innerHTML = data.students.map((student) => `
      <tr>
        <td>${escapeHTML(student.roll_number)}</td>
        <td>${escapeHTML(student.name)}</td>
        <td>${student.working_periods}</td>
        <td class="present">${student.present}</td>
        <td class="absent">${student.absent}</td>
        <td>${student.attendance_percentage}%</td>
        <td>
          <span class="status-pill ${student.low_attendance ? "low" : "good"}">
            ${student.low_attendance ? "Low Attendance" : "OK"}
          </span>
        </td>
        <td>
          <button class="secondary individual-report"
            data-id="${student.id}">View</button>
        </td>
      </tr>
    `).join("");

    $("reportRows").querySelectorAll(".individual-report").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          const report = await api(
            `/api/reports/student/${button.dataset.id}?month=${encodeURIComponent(month)}`
          );

          alert(
            `Student: ${report.name}\n` +
            `Roll Number: ${report.roll_number}\n` +
            `Month: ${month}\n` +
            `Working Periods: ${report.working_periods}\n` +
            `Present: ${report.present}\n` +
            `Absent: ${report.absent}\n` +
            `Attendance: ${report.attendance_percentage}%`
          );
        } catch (error) {
          showMessage("reportMessage", error.message, true);
        }
      });
    });

    $("lowAttendance").textContent =
      data.students.filter((student) => student.low_attendance).length;

    showMessage("reportMessage", `Report generated for ${month}.`);
  } catch (error) {
    showMessage("reportMessage", error.message, true);
  }
}

$("loadReport").addEventListener("click", loadReport);

$("exportCsv").addEventListener("click", () => {
  if (!monthInput.value) {
    showMessage("reportMessage", "Select a report month.", true);
    return;
  }

  window.location.href =
    `/api/reports/monthly.csv?month=${encodeURIComponent(monthInput.value)}`;
});

// Initial page load
async function initialize() {
  try {
    await loadStudents();
    await loadReport();
  } catch (error) {
    showMessage("studentMessage", error.message, true);
  }
}

initialize();
