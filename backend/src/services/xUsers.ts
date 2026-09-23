import { getConfig } from "../config";

/**
 * Resolves an X username to its numeric user ID. Privy needs the ID to create a user for an
 * X account ahead of sign-up, and usernames can be renamed while IDs cannot. Without an X
 * API bearer token this returns "unavailable", and paying an X account that is not on Oink
 * is refused with that reason.
 */
export async function lookupXUser(
  username: string,
): Promise<{ status: "found"; id: string; username: string } | { status: "not_found" } | { status: "unavailable" }> {
  const token = getConfig().xBearerToken;
  if (!token) return { status: "unavailable" };
  try {
    const res = await fetch(`https://api.x.com/2/users/by/username/${encodeURIComponent(username)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) return { status: "not_found" };
    if (!res.ok) return { status: "unavailable" };
    const body = (await res.json()) as { data?: { id: string; username: string } };
    return body.data ? { status: "found", id: body.data.id, username: body.data.username } : { status: "not_found" };
  } catch {
    return { status: "unavailable" };
  }
}
