// Create-account route.
//
// Sprint AC: "Confirmation message is shown once account is successfully
// created." The old page navigated away silently with no message at all.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../components/common/PageHeader";
import UserForm from "../components/users/UserForm";
import useUsers from "../hooks/useUsers";
import { useToast } from "../context/ToastContext";
import { pageShell } from "../styles/theme";

function CreateUserPage() {
  const navigate = useNavigate();
  const { users, createAccount } = useUsers();
  const { showSuccess } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (role, fields) => {
    setSubmitting(true);
    const result = await createAccount(role, fields);
    setSubmitting(false);

    if (result === true) {
      // Toasts live above the router, so the confirmation survives this
      // navigation and is still visible on the list page.
      showSuccess(`Account created for ${fields.name}.`);
      navigate("/users");
      return true;
    }
    return result;
  };

  return (
    <div style={pageShell}>
      <PageHeader eyebrow="System Access" title="Create Account" />
      <UserForm accounts={users} onSubmit={handleSubmit} submitting={submitting} />
    </div>
  );
}

export default CreateUserPage;
