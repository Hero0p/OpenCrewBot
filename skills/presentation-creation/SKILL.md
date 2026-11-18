---
name: Presentation Creation
description: Turns findings into a clear slide-by-slide presentation outline with headlines, bullet points, visuals and speaker notes, saved as a Markdown deck.
when_to_use: Requests for a deck, slides, a pitch, a presentation or an executive summary to present.
tools: [save_report, make_chart]
output: A Markdown deck (one section per slide) with a headline, 3-5 bullets, a suggested visual and speaker notes per slide.
---

# Presentation Creation

## Procedure
1. **Audience and goal.** One line each: who will watch, what they should decide or remember. If unknown and important, ask.
2. **Storyline first.** Write the slide headlines only (8-12 slides). Each headline is a full sentence stating the point ("Competitors ignore Tier-2 cities"), not a topic ("Competitors"). Read them in order: they must tell the whole story on their own.
3. **Fill each slide.** 3-5 short bullets that support the headline, with numbers and sources where relevant.
4. **Visuals.** For slides with numbers, create a chart with `make_chart` and embed it. For others, suggest a visual in one line.
5. **Speaker notes.** 2-3 sentences per slide: what to say beyond the bullets.
6. **Save** the deck with `save_report` and share the link.

## Output template
```
# <Deck title>
_Audience: … · Goal: …_

---
## 1. <Headline sentence>
- bullet
- bullet
**Visual:** <chart or suggestion>
**Notes:** …

---
## 2. …
```

## Quality checks
- Headlines alone tell the story.
- No slide has more than 5 bullets or more than ~40 words of bullets.
- Every number has a source (in the bullet or the notes).
