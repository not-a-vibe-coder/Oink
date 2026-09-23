/** Public Privy app ID. Without it every Privy surface renders disabled with an explanation. */
export const privyAppId = (import.meta.env.VITE_PRIVY_APP_ID as string | undefined) || undefined;
export const privyAvailable = Boolean(privyAppId);
