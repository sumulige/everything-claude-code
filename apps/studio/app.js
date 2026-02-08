import { diffRegistries, flattenModules } from './lib/diff.mjs';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ROUTES = ['explore', 'workflows', 'graph', 'compare'];

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function shortDigest(d) {
  if (!d) return '—';
  const s = String(d);
  return s.length > 12 ? `${s.slice(0, 12)}…` : s;
}

function setText(id, text) {
  const el = typeof id === 'string' ? $(id) : id;
  if (!el) return;
  el.textContent = text;
}

function setStatus(el, kind, msg) {
  if (!el) return;
  el.className = `status status--${kind}`;
  el.textContent = msg;
}

function parseRoute(hash) {
  const h = String(hash || '').trim();
  if (!h) return 'explore';

  // Supported:
  // - #/explore
  // - #explore
  const m = h.match(/^#\/?([a-z0-9-]+)/i);
  const route = (m && m[1]) || 'explore';
  return ROUTES.includes(route) ? route : 'explore';
}

function setActiveRoute(route) {
  const r = ROUTES.includes(route) ? route : 'explore';

  $$('.view').forEach(v => {
    const key = v.getAttribute('data-view');
    v.classList.toggle('view--active', key === r);
  });

  $$('.nav__link[data-route]').forEach(a => {
    const key = a.getAttribute('data-route');
    a.classList.toggle('nav__link--active', key === r);
  });

  document.documentElement.style.setProperty('--route', r);
  document.body.setAttribute('data-route', r);
}

function rawUrl(owner, repo, ref, filePath) {
  const safeRef = encodeURIComponent(String(ref || 'main'));
  const safePath = String(filePath || '').replace(/^\/+/, '');
  return `https://raw.githubusercontent.com/${owner}/${repo}/${safeRef}/${safePath}`;
}

function repoHtmlUrl(owner, repo, ref, filePath) {
  const safeRef = encodeURIComponent(String(ref || 'main'));
  const safePath = String(filePath || '').replace(/^\/+/, '');
  return `https://github.com/${owner}/${repo}/blob/${safeRef}/${safePath}`;
}

function inferModuleSourcePath(m) {
  if (!m) return null;
  if (m.type === 'skill' && m.entrypoint) return m.entrypoint;
  if (m.path) return m.path;
  return null;
}

function renderMarkdown(mdText) {
  const src = String(mdText || '');
  const markedGlobal = globalThis && globalThis.marked ? globalThis.marked : null;
  if (!markedGlobal || typeof markedGlobal.parse !== 'function') {
    return `<pre class="code code--tight"><code>${escapeHtml(src)}</code></pre>`;
  }

  // Marked can render raw HTML; we treat repo content as trusted.
  const html = markedGlobal.parse(src, { mangle: false, headerIds: false });
  return `<div class="md">${html}</div>`;
}

function openModal(html) {
  const modal = $('#modal');
  const content = $('#modalContent');
  if (!modal || !content) return;
  content.innerHTML = html;
  if (typeof modal.showModal === 'function') modal.showModal();
  else modal.setAttribute('open', 'open');
}

function closeModal() {
  const modal = $('#modal');
  if (!modal) return;
  if (typeof modal.close === 'function') modal.close();
  else modal.removeAttribute('open');
}

function wireModalClose() {
  const modal = $('#modal');
  const closeBtn = $('#closeModal');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (modal) {
    modal.addEventListener('click', e => {
      if (e.target === modal) closeModal();
    });
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
    });
  }
}

async function startTerminalDemo() {
  const cmdEl = $('#termCmd');
  const outEl = $('#termOut');
  if (!cmdEl || !outEl) return;

  const script = [
    {
      cmd: 'npx ecc plan "Add user authentication"',
      out: [
        'planner: restate requirements',
        'planner: assess risk',
        'planner: propose phases',
        'status: waiting_for_confirmation'
      ]
    },
    {
      cmd: 'npx ecc exec <runId> --worktree',
      out: [
        'kernel: worktree.ensure',
        'provider: patch generation',
        'apply: ownership check',
        'status: patch applied'
      ]
    },
    {
      cmd: 'npx ecc verify <runId>',
      out: [
        'verify: lint',
        'verify: tests',
        'verify: build',
        'status: gate passed'
      ]
    },
    {
      cmd: 'npx ecc run "ship it" --commit',
      out: [
        'evidence: plan.json',
        'evidence: patches/*.diff',
        'evidence: applied.json',
        'evidence: verify/summary.json',
        'status: shipped'
      ]
    }
  ];

  let idx = 0;
  while (true) {
    const item = script[idx % script.length];
    cmdEl.textContent = '';
    outEl.textContent = '';

    for (let i = 0; i < item.cmd.length; i++) {
      cmdEl.textContent += item.cmd[i];
      await sleep(14 + Math.random() * 14);
    }

    await sleep(240);

    for (const line of item.out) {
      outEl.textContent += `${line}\n`;
      await sleep(120 + Math.random() * 90);
    }

    await sleep(1100);
    idx++;
  }
}

async function fetchJson(url, { cache = 'no-store' } = {}) {
  const res = await fetch(url, { cache });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function fetchText(url, { cache = 'no-store' } = {}) {
  const res = await fetch(url, { cache });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function loadRegistry() {
  try {
    return await fetchJson('./data/registry.json', { cache: 'no-store' });
  } catch (err) {
    const hint = $('#hint');
    if (hint) {
      hint.textContent =
        `Could not load ./data/registry.json. If you're opening via file://, run: ` +
        `npm run studio:serve (error: ${err.message})`;
    }
    return null;
  }
}

async function loadWorkflows() {
  try {
    return await fetchJson('./data/workflows.json', { cache: 'no-store' });
  } catch {
    return { version: 1, workflows: [] };
  }
}

function buildUsedByIndex(registry) {
  const usedBy = new Map();
  for (const p of registry.packs || []) {
    for (const mid of p.modules || []) {
      if (!usedBy.has(mid)) usedBy.set(mid, []);
      usedBy.get(mid).push(p.id);
    }
  }
  return usedBy;
}

function renderStats(stats) {
  const el = $('#stats');
  if (!el) return;
  const items = [
    ['agents', stats.agents],
    ['commands', stats.commands],
    ['skills', stats.skills],
    ['rules', stats.rules],
    ['packs', stats.packs]
  ];
  el.innerHTML = items
    .map(([k, v]) => `<span class="stat"><b>${Number(v || 0)}</b> ${escapeHtml(k)}</span>`)
    .join('');
}

function renderPacks(packs) {
  const grid = $('#packsGrid');
  if (!grid) return;

  grid.innerHTML = (packs || [])
    .map(pack => {
      const tags = (pack.tags || []).slice(0, 4);
      const modCount = (pack.modules || []).length;
      return `
        <article class="card fade-in">
          <div class="card__top">
            <h3 class="card__name">${escapeHtml(pack.name)}</h3>
            <span class="row__type">${escapeHtml(pack.id)}</span>
          </div>
          <p class="card__tagline">${escapeHtml(pack.description)}</p>
          <div class="chiprow">
            <span class="chip chip--hot">${modCount} modules</span>
            ${tags.map(t => `<span class="chip">${escapeHtml(t)}</span>`).join('')}
          </div>
          <button class="card__btn" type="button" data-pack="${escapeHtml(pack.id)}">Open pack details</button>
        </article>
      `;
    })
    .join('');
}

function renderModuleList(modules, limit = 48) {
  const list = $('#moduleList');
  if (!list) return;

  const shown = (modules || []).slice(0, limit);
  list.innerHTML = shown
    .map(m => {
      const desc = (m.description || '').trim();
      const srcPath = inferModuleSourcePath(m);
      return `
        <article class="row fade-in">
          <div class="row__top">
            <span class="row__id">${escapeHtml(m.id)}</span>
            <span class="row__type">${escapeHtml(m.type)}</span>
          </div>
          <h3 class="row__name">${escapeHtml(m.name)}</h3>
          <p class="row__desc">${escapeHtml(desc || 'No description.')}</p>
          <div class="row__meta">
            <span class="chip chip--quiet">digest ${escapeHtml(shortDigest(m.digest))}</span>
            ${srcPath ? `<span class="chip chip--quiet">${escapeHtml(srcPath)}</span>` : ''}
          </div>
          <button class="row__btn" type="button" data-module="${escapeHtml(m.id)}">Details</button>
        </article>
      `;
    })
    .join('');
}

function renderPackModal(pack, { modulesById }) {
  const tags = (pack.tags || []).slice(0, 12);
  const modules = (pack.modules || []).map(id => modulesById.get(id)).filter(Boolean);

  return `
    <div class="modal__head">
      <div>
        <div class="modal__eyebrow">Pack</div>
        <div class="modal__title">${escapeHtml(pack.name)}</div>
        <div class="modal__sub">${escapeHtml(pack.id)} · digest ${escapeHtml(shortDigest(pack.digest))}</div>
      </div>
    </div>
    <div class="modal__body">
      <p class="sub" style="margin:0">${escapeHtml(pack.description)}</p>
      <div class="chiprow" style="margin-top:14px">
        ${tags.map(t => `<span class="chip">${escapeHtml(t)}</span>`).join('')}
      </div>

      <div class="panel" style="margin-top:16px">
        <div class="panel__head">
          <div class="panel__title">Modules</div>
          <div class="panel__hint">Click a module to open details</div>
        </div>
        <div class="chipgrid">
          ${(modules || [])
            .map(
              m => `<button class="chip chip--btn" type="button" data-module="${escapeHtml(m.id)}">${escapeHtml(m.id)}</button>`
            )
            .join('')}
        </div>
      </div>
    </div>
  `;
}

function renderModuleOverview(m) {
  const extra = [];
  if (m.path) extra.push(['path', `<code>${escapeHtml(m.path)}</code>`]);
  if (m.entrypoint) extra.push(['entrypoint', `<code>${escapeHtml(m.entrypoint)}</code>`]);
  if (m.model) extra.push(['model', `<code>${escapeHtml(m.model)}</code>`]);
  if (m.tools) extra.push(['tools', `<code>${escapeHtml(m.tools)}</code>`]);

  return `
    <div class="kv">
      <div class="kv__k">id</div>
      <div class="kv__v"><code>${escapeHtml(m.id)}</code></div>
      <div class="kv__k">type</div>
      <div class="kv__v"><code>${escapeHtml(m.type)}</code></div>
      <div class="kv__k">name</div>
      <div class="kv__v">${escapeHtml(m.name)}</div>
      <div class="kv__k">digest</div>
      <div class="kv__v"><code>${escapeHtml(m.digest || '')}</code></div>
      <div class="kv__k">description</div>
      <div class="kv__v">${escapeHtml((m.description || '').trim() || 'No description.')}</div>
      ${extra
        .map(
          ([k, v]) => `
            <div class="kv__k">${escapeHtml(k)}</div>
            <div class="kv__v">${v}</div>
          `
        )
        .join('')}
    </div>
  `;
}

function renderModuleUsedBy(m, { packsById, usedBy }) {
  const packs = (usedBy.get(m.id) || []).map(id => packsById.get(id)).filter(Boolean);

  return `
    <div class="panel">
      <div class="panel__head">
        <div class="panel__title">Used By</div>
        <div class="panel__hint">${packs.length} pack(s)</div>
      </div>
      <div class="chipgrid">
        ${packs
          .map(
            p =>
              `<button class="chip chip--btn" type="button" data-pack="${escapeHtml(p.id)}">${escapeHtml(p.id)}</button>`
          )
          .join('')}
      </div>
    </div>
  `;
}

async function renderModuleSource(m, { owner, repo, ref }) {
  const p = inferModuleSourcePath(m);
  if (!p) {
    return `<div class="panel"><div class="panel__head"><div class="panel__title">Source</div></div><p class="sub">No source path in registry.</p></div>`;
  }

  const url = rawUrl(owner, repo, ref, p);
  try {
    const text = await fetchText(url, { cache: 'no-store' });
    const isMarkdown = /\.mdx?$/i.test(p);
    const body = isMarkdown ? renderMarkdown(text) : `<pre class="code"><code>${escapeHtml(text)}</code></pre>`;
    return `
      <div class="panel">
        <div class="panel__head">
          <div class="panel__title">Source</div>
          <div class="panel__hint"><a class="link" href="${escapeHtml(repoHtmlUrl(owner, repo, ref, p))}" target="_blank" rel="noreferrer">Open on GitHub</a></div>
        </div>
        ${body}
      </div>
    `;
  } catch (err) {
    return `
      <div class="panel">
        <div class="panel__head">
          <div class="panel__title">Source</div>
          <div class="panel__hint"><a class="link" href="${escapeHtml(repoHtmlUrl(owner, repo, ref, p))}" target="_blank" rel="noreferrer">Open on GitHub</a></div>
        </div>
        <p class="sub">Could not fetch raw content (${escapeHtml(err.message)}).</p>
        <p class="sub">URL: <code>${escapeHtml(url)}</code></p>
      </div>
    `;
  }
}

function renderModuleModalShell(m, activeTab, bodyHtml) {
  const tabs = [
    ['overview', 'Overview'],
    ['source', 'Source'],
    ['usedby', 'Used By']
  ];

  return `
    <div class="modal__head">
      <div>
        <div class="modal__eyebrow">${escapeHtml(m.type)}</div>
        <div class="modal__title">${escapeHtml(m.name)}</div>
        <div class="modal__sub">${escapeHtml(m.id)} · digest ${escapeHtml(shortDigest(m.digest))}</div>
      </div>
    </div>
    <div class="tabs" role="tablist" aria-label="Module tabs">
      ${tabs
        .map(
          ([id, label]) => `
            <button
              class="tab ${id === activeTab ? 'tab--active' : ''}"
              type="button"
              role="tab"
              aria-selected="${id === activeTab ? 'true' : 'false'}"
              data-modal-tab="${id}"
            >
              ${escapeHtml(label)}
            </button>
          `
        )
        .join('')}
    </div>
    <div class="modal__body">${bodyHtml}</div>
  `;
}

function wireModalTabs({ onTab }) {
  const content = $('#modalContent');
  if (!content) return;
  $$('.tab[data-modal-tab]', content).forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-modal-tab');
      if (tab) onTab(tab);
    });
  });
}

async function openModuleModal(m, tab, ctx) {
  const active = tab || 'overview';
  const body = active === 'overview'
    ? renderModuleOverview(m)
    : active === 'usedby'
      ? renderModuleUsedBy(m, { packsById: ctx.packsById, usedBy: ctx.usedBy })
      : await renderModuleSource(m, { owner: ctx.owner, repo: ctx.repo, ref: ctx.ref });

  openModal(renderModuleModalShell(m, active, body));
  wireModalTabs({ onTab: next => openModuleModal(m, next, ctx) });
}

function stampGeneratedAt(registry) {
  const el = $('#genAt');
  if (!el) return;
  el.textContent = registry.generatedAt ? new Date(registry.generatedAt).toLocaleString() : 'unknown';
}

function updateRepoLink(registry) {
  const a = $('#repoLink');
  if (!a) return;
  const owner = registry.repo && registry.repo.owner ? registry.repo.owner : 'sumulige';
  const name = registry.repo && registry.repo.name ? registry.repo.name : 'ecc-conveyor';
  a.href = `https://github.com/${owner}/${name}`;
}

function renderWorkflowsList(workflows, activeId) {
  const el = $('#wfList');
  if (!el) return;

  el.innerHTML = (workflows || [])
    .map(w => {
      const active = w.id === activeId;
      return `
        <button class="wfitem ${active ? 'wfitem--active' : ''}" type="button" data-wf="${escapeHtml(w.id)}">
          <div class="wfitem__title">${escapeHtml(w.title)}</div>
          <div class="wfitem__sub">${escapeHtml(w.summary || '')}</div>
        </button>
      `;
    })
    .join('');
}

function renderWorkflowHeader(w) {
  const el = $('#wfHeader');
  if (!el) return;
  if (!w) {
    el.innerHTML = `<div class="status status--warn">No workflows loaded.</div>`;
    return;
  }

  el.innerHTML = `
    <div class="wfhead">
      <div class="wfhead__kicker">Workflow</div>
      <div class="wfhead__title">${escapeHtml(w.title)}</div>
      <div class="wfhead__sub">${escapeHtml(w.summary || '')}</div>
    </div>
  `;
}

function renderWorkflowSteps(w, stepIndex) {
  const stepsEl = $('#wfSteps');
  if (!stepsEl) return;
  if (!w) {
    stepsEl.innerHTML = '';
    return;
  }

  const steps = w.steps || [];
  const idx = clamp(stepIndex || 0, 0, Math.max(0, steps.length - 1));

  stepsEl.innerHTML = steps
    .map((s, i) => {
      const active = i === idx;
      const chips = (s.modules || [])
        .map(id => `<button class="chip chip--btn" type="button" data-module="${escapeHtml(id)}">${escapeHtml(id)}</button>`)
        .join('');
      return `
        <div class="wfstep ${active ? 'wfstep--active' : ''}" data-step="${i}">
          <div class="wfstep__idx">${String(i + 1).padStart(2, '0')}</div>
          <div class="wfstep__main">
            <div class="wfstep__title">${escapeHtml(s.title)}</div>
            <div class="wfstep__desc">${escapeHtml(s.description || '')}</div>
            ${chips ? `<div class="chipgrid chipgrid--tight">${chips}</div>` : ''}
          </div>
        </div>
      `;
    })
    .join('');

  return idx;
}

function renderWorkflowArtifacts(w, stepIndex) {
  const el = $('#wfArtifacts');
  if (!el) return;
  if (!w) {
    el.innerHTML = '';
    return;
  }

  const steps = w.steps || [];
  const s = steps[stepIndex] || null;
  const arts = (s && s.artifacts) || [];

  if (!arts.length) {
    el.innerHTML = `<div class="panel"><div class="panel__head"><div class="panel__title">Artifacts</div></div><p class="sub">No artifacts for this step.</p></div>`;
    return;
  }

  el.innerHTML = `
    <div class="panel">
      <div class="panel__head">
        <div class="panel__title">Artifacts</div>
        <div class="panel__hint">Render-only, for demonstration</div>
      </div>
      <div class="artlist">
        ${arts
          .map(a => {
            const title = a.title || a.path || 'Artifact';
            const body = a.body || '';
            const kind = a.kind || 'text';
            const codeClass = kind === 'diff' ? 'code--diff' : '';
            return `
              <details class="art" ${a.open ? 'open' : ''}>
                <summary class="art__sum">
                  <span class="art__title">${escapeHtml(title)}</span>
                  ${a.path ? `<span class="art__path"><code>${escapeHtml(a.path)}</code></span>` : ''}
                </summary>
                <div class="art__body">
                  <pre class="code ${codeClass}"><code>${escapeHtml(body)}</code></pre>
                </div>
              </details>
            `;
          })
          .join('')}
      </div>
    </div>
  `;
}

function layoutGraph(registry, { filter = '' } = {}) {
  const packs = registry.packs || [];
  const modules = flattenModules(registry);

  const term = String(filter || '').trim().toLowerCase();

  const packHits = new Set();
  const moduleHits = new Set();
  if (term) {
    for (const p of packs) {
      const hay = `${p.id} ${p.name} ${p.description}`.toLowerCase();
      if (hay.includes(term)) packHits.add(p.id);
    }
    for (const m of modules) {
      const hay = `${m.id} ${m.type} ${m.name} ${m.description || ''}`.toLowerCase();
      if (hay.includes(term)) moduleHits.add(m.id);
    }
  }

  const usedBy = buildUsedByIndex(registry);
  const visiblePacks = new Set();
  const visibleModules = new Set();

  if (!term) {
    packs.forEach(p => visiblePacks.add(p.id));
    modules.forEach(m => visibleModules.add(m.id));
  } else {
    packHits.forEach(id => visiblePacks.add(id));
    moduleHits.forEach(id => visibleModules.add(id));
    // Expand to connected nodes.
    for (const p of packs) {
      if (!visiblePacks.has(p.id)) continue;
      for (const mid of p.modules || []) visibleModules.add(mid);
    }
    for (const mid of visibleModules) {
      for (const pid of usedBy.get(mid) || []) visiblePacks.add(pid);
    }
  }

  const visiblePacksArr = packs.filter(p => visiblePacks.has(p.id));
  const visibleModulesArr = modules.filter(m => visibleModules.has(m.id));

  // Deterministic layout: packs by id; modules by first pack appearance then id.
  const packOrder = new Map();
  visiblePacksArr.forEach((p, i) => packOrder.set(p.id, i));

  function firstPackIndex(mid) {
    const ps = usedBy.get(mid) || [];
    let best = 999999;
    for (const pid of ps) {
      const idx = packOrder.has(pid) ? packOrder.get(pid) : 999999;
      best = Math.min(best, idx);
    }
    return best;
  }

  const packsSorted = [...visiblePacksArr].sort((a, b) => a.id.localeCompare(b.id));
  const modulesSorted = [...visibleModulesArr].sort((a, b) => {
    const da = firstPackIndex(a.id);
    const db = firstPackIndex(b.id);
    if (da !== db) return da - db;
    return a.id.localeCompare(b.id);
  });

  const xPack = 90;
  const xMod = 740;
  const rowH = 34;
  const padY = 24;

  const packNodes = packsSorted.map((p, i) => ({
    kind: 'pack',
    id: p.id,
    label: p.name,
    x: xPack,
    y: padY + i * rowH,
    obj: p
  }));

  const modNodes = modulesSorted.map((m, i) => ({
    kind: 'module',
    id: m.id,
    label: `${m.type} · ${m.name}`,
    x: xMod,
    y: padY + i * rowH,
    obj: m
  }));

  const packPos = new Map(packNodes.map(n => [n.id, n]));
  const modPos = new Map(modNodes.map(n => [n.id, n]));

  const edges = [];
  for (const p of packsSorted) {
    if (!packPos.has(p.id)) continue;
    for (const mid of p.modules || []) {
      if (!modPos.has(mid)) continue;
      edges.push({ packId: p.id, moduleId: mid });
    }
  }

  const height = Math.max(packNodes.length, modNodes.length) * rowH + padY * 2;
  const width = 1120;

  return { width, height, packNodes, modNodes, edges };
}

function renderGraph(registry, filter) {
  const wrap = $('#graphWrap');
  const meta = $('#graphMeta');
  if (!wrap || !meta) return;

  const g = layoutGraph(registry, { filter });
  const { width, height, packNodes, modNodes, edges } = g;

  meta.innerHTML = `
    <span class="chip chip--quiet">${packNodes.length} packs</span>
    <span class="chip chip--quiet">${modNodes.length} modules</span>
    <span class="chip chip--quiet">${edges.length} edges</span>
  `;

  const edgePaths = edges
    .map(e => {
      const p = packNodes.find(n => n.id === e.packId);
      const m = modNodes.find(n => n.id === e.moduleId);
      if (!p || !m) return '';
      const x1 = p.x + 240;
      const y1 = p.y + 10;
      const x2 = m.x - 30;
      const y2 = m.y + 10;
      const c1 = x1 + 110;
      const c2 = x2 - 110;
      return `<path class="edge" data-pack="${escapeHtml(e.packId)}" data-module="${escapeHtml(e.moduleId)}" d="M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}" />`;
    })
    .join('');

  const packLabels = packNodes
    .map(n => {
      return `
        <g class="node node--pack" data-node-kind="pack" data-node-id="${escapeHtml(n.id)}">
          <rect class="node__bg" x="${n.x}" y="${n.y}" rx="12" ry="12" width="260" height="22"></rect>
          <text class="node__text" x="${n.x + 12}" y="${n.y + 15}">${escapeHtml(n.id)}</text>
        </g>
      `;
    })
    .join('');

  const modLabels = modNodes
    .map(n => {
      return `
        <g class="node node--mod" data-node-kind="module" data-node-id="${escapeHtml(n.id)}">
          <rect class="node__bg" x="${n.x}" y="${n.y}" rx="12" ry="12" width="340" height="22"></rect>
          <text class="node__text" x="${n.x + 12}" y="${n.y + 15}">${escapeHtml(n.id)}</text>
        </g>
      `;
    })
    .join('');

  wrap.innerHTML = `
    <svg class="graphsvg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Packs to modules dependency graph">
      <defs>
        <linearGradient id="edgeGrad" x1="0" x2="1">
          <stop offset="0" stop-color="rgba(255,77,46,0.55)" />
          <stop offset="1" stop-color="rgba(0,210,201,0.45)" />
        </linearGradient>
      </defs>
      <g class="edges">${edgePaths}</g>
      <g class="nodes">${packLabels}${modLabels}</g>
    </svg>
  `;
}

function wireGraphInteractions({ modulesById, packsById }) {
  const wrap = $('#graphWrap');
  if (!wrap) return;

  function clear() {
    $$('.node', wrap).forEach(n => n.classList.remove('is-hot'));
    $$('.edge', wrap).forEach(e => e.classList.remove('is-hot'));
  }

  function hotPack(pid) {
    clear();
    $$('.edge', wrap).forEach(e => {
      if (e.getAttribute('data-pack') === pid) e.classList.add('is-hot');
    });
    $$('.node', wrap).forEach(n => {
      const kind = n.getAttribute('data-node-kind');
      const id = n.getAttribute('data-node-id');
      if (kind === 'pack' && id === pid) n.classList.add('is-hot');
      if (kind === 'module') {
        const hit = $$('.edge.is-hot', wrap).some(e => e.getAttribute('data-module') === id);
        if (hit) n.classList.add('is-hot');
      }
    });
  }

  function hotModule(mid) {
    clear();
    $$('.edge', wrap).forEach(e => {
      if (e.getAttribute('data-module') === mid) e.classList.add('is-hot');
    });
    $$('.node', wrap).forEach(n => {
      const kind = n.getAttribute('data-node-kind');
      const id = n.getAttribute('data-node-id');
      if (kind === 'module' && id === mid) n.classList.add('is-hot');
      if (kind === 'pack') {
        const hit = $$('.edge.is-hot', wrap).some(e => e.getAttribute('data-pack') === id);
        if (hit) n.classList.add('is-hot');
      }
    });
  }

  wrap.addEventListener('click', e => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const node = t.closest('.node');
    if (!node) return;
    const kind = node.getAttribute('data-node-kind');
    const id = node.getAttribute('data-node-id');
    if (!kind || !id) return;

    if (kind === 'pack') {
      hotPack(id);
      const p = packsById.get(id);
      if (p) openModal(renderPackModal(p, { modulesById }));
      return;
    }

    if (kind === 'module') {
      hotModule(id);
      const m = modulesById.get(id);
      if (m) {
        // Prefer overview in graph; tabs still available.
        openModuleModal(m, 'overview', window.__psCtx);
      }
    }
  });
}

async function fetchTags({ owner, repo }) {
  const cacheKey = `ps_tags_${owner}_${repo}`;
  const now = Date.now();

  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    if (cached && cached.tags && Array.isArray(cached.tags) && now - cached.at < 60 * 60 * 1000) {
      return cached.tags;
    }
  } catch {
    // ignore
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/tags?per_page=100`;
  const data = await fetchJson(url, { cache: 'no-store' });
  const tags = (data || []).map(t => t && t.name).filter(Boolean);

  try {
    localStorage.setItem(cacheKey, JSON.stringify({ at: now, tags }));
  } catch {
    // ignore
  }

  return tags;
}

function fillTagSelect(sel, tags) {
  if (!sel) return;
  sel.innerHTML = (tags || [])
    .map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
    .join('');
}

function getChosenTag(selectEl, manualEl) {
  const manual = (manualEl && manualEl.value ? manualEl.value : '').trim();
  if (manual) return manual;
  return (selectEl && selectEl.value ? selectEl.value : '').trim();
}

function renderDiffList(kind, items, { baseTag, headTag, owner, repo }) {
  if (!items || !items.length) return `<div class="cmpempty">Nothing here.</div>`;

  return `
    <div class="cmplist">
      ${items
        .slice(0, 200)
        .map(it => {
          const obj = it.after || it.before || it;
          const id = obj.id || it.id;
          const name = obj.name || '';
          const type = obj.type || 'pack';
          const p = inferModuleSourcePath(obj) || obj.path || null;

          const links = [];
          if (p && kind === 'modules') {
            if (it.before) links.push({ label: 'base', href: repoHtmlUrl(owner, repo, baseTag, p) });
            if (it.after) links.push({ label: 'head', href: repoHtmlUrl(owner, repo, headTag, p) });
          }

          return `
            <div class="cmpitem">
              <div class="cmpitem__main">
                <div class="cmpitem__id"><code>${escapeHtml(id)}</code></div>
                <div class="cmpitem__sub">${escapeHtml(type)}${name ? ` · ${escapeHtml(name)}` : ''}</div>
              </div>
              <div class="cmpitem__meta">
                ${obj.digest ? `<span class="chip chip--quiet">${escapeHtml(shortDigest(obj.digest))}</span>` : ''}
              </div>
              <div class="cmpitem__actions">
                <button class="btn btn--ghost btn--tiny" type="button" data-cmp-open="${escapeHtml(kind)}:${escapeHtml(id)}">Details</button>
                ${links
                  .map(
                    l =>
                      `<a class="btn btn--ghost btn--tiny" href="${escapeHtml(l.href)}" target="_blank" rel="noreferrer">${escapeHtml(l.label)}</a>`
                  )
                  .join('')}
              </div>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderCompareGrid(diff, ctx) {
  const el = $('#cmpGrid');
  if (!el) return;

  const card = (title, sub, inner) => `
    <div class="cmpcard">
      <div class="cmpcard__head">
        <div class="cmpcard__title">${escapeHtml(title)}</div>
        <div class="cmpcard__sub">${escapeHtml(sub)}</div>
      </div>
      <div class="cmpcard__body">${inner}</div>
    </div>
  `;

  el.innerHTML =
    card('Modules: Added', `${diff.modules.added.length}`, renderDiffList('modules', diff.modules.added, ctx)) +
    card('Modules: Removed', `${diff.modules.removed.length}`, renderDiffList('modules', diff.modules.removed, ctx)) +
    card('Modules: Changed', `${diff.modules.changed.length}`, renderDiffList('modules', diff.modules.changed, ctx)) +
    card('Packs: Added', `${diff.packs.added.length}`, renderDiffList('packs', diff.packs.added, ctx)) +
    card('Packs: Removed', `${diff.packs.removed.length}`, renderDiffList('packs', diff.packs.removed, ctx)) +
    card('Packs: Changed', `${diff.packs.changed.length}`, renderDiffList('packs', diff.packs.changed, ctx));
}

function openCompareDetails({ baseTag, headTag, owner, repo, baseRegistry, headRegistry, kind, id }) {
  const baseMods = new Map(flattenModules(baseRegistry).map(m => [m.id, m]));
  const headMods = new Map(flattenModules(headRegistry).map(m => [m.id, m]));
  const basePacks = new Map((baseRegistry.packs || []).map(p => [p.id, p]));
  const headPacks = new Map((headRegistry.packs || []).map(p => [p.id, p]));

  const before = kind === 'modules' ? baseMods.get(id) : basePacks.get(id);
  const after = kind === 'modules' ? headMods.get(id) : headPacks.get(id);

  const title = `${kind === 'modules' ? 'Module' : 'Pack'} · ${id}`;
  const meta = `${baseTag} → ${headTag}`;

  const renderObj = (label, obj, tag) => {
    if (!obj) return `<div class="cmpdetail__missing">${escapeHtml(label)}: missing</div>`;
    const srcPath = kind === 'modules' ? inferModuleSourcePath(obj) : obj.path;
    const srcLink = srcPath ? repoHtmlUrl(owner, repo, tag, srcPath) : null;
    return `
      <div class="cmpdetail">
        <div class="cmpdetail__head">
          <div class="cmpdetail__title">${escapeHtml(label)} <span class="chip chip--quiet">${escapeHtml(tag)}</span></div>
          ${srcLink ? `<a class="link" href="${escapeHtml(srcLink)}" target="_blank" rel="noreferrer">Open on GitHub</a>` : ''}
        </div>
        <div class="kv kv--tight">
          <div class="kv__k">id</div><div class="kv__v"><code>${escapeHtml(obj.id)}</code></div>
          ${kind === 'modules' ? `<div class="kv__k">type</div><div class="kv__v"><code>${escapeHtml(obj.type)}</code></div>` : ''}
          <div class="kv__k">name</div><div class="kv__v">${escapeHtml(obj.name || '')}</div>
          <div class="kv__k">digest</div><div class="kv__v"><code>${escapeHtml(obj.digest || '')}</code></div>
          ${srcPath ? `<div class="kv__k">path</div><div class="kv__v"><code>${escapeHtml(srcPath)}</code></div>` : ''}
        </div>
      </div>
    `;
  };

  openModal(`
    <div class="modal__head">
      <div>
        <div class="modal__eyebrow">Compare</div>
        <div class="modal__title">${escapeHtml(title)}</div>
        <div class="modal__sub">${escapeHtml(meta)}</div>
      </div>
    </div>
    <div class="modal__body">
      <div class="cmpdetailgrid">
        ${renderObj('Base', before, baseTag)}
        ${renderObj('Head', after, headTag)}
      </div>
    </div>
  `);
}

async function main() {
  document.body.classList.add('is-loaded');
  wireModalClose();
  startTerminalDemo();

  const route = parseRoute(location.hash);
  setActiveRoute(route);

  window.addEventListener('hashchange', () => {
    setActiveRoute(parseRoute(location.hash));
  });

  const registry = await loadRegistry();
  if (!registry) return;

  stampGeneratedAt(registry);
  updateRepoLink(registry);

  const owner = registry.repo && registry.repo.owner ? registry.repo.owner : 'sumulige';
  const repo = registry.repo && registry.repo.name ? registry.repo.name : 'ecc-conveyor';
  const ref =
    registry.repo && (registry.repo.tag || registry.repo.defaultBranch || registry.repo.sha)
      ? (registry.repo.tag || registry.repo.defaultBranch || registry.repo.sha)
      : 'main';

  const packs = registry.packs || [];
  const modules = flattenModules(registry);

  const modulesById = new Map(modules.map(m => [m.id, m]));
  const packsById = new Map(packs.map(p => [p.id, p]));
  const usedBy = buildUsedByIndex(registry);

  const ctx = { owner, repo, ref, modulesById, packsById, usedBy };
  window.__psCtx = ctx;

  renderStats(registry.stats || {});
  renderPacks(packs);

  const q = $('#q');
  const hint = $('#hint');

  function setHint(msg) {
    if (!hint) return;
    hint.textContent = msg || '';
  }

  function doFilter() {
    const term = q ? q.value.trim().toLowerCase() : '';
    if (!term) {
      setHint(`Showing top modules. Search across ${modules.length} items.`);
      renderModuleList(modules, 48);
      return;
    }

    const filtered = modules.filter(m => {
      const hay = `${m.id} ${m.type} ${m.name} ${m.description || ''} ${m.path || ''}`.toLowerCase();
      return hay.includes(term);
    });

    setHint(`Found ${filtered.length} matches for "${term}".`);
    renderModuleList(filtered, 48);
  }

  if (q) q.addEventListener('input', doFilter);
  doFilter();

  // Workflows.
  const wfData = await loadWorkflows();
  const workflows = (wfData && wfData.workflows) || [];
  let wfActive = workflows.length ? workflows[0].id : null;
  let wfStep = 0;

  function rerenderWorkflows() {
    const w = workflows.find(x => x.id === wfActive) || workflows[0] || null;
    renderWorkflowsList(workflows, wfActive);
    renderWorkflowHeader(w);
    wfStep = renderWorkflowSteps(w, wfStep) || 0;
    renderWorkflowArtifacts(w, wfStep);
  }

  rerenderWorkflows();

  document.addEventListener('click', async e => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    // Module details.
    const modId = t.getAttribute('data-module');
    if (modId) {
      const m = modulesById.get(modId);
      if (!m) return;
      await openModuleModal(m, 'overview', ctx);
      return;
    }

    // Pack details.
    const packId = t.getAttribute('data-pack');
    if (packId) {
      const p = packsById.get(packId);
      if (!p) return;
      openModal(renderPackModal(p, { modulesById }));
      return;
    }

    // Workflow selection.
    const wfId = t.getAttribute('data-wf');
    if (wfId) {
      wfActive = wfId;
      wfStep = 0;
      rerenderWorkflows();
      return;
    }

    const stepEl = t.closest('.wfstep');
    if (stepEl && stepEl.getAttribute('data-step')) {
      const idx = parseInt(stepEl.getAttribute('data-step'), 10);
      if (!Number.isNaN(idx)) {
        wfStep = idx;
        rerenderWorkflows();
      }
      return;
    }

    // Compare details modal.
    const cmpOpen = t.getAttribute('data-cmp-open');
    if (cmpOpen && window.__psCompareCtx) {
      const [kind, itemId] = String(cmpOpen).split(':');
      const ctx = window.__psCompareCtx;
      openCompareDetails({
        baseTag: ctx.baseTag,
        headTag: ctx.headTag,
        owner: ctx.owner,
        repo: ctx.repo,
        baseRegistry: ctx.baseRegistry,
        headRegistry: ctx.headRegistry,
        kind,
        id: itemId
      });
    }
  });

  // Graph.
  const graphQ = $('#graphQ');
  const renderGraphNow = () => {
    const term = graphQ ? graphQ.value : '';
    renderGraph(registry, term);
  };

  if (graphQ) graphQ.addEventListener('input', renderGraphNow);
  renderGraphNow();
  wireGraphInteractions({ modulesById, packsById });

  // Compare.
  const cmpStatus = $('#cmpStatus');
  const cmpBase = $('#cmpBase');
  const cmpHead = $('#cmpHead');
  const cmpBaseManual = $('#cmpBaseManual');
  const cmpHeadManual = $('#cmpHeadManual');

  try {
    const tags = await fetchTags({ owner, repo });
    fillTagSelect(cmpBase, tags);
    fillTagSelect(cmpHead, tags);
    if (tags.length >= 2) {
      cmpHead.value = tags[0];
      cmpBase.value = tags[1];
    } else if (tags.length === 1) {
      cmpHead.value = tags[0];
      cmpBase.value = tags[0];
    }
    setStatus(cmpStatus, 'ok', `Loaded ${tags.length} tags from GitHub.`);
  } catch (err) {
    setStatus(
      cmpStatus,
      'warn',
      `Could not load tags from GitHub (rate limited or offline). Use manual tag input. (${err.message})`
    );
  }

  const cmpRun = $('#cmpRun');
  const cmpSwap = $('#cmpSwap');

  if (cmpSwap) {
    cmpSwap.addEventListener('click', () => {
      const a = getChosenTag(cmpBase, cmpBaseManual);
      const b = getChosenTag(cmpHead, cmpHeadManual);
      if (cmpBaseManual && cmpHeadManual) {
        cmpBaseManual.value = b;
        cmpHeadManual.value = a;
      }
      if (cmpBase && cmpHead) {
        cmpBase.value = b;
        cmpHead.value = a;
      }
    });
  }

  if (cmpRun) {
    cmpRun.addEventListener('click', async () => {
      const baseTag = getChosenTag(cmpBase, cmpBaseManual);
      const headTag = getChosenTag(cmpHead, cmpHeadManual);

      if (!baseTag || !headTag) {
        setStatus(cmpStatus, 'err', 'Select or type both tags.');
        return;
      }

      setStatus(cmpStatus, 'info', `Fetching registries: ${baseTag} and ${headTag}…`);

      try {
        const baseRegistry = await fetchJson(rawUrl(owner, repo, baseTag, 'apps/studio/data/registry.json'), {
          cache: 'no-store'
        });
        const headRegistry = await fetchJson(rawUrl(owner, repo, headTag, 'apps/studio/data/registry.json'), {
          cache: 'no-store'
        });

        const diff = diffRegistries(baseRegistry, headRegistry);
        renderCompareGrid(diff, { baseTag, headTag, owner, repo });
        setStatus(cmpStatus, 'ok', `Diff computed: ${baseTag} → ${headTag}.`);

        // Stash context for details modals.
        window.__psCompareCtx = { baseTag, headTag, owner, repo, baseRegistry, headRegistry };
      } catch (err) {
        setStatus(cmpStatus, 'err', `Compare failed: ${err.message}`);
      }
    });
  }
}

main();
