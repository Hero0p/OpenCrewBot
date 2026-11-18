---
name: Market Research
description: Sizes up a market or audience from public sources - who the customers are, what they need, how big and fast-growing the market is, and where it is heading.
when_to_use: Questions about a market, an industry, a customer segment or an audience ("research the market for…", "who are the customers for…", "what do Class 11 students worry about…").
tools: [web_search, read_page, memory_add]
output: A sourced brief - key findings, audience/segment profiles, market numbers with sources, trends, and open questions.
---

# Market Research

## Procedure
1. **Frame the question.** Write down, in one line each: the market or audience, the geography, the time frame, and what decision the research supports. If one of these is unclear and it changes the answer, ask the person (ask_user) before searching.
2. **Search broadly, then narrowly.** Run 3-5 `web_search` queries covering: market size and growth, customer needs and pain points, trends, regulation, and recent news. Prefer the last 2 years.
3. **Read the best sources.** Use `read_page` on the 3-6 most credible results (official statistics, industry reports, reputable press, the companies' own sites). Avoid content farms.
4. **Extract facts with their source.** For every number keep: the figure, the unit, the year, and the URL. Never round away the year.
5. **Profile the segments.** For each customer segment: who they are, what they need, what they use today, what they pay, and what stops them buying.
6. **Note trends and opportunities.** Separate *facts* (sourced) from *your inferences* (label them "Inference:").
7. **Save durable facts** the team will reuse (e.g. "Market X was ~$Y in 2025 (source)") with `memory_add`.

## Output template
```
## Market research: <topic>
**Question:** … **Scope:** <geography, period>

### Key findings
- <finding> ([source](url))

### Customer segments
| Segment | Needs | Current alternatives | Willingness to pay | Barriers |
|---|---|---|---|---|

### Market size and trends
- <number, unit, year> ([source](url))

### Opportunities (inference)
- …

### Open questions / gaps in the evidence
- …
```

## Quality checks
- Every number has a source URL and a year.
- Inferences are labelled as inferences.
- Say plainly when sources disagree or when you couldn't find data.
