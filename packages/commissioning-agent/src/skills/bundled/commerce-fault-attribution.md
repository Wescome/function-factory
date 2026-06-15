---
name: commerce-fault-attribution
description: Commerce fault attribution for hypothesis-formation phase.
---

# Commerce Fault Attribution

Used during hypothesis-formation phase. Requires Claude Opus (CA-INV-003). Your task: examine the Divergence trace, attribute fault to exactly one of the four categories, form a Hypothesis with evidence, and propose an amendment scope.

---

## Payment Safety Pre-Check (Run First)

Before attribution, check whether the Divergence involved a payment or financial transaction:
- Payment authorization, capture, or refund
- Pricing rule that resulted in an incorrect charge
- Discount or promotion that affected transaction value
- Refund or chargeback processing

**If yes:** Set `severity: 'blocking'` on the Hypothesis. Any Divergence touching payment data is high-risk from both financial accuracy and PCI-DSS perspectives. Document: `"PAYMENT-SENSITIVE: Divergence touches payment or pricing data. Blocking severity applied. Principal notification required before re-dispatch."`

---

## Attribution Decision Tree

**Step 1: Did the tool/API run?**
- No API call in the Divergence trace, or call was not attempted → go to Step 1a
- API ran and produced output → go to Step 2

**Step 1a: Why did the API not run?**
- Commerce platform API down, payment gateway unavailable, shipping carrier API timeout, CDN failure → **ENVIRONMENTAL**
- The atom spec did not include the required API call → **SPECIFICATION_GAP**

**Step 2: Did the spec say what to do with the API output?**
- API output exists but the atom had no instruction for how to use it to advance the commerce workflow → **SPECIFICATION_GAP**
- The spec covered the handling → go to Step 3

**Step 3: Did the invariant match the current production state?**
- The atom's INV-* binding referenced a pricing rule, shipping threshold, promotion constraint, or checkout rule that has been updated since WorkGraph authoring → **INVARIANT_MISMATCH**
- The invariant matched production → go to Step 4

**Step 4: Was the API output correct?**
- API ran, output was structurally valid, spec was correct, invariant matched — but the output contained wrong data (stale inventory, incorrect price, wrong product, stale cart state) → **TOOLING_FAILURE**

**Ambiguity tiebreak:** SPECIFICATION_GAP vs. INVARIANT_MISMATCH — choose SPECIFICATION_GAP. Spec fix is more conservative.

---

## Category Definitions and Commerce Signatures

### SPECIFICATION_GAP

A required commerce business rule or workflow step was absent from the atom specification.

**Commerce signatures:**
- Checkout flow atom ran but did not include validation that all required shipping fields were populated — orders were placed with incomplete addresses
- Inventory reservation atom ran but did not include a hold duration — inventory was reserved indefinitely, blocking other purchases
- Promotion atom ran but did not include the "cannot stack with loyalty" rule — discounts stacked incorrectly
- Order routing atom ran but did not include the region-specific fulfillment logic — orders were routed to the wrong fulfillment center
- Returns atom ran but did not include the product category exclusions — final-sale items were accepted for return
- Price update atom ran but did not include the "apply to in-progress carts" rule — existing carts retained old prices after a price change

**Evidence required:**
- The specific atom that ran (id, title)
- The atom's `successCondition` as written
- The specific business rule that was absent (state it precisely — which rule, which condition)
- The downstream commerce consequence (incorrect orders, wrong routing, financial error, customer impact)

**Amendment scope for SPECIFICATION_GAP:**
- `'add-atom'` — the missing rule requires a new atom (e.g., a validation step before checkout submission)
- `'modify-atom'` — the missing rule is an extension of an existing atom's acceptance criteria

**Example hypothesis:**
```
faultCategory: SPECIFICATION_GAP
explanation: "ATOM-3 (Promotion Application) applied the 'SUMMER20' discount code (20% off) to all orders in the qualifying category. The atom's successCondition was 'discount_code applied, cart_total reduced by 20%.' It did not include the promotion constraint: 'cannot stack with loyalty tier discounts.' 143 orders received both the promotion discount and a loyalty tier discount in the same transaction, resulting in an average 32% effective discount vs. the intended 20%. Financial impact: $4,200 in over-discounted orders."
severity: blocking
amendmentScope: modify-atom
proposedChange: "Extend ATOM-3 acceptanceCriteria to include: 'If loyalty_discount > 0 on cart, do not apply promotional discount code. Surface a message to customer: \"Promotional code cannot be combined with your loyalty discount. Your loyalty discount has been applied.\"'"
```

---

### TOOLING_FAILURE

A permitted commerce tool/API produced a structurally valid result that was semantically wrong.

**Commerce signatures:**
- Inventory API returned quantity=8 but the warehouse had 0 (eventual consistency lag or cache staleness) — orders were accepted that could not be fulfilled
- Payment gateway returned a successful authorization but the charge failed at capture — no error was surfaced, order was fulfilled without payment
- Shipping rate API returned incorrect rates because the carrier updated their dimensional weight formula and the API was using a cached rate table
- Product catalog API returned an archived/discontinued product because search index had not been refreshed after the product was delisted
- CRM/loyalty API returned a stale loyalty points balance because the sync had not processed recent transactions — incorrect loyalty discount was applied
- Tax calculation service returned a rate for the wrong jurisdiction because the address normalization step failed silently

**Evidence required:**
- The tool/API that failed (name, endpoint)
- The output the tool produced (show the relevant field values)
- The output the tool should have produced (what was expected)
- The commerce consequence (unfillable orders, incorrect pricing, wrong fulfillment routing)
- Whether this is a known issue with this tool (eventual consistency, cache TTL, rate table versioning)

**Payment tooling failure severity:** Payment gateway failures are always `severity: 'blocking'`. Document: `"PAYMENT-TOOLING-FAILURE: Any failure in payment data processing is high-risk. Review for financial accuracy and PCI-DSS implications before re-dispatch."`

**Amendment scope for TOOLING_FAILURE:**
- `'add-invariant'` — add an INV-* binding that validates tool output freshness, accuracy, or consistency before the atom accepts it
- `'modify-atom'` — add a pre-check in the atom that validates the tool output

**Example hypothesis:**
```
faultCategory: TOOLING_FAILURE
explanation: "ATOM-1 (Inventory Check) called the inventory API (endpoint: /api/v2/inventory/available) and received { available: 8, sku: 'COAT-XL-NAVY' }. The actual warehouse stock at the time was 0 — the 8 remaining units had been reserved by a simultaneous bulk wholesale order 4 minutes earlier. The inventory API uses a 10-minute cache TTL. 7 retail orders were accepted and confirmed for a product that could not be fulfilled. Each order required manual cancellation and customer notification."
amendmentScope: add-invariant
proposedChange: "Add INV-INVENTORY-FRESHNESS-001: 'Inventory check must use the real-time stock endpoint (/api/v2/inventory/realtime) for all customer-facing order acceptance. The cached endpoint may only be used for browse/display purposes, not for order commitment.' "
```

---

### INVARIANT_MISMATCH

The atom's INV-* binding was correct at authoring time but the actual production commerce rule has changed.

**Commerce signatures:**
- INV referenced free shipping threshold of $50 but the threshold was updated to $75 — free shipping was being offered incorrectly on orders $50–$74
- INV encoded the return window as 30 days but the policy was updated to 14 days for certain categories — returns were being accepted beyond the current policy
- INV referenced the promotional code validation rule that was updated (new exclusion list added for sale items)
- INV encoded a territory routing rule that changed when a new fulfillment center opened
- INV referenced the loyalty tier thresholds that were restructured in a program refresh
- INV encoded a minimum order quantity for a B2B customer segment that changed in a contract renewal

**Evidence required:**
- The INV-* binding text from the WorkGraph spec
- The current actual business rule from the platform configuration or policy document
- The effective date when the production rule changed
- The commerce impact of the mismatch (incorrect pricing, wrong routing, policy violation)

**Amendment scope for INVARIANT_MISMATCH:**
- `'modify-invariant'` — update the INV-* binding to reflect the current business rule

**Example hypothesis:**
```
faultCategory: INVARIANT_MISMATCH
explanation: "ATOM-5's INV-FREE-SHIPPING-001 reads: 'Free standard shipping applies to orders with subtotal ≥ $50 after discounts.' The org updated this threshold to $75 on 2026-02-15 as part of a margin improvement initiative. The WorkGraph was authored on 2025-11-10. For 4 weeks post-update, orders between $50 and $74 received free shipping incorrectly. Estimated financial impact: $1,800 in shipping costs that should have been charged to customers."
amendmentScope: modify-invariant
proposedChange: "Update INV-FREE-SHIPPING-001 to: 'Free standard shipping applies to orders with subtotal ≥ $75 after discounts (effective 2026-02-15).'"
```

---

### ENVIRONMENTAL

An external commerce dependency was unavailable. The spec was correct, the tool was correct, the invariant matched — but the dependency failed.

**Commerce signatures:**
- Payment gateway had a regional outage — all payment authorizations failed for 22 minutes
- Shipping carrier API returned 503 — rate quotes could not be retrieved at checkout
- CDN serving the storefront had edge node failure — checkout page was unavailable for a portion of traffic
- Fulfillment partner API was undergoing maintenance — order submissions were queued but not transmitted
- Tax calculation service was rate-limiting during Black Friday peak — tax could not be calculated for some orders

**Critical rule: ENVIRONMENTAL never justifies a WorkGraph amendment.**
```
amendmentScope: 'none'
```

**Commerce severity escalation for ENVIRONMENTAL:**

**Severity BLOCKING:** ENVIRONMENTAL failure during checkout or payment processing:
- Payment gateway downtime (any duration)
- Checkout API failure during a campaign or peak event
- Any dependency failure that prevented revenue-generating transactions

Set `severity: 'blocking'` and note: `"COMMERCE-CRITICAL: ENVIRONMENTAL failure blocked revenue-generating transactions. Principal notification required. Review infrastructure resilience for payment and checkout dependencies."`

**Severity ADVISORY:** ENVIRONMENTAL failure in non-revenue-critical operations:
- Search indexing delay (browse affected, checkout not affected)
- Recommendation engine timeout (personalization degraded, not blocked)
- Inventory sync delay during off-peak hours
- Returns management API outage (processing delayed, not customer-facing for new purchases)

**Example hypothesis:**
```
faultCategory: ENVIRONMENTAL
explanation: "ATOM-2 (Payment Authorization) failed for all orders between 19:45 and 20:07 UTC on 2026-04-10. Stripe reported a partial outage affecting authorization requests in the US-East region (Stripe Status page — incident INC-20260410-001). The atom spec was correct; Stripe integration configuration was unchanged. 34 checkout sessions during this window failed at payment authorization. No payment data was incorrectly processed — all failed sessions were cleanly rejected. Revenue impact: ~$4,200 in blocked transactions (subsequently recovered as customers retried post-incident)."
severity: blocking
amendmentScope: none
recommendation: "No WorkGraph change needed. Implement checkout-layer retry logic with customer-facing messaging ('Payment processing is temporarily unavailable — please try again in a few minutes'). Consider adding circuit-breaker telemetry for payment gateway health."
```

---

## Hypothesis Output Format

```json
{
  "id": "HYP-{nanoid8}",
  "divergenceRef": "{Divergence trace id or description}",
  "faultCategory": "SPECIFICATION_GAP|TOOLING_FAILURE|INVARIANT_MISMATCH|ENVIRONMENTAL",
  "paymentSensitive": true|false,
  "explanation": "string (3–6 sentences: what atom, what tool, what business rule, what commerce consequence)",
  "severity": "blocking|advisory",
  "amendmentScope": "add-atom|modify-atom|add-invariant|modify-invariant|none",
  "proposedChange": "string|null",
  "producedBy": "CommissioningAgentDO:{orgId}",
  "dispositionEventId": "{ELC-*}",
  "producedAt": "{ISO 8601}"
}
```

Severity rules:
- `'blocking'`: Divergence touched payment data, caused incorrect charges, blocked revenue-generating transactions, or is ENVIRONMENTAL during a commerce-critical event. Principal notification required.
- `'advisory'`: Divergence is operational (search degradation, inventory display error, backend workflow delay) with no payment or revenue-blocking impact.
