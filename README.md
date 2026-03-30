# Daily Market Policy Briefing Site

This template gives you a GitHub Pages website that updates itself **twice a day** and publishes a fresh summary covering:

- U.S. stocks and economy
- Global economy
- Hong Kong economy
- Major policy updates affecting markets

## How it works

1. A GitHub Actions workflow runs at **8:00 AM** and **8:00 PM** in **America/New_York**.
2. The workflow calls the **OpenAI Responses API** with the **web_search** tool enabled.
3. The model generates structured JSON with the latest briefing.
4. The workflow saves the JSON into `site/data/latest.json` and `site/data/history.json`.
5. GitHub Pages deploys the static site in `site/`.

## Setup

### 1) Create a new GitHub repository

Create an empty repository, then upload all files from this template.

### 2) Add your OpenAI API key

In GitHub:

- Go to **Settings** → **Secrets and variables** → **Actions**
- Create a new repository secret named: `OPENAI_API_KEY`
- Paste your API key

### 3) Enable GitHub Pages

In GitHub:

- Go to **Settings** → **Pages**
- Under **Source**, choose **GitHub Actions**

### 4) Run it once manually

Go to **Actions** → **Update and Deploy Market News Briefing** → **Run workflow**

After the first successful run, your site URL will appear in the workflow deployment output.

## Local test

```bash
npm install
export OPENAI_API_KEY="your_key_here"
npm run generate
```

Then open `site/index.html` in a browser.

## Customizations

### Change the schedule

Edit `.github/workflows/update-news.yml`:

```yml
schedule:
  - cron: '0 8,20 * * *'
    timezone: 'America/New_York'
```

### Change the model

Edit the workflow env section:

```yml
env:
  OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  OPENAI_MODEL: gpt-5
```

### Change the briefing style

Edit `buildPrompt()` in `scripts/generate-news.mjs`.

## Recommended next improvements

- add a sector-specific section for AI / semiconductors / rates
- add email or Telegram alerts after each publish
- keep a longer searchable archive in JSON
- add charts from market APIs if you also want index moves shown visually

## Notes

- This is a **static site**, so hosting is simple and cheap.
- The quality of the briefing depends on your prompt and API usage.
- Review output regularly, especially in the first week, and tighten the prompt if you want a more specific tone.
