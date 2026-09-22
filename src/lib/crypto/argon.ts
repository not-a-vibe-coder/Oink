import { argon2id } from "hash-wasm";
import { KDF_V1, type KdfParams } from "./kdf-params";

export { KDF_V1 };

export async function deriveMaster(
  password: Uint8Array,
  salt: Uint8Array,
  params: KdfParams = KDF_V1,
  onProgress?: (progress: number) => void,
): Promise<Uint8Array> {
  if (typeof window !== "undefined" && typeof Worker !== "undefined") {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./argon.worker.ts", import.meta.url), {
        type: "module",
      });
      const id = Math.random().toString(36).slice(2);
      worker.onmessage = (event: MessageEvent) => {
        const msg = event.data;
        if (!msg || msg.id !== id) return;
        if (msg.type === "progress") {
          onProgress?.(msg.progress);
        } else if (msg.type === "result") {
          worker.terminate();
          resolve(new Uint8Array(msg.master));
        } else if (msg.type === "error") {
          worker.terminate();
          reject(new Error(msg.error));
        }
      };
      worker.onerror = (err) => {
        worker.terminate();
        reject(err);
      };
      worker.postMessage({ id, password, salt, params });
    });
  }

  return argon2id({
    password,
    salt,
    parallelism: params.p,
    iterations: params.t,
    memorySize: params.m,
    hashLength: params.len,
    outputType: "binary",
    onProgress,
  });
}
