# Security policy

Until the project domain is configured, report vulnerabilities to `security@oink.example`. This placeholder must be replaced with a monitored security contact before any public deployment.

We aim to acknowledge reports within 48 hours and patch critical issues within 7 days. Good-faith research is not pursued, and researchers are credited when fixes ship.

| Surface | Why it matters |
| --- | --- |
| XSS in the app shell | A decrypted key in browser memory makes script injection direct fund loss. |
| Keystore exfiltration | Report anything that weakens Argon2id, AAD binding, or the `encKey`/`authKey` split. |
| Transaction substitution | A signed transaction that differs from the server-built message must never broadcast. |
| Fee-payer abuse | The sponsor must never sign an unbuilt transaction or exceed budget caps. |
| Tag enumeration | Unknown tags, wrong passwords, and wrong TOTP codes must be indistinguishable. |
| TOTP replay or recovery bypass | Reused codes/challenges or tag recovery without the correct signing key are critical. |

Out of scope: the TENDER repository, third-party outages, self-inflicted loss of a secret phrase, and smart-contract reports—Oink deploys no program.
