// Every prompt the engine sends to Claude. Mirrored in skill/competitive-intel/references/ so the same
// rules apply whether the work runs here or in a Claude chat.

const RULES = `Rules that apply to everything you write:
- Use only facts present in the material you were given or found with search. If something isn't there, leave it out or say it isn't known. Never invent numbers, customers, quotes or dates.
- Reps will read this minutes before a call. Plain language, short sentences, no hype words.
- Be fair to the competitor. A battlecard that pretends we always win gets ignored by the reps who lose to them.
- Reply with JSON only, matching the shape you were given.`;

export function companyContext(config) {
  const c = config.company;
  return `We are ${c.name} (${c.product}). ${c.oneLiner}\nOur proof points:\n- ${c.proofPoints.join('\n- ')}`;
}

export const extractPrompt = (config, competitor, pages) => ({
  system: `You extract competitive facts from a competitor's own web pages.\n${RULES}`,
  prompt: `Competitor: ${competitor.name} (${competitor.website})

From the pages below, extract:
- "products": every distinct product, module or add-on they sell, as {"name", "description", "source"} (description under 15 words, source = the page URL).
- "messaging": their 3–6 main messaging points: the headline claims they repeat, in close paraphrase, each under 12 words.
- "compliance": every compliance, security or privacy claim (SOC 2, ISO 27001, HIPAA, GDPR, FedRAMP, encryption, data retention, blurring/anonymization, data ownership), as {"area", "claim", "source"}.

Shape: {"products": [], "messaging": [], "compliance": []}

${pages.map((p) => `=== ${p.url} ===\n${p.text}`).join('\n\n')}`,
});

export const customerReviewsPrompt = (competitor, hint) => ({
  system: `You summarize what customers say about a software or insurance company in public reviews.\n${RULES}`,
  prompt: `Search for recent customer reviews of ${competitor.name} (${competitor.website}) on G2, Capterra and Gartner Peer Insights. Search hint: "${hint}".
Use what review pages and search results show publicly; don't try to get around logins.

Return:
{"asOf": "YYYY-MM-DD",
 "sources": [{"name": "G2" | "Capterra" | "Gartner Peer Insights", "rating": number|null, "reviews": number|null}],
 "positive": [{"theme", "mentions", "detail"}],
 "negative": [{"theme", "mentions", "detail"}]}

Group feedback into 2–4 positive and 2–4 negative themes. "mentions" is your best count of reviews raising the theme among those you saw; use null if you can't tell. "detail" is one plain sentence in your own words. Leave a source out if you found nothing for it.`,
});

export const employeeReviewsPrompt = (competitor, hint) => ({
  system: `You summarize what current and former employees say about a company in public reviews.\n${RULES}`,
  prompt: `Search for Glassdoor (and similar) employee reviews of ${competitor.name}. Search hint: "${hint}".
Use what pages and search results show publicly; don't try to get around logins.

Return:
{"asOf": "YYYY-MM-DD", "rating": number|null, "ceoApproval": number|null, "recommendToFriend": number|null,
 "positive": [{"theme", "mentions", "detail"}],
 "negative": [{"theme", "mentions", "detail"}]}

ceoApproval and recommendToFriend are percentages (0–100). 1–3 themes each. Focus on signals that matter competitively: layoffs, leadership turnover, reorgs, roadmap churn, sales pressure, funding worries.`,
});

export const draftCardPrompt = (config, category, card, extraction, customer) => ({
  system: `You write sales battlecards for ${config.company.name}'s reps.\n${companyContext(config)}\n${RULES}`,
  prompt: `Draft the battlecard for ${card.name}, a competitor in our "${category.name}" category (${category.description}).

What their site says:
${JSON.stringify(extraction, null, 2)}

What customers say:
${JSON.stringify(customer ?? {}, null, 2)}

Return:
{"positioning": "exactly two sentences: how they position, how we win against them and when",
 "scorecard": [{"capability", "verdict": "win"|"parity"|"loss", "note": "under 15 words"}],
 "whyWeWin": [{"point", "proof"}],
 "whereTheyWin": ["..."],
 "objections": [{"theySay", "youSay"}],
 "landmines": ["questions a rep can ask the prospect that expose the competitor's weak spots"],
 "snapshot": {"founded", "hq", "employees", "funding", "leadership", "news": [{"date", "headline"}]}}

The scorecard must use exactly these capabilities, in this order: ${JSON.stringify(category.capabilities)}.
"verdict" is from our side: win = we're clearly stronger, loss = they're clearly stronger, parity = close or unknown. When you don't have evidence, use parity and say "Not yet assessed." in the note.
3 whyWeWin, 2–4 whereTheyWin, 3–5 objections, 3–5 landmines. Snapshot fields you can't support from the material are null. The admin will review everything before reps see it.`,
});

export const triageIntelPrompt = (config, competitors, message) => ({
  system: `You triage competitive intel that sales reps post in Slack.\n${companyContext(config)}\n${RULES}`,
  prompt: `Competitors we track:
${competitors.map((c) => `- ${c.slug}: ${c.name} (${c.category})`).join('\n')}

Categories: ${config.categories.map((c) => `${c.id} (${c.name})`).join(', ')}

A rep posted:
"""${message}"""

Decide whether this is competitive intel. Return:
{"isIntel": boolean,
 "competitorSlug": "one slug from the list" | null,
 "newCompetitorName": "if it's about a company we don't track" | null,
 "type": "product" | "pricing" | "messaging" | "deal" | "people" | "partnership" | "other",
 "summary": "one or two sentences, rewritten neutrally for the battlecard, keeping every concrete fact (numbers, names of products, timing) and nothing more",
 "cardSection": "fieldIntel" | "objections" | "whereTheyWin" | "products",
 "severity": "major" | "minor",
 "needsSource": boolean}

Small talk, questions to the team, and anything without a concrete claim about a competitor is not intel. Never include customer or prospect names in the summary unless the rep wrote them; if they did, keep them (the admin decides). "major" = a new product, a pricing change, a lost deal or a partnership that changes how we sell.`,
});

export const industryPrompt = (config, key, question, window) => ({
  system: `You brief a B2B sales team on their market each month.\n${companyContext(config)}\n${RULES}`,
  prompt: `${question}
Only include developments dated between ${window.from} and ${window.to}. Search the web.

Return: {"summary": "one or two sentences", "items": [{"text": "one or two sentences: what happened and why a rep should care", "url": "source URL"}]}
2–4 items. If nothing material happened, return an empty items list and say so in the summary. Section: ${key}.`,
});

export const moverPrompt = (config, competitor, changes) => ({
  system: `You brief sales reps on what a competitor did this month.\n${companyContext(config)}\n${RULES}`,
  prompt: `Changes we recorded for ${competitor.name} this month:
${changes.map((c) => `- ${c.date} [${c.type}, ${c.severity}] ${c.summary}`).join('\n')}

Current positioning against them: ${competitor.positioning}

Return {"whatChanged": "one or two sentences", "soWhat": "one or two sentences: what reps should say or do differently"}.`,
});

export const tldrPrompt = (config, draft, n) => ({
  system: `You write the TL;DR of a monthly competitive update for sales reps.\n${companyContext(config)}\n${RULES}`,
  prompt: `Here is this month's update:
${JSON.stringify({ industry: draft.industry, categories: draft.categories }, null, 2)}

Pick the ${n} things a rep most needs to know before their next call, across everything above. Return:
{"title": "a short, specific title for the update", "tldr": [{"text": "one sentence", "slug": "competitor slug if it's about one" | null}]}`,
});
