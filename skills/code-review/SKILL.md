---
name: Code Review
description: Inspects a code repository or change and reports concrete technical issues - bugs, security risks, missing tests, maintainability problems - ranked by impact, with a development plan.
when_to_use: Requests to review, audit or inspect code, a GitHub repository, a pull request, or to plan technical improvements.
tools: [web_search, read_page, execute_typescript, save_report]
output: Repository overview, a ranked issue list (severity, location, evidence, fix), prioritised improvements and a phased development plan. Changes are only proposed, never made without approval.
---

# Code Review

## Procedure
1. **Get the code.** Use the connected GitHub app (search its actions, then read the repository tree, README, package files and key source files) or `read_page` on public GitHub pages. Note the language, framework, size and last activity.
2. **Map the architecture.** Entry points, main modules, data storage, external services, tests and CI. Keep it to a short paragraph plus a list.
3. **Look for issues** in this order:
   1. **Security:** secrets in code, injection, missing auth checks, unsafe dependencies.
   2. **Correctness:** bugs, unhandled errors, race conditions.
   3. **Reliability:** no tests for core paths, no CI, fragile setup.
   4. **Maintainability:** duplication, huge files, unclear names, missing docs.
   5. **Performance:** only where there is evidence.
4. **Every issue needs evidence:** the file path (and line or function) and what you saw. No evidence, no issue.
5. **Rank** by severity (Critical / High / Medium / Low) × effort (S / M / L).
6. **Propose changes** as concrete steps or small diffs. **Do not create branches, issues or pull requests yourself**; propose them. Any write action in GitHub goes through the person's approval.
7. **Save** the full review with `save_report`.

## Output template
```
## Code review: <repo>
**Stack:** … **Size:** … **Tests/CI:** …

### Issues
| # | Severity | Area | Location | Evidence | Suggested fix | Effort |
|---|---|---|---|---|---|---|

### Prioritised improvements
1. …

### Development plan
- **Phase 1 (this week):** …
- **Phase 2:** …

### Proposed changes (need approval before anything is created)
- Issue / PR: <title> - <what it changes>
```

## Quality checks
- Every issue points to a real file.
- Nothing was changed in the repository.
- Severity reflects user impact, not style preference.
