/**
 * Turns what the chain, Jupiter or the API said into something a person can act on.
 *
 * Simulation failures arrive as program logs ("custom program error: 0x1", "insufficient
 * lamports 1435005, need 1488440"). Those belong in the server log, not in front of someone
 * trying to pay a friend. Messages the API already wrote for people pass through untouched.
 */
const RULES: Array<[RegExp, string]> = [
  [
    /insufficient lamports|not enough sol/i,
    "Not enough SOL left to cover network fees. Send a little less and keep about 0.006 SOL.",
  ],
  [/insufficient funds/i, "You don't have enough of that token for this payment."],
  [/slippage|0x1771|exceeds desired slippage/i, "The price moved while sending. Nothing was sent — try again."],
  [/blockhash|expired|block height exceeded/i, "The payment took too long and expired. Nothing was sent — try again."],
  [/429|too many requests|rate.?limit/i, "Oink is busy right now. Try again in a few seconds."],
  [/no route|could not find any route|jupiter/i, "Couldn't find a way to swap this right now. Try a different amount."],
];

const GENERIC = "That payment couldn't go through. Nothing was sent.";

function looksTechnical(message: string): boolean {
  return (
    message.length > 160 ||
    /program|instruction|simulation|0x[0-9a-f]+|\{|\[|stack|TypeError|undefined/i.test(message)
  );
}

export function friendlyError(message: string | null | undefined): string {
  if (!message) return GENERIC;
  for (const [pattern, text] of RULES) {
    if (pattern.test(message)) return text;
  }
  return looksTechnical(message) ? GENERIC : message;
}
