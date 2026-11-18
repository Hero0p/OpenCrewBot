---
name: Lead Generation
description: Builds a qualified list of potential customers or partners from public information, scores them against an ideal customer profile, and suggests a first outreach angle for each.
when_to_use: Requests to find leads, prospects, partners, schools, companies or contacts to sell to or partner with.
tools: [web_search, read_page, save_report]
output: An ideal-customer profile, a scored lead table with public sources, and an outreach angle per lead. Only public, business information - no private personal data.
---

# Lead Generation

## Procedure
1. **Define the ideal customer profile (ICP):** type of organisation, size, location, signals that show need (e.g. "schools announcing a careers-counselling programme"), and who the buyer is (a role, not a named private person). Confirm it with the person if unsure.
2. **Find candidates** with `web_search`: directories, association member lists, news about relevant initiatives, rankings. Aim for 10-25.
3. **Qualify each** with `read_page` on its official site: does it match the ICP? Note the evidence.
4. **Score** each lead 1-5 on fit and 1-5 on timing (is there a recent trigger?). Priority = fit × timing.
5. **Contact route:** only public business channels (official website contact page, the organisation's general email or LinkedIn page). **Never collect personal phone numbers or private emails.**
6. **Outreach angle:** one sentence connecting their trigger to our value.
7. **Save** the list with `save_report`. Sending any outreach is a separate step that needs approval.

## Output template
```
## Leads: <campaign>
**ICP:** …

| # | Organisation | Location | Why it fits (evidence) | Trigger | Fit | Timing | Priority | Public contact route | Outreach angle |
|---|---|---|---|---|---|---|---|---|---|

Sources: 1. … 2. …
```

## Quality checks
- Every lead has a source showing it exists and fits.
- No private personal data.
- Scores are explained by the evidence column.
