---
name: commerce-signal-pattern-library
description: Commerce signal pattern library for pattern-appraisal phase.
---

# Commerce Signal Pattern Library

Used during pattern-appraisal phase for comeflow-commerce vertical. Your task: match the incoming Signal against the patterns below, return `{ matches: true|false, patternId: 'P1'|..., reason: string }`. Default to `matches: false` on ambiguous signals.

---

## Core Appraisal Questions

Before matching any pattern:

1. Does the Signal contain a numeric metric (rate, count, revenue figure, time duration)? If no numeric metric exists, the Signal is not addressable — return P-UNACTIONABLE.

2. Does the Signal describe something Factory can build (checkout flow automation, inventory sync, search/discovery optimization, fulfillment routing, pricing rule validation, returns workflow)? Or something Factory cannot build (brand positioning, social media strategy, influencer campaigns, pricing strategy decisions, competitive market analysis)? If the latter, return P-UNACTIONABLE.

---

## Pattern Library

### P1 — Cart Abandonment Spike

**Match condition:**
Signal contains all three:
- A cart abandonment rate (percentage or count)
- A timeframe or baseline comparison (vs. prior period, vs. target)
- A channel specification (mobile, desktop, specific device, specific traffic source) OR a step in the checkout flow where abandonment is highest

**Example matching signals:**
- "Cart abandonment on mobile checkout jumped from 65% to 78% in the last 14 days — payment step has the highest drop-off"
- "Our checkout funnel shows 34% abandonment at the shipping estimation step; this has been consistent for 6 weeks"
- "Guest checkout abandonment is 82%; account-required checkout is 71%; our target for guest is 70%"

**Boundary conditions — do NOT match:**
- "Checkout is bad" — no metric, no step → P-UNACTIONABLE
- "People aren't buying" — conversion problem without a specific funnel step → check P2 first, then P-UNACTIONABLE
- "Our mobile experience needs work" — no conversion metric → P-UNACTIONABLE

**Payment gateway advisory:** If the Signal mentions payment step abandonment, add advisory: `"ADVISORY: Payment step abandonment may indicate a TOOLING_FAILURE (payment gateway issue) rather than a checkout design issue. Verify payment gateway success rates before commissioning a checkout WorkGraph."`

**Discriminator:** Abandonment rate + timeframe/baseline + channel or funnel step? Yes → P1.

**Factory response:**
- Pressure node: forcingCondition = abandonment rate metric + channel + timeframe + baseline delta
- Capability node: inability to convert checkout intent to completed purchase on named channel or at named step
- Function proposal: functionType = 'workflow' or 'automation', toolSurface = e-commerce platform named in Signal (Shopify, BigCommerce, Magento, Comeflow native)
- PRD terminal atom: cart abandonment rate on named channel ≤ target over 14-day post-deploy window

---

### P2 — Inventory Mismatch

**Match condition:**
Signal contains:
- A specific product category, SKU range, or fulfillment location
- A discrepancy frequency metric (% of orders encountering stockout, variance between system and physical count, hours of inventory lag)
- Evidence that the mismatch is causing customer-facing failures (order cancellations, backorder rate, fulfillment delays)

**Example matching signals:**
- "15% of confirmed orders encounter stockout after purchase — system showed inventory available but warehouse was empty"
- "Inventory sync between our Shopify store and the 3PL runs every 4 hours; during peak periods this creates 200+ oversell events per day"
- "Physical count variance for seasonal SKUs is 23%; system inventory is unreliable for our top-40 selling products"

**Boundary conditions — do NOT match:**
- "We have inventory issues" — no metric, no category → P-UNACTIONABLE
- "Stock management is complicated" — no operational metric → P-UNACTIONABLE
- Single stockout event on a single SKU — insufficient pattern for a WorkGraph; treat as advisory

**Discriminator:** Named category/location + discrepancy frequency metric + customer impact? Yes → P2.

**Factory response:**
- Pressure node: forcingCondition = mismatch frequency metric + customer-facing impact (cancellation rate, backorder count)
- Capability node: inability to maintain inventory accuracy at required frequency or threshold
- Function proposal: functionType = 'integration' or 'automation', toolSurface = inventory management system + e-commerce platform named in Signal
- PRD terminal atom: inventory accuracy ≥ target % OR oversell rate ≤ target over 30-day window

---

### P3 — Order Fulfillment SLA Breach

**Match condition:**
Signal contains:
- A specific fulfillment commitment named (same-day delivery, 2-day shipping, click-and-collect ready time)
- A metric showing the commitment is not being met (p90 actual vs. SLA, % of orders late, avg hours/days behind SLA)
- A volume or revenue impact (orders affected, revenue at risk, customer complaint rate)

**Example matching signals:**
- "Same-day delivery SLA is 98% on-time; we're hitting 71% — 29% of same-day orders are being fulfilled as next-day"
- "Click-and-collect ready time SLA is 2 hours; p90 actual is 4.5 hours; 40% of customers arrive before order is ready"
- "2-day shipping commitment is failing for 22% of orders in the Southeast region; fulfillment center routing is wrong"

**Boundary conditions — do NOT match:**
- "Shipping is slow" — no SLA, no metric → P-UNACTIONABLE
- "Customers are unhappy with delivery" — no fulfillment metric → check if a metric can be extracted, otherwise P-UNACTIONABLE

**Discriminator:** Named fulfillment SLA + % breach or time delta? Yes → P3.

**Factory response:**
- Pressure node: forcingCondition = SLA commitment + breach metric + volume/revenue impact
- Capability node: inability to route and process orders to meet named fulfillment SLA
- Function proposal: functionType = 'workflow' or 'automation', toolSurface = OMS or fulfillment platform named in Signal
- PRD terminal atom: SLA compliance rate meets target over 30-day window

---

### P4 — Product Discovery Failure

**Match condition:**
Signal contains:
- A search or discovery metric (zero-results rate, search-to-product-page conversion, search-to-purchase rate, browse-to-cart rate for recommendation widgets)
- A timeframe or baseline comparison
- Evidence that the failure is causing missed purchase intent (not just UX feedback)

**Example matching signals:**
- "22% of search queries return zero results — up from 8% six months ago; we've added 400 new SKUs and search hasn't been updated"
- "Search-to-purchase conversion is 3.1%; industry benchmark is 5.5%; our search results are not surfacing the right products"
- "Product recommendation widgets on the PDP have a 0.4% click rate; category recommendation widgets have 2.1% — PDP recommendations are clearly misconfigured"

**Boundary conditions — do NOT match:**
- "Our search isn't good" — no metric → P-UNACTIONABLE
- "Products are hard to find" — no search metric → P-UNACTIONABLE

**Discriminator:** Search/discovery metric + timeframe or baseline? Yes → P4.

**Factory response:**
- Pressure node: forcingCondition = zero-results rate or search-to-purchase rate metric + baseline delta
- Capability node: inability to surface relevant products to search or browse queries at required relevance rate
- Function proposal: functionType = 'automation' or 'integration', toolSurface = search platform or product catalog system named in Signal
- PRD terminal atom: zero-results rate ≤ target OR search-to-purchase rate ≥ target over 30-day window

---

### P5 — Returns / Refund Process Friction

**Match condition:**
Signal contains:
- A returns or refund processing metric (days to process, % of returns requiring manual intervention, customer contact rate about return status, refund denial rate)
- Evidence that the friction is causing customer satisfaction impact or operational cost

**Example matching signals:**
- "Average time from return initiation to refund issued is 14 days; our published SLA is 5 business days; customer contacts about return status are our #1 inbound topic"
- "37% of return requests require manual review by the ops team — most are for reasons that should be auto-approved (size exchange, defective item)"
- "Return label generation failing for international orders — 18% of international return requests are getting stuck with no label issued"

**Boundary conditions — do NOT match:**
- "Returns are a problem" — no metric → P-UNACTIONABLE
- "Refunds take too long" — no metric, no SLA → P-UNACTIONABLE

**Discriminator:** Returns/refund metric + customer or operational impact? Yes → P5.

**Factory response:**
- Pressure node: forcingCondition = refund processing time or auto-approval rate metric + customer contact impact
- Capability node: inability to process returns at required speed or automation rate
- Function proposal: functionType = 'workflow' or 'automation', toolSurface = returns management system or OMS named in Signal
- PRD terminal atom: refund processing time ≤ SLA OR auto-approval rate ≥ target over 30-day window

---

### P6 — Pricing / Promotion Rule Error

**Match condition:**
Signal contains:
- A specific pricing rule, discount type, or promotion named
- An error rate or frequency (% of transactions where rule is applied incorrectly, count of incorrect transactions)
- Evidence of customer impact (incorrect charges, duplicate discounts, missed promotions on qualifying orders)

**Example matching signals:**
- "Bulk discount (10+ units) not applying in 12% of qualifying orders in the last 30 days — we've had 47 customer contacts"
- "Loyalty discount is stacking with promotional codes in 8% of transactions; policy is no stacking; we're losing $X per month"
- "Free shipping threshold changed from $50 to $75 two weeks ago but the old rule is still firing on mobile checkout"

**Boundary conditions — do NOT match:**
- "Promotions aren't working" — no error rate, no specific rule → P-UNACTIONABLE
- "Pricing strategy needs review" — strategic pricing decision, not a Factory-addressable automation signal → P-UNACTIONABLE

**Discriminator:** Named pricing rule + error frequency metric + customer impact? Yes → P6.

**Factory response:**
- Pressure node: forcingCondition = rule error rate + financial impact + customer complaint volume
- Capability node: inability to apply pricing rules accurately at required transaction rate
- Function proposal: functionType = 'validation' or 'automation', toolSurface = e-commerce platform pricing engine named in Signal
- PRD terminal atom: pricing rule error rate ≤ target over 30-day window

---

### P-PCI-ADVISORY

**Trigger condition:** Signal mentions payment processing, card data, checkout payment flow, or refund/chargeback processing.

This is NOT a standalone pattern — it is an advisory overlay added to P1, P5, or P6 when payment data is in scope.

Add to reason: `"ADVISORY: Signal involves payment processing. Any WorkGraph authored from this signal must confirm PCI-DSS scope with the org's compliance team before dispatch. Factory does not expand PCI scope without explicit authorization in domainProfile.constraints."`

---

### P-UNACTIONABLE

**Match condition:**
- No numeric metric
- Signal describes brand, social, or marketing strategy
- Signal describes competitive positioning or market research
- Signal describes a pricing strategy decision (not a pricing rule error)
- Signal describes general "customer experience" without a specific funnel metric

**Return:**
```json
{
  "matches": false,
  "patternId": "P-UNACTIONABLE",
  "reason": "Signal lacks a measurable operational metric (conversion rate, fulfillment time, inventory accuracy, error rate). Commerce Factory signals must identify a specific checkout, inventory, fulfillment, discovery, or pricing gap with a numeric metric. {specific_gap_description}"
}
```

---

## Appraisal Decision Rules

1. Match against P1–P6 in order. Stop at first match.
2. Add P-PCI-ADVISORY overlay if payment data is present in Signal.
3. If no pattern matches, return P-UNACTIONABLE.
4. If Signal matches two patterns (e.g., P2 inventory mismatch causing P3 fulfillment breach), return the more directly causal pattern and note the secondary in reason.
5. Never fabricate a metric to make a signal match. If the metric is not stated, it does not exist.
