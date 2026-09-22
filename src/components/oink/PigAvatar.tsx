/**
 * A tag needs a face, or the send screen is just a string match.
 *
 * Line-drawn rather than illustrated, so it sits inside the same ink-on-paper
 * register as everything else, and derived entirely from `avatarSeed` so the
 * same tag draws the same pig on every device with no asset to fetch.
 */
const TINTS = ["#fdeaf0", "#f2eef0", "#f6f1ea", "#eef2f1", "#f1eff6", "#f7f0ee"];

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function PigAvatar({
  seed,
  size = 40,
  title,
}: {
  seed: string | null | undefined;
  size?: number;
  title?: string;
}) {
  const h = hash(seed || "oink");
  const tint = TINTS[h % TINTS.length];
  const pointedEars = (h >> 3) % 2 === 0;
  const wideSnout = (h >> 5) % 2 === 0;
  const happyEyes = (h >> 7) % 2 === 0;

  const snoutWidth = wideSnout ? 15 : 12;
  const snoutX = 24 - snoutWidth / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ display: "block", flex: "none", borderRadius: "50%" }}
    >
      <circle cx="24" cy="24" r="24" fill={tint} />
      <g
        fill="none"
        stroke="#171216"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {pointedEars ? (
          <>
            <path d="M13 17 L12 10 L19 13" />
            <path d="M35 17 L36 10 L29 13" />
          </>
        ) : (
          <>
            <path d="M13 16 C10 11 13 9 18 12" />
            <path d="M35 16 C38 11 35 9 30 12" />
          </>
        )}

        <path d="M24 12 C33 12 38 18 38 25 C38 32 32 37 24 37 C16 37 10 32 10 25 C10 18 15 12 24 12 Z" />

        <rect x={snoutX} y="24" width={snoutWidth} height="9" rx="4.5" />
        <path d={`M${24 - snoutWidth / 6} 28.5 v1.6`} />
        <path d={`M${24 + snoutWidth / 6} 28.5 v1.6`} />

        {happyEyes ? (
          <>
            <path d="M17 21 C18.2 19.8 19.8 19.8 21 21" />
            <path d="M27 21 C28.2 19.8 29.8 19.8 31 21" />
          </>
        ) : (
          <>
            <path d="M19 20.4 v1.4" />
            <path d="M29 20.4 v1.4" />
          </>
        )}
      </g>
    </svg>
  );
}
