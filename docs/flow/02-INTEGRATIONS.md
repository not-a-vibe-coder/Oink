# Integration feasibility and reuse audit

## Existing modules

- `backend/src/routes/invoices.ts`: useful invoice persistence; its legacy confirm endpoint trusts a client signature. Flow uses a separate verified confirmation path.
- `backend/src/routes/pay.ts`: atomic mix settlement; do not use it for Flow income. Flow starts with plain USDC transfers.
- `backend/src/services/rpc.ts`: balances are cached and swallow token-account errors. Allocation must use a fresh finalized USDC read that fails closed.
- `backend/src/services/txBuilder.ts`: connection and existing transaction infrastructure can be reused. No new server spend authority.
- `src/lib/oink-server-fns.ts`: session forwarding and structured errors can be reused.
- `src/components/oink/AppShell.tsx` and `src/styles/app.css`: reuse navigation and ledger visual language.

## Trading feasibility

Candidate registry assets: SPYx, AAPLx, NVDAx. Mainnet mints exist in Oink's canonical registry. Live executable routes and intended order sizes are NOT validated yet; Phase 2 only receives and allocates USDC, with investments pending.

[Jupiter quote documentation](https://developers.jup.ag/docs/swap/v1/get-quote) specifies raw integer amounts and minimum-output thresholds. It now labels Metis Swap v1 superseded by Swap v2. Keep existing integrations unchanged during payment phases; choose and verify the supported execution route before Phase 3.

[xChange documentation](https://docs.xstocks.fi/developers/xchange-atomic-rfq) describes authenticated integration. No provider account or API access is assumed.

No licensed underlying equity reference feed is configured. Premium checks remain unavailable. No mock data should be presented as a verified live market.

## Operational gates

Mainnet stock execution, provider eligibility, and order-size liquidity checks are gates for Phase 3. Live deployment, funding, and interviews are not performed by these source changes. All environments must define the correct USDC mint; no mainnet stock purchases on devnet.
