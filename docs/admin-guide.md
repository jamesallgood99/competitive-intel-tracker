# Admin guide

The admin is the editor of the knowledge base. Reps feed it, Claude files and drafts, and nothing
reaches a rep until you approve it. Expect 15 to 30 minutes a week.

## Your week

**As intel comes in.** Each submission arrives in your DMs with Claude's suggested wording for the card,
the original message and a link to it.

- **Approve** when the wording is right.
- **Edit and approve** to fix the wording, move it to a different competitor, or mark it major. Major
  intel weighs more when the monthly update picks its movers.
- **Reject** with an optional reason. The rep hears privately, never in the channel.

Approve intel that's specific and sourced. "Watchpost is cheaper" isn't intel; "Watchpost quoted $X per
camera to a 6-site food processor" is. When there's no source, the review message says so. Ask the rep
in the thread before approving.

**Mondays.** The weekly scan runs. Major changes arrive in your DMs. You'll also get a list of any cards
nobody has confirmed in 90 days. Open each one, fix what's wrong in GitHub, and press **Mark current**.

**First Tuesday of the month.** The monthly update arrives as a draft with its TL;DR. Open the draft link
and read it as a rep would. To change anything, edit `data/updates/<yyyy-mm>.json` in GitHub. Then press
**Publish**.

## New battlecard requests

When a rep asks for a card, you get the request and their reason.

**Approve and set sources** opens a form:

- **Competitive category.** This decides which capabilities the scorecard uses and which group of
  movers the competitor competes in each month.
- **Website.** Press Enter and the tracker suggests pages to watch.
- **Approved sources**, one per line: `method purpose target`.

| Method | Use it for |
|---|---|
| `fetch` | A page on the competitor's own site. Checked weekly, robots.txt respected. |
| `search` | A web search, used for reviews and employee sentiment. |
| `upload` | An export you put in `data/uploads/<slug>-<purpose>.csv`. |
| `api` | A licensed API, once a fetcher is added in `src/jobs/reviews.js`. |

Purposes: `messaging`, `products`, `compliance`, `reviews`, `employees`.

Check the suggested paths: if their security page lives at `/trust`, change `/security` to `/trust`.
Review sites (G2, Capterra, Gartner, Glassdoor) are never fetched, even if you add them, so use `search`
for those.

After you approve, Claude drafts the card from those sources and opens a pull request titled "New
battlecard: <name>". Review the positioning statement, the scorecard and the objections, and edit any of
them right in the pull request. **Merging publishes the card** and announces it in the channel, and the
rep who asked gets the link.

## Editing a card directly

Every card is a JSON file at `data/competitors/<slug>.json`. Edit it in GitHub's web editor. The tests
check that the scorecard still matches the category's capabilities and that the positioning statement is
still two sentences, and the site rebuilds on commit.

What the scan updates on its own: `products`, `messaging`, the competitor's side of `compliance`, and the
review data. Everything else is yours: positioning, scorecard, why we win, where they win, objections,
questions and our side of the compliance table.

## Adding or changing a category

Edit `categories` in `config/tracker.config.json`. Each category needs an `id`, a `name`, a
`description` and a list of `capabilities` for the quick-look scorecard. Changing a category's
capabilities means updating the scorecards of the cards in it; the tests will list each one that needs
it.
