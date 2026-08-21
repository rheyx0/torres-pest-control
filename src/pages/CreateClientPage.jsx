// Create client profile route.

import { Link, useNavigate } from "react-router-dom";
import PageHeader from "../components/common/PageHeader";
import ClientForm from "../components/clients/ClientForm";
import useClients from "../hooks/useClients";
import { useToast } from "../context/ToastContext";
import { card, colors, pageShell } from "../styles/theme";

function CreateClientPage() {
  const navigate = useNavigate();
  const { addClient } = useClients();
  const { showSuccess, showError } = useToast();

  const handleSubmit = async (form) => {
    // addClient resolves to the created client, or an error string.
    const result = await addClient(form);

    if (typeof result === "string") {
      showError(result);
      return;
    }

    showSuccess(`Client profile created for ${result.name}.`);
    navigate(`/clients/${result.id}`);
  };

  return (
    <div style={pageShell}>
      <PageHeader eyebrow="Client Management" title="Create Client Profile" />
      <div style={card}>
        <ClientForm
          onSubmit={handleSubmit}
          submitLabel="Save Client"
          footer={
            <Link to="/clients" style={{ color: colors.brandInk, textDecoration: "none", fontWeight: 700 }}>
              Back to Client Profiles
            </Link>
          }
        />
      </div>
    </div>
  );
}

export default CreateClientPage;
