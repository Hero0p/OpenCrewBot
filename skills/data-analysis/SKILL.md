---
name: Data Analysis
description: Analyses a spreadsheet (CSV) for real - cleans it, computes metrics, finds bottlenecks and segment differences, charts the results and turns them into recommendations.
when_to_use: Requests to analyse a spreadsheet, CSV, dataset, sales data, funnel or conversion numbers, or to find patterns, bottlenecks or segments in data.
tools: [list_files, read_spreadsheet, execute_typescript, make_chart, save_report]
output: Data overview, the calculations (with the code-computed numbers), charts, findings and business recommendations.
---

# Data Analysis

## Procedure
1. **Find the file.** `list_files` shows the shared Files folder. If the person hasn't uploaded the data, ask them to upload it in Skills & Tools → Files.
2. **Profile it.** `read_spreadsheet` gives the columns, row count and a sample. Write down: what one row means, the time range, and any data-quality issues (blanks, duplicates, odd values).
3. **Compute with code.** Inside `execute_typescript`, call `read_spreadsheet` with `maxRows: 5000` and calculate. Typical metrics:
   - totals and averages per segment (region, channel, product, source)
   - funnel conversion between stages (e.g. lead → demo → paid) per segment
   - revenue per segment and its share of the total
   - trends over time (month by month)
   Return a small summary object; never paste thousands of rows into the chat.
4. **Find the story:**
   - **Bottleneck:** the funnel stage with the biggest drop.
   - **Segments:** which over- and under-perform the average, and by how much.
   - **Opportunity:** if segment X reached the average conversion, how much extra revenue would that bring? Compute it.
5. **Chart** 2-3 key views with `make_chart` (e.g. conversion by stage, revenue by segment).
6. **Recommend** 3-5 actions, each tied to a number from the analysis.
7. **Save** the full analysis with `save_report`.

## Output template
```
## Analysis: <file>
**Rows:** … **Period:** … **One row =** … **Data issues:** …

### Key metrics
| Metric | Value |
|---|---|

### Conversion bottleneck
…

### Segment performance
| Segment | Leads | Conversion | Revenue | vs average |
|---|---|---|---|---|

![chart](url)

### Recommendations
1. <action> - expected impact: <computed number>
```

## Quality checks
- Every number was computed by code from the actual file.
- State whether the dataset is real or a synthetic sample, if the file says so.
- Recommendations quote the number that supports them.
