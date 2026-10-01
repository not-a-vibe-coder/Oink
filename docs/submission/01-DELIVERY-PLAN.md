# Phase 5 delivery plan

Continue the ten-commit structure: verified requirements; edge-case regression and provider guards; payment-to-portfolio integration; isolated interactive demo; receipt and signing polish; browser checks and recording; pilot measurement; pitch and reuse disclosure; reviewer setup; final evidence.

## Official requirements checked October 1, 2026

The [World’s Fair event page](https://colosseum.com/worldsfair) confirms October 12, 2026. The [official rules](https://colosseum.com/legal/Crypto%20World%27s%20Fair%20Hackathon%20Rules.pdf), sections 5–8, specify a September 14, 6 a.m. Pacific start and October 12, 11:59 p.m. Pacific finish: October 13, 06:59 UTC / 07:59 Africa/Lagos. The portal’s clock is authoritative; recheck before upload.

The [submission FAQ](https://colosseum.com/hackathon) requests product and team details, logo, repository access, a two-to-three-minute pitch, and a product demo of at most three minutes. Private repositories need reviewer access through the named hackathon account. Each person joins one team; each team submits one product. Disclose pre-existing development; only work during the competition counts toward judging. The [workshop guidance](https://blog.colosseum.com/perfecting-your-hackathon-submission/) recommends a clear problem, audience, founder background, validation evidence, and a separate technical walkthrough.

Judging focuses on functionality, impact, novelty, UX, open-source composition, and business viability. The income-to-investment workflow is the proposed wedge. Demand, willingness to pay, and real execution reliability remain hypotheses.

## Acceptance evidence

| Criterion | Evidence to collect |
| --- | --- |
| Once-only payment receipt and allocation | Flow HTTP/PostgreSQL duplicate and concurrency tests |
| Exact cash-first allocation, including tiny amounts | Shared BigInt allocation tests |
| Deferred/unavailable/expired quotes | Policy and provider failure tests |
| Unmodified locally signed transactions | Route and Ed25519/message validation tests |
| Interrupted signing and cancellation | Prepared plan reset/cancel tests; browser review |
| Ambiguous broadcast and retry | Persist-before-broadcast, duplicate submit, RPC outage, expiry tests |
| Actual receipt and independent purchase outcomes | Finalized receipt and payment-to-portfolio integration |
| Phone usability | Narrow-screen browser interaction and overflow check |
| Honest demo | Permanently labelled simulation; no wallet credentials or broadcast in demo |
| Pilot evidence | Consented real usage ledger, not invented metrics |

No public deployment, participant contact, funded transaction, or contest upload is performed by this phase’s local work. Those require actual accounts, participation and explicit actions. Deliver concrete materials now, and record external gaps rather than claiming they occurred.
