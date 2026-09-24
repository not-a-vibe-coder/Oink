import { KeyRound } from "lucide-react";
import { useState } from "react";
import { CopyButton } from "@/components/oink/CopyButton";
import { QrCode } from "@/components/oink/QrCode";

const STORE_LINKS = {
  appStore: "https://apps.apple.com/app/google-authenticator/id388497605",
  googlePlay: "https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2",
};

/**
 * Handing the TOTP secret to an authenticator, whichever device this is.
 *
 * A QR code only works when the authenticator is on a *different* device from the screen.
 * On a phone it is on the same one, so the otpauth:// link is the way in: tapping it opens
 * whatever app registered the scheme (Google or Microsoft Authenticator, iOS Passwords)
 * with Oink already filled in. Which layout leads is decided in CSS by `pointer: coarse`,
 * not by sniffing, so nothing reflows after hydration.
 *
 * The link carries the secret exactly as the QR does. It goes browser → app on the device
 * and never over the network; `otpauthuri` is on the API's redaction list all the same.
 */
export function AuthenticatorSetup({
  uri,
  secret,
  qrAlt,
}: {
  uri: string;
  secret: string;
  qrAlt: string;
}) {
  const [showQr, setShowQr] = useState(false);

  return (
    <div className="authn-setup">
      <div className="authn-direct">
        <a href={uri} className="btn btn-primary btn-block">
          <KeyRound size={16} aria-hidden="true" />
          <span>Add to authenticator</span>
        </a>
        <p className="meta">
          Opens your authenticator app with Oink filled in. Come back here with the 6-digit code it
          shows.
        </p>
      </div>

      <div className="authn-qr" data-shown={showQr || undefined}>
        <QrCode value={uri} alt={qrAlt} />
      </div>

      <div className="row-between">
        <div style={{ minWidth: 0 }}>
          <p className="eyebrow">Or enter this key</p>
          <p className="mono" style={{ marginTop: 4 }}>
            {secret}
          </p>
        </div>
        <CopyButton value={secret} label="Copy key" />
      </div>

      <div className="authn-direct authn-help">
        <p className="meta">
          Nothing opened? Get Google Authenticator from the{" "}
          <a href={STORE_LINKS.appStore} className="link" target="_blank" rel="noreferrer">
            App Store
          </a>{" "}
          or{" "}
          <a href={STORE_LINKS.googlePlay} className="link" target="_blank" rel="noreferrer">
            Google Play
          </a>
          , or paste the key into the app you have.
        </p>
        <button
          type="button"
          className="link meta"
          aria-expanded={showQr}
          onClick={() => setShowQr((value) => !value)}
        >
          {showQr ? "Hide the QR code" : "Setting up on another device? Show a QR code"}
        </button>
      </div>
    </div>
  );
}
