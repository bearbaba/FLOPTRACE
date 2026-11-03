# FLOPTRACE Inference Workbench

Standalone FLOP Devnet experimentation app inside bearbaba/FLOPTRACE. **It does not replace the Technocore Studio application at the repository root.**

## Run locally

Requires Node.js 22+ and npm:

    cd inference
    npm install
    npm test
    npm start

Open http://127.0.0.1:3030. Model discovery works without an API key if api.flop.network is reachable. To enable inference, obtain an API key only from an official FLOP channel and set FLOP_API_KEY in your **local server environment**.

PowerShell:

    $env:FLOP_API_KEY="your-official-key"
    npm start

Linux/macOS:

    FLOP_API_KEY="your-official-key" npm start

Never add .env, seed phrases, API credentials, mnemonic phrases, or private keys to GitHub. The app only needs a server-side API credential for completions. Do not place the key in browser JavaScript.

## Two public DID profiles

- Main Agent: did:key:z6MktYZcwhU44paRoi5AwahUv66jKAMsxXvf2TxaUzLs3yyG
- Review Agent: did:key:z6MktbDb2dVYvfm2C8koCMxvREpyCRDD1zFPzGgEdJQ1M2AR

These are **public Ed25519 did:key values**. This app validates their format and attaches a chosen DID as an **unsigned label** on a local receipt. This does **not** prove possession of the corresponding secret key, a TechnoCore check-in, a FLOP account, agent wallet registration, a signed inference request, or chain activity. Original private keys stay in their existing secure holder and must never be pasted here.

## What is implemented

- Read official public models from https://api.flop.network/v1/models.
- Request chat completion using the published @flop-labs/client@0.2.1 once an official API key is available.
- Record gateway response ID, model, selected DID, local request/output SHA-256 hashes and time, without saving prompts or raw outputs in the browser journal.
- Show **NOT VERIFIED** on every result. A local digest is not PoUI, TEE attestation, independent miner proof or settlement evidence.
- Save up to 30 receipts in browser localStorage, export the latest receipt as JSON.
- Localhost-only server; server-side secret; same-origin inference; bounded inputs; unit tests with mocked gateway calls.

## Deployment and security

**Do not deploy this local prototype as a public unrestricted inference API**. Before using a public host or Vercel, implement authentication, server-side request quotas, spending budgets, abuse controls and monitoring. This subproject is deliberately isolated from root-level Technocore Studio and its Vercel read proxy.

There is no on-chain wallet, faucet claim, signed DID session, PoUI verification or real mainnet token integration in this version. The unit tests run with mock responses, not live paid inference. For live gateway troubleshooting, verify the official list at https://flop.finance/official/ and the SDK reference at https://docs.flop.network/docs/sdk-references.

Devnet funds have no monetary value and earn no reward or airdrop weight. Devnet may reset. There is no tradeable FLOP token at this time.
