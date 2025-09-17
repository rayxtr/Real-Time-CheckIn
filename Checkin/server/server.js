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
// API to fetch punches for a given date (default: today)
// API to fetch punches for a given date (default: today)
// API to fetch punches for a given date (default: today)
app.get("/api/today-punches", async (req, res) => {
  try {
    const { date } = req.query; // expected format: YYYY-MM-DD
    const pool = await poolPromise;

    const query = `
DECLARE @sql NVARCHAR(MAX);
DECLARE @targetDate DATE = ${date ? `'${date}'` : "CAST(GETDATE() AS DATE)"};

SET @sql = '';
SELECT @sql = @sql + 
    'SELECT UserId, LogDate FROM ' + QUOTENAME(TABLE_NAME) + ' UNION ALL '
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_NAME LIKE 'DeviceLogs[_]%';

SET @sql = LEFT(@sql, LEN(@sql) - 10);

SET @sql = '
WITH AllDeviceLogs AS (
    ' + @sql + '
),
DayLogs AS (
    SELECT 
        d.UserId,
        d.LogDate
    FROM AllDeviceLogs d
    WHERE CAST(d.LogDate AS DATE) = @targetDate
),
Aggregated AS (
    SELECT 
        dl.UserId,
        MIN(dl.LogDate) AS FirstPunch,
        MAX(dl.LogDate) AS LastPunch
    FROM DayLogs dl
    GROUP BY dl.UserId
)
SELECT 
    e.EmployeeId,
    e.EmployeeName,
    e.NumericCode AS EmployeeNumericCode,
    @targetDate AS AttendanceDate,
    CONVERT(VARCHAR(20), a.FirstPunch, 120) AS InTime,
    CASE 
        WHEN a.FirstPunch <> a.LastPunch 
        THEN CONVERT(VARCHAR(20), a.LastPunch, 120) 
        ELSE NULL 
    END AS OutTime
FROM Employees e
LEFT JOIN Aggregated a
    ON e.EmployeeCodeInDevice = a.UserId
ORDER BY e.EmployeeId;
';

EXEC sp_executesql @sql, N'@targetDate DATE', @targetDate=@targetDate;
`;

    const result = await pool.request().query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error("Error fetching punches:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


// Get list of employees (for the employee selector)
// Get list of employees (for the employee selector)
// server.js
app.get("/api/employees-list", async (req, res) => {
  try {
    const pool = await poolPromise;

    const result = await pool.request().query(`
      SELECT EmployeeId, EmployeeName, NumericCode, EmployeeCodeInDevice
      FROM Employees
      ORDER BY EmployeeName
    `);
        
    res.json(result.recordset); // return as array
  } catch (err) {
    console.error("Error fetching employees list:", err);
    res.status(500).json({ error: "Failed to fetch employees" });
  }
});



// Get attendance for a date range for a specific employee (date strings: 'YYYY-MM-DD')
// Attendance range (weekly / monthly with overtime)
// Get attendance for a date range for a specific employee (weekly / monthly with overtime)
app.get("/api/attendance-range", async (req, res) => {
  try {
    const { startDate, endDate, employeeId } = req.query;

    if (!employeeId) {
      return res.status(400).json({ error: "Employee selection is required" });
    }
    if (!startDate || !endDate) {
      return res.status(400).json({ error: "Start and end date are required" });
    }

    const pool = await poolPromise;

    // Build dynamic SQL for union of all DeviceLogs tables
    let unionSql = '';
    const tables = await pool.request().query(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME LIKE 'DeviceLogs[_]%'
    `);

    tables.recordset.forEach((tbl) => {
      unionSql += `SELECT d.UserId, d.LogDate FROM [${tbl.TABLE_NAME}] d 
                  WHERE d.LogDate >= '${startDate}' AND d.LogDate < DATEADD(DAY, 1, '${endDate}')
 
                   UNION ALL\n`;
    });

    // Remove last UNION ALL
    unionSql = unionSql.trim();
    if (unionSql.endsWith('UNION ALL')) {
      unionSql = unionSql.slice(0, -9);
    }

    const query = `
WITH AllDeviceLogs AS (
  ${unionSql}
),
DateRange AS (
  SELECT CAST('${startDate}' AS DATE) AS PunchDate
  UNION ALL
  SELECT DATEADD(DAY, 1, PunchDate) 
  FROM DateRange 
  WHERE PunchDate < CAST('${endDate}' AS DATE)
    AND DATEADD(DAY, 1, PunchDate) <= CAST(GETDATE() AS DATE)
),
DayLogs AS (
  SELECT 
    d.UserId,
    CAST(d.LogDate AS DATE) AS PunchDate,
    d.LogDate
  FROM AllDeviceLogs d
  WHERE d.UserId = (SELECT EmployeeCodeInDevice FROM Employees WHERE EmployeeId = ${employeeId})
),
Aggregated AS (
  SELECT 
    dr.PunchDate,
    MIN(dl.LogDate) AS InTime,
    MAX(dl.LogDate) AS OutTime
  FROM DateRange dr
  LEFT JOIN DayLogs dl ON dl.PunchDate = dr.PunchDate
  GROUP BY dr.PunchDate
)
SELECT 
  e.EmployeeId,
  e.EmployeeName,
  CONVERT(VARCHAR(10), a.PunchDate, 120) AS PunchDate,
  
  -- InTime logic
  CASE 
    WHEN DATENAME(WEEKDAY, a.PunchDate) = 'Friday' AND a.InTime IS NULL THEN 'Holiday'
    WHEN a.InTime IS NULL THEN 'Leave / Absent'
    ELSE CONVERT(VARCHAR(5), a.InTime, 108)
  END AS InTime,
  
  -- OutTime logic
  CASE 
    WHEN DATENAME(WEEKDAY, a.PunchDate) = 'Friday' AND a.OutTime IS NULL THEN 'Holiday'
    WHEN a.OutTime IS NULL THEN CASE WHEN a.InTime IS NULL THEN 'Leave / Absent' ELSE NULL END
    ELSE CONVERT(VARCHAR(5), a.OutTime, 108)
  END AS OutTime,
  
  -- Overtime calculation
  CASE
    -- Friday punch: double total hours
    WHEN DATENAME(WEEKDAY, a.PunchDate) = 'Friday' AND a.InTime IS NOT NULL AND a.OutTime IS NOT NULL THEN
        CAST((DATEDIFF(MINUTE, a.InTime, a.OutTime) * 2) / 60 AS VARCHAR) + ' hour ' +
        CAST((DATEDIFF(MINUTE, a.InTime, a.OutTime) * 2) % 60 AS VARCHAR) + ' minutes'
    
    -- Normal overtime after 18:00
    WHEN a.OutTime > DATEADD(hour, 18, CAST(a.PunchDate AS DATETIME)) THEN
        CAST(DATEDIFF(MINUTE, DATEADD(hour, 18, CAST(a.PunchDate AS DATETIME)), a.OutTime)/60 AS VARCHAR) + ' hour ' +
        CAST(DATEDIFF(MINUTE, DATEADD(hour, 18, CAST(a.PunchDate AS DATETIME)), a.OutTime) % 60 AS VARCHAR) + ' minutes'
    
    ELSE '0 minutes'
  END AS OvertimeHours

FROM Aggregated a
INNER JOIN Employees e ON e.EmployeeId = ${employeeId}
ORDER BY a.PunchDate
OPTION (MAXRECURSION 0);

`;


    const result = await pool.request().query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error("Error fetching attendance range:", err);
    res.status(500).json({ error: "Failed to fetch attendance range" });
  }
});


// ---------------- Start Server ----------------
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
