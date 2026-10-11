const images = {
  pig: "/illustrations/pig_3d.webp",
  received: "/illustrations/money_with_wings_3d.webp",
  bell: "/illustrations/bell_3d.webp",
  passed: "/illustrations/check_mark_button_3d.webp",
  deferred: "/illustrations/hourglass_done_3d.webp",
} as const;
export function Illustration({ kind, alt = "" }: { kind: keyof typeof images; alt?: string }) {
  return (
    <img
      className="illustration"
      src={images[kind]}
      alt={alt}
      width={512}
      height={512}
      loading="lazy"
      decoding="async"
    />
  );
}
