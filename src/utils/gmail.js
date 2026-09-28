// Sending a document to a client through Gmail (Sprint 4).
//
// A web page cannot attach a file to a Gmail draft by itself, so "Send"
// opens a Gmail draft addressed to the client with the subject and message
// written, and opens "Save as PDF" for the document beside it; the office
// attaches the saved PDF and presses Send. Pure, unit-tested.

import { COMPANY } from "./constants";
import { formatPeso } from "./formatters";

const date = (value) => (value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" }) : "");

/** A Gmail "compose" link with the draft filled in. */
export function gmailComposeUrl({ to = "", subject = "", body = "" }) {
  const params = new URLSearchParams({ view: "cm", fs: "1", to, su: subject, body });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

/**
 * The subject and message for a document, by kind: QUOTE, INVOICE, CONTRACT
 * or RECEIPT. `record` is the quote, invoice, contract or payment.
 */
export function documentEmail(kind, record, client) {
  const greeting = `Good day${client?.name ? ` ${client.name}` : ""},`;
  const signOff = `\n\nThank you,\n${COMPANY.name}\n${COMPANY.phone} · ${COMPANY.email}`;
  const attached = "Please find it attached as a PDF.";
  switch (kind) {
    case "QUOTE":
      return {
        subject: `Quotation ${record.reference} from ${COMPANY.name}`,
        body: `${greeting}\n\nHere is our quotation ${record.reference} for ${formatPeso(record.total)}, valid until ${date(record.validUntil)}.${record.depositAmount > 0 ? ` A down payment of ${formatPeso(record.depositAmount)} is needed before we schedule the service.` : ""} ${attached}${signOff}`,
      };
    case "INVOICE":
      return {
        subject: `Invoice ${record.reference} from ${COMPANY.name}`,
        body: `${greeting}\n\nHere is invoice ${record.reference}. The amount due is ${formatPeso(record.amountDue)}, payable by ${date(record.dueOn)}. Please quote ${record.reference} with your payment. ${attached}${signOff}`,
      };
    case "CONTRACT":
      return {
        subject: `Service contract ${record.reference} for your signature`,
        body: `${greeting}\n\nHere is service contract ${record.reference} (${record.title}). Please review and sign it, then send us a scan or photo of the signed copy. ${attached}${signOff}`,
      };
    case "RECEIPT":
      return {
        subject: `Receipt ${record.reference} from ${COMPANY.name}`,
        body: `${greeting}\n\nThank you for your payment of ${formatPeso(record.amount)} on ${date(record.paidOn)}. Your receipt ${record.reference} is attached as a PDF.${signOff}`,
      };
    default:
      return { subject: COMPANY.name, body: `${greeting}${signOff}` };
  }
}
