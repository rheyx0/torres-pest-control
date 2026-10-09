// Single client profile route (/clients/:id).

import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ClientDetails from "../components/clients/ClientDetails";
import ConfirmDialog from "../components/common/ConfirmDialog";
import PageHeader from "../components/common/PageHeader";
import Skeleton, { SkeletonBar } from "../components/ui/Skeleton";
import useAuth from "../hooks/useAuth";
import useClients from "../hooks/useClients";
import { useToast } from "../context/ToastContext";
import { useConfirm } from "../context/ConfirmContext";
import { SUBSYSTEMS } from "../utils/permissions";
import { card, colors, pageShell } from "../styles/theme";

function ClientDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { getClient, updateClient, deleteClient, archiveClient, restoreClient, addDocument, removeDocument, getDocumentUrl, loading } =
    useClients();
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();
  const confirm = useConfirm();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const client = getClient(id);

  // Clients load asynchronously now, so an absent client during the initial
  // fetch is "not loaded yet", not "not found".
  if (!client && loading) {
    return (
      <div style={pageShell}>
        <SkeletonBar width="220px" height="28px" style={{ marginBottom: "18px" }} />
        <div className="client-columns">
          <div style={{ ...card, padding: 0 }}><Skeleton label="Loading client…" lines={6} /></div>
          <div style={{ ...card, padding: 0 }}><Skeleton label="" lines={8} /></div>
        </div>
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
          <Link to="/clients" style={{ color: colors.brandInk, fontWeight: 500 }}>
            Back to Client Profiles
          </Link>
        </div>
      </div>
    );
  }

  const handleSave = async (form) => {
    if (!(await confirm({ title: `Save changes to ${client.name}?`, message: "The client's profile is updated. Their past visits, quotations and invoices are not changed.", confirmLabel: "Save changes" }))) return false;
    const result = await updateClient(client.id, form);
    if (result === true) {
      showSuccess("Client profile updated.");
      return true;
    }
    showError(result);
    return false;
  };

  const handleUpload = (file, category) => addDocument(client.id, file, category);
  const handleRemove = async (document) => {
    if (!(await confirm({ title: "Delete this document?", message: `"${document.name}" is removed from ${client.name}'s documents for good.`, confirmLabel: "Delete", tone: "danger" }))) return true;
    return removeDocument(client.id, document);
  };

  // Archive is the everyday way to retire a client: reversible, and the
  // history stays. Delete sits behind the "…" menu with a confirmation.
  const handleArchive = async () => {
    if (!(await confirm({ title: `Archive ${client.name}?`, message: "The client is hidden from lists and can't be booked. Their history stays, and they can be restored.", confirmLabel: "Archive", tone: "danger" }))) return;
    const result = await archiveClient(client.id);
    if (result !== true) {
      showError(result);
      return;
    }
    showSuccess(`${client.name} archived.`, {
      action: {
        label: "Undo",
        onClick: async () => {
          const undo = await restoreClient(client.id);
          if (undo !== true) showError(undo);
        },
      },
    });
  };

  const handleRestore = async () => {
    const result = await restoreClient(client.id);
    if (result === true) showSuccess(`${client.name} restored.`);
    else showError(result);
  };

  const handleDelete = async () => {
    setDeleteDialogOpen(false);
    const result = await deleteClient(client.id);
    if (result === true) {
      showSuccess("Client profile permanently deleted.");
      navigate("/clients");
    } else {
      showError(result);
    }
  };

  return (
    <>
      <ClientDetails
        client={client}
        canEdit={can(SUBSYSTEMS.CLIENTS, "edit")}
        canDelete={can(SUBSYSTEMS.CLIENTS, "delete")}
        canArchive={can(SUBSYSTEMS.CLIENTS, "archive")}
        canBook={can(SUBSYSTEMS.SCHEDULING, "create")}
        onArchive={handleArchive}
        onRestore={handleRestore}
        canUploadDocuments={can(SUBSYSTEMS.CLIENT_DOCUMENTS, "create")}
        canRemoveDocuments={can(SUBSYSTEMS.CLIENT_DOCUMENTS, "delete")}
        onSave={handleSave}
        onDelete={() => setDeleteDialogOpen(true)}
        onUploadDocument={handleUpload}
        onRemoveDocument={handleRemove}
        onResolveDocumentUrl={getDocumentUrl}
      />
      <ConfirmDialog
        open={deleteDialogOpen}
        title="Delete client permanently?"
        message={`Delete ${client.name} permanently? This action cannot be undone.`}
        confirmLabel="Delete permanently"
        cancelLabel="Keep client"
        tone="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteDialogOpen(false)}
      />
    </>
  );
}

export default ClientDetailPage;
