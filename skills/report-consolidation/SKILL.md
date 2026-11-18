---
name: Report Consolidation
description: Merges the work of several teammates into one coherent deliverable - removes duplication, resolves contradictions, keeps every source, and adds an executive summary and next steps.
when_to_use: When several agents' outputs, research notes or partial results must become one final report, brief or deliverable.
tools: [save_report, memory_add]
output: One consolidated report - executive summary, sections, a merged sources list, open issues, and recommended next steps - saved as a file.
---

# Report Consolidation

## Procedure
1. **Collect the inputs.** List each contribution: who produced it and what it covers. Note any part of the original request that nobody covered.
2. **Outline** the final report around the person's original question, not around who did what.
3. **Merge:**
   - remove duplicates, keeping the best-sourced version;
   - where contributions **contradict**, show both with their sources and say which is better supported (or that it's unresolved);
   - keep every source link and renumber them in one list.
4. **Executive summary first:** 3-6 bullets a busy reader can act on.
5. **Label honesty:** mark anything simulated, assumed or unverified. If an input came from mock mode, say so.
6. **Next steps:** concrete, owner-ready actions.
7. **Record decisions** that were made along the way with `memory_add`.
8. **Save** with `save_report` and give the link.

## Output template
```
# <Deliverable title>
_Prepared for: … · Date: … · Contributors: <agents>_

## Executive summary
- …

## <Section per part of the question>
…

## Open issues and contradictions
- …

## Recommended next steps
1. …

## Sources
1. [title](url)
```

## Quality checks
- Every part of the original request is answered or listed as open.
- No source was lost in the merge.
- Contradictions are shown, not hidden.
