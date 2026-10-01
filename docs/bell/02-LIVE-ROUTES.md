# Read-only integration evidence

On October 1, 2026, requests to Jupiter Swap v2 `/build` returned HTTP 200 for mainnet USDC → SPYx, AAPLx, and NVDAx, each with a 10,000,000 micro-USDC ($10) input and 50-basis-point slippage. Each returned a Jupiter route-v2 instruction and a positive minimum output. A randomly generated public wallet was used; no funds were deposited, signed, or broadcast.

The provider's `priceImpactPct` is a decimal ratio: 0.001 means 0.1%, not 0.001%. Bell converts it with exact arithmetic. This follows the [Swap v2 OpenAPI specification](https://developers.jup.ag/docs/openapi-spec/swap/v2/swap.yaml). The [build guide](https://developers.jup.ag/docs/swap/build) documents local assembly, simulation, and RPC submission.

Live route availability changes. A successful $10 request is not evidence of liquidity at every size, a guaranteed fill, or a live execution test. The application requests a new route for each exact purchase amount. Existing mainnet registry mints are used; devnet stock execution remains unavailable.
