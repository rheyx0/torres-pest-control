// The printable service form.
//
// Rendered off-screen and revealed only by the print stylesheet in
// styles/globals.css, which hides the rest of the app. Printing this way rather
// than with a PDF library means photos, page breaks and text wrapping are the
// browser's problem rather than ours, and it avoids a library choking on the
// short-lived signed URLs the attachments use.
//
// The person printing picks "Save as PDF" in the browser's print dialog.

import { COMPANY } from "../../utils/constants";
import { formatDate, formatDateTime } from "../../utils/formatters";

function Row({ label, value }) {
  return (
    <tr>
      <th className="sf-key">{label}</th>
      <td className="sf-val">{value || "—"}</td>
    </tr>
  );
}

function Block({ title, children }) {
  return (
    <section className="sf-block">
      <h2 className="sf-h2">{title}</h2>
      <div className="sf-prose">{children || "Not recorded."}</div>
    </section>
  );
}

function ServiceReportDocument({ appointment, client, technician, inventory = [], photos = [], signatureUrl = "", technicianSignatureUrl = "", treatmentMethodsLookup = [] }) {
  if (!appointment || !client) return null;

  const materials = appointment.stockUsed || [];
  const inventoryById = new Map(inventory.map((item) => [item.id, item]));
  const methods = (appointment.treatmentMethods || [])
    .map((value) => {
      const found = treatmentMethodsLookup.find((method) => method.value === value);
      return found?.label || value;
    })
    .filter(Boolean);
  // The report identifies the technician by name only; the internal reference
  // id is deliberately left off the printed form.
  const technicianName = technician?.name || technician?.username || "Unassigned";

  return (
    <div className="service-form" id="service-form-print">
      <header className="sf-head">
        <img className="sf-logo" src={COMPANY.logo} alt="" />
        <div className="sf-org">
          <div className="sf-org-name">{COMPANY.name}</div>
          <div className="sf-org-line">{COMPANY.address}</div>
          <div className="sf-org-line">{COMPANY.phone} · {COMPANY.email}</div>
          <div className="sf-org-line">License no. {COMPANY.licenseNo}</div>
        </div>
        <div className="sf-doc">
          <div className="sf-doc-title">Service Report</div>
          <div className="sf-doc-ref">{appointment.id.slice(0, 8).toUpperCase()}</div>
        </div>
      </header>

      <table className="sf-meta">
        <tbody>
          <Row label="Client" value={[client.reference, client.name].filter(Boolean).join(" — ")} />
          <Row label="Service address" value={appointment.serviceLocation || client.address} />
          <Row label="Contact" value={[client.phone, client.email].filter(Boolean).join(" · ")} />
          <Row label="Date of service" value={formatDateTime(appointment.scheduledAt)} />
          <Row label="Service type" value={appointment.serviceType} />
          <Row label="Pest concern" value={appointment.pestConcern || client.pestConcern} />
          <Row label="Technician" value={technicianName} />
        </tbody>
      </table>

      <Block title="Inspection findings">{appointment.report}</Block>
      <section className="sf-block">
        <h2 className="sf-h2">Treatment performed</h2>
        {methods.length > 0 && (
          <ul className="sf-methods">
            {methods.map((label) => <li key={label}>{label}</li>)}
          </ul>
        )}
        {appointment.treatmentPerformed && <div className="sf-prose" style={{ marginTop: methods.length ? 6 : 0 }}>{appointment.treatmentPerformed}</div>}
        {methods.length === 0 && !appointment.treatmentPerformed && <div className="sf-prose">Not recorded.</div>}
      </section>

      <section className="sf-block">
        <h2 className="sf-h2">Materials used</h2>
        {materials.length === 0 ? (
          <div className="sf-prose">No materials recorded.</div>
        ) : (
          <table className="sf-materials">
            <thead>
              <tr><th className="sf-item">Item</th><th className="sf-num">Quantity out</th><th className="sf-num">Estimated value</th></tr>
            </thead>
            <tbody>
              {materials.map((entry, index) => (
                <tr key={`${entry.itemId}-${index}`}>
                  <td className="sf-item">{entry.name}{(entry.unit || entry.itemUnit) ? ` (${entry.unit || entry.itemUnit})` : ""}</td>
                  <td className="sf-num">{entry.amount ?? entry.quantity ?? "—"} {entry.unit || entry.itemUnit || ""}</td>
                  <td className="sf-num">{(() => {
                    const item = inventoryById.get(entry.itemId);
                    const amount = Number(entry.amount ?? entry.quantity) || 0;
                    const value = amount * (Number(item?.cost) || 0);
                    return item?.cost !== undefined && item?.cost !== null ? `₱${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
                  })()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {appointment.recommendations && <Block title="Recommendations">{appointment.recommendations}</Block>}

      <section className="sf-block">
        <h2 className="sf-h2">Follow-up</h2>
        <div className="sf-prose">
          {appointment.followUpDate
            ? `Scheduled for ${formatDate(appointment.followUpDate)}.`
            : "No follow-up scheduled."}
        </div>
      </section>

      {photos.length > 0 && (
        <section className="sf-block sf-photos-block">
          <h2 className="sf-h2">Photographic record</h2>
          <div className="sf-photos">
            {photos.map((photo) => (
              <figure className="sf-photo" key={photo.id}>
                <img src={photo.url} alt={photo.name} />
                <figcaption>{photo.categoryLabel} · {formatDate(photo.uploadedAt)}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      <section className="sf-sign">
        <h2 className="sf-h2">Completion confirmation</h2>
        {appointment.signaturePath ? (
          <div className="sf-sign-grid">
            <div className="sf-sign-box">
              {/* The signature link is short-lived. If it failed to resolve the
                  confirmation is still real, so print the name and date rather
                  than implying the visit was never confirmed. */}
              {signatureUrl
                ? <img src={signatureUrl} alt="Customer signature" />
                : <div className="sf-sign-missing">Signature on file — image unavailable</div>}
              <div className="sf-sign-rule" />
              <div className="sf-sign-name">{appointment.customerName || "Customer"}</div>
              <div className="sf-sign-cap">Customer signature</div>
            </div>
            <div className="sf-sign-when">
              Signed {appointment.signedAt ? formatDateTime(appointment.signedAt) : ""}
              <div className="sf-sign-note">
                The customer confirmed the service described above was performed.
              </div>
            </div>
          </div>
        ) : appointment.completionNote ? (
          <div className="sf-prose">
            <strong>Completed without a customer signature.</strong>
            <div>{appointment.completionNote}</div>
          </div>
        ) : (
          <div className="sf-sign-grid">
            <div className="sf-sign-box sf-sign-blank">
              <div className="sf-sign-rule" />
              <div className="sf-sign-cap">Customer signature</div>
            </div>
            <div className="sf-sign-when">Not yet confirmed.</div>
          </div>
        )}
        <div className="sf-sign-grid sf-sign-tech">
          <div className={appointment.technicianSignaturePath ? "sf-sign-box" : "sf-sign-box sf-sign-blank"}>
            {appointment.technicianSignaturePath && (technicianSignatureUrl
              ? <img src={technicianSignatureUrl} alt="Technician signature" />
              : <div className="sf-sign-missing">Signature on file — image unavailable</div>)}
            <div className="sf-sign-rule" />
            <div className="sf-sign-name">{technicianName}</div>
            <div className="sf-sign-cap">Technician signature</div>
          </div>
          {appointment.technicianSignedAt && (
            <div className="sf-sign-when">Signed {formatDateTime(appointment.technicianSignedAt)}</div>
          )}
        </div>
      </section>

      <footer className="sf-foot">
        {COMPANY.name} · Report generated {formatDateTime(new Date().toISOString())}
      </footer>
    </div>
  );
}

export default ServiceReportDocument;
