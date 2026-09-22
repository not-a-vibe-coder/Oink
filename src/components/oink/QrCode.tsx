import { useEffect, useState } from "react";

/**
 * Rendered in the browser from a URI the server supplied — the QR itself is
 * never an image request, so an address or an otpauth secret never travels to a
 * third party to be drawn.
 */
export function QrCode({ value, size = 244, alt }: { value: string; size?: number; alt: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
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
      if (!cancelled) setDataUrl(null);
    });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return (
    <div className="qr">
      {dataUrl ? (
        <img src={dataUrl} alt={alt} width={size} height={size} />
      ) : (
        <div className="skeleton" style={{ width: size, height: size, borderRadius: 8 }} />
      )}
    </div>
  );
}
