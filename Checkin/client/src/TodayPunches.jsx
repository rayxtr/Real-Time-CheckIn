import React, { useEffect, useState } from "react";
import axios from "axios";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { useNavigate } from "react-router-dom";

import "./TodayPunches.css";

export default function TodayPunches() {
   const navigate = useNavigate();
  const [punches, setPunches] = useState([]);
  const [filteredPunches, setFilteredPunches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showLogin, setShowLogin] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0] // default: today (YYYY-MM-DD)
  );

  useEffect(() => {
    const fetchPunches = () => {
      fetch(`http://localhost:5000/api/today-punches?date=${selectedDate}`)
        .then((res) => res.json())
        .then((data) => {
          const filtered = (data || []).filter(
            (p) => String(p.EmployeeId) !== "1" && String(p.EmployeeId) !== "2"
          );

          const sorted = filtered.sort((a, b) =>
            (a.EmployeeName || "").localeCompare(b.EmployeeName || "")
          );

          setPunches(sorted);
          setFilteredPunches(sorted);
          setLoading(false);
        })
        .catch((err) => {
          console.error("Error fetching punches:", err);
          setLoading(false);
        });
    };

    fetchPunches();
    const interval = setInterval(fetchPunches, 5000);
    return () => clearInterval(interval);
  }, [selectedDate]); // 🔑 refetch whenever date changes

  const formatDate = (dateStr) => {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const formatTime = (dateStr) => {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    return d.toLocaleTimeString("en-GB", { hour12: false });
  };

  const formatForERP = (dateStr) => {
    const d = new Date(dateStr);
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0") +
      " " +
      String(d.getHours()).padStart(2, "0") +
      ":" +
      String(d.getMinutes()).padStart(2, "0") +
      ":" +
      String(d.getSeconds()).padStart(2, "0")
    );
  };

  const handlePostToERP = async () => {
    try {
      setMessage("⏳ Logging in and posting...");
      const loginRes = await axios.post("http://localhost:5000/api/login-erp", {
        username,
        password,
      });

      const loginMsg = loginRes.data?.message || loginRes.data || {};
      const { api_key, api_secret } = loginMsg;

      if (!api_key || !api_secret) {
        setMessage("❌ Wrong Username or Password!");
        return;
      }
      const token = `token ${api_key}:${api_secret}`;

      const empRes = await axios.post("http://localhost:5000/api/erp-employees", {
        token,
      });
      const employeeData = empRes.data?.data || [];

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const latitude = pos.coords.latitude;
          const longitude = pos.coords.longitude;

          for (const punch of punches) {
            const matched = employeeData.find((emp) => {
              if (!emp) return false;
              const possibleIds = [
                emp.user_id,
                emp.user,
                emp.attendance_device_id,
                emp.EmployeeCodeInDevice,
                emp.employee_code_in_device,
                emp.numeric_code,
                emp.name,
              ].filter(Boolean);

              return possibleIds.some(
                (id) => String(id) === String(punch.EmployeeId)
              );
            });

            if (!matched) {
              console.warn("No matched employee for device id:", punch.EmployeeId);
              continue;
            }

            if (punch.InTime) {
              const inData = {
                employee: matched.name,
                log_type: "IN",
                time: formatForERP(punch.InTime),
                latitude,
                longitude,
              };
              try {
                await axios.post("http://localhost:5000/api/erp-checkin", {
                  token,
                  data: inData,
                });
              } catch (err) {
                console.error(
                  "Failed to post IN for",
                  matched.name,
                  err.response?.data || err.message
                );
              }
            }

            if (punch.OutTime && punch.InTime) {
              const outData = {
                employee: matched.name,
                log_type: "OUT",
                time: formatForERP(punch.OutTime),
                latitude,
                longitude,
              };
              try {
                await axios.post("http://localhost:5000/api/erp-checkin", {
                  token,
                  data: outData,
                });
              } catch (err) {
                console.error(
                  "Failed to post OUT for",
                  matched.name,
                  err.response?.data || err.message
                );
              }
            }
          }

          setMessage("✅ Punches posted to ERP successfully!");
          setShowLogin(false);
        },
        (error) => {
          console.error("Location error:", error);
          setMessage("❌ Please enable location service on your PC.");
        }
      );
    } catch (error) {
      console.error("Error posting punches:", error.response?.data || error.message);
      setMessage("❌ Failed to post punches.");
    }
  };

  const handleSearch = (e) => {
    const value = e.target.value.toLowerCase();

    const filtered = punches.filter(
      (p) =>
        p.EmployeeName.toLowerCase().includes(value) ||
        String(p.EmployeeId).includes(value)
    );

    const sorted = filtered.sort((a, b) =>
      (a.EmployeeName || "").localeCompare(b.EmployeeName || "")
    );

    setFilteredPunches(sorted);
  };

  const handleDownloadPDF = async () => {
    const input = document.querySelector(".attendance-table");

    const canvas = await html2canvas(input, {
      scale: 2,
      useCORS: true,
    });

    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "mm", "a4");

    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();

    const imgProps = pdf.getImageProperties(imgData);
    const imgWidth = pdfWidth;
    const imgHeight = (imgProps.height * imgWidth) / imgProps.width;

    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pdfHeight;

    while (heightLeft > 0) {
      position -= pdfHeight;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pdfHeight;
    }

    pdf.save(`${selectedDate}_attendance_report.pdf`);
  };

  const handlePrint = () => {
    const printContent = document.querySelector(".attendance-table").outerHTML;
    const style = `
      <style>
        table {
          width: 100%;
          border-collapse: collapse;
          font-family: Arial, sans-serif;
        }
        th, td {
          border: 1px solid #ccc;
          padding: 8px;
          text-align: left;
        }
        th {
          background-color: #f2f2f2;
        }
        h1 {
          text-align: center;
        }
      </style>
    `;

    const win = window.open("", "PRINT", "height=650,width=900,top=100,left=150");
    win.document.write(`
      <html>
        <head>
          <title>Today's Attendance</title>
          ${style}
        </head>
        <body>
          <h1>📋 Attendance Register (${selectedDate})</h1>
          ${printContent}
        </body>
      </html>
    `);
    win.document.close();
    win.focus();

    win.onload = () => {
      win.print();
      win.close();
    };
  };

  if (loading) return <p className="no-data">Loading...</p>;

  return (
    
    <div className="attendance-container">
      <div className="attendance-card">
        <h1>📋 Attendance Register</h1>
  <button
          onClick={() => navigate("/attendance-dashboard")}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          Attendance Dashboard
        </button>
        <div className="tds">
          {/* 🔽 New date filter */}
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />

          <button className="preview-btn" onClick={handlePrint}>
            🖨️ Preview & Print
          </button>
          <button className="pdf-btn" onClick={handleDownloadPDF}>
            📄 Download PDF
          </button>
          <div className="search-bar">
            <input
              type="text"
              placeholder="Search employee..."
              onChange={handleSearch}
            />
          </div>
        </div>

        <table className="attendance-table">
          <thead>
            <tr>
              <th>Employee ID</th>
              <th>Employee Name</th>
              <th>Numeric Code</th>
              <th>In Time</th>
              <th>Out Time</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {filteredPunches.length === 0 && (
              <tr>
                <td colSpan={6} className="no-data">
                  No punches recorded
                </td>
              </tr>
            )}
            {filteredPunches.map((punch, index) => (
              <tr key={index}>
                <td>{punch.EmployeeId}</td>
                <td>{punch.EmployeeName}</td>
                <td>{punch.EmployeeNumericCode}</td>
                <td className="in-time">{formatTime(punch.InTime)}</td>
                <td className="out-time">{formatTime(punch.OutTime)}</td>
                <td>{formatDate(punch.AttendanceDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <button className="post-btn" onClick={() => setShowLogin(true)}>
          🚀 Post to ERP
        </button>

        {showLogin && (
          <div className="login-modal">
            <h3>🔐 ERP Login</h3>
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button onClick={handlePostToERP}>Login & Post</button>
            <button onClick={() => setShowLogin(false)}>Cancel</button>
          </div>
        )}

        {message && <p className="message">{message}</p>}
      </div>
    </div>
  );
}
