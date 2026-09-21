// Drives printing of the service form.
//
// Two things have to happen before window.print() is called, or the form comes
// out wrong:
//
//   1. Attachment links are signed for 60 seconds, so the URLs must be minted
//      now rather than reused from whatever the panel already had.
//   2. Every image has to be decoded. print() does not wait for network, so
//      firing it early prints empty boxes where the photos should be.
//
// The document is portalled onto <body> so the print stylesheet can hide #root
// and leave this standing.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ServiceReportDocument from "./ServiceReportDocument";
import useTreatmentMethods from "../../hooks/useTreatmentMethods";
import { ATTACHMENT_CATEGORIES } from "../../utils/constants";

const categoryLabel = (value) =>
  ATTACHMENT_CATEGORIES.find((entry) => entry.value === value)?.label || "Photo";

/** Filesystem-safe: letters, digits and single dashes only. */
const slug = (value) => (value || "")
  .normalize("NFKD")
  .replace(/[^\w\s-]/g, "")
  .trim()
  .replace(/[\s_]+/g, "-")
  .replace(/-+/g, "-")
  .slice(0, 48);

/**
 * What the saved PDF is called. Leads with the client reference so the files
 * sort by client in a folder, then the name so a human can read it, then the
 * service date so repeat visits never collide.
 *
 *   TPC-C-0002_Arawan-Logistics-Center_SVF_2026-09-18.pdf
 *
 * Falls back to the appointment id when a client has no reference yet, which
 * is the case until migration 033 has been applied.
 */
function serviceFormFileName(appointment, client) {
  const reference = slug(client.reference) || `CLIENT-${appointment.clientId.slice(0, 8).toUpperCase()}`;
  const name = slug(client.name) || "client";
  const date = new Date(appointment.scheduledAt);
  const day = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  return `${reference}_${name}_SVF_${day}`;
}

function ServiceReportPrinter({ request, onDone, onProblem, getAttachmentUrl, getSignatureUrl }) {
  const [payload, setPayload] = useState(null);
  const hostRef = useRef(null);
  const { methods: treatmentMethodsLookup } = useTreatmentMethods();

  useEffect(() => {
    if (!request) {
      setPayload(null);
      return undefined;
    }

    let cancelled = false;
    const { appointment, client, technician, inventory = [] } = request;

    (async () => {
      // Images only, and only the ones that will actually render.
      const imageAttachments = (appointment.attachments || []).filter(
        (attachment) => (attachment.type || "").startsWith("image/")
          || /\.(jpe?g|png)$/i.test(attachment.name || "")
      );

      const photos = (
        await Promise.all(
          imageAttachments.map(async (attachment) => {
            const result = await getAttachmentUrl(attachment);
            return result?.url
              ? {
                id: attachment.id,
                name: attachment.name,
                uploadedAt: attachment.uploadedAt,
                categoryLabel: categoryLabel(attachment.category),
                url: result.url,
              }
              : null;
          })
        )
      ).filter(Boolean);

      let signatureUrl = "";
      if (appointment.signaturePath) {
        const result = await getSignatureUrl(appointment.signaturePath);
        signatureUrl = result?.url || "";
        // Silently omitting the signature would print a confirmed visit as
        // though nobody had signed it, so say what went wrong instead.
        if (!signatureUrl) {
          onProblem?.(`The signature could not be loaded for printing${result?.error ? `: ${result.error}` : "."}`);
        }
      }

      let technicianSignatureUrl = "";
      if (appointment.technicianSignaturePath) {
        const result = await getSignatureUrl(appointment.technicianSignaturePath);
        technicianSignatureUrl = result?.url || "";
        if (!technicianSignatureUrl) {
          onProblem?.(`The technician signature could not be loaded for printing${result?.error ? `: ${result.error}` : "."}`);
        }
      }

      const missingPhotos = imageAttachments.length - photos.length;
      if (missingPhotos > 0) {
        onProblem?.(`${missingPhotos} photo${missingPhotos === 1 ? "" : "s"} could not be loaded for printing.`);
      }

      if (!cancelled) {
        setPayload({
          appointment,
          client,
          technician,
          inventory,
          photos,
          signatureUrl,
          technicianSignatureUrl,
          fileName: serviceFormFileName(appointment, client),
        });
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, getAttachmentUrl, getSignatureUrl]);

  // Callers pass an inline arrow, so onDone's identity changes every render.
  // Holding it in a ref keeps it out of the effect's dependencies — otherwise
  // the effect re-ran constantly and a queued frame fired after the portal had
  // already unmounted, which is what threw "Cannot read properties of null".
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  // Once the document is in the DOM, wait for its images before printing.
  useEffect(() => {
    if (!payload) return undefined;

    let cancelled = false;

    const run = async () => {
      const host = hostRef.current;
      if (cancelled || !host) return;

      const images = Array.from(host.querySelectorAll("img"));
      await Promise.all(
        images.map((image) =>
          image.decode
            ? image.decode().catch(() => undefined)
            : new Promise((resolve) => {
              if (image.complete) resolve();
              else {
                image.addEventListener("load", resolve, { once: true });
                image.addEventListener("error", resolve, { once: true });
              }
            })
        )
      );

      if (cancelled || !hostRef.current) return;

      // "Save as PDF" takes its default filename from the document title, so
      // the file lands as the client's own reference rather than "localhost".
      const previousTitle = document.title;
      document.title = payload.fileName;

      const restore = () => { document.title = previousTitle; };
      window.addEventListener("afterprint", restore, { once: true });

      window.print();

      // Some browsers never fire afterprint; restore anyway.
      window.setTimeout(restore, 1000);
      onDoneRef.current?.();
    };

    // One frame so layout settles before the print engine takes its snapshot.
    const frame = requestAnimationFrame(run);
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [payload]);

  if (!payload) return null;

  return createPortal(
    <div className="service-form-host" ref={hostRef} aria-hidden="true">
      <ServiceReportDocument
        appointment={payload.appointment}
        client={payload.client}
        technician={payload.technician}
        inventory={payload.inventory}
        photos={payload.photos}
        signatureUrl={payload.signatureUrl}
        technicianSignatureUrl={payload.technicianSignatureUrl}
        treatmentMethodsLookup={treatmentMethodsLookup}
      />
    </div>,
    document.body
  );
}

export default ServiceReportPrinter;
