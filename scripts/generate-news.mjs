import fs from 'node:fs/promises';
import path from 'node:path';
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const ROOT = process.cwd();
const SITE_DIR = path.join(ROOT, 'site');
const DATA_DIR = path.join(SITE_DIR, 'data');
const LATEST_PATH = path.join(DATA_DIR, 'latest.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');

function nowInETParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function buildPrompt() {
  const et = nowInETParts();
  const etDate = `${et.year}-${et.month}-${et.day}`;
  const etTime = `${et.hour}:${et.minute}:${et.second}`;

  return `You are preparing a public-facing financial news briefing website.

Current Eastern Time date: ${etDate}
Current Eastern Time time: ${etTime}
Audience: investors and general readers who want a concise, practical update.

Use web search to find the most relevant recent developments.
Focus ONLY on recent, material items that matter for:
1. U.S. stock market and U.S. economy
2. Global economy
3. Hong Kong economy / Hong Kong market
4. Major policy updates that could affect markets or business

Return VALID JSON ONLY. No markdown. No code fences. No commentary.
Use this exact schema:
{
  "generated_at_et": "ISO-like timestamp string in America/New_York context",
  "headline": "one-sentence overview",
  "summary": "120-220 word executive summary",
  "sections": [
    {
      "key": "us_markets",
      "title": "U.S. Stocks & Economy",
      "items": [
        {
          "title": "short headline",
          "summary": "2-4 sentence explanation",
          "impact": "Bullish|Bearish|Mixed|Watch",
          "importance": 1,
          "why_it_matters": "one sentence",
          "sources": [
            { "title": "source title", "url": "https://..." }
          ]
        }
      ]
    },
    {
      "key": "global_economy",
      "title": "Global Economy",
      "items": []
    },
    {
      "key": "hong_kong",
      "title": "Hong Kong Economy",
      "items": []
    },
    {
      "key": "policy",
      "title": "Major Policy Updates",
      "items": []
    }
  ]
}

Rules:
- Provide 2-4 items per section when relevant.
- Prefer high-quality sources such as central banks, government releases, major exchanges, and major financial news outlets.
- Every item must include at least 2 sources whenever possible.
- Avoid duplicate stories across sections.
- Keep it balanced and factual.
- Importance must be an integer from 1 to 5.
- If a section is quiet, include fewer items instead of filler.
- Mention exact dates when timing matters.
- Make sure links are direct and valid.`;
}

function extractJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {}

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }
  throw new Error('Model did not return valid JSON.');
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function sanitizePayload(payload) {
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  return {
    generated_at_et: payload.generated_at_et ?? new Date().toISOString(),
    headline: String(payload.headline ?? 'Market briefing update'),
    summary: String(payload.summary ?? ''),
    sections: sections.map((section) => ({
      key: String(section.key ?? ''),
      title: String(section.title ?? ''),
      items: Array.isArray(section.items)
        ? section.items.map((item) => ({
            title: String(item.title ?? ''),
            summary: String(item.summary ?? ''),
            impact: String(item.impact ?? 'Watch'),
            importance: Number.isFinite(item.importance) ? item.importance : Number(item.importance ?? 3),
            why_it_matters: String(item.why_it_matters ?? ''),
            sources: Array.isArray(item.sources)
              ? item.sources
                  .filter((source) => source?.title && source?.url)
                  .map((source) => ({
                    title: String(source.title),
                    url: String(source.url),
                  }))
              : [],
          }))
        : [],
    })),
  };
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY');
  }

  await fs.mkdir(DATA_DIR, { recursive: true });

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-5',
    tools: [{ type: 'web_search' }],
    input: buildPrompt(),
  });

  const payload = sanitizePayload(extractJson(response.output_text || ''));
  const previousHistory = await readJson(HISTORY_PATH, []);

  const historyEntry = {
    generated_at_et: payload.generated_at_et,
    headline: payload.headline,
    summary: payload.summary,
  };

  const nextHistory = [historyEntry, ...previousHistory]
    .filter((entry, index, arr) => {
      const firstIndex = arr.findIndex((x) => x.generated_at_et === entry.generated_at_et);
      return firstIndex === index;
    })
    .slice(0, 30);

  await fs.writeFile(LATEST_PATH, JSON.stringify(payload, null, 2));
  await fs.writeFile(HISTORY_PATH, JSON.stringify(nextHistory, null, 2));

  console.log(`Updated briefing: ${payload.generated_at_et}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
