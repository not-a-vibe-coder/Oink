import { PrivyClient } from "@privy-io/node";
import { getConfig } from "../../config";

/**
 * The holding wallets behind held payments (docs/12 §5, §6), and the only place Oink's
 * refund signer is used.
 *
 * Each recipient identity gets a Privy user created before they sign up, with one Solana
 * wallet. Our authorization key is an additional signer on that wallet only, under a policy
 * whose single rule allows a Token Program TransferChecked into an allow-listed destination.
 * Every other instruction, program, method and destination is denied by Privy's default.
 * The allow-list holds each pending sender's token account (for refunds) and, once proven,
 * the claimant's.
 */

export type HeldIdentity =
  | { kind: "email"; email: string }
  | { kind: "x"; userId: string; username: string };

export interface CreatedHoldingWallet {
  privyUserId: string;
  walletId: string;
  address: string;
  policyId: string;
  ruleId: string;
}

export interface HoldingProvider {
  createHoldingWallet(identity: HeldIdentity): Promise<CreatedHoldingWallet>;
  setAllowedDestinations(wallet: { policyId: string; ruleId: string }, destinations: string[]): Promise<void>;
  /** Signs as the holding wallet. Privy's enclave applies the policy before it signs. */
  signTransaction(walletId: string, transactionBase64: string): Promise<string>;
}

export class HeldPaymentsNotConfiguredError extends Error {
  constructor() {
    super("Held payments are not configured.");
  }
}

// An `in` list may not be empty, and every entry is a destination the signer may pay.
// The System Program address is never a token account, so it permits nothing.
const NOTHING = "11111111111111111111111111111111";

function rule(destinations: string[]) {
  return {
    name: "release-to-allowed-destination",
    method: "signTransaction" as const,
    action: "ALLOW" as const,
    conditions: [
      {
        field_source: "solana_token_program_instruction" as const,
        field: "instructionName" as const,
        operator: "eq" as const,
        value: "TransferChecked",
      },
      {
        field_source: "solana_token_program_instruction" as const,
        field: "TransferChecked.destination" as const,
        operator: "in" as const,
        value: destinations.length > 0 ? destinations : [NOTHING],
      },
    ],
  };
}

export function heldPaymentsConfigured(): boolean {
  const c = getConfig();
  return Boolean(c.privyAppId && c.privyAppSecret && c.privyAuthorizationKey && c.privySignerId);
}

class PrivyHoldingProvider implements HoldingProvider {
  private client: PrivyClient;
  private signerId: string;
  private authorizationKey: string;

  constructor() {
    const c = getConfig();
    if (!heldPaymentsConfigured()) throw new HeldPaymentsNotConfiguredError();
    this.client = new PrivyClient({ appId: c.privyAppId!, appSecret: c.privyAppSecret! });
    this.signerId = c.privySignerId!;
    this.authorizationKey = c.privyAuthorizationKey!;
  }

  private get auth() {
    return { authorization_private_keys: [this.authorizationKey] };
  }

  async createHoldingWallet(identity: HeldIdentity): Promise<CreatedHoldingWallet> {
    // Owned by our key, so only our signer can edit the allow-list.
    const policy = await this.client.policies().create({
      version: "1.0",
      name: `oink-held-${identity.kind}`,
      chain_type: "solana",
      rules: [rule([])],
      owner_id: this.signerId,
    });
    const ruleId = policy.rules[0]?.id;
    if (!ruleId) throw new Error("Privy returned a policy without its rule");

    const wallet = { chain_type: "solana" as const, policy_ids: [policy.id], additional_signers: [{ signer_id: this.signerId }] };
    const linked =
      identity.kind === "email"
        ? { type: "email" as const, address: identity.email }
        : { type: "twitter_oauth" as const, subject: identity.userId, username: identity.username, name: identity.username };

    let user;
    try {
      user = await this.client.users().create({ linked_accounts: [linked], wallets: [wallet] });
    } catch (err) {
      // They already exist in Privy (for instance an abandoned sign-in): add our wallet to them.
      const existing =
        identity.kind === "email"
          ? await this.client.users().getByEmailAddress({ address: identity.email })
          : await this.client.users().getByTwitterSubject({ subject: identity.userId });
      if (!existing) throw err;
      user = await this.client.users().pregenerateWallets(existing.id, { wallets: [wallet] });
    }

    // Pick the wallet that carries our policy, not merely any Solana wallet the user has.
    const candidates = user.linked_accounts.filter(
      (account) => account.type === "wallet" && "chain_type" in account && account.chain_type === "solana",
    ) as Array<{ id?: string | null; address: string }>;
    for (const candidate of candidates.reverse()) {
      if (!candidate.id) continue;
      const full = await this.client.wallets().get(candidate.id);
      if (full.policy_ids?.includes(policy.id)) {
        return { privyUserId: user.id, walletId: full.id, address: full.address, policyId: policy.id, ruleId };
      }
    }
    throw new Error("Privy created the user but not the policy-bound Solana wallet");
  }

  async setAllowedDestinations(wallet: { policyId: string; ruleId: string }, destinations: string[]) {
    await this.client.policies().updateRule(wallet.ruleId, {
      policy_id: wallet.policyId,
      ...rule(destinations),
      authorization_context: this.auth,
    });
  }

  async signTransaction(walletId: string, transactionBase64: string): Promise<string> {
    const signed = await this.client.wallets().solana().signTransaction(walletId, {
      transaction: transactionBase64,
      authorization_context: this.auth,
    });
    return signed.signed_transaction;
  }
}

let provider: HoldingProvider | null = null;

export function getHoldingProvider(): HoldingProvider {
  if (!provider) provider = new PrivyHoldingProvider();
  return provider;
}

/** Tests swap in a fake so the lifecycle runs without Privy. */
export function setHoldingProviderForTests(fake: HoldingProvider | null) {
  provider = fake;
}
