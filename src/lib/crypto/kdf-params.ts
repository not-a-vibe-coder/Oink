export const KDF_V1 = { alg: "argon2id", v: 19, m: 65536, t: 3, p: 1, len: 32 } as const;

/**
 * Widened on purpose: a wallet records the parameters it was created with, so an
 * older wallet can hand back its own cost settings and still derive correctly.
 */
export type KdfParams = {
  alg: string;
  v: number;
  m: number;
  t: number;
  p: number;
  len: number;
};
