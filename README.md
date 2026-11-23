# FLOPTRACE — Community Agent Workbench

FLOPTRACE is an independent FLOP Devnet community builder application. It is **not** affiliated with Flop Labs.

**Public app:** https://flops-murex.vercel.app/
**Source:** https://github.com/bearbaba/FLOPTRACE

## FLOP Devnet Hub (public release)

The unified web includes a Devnet Hub with read-only, official developer resources:

- [Official Explorer](https://explorer.devnet.flop.network/) — inspect blocks, transactions and chain information on the source website.
- [Official Faucet](https://faucet.flop.network/) — request non-transferable-worth test balance using a **public SS58 wallet address**. A TechnoCore Ed25519 DID is **not** an SS58 chain address.
- [Gateway models](https://api.flop.network/v1/models) — publicly listed models, now browsable/searchable directly in FLOPTRACE Inference without an API key. Listing a model is not proof of live routability or inference success.
- [Hosted MCP](https://mcp.flop.network/mcp) — read-only Streamable HTTP endpoint, suitable for third-party agent clients. FLOPTRACE offers a copyable URL, not a hosted personal MCP client.
- [Official SDK docs](https://docs.flop.network/docs/sdk-references) — copy package installation commands for @flop-labs/client, @flop-labs/sdk, and the pinned CLI.
- [Ask FLOP](https://ask.flop.finance) — the official docs assistant.

There is no automatic faucet claim, no wallet import, no on-chain transaction signing, no production PoUI verifier and no user-paid inference in the public website. The existing authenticated server inference is disabled by default without official credentials and a provider-enforced hard spending cap. The UI labels this boundary explicitly.

The public website credits its independent builder, [Bear Crypto](https://x.com/Bearcrypto2021), with a voluntary follow link, and makes it clear that FLOPTRACE is not an official FLOP Labs product.

**This is not a performance-tested 1,000+ concurrent-user product**. Static resource browsing scales much more easily than paid inference, but serverless call volumes, upstream quota, abuse controls and throughput still require load testing, quotas and monitoring before high-volume inference is enabled.

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


## Simpler onboarding & read-only Faucet status

The main flow is **Explore Devnet → Get test FLOP → Build an agent**; neither a wallet nor a DID is necessary to view public explorer/model information. Advanced SDK, MCP and CLI instructions stay available inside a collapsed developer section. Local seed-unlock controls are likewise collapsed on the Identity page. Existing backup support is preserved.

FLOPTRACE checks the **SS58 checksum locally** when someone copies a public address. This does not prove a FLOP chain network prefix, account ownership, balance or grant eligibility. No address is submitted to FLOPTRACE backend.

The read-only /api/devnet-health function fetches public GET endpoints from faucet.flop.network/health and explorer.devnet.flop.network/api/health, with short-lived edge caching. It always marks **grant availability NOT_VERIFIED**, even when service/indexer diagnostics are green. There are credible reports of /fund returning 503 during normal /health responses: https://github.com/flop-labs/network/issues/22 . This function does not attempt funds, spend tokens, process wallet secrets or repeatedly poll the faucet. Users use the official faucet themselves and verify resulting transactions on the official explorer.

Automated checks cover diagnostics, checksum and onboarding copy. Live grants, transaction confirmation and stress testing remain unverified.


## Verified Testnet cutover (prepared, intentionally OFF until official genesis)

FLOPTRACE keeps its existing community homepage and Testnet target countdown until the network's **first-block hash and endpoints are officially published, independently reviewed, and matched against a live RPC response**. The target time passing alone never activates Testnet. The source of truth is the official [FLOP announcement](https://flop.finance/) and [Testnet network identity](https://docs.flop.network/docs/network-testnet).

The new public GET `/api/testnet-readiness` endpoint checks all of these private operator-side settings:

- `FLOPTRACE_TESTNET_RELEASE_VERIFIED=1` — manually approved only after reviewing official network release, chain spec and first-block announcement. NEVER set this early just because the clock reaches zero.
- `FLOPTRACE_TESTNET_ANNOUNCEMENT_URL` — the reviewed primary official `https://flop.finance/...` or `https://docs.flop.network/...` release/announcement page.
- `FLOPTRACE_TESTNET_EXPECTED_GENESIS` — the 66-character `0x`-prefixed **official** block-0 hash, pinned independently of the RPC.
- `FLOPTRACE_TESTNET_RPC_URL` — the officially published, public `https://` HTTP JSON-RPC or `wss://` WebSocket RPC endpoint (not Devnet).

For each check, the server sends `chain_getBlockHash` with block number `0`, accepts only a valid 32-byte hash and requires an exact match to the independently pinned official value. Missing config, RPC failure, a different hash, Devnet's known hash or Devnet RPC all leave the cutover **OFF**. The API is read-only, does not accept user-provided RPC endpoints or hashes, and does not hold seeds or wallet credentials. Vercel caches public status briefly; the browser checks about once per minute. After configuring these settings, redeploy and verify `/api/testnet-readiness` returns `testnetVerified: true`. Confirm the public homepage has changed and **check both routes**.

When verified, the homepage defaults to Testnet, displays the checked genesis hash, hides Devnet links/cards/menu and replaces the clock with **Bắt đầu trên Testnet**, opening the officially documented [TechnoCore](https://technocore.chat/). While in-site Testnet inference, faucet and voucher verification are not implemented, the CTA must not claim those features work in FLOPTRACE.

Existing Devnet tools are still available at **[/devnet](https://flops-murex.vercel.app/devnet)**. The route is a Vercel rewrite to the existing client-side `devnet` view, preserving the same functionality and avoiding a second copy of the application. Back/forward navigation and `?view=devnet` legacy deep links remain supported.

**Release safety checklist:** verify FLOP-issued first-block hash separately from the selected RPC; check the supported release and operator announcement; ensure official TechnoCore can serve the announced Testnet; set environment only after approval; check status endpoint, frontend, /devnet archive and browser console; never paste private keys or auto-spend on the community website. If only WebSocket RPC is available the API uses secure `wss://`. Neither a successful JSON-RPC read nor a browser DID by itself proves a settled inference or earned voucher.

