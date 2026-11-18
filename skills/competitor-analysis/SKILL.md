---
name: Competitor Analysis
description: Profiles competitors - their products, public pricing, target customers and positioning - and compares them side by side to find gaps and opportunities.
when_to_use: Requests about competitors, rivals, alternatives, the competitive landscape, pricing comparisons or positioning ("who competes with…", "compare X with Y").
tools: [web_search, read_page, crawl_site, memory_add]
output: A comparison table with one row per competitor, evidence links for every cell, and a list of strategic opportunities.
---

# Competitor Analysis

## Procedure
1. **List candidates.** Search for "<company> competitors", "<category> alternatives", "best <category> in <country>", and review/comparison sites. Aim for 5-8 real competitors; split them into *direct* (same product, same customer) and *indirect*.
2. **Profile each competitor** from its own website first (`read_page` on the home, product and pricing pages; `crawl_site` only if pages are hard to find), then from press and reviews:
   - products / services
   - **public** pricing (quote it exactly, with currency and date; write "not public" if it isn't)
   - target customers
   - positioning (their own tagline / main claim)
   - distribution and notable partnerships
   - strengths and weaknesses (from reviews or evidence, not guesses)
3. **Compare.** Build the comparison table. Every cell that states a fact needs a source link in the evidence list.
4. **Find opportunities.** Look for: segments nobody serves well, price gaps, features everyone lacks, weak positioning, channels nobody uses. Mark each as an inference and say what evidence supports it.
5. **Remember** the competitor list and key prices with `memory_add`, so future monitoring can spot changes.

## Output template
```
## Competitive landscape: <company / market>

### Comparison
| Competitor | Type | Products | Public pricing | Target customers | Positioning |
|---|---|---|---|---|---|

### Evidence
1. <Competitor> pricing: [page title](url) (checked <date>)

### Strengths and weaknesses
- **<Competitor>**: + … / − …

### Strategic opportunities
1. <opportunity> - why: <evidence>
```

## Quality checks
- Never invent a price. "Not public" is a valid answer.
- Each competitor has at least one source from its own site.
- Opportunities are tied to evidence in the table.
