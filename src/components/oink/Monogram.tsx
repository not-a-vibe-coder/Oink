/**
 * Assets are shown as their own initials in ink rather than a borrowed logo.
 * The icon is used when the registry has one, but the monogram is the default
 * so a screen of holdings stays quiet and the rail keeps the only colour.
 */
export function Monogram({
  symbol,
  iconUrl,
  size = 38,
}: {
  symbol: string;
  iconUrl?: string | null;
  size?: number;
}) {
  const initials = symbol.replace(/x$/i, "").slice(0, 4).toUpperCase();

  return (
    <span
      className="monogram"
      style={{ width: size, height: size, fontSize: initials.length > 3 ? 10 : 12 }}
      aria-hidden="true"
    >
      {iconUrl ? <img src={iconUrl} alt="" loading="lazy" /> : initials}
    </span>
  );
}
