---
description: description: TypeScript/React architecture — file docstrings required in all .ts/.tsx files; container/component split, Zustand state, directory roles, testing patterns. Apply when writing or modifying any .ts/.tsx file.
trigger: always_on
globs: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}', 'frontend/src/**/*.{ts,tsx}']
alwaysApply: false
version: 3.0.2
---

# TypeScript & React Architecture Standards

This rule enforces file-level docstrings across **all** TypeScript files in the monorepo.
Sections 3–11 (architecture, components, state, routing, testing) apply only to the **React frontend** (`apps/frontend/src/`).

## 1. Response Constraints (Strict)

- **Preservation**: Do NOT remove existing code, comments, or commented-out code unless explicitly asked or strictly necessary for the refactor.
- **Formatting**: Do NOT change the formatting of existing imports.
- **Style**: Follow the project's Prettier config (`singleQuote: true`, `printWidth: 95`, `trailingComma: 'all'`).

---

## 2. File Docstrings (Mandatory — ALL .ts / .tsx files)

**Every `.ts` and `.tsx` file in the monorepo must begin with a docstring comment** before any imports or directives. This enables agents and developers to instantly understand a file's purpose without reading its implementation.

> ⚠️ Exception: Top-level re-export barrel files (`index.ts` that only re-export from other modules) may omit a docstring if the re-exports are self-evident from the filename and directory context.

### Docstring Format

```ts
/**
 * @file <FileName>.tsx
 * @description <One-sentence summary of what this file does.>
 *
 * @features
 * - <Key feature or responsibility #1>
 * - <Key feature or responsibility #2>
 * - <Key feature or responsibility #3 (add more as needed)>
 *
 * @dependencies <Major external deps, e.g. Zustand, React Query, Axios — omit if trivial>
 * @sideEffects <Any side effects: API calls, localStorage, subscriptions — omit if none>
 */
```

### Rules

- **Required in every file**: `.ts`, `.tsx`, stores, services, types, utils, hooks, configs.
- **`@description`**: One sentence. Answers: _"What is this file's single job?"_
- **`@features`**: 2–5 bullets covering the main responsibilities or exported symbols. Agents use this to decide if a file is relevant to a task — be specific.
- **`@dependencies` / `@sideEffects`**: Include only when non-obvious. Omit if the file is pure logic with no external deps.
- **Keep it current**: When you modify a file's behavior, update its docstring.

---

## 3. Method & Function Docstrings (Mandatory)

All public methods, exported functions, and complex internal helpers MUST have a JSDoc-style docstring.

### Format

```ts
/**
 * <Brief description of the function's purpose.>
 *
 * @param {Type} <name> - <Description of the parameter.>
 * @returns {Type} - <Description of the return value.>
 */
```

### Rules

- **Required for**: All exported functions, store actions, service methods, and complex hooks.
- **Param types**: Must match exactly with TypeScript types.
- **Description**: Explain the "why" and any non-obvious logic.

### Examples by File Type

**Container:**

```tsx
/**
 * @file ProfileContainer.tsx
 * @description Smart container that wires user profile data and update logic to ProfileForm.
 *
 * @features
 * - Subscribes to `useUserStore` for current user and loading state
 * - Dispatches `updateUser` action on form submission
 * - Renders loading spinner while data is in-flight
 *
 * @dependencies useUserStore (Zustand), updateUser (service)
 * @sideEffects Triggers PUT /api/users/:id on form submit
 */
```

**Presentational Component:**

```tsx
/**
 * @file ProfileForm.tsx
 * @description Dumb UI component that renders the user profile edit form.
 *
 * @features
 * - Displays editable fields: name, email, avatar URL
 * - Calls `onUpdate` prop callback on valid form submission
 * - No store access — all data received via props
 */
```

**Zustand Store:**

```ts
/**
 * @file useUserStore.ts
 * @description Global Zustand store managing authenticated user state and profile updates.
 *
 * @features
 * - Holds `user`, `isLoading`, and `error` state slices
 * - Exposes `fetchUser(id)` and `updateUser(payload)` async actions
 * - Resets state on logout via `clearUser()`
 *
 * @sideEffects Calls GET /api/users/:id and PUT /api/users/:id
 */
```

**Service:**

```ts
/**
 * @file userApi.ts
 * @description Axios-based service for all User resource API calls.
 *
 * @features
 * - `getUser(id)` — fetches a single user by ID
 * - `updateUser(id, payload)` — updates user profile fields
 * - `deleteUser(id)` — soft-deletes a user account
 *
 * @dependencies axios (baseURL from lib/axiosConfig)
 * @sideEffects Network requests to /api/users
 */
```

**Types File:**

```ts
/**
 * @file user.ts
 * @description Shared TypeScript interfaces for the User domain.
 *
 * @features
 * - `User` — full user object returned from the API
 * - `UserUpdatePayload` — partial type for profile edit submissions
 * - `UserRole` — union type for permission levels
 */
```

---

## 3. The Container / Component Split (Core Pattern — Frontend only)

This is the **most important architectural rule for the frontend**. Every feature must separate _what data to fetch/manage_ from _how to render it_.

### Container (Smart Component)

- Lives in `src/pages/` or `src/pages/[feature]/containers/`
- Owns: data fetching, store subscriptions, event handlers, business logic
- Renders: only the corresponding Presentational Component, passing data via props
- ❌ **No inline JSX markup beyond layout wrappers**

```tsx
/**
 * @file ProfileContainer.tsx
 * @description Wires user profile data from useUserStore to the ProfileForm component.
 *
 * @features
 * - Subscribes to user and isLoading from useUserStore
 * - Handles profile update submission via handleUpdate
 * - Shows Spinner during loading
 *
 * @dependencies useUserStore, updateUser
 * @sideEffects PUT /api/users/:id on form submit
 */
export const ProfileContainer = () => {
  const { user, isLoading } = useUserStore();
  const handleUpdate = (data: UserUpdatePayload) => updateUser(data);

  if (isLoading) return <Spinner />;
  return <ProfileForm user={user} onUpdate={handleUpdate} />;
};
```

### Component (Dumb / Presentational)

- Lives in `src/components/[domain]/` or colocated in `src/pages/[feature]/components/`
- Owns: UI rendering, local UI state (open/closed, hover), animations
- Receives: all data and callbacks via **typed props**
- ❌ **No direct store access, no API calls**

```tsx
/**
 * @file ProfileForm.tsx
 * @description Renders the user profile edit form; purely presentational.
 *
 * @features
 * - Displays name, email, and avatar fields
 * - Invokes onUpdate callback on valid submit
 */
interface Props {
  user: User;
  onUpdate: (data: UserUpdatePayload) => void;
}

export const ProfileForm = ({ user, onUpdate }: Props) => (
  <form onSubmit={...}>...</form>
);
```

### The Rule of Thumb

> If a component does **two things** (fetch + render), split it into a Container + Component.

---

## 4. Directory Roles & Architecture (Frontend only)

```
apps/frontend/src/
├── app/
│   ├── page.tsx                     ← Route entry, composes containers
│   ├── layout.tsx                   ← Root layout (HTML shell, metadata)
│   ├── error.tsx / not-found.tsx    ← Error and 404 boundaries
│   ├── api/                         ← Next.js API route handlers
│   ├── containers/                  ← Smart: data fetching + business logic
│   │   └── AriaVegaContainer.tsx
│   ├── components/
│   │   ├── layout/                  ← App chrome (Sidebar, Header, Footer)
│   │   ├── ui/                      ← Generic dumb components (EventLog, etc.)
│   │   ├── [domain]/               ← Domain dumb components (positions, wallets, etc.)
│   │   ├── assignments/
│   │   ├── steps/
│   │   └── strategies/
│   ├── hooks/                       ← Custom React hooks (data fetching, polling)
│   ├── stores/                      ← Zustand: global state + business logic
│   ├── types/                       ← Shared TypeScript interfaces
│   └── utils/                       ← Pure utility functions
└── pages/                           ← Legacy Pages Router (404 only)
```

**Colocation rule**: If a component is used _only_ inside one page/feature, keep it in `apps/frontend/src/app/components/[feature]/`. Don't pollute the global `components/` namespace.

---

## 5. Component Atomization (Frontend only)

- **Split aggressively**: Data Fetching + UI Rendering → always two files
- **Max length**: Components should rarely exceed **150 lines**
- **Single responsibility**: One component = one job

---

## 6. Coding Style & TypeScript

- **Functional only**: No classes. Use functional components and pure functions.
- **Named exports**: `export const Button = ...` — no default exports.
- **Interfaces over types**: `interface Props {}` for component props.
- **No enums**: Use `const` maps or string unions.
- **Syntax**:
  - `function` keyword for pure logic/util functions
  - `const` for components and variables
  - Declarative JSX always

---

## 7. State Management (Zustand — Frontend only)

- Business logic and side-effect orchestration live in stores, not components.
- Containers subscribe to stores; Components receive data as props.
- Keep stores sliced by domain: `useUserStore`, `useCartStore`, etc.

---

## 8. Routing (Next.js App Router — Frontend only)

- **File-based routing**: Use Next.js App Router conventions (`app/` directory, page.tsx, layout.tsx, route.ts).
- **URL = source of truth** for top-level app state.
- **No virtual routers**: Never use `useState` or Zustand to simulate page navigation.
- Use Next.js navigation primitives (`useRouter`, `useParams`, `useSearchParams`, `Link`).
- **Protected routes**: Use a middleware or layout wrapper to redirect unauthenticated users.

---

## 9. Testing (Frontend & Backend)

- **Placement**: Co-locate test files next to the module they test, e.g. `utils/format.test.ts`, `stores/app-store.test.ts`.
- **Libraries** (when added): `@testing-library/react` + `@testing-library/user-event` + Vitest or Jest.
- **Pattern**:
  - Unit tests for pure logic, utils, and stores
  - Integration tests for Components using `render()` + `screen`
  - Containers tested by mocking stores and verifying prop flow

---

## 10. Performance Optimization (Frontend only)

- Immutable state updates (never mutate directly).
- `useMemo` for expensive derived data; avoid premature optimization on simple props.
- Use React Query (if available) for server-state caching in Containers.

---

## 11. Feature Implementation Checklist (Frontend only)

When adding a feature (e.g., "User Profile"):

1. **`apps/frontend/src/app/types/user.ts`** — Define interfaces (+ docstring listing exported types)
2. **`apps/frontend/src/app/hooks/useUserApi.ts`** — Add data-fetching hook with API calls (+ docstring listing endpoints + side effects)
3. **`apps/frontend/src/app/stores/useUserStore.ts`** — Add global state + logic (+ docstring listing state slices + actions)
4. **`apps/frontend/src/app/components/user/`** — Build reusable dumb UI components (+ docstring per file)
5. **`apps/frontend/src/app/containers/UserContainer.tsx`** — Wire data to UI (+ docstring listing deps + side effects)
6. **`apps/frontend/src/app/page.tsx` or App Router route** — Assemble containers, handle routing (+ docstring listing composed containers)
