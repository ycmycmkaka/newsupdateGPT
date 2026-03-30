async function getJson(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

function sourceLink(source) {
  const a = document.createElement('a');
  a.href = source.url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = source.title;
  return a;
}

function renderLatest(latest) {
  document.getElementById('generatedAt').textContent = latest.generated_at_et || 'Unknown';
  document.getElementById('headline').textContent = latest.headline || 'No headline available';
  document.getElementById('summary').textContent = latest.summary || '';

  const sectionsRoot = document.getElementById('sections');
  const sectionTemplate = document.getElementById('sectionTemplate');
  const itemTemplate = document.getElementById('itemTemplate');

  sectionsRoot.innerHTML = '';

  for (const section of latest.sections || []) {
    const sectionNode = sectionTemplate.content.firstElementChild.cloneNode(true);
    sectionNode.querySelector('.section-title').textContent = section.title;

    const itemsRoot = sectionNode.querySelector('.items');
    if (!section.items?.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No major developments highlighted in this cycle.';
      itemsRoot.appendChild(empty);
    } else {
      for (const item of section.items) {
        const itemNode = itemTemplate.content.firstElementChild.cloneNode(true);
        itemNode.querySelector('.item-title').textContent = item.title;
        itemNode.querySelector('.badge').textContent = `${item.impact} · ${item.importance}/5`;
        itemNode.querySelector('.item-summary').textContent = item.summary;
        itemNode.querySelector('.item-matters').textContent = `Why it matters: ${item.why_it_matters}`;

        const sourcesRoot = itemNode.querySelector('.sources');
        for (const source of item.sources || []) {
          sourcesRoot.appendChild(sourceLink(source));
        }
        itemsRoot.appendChild(itemNode);
      }
    }

    sectionsRoot.appendChild(sectionNode);
  }
}

function renderHistory(history) {
  const root = document.getElementById('history');
  const tpl = document.getElementById('historyTemplate');
  root.innerHTML = '';

  for (const entry of history || []) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.querySelector('.history-time').textContent = entry.generated_at_et;
    node.querySelector('.history-headline').textContent = entry.headline;
    node.querySelector('.history-summary').textContent = entry.summary;
    root.appendChild(node);
  }
}

async function boot() {
  try {
    const [latest, history] = await Promise.all([
      getJson('./data/latest.json'),
      getJson('./data/history.json'),
    ]);
    renderLatest(latest);
    renderHistory(history);
  } catch (error) {
    document.getElementById('headline').textContent = 'Unable to load the latest briefing';
    document.getElementById('summary').textContent = error.message;
  }
}

boot();
