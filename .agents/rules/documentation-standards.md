---
description: Global Documentation Standards for Python, TypeScript, and JavaScript (File & Function Docstrings)
globs: ['**/*.py', '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx']
version: 2.0.0
alwaysApply: true
trigger: always_on
---

# Global Documentation Standards

This rule enforces professional, standardized documentation across all Python and JavaScript/TypeScript source files. Consistent documentation enables AI agents, static analysis tools, and developers to understand intent, usage, and behavior without reading implementation details.

---

## 1. File-Level Docstrings (Mandatory)

Every source file **must begin with a docstring** as its very first statement — before any imports, exports, or code. This is enforced for all `.py`, `.ts`, `.tsx`, `.js`, and `.jsx` files.

### 1.1 TypeScript / JavaScript (`.ts`, `.tsx`, `.js`, `.jsx`)

```ts
/**
 * @file AuthService.ts
 * @description Handles user authentication, session management, and token refresh logic.
 *
 * @features
 * - JWT-based login and logout flows
 * - Automatic token refresh with exponential backoff
 * - Role-based access control (RBAC) helpers
 *
 * @dependencies axios, jsonwebtoken
 * @sideEffects Writes session tokens to localStorage; calls /api/auth on mount
 */
```

**Field reference:**

| Field           | Required           | Description                                       |
| --------------- | ------------------ | ------------------------------------------------- |
| `@file`         | ✅                 | Exact filename with extension                     |
| `@description`  | ✅                 | One-sentence summary of the file's purpose        |
| `@features`     | ✅                 | Bullet list of key responsibilities (2–5 items)   |
| `@dependencies` | ⚠️ Omit if trivial | Major non-stdlib external packages                |
| `@sideEffects`  | ⚠️ Omit if none    | API calls, storage writes, global state mutations |

---

### 1.2 Python (`.py`)

Python file docstrings use **plain prose with labeled sections** — not JSDoc-style `@tags`. Python tooling (Sphinx, pdoc, mkdocs) does not parse `@` tags in module docstrings.

```python
"""
auth_service.py

Handles user authentication, session management, and token refresh logic.

Features:
    - JWT-based login and logout flows
    - Automatic token refresh with exponential backoff
    - Role-based access control (RBAC) helpers

Dependencies: PyJWT, requests
Side Effects: Writes session data to Redis; calls external OAuth provider on init
"""
```

**Field reference:**

| Field             | Required           | Description                                      |
| ----------------- | ------------------ | ------------------------------------------------ |
| Filename (line 1) | ✅                 | Exact filename with extension                    |
| Summary (line 3)  | ✅                 | One-sentence description of purpose              |
| `Features:`       | ✅                 | Indented bullet list of key responsibilities     |
| `Dependencies:`   | ⚠️ Omit if trivial | Major non-stdlib packages                        |
| `Side Effects:`   | ⚠️ Omit if none    | DB writes, API calls, file I/O, global mutations |

> **Note:** The blank line between the filename and summary is intentional — it matches PEP 257's multi-line docstring convention and improves rendering in documentation generators.

---

## 2. Function & Method Docstrings (Mandatory)

All of the following **must** have a docstring:

- All exported / public functions and methods
- All class methods (except trivial property accessors — see §2.3)
- Complex internal helpers where behavior is non-obvious

### 2.1 TypeScript / JavaScript (JSDoc)

```ts
/**
 * Refreshes the user's JWT token using the stored refresh token.
 *
 * Implements exponential backoff on failure, up to MAX_RETRIES attempts.
 * Emits a `session:expired` event if all retries are exhausted.
 *
 * @param {string} refreshToken - The refresh token stored in the session.
 * @param {number} [retryCount=0] - Current retry attempt (used internally for recursion).
 * @returns {Promise<AuthToken>} Resolves with a new AuthToken on success.
 * @throws {SessionExpiredError} When all retry attempts have been exhausted.
 * @throws {NetworkError} When the auth endpoint is unreachable.
 */
export const refreshAuthToken = async (
  refreshToken: string,
  retryCount = 0
): Promise<AuthToken> => { ... }
```

**Rules:**

- The opening line is a **brief imperative-mood summary** (e.g., "Refreshes...", not "This function refreshes...").
- An optional second paragraph describes algorithm details, business logic, or important caveats.
- Every parameter in the signature, including optionals, must appear in `@param`. Mark optional params with square brackets: `[paramName=default]`.
- `@returns` is required unless the function returns `void` / `Promise<void>`.
- `@throws` is required for all explicitly thrown errors. List each error type separately.

---

### 2.2 Python (Google Style)

Python docstrings follow **Google style** strictly. Do not use NumPy style or reStructuredText (Sphinx `:param:`) style — these are inconsistent with the tooling this project uses.

```python
def refresh_auth_token(refresh_token: str, retry_count: int = 0) -> AuthToken:
    """Refreshes the user's JWT token using the stored refresh token.

    Implements exponential backoff on failure, up to MAX_RETRIES attempts.
    Emits a session_expired event if all retries are exhausted.

    Args:
        refresh_token (str): The refresh token stored in the session.
        retry_count (int): Current retry attempt, used internally for recursion.
            Defaults to 0.

    Returns:
        AuthToken: A new AuthToken instance with updated expiry.

    Raises:
        SessionExpiredError: When all retry attempts have been exhausted.
        NetworkError: When the auth endpoint is unreachable.
    """
```

**Rules:**

- The **summary line** is on the same line as the opening `"""`, imperative mood, no period required.
- A blank line separates the summary from any extended description.
- `Args:` lists every parameter. Indent continuation lines by 8 spaces (4 for the section, 4 for the continuation).
- `Returns:` is required unless the return type is `None`.
- `Raises:` lists each exception that can propagate to the caller. Internal exceptions that are always caught and re-raised under a different type should document the final raised type.
- Type hints in `Args` should match the signature exactly.

**One-liner form** (acceptable for trivial functions only):

```python
def is_authenticated(user_id: str) -> bool:
    """Returns True if the given user has an active session."""
```

Use the one-liner form only when the function has no parameters requiring explanation and no non-obvious behavior. If in doubt, use the multi-line form.

---

### 2.3 Class Docstrings (Python)

The class docstring belongs on the **class**, not on `__init__`. It describes the class's purpose and documents public attributes. The `__init__` docstring, if present, documents only initialization-specific behavior or side effects — not the attributes (those belong in the class docstring).

```python
class AuthService:
    """Manages user authentication and session lifecycle.

    Coordinates JWT issuance, validation, and refresh flows. Interacts with
    the Redis session store and the external OAuth provider.

    Attributes:
        max_retries (int): Maximum number of token refresh attempts before
            raising SessionExpiredError.
        session_store (RedisClient): Client for reading and writing session data.
    """

    def __init__(self, session_store: RedisClient, max_retries: int = 3) -> None:
        """Initializes AuthService and establishes a connection to the session store."""
        self.session_store = session_store
        self.max_retries = max_retries
```

---

### 2.4 TypeScript / JavaScript Class Docstrings

```ts
/**
 * Manages user authentication and session lifecycle.
 *
 * Coordinates JWT issuance, validation, and refresh flows. Interacts with
 * the Redis session store and the external OAuth provider.
 *
 * @property {number} maxRetries - Maximum retry attempts before throwing SessionExpiredError.
 * @property {RedisClient} sessionStore - Client for reading and writing session data.
 */
export class AuthService {
  constructor(
    private sessionStore: RedisClient,
    private maxRetries = 3,
  ) {}
}
```

---

## 3. What NOT to Document

Certain constructs do not require docstrings and adding them creates noise:

| Construct                                             | Rule                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| Simple property accessors (`get id()`, `@property`)   | No docstring needed if the name is self-evident                  |
| `__str__`, `__repr__`, `__len__`                      | No docstring needed; behavior is implied by the dunder protocol  |
| Test functions (`test_*`, `it(...)`, `describe(...)`) | No docstring needed; the test name is the documentation          |
| Type aliases and interfaces (TS)                      | Use an inline `//` comment if clarification is needed, not JSDoc |
| `__init__.py` with no module-level logic              | May use a one-liner: `"""Authentication subsystem."""`           |

---

## 4. Best Practices

### 4.1 Document the _Why_, Not the _What_

Code shows _what_ happens. Docstrings explain _why_ it happens, _when_ it should be used, and _what assumptions_ it makes.

```python
# ❌ Redundant — restates the code
def get_user(user_id: str) -> User:
    """Gets a user by user_id and returns a User object."""

# ✅ Adds value
def get_user(user_id: str) -> User:
    """Fetches a user from the primary database, with fallback to read replica.

    Uses the read replica when the primary is under high load (>80% CPU).
    Always returns a fully hydrated User object; raises UserNotFoundError
    rather than returning None to avoid silent null-propagation bugs.
    """
```

### 4.2 Keep Docstrings in Sync

Outdated docstrings are worse than no docstrings. When a function signature or behavior changes:

- Update `@param` / `Args` to match the new signature exactly.
- Update `@returns` / `Returns` if the return type or shape changes.
- Remove `@throws` / `Raises` entries for errors that are no longer thrown.

### 4.3 Completeness

- **Every parameter** in the signature must appear in `@param` or `Args`, including those with defaults.
- **Optional parameters** must document their default value and the behavior when the default is used.
- **Union types** must document the meaning and behavior for each branch if they differ.

### 4.4 Tone and Style

- Use **imperative mood** for the summary line: "Fetches", "Validates", "Returns" — not "This function fetches".
- Write for the **caller**, not the implementer. Describe inputs, outputs, and contract — not internal steps.
- Avoid filler words: "simply", "just", "obviously", "easily".
- Keep summaries to **one sentence**. Move all additional context to the extended description.

### 4.5 Tooling Compatibility

- Python docstrings are parsed by **Sphinx** and **pdoc**. Do not use JSDoc `@` tags inside Python docstrings.
- TypeScript/JavaScript docstrings are parsed by **TypeDoc** and **JSDoc**. Keep tag names consistent (`@param`, `@returns` — not `@return`).
- Avoid HTML in docstrings unless your documentation generator explicitly requires it.

---

## 4.6 Entry Point Documentation

All service entry point files (e.g., `bot.ts`, `bot-trader.ts`, `relay.ts`, `client.ts`) **must** be documented in `docs/ENTRY_POINTS.md`. This document serves as the authoritative reference for:

- Purpose and responsibilities of each entry point
- When to use each entry point
- Command-line arguments and environment variables
- Port assignments and network configuration
- Data flow and architecture diagrams

**Entry Point File Docstring Requirements:**

Every entry point file must include a comprehensive file-level docstring that identifies it as an entry point:

```typescript
/**
 * @file bot.ts
 * @description Monitor Service entry point - aggregates blockchain data and broadcasts via WebSocket.
 *
 * @entryPoint
 * @service Monitor
 * @port 10102
 *
 * @features
 * - Connects to blockchain providers (BitQuery, PumpFun)
 * - Aggregates token metrics and price data
 * - Broadcasts aggregation updates via WebSocket server
 * - Runs monitor-only strategies (no swap execution)
 *
 * @usage
 * npx tsx src/bot.ts --strategy MONITOR_PUMPFUN_ALL --run-server
 *
 * @dependencies ws, express, pumpdotfun-sdk
 * @sideEffects Connects to external blockchain providers; writes to MongoDB; broadcasts on port 10102
 */
```

**For Python entry points:**

```python
"""
bot.py

Monitor Service entry point - aggregates blockchain data and broadcasts via WebSocket.

Entry Point: Yes
Service: Monitor
Port: 10102

Features:
    - Connects to blockchain providers (BitQuery, PumpFun)
    - Aggregates token metrics and price data
    - Broadcasts aggregation updates via WebSocket server
    - Runs monitor-only strategies (no swap execution)

Usage:
    python src/bot.py --strategy MONITOR_PUMPFUN_ALL --run-server

Dependencies: websockets, pymongo, solana
Side Effects: Connects to external blockchain providers; writes to MongoDB; broadcasts on port 10102
"""
```

**Key fields for entry point docstrings:**

| Field                              | Required | Description                              |
| ---------------------------------- | -------- | ---------------------------------------- |
| `@entryPoint` / `Entry Point: Yes` | ✅       | Identifies this as a service entry point |
| `@service` / `Service:`            | ✅       | Service name (Monitor, Bot, Relay, etc.) |
| `@port` / `Port:`                  | ✅       | Primary port used by this service        |
| `@usage` / `Usage:`                | ✅       | Command to run this entry point          |
| `@features` / `Features:`          | ✅       | Key responsibilities (2-5 items)         |

> **Note:** After adding a new entry point, update `docs/ENTRY_POINTS.md` with full documentation including architecture diagrams, data flow, and environment variable details.

---

## 5. Examples at a Glance

### Python — Complete Example

```python
"""
payment_processor.py

Processes payment transactions and manages refund workflows.

Features:
    - Stripe and PayPal gateway integrations
    - Idempotent transaction submission via request IDs
    - Automatic retry with exponential backoff on transient failures

Dependencies: stripe, paypalrestsdk
Side Effects: Writes transaction records to PostgreSQL; calls external payment APIs
"""

from decimal import Decimal


class PaymentProcessor:
    """Orchestrates payment submission and refund processing across multiple gateways.

    Selects the appropriate gateway based on currency and region. All transactions
    are idempotent — submitting the same request_id twice returns the original result.

    Attributes:
        gateway (str): Active payment gateway identifier ('stripe' or 'paypal').
        max_retries (int): Maximum retry attempts on transient network failures.
    """

    def __init__(self, gateway: str, max_retries: int = 3) -> None:
        """Initializes PaymentProcessor and validates gateway configuration."""
        self.gateway = gateway
        self.max_retries = max_retries

    def charge(self, amount: Decimal, currency: str, request_id: str) -> Transaction:
        """Submits a charge to the configured payment gateway.

        The request_id is used for idempotency — retrying with the same ID will
        return the original transaction rather than creating a duplicate charge.

        Args:
            amount (Decimal): Charge amount in the specified currency's minor units.
            currency (str): ISO 4217 currency code (e.g., 'USD', 'EUR').
            request_id (str): Caller-provided unique ID for idempotent submission.

        Returns:
            Transaction: Confirmed transaction object with gateway reference ID.

        Raises:
            PaymentDeclinedError: When the gateway rejects the charge.
            GatewayTimeoutError: When the gateway does not respond within the timeout.
            InvalidCurrencyError: When the currency is not supported by the gateway.
        """
```

---

### TypeScript — Complete Example

```ts
/**
 * @file PaymentProcessor.ts
 * @description Orchestrates payment submission and refund processing across multiple gateways.
 *
 * @features
 * - Stripe and PayPal gateway integrations
 * - Idempotent transaction submission via request IDs
 * - Automatic retry with exponential backoff on transient failures
 *
 * @dependencies stripe, @paypal/payouts-sdk
 * @sideEffects Calls external payment APIs; emits `payment:complete` and `payment:failed` events
 */

/**
 * Orchestrates payment submission and refund processing across multiple gateways.
 *
 * Selects the appropriate gateway based on currency and region. All transactions
 * are idempotent — submitting the same requestId twice returns the original result.
 *
 * @property {string} gateway - Active payment gateway identifier ('stripe' | 'paypal').
 * @property {number} maxRetries - Maximum retry attempts on transient network failures.
 */
export class PaymentProcessor {
  constructor(
    private readonly gateway: 'stripe' | 'paypal',
    private readonly maxRetries = 3
  ) {}

  /**
   * Submits a charge to the configured payment gateway.
   *
   * The requestId is used for idempotency — retrying with the same ID returns
   * the original transaction rather than creating a duplicate charge.
   *
   * @param {number} amount - Charge amount in the currency's minor units (e.g., cents).
   * @param {string} currency - ISO 4217 currency code (e.g., 'USD', 'EUR').
   * @param {string} requestId - Caller-provided unique ID for idempotent submission.
   * @returns {Promise<Transaction>} Resolves with a confirmed Transaction on success.
   * @throws {PaymentDeclinedError} When the gateway rejects the charge.
   * @throws {GatewayTimeoutError} When the gateway does not respond within the timeout.
   * @throws {InvalidCurrencyError} When the currency is not supported by the gateway.
   */
  async charge(amount: number, currency: string, requestId: string): Promise<Transaction> { ... }
}
```
