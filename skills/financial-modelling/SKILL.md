---
name: Financial Modelling
description: Builds simple, transparent financial models - revenue projections, unit economics, break-even and scenarios - with every assumption written down and every number computed, not guessed.
when_to_use: Requests about revenue, pricing, costs, margins, unit economics (CAC, LTV), break-even, forecasts, budgets or "what if" scenarios.
tools: [read_spreadsheet, execute_typescript, make_chart, save_report]
output: An assumptions table, the calculated model (base / low / high scenarios), a chart, and the key takeaways.
---

# Financial Modelling

## Procedure
1. **Collect inputs.** Use figures the person gave you, files in the Files folder (`read_spreadsheet`), or sourced research from teammates. Anything else is an *assumption*: write it in the assumptions table with a short reason.
2. **Compute, don't estimate.** Do all arithmetic with `execute_typescript` (exact maths). Never do multi-step arithmetic in your head.
3. **Model structure** (keep it this simple unless asked otherwise):
   - Revenue = customers × price × purchase frequency
   - Gross margin = revenue − direct costs
   - Unit economics: CAC = marketing spend ÷ new customers; LTV = average revenue per customer × gross margin % × average lifetime
   - Break-even = fixed costs ÷ contribution per unit
4. **Scenarios.** Base, low (pessimistic) and high (optimistic), changing only 2-3 key drivers. Say which drivers changed.
5. **Chart** the main metric over time or across scenarios with `make_chart`.
6. **Save** the full model as a report with `save_report` when it is longer than a chat reply.

## Output template
```
## Financial model: <subject>

### Assumptions
| Driver | Value | Reason / source |
|---|---|---|

### Results
| Metric | Low | Base | High |
|---|---|---|---|

![<chart title>](<chart url>)

### Takeaways
- …
### Sensitivities
- The result is most sensitive to <driver>: ±10% changes <metric> by <amount>.
```

## Quality checks
- Every number in Results came out of `execute_typescript`.
- Assumptions and sourced facts are clearly separated.
- Units and currency are on every number.
