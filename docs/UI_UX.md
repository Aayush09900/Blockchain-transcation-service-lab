# UI/UX Design Brief

## Product UI objective
If a dashboard is built, it is a developer/operations transaction dashboard, not a consumer crypto exchange.

## Primary users
- Developers
- QA/security reviewers
- Operators

## Navigation
- Overview
- Transactions
- Transaction detail
- Audit events
- Blockchain
- System health
- Settings/security

## Overview
Show:
- total transactions
- CREATED/SUBMITTED/CONFIRMED/FAILED counts
- recent transaction activity
- outbox lag
- RPC/worker health
- recent failures

## Transaction list
Columns:
- transaction ID
- status
- chain ID
- asset
- amount
- tx hash
- created time
- updated time

Provide filtering by status, chain, transaction ID, and date.

## Transaction detail
Show:
- lifecycle timeline
- request/correlation IDs
- sender/recipient
- amount
- chain
- transaction hash
- block/receipt information
- anchor information
- audit events
- failure/reconciliation information

## Status language
Use explicit states. Never display SUBMITTED as CONFIRMED. Unknown/reconciliation conditions must be visually distinct from FAILED.

## States
Loading, empty, success, failure, permission denied, dependency unavailable, and retry/reconciliation states must each have clear messages.

## Security UX
Never display secrets, private keys, credentials, or sensitive tokens. Destructive/retry actions require confirmation where appropriate.

## Accessibility
Keyboard navigation, readable contrast, semantic controls, visible focus, clear status text, responsive layouts, and screen-reader-friendly labels.

## Responsive behavior
Desktop is the primary operations view; tablet/mobile should preserve transaction status, ID, hash, and key error information without requiring horizontal scrolling.

## Design principle
Information density should support engineering diagnosis rather than speculative trading or portfolio behavior.
