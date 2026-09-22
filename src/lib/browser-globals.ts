/**
 * @solana/web3.js v1, bs58 and the keystore helpers all assume a Node `Buffer`.
 * The browser has no such global, so provide one before any of them load.
 * Imported once from the router entry, which runs on both sides; on the server
 * the native Buffer is already there and this is a no-op.
 */
import { Buffer } from "buffer";

const globalScope = globalThis as typeof globalThis & { Buffer?: typeof Buffer };

if (!globalScope.Buffer) {
  globalScope.Buffer = Buffer;
}
