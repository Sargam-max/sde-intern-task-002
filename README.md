# SDE Intern Assignment: Shared Bill Splitter

Welcome. In this assignment you build a small bill splitter for a shared home. It has two parts:

1. **Homes and members:** create a home and add members to it.
2. **Bill splitting:** split a bill between the members. Each member pays their own share.

The assignment is small on purpose. We want correct, safe, and clear code. We do not want many features.

## What we look at

- **Your code passes the tests.** The tests decide, not opinion. You get the visible tests. We also run extra tests that you do not see.
- **Your code is safe when things go wrong.** Wrong input, repeated requests, and two requests at the same time must not break your data.
- **Your code is typed.** Use TypeScript. Do not use `any`.
- **You understand your code.** You record a short video and explain it.

Take your time. A careful, correct solution is better than a fast one. We expect 2 to 3 days of real work.

## Stack (required)

- **API:** Hono on Cloudflare Workers
- **Database:** Cloudflare D1 (SQLite). The binding is `DB` in `api/wrangler.jsonc`.
- **Web:** React, Vite, TanStack Router
- **Language:** TypeScript on both sides
- **Tests:** Vitest, running inside the Workers runtime
- **Quality:** Biome. `pnpm check` and `pnpm typecheck` must pass.

You choose the rest (styling, form library, validation library). Pick tools you can explain.

## The task

The assignment has two parts. Do Part 1 first. Part 2 builds on it.

**Database.** Write the schema as SQL migration files in `api/migrations/`. For example `0001_init.sql`. The tests apply every file in this folder. Your schema must have **at least 3 named constraints** that protect the data. For example a foreign key, a `CHECK`, or a `UNIQUE` key. Be ready to explain what each constraint stops.

**Errors.** Every error response is JSON: `{ "error": "message" }`.

## Part 1: Homes and members

Create a home and add members to it. The order in which members are added matters in Part 2.

#### `POST /api/homes`

- Request: `{ "name": string }`
- Success: `201` `{ id, name }`

#### `POST /api/homes/:homeId/members`

- Request: `{ "name": string }`
- Success: `201` `{ id, homeId, name }`
- Errors: `404` home not found

Visible tests: `api/test/homes.test.ts`.

## Part 2: Bill splitting

Add a bill to a home, split it between the members, and let each member pay their share.

All amounts are whole **cents** (integers). `100` cents is 1 dollar. Never use decimals for money.

#### `POST /api/homes/:homeId/bills`

- Request: `{ "title": string, "totalCents": number }`
- Success: `201` `{ id, homeId, title, totalCents, shares: [{ id, memberId, amountCents, paidAt: null }] }`
- Errors: `404` home not found. `422` total is not a positive whole number, or the home has no members.

#### `POST /api/bills/:billId/shares/:shareId/pay`

- Request: header `Idempotency-Key`
- Success: `200` `{ id, memberId, amountCents, paidAt }`
- Errors: `400` key missing. `404` bill or share not found. `409` share already paid with a different key.

#### `GET /api/homes/:homeId/balances`

- Success: `200` `{ balances: [{ memberId, name, outstandingCents }] }`
- Errors: `404` home not found

**Rules**

- **Split.** A bill is split between all members of the home. The shares always add up to `totalCents`. If the amount does not divide evenly, the extra cents go to the members one by one, in the order the members were added to the home. Example: 1000 cents between 3 members gives `334`, `333`, `333`.
- **Pay.** Paying marks one share as paid and sets `paidAt`. If the same `Idempotency-Key` is sent again for the same share, answer `200` with the same result. Do not pay twice. If two requests pay the same share at the same time, only one may succeed.
- **Balances.** `outstandingCents` is the sum of the member's unpaid shares, across all bills of the home. List the members in the order they were added.

Visible tests: `api/test/bills.test.ts` and `api/test/payments.test.ts`.

#### Web page

Build one page that:

- shows the bills of a home and the shares of each bill,
- lets a member pay a share,
- shows clear **loading**, **empty**, and **error** states,
- keeps the share unpaid and shows an error if the payment fails.

The page must not crash when the API answers with an error or is slow.

## Cases you must handle

You must handle these cases and talk about them in your video:

1. A home with no members.
2. An amount that is zero, negative, or not a whole number.
3. An amount that does not divide evenly.
4. The same payment request sent twice.
5. Two members paying the same share at the same time.
6. A bill or share that does not exist.
7. The API answers with a 500 error or is slow. The web page must not crash.

## Run it

This is a pnpm workspace. Install once at the root.

```bash
pnpm install
pnpm dev          # api on :8787 and web on :5173
```

Open http://localhost:5173. The starter page shows a title. `/api/health` returns `{ "status": "ok" }`.

```bash
pnpm test         # run the visible tests in api/test
pnpm check        # Biome: format and lint. Must pass.
pnpm check:fix    # fix what Biome can fix
pnpm typecheck    # tsc on both packages. Must pass.
pnpm build        # production build of the web app
```

`pnpm dev` applies your migrations to a local database before it starts the API.

If pnpm says some build scripts were ignored, run `pnpm approve-builds` and allow `esbuild` and `workerd`.

When you change `api/wrangler.jsonc`, refresh the `Env` types:

```bash
pnpm --filter bill-splitter-api cf-typegen
```

## Rules for the tests

- The visible tests are in `api/test`. They start with a failing result. Your job is to make them pass.
- Do **not** change the visible tests or `api/test/helpers.ts`. We compare them with the original.
- We run extra tests after you submit. They test the cases in "Cases you must handle" more closely.

## AI policy

You can use AI tools. Tell us which ones and where in your answers on the form.
You must understand every line you submit. We check this with your video and in a live call. "The AI wrote it" is not an answer.

## How to submit

1. Click **Use this template**, then **Create a new repository**. Make the repository **public**.
2. Build your solution in your new repository. Small, clear commits are welcome.
3. Update this README with a short section called **Decisions**. Write 3 decisions you made and why.
4. Record a video of **3 minutes or less** (Loom or unlisted YouTube). Show the architecture, the data flow, and one trade-off you made. Make sure anyone with the link can view it.
5. Paste the repository link and the video link in the application form.

We will run `pnpm install && pnpm check && pnpm typecheck && pnpm test` on your repository.

---

## Decisions

**1. The database guards the money rules, not only the code.** The schema in `api/migrations/0001_init.sql` has named constraints for every rule that would corrupt data if broken:

| Constraint                            | What it stops                                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ck_bills_total_positive_integer`     | A bill of zero, a negative amount, or a decimal (`typeof(total_cents) = 'integer'`, so `10.5` cannot slip in)              |
| `ck_shares_paid_has_key`              | A "half paid" share: `paid_at` and `idempotency_key` are both set or both empty                                            |
| `fk_shares_bill` / `fk_shares_member` | A share whose bill or member is missing, or whose member lives in a **different home** (composite keys on `(id, home_id)`) |
| `uq_shares_bill_member`               | Two shares for the same member on one bill                                                                                 |
| `uq_members_home_position`            | Two members in the same slot of the join order, which decides who gets the extra cents                                     |

The API still validates first so users get clear `422` messages; the constraints are the last line of defence.

**2. Paying is one conditional `UPDATE`, not "read, then write".** `UPDATE shares SET paid_at, idempotency_key WHERE id = ? AND bill_id = ? AND paid_at IS NULL RETURNING ...`. The check and the write cannot be split, and D1 runs writes one at a time, so when two people pay the same share at once only one update matches a row. If no row was updated I read the share once: missing → `404`, paid with the same key → `200` with the stored result (a safe retry), paid with another key → `409`. The key is stored on the share itself, so idempotency needs no extra table. _Trade-off:_ a key is scoped to one share. That fits this API (one payment per share) but would need its own table if a key had to cover any request.

**3. Split in a pure function; save the bill in one batch.** `splitCents` (`api/src/lib/split.ts`) is plain integer maths (`floor` plus one extra cent for the first `total % n` members) and is unit tested over many totals and member counts. Member order comes from a `position` column assigned inside the same `INSERT ... SELECT` that adds the member, so members added at the same time never collide. The bill and all its shares are written with `db.batch()`, which is one transaction, so a bill can never exist with missing shares. _Trade-off:_ a member who joins while a bill is being created may be left out of that bill. The shares still add up, and I judged that fair (they joined after the bill).

**Web page.** `web/src/routes/homes.$homeId.tsx` shows loading, empty and error states. Every response is checked at runtime (`web/src/api.ts`) and every request times out after 10 s, so a slow API or a 500 becomes a message with a _Try again_ button, never a crash. A share only shows as paid after the server confirms. A failed payment keeps the same `Idempotency-Key` for _Retry_, so a payment that did reach the server is not charged twice.

### Extras beyond the assignment

The core assignment is unchanged. These extras sit beside it and do not touch the split or payment logic.

**Your homes.** The start page lists every home with its member and bill count (`GET /api/homes`), so a home and its members are always one click away. A banner appears if the page cannot reach the API, or if an old API process from an earlier copy is still holding port 8787 (checked with `GET /api/version`).

**Type the amount or upload the bill.** The _New bill_ form has two modes:

- _Type the amount:_ title and amount by hand.
- _Upload the bill:_ choose or drop a PDF or a photo. The page **reads the bill** and fills in the total and a title (e.g. "Electricity bill"). It shows the line it used ("Total amount due $56.27"), the other amounts it found as one-click alternatives, and the raw text. You check or change the values, then save. The file is stored with the bill.

How reading works (`web/src/billReader/`):

| Step                                                                                                                                                                                                                                                        | File                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| PDF with text → read the text with pdf.js. Scanned PDF → draw page 1 and OCR it                                                                                                                                                                             | `readBill.ts`                     |
| Photo → OCR with tesseract.js. Phone photos over 1 MB are scaled down to JPEG before saving                                                                                                                                                                 | `readBill.ts`, `prepareUpload.ts` |
| Find the total: score every money value by the words on its line ("amount due" beats "subtotal", "tax", "cash" or "after due date"). Handles `$`, `₹`/`Rs.`, `€`, thousands and lakh grouping, decimal commas, and a label and value split across two lines | `parseBill.ts` (17 unit tests)    |

_Trade-off:_ reading happens **in the browser**, not on the server or with an AI service. Nothing leaves the user's machine, it needs no API key, and the OCR files are served by this app (`web/ocrAssets.ts`), so it works offline. The cost is accuracy on messy photos, so the page never saves a read amount by itself: the user always sees and confirms it.

**Each bill can carry one file**, either picked in the _New bill_ form or added later with _Upload bill_ / _Replace file_ on a bill card.

| Endpoint                            | What it does                                                                                                                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUT /api/bills/:billId/attachment` | `multipart/form-data` with a `file` field. `200` with `{ filename, contentType, sizeBytes, uploadedAt }`. Errors: `400` no file, `404` bill not found, `413` over 1 MB, `415` not a PDF/PNG/JPEG/WebP |
| `GET /api/bills/:billId/attachment` | Returns the file. `404` if the bill has none                                                                                                                                                          |
| `GET /api/homes/:homeId/bills`      | Lists bills with shares and `attachment` details (added for the page)                                                                                                                                 |

The API checks the file's **real type from its first bytes**, not its name, so an HTML page renamed to `.pdf` is refused. It is served with `X-Content-Type-Options: nosniff`, and SVG and HTML are not allowed. _Trade-off:_ files are stored in D1 (migration `0002`, capped at 1 MB by a `CHECK`) rather than in R2 object storage. That keeps the stack to the one required database and makes "the bill and its file" easy to reason about. For bigger files or heavy traffic, R2 would be the right move.

### Where each case is handled

| Case                              | API                                                                        | Page                                                                         |
| --------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1. Home with no members           | `422` "home has no members…" (`routes/bills.ts`)                           | Warning above the bill form; the server's message is shown if you submit     |
| 2. Zero, negative, decimal amount | `422` (`lib/validate.ts`) plus `ck_bills_total_positive_integer` in the DB | Inline message while typing; the amount is parsed as text, so no float maths |
| 3. Uneven amount                  | `splitCents`: the extra cents go to the first members in join order        | Live split preview before saving, and a note on the bill                     |
| 4. Same payment twice             | Same key → `200` with the stored result, paid once                         | Retry reuses the key; the button is disabled while paying                    |
| 5. Two payers at once             | One conditional `UPDATE`: one `200`, the other `409`                       | `409` shows "Someone already paid this share" and reloads                    |
| 6. Bill or share missing          | `404` with which one is missing                                            | Error state with _Try again_                                                 |
| 7. API 500 or slow                | Unknown errors become a generic JSON `500` (`index.ts`)                    | Spinner while waiting, 10 s timeout, error message, share stays unpaid       |

**Edge-case panel (development only).** At the bottom of a home page, `pnpm dev` shows a _Test the edge cases_ panel. Each button runs one case against the real API and prints the answer: no members, invalid amounts, the same payment twice, two payers at once, and a missing bill or share. Case 7 has a switch (Normal / Slow / Too slow / 500 error). It adds an `x-simulate` header that a small dev-server middleware in `web/vite.config.ts` answers, so the API code has no test backdoor. Neither the panel nor the middleware exists in `pnpm build`.

### Running on Windows

Use **pnpm 10** (`npm install -g pnpm@10`). It is plain JavaScript, so Windows Application Control and Smart App Control do not block it the way they can block pnpm's native `.exe`. If PowerShell says "running scripts is disabled", use Command Prompt (`cmd`) or type `npm.cmd` / `pnpm.cmd`. If `workerd.exe` is blocked too, run the project in WSL or GitHub Codespaces.

**"Address already in use (127.0.0.1:8787)"** means an old API process is still running. Close other terminals running `pnpm dev`, or free the port in Command Prompt: `netstat -ano | findstr :8787`, then `taskkill /PID <the number at the end> /F`. The API port is fixed on purpose: the web app's proxy expects it there.

Open the app at **http://localhost:5173** (the web page). Port 8787 is only the API.

### Tests

`pnpm test` runs 62 API tests and 17 web tests. `api/test/edge-cases.test.ts` and `api/test/attachments.test.ts` add 38 tests on top of the visible ones: the split function, concurrent payments with different keys (one `200`, one `409`), the same key sent five times at once, a share from another bill (`404`), members added at the same time, bad JSON, the database constraints themselves, file uploads (real-type check, size limit, replace, download), the homes list, and a guard that the Worker entry only exports its handler. `web/src/billReader/parseBill.test.ts` tests finding the total on utility bills, shop receipts and rupee bills.

### AI use

Built with Claude (Anthropic). I reviewed and can explain every line.
