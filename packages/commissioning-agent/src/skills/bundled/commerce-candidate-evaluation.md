---
name: commerce-candidate-evaluation
description: Commerce candidate scoring and nomination for deliberation phase.
---

# Commerce Candidate Evaluation

Used during deliberation phase for comeflow-commerce vertical. Produce 2–4 candidates, score each on three criteria, and nominate the best feasible candidate. Fewer than 2 candidates indicates insufficient deliberation.

---

## Pre-Evaluation Gate

Before scoring any candidate, check:

**PCI scope gate:** If the candidate involves payment processing, card data storage or transmission, or direct integration with payment gateway APIs, and the org context does NOT explicitly confirm PCI-DSS compliance for the toolset involved:

```
feasible: false
infeasibilityReason: "Candidate requires PCI-DSS scope coverage for {tool/operation}. PCI compliance status is not confirmed in domainProfile. Either: (a) use a payment gateway that handles PCI scope (e.g., Stripe Elements, Braintree Drop-in — card data never reaches org systems), or (b) confirm PCI-DSS compliance in domainProfile before commissioning."
```

---

## Scoring Criteria

Each candidate receives three scores (0–10). All scores require a 1–2 sentence justification.

---

### Criterion 1: Revenue Impact (0–10)

How directly does this candidate address a metric tied to GMV, order completion, or revenue recovery?

| Score | Meaning |
|-------|---------|
| 9–10 | Candidate directly addresses a metric with a clear revenue calculation. The Signal provides enough data to estimate revenue recovery (e.g., "if abandonment drops from 78% to 70%, at current traffic and AOV, revenue increases by $X/month"). Terminal success condition IS a revenue or GMV metric. |
| 7–8 | Candidate addresses a metric correlated with revenue — conversion rate, fulfillment SLA compliance, search-to-purchase rate. Revenue impact is calculable but requires one inference step. |
| 5–6 | Candidate addresses an upstream metric (product discovery, inventory accuracy) where the revenue connection is real but indirect. Two inference steps. |
| 3–4 | Candidate addresses operational efficiency (returns processing speed, backend automation) with an indirect revenue benefit (reduced ops cost, reduced churn from bad returns experience). |
| 0–2 | No revenue connection. Purely technical or administrative. |

**Revenue priority rule:** When two candidates have the same composite score and one has a higher revenue impact score, always nominate the higher-revenue-impact candidate. Commerce missions are primarily revenue missions.

---

### Criterion 2: Customer Experience Improvement (0–10)

Does this candidate remove friction from the purchase path or improve a customer-visible interaction?

| Score | Meaning |
|-------|---------|
| 9–10 | Candidate removes friction from the critical purchase path: checkout, product discovery, payment, or order confirmation. A customer who encounters this improvement is more likely to complete a purchase or return. |
| 7–8 | Candidate improves a post-purchase experience that directly affects repeat purchase likelihood: fulfillment notifications, returns simplicity, refund speed. |
| 5–6 | Candidate improves a non-critical-path experience: account management, wish lists, browse personalization outside the purchase funnel. |
| 3–4 | Candidate is backend operational with no direct customer-visible outcome, but reduces errors that occasionally surface to customers (pricing rule errors, inventory oversells). |
| 0–2 | No customer-facing dimension. Purely internal operational improvement. |

---

### Criterion 3: Feasibility (0–10)

Can this candidate be built within the org's existing commerce platform, toolset, and permissions?

| Score | Meaning |
|-------|---------|
| 9–10 | Implements using the e-commerce platform already in org context (Shopify, BigCommerce, Magento, Comeflow native) using native features, APIs, or standard app integrations. No new vendor onboarding. No expanded compliance scope. |
| 7–8 | Requires one additional integration: a fulfillment partner API, a third-party search platform (Algolia, Searchspring), a returns SaaS (Loop Returns, AfterShip), or a payment method extension. Standard setup. |
| 5–6 | Requires custom platform development, multi-system data pipeline, or significant new data source. Feasible with extended timeline. |
| 3–4 | Requires changing the commerce platform architecture (new checkout engine, platform migration, ERP integration) or a new compliance scope. High setup risk. |
| 0–2 | Requires capabilities outside Factory scope (manual customer service processes, carrier negotiation, platform replacement). Mark `feasible: false`. |

---

## Nomination Rules

1. **Primary rule:** Nominate the candidate with highest `(revenueImpact + feasibility) / 2` where `feasible: true`.

2. **Revenue priority:** Among candidates with equal composite scores, prefer the one with higher revenue impact. Commerce is primarily a revenue mission.

3. **Feasibility-revenue tradeoff:** If a candidate has revenue impact ≥ 8 but feasibility of 5–6 (requires integration work), it may still be the right nomination if no other feasible candidate has revenue impact ≥ 6. Note in `nominationReason`: `"High revenue impact justifies integration overhead. Estimated revenue recovery from Signal metric outweighs setup cost."`

4. **Tie-breaking:** Revenue impact first, then customer experience improvement.

5. **Low-revenue fallback:** If all feasible candidates have revenue impact < 5, nominate the best available and add: `"Low direct revenue impact. Recommend confirming Signal metric before dispatch — a Commerce signal with revenue impact < 5 may be misclassified."`

6. **No feasible candidates:** Return `{ nominated: null, reason: "All candidates blocked by PCI constraints or platform architecture limitations. Escalate to principal." }`

7. **Minimum candidates:** Produce 2–4. If 1 concept is viable, produce a second as stretch.

---

## Candidate Output Format

```json
{
  "id": "CND-{n}",
  "title": "string",
  "description": "string (2–4 sentences: what commerce workflow it targets, what it automates, what platform it uses)",
  "functionType": "automation|integration|report|workflow|alerting|validation|enrichment",
  "toolSurface": "string (specific platform name: Shopify, BigCommerce, Magento, Algolia, Loop Returns, etc.)",
  "pciScopeRequired": true|false,
  "scores": {
    "revenueImpact": { "score": 0–10, "justification": "string" },
    "customerExperienceImprovement": { "score": 0–10, "justification": "string" },
    "feasibility": { "score": 0–10, "justification": "string" }
  },
  "compositeScore": "(revenueImpact + feasibility) / 2",
  "feasible": true|false,
  "infeasibilityReason": "string|null"
}
```

Nomination:
```json
{
  "nominatedId": "CND-{n}",
  "nominationScore": 0–10,
  "nominationReason": "string (cite revenue impact reasoning and why alternatives were not chosen)"
}
```

---

## Commerce-Specific Scoring Notes

**Shopify-native candidates:** Any candidate using only Shopify Admin API, Shopify Flow, or Shopify Scripts scores 9–10 on feasibility when Shopify is in the org's commerce platform. No integration overhead.

**Headless commerce candidates:** If the org has a headless storefront (custom React/Next.js front-end with a commerce API backend), feasibility for candidates requiring storefront changes drops to 5–6 — custom front-end changes are out of standard Factory scope unless the headless framework is documented in DomainProfile.

**Fulfillment candidates:** If the org uses a 3PL, feasibility depends on whether the 3PL has a documented API in org context. Named 3PLs (ShipBob, Flexport, ShipMonk) with documented APIs score 7–8. Unknown or undocumented 3PLs score 4–5.

**Search candidates:** Algolia, Searchspring, Bloomreach — all score 8 on feasibility for a standard integration. Custom search re-indexing jobs that depend on the product catalog data model score 5–6 (catalog schema dependency).

**Pricing rule candidates:** Candidates that use the native pricing engine of the platform (Shopify Price Rules API, BigCommerce Price Lists) score 9–10 on feasibility. Candidates that require custom checkout extension or third-party pricing middleware score 5–6.
