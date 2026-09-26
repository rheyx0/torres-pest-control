// Prints a quote, invoice or receipt (BillingDocument) the way the service
// form is printed (ServiceReportPrinter): portalled onto <body>, where the
// print stylesheet shows it alone; the logo decoded first; the document title
// set so "Save as PDF" suggests a sensible file name.
//
//   TPC-C-0002_Ana-Cruz_TPC-INV-00003.pdf

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import BillingDocument from "./BillingDocument";

const slug = (value) => (value || "")
  .normalize("NFKD")
  .replace(/[^\w\s-]/g, "")
  .trim()
  .replace(/[\s_]+/g, "-")
  .replace(/-+/g, "-")
  .slice(0, 48);

/** The suggested PDF name: client reference, client name, document reference. */
export function billingFileName(request) {
  const reference = request.kind === "QUOTE" ? request.quote?.reference : request.kind === "INVOICE" ? request.invoice?.reference : request.payment?.reference;
  return [slug(request.client?.reference), slug(request.client?.name) || "client", reference].filter(Boolean).join("_");
}

function BillingPrinter({ request, onDone }) {
  const hostRef = useRef(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    if (!request) return undefined;
    let cancelled = false;

    const run = async () => {
      const host = hostRef.current;
      if (cancelled || !host) return;
      await Promise.all(Array.from(host.querySelectorAll("img")).map((image) => (image.decode ? image.decode().catch(() => undefined) : undefined)));
      if (cancelled || !hostRef.current) return;

      const previousTitle = document.title;
      document.title = billingFileName(request);
      const restore = () => { document.title = previousTitle; };
      window.addEventListener("afterprint", restore, { once: true });
      window.print();
      window.setTimeout(restore, 1000);
      onDoneRef.current?.();
    };

    const frame = requestAnimationFrame(run);
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [request]);

  if (!request) return null;
  return createPortal(
    <div className="service-form-host" ref={hostRef} aria-hidden="true">
      <BillingDocument {...request} />
    </div>,
    document.body
  );
}

export default BillingPrinter;
