# Shared Bill Splitter

A full-stack bill-splitting application designed for shared households, built on Cloudflare Workers (Hono), Cloudflare D1 (SQLite), React 19, and Vite.

This project solves the problem of tracking shared living expenses without floating-point calculation errors, concurrency race conditions, or orphaned data. It includes an in-browser OCR bill scanner that works completely offline with zero third-party data leaks.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│                   React 19 Frontend                    │
│   • TanStack Router • Optimistic UI • Responsive CSS    │
│   • Client-Side OCR: Tesseract.js (PSM.AUTO) + PDF.js  │
└───────────────────────────┬────────────────────────────┘
                            │ JSON / Multipart HTTP
                            ▼
┌────────────────────────────────────────────────────────┐
│             Cloudflare Worker API (Hono)               │
│   • Strong Input Validation • Real MIME Magic Checks   │
│   • Idempotent Payment Handler • Atomic db.batch()     │
└───────────────────────────┬────────────────────────────┘
                            │ SQL Queries
                            ▼
┌────────────────────────────────────────────────────────┐
│               Cloudflare D1 (SQLite)                   │
│   • 5 Named Constraints • Foreign Keys • Strict Types  │
└────────────────────────────────────────────────────────┘
```

---

## 3 Core Architectural Decisions

When designing this bill splitter, I focused on safety, correctness, and deterministic financial math over superficial complexity. Here are the three most critical design decisions I made and the trade-offs behind each.

### Decision 1: The Database Guards the Money Rules (Defense-in-Depth)

Relying solely on application-level code to validate financial transactions is a known anti-pattern. If a developer accidentally bypasses a validation helper, or if a concurrent request sneaks through, invalid states can corrupt the ledger permanently.

To make the system inherently fail-safe, I pushed the core money and relationship rules into the SQLite database engine itself using **named constraints** in `api/migrations/0001_init.sql`:

| Constraint Name                       | Type          | What It Prevents                                                                                                                                                                      |
| ------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ck_bills_total_positive_integer`     | `CHECK`       | Disallows any bill total that is zero, negative, or a decimal. `typeof(total_cents) = 'integer'` guarantees that floating-point numbers like `10.5` cannot be stored in the database. |
| `ck_shares_paid_has_key`              | `CHECK`       | Prevents "half-paid" shares. A share must have **both** `paid_at` and `idempotency_key` populated, or neither.                                                                        |
| `fk_shares_bill` & `fk_shares_member` | `FOREIGN KEY` | Composite foreign keys referencing `(id, home_id)`. This guarantees that a share cannot be linked to a member belonging to a **different home** than the bill itself.                 |
| `uq_shares_bill_member`               | `UNIQUE`      | Ensures a member is assigned exactly one share per bill, preventing duplicate splits.                                                                                                 |
| `uq_members_home_position`            | `UNIQUE`      | Enforces a deterministic, collision-free join position (`position` integer) for each roommate, which decides who receives remainder cents.                                            |

> **Trade-off:** Enforcing strict schema constraints means future schema updates require careful migration scripts. However, in financial applications, this rigidity is an enormous benefit: even if an API route experiences a regression, the database acts as an unbreakable safety net that refuses corrupt data.

---

### Decision 2: Atomic Conditional `UPDATE` for Concurrency & Idempotency

When two roommates attempt to pay the same bill share at the exact same moment, or if a user double-clicks the "Pay" button on a flaky connection, a naive implementation ("read share $\to$ check status $\to$ write update") suffers from Time-Of-Check to Time-Of-Use (TOCTOU) race conditions.

To eliminate race conditions without requiring heavy external distributed lock services (like Redis or DynamoDB locks), I implemented payment processing as a **single atomic conditional `UPDATE`** directly in SQL:

```sql
UPDATE shares
SET paid_at = ?, idempotency_key = ?
WHERE id = ? AND bill_id = ? AND paid_at IS NULL
RETURNING id, member_id, amount_cents, paid_at;
```

#### How the execution flow works:

1. Because Cloudflare D1 runs writes sequentially, only **one** concurrent update matches the `paid_at IS NULL` predicate.
2. If the update modifies a row $\to$ The payment succeeded cleanly. Returns `200 OK`.
3. If no row was modified $\to$ The handler executes a single targeted `SELECT` to determine why:
   - **Share or bill missing?** $\to$ Returns `404 Not Found`.
   - **Already paid with the same `Idempotency-Key`?** $\to$ Safe replay. Returns `200 OK` with the existing timestamp.
   - **Already paid with a different key?** $\to$ Concurrency conflict. Returns `409 Conflict` (`"share already paid"`).

> **Trade-off:** Scoping the idempotency key directly to each share row means the key is tied specifically to that payment operation. For a larger enterprise system with thousands of distinct idempotent endpoints, a dedicated global idempotency table might be preferred; however, for this assignment, storing the key directly on the share is lean, fast, requires zero extra table joins, and guarantees 100% atomicity.

---

### Decision 3: Pure Deterministic Integer Maths & Batch Persistence

In JavaScript, floating-point arithmetic is notoriously unreliable (`0.1 + 0.2 === 0.30000000000000004`). In financial accounting, lost or gained fractions of a cent compound into ledger discrepancies.

I made the architectural rule that **all monetary amounts in the backend and database are stored strictly as whole integer cents**. All currency symbols (`$`, `€`, `₹`) and decimals are strictly presentation-layer concerns.

#### Remainder Distribution Algorithm

When dividing a bill that does not divide evenly (e.g., $10.00 / 1000¢ among 3 roommates):
1. `baseCents = Math.floor(totalCents / memberCount)` (e.g. `333¢`)
2. `remainderCents = totalCents % memberCount` (e.g. `1¢`)
3. The first `remainderCents` members in their chronological join order receive `baseCents + 1` (e.g. Member 1 gets `334¢`), and subsequent members receive `baseCents` (`333¢`, `333¢`).

This guarantees that:
$$\sum_{i=1}^{N} \text{share}_i \equiv \text{totalCents}$$
No cent is ever created or destroyed.

#### Atomic Single-Batch Creation

When a new bill is created, the bill record and all corresponding member share records are submitted using Cloudflare D1's `db.batch([...])`. This executes the entire creation process inside a single transactional block. If any share insertion fails, the entire transaction rolls back—preventing orphaned bills from ever existing.

> **Trade-off:** If a new roommate joins the household moments after a bill creation request is in-flight, they are not included in that bill. I chose this intentionally: bills reflect household tenancy at the time of creation, which mirrors how real-world utility and rent agreements work.

---

## Handling the 7 Mandatory Edge Cases

The assignment specifies 7 critical edge cases that must be handled safely. Here is how each case is enforced:

| #     | Edge Case                                 | Backend Enforcement (API)                                                                                                             | Frontend Experience (Web)                                                                                                        |
| ----- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **Home with no members**                  | `POST /api/homes/:id/bills` verifies member count; returns `422 Unprocessable Entity` (`"home has no members"`).                      | Warning banner appears above the bill form; submitting displays the server's clear error message.                                |
| **2** | **Zero, negative, or decimal amount**     | `lib/validate.ts` rejects non-positive or non-integers with `422`; backed up by `ck_bills_total_positive_integer` in D1.              | Input field validates on keystroke; rejects negatives and decimals while supporting flexible currency typing (`$12.50`, `₹500`). |
| **3** | **Uneven amount split**                   | `splitCents()` deterministically awards leftover cents to the earliest members in join order.                                         | Live split preview appears before submitting, showing the exact penny distribution for each roommate.                            |
| **4** | **Payment request sent twice**            | API requires `Idempotency-Key` header; re-sending the same key returns `200 OK` with the original `paidAt`.                           | The payment button is disabled while pending; retrying on network hiccups safely reuses the key without double-charging.         |
| **5** | **Two payers at the exact same time**     | Atomic conditional `UPDATE ... WHERE paid_at IS NULL` allows exactly one winner (`200 OK`) and rejects the other with `409 Conflict`. | The losing client displays a polite notification ("Someone already paid this share") and immediately reloads the latest state.   |
| **6** | **Bill or share does not exist**          | Queries verify resource existence; returns `404 Not Found` with specific details on what was missing.                                 | Renders an informative error card with a "Try again" action button; never crashes.                                               |
| **7** | **API answers with 500 error or is slow** | Uncaught exceptions are caught by a global error handler and returned as clean JSON `{ "error": "Internal server error" }`.           | All frontend API calls have a 10s timeout; displays loading spinners and retry buttons without unmounting or crashing the page.  |

---

## Extras & In-Browser OCR Bill Reader

In addition to the core split-and-pay requirements, I implemented several quality-of-life enhancements:

### 1. In-Browser OCR Bill Scanner

Instead of forcing roommates to type every bill by hand, users can drop an image (`.png`, `.jpg`, `.webp`) or a PDF of their bill:
- **Zero Cloud Leakage / Private:** Processing runs entirely inside the user's browser using WebAssembly (`tesseract.js` + `pdf.js`). No bill data or personal information is ever sent to third-party AI APIs.
- **Table-Aware Segmentation (`PSM.AUTO`):** Tesseract's page segmentation mode is explicitly configured to `PSM.AUTO` (`3`) with a fallback to `PSM.SPARSE_TEXT` (`11`). This ensures table grid borders and multi-column utility statements (like electricity bills) are scanned completely without halting prematurely.
- **Intelligent Total Scoring:** `parseBill.ts` scores candidates by line context (e.g. `"Total amount due"` scores higher than `"Subtotal"` or `"Tax"`), handles multi-line split labels, and supports international notation (e.g. Indian `504/-` or `₹`).

### 2. File Attachments with Real MIME Magic Checking

- Roommates can attach or replace the official receipt PDF/photo on any bill.
- The server inspects the **real file signature (magic bytes)** rather than trusting the user-provided file extension, blocking disguised scripts or HTML.
- Files are capped at 1 MB and stored with strict `X-Content-Type-Options: nosniff` headers.

### 3. Developer Edge-Cases Panel

- When running in development mode (`pnpm dev`), a developer inspection panel is rendered at the bottom of the home page.
- Reviewers and assessors can click single buttons to trigger live edge cases against the local server (empty home, invalid amounts, duplicate payments, race conditions, and network error simulations).

---

## Local Development & Setup

### Prerequisites

- Node.js (v18+)
- pnpm (v10 recommended: `npm install -g pnpm@10`)

### Installation & Running

```bash
# 1. Install dependencies across the workspace
pnpm install

# 2. Start both the Cloudflare Worker API (:8787) and Vite frontend (:5173)
pnpm dev
```
Open **[http://localhost:5173](http://localhost:5173)** in your browser.

---

## Quality Screenings & Verification

All quality screenings pass with zero errors:

```bash
# Run Biome linter and formatter
pnpm check

# Run TypeScript typechecks on API and Web packages
pnpm typecheck

# Run full Vitest suite (62 API tests + 35 Web tests)
pnpm test

# Verify production Vite build (including WebAssembly OCR bundles)
pnpm build
```

| Screening Suite              | Command          | Result                                               |
| ---------------------------- | ---------------- | ---------------------------------------------------- |
| **Linter / Formatter**       | `pnpm check`     | **Passed** (47 files clean, 0 errors)                |
| **TypeScript Typecheck**     | `pnpm typecheck` | **Passed** (API and Web clean)                       |
| **Unit & Integration Tests** | `pnpm test`      | **Passed** (All 97 tests pass: 62 in API, 35 in Web) |
| **Production Build**         | `pnpm build`     | **Passed** (Bundles assets + WASM OCR cores in ~1s)  |

---

## Video Walkthrough Topics

When recording the submission video, follow this 3-minute structure:
1. **Architecture & Stack (0:00 - 0:45):** Show Hono running on Cloudflare Workers, D1 SQLite database, and React 19 frontend.
2. **Core Decisions & Concurrency (0:45 - 1:45):** Explain the atomic conditional `UPDATE` payment mechanism, `Idempotency-Key` handling, and named database constraints.
3. **Live Demonstration & Edge Cases (1:45 - 2:45):** Demonstrate adding a member, uploading a bill image (`demo elect.png`) with automatic total detection, and clicking through the dev edge-case panel to show 422 validation, race condition handling (409 conflict), and network failure recovery.
4. **Conclusion (2:45 - 3:00):** Summary of test coverage (all 97 tests passing) and clean build status.
