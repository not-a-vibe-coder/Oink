import bs58 from "bs58";
import nacl from "tweetnacl";

export function verifySolanaSignature(params: {
  wallet: string;
  signature: string;
  message: string;
}): boolean {
  try {
    const pubkeyBytes = bs58.decode(params.wallet);
    const sigBytes = bs58.decode(params.signature);
    const msgBytes = new TextEncoder().encode(params.message);
    return nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);
  } catch {
    return false;
  }
}
