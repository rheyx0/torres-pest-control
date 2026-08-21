// Full client profile: read-only summary, edit form, and documents.
//
// Sprint AC (View Single Client Profile): "Detail view displays full client
// information, classification, and attached documents" and "Staff can
// navigate back to the list or edit the profile from this view." Back
// navigation was missing entirely — the old page imported only useParams,
// with no Link anywhere.

import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import ClientForm from "./ClientForm";
import ClientDocuments from "./ClientDocuments";
import InfoRow from "../common/InfoRow";
import PageHeader from "../common/PageHeader";
import { formatDateTime, humanizeEnum } from "../../utils/formatters";
import { card, colors, pageShell } from "../../styles/theme";

function ClientDetails({
  client,
  canEdit,
  onSave,
  onUploadDocument,
  onRemoveDocument,
  onResolveDocumentUrl,
}) {
  return (
    <div style={pageShell}>
      <PageHeader
        eyebrow="Client Profile"
        title={client.name}
        actions={
          <Link
            to="/clients"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              color: colors.brandInk,
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            <ArrowLeft size={16} /> Back to Client Profiles
          </Link>
        }
      />

      {/* AC (View Single Client Profile): "Detail view displays full client
          information, classification, and attached documents." */}
      <section style={{ ...card, marginBottom: "1.5rem", padding: "1.35rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
          <div>
            <p style={{ margin: 0, color: colors.brandInk, fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase" }}>Client record</p>
            <h2 style={{ margin: "0.25rem 0 0", color: colors.ink, fontSize: "1.25rem" }}>Profile overview</h2>
          </div>
          <span style={{ color: colors.muted, fontSize: "0.78rem" }}>Updated {formatDateTime(client.updatedAt)}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
          <InfoRow
            label="Classification"
            value={
              client.classification === "OTHER" && client.classificationOther
                ? client.classificationOther
                : humanizeEnum(client.classification)
            }
          />
          <InfoRow label="Pest Concern" value={client.pestConcern} />
          <InfoRow label="Source" value={client.source} />
          <InfoRow label="Phone" value={client.phone} />
          <InfoRow label="Email" value={client.email} />
          <div style={{ gridColumn: "1 / -1" }}><InfoRow label="Address" value={client.address} /></div>
          {/* AC (Edit Client Profile): "Edit history/timestamp is logged." */}
          <InfoRow label="Created" value={formatDateTime(client.createdAt)} />
          <InfoRow label="Last Updated" value={formatDateTime(client.updatedAt)} />
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.5rem" }}>
        <div style={card}>
          <ClientDocuments
            documents={client.documents || []}
            canEdit={canEdit}
            onUpload={onUploadDocument}
            onRemove={onRemoveDocument}
            onResolveUrl={onResolveDocumentUrl}
          />
        </div>

        <div style={card}>
          <h2 style={{ marginTop: 0, marginBottom: "1rem", color: colors.body }}>Client Information</h2>
          {/* AC: "Staff can navigate back to the list or edit the profile from
              this view." Everything above is read-only; editing happens here. */}
          {canEdit ? (
            <ClientForm initialValues={client} onSubmit={onSave} submitLabel="Save Changes" />
          ) : (
            <p style={{ margin: 0, color: colors.muted, lineHeight: 1.6 }}>
              Your role has view-only access to client profiles. The full details are shown above.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default ClientDetails;
