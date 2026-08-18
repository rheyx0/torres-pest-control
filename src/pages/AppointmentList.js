// MEMBER 3 & 4 - Appointment List + Search / Filter / Sort
// Props received from App.js: appointments (array), onDelete (function)

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { statusOptions, clientTypes } from "../data/mockData";

function AppointmentList({ appointments, onDelete }) {
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterType, setFilterType] = useState("All");
  const [sortBy, setSortBy] = useState("date");

  let filtered = appointments;

  return (
    <div>
      {/* code here */}
    </div>
  );
}

export default AppointmentList;
