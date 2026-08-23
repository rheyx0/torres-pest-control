// Single client profile route (/clients/:id).

import { Link, useParams } from "react-router-dom";
import ClientDetails from "../components/clients/ClientDetails";
import PageHeader from "../components/common/PageHeader";
import useAuth from "../hooks/useAuth";
import useClients from "../hooks/useClients";
import { useToast } from "../context/ToastContext";
import { SUBSYSTEMS } from "../utils/permissions";
import { card, colors, pageShell } from "../styles/theme";

function ClientDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { getClient, updateClient, addDocument, removeDocument, getDocumentUrl, loading } =
    useClients();
  const { showSuccess, showError } = useToast();

  const client = getClient(id);

  // Clients load asynchronously now, so an absent client during the initial
  // fetch is "not loaded yet", not "not found".
  if (!client && loading) {
    return (
      <div style={pageShell}>
        <div style={{ ...card, color: colors.muted }}>Loading client…</div>
      </div>
    );
  }

  if (!client) {
    return (
      <div style={pageShell}>
        <PageHeader eyebrow="Client Profile" title="Client not found" />
        <div style={card}>
          <p style={{ margin: "0 0 1rem", color: colors.muted }}>
            That client profile doesn't exist, or it was deleted.
          </p>
          <Link to="/clients" style={{ color: colors.brandInk, fontWeight: 700 }}>
            Back to Client Profiles
          </Link>
        </div>
      </div>
    );
  }

  const handleSave = async (form) => {
    const result = await updateClient(client.id, form);
    if (result === true) showSuccess("Client profile updated.");
    else showError(result);
  };

  const handleUpload = (file) => addDocument(client.id, file);
  const handleRemove = (document) => removeDocument(client.id, document);

  return (
    <ClientDetails
      client={client}
      canEdit={can(SUBSYSTEMS.CLIENTS, "edit")}
      canUploadDocuments={can(SUBSYSTEMS.CLIENT_DOCUMENTS, "create")}
      canRemoveDocuments={can(SUBSYSTEMS.CLIENT_DOCUMENTS, "delete")}
      onSave={handleSave}
      onUploadDocument={handleUpload}
      onRemoveDocument={handleRemove}
      onResolveDocumentUrl={getDocumentUrl}
    />
  );
}

export default ClientDetailPage;
