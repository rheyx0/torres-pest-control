// Customer signature capture for a service report.
//
// Hand-rolled rather than pulling in a signature library: the repo carries no
// canvas dependency and this is ~100 lines.
//
// Three details do the real work here:
//   - Pointer events, not mouse/touch. One code path covers a finger, a stylus
//     and a mouse, which matters because this runs on the technician's phone
//     handed to the customer.
//   - touchAction: "none" on the canvas. Without it a finger scrolls the page
//     instead of drawing, which is the classic failure of a web signature pad.
//   - The backing store is sized to devicePixelRatio, so the line is crisp on a
//     phone instead of a blurry upscale.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Eraser, PenLine } from "lucide-react";
import { colors } from "../../styles/theme";

const PAD_HEIGHT = 170;

const SignaturePad = forwardRef(function SignaturePad({ onChange, disabled = false, height = PAD_HEIGHT }, ref) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const [hasInk, setHasInk] = useState(false);

  // Match the backing store to the element's real pixel size. Re-run on resize
  // because the panel this sits in is fluid.
  const prepareCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;

    // Resizing a canvas clears it, so preserve what is already drawn.
    const previous = hasInk ? canvas.toDataURL("image/png") : null;

    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);

    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineWidth = 2;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#0f172a";

    if (previous) {
      const image = new Image();
      image.onload = () => context.drawImage(image, 0, 0, rect.width, rect.height);
      image.src = previous;
    }
  }, [hasInk]);

  useEffect(() => {
    prepareCanvas();
    window.addEventListener("resize", prepareCanvas);
    return () => window.removeEventListener("resize", prepareCanvas);
  }, [prepareCanvas]);

  const pointAt = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const startStroke = (event) => {
    if (disabled) return;
    event.preventDefault();
    canvasRef.current.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastPointRef.current = pointAt(event);
  };

  const extendStroke = (event) => {
    if (!drawingRef.current) return;
    event.preventDefault();

    const context = canvasRef.current.getContext("2d");
    const point = pointAt(event);
    const from = lastPointRef.current;

    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(point.x, point.y);
    context.stroke();

    lastPointRef.current = point;
    if (!hasInk) setHasInk(true);
  };

  const endStroke = (event) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    if (canvasRef.current.hasPointerCapture?.(event.pointerId)) {
      canvasRef.current.releasePointerCapture(event.pointerId);
    }
    // A single tap leaves a dot but never fires pointermove, so confirm here.
    onChange?.(true);
  };

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    const ratio = window.devicePixelRatio || 1;
    context.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
    setHasInk(false);
    onChange?.(false);
  }, [onChange]);

  // The parent submits the form, so it needs to pull the image out on demand
  // rather than have every stroke pushed up as a blob.
  useImperativeHandle(ref, () => ({
    isEmpty: () => !hasInk,
    clear,
    /** The drawing as a PNG File, or null when nothing was drawn. */
    toFile: () => new Promise((resolve) => {
      const canvas = canvasRef.current;
      if (!canvas || !hasInk) {
        resolve(null);
        return;
      }
      // The .png name and image/png type both matter: validateAttachment checks
      // the extension and the MIME type, and the bucket whitelists image/png.
      canvas.toBlob(
        (blob) => resolve(blob ? new File([blob], "signature.png", { type: "image/png" }) : null),
        "image/png"
      );
    }),
  }), [hasInk, clear]);

  return (
    <div>
      <div
        style={{
          position: "relative",
          border: `1px solid ${hasInk ? colors.brand : "#dfe4ea"}`,
          borderRadius: "10px",
          background: disabled ? "#f8fafc" : "#ffffff",
          overflow: "hidden",
        }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={startStroke}
          onPointerMove={extendStroke}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={endStroke}
          style={{
            display: "block",
            width: "100%",
            height: `${height}px`,
            touchAction: "none",
            cursor: disabled ? "not-allowed" : "crosshair",
          }}
        />

        {!hasInk && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              pointerEvents: "none",
              color: colors.muted,
              fontSize: "0.8rem",
              gap: "0.3rem",
            }}
          >
            <PenLine size={18} />
            <span>{disabled ? "Signature locked" : "Customer signs here"}</span>
          </div>
        )}

        {/* Signing line, drawn under where the name goes. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "12%",
            right: "12%",
            bottom: "1.9rem",
            borderBottom: "1px dashed #cbd5e1",
            pointerEvents: "none",
          }}
        />
      </div>

      {!disabled && (
        <button
          type="button"
          onClick={clear}
          disabled={!hasInk}
          style={{
            marginTop: "0.5rem",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
            border: "1px solid #e2e8f0",
            background: "#f8fafc",
            color: colors.body,
            borderRadius: "8px",
            padding: "0.4rem 0.7rem",
            fontSize: "0.74rem",
            fontWeight: 700,
            cursor: hasInk ? "pointer" : "default",
            opacity: hasInk ? 1 : 0.5,
          }}
        >
          <Eraser size={13} /> Clear signature
        </button>
      )}
    </div>
  );
});

export default SignaturePad;
