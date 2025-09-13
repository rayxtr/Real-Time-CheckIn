const express = require("express");
const cors = require("cors");
const { poolPromise } = require("./db");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.send("Server is running");
});

// ---------------- ERP Proxy Routes ----------------

// Login & get ERP token
app.post("/api/login-erp", async (req, res) => {
  const { username, password } = req.body;
  try {
    const response = await axios.get(
      "https://firstgulf.accu360.cloud/api/method/daffy.core.doctype.user.user.get_keys",
      { params: { usr: username, pwd: password } }
    );
    res.json(response.data);
  } catch (error) {
    console.error("ERP login error:", error.response?.data || error.message);
    res.status(500).json({ error: "ERP login failed" });
  }
});

/**
 * Fetch all ERP employees (detailed)
 * - Expects { token } in body
 * - Returns: { data: [ { ...employee details... }, ... ] }
 */
app.post("/api/erp-employees", async (req, res) => {
  const { token } = req.body;
  try {
    // 1) get the list (this returns minimal rows with "name" usually)
    const listRes = await axios.get(
      "https://firstgulf.accu360.cloud/api/resource/Employee?limit_page_length=1000",
      {
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
      }
    );

    const list = listRes.data?.data || [];

    // 2) fetch details for each employee by name
    const detailPromises = list.map(async (item) => {
      // item might be a string or an object with .name
      const empName = typeof item === "string" ? item : item?.name || item?.employee || null;
      if (!empName) return null;

      try {
        const detailRes = await axios.get(
          `https://firstgulf.accu360.cloud/api/resource/Employee/${encodeURIComponent(empName)}`,
          {
            headers: {
              Authorization: token,
              "Content-Type": "application/json",
            },
          }
        );
        // Frappe returns the detailed record in detailRes.data.data
        return detailRes.data?.data || null;
      } catch (err) {
        console.error(`Failed to fetch Employee detail for ${empName}:`, err.response?.data || err.message);
        return null; // continue with others
      }
    });

    const detailed = (await Promise.all(detailPromises)).filter(Boolean);

    res.json({ data: detailed });
  } catch (error) {
    console.error("ERP employee fetch error:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to fetch employees" });
  }
});

// Post check-in/out
app.post("/api/erp-checkin", async (req, res) => {
  const { token, data } = req.body;
  try {
    const response = await axios.post(
      "https://firstgulf.accu360.cloud/api/resource/Employee Checkin",
      data,
      {
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error("ERP check-in error:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to post check-in" });
  }
});

// ---------------- SQL Attendance API ----------------

// API to fetch today's punches
app.get("/api/today-punches", async (req, res) => {
  try {
    const pool = await poolPromise;

    const query = `
DECLARE @sql NVARCHAR(MAX);

SET @sql = '';
SELECT @sql = @sql + 
    'SELECT UserId, LogDate, DeviceId FROM ' + QUOTENAME(TABLE_NAME) + ' UNION ALL '
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_NAME LIKE 'DeviceLogs[_]%';

SET @sql = LEFT(@sql, LEN(@sql) - 10); -- remove last 'UNION ALL'

SET @sql = '
WITH AllDeviceLogs AS (
    ' + @sql + '
),
RankedLogs AS (
    SELECT 
        d.UserId,
        d.LogDate,
        ROW_NUMBER() OVER(PARTITION BY d.UserId, CAST(d.LogDate AS DATE) ORDER BY d.LogDate ASC) AS rn
    FROM AllDeviceLogs d
    WHERE CAST(d.LogDate AS DATE) = CAST(GETDATE() AS DATE)
),
Punches AS (
    SELECT 
        e.EmployeeId,
        e.EmployeeName,
        e.NumericCode AS EmployeeNumericCode,
        CAST(GETDATE() AS DATE) AS AttendanceDate,
        MAX(CASE WHEN rn = 1 THEN CONVERT(VARCHAR(20), r.LogDate, 120) END) AS InTime,
        MAX(CASE WHEN rn = 2 THEN CONVERT(VARCHAR(20), r.LogDate, 120) END) AS OutTime
    FROM Employees e
    LEFT JOIN RankedLogs r
        ON e.EmployeeCodeInDevice = r.UserId
    GROUP BY 
        e.EmployeeId,
        e.EmployeeName,
        e.NumericCode
)
SELECT *
FROM Punches
ORDER BY EmployeeId;
';

EXEC sp_executesql @sql;
`;

    const result = await pool.request().query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error("Error fetching today's punches:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ---------------- Start Server ----------------
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
