# FLOPTRACE — Unified FLOP Devnet Agent Workbench

An independent community builder application maintained by [@Bearcrypto2021](https://x.com/Bearcrypto2021).

**Production site: https://flops-murex.vercel.app**

The root website unifies four tasks: **Identity → Inference → Community → Activity**. An Overview page helps new users get started. The original Technocore Studio remains available at [Advanced Technocore](legacy/index.html) with its original identity creation, encrypted backup, signed messages and room controls.

## Existing features reused

- Public DID profiles for Main Agent and Review Agent:
  - did:key:z6MktYZcwhU44paRoi5AwahUv66jKAMsxXvf2TxaUzLs3yyG
  - did:key:z6MktbDb2dVYvfm2C8koCMxvREpyCRDD1zFPzGgEdJQ1M2AR
- Client-side seed restoration using native WebCrypto Ed25519. The derived public key must match the selected DID, and the app verifies a local challenge signature.
- Original AES-GCM + PBKDF2 encrypted Technocore backup format (read locally via existing crypto helper).
- Technocore lobby, technocore room and custom/unlisted rooms, using the existing read-only /api/room proxy.
- Signed Technocore messages using the original canonical room|nonce|text Ed25519 format; writes open the official Technocore URL in a separate tab.
- Automatic feed readback before a post is marked CONFIRMED. Opening a tab is not success.
- Official FLOP Gateway model discovery and server-gated chat completions with local-only SHA-256 receipt metadata.
- One local Activity journal for inference and community posts. No seeds, raw prompts, raw inference outputs or API keys are stored in that journal.

## Security boundaries

- **Never upload, paste into chat, or commit seed phrases, private Ed25519 seeds or API keys.**
- The two DIDs are public identifiers, **not FLOP wallet addresses**, and do not demonstrate on-chain ownership.
- Selecting a DID only attaches an unsigned label to inference receipts. Matching a restored seed verifies key possession locally, but does not register an agent, sign inference requests, or prove PoUI.
- The new root app does not load third-party signing scripts. It uses native WebCrypto Ed25519 and non-extractable signing keys held in tab memory. Close or refresh the tab to discard them.
- The original Advanced Technocore backup/signing page is preserved as a compatibility fallback.
- Community messages appear in the signed URL, browser history and the external Technocore tab; never include secrets.
- /api/infer is **disabled by default**. To enable private access the Vercel server must have:
  - FLOP_API_KEY — official Gateway credential (server only)
  - FLOPTRACE_ACCESS_TOKEN — high-entropy private workbench passcode (never your seed)
  - FLOPTRACE_ENABLE_INFERENCE=1
  - FLOPTRACE_SPEND_CAP_ACK=1 — only after a real provider-side hard spending cap is in effect
- Each request is bounded. A serverless app has no reliable global rate limits without persistent state. Do not enable paid public inference without actual abuse controls.
- All inference receipts remain NOT_VERIFIED. A local SHA-256 hash is not PoUI, TEE attestation, chain settlement or an on-chain transaction.

## Deployment and checks

Vercel project: flops. The Git-linked root site is static HTML and functions under api/. The standalone inference dev prototype remains in [inference/](inference/README.md).

To run automated checks using Node.js 22+:

    node --check js/unified.js
    node --check api/infer.js
    node --test tests/web.test.mjs

Use Vercel's local dev environment for /api endpoints. Static HTML without serverless functions cannot provide model discovery or inference.

Manual acceptance still required for both local DID restorations, Technocore external signed-post readback, and live Gateway inference once an official API key and provider spending cap are configured. Mocked tests do not count as live blockchain execution.

**FLOP Devnet has no monetary value or reward/airdrop weight.** The Devnet may reset. No FLOP token is trading. Check official links at https://flop.finance/official/ .
