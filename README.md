# Interoperable Canvas - Impact Cards

> A drag-and-drop canvas for creating verifiable Impact Cards with on-chain expert attestations. Built for public goods projects.

[![Next.js](https://img.shields.io/badge/Next.js-14-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Overview

Impact evidence for public goods projects is scattered across different sources. Evaluators and funders lack a single, verifiable, non-gameable interface to review impact.

**Interoperable Canvas** solves this by providing:

1. **Impact Card Canvas** — Drag-and-drop floating boxes to compose Impact Cards. Add text, images, animations, Karma milestones, Dune graphs, Gardens Funded Proposals,Snapshot voting results, and more.

2. **On-chain Expert Attestations** — Trusted experts submit confidence scores (0–100) and comments as EAS onchain attestations, referencing the exact card version via content hash. Gasless and frictionless.

## Key Features

- **Multi-source Integration** — Pull data from Karma milestones, Dune Analytics, Gardens Funded Proposals, Snapshot voting results, and more
- **Version Control** — Draft → Freeze (creates Immutable Snapshot with content hash) → Attesting. Prior attestations remain bound to their version
- **Milestone Viewer with Attestations** — Display milestones with image carousel, date, summary, notes, and links to proofs. Shows aggregate score, expert count, and full attestation history with onchain verification links
- **Presentation Flags** — Tailor public vs. reviewer views via URL parameters
- **Embeddable** — Cards work across websites, native apps, and mini-app webviews via simple URLs
- **Gasless Attestations** — Pluggable smart wallet architecture supports gasless submissions (see "Gasless Transactions" section for more details)

## Prerequisites

- Node.js 18+ (see `.nvmrc`)
- npm or pnpm

## Getting Started

1. **Clone the repository**

   ```bash
   git clone https://github.com/your-org/interoperable-canvas.git
   cd interoperable-canvas
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment**

   ```bash
   cp .env.example .env.local
   ```



4. **Start the development server**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000) in your browser.

## Environment Variables

Create a `.env.local` file with the following:

```env
# Firebase (Data persistence)
NEXT_PUBLIC_FIREBASE_API_KEY=your_firebase_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id

# Dune Analytics (Optional - for Dune graph integration)
DUNE_API_KEY=your_dune_api_key
```

## Web3 Integration

### Authentication (Pluggable)

The open-source version includes a basic MetaMask wallet connection (`ConnectWalletButton.tsx`). This is designed to be replaceable with your preferred authentication solution:

- [Privy](https://privy.io) — Web2/Web3 hybrid auth (Google, email, wallets)
- [RainbowKit](https://rainbowkit.com) — Popular wallet connection UI
- [Wagmi](https://wagmi.sh) — React hooks for Ethereum
- [Dynamic](https://dynamic.xyz) — Embedded wallet solution

> **Production note:** Our deployed version uses Privy for seamless expert onboarding—reviewers sign in with Google, no wallet setup required.

### Attestations

- **Protocol**: [Ethereum Attestation Service (EAS)]
- **Attestation Fields**: Score, optional comment, snapshot reference (ID + hash + URL), and version metadata

### Gasless Transactions (Pluggable)

For gasless attestations, integrate a smart wallet solution with a Paymaster. 

**Paymaster Services:**
- [Pimlico](https://pimlico.io) — ERC-4337 infrastructure
- [Alchemy](https://alchemy.com/account-abstraction) — Account Abstraction APIs
- [Biconomy](https://biconomy.io) — Gasless transaction relayer

> **Production note:** Our deployed version sponsors all expert attestations via Paymaster on Base. Reviewers never pay gas and they login with Privy.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Impact Card Canvas                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│  │  Text   │ │  Karma  │ │  Dune   │ │Snapshot │  ...   │
│  │  Image  │ │Milestone│ │  Graph  │ │  Vote   │        │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘        │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                   Version Control                       │
│              draft → freeze → attesting                 │
│                                                         │
│  On freeze, creates Immutable Snapshot:                 │
│    • Snapshot ID (timestamp + unique identifier)        │
│    • Content Hash (SHA-256 of snapshot content)         │
│    • Immutable Snapshot URL (permanent link)            │
│                                                         │
│  Optional: Pin to IPFS or Arweave for extra durability  │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              On-chain Attestations (Base)               │
│  ┌─────────────────────────────────────────────────┐    │
│  │  EAS Schema: ExpertConfidenceV1                 │    │
│  │  • card_id, card_cid, card_hash, version        │    │
│  │  • score_uint8 (0-100), note_hash               │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  Attestation references exact snapshot ID + hash + URL  │
│            Gasless via Paymaster (Pluggable)            │
└─────────────────────────────────────────────────────────┘
```

## License

This project is licensed under the MIT License 


