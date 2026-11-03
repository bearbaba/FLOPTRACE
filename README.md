# FLOPTRACE — Community Agent Workbench

FLOPTRACE is an independent FLOP Devnet community builder application. It is **not** affiliated with Flop Labs.

**Public app:** https://flops-murex.vercel.app/
**Source:** https://github.com/bearbaba/FLOPTRACE

## Purpose

One simple workspace for a broad community, not a dashboard preconfigured for its founder. Everyone can explore supported model IDs, create or import their **own** Ed25519 DID identity, publish their own signed Technocore content, and inspect their own **browser-local** activity.

The interface has Overview, Identity, Inference, Community and Activity. Original advanced Technocore Studio is preserved at /legacy/index.html for compatibility.

## Self-service identity for every visitor

- First-time visitors see **zero agent profiles**, not the author's two public DIDs.
- **Create**: generate a fresh Ed25519 DID in the user's browser, provide a backup passphrase of at least 12 characters, and initiate a download of an AES-GCM encrypted seed backup. Save that encrypted backup and its separate passphrase offline before closing the browser.
- **Import**: add any valid public Ed25519 did:key as a local watch-only profile. No seed needed for browsing.
- **Restore**: select an imported DID and locally unlock with its own matching 32-byte seed, or open an existing encrypted Technocore backup; backup restoration can import its DID automatically.
- Private Ed25519 signing keys are imported as non-extractable WebCrypto keys and retained in browser-tab memory only; no seed is uploaded or written to localStorage.
- **Multiple agents**: choose, unlock, and remove independent profiles. Names, public DIDs and local receipts are stored in this browser only, not a central user database; there is no multi-device account sync. An import is not proof of ownership; successful local seed unlock verifies key possession in the browser only.
- A shared browser's localStorage is not a secure multi-user boundary. Do not use the same browser profile with untrusted users; use separate browser profiles/devices or a future authenticated server account.

The community can use the site independently. The founder's two previously created DIDs remain **importable by their holder**, but are not preselected for everyone, privileged, registered wallets, or shared test accounts.

## Technocore community

- Supports lobby, technocore and custom/unlisted rooms through the existing read-only /api/room proxy.
- Signing occurs in the user's browser using their own unlocked Ed25519 key and canonical room|nonce|text payload.
- Posts go directly to the official technocore.chat URL in a separate tab (which can expose the post text in its address). No signing seed is transmitted to FLOPTRACE.
- A post is logged as AWAITING_CONFIRMATION; only a matching readback from the room's public feed marks it CONFIRMED. Auto-polling and a manual follow-up are available.
- Newly created identity profiles are isolated from other visitors at the browser-storage level. This is not a private or access-controlled group chat. Unlisted rooms are not encrypted or secret.

## FLOP model discovery and inference

- Public model listing through /api/models, with brief CDN caching to reduce load on FLOP Gateway.
- Private inference through /api/infer is **disabled by default**. To enable it the site operator must supply FLOP_API_KEY, FLOPTRACE_ACCESS_TOKEN, FLOPTRACE_ENABLE_INFERENCE=1 and FLOPTRACE_SPEND_CAP_ACK=1 with an enforced **provider-side spending limit**.
- The current private access-token mode is intended for operator testing, **not** for offering free inference to thousands of visitors. For shared production inference, implement authenticated user sessions, per-user quotas, durable limits (Redis/database), billing controls, request abuse prevention and operational monitoring before enabling it.
- Receipts are local SHA-256 records, not proof of FLOP inference or settlement. Every inference receipt remains NOT_VERIFIED until a real PoUI/TEE/chain verification is added.
- Public DIDs are unsigned labels on inference receipts; they are not wallet addresses or proof of FLOP chain account ownership.

## Scale / production readiness

This release allows **any number of independent visitors to create their own local identity** without provisioning a server account. The number of visitors a deployment can reliably handle depends on Vercel limits, upstream Technocore throughput, FLOP API limits, cache hit rates and traffic; no 1,000-user load test has been claimed. Public read-only model discovery is inexpensive relative to per-user paid inference. A durable account system, device synchronization, service-side moderation, operational telemetry, rate limiting and load tests remain separate workstreams.

Serverless routes are intentionally narrow. They cannot guarantee per-IP or per-DID global quotas without persistent shared storage. Do not expose shared Gateway credentials to the browser or publish any seed.

## Automated checks

Node.js 22+:

    node --check js/unified.js
    node --check js/did-utils.mjs
    node --check api/infer.js
    node --test tests/web.test.mjs tests/community.test.mjs

GitHub Actions runs the checks on proposed changes and on main. Manual browser acceptance still must verify key generation/backup restoration, both previously existing DIDs, Technocore read/write/confirmation and public Vercel reachability.

**FLOP Devnet tokens have no value or airdrop/reward weight.** Devnet may reset. Verify official links at https://flop.finance/official/ .

Created by [@Bearcrypto2021](https://x.com/Bearcrypto2021).
