# Pitch and demo recording scripts

## Pitch: approximately two minutes

“People paid in USDC still have to decide what stays available for living expenses and what goes into investments every time they get paid. Oink Flow gives that payment a plan, and Bell checks the proposed investments before the user signs.

“Our first audience is USDC-paid freelancers who already want to keep a cash reserve and buy tokenized stocks. That customer need is a hypothesis we are testing; we do not yet claim interviews, active users, revenue, or willingness to pay.

“Here is the workflow. A person chooses a USDC cash target and how investment surplus should be split. They send a client a payment link. Oink verifies the payment, fills the cash shortfall, and records individual investment orders. Bell gets a quote for each exact amount and checks the person’s price, slippage, impact, and freshness limits. If a quote does not pass, those funds stay in USDC. A passing purchase still needs the user’s explicit approval and local signature.

“The specific product choice is to connect income planning with execution review. We compose with Jupiter for routing; our proposed value is the repeatable cash-first workflow and understandable outcomes. We are not issuing stocks or promising better prices than Jupiter.

“We have implemented the product and tested payment verification, allocation, deferred quotes, locally signed transaction validation, and recovery from uncertain submission. Read-only live routes were available for three stock tokens. The walkthrough you see is labelled simulated; no funded mainnet pilot has been performed.

“Our next step is a small consented freelancer pilot, measuring successful allocations, actual costs, repeat use, and where people abandon the workflow. We will test whether paid planning features or payment-platform integrations make sense before choosing pricing.

“[FOUNDER: add your name, relevant experience, and why you understand this customer.]

“Oink Flow plus Bell: income fills your cash reserve first, and investments move only after review.”

Record founder background accurately, then rehearse duration and remove unsupported claims. Do not read bracketed placeholders in the final recording. The [Colosseum guidance](https://colosseum.com/hackathon) requests a two-to-three-minute pitch distinct from the demo.

## Product/technical demo: at most three minutes

| Time      | Screen/action                                          | Narration                                                                                                                                                                             |
| --------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:15 | `/demo`, visible simulation notice                     | “This is a simulated rehearsal of the implemented workflow. These are fictional payments and fills.”                                                                                  |
| 0:15–0:35 | Cash target 1,000; existing cash 800; payment 500      | “The reserve needs 200 USDC. The remaining 300 is assigned 60/40.”                                                                                                                    |
| 0:35–0:55 | Simulate receipt; allocate                             | “Receipt is separate from investment execution. In the actual app it is verified with a finalized referenced Solana payment.”                                                         |
| 0:55–1:25 | Fresh quotes; passing SPYx and deferred AAPLx          | “Bell checks exact amounts. The AAPLx quote exceeds the token-price limit, so its 120 USDC remains reserved.”                                                                         |
| 1:25–1:55 | Review simulation; simulate approval/finalized receipt | “The actual app prepares a guarded transaction. The browser signs it locally; the server validates the unchanged message and signature. This walkthrough does not sign or broadcast.” |
| 1:55–2:15 | Final receipt                                          | “Cash, completed investment, and deferred money remain separately accounted for.”                                                                                                     |
| 2:15–2:40 | Show lifecycle test and custody evidence               | “A signature is saved before broadcast. Lost responses reconcile the same attempt. Finalized success cannot be retried.”                                                              |
| 2:40–2:55 | Limitations                                            | “Mainnet funded execution and customer validation remain pending; equity reference data is unavailable.”                                                                              |

Use the saved silent WebM as rehearsal footage, or record the app directly with narration. Preserve the simulation disclosure in every edit. For a real funded recording, use `/app/income`, actual receipts, and the participant’s explicit choice to trade; never show password, authenticator setup, phrase, or secrets. Keep pitch and demo as separate files.
