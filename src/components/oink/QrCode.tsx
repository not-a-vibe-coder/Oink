import { useEffect, useState } from "react";

/**
 * Rendered in the browser from a URI the server supplied — the QR itself is
 * never an image request, so an address or an otpauth secret never travels to a
 * third party to be drawn.
 */
export function QrCode({ value, size = 244, alt }: { value: string; size?: number; alt: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    void (async () => {
      const QRCode = (await import("qrcode")).default;
      const url = await QRCode.toDataURL(value, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: size * 2,
        color: { dark: "#0a0a0aff", light: "#ffffffff" },
      });
      if (!cancelled) setDataUrl(url);
    })().catch(() => {
      // Most often the qrcode chunk 404ing in a tab opened before a redeploy. Say so and
      // offer a retry, rather than leaving a skeleton up forever.
      if (!cancelled) {
        setDataUrl(null);
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [value, size, attempt]);

  return (
    <div className="qr">
      {dataUrl ? (
        <img src={dataUrl} alt={alt} width={size} height={size} />
      ) : failed ? (
        <div className="qr-failed" style={{ width: size, height: size }}>
          <p className="meta">The QR code didn't load.</p>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
      ) : (
        <div className="skeleton" style={{ width: size, height: size, borderRadius: 8 }} />
      )}
    </div>
  );
}
