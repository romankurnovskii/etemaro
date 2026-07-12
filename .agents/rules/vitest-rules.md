---
description: TDD rules for TypeScript vitest in this monorepo. Apply to all *.test.ts and *.spec.ts files.
globs: ['**/*.test.ts', '**/*.spec.ts', '**/*.test.tsx']
alwaysApply: true
---

# vitest TDD Rules — Find Bugs, Don't Mirror Code

## Prime Directive

A test that cannot fail is not a test. Before committing any test, ask:
**"What production bug would this catch?"** If the answer is "none," delete it.

---

## 🔴 CRITICAL — These patterns are forbidden

### 1. Never wrap async calls in `not.toThrow()`

Swallowing a rejection with `.catch(() => {})` makes a test structurally
incapable of failing. This pattern tests nothing.

```ts
// ❌ FORBIDDEN — cannot ever fail
expect(() => {
  service.getAllPositions(address, { chain: 'bsc' }).catch(() => {});
}).not.toThrow();

// ✅ REQUIRED — await and assert the resolved value
const result = await service.getAllPositions(address, { chain: 'bsc' });
expect(result).toEqual(expect.arrayContaining([expect.objectContaining({ chain: 'bsc' })]));
```

### 2. Never assert `toBeInstanceOf(Promise)`

Every `async` function returns a `Promise`. Asserting this tests JavaScript,
not your code.

```ts
// ❌ FORBIDDEN
const result = service.getAllPositions(address, { chain: 'bsc' });
expect(result).toBeInstanceOf(Promise);

// ✅ REQUIRED — await and assert the value
const positions = await service.getAllPositions(address, { chain: 'bsc' });
expect(positions.length).toBeGreaterThan(0);
expect(positions[0].chain).toBe('bsc');
```

### 3. Never use `> 0n` for deterministic BigInt output

If the inputs are fixed, the output is deterministic. Directional assertions
only catch the sign, not the magnitude.

```ts
// ❌ FORBIDDEN — passes if off by 1000x
expect(amount0).toBeGreaterThan(0n);

// ✅ REQUIRED — assert exact value for known inputs
expect(amount0).toBe(4995n);
expect(amount1).toBe(4995n);

// ✅ ACCEPTABLE only for range tests where exact value is not the point
// (document why exact value is not asserted)
```

### 4. Never use inline `(Service as any).method` in test bodies

`any` casts bypass TypeScript's type checker. A refactor that renames or
removes the method will cause a silent runtime failure instead of a compile error.

```ts
// ❌ FORBIDDEN — scattered any casts
const price = (PancakeService as any).tickToPriceAdjusted(0, 18, 18);

// ✅ REQUIRED — extract pure functions to a utility module
// src/utils/tick-math.ts  →  export function tickToPriceAdjusted(...)
import { tickToPriceAdjusted } from '../../utils/tick-math';
expect(tickToPriceAdjusted(0, 18, 18)).toBe(1);

// ✅ ACCEPTABLE if refactor is pending — consolidate into one typed accessor
// at describe scope, never inline
const PancakeMath = {
  tickToPriceAdjusted: (tick: number, d0: number, d1: number) =>
    (PancakeService as any).tickToPriceAdjusted(tick, d0, d1),
};
// Then use PancakeMath.tickToPriceAdjusted(...) throughout — never re-cast inline
```

### 5. Never use `||` in an assertion

`a === x || a === y` means you don't know the contract. Undefined contracts
produce tests that can never catch regressions.

```ts
// ❌ FORBIDDEN — passes for either value, documents nothing
expect(position.chain_id === '8453' || position.chain_id === 'base').toBe(true);

// ✅ REQUIRED — pick the canonical value and enforce it
expect(position.chain_id).toBe('8453');

// ✅ ACCEPTABLE if both are genuinely valid (document why)
expect(['8453', 'base']).toContain(position.chain_id);
// Note: chain_id may be either numeric string or slug depending on source
```

---

## 🟡 REQUIRED PATTERNS

### 6. Every `toBeCloseTo` must document its tolerance

Floating-point tolerance is not arbitrary. Every `toBeCloseTo(x, n)` call
must explain the error source and why `n` decimal places is correct.

```ts
// ❌ UNEXPLAINED
expect(price).toBeCloseTo(1.105, 2);

// ✅ EXPLAINED
// 1.0001^1000 ≈ 1.10517. Tolerance: 2 decimal places (1e-2) because
// Math.pow accumulates ~0.001% floating-point error over 1000 multiplications.
expect(price).toBeCloseTo(1.105, 2);
```

### 7. BigInt symmetry tests must stay in BigInt space

Never convert Q96-scale BigInts to `Number` for comparison — they exceed
`Number.MAX_SAFE_INTEGER` and will silently lose precision.

```ts
// ❌ DANGEROUS — silent precision loss
const product = Number(pos * neg) / Number(Q96);
expect(product).toBeCloseTo(Number(Q96), 0);

// ✅ SAFE — BigInt arithmetic throughout
const product = pos * neg;
const expected = Q96 * Q96;
const tolerance = expected / 1_000_000n; // 1 ppm
const diff = product > expected ? product - expected : expected - product;
expect(diff < tolerance).toBe(true);
```

### 8. Mock only what crosses an I/O boundary

Mock network calls, RPC providers, filesystem reads, and database queries.
Never mock the module under test or pure math functions.

```ts
// ❌ WRONG BOUNDARY — mocking the thing being tested
vi.mock('../pancake.service', () => ({ PancakeService: { getAllPositions: vi.fn() } }));

// ✅ RIGHT BOUNDARY — mock the RPC transport
vi.mock('../../rpc/provider', () => ({ getProvider: () => mockProvider }));
```

If after mocking, your test only asserts that the mock's return value came back
unchanged — delete the test.

### 9. `expect.arrayContaining` + membership over count alone

```ts
// ❌ INCOMPLETE
expect(position.receiptTokenAddresses).toHaveLength(2);

// ✅ COMPLETE
expect(position.receiptTokenAddresses).toHaveLength(2);
expect(position.receiptTokenAddresses).toContain('0x46a15b0b27311cedf172ab29e4f4766fbe7f4364');
```

---

## 🔵 STANDARD RULES

### 10. No duplicate coverage across files

Before adding tests for a utility (e.g. `bnToHuman`), check if coverage
already exists in another test file. Duplication means two failure sites for
one bug and two places to update when behavior changes.

Rule: each function/module has one canonical test file. Cross-file tests are
permitted only for integration behavior that spans modules.

### 11. Shared constants must be extracted to `describe` scope

Never redeclare the same array or constant in multiple `it` blocks.

```ts
// ❌ REPEATED — changing chain list requires N edits
it('test 1', () => { const chains = ['bsc','base','ethereum']; ... });
it('test 2', () => { const chains = ['bsc','base','ethereum']; ... });

// ✅ EXTRACTED
const EXPECTED_CHAINS = ['bsc', 'base', 'ethereum', 'arbitrum', 'polygon_zkevm', 'zksync', 'linea'] as const;
describe('Chain Configs', () => {
  it('test 1', () => { EXPECTED_CHAINS.forEach(...) });
  it('test 2', () => { EXPECTED_CHAINS.forEach(...) });
});
```

### 12. Clean up unused imports immediately

An unused `vi` import signals missing mock setup or teardown.
Treat it as a failing lint rule — either use it or delete it.

```ts
// ❌ DEAD IMPORT
import { describe, it, expect, beforeEach, vi } from 'vitest';
// vi is never used in this file

// ✅ CLEAN
import { describe, it, expect } from 'vitest';
```

### 13. Known-value spot checks for config/registry tests

Structural tests (required fields, valid types) must be paired with at least
two known-value spot checks for specific entries.

```ts
// ✅ STRUCTURAL — covers all chains
EXPECTED_CHAINS.forEach((key) => {
  expect(Number.isInteger(CHAIN_CONFIGS[key].chainId)).toBe(true);
  expect(CHAIN_CONFIGS[key].nfpmAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
});

// ✅ SPOT CHECK — catches copy-paste errors for specific chains
expect(CHAIN_CONFIGS.bsc.chainId).toBe(56);
expect(CHAIN_CONFIGS.ethereum.chainId).toBe(1);
expect(CHAIN_CONFIGS.arbitrum.chainId).toBe(42161);
```

### 14. Reward/underlying asset tests must assert symbols, not just count

```ts
// ❌ INCOMPLETE — passes if wrong tokens are present
expect(rewardAssets).toHaveLength(3);

// ✅ COMPLETE
expect(rewardAssets).toHaveLength(3);
expect(new Set(rewardAssets.map((a) => a.symbol))).toEqual(new Set(['WETH', 'USDC', 'CAKE']));
```

### 15. Tag regression tests with issue references

```ts
it('should not throw NameError when GenericPosition is imported', () => {
  // regression: GH-412 — NameError: name 'GenericPosition' is not defined
  // Fixed: PR #418 — added missing import in uniswap_v3.ts
  const pos = UniswapV3Parser.toGenericPosition(raw, { wallet, chainId: 56 });
  expect(pos).not.toBeNull();
  expect(pos!.positionId).toBe('181830');
});
```

### 16. Lossy operations must have boundary tests

If a function truncates, rounds, or caps values, test the exact boundary:
the largest input that produces zero, and the smallest that produces non-zero.

```ts
// bnToHuman caps at 6 decimals:
expect(bnToHuman(99999999999n, 18)).toBe('0'); // below cap → rounds to 0
expect(bnToHuman(100000000000n, 18)).toBe('0.0001'); // at cap boundary → non-zero
expect(bnToHuman(100000000001n, 18)).toBe('0.0001'); // above cap → truncated not rounded up
```

---

## Test File Checklist

Before opening a PR, verify each test file:

- [ ] Every `it` block contains at least one assertion that can fail
- [ ] No `toBeInstanceOf(Promise)` or `.not.toThrow()` over async calls
- [ ] No `> 0n` assertions where inputs are deterministic
- [ ] No inline `(X as any)` casts — use a typed accessor or utility module
- [ ] No `||` in assertions
- [ ] Every `toBeCloseTo` has a comment explaining its tolerance
- [ ] No BigInt converted to `Number` for Q96-scale comparisons
- [ ] No unused imports (`vi`, `beforeEach`, etc.)
- [ ] No duplicate coverage of the same function as another test file
- [ ] Shared constant arrays extracted to `describe` scope
- [ ] Config/registry tests include at least 2 known-value spot checks
- [ ] Asset role tests assert symbol set, not just length
- [ ] Lossy functions have boundary tests
- [ ] Regression tests have issue/PR references
