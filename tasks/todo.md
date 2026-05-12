# Active task plan

Per `CLAUDE.md § 3`: any non-trivial task starts here as a checkable plan. Get approval before implementing.

---

# Plan — Tier 1B: Monthly Expense Tracking

## Why
Expenses are currently stored in `localStorage('expense_data')` — lost on browser clear, not shared across sessions/devices, disconnected from the real revenue system. The P&L income line reads from `loadPS()` (localStorage payment slips) rather than the authoritative `taxSummary` Firestore data. This task makes expenses durable (Firestore), per-building, and wires the P&L to real revenue figures.

## Key decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| YYYY-MM format in path | **CE year** (`2026-05`) | `YYYY-MM` is ISO convention → CE. BE only used in display layer. Consistent with `aggregateMonthlyRevenue` HTTP param. |
| Firestore path | `expenses/{building}/{YYYY-MM}/{auto}` | Per user spec. building = `rooms` \| `nest`. |
| Income source | `taxSummary/{yearBE}.months[m].totalRevenue` | CF-aggregated; already admin/accountant readable. Per-building available via `.byBuilding`. |
| Building filter in UI | Add `rooms` / `nest` selector to form + filter | Expenses are building-scoped, so filter must match path. |
| taxSummary income format | BE year as doc key (e.g. `2569`), month as integer key | Match existing CF output. Convert: CE `2026` → BE `2569` = CE+543. |
| accounting/tax-filing.js | **Out of scope** | Uses a separate `accounting_expenses` localStorage key with a different schema. Separate task. |
| New CF for expense aggregation | **Not needed** | Admin queries subcollections client-side. Small dataset. |

## Files to change

| File | What changes |
|------|-------------|
| `firestore.rules` | Add `expenses/{building}/{monthKey}/{expId}` block |
| `firestore.rules.test.js` | Add expenses describe block (admin CRUD, accountant read, anon denied) |
| `dashboard.html` | Add building select to expense form + building filter in summary header |
| `shared/dashboard-tenant-page.js` | Migrate expense CRUD localStorage→Firestore; fix P&L income from taxSummary |

## Implementation phases

- [ ] **Phase 1 — Firestore rules**: Add expenses collection after `historicalRevenue` block. Admin: read+write+delete. Accountant: read. Wildcard subcollection path: `/expenses/{building}/{monthKey}/{expId}`.
  - Why: Without rules no client can write. Rule structure mirrors the nested path.

- [ ] **Phase 2 — Rules tests**: Add `describe('expenses — admin CRUD, accountant read, anon denied')` block in `firestore.rules.test.js`. Run `npm run test:rules` — must be green.

- [ ] **Phase 3 — dashboard.html**: Add `<select id="exp-building">` (rooms/nest) to the expense form (beside date/category). Add the same building selector to the filter section so summary and list filter by building too.

- [ ] **Phase 4 — Firestore CRUD in dashboard-tenant-page.js**:
  - Drop `loadExpenses()` / `saveExpenses()` (localStorage).
  - `addExpense()`: build `monthKey` = `${ceYear}-${String(month).padStart(2,'0')}`; call `fs.addDoc(fs.collection(db,'expenses',building,monthKey), { date, category, desc, room, amount, createdAt: fs.serverTimestamp() })`. Show loading state on button.
  - `renderExpensePage()`: call `fs.getDocs(fs.collection(db,'expenses',building,monthKey))` → map docs. Async; show spinner while loading.
  - `deleteExpense(building, monthKey, docId)`: call `fs.deleteDoc(fs.doc(db,'expenses',building,monthKey,docId))`. Update delete button to pass these args.
  - Why: Data now survives browser clear; visible across admin sessions.

- [ ] **Phase 5 — P&L income from taxSummary**:
  - Replace `loadPS()` call with `fs.getDoc(fs.doc(db,'taxSummary', String(filterYear)))`. 
  - Extract `snap.data()?.months?.[filterMonth]?.totalRevenue ?? 0` as income.
  - Render P&L summary: income (from taxSummary), expenses (from Firestore query), profit = income − expenses.
  - Graceful fallback: if taxSummary doc missing for that year, income shows `฿0` with muted label "ยังไม่มีข้อมูลรายรับ".
  - Why: P&L now reflects real collected rent/util/water instead of stale localStorage slips.

- [ ] **Phase 6 — Verify on Vercel**: Push to main, open expense page on https://the-green-haven.vercel.app/dashboard.html, add one test expense, verify it persists after page reload (Firestore), verify P&L income row shows taxSummary figure.

## Out of scope
- `accounting/tax-filing.js` expense reads — different schema, separate ticket
- `aggregateMonthlyExpenses` CF — not needed at this scale
- Expense export (CSV/PDF) — Tier 2

---

## Review (append after done)
