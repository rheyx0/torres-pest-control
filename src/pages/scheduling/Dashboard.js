// MEMBER 1 & 2 - Dashboard
// Props received from App.js: appointments (array)

import React from "react";

function Dashboard({ appointments }) {

  const total = appointments.length;
  const pending = appointments.filter((a) => a.status === "Pending").length;
  const completed = appointments.filter((a) => a.status === "Completed").length;
  const inProgress = appointments.filter((a) => a.status === "In Progress").length;
  const cancelled = appointments.filter((a) => a.status === "Cancelled").length;
  const recentAppointments = appointments.slice(0, 5);

  return (
    <div>
      {/*code here*/}
    </div>
  );
}

export default Dashboard;
