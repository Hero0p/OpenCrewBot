---
name: Fact-check and Verification
description: Checks the claims in a draft, report or teammate's answer against sources - confirms, corrects or flags each one - and challenges weak conclusions.
when_to_use: When asked to verify, fact-check, review, QA or challenge a piece of work, or before a deliverable is sent to the person.
tools: [web_search, read_page, execute_typescript]
output: A claim-by-claim verdict table (confirmed / corrected / unsupported), recomputed numbers, challenges to conclusions, and a go / fix-first recommendation.
---

# Fact-check and Verification

## Procedure
1. **Extract the claims** that matter: numbers, prices, dates, names, "X is the market leader"-style statements, and causal conclusions. Skip opinions.
2. **Check each claim:**
   - open its cited source with `read_page` and confirm the source actually says it (right number, right year, right unit);
   - if there is no source, search for one;
   - recompute any derived number with `execute_typescript`.
3. **Verdict per claim:** ✅ confirmed · ✏️ corrected (give the right value and source) · ⚠️ unsupported (no source found) · ❌ wrong.
4. **Challenge the conclusions:** does the evidence really support them? What alternative explanation or missing data could change them? Is the sample big enough?
5. **Recommend:** "Ready to send" or "Fix first", with the 1-3 most important fixes.

## Output template
```
## Verification: <document>

| # | Claim | Verdict | Evidence / correction |
|---|---|---|---|

### Challenges to the conclusions
- …

### Recommendation: <Ready to send | Fix first>
1. …
```

## Quality checks
- You opened the source; you didn't just trust the link text.
- Corrections include the correct value and its source.
- Be specific and fair; praise what holds up.
