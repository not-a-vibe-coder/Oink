# Pilot protocol and evidence ledger

Status: no recruited participants, interviews, funded transactions, revenue, or repeat use yet recorded. Local fixture tests and demo interaction do not count as users.

Recruit three to five USDC-paid freelancers through existing relationships, after provider eligibility is reviewed. Ask them to describe their last payment and reserve/investment decisions before showing Oink. Obtain consent to record anonymized findings and aggregate usage. Each participant controls their wallet and trade approval; never request passwords, TOTP secrets, or backup phrases. Start with an amount the participant chooses and a single supported investment. Record their existing process as the comparison, not assumed Jupiter savings.

Walk through: create/unlock; supply SOL for fees; configure cash target; receive a referenced USDC transfer; confirm; allocate; review a stock quote; sign only if they choose; reconcile; inspect deferral; cancel remaining unspent orders. Observe confusion and failed steps on the actual device. Invite another payment later to measure repeat use. Do not claim provider availability outside the tested jurisdiction and asset.

| Participant alias | Consent/date | Prior workflow and pain | Actual payment/amount | Allocation/fill evidence | Deferral or failure | Feedback and next-use commitment |
| --- | --- | --- | --- | --- | --- | --- |
| Pending | — | — | — | — | — | — |

Use `backend/scripts/pilot-report.ts` with DATABASE_URL and PILOT_ACCOUNT_IDS (a JSON array of consented account IDs) supplied through local environment configuration. It performs a read-only consistent snapshot and emits aggregate counts and exact amounts without IDs, signatures, or credentials. Keep cohorts separate from disposable test wallets. All historical records for the supplied cohort are included; note the measurement date and cohort definition when reporting results.

Measure: verified payments; allocated payments; users with allocations; repeat users; current reserved/released cash; finalized fills; actual fees; mismatches; current deferral reasons. A received payment can exist without an allocation. Quote checks are not fills. Prepared/submitted attempts are not success. Total fees cover successful fills only; failed-chain fees require separate chain review. SOL debit from account creation is distinct from network fees. No savings or execution-quality comparison is measured by this report.

Before launch: funded-wallet browser verification, recovery on another device, interrupt/reopen while signing, unresolved-submission reconciliation, provider eligibility, RPC/network alignment, and customer demand remain real pilot checks. Reference-premium validation stays unavailable until an appropriate feed and conversion data exist.
