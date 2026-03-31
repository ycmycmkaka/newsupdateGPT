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
  return `你而家要為一個公開網站製作金融新聞摘要。

目前美東時間日期：${etDate}
目前美東時間：${etTime}
目標讀者：想快速掌握市場重點的投資者與一般讀者。

請使用 Google Search grounding 搜尋最新、最相關的資訊。
只聚焦以下四類對市場有實質影響的最新新聞：
1. 美股與美國經濟
2. 環球經濟
3. 香港經濟／香港市場
4. 重大政策更新（尤其是會影響市場、企業、利率、貿易、監管的政策）

請直接輸出有效 JSON。
不要輸出 markdown。
不要輸出 code fence。
不要輸出任何額外解釋。
所有文字內容必須使用繁體中文。
英文專有名詞、公司名、機構名、指數名可以保留英文原文，但整體說明、摘要、標題、原因分析必須用繁體中文。

請嚴格使用以下 JSON schema：
{
  "generated_at_et": "America/New_York 時區概念下的時間字串",
  "headline": "一句話總結今日重點",
  "summary": "120至220字的繁體中文總結",
  "sections": [
    {
      "key": "us_markets",
      "title": "美股與美國經濟",
      "items": [
        {
          "title": "短標題",
          "summary": "2至4句繁體中文說明",
          "impact": "利好|利淡|中性|觀察",
          "importance": 1,
          "why_it_matters": "一句繁體中文說明為何重要",
          "sources": [
            { "title": "來源標題", "url": "https://..." }
          ]
        }
      ]
    },
    {
      "key": "global_economy",
      "title": "環球經濟",
      "items": []
    },
    {
      "key": "hong_kong",
      "title": "香港經濟",
      "items": []
    },
    {
      "key": "policy",
      "title": "重大政策更新",
      "items": []
    }
  ]
}

規則：
- 每個 section 視乎情況提供 2 至 4 則重點新聞。
- 如果某個 section 今日冇太多重要資訊，可以少寫，不要為了湊數亂寫。
- 優先使用高質來源，例如政府公告、央行、交易所、國際金融媒體、主流新聞機構。
- 每則 item 盡量提供至少 2 個 sources。
- 避免不同 section 重覆同一新聞。
- 內容要平衡、客觀、實用。
- importance 必須是 1 至 5 的整數。
- 如時間對理解新聞重要，請寫清楚日期。
- 連結必須直接有效。
- 必須只輸出嚴格 JSON。
- JSON 字串內要正確處理引號、換行與控制字元。`;
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
