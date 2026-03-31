import fs from 'node:fs/promises';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

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

Use Google Search grounding to find the most relevant recent developments.
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
- Make sure links are direct and valid.
- Return strict JSON only.
- Escape all quotation marks, newlines, and control characters correctly inside JSON strings.`;
}

function fixJsonString(str) {
  let result = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];

    if (inString) {
      if (escape) {
        result += ch;
        escape = false;
        continue;
      }

      if (ch === '\\') {
        result += ch;
        escape = true;
        continue;
      }

      if (ch === '"') {
        result += ch;
        inString = false;
        continue;
      }

      if (ch === '\n') {
        result += '\\n';
        continue;
      }

      if (ch === '\r') {
        result += '\\r';
        continue;
      }

      if (ch === '\t') {
        result += '\\t';
        continue;
      }

      const code = ch.charCodeAt(0);
      if (code >= 0 && code <= 0x1f) {
        result += ' ';
        continue;
      }

      result += ch;
      continue;
    }

    if (ch === '"') {
      inString = true;
      result += ch;
      continue;
    }

    result += ch;
  }

  return result;
}

function extractJson(text) {
  const raw = String(text || '').trim();

  if (!raw) {
    throw new Error('Model returned empty text.');
  }

  let cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  cleaned = fixJsonString(cleaned);
  cleaned = cleaned.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    console.error('Failed JSON preview:', cleaned.slice(0, 3000));
    throw error;
  }
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
            importance: Number.isFinite(item.importance)
              ? item.importance
              : Number(item.importance ?? 3),
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
  console.log('Starting news generation...');

  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY');
  }

  console.log('GEMINI_API_KEY detected.');

  await fs.mkdir(DATA_DIR, { recursive: true });

  console.log('Sending request to Gemini...');

  const response = await Promise.race([
    ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      contents: buildPrompt(),
      config: {
        tools: [{ googleSearch: {} }],
      },
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Gemini request timed out after 90 seconds')), 90000)
    ),
  ]);

  console.log('Received response from Gemini.');

  const responseText =
    response?.text ||
    response?.candidates?.[0]?.content?.parts
      ?.map((part) => part?.text || '')
      .join('') ||
    '';

  const payload = sanitizePayload(extractJson(responseText));
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

  console.log('Writing latest.json...');
  await fs.writeFile(LATEST_PATH, JSON.stringify(payload, null, 2));

  console.log('Writing history.json...');
  await fs.writeFile(HISTORY_PATH, JSON.stringify(nextHistory, null, 2));

  console.log(`Updated briefing: ${payload.generated_at_et}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
