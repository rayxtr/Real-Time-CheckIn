import React, { useEffect, useState } from "react";
import axios from "axios";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable"; // ✅ fixed import

export default function AttendanceDashboard() {
  const [employees, setEmployees] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [attendance, setAttendance] = useState([]);
  const [tab, setTab] = useState("monthly"); // monthly or weekly
  const [month, setMonth] = useState(""); // format YYYY-MM
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Fetch employee list
  useEffect(() => {
    axios
      .get("http://localhost:5000/api/employees-list")
      .then((res) => {
        if (Array.isArray(res.data)) setEmployees(res.data);
        else {
          setEmployees([]);
          console.error("Expected array, got:", res.data);
        }
      })
      .catch((err) => console.error(err));
  }, []);

  // Auto set weekEnd = weekStart + 6 days (clamp to today)
  useEffect(() => {
    if (tab === "weekly" && weekStart) {
      const start = new Date(weekStart);
      let end = new Date(start);
      end.setDate(start.getDate() + 6);

      const today = new Date();
      if (end > today) end = today;

      const formattedEnd = end.toISOString().split("T")[0];
      setWeekEnd(formattedEnd);
    }
  }, [weekStart, tab]);

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
      const [y, m] = month.split("-");
      const year = parseInt(y, 10);
      const monthNum = parseInt(m, 10);
      const lastDay = new Date(year, monthNum, 0).getDate();
      startDate = `${y}-${m.padStart(2, "0")}-01`;
      const today = new Date();
      const endOfMonth = new Date(year, monthNum - 1, lastDay);
      const finalEnd = endOfMonth > today ? today : endOfMonth;
      endDate = finalEnd.toISOString().split("T")[0];
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
      else {
        setAttendance([]);
        console.warn("Expected array, got:", res.data);
      }
    } catch (err) {
      console.error(err);
      setAttendance([]);
      setError("Failed to fetch attendance");
    } finally {
      setLoading(false);
    }
  };

  // Fetch attendance on dependency change
  useEffect(() => {
    fetchAttendance();
  }, [selectedEmployee, tab, month, weekStart, weekEnd]);

  // Generate PDF
  const generatePDF = () => {
  if (!attendance || attendance.length === 0) return;

  const doc = new jsPDF();
  const title = `Attendance Report (${tab === "monthly" ? "Monthly" : "Weekly"})`;
  doc.setFontSize(14);
  doc.text(title, 14, 15);

  const emp = employees.find((e) => e.EmployeeId === selectedEmployee);
  const empName = emp ? emp.EmployeeName.replace(/\s+/g, "_") : "Employee";

  const subtitle = `Employee: ${emp ? emp.EmployeeName : ""} | ${
    tab === "monthly" ? `Month: ${month}` : `From: ${weekStart} To: ${weekEnd}`
  }`;
  doc.setFontSize(11);
  doc.text(subtitle, 14, 22);

  const tableColumn = ["Employee Name", "Punch Date", "In Time", "Out Time", "Overtime Hours"];
  const tableRows = attendance.map((att) => [
    att.EmployeeName,
    att.PunchDate,
    att.InTime,
    att.OutTime,
    att.OvertimeHours,
  ]);

  const todayStr = new Date().toISOString().split("T")[0];

  autoTable(doc, {
    startY: 28,
    head: [tableColumn],
    body: tableRows,
    styles: { fontSize: 10 },
    headStyles: { fillColor: [22, 160, 133] },
    didParseCell: function (data) {
      if (data.row.section === "body" && data.row.cells[1].raw === todayStr) {
        data.cell.styles.fillColor = [255, 235, 205]; // light orange
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  // ✅ Filename based on monthly or weekly selection
  let filename = "";
  if (tab === "monthly") {
    filename = `${empName}_${month}_attendance.pdf`;
  } else {
    filename = `${empName}_${weekStart}-to-${weekEnd}_attendance.pdf`;
  }

  doc.save(filename);
};


  const todayStr = new Date().toISOString().split("T")[0];

  return (
    <div className="attendance-dashboard">
      <h1>📊 Attendance Dashboard</h1>

      {/* Tabs */}
      <div className="tabs">
        <button className={tab === "monthly" ? "active" : ""} onClick={() => setTab("monthly")}>
          Monthly
        </button>
        <button className={tab === "weekly" ? "active" : ""} onClick={() => setTab("weekly")}>
          Weekly
        </button>
      </div>

      {/* Filters */}
      <div className="filters">
        <label>
          Employee:{" "}
          <select value={selectedEmployee} onChange={(e) => setSelectedEmployee(e.target.value)}>
            <option value="">Select Employee</option>
            {(employees || []).map((emp) => (
              <option key={emp.EmployeeId} value={emp.EmployeeId}>
                {emp.EmployeeName}
              </option>
            ))}
          </select>
        </label>

        {tab === "monthly" && (
          <label>
            Month:{" "}
            <input
              type="month"
              value={month}
              max={new Date().toISOString().slice(0, 7)}
              onChange={(e) => setMonth(e.target.value)}
            />
          </label>
        )}

        {tab === "weekly" && (
          <>
            <label>
              Start Date:{" "}
              <input
                type="date"
                value={weekStart}
                max={todayStr}
                onChange={(e) => setWeekStart(e.target.value)}
              />
            </label>
            <label>
              End Date: <input type="date" value={weekEnd} readOnly />
            </label>
          </>
        )}

        <button onClick={fetchAttendance}>Fetch</button>
      </div>

      {/* Print & PDF buttons */}
      <div className="report-buttons" style={{ margin: "10px 0" }}>
        <button onClick={() => window.print()}>Print</button>
        <button onClick={generatePDF}>Download PDF</button>
      </div>

      {/* Attendance Table */}
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
            {(attendance || []).map((att, idx) => {
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
