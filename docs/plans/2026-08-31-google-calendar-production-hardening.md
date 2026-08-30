# Google Calendar production hardening

## Scope

Keep Nautilus Log's existing explicit, read-only sync for the connected Google
account's primary calendar and dated Google Tasks. This pass does not add a
calendar picker or multi-calendar sync.

## Authorization

- Use OAuth 2.0 Authorization Code with PKCE (`S256`) for both popup and
  Desktop handoff flows.
- Store the verifier encrypted in a short-lived D1 authorization transaction.
- Bind every transaction to the Roam origin and nonce, and consume it once
  before exchanging the Google authorization code.
- Point new production authorizations directly at the production callback.
  Keep the Preview bridge only as a short transition path for already-open
  authorization flows.

## Sync resilience

- Retry only transient network failures, HTTP 429, and HTTP 5xx responses.
- Keep retries bounded, honor a short `Retry-After`, and never retry an aborted
  sync or an ordinary 4xx response.
- Preserve the existing one-time 401 token refresh behavior.

## Mapping maintenance

- Record when each Google mapping was last observed.
- Prune only old orphan mappings whose Roam parent block no longer exists.
- Never delete a Roam block during maintenance and never discard a live
  mapping merely because it is old.

## Verification

- Worker tests cover PKCE, one-time callbacks, popup/Desktop delivery, and
  legacy in-flight callback compatibility.
- Client tests cover retry boundaries and cancellation.
- Reconciler tests cover state migration and safe orphan pruning.
- Run the complete build and test suite before Preview and Production deploys.
