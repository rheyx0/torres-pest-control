// Book checkups and Warranty re-treatment for one warranty, wherever the
// office is looking at it: the client's Warranty box, the quotation, the
// contract, and the completed job on the Schedule. Shown only while the
// warranty runs; the server checks the dates again (078, 082).

import { useState } from "react";
import Button from "../ui/Button";
import WarrantyBookingModal from "./WarrantyBookingModal";
import { checkupDatesToBook, warrantyState } from "../../utils/warranty";
import { useToast } from "../../context/ToastContext";

const nextDay = (now, warranty) => {
  const day = new Date(now);
  day.setDate(day.getDate() + 1);
  const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  return key <= warranty.end ? key : warranty.end;
};

function WarrantyActions({ warranty, appointments = [], technicians = [], onBook, onBooked, now = new Date(), size = "sm" }) {
  const [booking, setBooking] = useState(null); // { kind, dates }
  const { showSuccess } = useToast();
  if (!warranty || !onBook || warrantyState(warranty, now) !== "ACTIVE") return null;
  const toBook = checkupDatesToBook(warranty, appointments, now);

  return (
    <>
      <span style={{ display: "inline-flex", gap: "8px", flexWrap: "wrap" }}>
        {warranty.frequency && (
          <Button size={size} onClick={() => setBooking({ kind: "CHECKUP", dates: toBook })}>
            Book checkups{toBook.length ? ` (${toBook.length})` : ""}
          </Button>
        )}
        <Button size={size} variant="secondary" onClick={() => setBooking({ kind: "RETREATMENT", dates: [nextDay(now, warranty)] })}>
          Warranty re-treatment
        </Button>
      </span>
      {booking && (
        <WarrantyBookingModal
          kind={booking.kind}
          warranty={warranty}
          dates={booking.dates}
          appointments={appointments}
          technicians={technicians}
          onClose={() => setBooking(null)}
          onBook={async (request) => {
            const result = await onBook(request);
            if (typeof result === "string") return result;
            setBooking(null);
            const count = Array.isArray(result) ? result.length : request.visits.length;
            showSuccess(request.kind === "CHECKUP" ? `${count} warranty checkup${count === 1 ? "" : "s"} booked, at no charge.` : "Warranty re-treatment booked, at no charge.");
            onBooked?.(request, result);
            return true;
          }}
        />
      )}
    </>
  );
}

export default WarrantyActions;
