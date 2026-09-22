export type TotpUriOptions = { tag: string; secret: string };

export function otpauthUri({ tag, secret }: TotpUriOptions): string {
  const cleanTag = tag.replace(/^[@$]/, "");
  return `otpauth://totp/Oink:%40${cleanTag}?secret=${secret}&issuer=Oink&algorithm=SHA1&digits=6&period=30`;
}
