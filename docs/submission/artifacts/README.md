# Local rehearsal artifacts

The PNGs and silent WebM show the public `/demo` simulation, not a mainnet transaction or a customer pilot. `browser-results.json` records desktop (1280×900) and phone (390×844) interaction, receipt/reset, no horizontal overflow, no JavaScript page errors, and no wallet/API execution requests. The phone check also advances the clock past quote expiry and verifies that approval cannot advance to submission.

Run the frontend on port 3105, install Chromium with `bunx playwright install chromium`, then run `bun scripts/check-demo.mjs`. Override DEMO_BASE_URL for another local origin. Browser startup waits for hydration before interaction. A silent recording is a rehearsal asset; founder narration and a separate pitch video are still needed for submission.
