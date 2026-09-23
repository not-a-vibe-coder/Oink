export type TotpUriOptions = { accountId: string; secret: string };

// Mirrors backend/src/lib/totp.ts: the entry is labelled with the account ID because it is
// created before any tag exists.
export function otpauthUri({ accountId, secret }: TotpUriOptions): string {
  return `otpauth://totp/Oink:${encodeURIComponent(accountId)}?secret=${secret}&issuer=Oink&algorithm=SHA1&digits=6&period=30`;
}
