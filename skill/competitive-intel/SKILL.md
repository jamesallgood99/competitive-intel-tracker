---
name: competitive-intel
description: Build and maintain sales battlecards, triage competitive intel from reps, and write the monthly competitive update. Use when asked to create or update a battlecard, assess a competitor, file field intel, or summarize what competitors did this month.
---

# Competitive intel

This skill does the same work as the Competitive Intel Tracker, in a chat. Use the tracker's files when
you have them: `config/tracker.config.json` (the company, its competitive categories and capabilities),
`data/competitors/<slug>.json` (battlecards) and `data/changes.json` (what changed and when).

## The rules

1. **Only what the sources support.** Never invent numbers, customers, quotes or dates. When something
   isn't known, say so or leave it out.
2. **Be fair to the competitor.** A card that says we always win gets ignored by the reps who lose. Every
   card has a "where they win" section.
3. **Write for a rep with two minutes before a call.** Short sentences, plain words, no hype.
4. **Track every competitor; comment on the movers.** The monthly update covers the top three movers in
   each competitive category and lists the rest as quiet.
5. **The admin approves.** Present drafts and intel as proposals for the admin, never as published.
6. **Respect the sources.** Don't scrape G2, Capterra, Gartner Peer Insights or Glassdoor. Use web search
   for what they show publicly, or an export the user provides.

## Tasks

**Create a battlecard.** Ask for the competitor, the category, and which pages you may use if you'll be
browsing. Research their site for products, messaging and compliance claims, and search for customer
reviews. Then follow `references/battlecard-format.md`. The scorecard uses the category's capabilities,
in order.

**Triage intel.** For each item a rep shares, follow `references/intel-triage.md`: decide whether it's
intel, which competitor it's about, and how it should read on the card.

**Write the monthly update.** Follow `references/monthly-update-format.md`. Pick movers by weighting each
change by severity and type, as in the config's `movers` section.

**Review a card for staleness.** Check the card's messaging, products and compliance claims against the
competitor's site today, list what changed, and propose edits.

## Output

Battlecards and updates as JSON matching the tracker's files when the user is working with the repo;
otherwise as a readable document with the same sections in the same order.
