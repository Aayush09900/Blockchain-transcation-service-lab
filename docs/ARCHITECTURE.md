# Blockchain Transaction Service Lab Architecture

## Purpose

This document describes the current educational architecture and the planned hardening path. The repository is intentionally small and does not provide production custody.

## Current flow

Client -> Transaction Service -> Idempotency/State Machine -> Transaction Record

The current implementation keeps transactions and idempotency keys in memory.

## Transaction lifecycle

CREATED -> SUBMITTED -> CONFIRMED

A transaction may transition to FAILED from CREATED or SUBMITTED. Terminal states are protected from invalid overwrites.

## Planned production-oriented architecture

Client/API -> Security Edge -> Transaction Service -> Queue -> Transaction Worker -> Blockchain/RPC -> Confirmation/Event Listener -> Reconciliation/Audit

## Security boundary

A firewall is best implemented as layered controls rather than a single code-level switch.

Recommended controls before production use:

- HTTPS/TLS at the deployment edge
- Authentication and authorization
- Rate limiting and request-size limits
- Schema and input validation
- CORS allowlisting when a browser client is used
- Network segmentation
- Restrictive inbound cloud firewall/security-group rules
- No public database access
- Secrets stored outside source control
- Structured audit logs
- Dependency and static analysis in CI

## Threat model focus

The main risks are duplicate submissions, malformed input, RPC instability, credential leakage, unauthorized access, API abuse, and state inconsistency.

Do not connect the current in-memory service to real funds or production custody without a separate security review, durable storage, authenticated APIs, operational controls, and blockchain integration testing.
