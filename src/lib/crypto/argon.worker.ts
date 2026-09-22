import { argon2id } from "hash-wasm";
import { KDF_V1, type KdfParams } from "./kdf-params";

export type ArgonWorkerRequest = {
  id: string;
  password: Uint8Array;
  salt: Uint8Array;
  params?: KdfParams;
};

export type ArgonWorkerResponse =
  | { id: string; type: "progress"; progress: number }
  | { id: string; type: "result"; master: Uint8Array }
  | { id: string; type: "error"; error: string };

self.onmessage = async (event: MessageEvent<ArgonWorkerRequest>) => {
  const { id, password, salt, params = KDF_V1 } = event.data;
  try {
    const master = await argon2id({
      password,
      salt,
      parallelism: params.p,
      iterations: params.t,
      memorySize: params.m,
      hashLength: params.len,
      outputType: "binary",
      onProgress: (p: number) => {
        self.postMessage({ id, type: "progress", progress: p });
      },
    });
    // In web worker self.postMessage accepts transferables
    (self as any).postMessage({ id, type: "result", master }, [master.buffer]);
  } catch (err: unknown) {
    self.postMessage({ id, type: "error", error: err instanceof Error ? err.message : String(err) });
  }
};
