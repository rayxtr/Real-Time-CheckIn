import { Routes, Route } from "react-router-dom";
import TodayPunches from "./TodayPunches";
import AttendanceDashboard from "./AttendanceDashboard";

function App() {
  return (
    <Routes>
      <Route path="/" element={<TodayPunches />} />
       <Route path="/attendance-dashboard" element={<AttendanceDashboard />} />
    </Routes>
  );
}

export default App;
