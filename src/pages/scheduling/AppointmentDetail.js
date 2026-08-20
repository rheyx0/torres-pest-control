// MEMBER 7 - Appointment Detail View
// Props received from App.js: appointments (array)

import React from "react";
import { useParams, useNavigate } from "react-router-dom";

function AppointmentDetail({ appointments }) {
  const { id } = useParams();
  const navigate = useNavigate();

  const appointment = null; // replace this with your logic

  if (!appointment) {
    return (
      <div>
        {/* show not found message and back button */}
      </div>
    );
  }

  return (
    <div>
      {/* code here */}
    </div>
  );
}

export default AppointmentDetail;
