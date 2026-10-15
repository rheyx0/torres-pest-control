// Booking a warranty's checkups, or a warranty re-treatment (Sprint 5,
// migration 078), from the warranty's own buttons (WarrantyActions). The
// fields are WarrantyBookingForm, the same ones New appointment shows.

import { useState } from "react";
import { Button, Modal } from "../ui";
import { formatDate } from "../../utils/formatters";
import { warrantyLabel } from "../../utils/warranty";
import WarrantyBookingForm from "./WarrantyBookingForm";

function WarrantyBookingModal({ kind, warranty, dates = [], appointments = [], technicians = [], serviceNames = [], onBook, onClose }) {
  const checkup = kind === "CHECKUP";
  const [saving, setSaving] = useState(false);

  return (
    <Modal
      title={checkup ? "Book checkups" : "Warranty re-treatment"}
      eyebrow={`${warranty.reference} · warranty ${warrantyLabel(warranty.months)} until ${formatDate(`${warranty.end}T00:00:00`)}`}
      size="md"
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="warranty-booking-form" loading={saving}>{checkup ? "Book checkups" : "Book re-treatment"}</Button>
        </>
      )}
    >
      <WarrantyBookingForm
        formId="warranty-booking-form"
        kind={kind}
        warranty={warranty}
        dates={dates}
        appointments={appointments}
        technicians={technicians}
        serviceNames={serviceNames}
        onBook={onBook}
        onSavingChange={setSaving}
      />
    </Modal>
  );
}

export default WarrantyBookingModal;
