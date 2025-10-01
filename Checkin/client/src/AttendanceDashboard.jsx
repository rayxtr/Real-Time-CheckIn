import React, { useEffect, useState } from "react";
import axios from "axios";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import JSZip from "jszip";
import { saveAs } from "file-saver";

export default function AttendanceDashboard() {
  const [employees, setEmployees] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [attendance, setAttendance] = useState([]);
  const [tab, setTab] = useState("monthly");
  const [month, setMonth] = useState("");
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(null);

  const todayStr = new Date().toLocaleDateString("en-CA");

  // Fetch employees
  useEffect(() => {
    axios
      .get("http://localhost:5000/api/employees-list")
      .then((res) => {
        if (Array.isArray(res.data)) setEmployees(res.data);
        else setEmployees([]);
      })
      .catch((err) => console.error(err));
  }, []);

  // Auto-set week end
  useEffect(() => {
    if (tab === "weekly" && weekStart) {
      const start = new Date(weekStart);
      let end = new Date(start);
      end.setDate(start.getDate() + 6);
      const today = new Date();
      if (end > today) end = today;
      setWeekEnd(end.toLocaleDateString("en-CA"));
    }
  }, [weekStart, tab]);

  // Get month range (full month, respecting today)
  const getMonthRange = (monthStr) => {
    const [y, m] = monthStr.split("-");
    const year = parseInt(y, 10);
    const monthNum = parseInt(m, 10);

    const startDate = `${y}-${m.padStart(2, "0")}-01`;

    const endOfMonth = new Date(year, monthNum, 0);
    const today = new Date();
    const finalEnd = endOfMonth > today ? today : endOfMonth;

    const endDate = finalEnd.toLocaleDateString("en-CA"); // YYYY-MM-DD

    return { startDate, endDate };
  };

  // Fetch attendance
  const fetchAttendance = async () => {
    if (!selectedEmployee) return;
    setLoading(true);
    setError("");
    let startDate = "";
    let endDate = "";

    if (tab === "monthly") {
      if (!month) {
        setLoading(false);
        return;
      }
      ({ startDate, endDate } = getMonthRange(month));
    } else {
      if (!weekStart || !weekEnd) {
        setLoading(false);
        return;
      }
      startDate = weekStart;
      endDate = weekEnd;
    }

    try {
      const res = await axios.get("http://localhost:5000/api/attendance-range", {
        params: { startDate, endDate, employeeId: selectedEmployee },
      });
      if (Array.isArray(res.data)) setAttendance(res.data);
      else setAttendance([]);
    } catch (err) {
      console.error(err);
      setAttendance([]);
      setError("Failed to fetch attendance");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAttendance();
  }, [selectedEmployee, tab, month, weekStart, weekEnd]);

  // Generate PDF for single employee
 const generatePDF = () => {
  if (!attendance || attendance.length === 0) {
    alert("No attendance data to export.");
    return;
  }

  const doc = new jsPDF();
  const emp = employees.find((e) => String(e.EmployeeId) === String(selectedEmployee));
  const empName = emp?.EmployeeName || "Unknown";

  doc.setFontSize(14);
  doc.text(`Attendance Report (${tab})`, 14, 15);

  const subtitle = `Employee: ${empName} | ${
    tab === "monthly" ? `Month: ${month}` : `From: ${weekStart} To: ${weekEnd}`
  }`;
  doc.setFontSize(11);
  doc.text(subtitle, 14, 22);

  // Totals
  const totalPresent = attendance.filter(att => att.InTime !== "Holiday" && att.InTime !== "Leave / Absent").length;
  const totalHoliday = attendance.filter(att => att.InTime === "Holiday").length;
  const totalAbsent = attendance.filter(att => att.InTime === "Leave / Absent").length;

  autoTable(doc, {
    startY: 28,
    head: [["Employee Name", "Punch Date", "In Time", "Out Time", "Overtime Hours"]],
    body: [
      ...attendance.map(att => [
        att.EmployeeName,
        att.PunchDate,
        att.InTime,
        att.OutTime,
        att.OvertimeHours
      ]),
      ["", "Totals", `Present: ${totalPresent}`, `Holiday: ${totalHoliday}`, `Absent: ${totalAbsent}`]
    ],
    styles: { fontSize: 10 },
    headStyles: { fillColor: [22, 160, 133] },
    didParseCell: (data) => {
      if (data.row.section === "body" && data.row.index < attendance.length) {
        const punchDate = data.row.cells[1].raw;
        const inTime = data.row.cells[2].raw;
        if (inTime === "Holiday") data.cell.styles.fillColor = [209, 231, 221];
        else if (inTime === "Leave / Absent") data.cell.styles.fillColor = [248, 215, 218];
        else if (new Date(punchDate + "T00:00:00").getDay() === 5) data.cell.styles.fillColor = [207, 244, 252];
        if (punchDate === todayStr) data.cell.styles.textColor = [255, 87, 34];
      }
    },
  });

  const filename =
    tab === "monthly"
      ? `${empName}_${month}_attendance.pdf`
      : `${empName}_${weekStart}_to_${weekEnd}_attendance.pdf`;

  doc.save(filename);
};

  // Generate ZIP for all employees
  const generateAllPDFs = async () => {
  if (!employees || employees.length === 0) {
    alert("No employees available.");
    return;
  }

  let startDate = "";
  let endDate = "";

  if (tab === "monthly") {
    if (!month) { alert("Please select a month."); return; }
    ({ startDate, endDate } = getMonthRange(month));
  } else {
    if (!weekStart || !weekEnd) { alert("Please select a week range."); return; }
    startDate = weekStart;
    endDate = weekEnd;
  }

  const zip = new JSZip();
  setProgress({ current: 0, total: employees.length });

  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    try {
      const res = await axios.get("http://localhost:5000/api/attendance-range", {
        params: { startDate, endDate, employeeId: emp.EmployeeId },
      });

      const attData = Array.isArray(res.data) ? res.data : [];
      if (attData.length > 0) {
        const doc = new jsPDF();
        doc.setFontSize(14);
        doc.text(`Attendance Report (${tab})`, 14, 15);

        const subtitle = `Employee: ${emp.EmployeeName} | ${
          tab === "monthly" ? `Month: ${month}` : `From: ${weekStart} To: ${weekEnd}`
        }`;
        doc.setFontSize(11);
        doc.text(subtitle, 14, 22);

        // Totals
        const totalPresent = attData.filter(att => att.InTime !== "Holiday" && att.InTime !== "Leave / Absent").length;
        const totalHoliday = attData.filter(att => att.InTime === "Holiday").length;
        const totalAbsent = attData.filter(att => att.InTime === "Leave / Absent").length;

        autoTable(doc, {
          startY: 28,
          head: [["Employee Name", "Punch Date", "In Time", "Out Time", "Overtime Hours"]],
          body: [
            ...attData.map(att => [
              att.EmployeeName,
              att.PunchDate,
              att.InTime,
              att.OutTime,
              att.OvertimeHours
            ]),
            ["", "Totals", `Present: ${totalPresent}`, `Holiday: ${totalHoliday}`, `Absent: ${totalAbsent}`]
          ],
          styles: { fontSize: 10 },
          headStyles: { fillColor: [22, 160, 133] },
          didParseCell: (data) => {
            if (data.row.section === "body" && data.row.index < attData.length) {
              const punchDate = data.row.cells[1].raw;
              const inTime = data.row.cells[2].raw;
              if (inTime === "Holiday") data.cell.styles.fillColor = [209, 231, 221];
              else if (inTime === "Leave / Absent") data.cell.styles.fillColor = [248, 215, 218];
              else if (new Date(punchDate + "T00:00:00").getDay() === 5) data.cell.styles.fillColor = [207, 244, 252];
              if (punchDate === todayStr) data.cell.styles.textColor = [255, 87, 34];
            }
          },
        });

        const pdfBlob = doc.output("blob");
        const filename =
          tab === "monthly"
            ? `${emp.EmployeeName}_${month}_attendance.pdf`
            : `${emp.EmployeeName}_${weekStart}_to_${weekEnd}_attendance.pdf`;

        zip.file(filename, pdfBlob);
      }
    } catch (err) {
      console.error(`Failed for ${emp.EmployeeName}`, err);
    }

    setProgress({ current: i + 1, total: employees.length });
  }

  zip.generateAsync({ type: "blob" }).then((content) => {
    const zipName =
      tab === "monthly"
        ? `AllEmployees_${month}_attendance.zip`
        : `AllEmployees_${weekStart}_to_${weekEnd}_attendance.zip`;

    saveAs(content, zipName);
    setProgress(null);
  });
};

  return (
    <div className="attendance-dashboard">
      <h1>📊 Attendance Dashboard</h1>

      <div className="tabs">
        <button className={tab === "monthly" ? "active" : ""} onClick={() => setTab("monthly")}>
          Monthly
        </button>
        <button className={tab === "weekly" ? "active" : ""} onClick={() => setTab("weekly")}>
          Weekly
        </button>
      </div>

      <div className="filters">
        <label>
          Employee:
          <select value={selectedEmployee} onChange={(e) => setSelectedEmployee(e.target.value)}>
            <option value="">Select Employee</option>
            {employees.map((emp) => (
              <option key={emp.EmployeeId} value={emp.EmployeeId}>
                {emp.EmployeeName}
              </option>
            ))}
          </select>
        </label>

        {tab === "monthly" && (
          <label>
            Month:
            <input
              type="month"
              value={month}
              max={todayStr.slice(0, 7)}
              onChange={(e) => setMonth(e.target.value)}
            />
          </label>
        )}

        {tab === "weekly" && (
          <>
            <label>
              Start Date:
              <input type="date" value={weekStart} max={todayStr} onChange={(e) => setWeekStart(e.target.value)} />
            </label>
            <label>
              End Date: <input type="date" value={weekEnd} readOnly />
            </label>
          </>
        )}

        <button onClick={fetchAttendance}>Fetch</button>
      </div>

      <div style={{ margin: "10px 0" }}>
        <button onClick={() => window.print()}>Print</button>
        <button onClick={generatePDF}>Download PDF (Selected Employee)</button>
        <button onClick={generateAllPDFs}>Download All Employees PDF</button>
      </div>

      {progress && (
        <div style={{ margin: "10px 0", fontWeight: "bold", color: "blue" }}>
          Generating PDFs: {progress.current} / {progress.total}
        </div>
      )}

      {loading ? (
        <p>Loading...</p>
      ) : error ? (
        <p style={{ color: "red" }}>{error}</p>
      ) : attendance.length === 0 ? (
        <p>No attendance records found</p>
      ) : (
        <table border="1" cellPadding="5">
          <thead>
            <tr>
              <th>Employee Name</th>
              <th>Punch Date</th>
              <th>In Time</th>
              <th>Out Time</th>
              <th>Overtime Hours</th>
            </tr>
          </thead>
          <tbody>
            {attendance.map((att, idx) => {
              const isFriday = new Date(att.PunchDate + "T00:00:00").getDay() === 5;
              const isHoliday = att.InTime === "Holiday";
              const isAbsent = att.InTime === "Leave / Absent";
              const isToday = att.PunchDate === todayStr;

              let rowStyle = {};
              if (isHoliday) rowStyle = { backgroundColor: "#d1e7dd", fontWeight: "bold" };
              else if (isAbsent) rowStyle = { backgroundColor: "#f8d7da", fontWeight: "bold" };
              else if (isFriday) rowStyle = { backgroundColor: "#cff4fc" };
              if (isToday) rowStyle = { ...rowStyle, border: "2px solid #ff9800" };

              return (
                <tr key={idx} style={rowStyle}>
                  <td>{att.EmployeeName}</td>
                  <td>{att.PunchDate}</td>
                  <td>{att.InTime}</td>
                  <td>{att.OutTime}</td>
                  <td>{att.OvertimeHours}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
