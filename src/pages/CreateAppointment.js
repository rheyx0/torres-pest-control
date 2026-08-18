// MEMBER 5 - Create Appointment Form
// Props received from App.js: onAdd (function)

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { clientTypes, pestTypes, statusOptions, technicians } from "../data/mockData";

function CreateAppointment({ onAdd }) {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    clientName: "",
    address: "",
    clientType: "",
    pestType: "",
    status: "Pending",
    date: "",
    time: "",
    technician: "",
    contactNumber: "",
    notes: "",
  });

  const [errors, setErrors] = useState({});

  const handleChange = (e) => {
    // code here
  };

  const validate = () => {
    const newErrors = {};
    // code here
    return newErrors;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // code here
  };

  return (
    <div>
      {/* code here */}
    </div>
  );
}

export default CreateAppointment;
