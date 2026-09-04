// MEMBER 6 - Edit Appointment Form
// Props received from App.js: appointments (array), onUpdate (function)

import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { clientTypes, pestTypes, statusOptions, technicians } from "../../data/mockData";

function EditAppointment({ appointments, onUpdate }) {
  const { id } = useParams();
  const navigate = useNavigate();

  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    // your code here
  }, [id, appointments, navigate]);

  const handleChange = (e) => {
    // your code here
  };

  const validate = () => {
    const newErrors = {};
    // your code here
    return newErrors;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // your code here
  };

  if (!form) return <p>Loading...</p>;

  return (
    <div>
      {/* code here */}
    </div>
  );
}

export default EditAppointment;
