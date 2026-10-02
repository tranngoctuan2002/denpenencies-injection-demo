'use strict';

// ======================================================================
// helpers
// ======================================================================
const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const state = {
  user: 'alice',
  cart: null,            // productId -> qty
  lastGraph: null,       // previous order's annotated tree (to show "same as last order / new")
  probeRuns: [],         // lifetimes page: previous requests, newest first
  timer: null
};

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-Demo-User': state.user, ...(opts.headers || {}) }
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const text = await res.text();               // some endpoints (e.g. reset) may return an empty body
  return text ? JSON.parse(text) : null;
}
const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body ?? {}) });

function hashHue(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
const hue = g => /^[0-9a-f]{8}-/i.test(g) ? parseInt(g.replace(/-/g, '').slice(0, 6), 16) % 360 : hashHue(g);
const chip = g => g ? `<span class="chip" style="--h:${hue(g)}" title="${esc(g)}">${esc(String(g).slice(0, 8))}</span>` : '<span class="dash">–</span>';
const badge = l => `<span class="badge t-${esc(l)}">${esc(l)}</span>`;
const money = n => Number(n).toFixed(2);
const time = iso => new Date(iso.endsWith('Z') ? iso : iso + 'Z').toLocaleTimeString();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// hovering a chip lights up every chip with the same id: "everyone who received THIS object"
document.addEventListener('mouseover', e => toggleChips(e.target, true));
document.addEventListener('mouseout', e => toggleChips(e.target, false));
function toggleChips(el, on) {
  const chipEl = el.closest?.('.chip');
  if (!chipEl) return;
  document.querySelectorAll('.chip').forEach(c => { if (c.title === chipEl.title) c.classList.toggle('hl', on); });
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove('show'), 2600);
}

function highlight(code) {
  return esc(code)
    .replace(/(\/\/.*)$/gm, '<span class="c">$1</span>')
    .replace(/\b(public|private|class|interface|record|new|await|async|return|var|if|else|foreach|for|using|namespace|static|readonly|const|sealed|override|void|null|true|false|this|try|catch|throw)\b(?![^<]*<\/span>)/g, '<span class="k">$1</span>');
}

// ---- page building blocks: 1 Context -> 2 Try it -> 3 What happened -> 4 Why it matters ----
const split = (left, right) => `<div class="split"><div class="col">${left}</div><div class="col">${right}</div></div>`;
const section = (n, title, html, extra = '') => `<section class="step ${extra}"><h2><span class="n">${n}</span>${title}</h2>${html}</section>`;
const plain = (title, html) => `<section class="step"><h2>${title}</h2>${html}</section>`;

// a short, plain description of the situation (no dialogue)
const contextCard = (text, look) => section(1, 'Context', `<p>${text}</p>${look ? `<p class="look">👀 ${look}</p>` : ''}`, 'story');

const waiting = (text = 'Click a button on the left – what happens is shown here.') =>
  `<section class="step waiting" id="happened"><h2><span class="n">3</span>What happened</h2><p>${text}</p></section>`;
const happened = html => `<section class="step" id="happened"><h2><span class="n">3</span>What happened</h2>${html}</section>`;
const whyBox = html => section(4, 'Why it matters', html);

// "Show the code" panel: real source from the .cs files, loaded when first opened
function codePanel(names, label = 'Show the code') {
  const id = 'code' + Math.random().toString(36).slice(2, 8);
  setTimeout(() => {
    const d = document.getElementById(id);
    if (!d) return;
    d.addEventListener('toggle', async function load() {
      if (!d.open) return;
      d.removeEventListener('toggle', load);
      const data = await api('/api/snippets?names=' + names.map(n => n.name).join(','));
      const host = $('.codehost', d);
      host.innerHTML = `<div class="tabs" role="tablist">${names.map((n, i) =>
        `<button role="tab" aria-selected="${i === 0}" data-i="${i}">${esc(n.label)}</button>`).join('')}</div><pre class="code"></pre>`;
      const pre = $('pre', host);
      const show = i => {
        pre.innerHTML = highlight(data[names[i].name]);
        host.querySelectorAll('[role=tab]').forEach(b => b.setAttribute('aria-selected', String(+b.dataset.i === i)));
      };
      host.querySelectorAll('[role=tab]').forEach(b => b.onclick = () => show(+b.dataset.i));
      show(0);
    });
  }, 0);
  return `<section class="step"><details id="${id}" style="margin:0"><summary>${esc(label)}</summary><div class="codehost muted small">Loading…</div></details></section>`;
}

// numbered flow of plain-English steps. A leading ✗ / ✓ colours the step.
function flow(items) {
  return `<ol class="flow">${items.map((it, i) => {
    const text = typeof it === 'string' ? it : it.text;
    const cls = text.startsWith('✗') ? 'fail' : text.startsWith('✓') ? 'good' : '';
    const who = typeof it === 'string' || !it.who ? '' : `<span class="who">${it.who}</span>`;
    return `<li data-n="${i + 1}" class="${cls}">${text}${who}</li>`;
  }).join('')}</ol>`;
}

// ---- dependency tree (optionally annotated with the instance each box really received) ----
const nodeKey = n => `${n.service}>${n.implementation}`;

function flattenInstances(node, map = new Map()) {
  if (node.instanceId) map.set(nodeKey(node), node.instanceId);
  node.needs?.forEach(c => flattenInstances(c, map));
  return map;
}

function treeNode(n, prev) {
  const impl = n.implementation && n.implementation !== n.service ? ` <span class="arrow">→</span> <b>${esc(n.implementation)}</b>` : '';
  const life = n.lifetime && n.lifetime !== '-' ? ` ${badge(n.lifetime)}` : '';
  let inst = '';
  if (n.instanceId) {
    inst = ' ' + chip(n.instanceId);
    if (prev) {
      const p = prev.get(nodeKey(n));
      if (p !== undefined) inst += p === n.instanceId ? ' <span class="tag same">= same as last order</span>' : ' <span class="tag new">new</span>';
    }
  }
  const note = n.note ? `<div class="note">${esc(n.note)}</div>` : '';
  const kids = n.needs?.length ? `<ul>${n.needs.map(c => treeNode(c, prev)).join('')}</ul>` : '';
  return `<li class="${n.cycle ? 'cycle' : ''}"><span class="svc">${esc(n.service)}</span>${impl}${life}${inst}${note}${kids}</li>`;
}
const tree = (node, prev) => `<ul class="tree root">${treeNode(node, prev)}</ul>`;

function hasCycle(n) { return n.cycle || (n.needs || []).some(hasCycle); }

// objects in creation order (the dependencies first)
function buildOrder(n, seen = new Set(), out = []) {
  (n.needs || []).forEach(c => buildOrder(c, seen, out));
  const name = n.implementation;
  if (name && !/registered|framework|picked|needs itself/.test(name) && !seen.has(name)) { seen.add(name); out.push({ name, lifetime: n.lifetime }); }
  return out;
}

// "RequestContext was handed to 7 places, but it is ONE object"
function sharedSummary(graph) {
  const byId = new Map();
  (function walk(n) {
    if (n.instanceId) {
      const e = byId.get(n.instanceId) ?? { name: n.implementation === 'picked at runtime' ? n.service : n.implementation, lifetime: n.lifetime, count: 0 };
      e.count++; byId.set(n.instanceId, e);
    }
    n.needs?.forEach(walk);
  })(graph);
  const shared = [...byId.entries()].filter(([, e]) => e.count > 1);
  if (!shared.length) return '';
  return `<ul class="shared">${shared.map(([id, e]) =>
    `<li>${chip(id)} <b>${esc(e.name)}</b> ${badge(e.lifetime)} was handed to <b>${e.count} places</b> – but it is <b>one object</b>.</li>`).join('')}</ul>`;
}

const setBusy = (btns, busy) => btns.forEach(b => b.disabled = busy);

// ======================================================================
// navigation
// ======================================================================
const pages = [
  { group: 'Start here', id: 'technique', title: '1 · What is DI?', render: renderTechnique },
  { group: 'Start here', id: 'lifetimes', title: '2 · How long does an object live?', render: renderLifetimes },
  { group: 'Start here', id: 'shop', title: '3 · A bigger flow: place an order', render: renderShop },
  { group: 'When it goes wrong', id: 'circular', title: 'A · Circular dependency', render: v => renderCase(v, 'circular') },
  { group: 'When it goes wrong', id: 'captive', title: 'B · Captive dependency', render: v => renderCase(v, 'captive') },
  { group: 'When it goes wrong', id: 'dbcontext', title: 'C · One DbContext, many tasks', render: v => renderCase(v, 'dbcontext') },
  { group: 'When it goes wrong', id: 'race', title: 'D · Race condition in a singleton', render: v => renderCase(v, 'race') },
  { group: 'When it goes wrong', id: 'worker', title: 'E · Scoped service in a background job', render: v => renderCase(v, 'worker') },
  { group: 'Bonus', id: 'tests', title: 'F · Testing with mocks', render: v => renderMocks(v) },
  { group: 'Bonus', id: 'multi', title: 'G · Many implementations', render: v => renderCase(v, 'multi') }
];

function buildNav() {
  let group = '';
  $('#nav').innerHTML = pages.map(p => {
    const h = p.group !== group ? `<h4>${esc(p.group)}</h4>` : '';
    group = p.group;
    return `${h}<button data-id="${p.id}">${esc(p.title)}</button>`;
  }).join('');
  $('#nav').querySelectorAll('button').forEach(b => b.onclick = () => { location.hash = b.dataset.id; });
}

function route() {
  const page = pages.find(p => p.id === location.hash.slice(1)) ?? pages[0];
  clearInterval(state.timer);
  state.timer = null;
  document.querySelectorAll('#nav button').forEach(b => {
    if (b.dataset.id === page.id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const view = $('#view');
  view.innerHTML = '<p class="muted">Loading…</p>';
  try { window.scrollTo(0, 0); } catch { /* not available in test browsers */ }
  Promise.resolve(page.render(view)).catch(e => { view.innerHTML = `<div class="step err-text">${esc(e.message)}</div>`; });
}

// ======================================================================
// 1 · What is DI?   (example: switching the payment provider)
// ======================================================================
const PROVIDERS = {
  stripe: { name: 'Stripe', cls: 'StripeGateway', fee: a => a * 0.029 + 0.30 },
  paypal: { name: 'PayPal', cls: 'PayPalGateway', fee: a => a * 0.0349 + 0.49 },
  offline: { name: 'Offline', cls: 'OfflineGateway' }
};

const VERSIONS = {
  a: {
    ver: 'v1', name: 'A · It builds its own tools', verdict: ['badx', '✗ Hard to change'],
    blurb: 'The checkout creates its payment and e-mail helpers itself, using <code>new</code>.',
    cost: ['Open <b>CoupledCheckout</b> and edit it. Every other class that does the same needs the same edit.', [
      ['same', '// CoupledCheckout.cs'],
      ['del', '- private readonly StripeClient _gateway = new();'],
      ['add', '+ private readonly PayPalClient _gateway = new();']]],
    built: ['The checkout created <b>StripeClient</b> itself (<code>new StripeClient()</code>)', 'The checkout created <b>SmtpMailer</b> itself (<code>new SmtpMailer()</code>)', 'Nobody outside can swap them.'],
    why: 'The class is glued to its helpers. You cannot switch to PayPal without editing it, cannot test without really charging a card, and cannot reuse it elsewhere.'
  },
  b: {
    ver: 'v2', name: 'B · We hand them in by hand', verdict: ['meh', '○ Better, but tedious'],
    blurb: 'The checkout <em>asks</em> for its gateway in its constructor. We create it and pass it in ourselves.',
    cost: ['The checkout class stays untouched, but <b>every place that wires it by hand</b> must be edited.', [
      ['same', '// every place that builds a Checkout'],
      ['del', '- var gateway = new StripeGateway(ctx);'],
      ['add', '+ var gateway = new PayPalGateway(ctx);']]],
    built: ['<code>var ctx = new RequestContext(...)</code>', '<code>var gateway = new StripeGateway(ctx)</code>  ← we choose the provider here', '<code>var notifier = new EmailNotifier(log, ctx)</code>', '<code>var checkout = new Checkout(gateway, notifier, clock, ctx)</code>', 'These lines are written (and kept in sync) by us, in every place that needs a checkout.'],
    why: 'The class is flexible now – the same code works with any gateway. But somebody still has to wire everything by hand and decide how long each object lives.'
  },
  c: {
    ver: 'v3', name: 'C · The container hands them in', verdict: ['good', '✓ Dependency Injection'], tree: true,
    blurb: 'Exactly the same class as B. We register the pieces <b>once</b>, and the container builds the whole chain for us.',
    cost: ['<b>One line</b> in the registrations. The checkout class is not touched – nor is anything else.', [
      ['same', '// Program.cs'],
      ['del', '- services.AddScoped<IPaymentGateway, StripeGateway>();'],
      ['add', '+ services.AddScoped<IPaymentGateway, PayPalGateway>();']]],
    why: 'The class lists what it needs and nothing else. The container reads the constructor, builds every dependency (and theirs) and applies the lifetimes. Switching provider is a one-line change in one place.'
  },
  d: {
    ver: 'v4', name: 'D · It asks the container itself', verdict: ['badx', '✗ Anti-pattern'],
    blurb: 'The class gets the container and pulls things out of it inside its methods (“service locator”).',
    cost: ['One line in the registrations – but the class <b>hides</b> what it needs, so nobody can see what the change affects.', [
      ['same', '// Program.cs'],
      ['del', '- services.AddScoped<IPaymentGateway, StripeGateway>();'],
      ['add', '+ services.AddScoped<IPaymentGateway, PayPalGateway>();']]],
    built: ['The constructor only says <code>IServiceProvider</code> – it does not tell you what the class really needs', 'Inside the method it called <code>GetRequiredService&lt;IPaymentGateway&gt;()</code> and <code>GetRequiredService&lt;INotifier&gt;()</code>', 'A missing registration only fails when that code path runs.'],
    why: 'It works, but the real needs are hidden. A reader (or a test) cannot see them from the constructor, and mistakes only show up when that code path runs.'
  }
};

async function renderTechnique(view) {
  const settings = await api('/api/settings');
  let current = 'c';

  view.innerHTML = `
    <h1>1 · What is Dependency Injection?</h1>
    <p class="lead">A class should not <em>create</em> the things it needs – they should be <em>handed to it</em>. Example: switching the payment provider.</p>
    ${split(
      contextCard('ShopCo’s checkout charges cards through <b>Stripe</b>. It must be able to switch to <b>PayPal</b>, and tests must not charge real cards. The same checkout is written four ways below.',
        'How much work is it to switch the provider in each version?') +
      section(2, 'Try it', `
        <div class="choices" id="choices"></div>
        <p id="blurb"></p>
        <div class="row">
          <label class="field">Payment provider
            <select id="gw"><option value="stripe">Stripe</option><option value="paypal">PayPal</option><option value="offline">Offline (provider down)</option></select>
          </label>
          <button class="btn primary" id="run">Run the checkout</button>
        </div>
        <p class="muted small">Run it with Stripe, then pick PayPal and run again. Which versions follow the change?</p>`),
      waiting() + '<div id="why"></div>'
    )}
    ${codePanel([{ name: 'basics-v1', label: 'A · coupled' }, { name: 'basics-v3', label: 'B / C · injected' }, { name: 'basics-v4', label: 'D · locator' }, { name: 'gateways', label: 'The gateways' }, { name: 'registrations', label: 'Registrations (Program.cs)' }])}
  `;

  $('#gw').value = settings.paymentProvider;
  $('#gw').onchange = () => post('/api/settings', { paymentProvider: $('#gw').value, notifyChannel: settings.notifyChannel });

  const drawChoices = () => {
    $('#choices').innerHTML = Object.entries(VERSIONS).map(([k, v]) =>
      `<button class="choice" data-k="${k}" aria-pressed="${k === current}"><b>${esc(v.name)}</b><span class="verdict ${v.verdict[0]}">${v.verdict[1]}</span></button>`).join('');
    $('#choices').querySelectorAll('button').forEach(b => b.onclick = () => {
      current = b.dataset.k; drawChoices(); $('#happened').outerHTML = waiting(); $('#why').innerHTML = '';
    });
    $('#blurb').innerHTML = VERSIONS[current].blurb;
  };
  drawChoices();

  $('#run').onclick = async () => {
    const btn = $('#run'); setBusy([btn], true);
    const v = VERSIONS[current];
    const run = liveBegin(`Running version ${current.toUpperCase()} of the checkout…`);
    try {
      const provider = $('#gw').value, want = PROVIDERS[provider];
      const [r, g] = await Promise.all([
        api(`/api/basics/run?version=${v.ver}&amount=120`),
        v.tree ? api('/api/graph?service=checkout') : Promise.resolve(null)
      ]);
      const usedStripe = r.steps.some(s => /Stripe/.test(s));
      const usedWanted = r.steps.some(s => s.includes(want.name));
      let banner;
      if (current === 'a' && provider !== 'stripe') banner = ['bug', `⚠ You picked <b>${want.name}</b>, but version A still charged through <b>Stripe</b> – the gateway is hard-coded inside the class.`];
      else if (current === 'a') banner = ['ok', '✓ It works with Stripe – but the provider cannot be changed without editing the class.'];
      else if (provider === 'offline') banner = ['ok', '✓ The checkout followed your change: the provider is down, so the payment was declined. The checkout code did not change.'];
      else if (provider === 'stripe') banner = ['ok', '✓ Charged through <b>Stripe</b>, the original provider. Now pick <b>PayPal</b> and run again – see what changes, and what does not.'];
      else if (usedWanted) banner = ['ok', `✓ The checkout charged through <b>${want.name}</b>. Its code did not change – it just received a different gateway.`];
      else banner = ['bug', `⚠ Expected ${want.name}, but ${usedStripe ? 'Stripe' : 'another provider'} was used.`];

      // ---- live: first the pieces get created, then the checkout runs ----
      if (v.tree) {
        await liveNote(run, 'The container builds <code>Checkout</code> and everything it needs:');
        await liveTree(run, g);
      } else {
        await liveNote(run, 'Who creates the pieces?');
        await liveSteps(run, v.built, 380);
      }
      await liveNote(run, 'Now the checkout runs:');
      for (const s of r.steps) { if (!await liveStep(run, esc(s), { ms: /Charging/.test(s) ? 700 : 450 })) break; }
      if (!run.alive()) return;

      let built;
      if (v.tree) {
        built = `<h3>What the container built for you</h3><p class="muted small">Read from the <code>Checkout</code> constructor – nobody wrote <code>new</code> for any of these:</p>${tree(g)}`;
      } else {
        built = `<h3>Who created the pieces?</h3><ul>${v.built.map(b => `<li>${b}</li>`).join('')}</ul>`;
      }
      const diff = `<div class="diff">${v.cost[1].map(([c, t]) => `<div class="${c}">${esc(t)}</div>`).join('')}</div>`;
      $('#happened').outerHTML = happened(`
        <div class="banner ${banner[0]}">${banner[1]}</div>
        <h3>The checkout, step by step</h3>${flow(r.steps)}
        ${built}
        <h3>What would switching to PayPal cost in this version?</h3>
        <p class="cost">${v.cost[0]}</p>${diff}`);
      $('#why').innerHTML = whyBox(`<p>${v.why}</p>`);
    } catch (e) { $('#happened').outerHTML = happened(`<p class="err-text">${esc(e.message)}</p>`); }
    finally { setBusy([btn], false); }
  };
}

// ======================================================================
// 2 · Lifetimes: a simple flow, the same three helpers injected into three services
// ======================================================================
const HELPERS = [
  { key: 'calculator', life: 'Transient', name: 'PriceCalculator' },
  { key: 'requestLog', life: 'Scoped', name: 'RequestLog' },
  { key: 'counter', life: 'Singleton', name: 'ShopCounter' }
];

// was this helper created for this service, or handed over from somewhere else?
function helperTag(h, s) {
  if (h.life === 'Transient') return ['new', '✨ new – its own'];
  if (h.life === 'Scoped') return s.logReused ? ['shared', '♻ shared in this request'] : ['new', '✨ new for this request'];
  return s.counterReused ? ['shared', '♻ shared by everyone'] : ['new', '✨ new (first use since start-up)'];
}

function flowDiagram(f, compact = false, liveMode = false) {
  return `<div class="fdiagram ${compact ? 'compact' : ''} ${liveMode ? 'live' : ''}">${f.steps.map((s, i) => `${i ? '<div class="farrow">→</div>' : ''}
    <div class="fbox"><h4>${esc(s.service)}</h4>${HELPERS.map(h => {
      const [cls, text] = helperTag(h, s);
      return `<div class="hrow"><span>${badge(h.life)}<small>${h.name}</small></span>${chip(s[h.key])}<em class="rtag ${cls}">${text}</em></div>`;
    }).join('')}</div>`).join('')}</div>`;
}

async function renderLifetimes(view) {
  view.innerHTML = `
    <h1>2 · How long does an object live?</h1>
    <p class="lead">When several classes ask the container for the same service, do they get the <b>same object</b> or a <b>new one</b>? The <em>lifetime</em> you register decides.</p>
    ${split(
      contextCard('A checkout runs three services in order: <b>CartService → PaymentService → ReceiptService</b>. Each one receives the <b>same three helpers</b> in its constructor – but each helper is registered with a different lifetime.',
        'Send a request and look at the chips: the same colour means the same object.') +
      plain('The three helpers', `
        <div class="cards3">
          <div class="mini">${badge('Transient')}<p><b>PriceCalculator</b><br>A new object every time it is asked for.</p></div>
          <div class="mini">${badge('Scoped')}<p><b>RequestLog</b><br>One per request – shared inside it, new in the next.</p></div>
          <div class="mini">${badge('Singleton')}<p><b>ShopCounter</b><br>One for the whole app, shared by every request.</p></div>
        </div>`) +
      section(2, 'Try it', `
        <p>Each click is one customer visit (one HTTP request). Send <b>two or more</b> to compare.</p>
        <div class="row">
          <button class="btn primary" id="one">Send a request</button>
          <button class="btn" id="scopes">Go deeper: two extra scopes in one request</button>
        </div>`),
      waiting('Send a request – you will see the three services and the three helpers each of them received.') + '<div id="why"></div>'
    )}
    ${codePanel([{ name: 'lifetimes-flow', label: 'The three services' }, { name: 'lifetimes-helpers', label: 'The three helpers' }, { name: 'lifetimes-scopes', label: 'Manual scopes' }, { name: 'registrations', label: 'Registrations (Program.cs)' }])}
  `;

  const show = () => {
    const cur = state.probeRuns[0], prev = state.probeRuns[1];
    const n = state.probeRuns.length;
    const calcChips = cur.steps.map(s => chip(s.calculator)).join(' ');
    const logLines = cur.log.map(l => `<li><b>${esc(l.service)}</b> ${esc(l.what)}</li>`).join('');

    let between = '';
    if (prev) {
      const anyShared = cur.steps.some(s => prev.steps.some(p => p.calculator === s.calculator));
      between = `
        <h3>Compared with the previous request (#${n - 1})</h3>
        ${flowDiagram(prev, true)}
        <div class="read">
          <div>${badge('Transient')} ${anyShared ? 'some reused' : '<b>all new</b>'} – every request builds fresh calculators.</div>
          <div>${badge('Scoped')} <b>a new RequestLog</b> ${chip(prev.requestLogId)} → ${chip(cur.requestLogId)} – each request starts with an empty log.</div>
          <div>${badge('Singleton')} <b>the same ShopCounter</b> ${chip(cur.counterId)} – it went from ${prev.ordersSoFar} to ${cur.ordersSoFar} orders.</div>
        </div>`;
    }

    $('#happened').outerHTML = happened(`
      <p>Request #${n}: each service received the three helpers.</p>
      ${flowDiagram(cur)}
      <h3>Reading it</h3>
      <div class="read">
        <div>${badge('Transient')} <b>${plural(new Set(cur.steps.map(s => s.calculator)).size, 'PriceCalculator', 'different PriceCalculators')}</b> – each service got its <b>own</b> ${calcChips}<br>
          <span class="muted small">Each one was used once (calls = ${cur.steps.map(s => s.calculatorCalls).join(', ')}). Nobody shares it.</span></div>
        <div>${badge('Scoped')} <b>1 RequestLog</b> ${chip(cur.requestLogId)} <b>shared by all three</b> – so it collected all three lines:
          <ul>${logLines}</ul></div>
        <div>${badge('Singleton')} <b>1 ShopCounter</b> ${chip(cur.counterId)} shared by everyone, in every request – it now says <b>${cur.ordersSoFar}</b> order${cur.ordersSoFar === 1 ? '' : 's'} since the app started.</div>
      </div>
      ${between}`);
    $('#why').innerHTML = whyBox(`
      <p>The lifetime decides <b>who shares state</b>. A request log must be per customer, so it is Scoped. A sales counter must be shared by all customers, so it is a Singleton (and must be thread-safe). A calculator holds no state worth sharing, so it is Transient.</p>
      <p class="muted small">Golden rule: a service may only depend on services that live <b>at least as long</b> as itself (a Singleton must not hold a Scoped one – see case B).</p>`);
  };

  const buttons = ['one', 'scopes'].map(id => $('#' + id));
  $('#one').onclick = async () => {
    setBusy(buttons, true);
    const run = liveBegin('One customer visit = one HTTP request');
    try {
      const f = await api('/api/lifetimes/flow');
      state.probeRuns.unshift(f);
      state.probeRuns.length = Math.min(state.probeRuns.length, 20);
      const n = state.probeRuns.length;

      liveHtml(run, `<p class="livenote" id="livecaption">① Request #${n} arrives. ASP.NET Core opens a <b>new scope</b> for it.</p>
        ${flowDiagram(f, false, true)}<ul class="loglines" id="livelog"></ul><div class="counterbox" id="livecounter"></div>`);
      await wait(600);

      const boxes = [...stage().querySelectorAll('.fbox')];
      const caption = t => { const c = $('#livecaption'); if (c && run.alive()) c.innerHTML = t; };
      for (let i = 0; i < boxes.length; i++) {
        if (!run.alive()) return;
        boxes.forEach(b => b.classList.remove('active'));
        boxes[i].classList.add('active');
        const step = f.steps[i];
        caption(`② The container creates <b>${esc(step.service)}</b> – and hands it three helpers:`);
        for (const row of boxes[i].querySelectorAll('.hrow')) {
          if (!run.alive()) return;
          row.classList.add('shown');
          await wait(450);
        }
        caption(`③ <b>${esc(step.service)}</b> runs and writes to the request log.`);
        $('#livelog')?.insertAdjacentHTML('beforeend', `<li>📝 <b>${esc(step.service)}</b> ${esc(step.what)}</li>`);
        if (i === boxes.length - 1) {
          $('#livecounter').innerHTML = `🧮 The shop-wide <b>ShopCounter</b> goes from ${f.ordersSoFar - 1} to <b>${f.ordersSoFar}</b> orders.`;
        }
        await wait(350);
        liveProgress(run, (i + 1) / boxes.length);
      }
      if (!run.alive()) return;
      show();
    } finally { setBusy(buttons, false); }
  };

  $('#scopes').onclick = async () => {
    setBusy(buttons, true);
    try {
      const r = await api('/api/lifetimes/scopes');
      const row = (label, f, k) => `<tr data-r="${k}"><td>${label}</td><td>${chip(f.requestLogId)}</td>
        <td><span class="chips">${f.steps.map(s => chip(s.calculator)).join('')}</span></td><td>${chip(f.counterId)} <span class="muted small">(${f.ordersSoFar} orders)</span></td></tr>`;
      $('#happened').outerHTML = happened(`
        <p>One HTTP request, but <b>three different scopes</b>: the request’s own, plus two that the code created itself with <code>IServiceScopeFactory</code>. Each scope ran the same three-service flow.</p>
        <table><thead><tr><th>Scope</th><th>${badge('Scoped')} RequestLog</th><th>${badge('Transient')} 3 calculators</th><th>${badge('Singleton')} ShopCounter</th></tr></thead>
          <tbody>${row('The request’s scope', r.request, 0)}${row('Scope 1 (made by code)', r.scope1, 1)}${row('Scope 2 (made by code)', r.scope2, 2)}</tbody></table>
        <p class="explain">Three scopes → <b>three different RequestLogs</b>. The ShopCounter is the same everywhere. “Scoped” does not literally mean “per HTTP request” – it means <b>per scope</b>. ASP.NET Core simply opens one scope for every request. Background jobs have no request, so they must create their own (see case E).</p>`);
      $('#why').innerHTML = '';
      await revealSequence(newRun(), 700);
    } finally { setBusy(buttons, false); }
  };
}

// ======================================================================
// 3 · A bigger flow: place an order
// ======================================================================
async function renderShop(view) {
  const [products, settings] = await Promise.all([api('/api/products'), api('/api/settings')]);
  if (!state.cart) state.cart = Object.fromEntries(products.slice(0, 2).map(p => [p.id, 1]));
  const WAIT = 'Place an order on the left – you will see each step, and the dependency tree with the objects that were actually used.';

  view.innerHTML = `
    <h1>3 · A bigger flow: place an order</h1>
    <p class="lead">The same idea as page 2, with a real database, more services and a background job.</p>
    ${split(
      contextCard('A shop checkout with SQL Server. <code>OrderService</code> needs <b>nine collaborators</b> (stock, pricing, payment, database, audit, e-mail …), and some of them need others. The container builds the whole tree; nobody writes <code>new</code>.',
        'Place two orders and compare: which objects stay the same, and which are new every time?') +
      section(2, 'Try it', `
        <h3>Choose what to buy</h3>
        <table id="products"></table>
        <h3>Swap a part <span class="muted small">– change the setup, not the code</span></h3>
        <div class="row">
          <label class="field">Who is ordering?
            <select id="user"><option value="alice">alice</option><option value="bob">bob</option><option value="vip">vip (gets 5% off)</option></select></label>
          <label class="field">Payment provider
            <select id="gateway"><option value="stripe">Stripe</option><option value="paypal">PayPal</option><option value="offline">Offline (down)</option></select></label>
          <label class="field">Confirmation by
            <select id="channel"><option value="email">E-mail</option><option value="sms">SMS</option><option value="push">Push</option><option value="all">All three</option></select></label>
        </div>
        <div class="row">
          <button class="btn primary" id="place">Place order</button>
          <button class="btn" id="reset">Reset demo</button>
        </div>
        <p class="muted small">Reset restores the stock and clears all orders.</p>`),
      waiting(WAIT) + '<div id="why"></div>' +
      `<section class="step"><details style="margin:0"><summary>Behind the scenes: database orders and background worker</summary>
        <h3>Orders in SQL Server</h3><div id="orders" class="small"></div>
        <h3>Messages sent</h3><div id="feed" class="feed"></div>
      </details></section>`
    )}
    ${codePanel([{ name: 'order-service', label: 'OrderService' }, { name: 'registrations', label: 'Registrations (Program.cs)' }, { name: 'request-context', label: 'RequestContext' }, { name: 'gateways', label: 'The gateways' }, { name: 'pricing', label: 'PricingService' }])}
  `;

  $('#user').value = state.user;
  $('#gateway').value = settings.paymentProvider;
  $('#channel').value = settings.notifyChannel;

  let products_ = products;
  const drawProducts = () => {
    $('#products').innerHTML = `<thead><tr><th>Product</th><th class="num">Price</th><th class="num">In stock</th><th class="num">How many</th></tr></thead><tbody>${
      products_.map(p => `<tr><td>${esc(p.name)}</td><td class="num">${money(p.price)}</td><td class="num">${p.stock}</td>
        <td class="num"><span class="qty"><button data-id="${p.id}" data-d="-1" aria-label="Fewer ${esc(p.name)}">−</button><span>${state.cart[p.id] ?? 0}</span><button data-id="${p.id}" data-d="1" aria-label="More ${esc(p.name)}">+</button></span></td></tr>`).join('')}</tbody>`;
    $('#products').querySelectorAll('.qty button').forEach(b => b.onclick = () => {
      const id = b.dataset.id;
      state.cart[id] = Math.max(0, Math.min(99, (state.cart[id] ?? 0) + +b.dataset.d));
      drawProducts();
    });
  };
  drawProducts();

  const pushSettings = () => post('/api/settings', { paymentProvider: $('#gateway').value, notifyChannel: $('#channel').value });
  $('#gateway').onchange = pushSettings;
  $('#channel').onchange = pushSettings;
  $('#user').onchange = () => { state.user = $('#user').value; };

  const lifeIn = (g, svc) => {
    let found = null;
    (function walk(n) { if (found) return; if (n.implementation === svc) found = n.lifetime; (n.needs || []).forEach(walk); })(g);
    return found;
  };

  const placeOne = async () => {
    const items = Object.entries(state.cart).filter(([, q]) => q > 0).map(([id, q]) => ({ productId: +id, quantity: q }));
    const run = liveBegin('A customer clicks “Place order”');

    // the order is processed on the server RIGHT NOW; its steps stream back as they complete
    const ch = new Chan();
    streamNdjson('/api/orders/stream', ev => ch.push(ev), { method: 'POST', body: JSON.stringify({ items }) })
      .catch(e => ch.push({ type: 'error', message: e.message })).finally(() => ch.close());

    const g0 = await api('/api/graph?service=order');
    await liveNote(run, '① The request arrives. The container builds <code>OrderService</code> and everything it needs:');
    await liveTree(run, g0);
    await liveNote(run, '② <code>OrderService</code> runs – each step appears the moment the server finishes it:');

    let result = null, error = null;
    for (;;) {
      const stopWaiting = ch.q.length === 0 && !ch.closed ? livePending(run, 'working…') : () => {};
      const { value: ev, done } = await ch.next();
      stopWaiting();
      if (done) break;
      if (ev.type === 'step') {
        const lt = lifeIn(g0, ev.step.service);
        await liveStep(run, `${ev.step.ok ? '' : '✗ '}${esc(ev.step.text)}<span class="who">done by <b>${esc(ev.step.service)}</b> ${lt ? badge(lt) : ''}</span>`, { ms: 380 });
      } else if (ev.type === 'result') result = ev;
      else if (ev.type === 'error') error = ev.message;
    }
    if (!run.alive()) return null;
    if (error || !result) throw new Error(error || 'No result received from the server.');
    const { order: r, graph } = result;
    const lifeOf = svc => r.trace.find(t => t.service === svc)?.lifetime;
    const steps = r.steps.map(s => ({
      text: (s.ok ? '' : '✗ ') + esc(s.text),
      who: `done by <b>${esc(s.service)}</b> ${lifeOf(s.service) ? badge(lifeOf(s.service)) : ''}`
    }));
    const pr = r.pricing;
    const prev = state.lastGraph ? flattenInstances(state.lastGraph) : null;
    const shared = sharedSummary(graph);
    $('#happened').outerHTML = happened(`
      <div class="banner ${r.success ? 'ok' : 'error'}">${r.success ? '✓' : '✗'} ${esc(r.message)}${r.success && pr ? ` Total ${money(pr.total)}` : ''}</div>
      <h3>Step by step – and which service did each step</h3>${flow(steps)}
      ${pr ? `<div class="price"><span>Subtotal ${money(pr.subtotal)}</span><span>Discount −${money(pr.discount)}</span><span>Tax ${money(pr.tax)}</span><b>Total ${money(pr.total)}</b></div>
        ${pr.appliedRules?.length ? `<p class="muted small">${esc(pr.appliedRules.join(' · '))}</p>` : ''}` : ''}
      <h3>The objects this order used</h3>
      <p class="muted small">The tree the container built for <code>OrderService</code>. Each chip is the object that service really received – <b>hover a chip</b> to light up every place that got the same one.${prev ? '' : ' Place another order to compare.'}</p>
      ${tree(graph, prev)}
      ${shared ? `<h3>Shared inside this order</h3>${shared}` : ''}`);
    $('#why').innerHTML = whyBox(`
      <ul>
        <li><b>Scoped</b> objects (the request context, the DbContext) are the <em>same chip everywhere</em> in one order, and <em>new</em> in the next one – two orders never share state.</li>
        <li><b>Singleton</b> objects (the clock, the metrics) keep the same chip in every order.</li>
        <li><b>Transient</b> objects (pricing, discount rules, notifiers) are fresh each time.</li>
        <li>Change a dropdown: the container hands a <em>different class</em> to <code>OrderService</code>. Its code is untouched.</li>
      </ul>`);
    state.lastGraph = graph;
    return r;
  };

  const refresh = async () => {
    try {
      const [orders, feed, fresh] = await Promise.all([api('/api/orders'), api('/api/notifications'), api('/api/products')]);
      products_ = fresh;
      if (!$('#products')) return;
      drawProducts();
      $('#orders').innerHTML = orders.length ? `<table><thead><tr><th>#</th><th>Customer</th><th class="num">Total</th><th>Receipt by background worker</th></tr></thead><tbody>${
        orders.map(o => `<tr><td>${o.id}</td><td>${esc(o.customer)}</td><td class="num">${money(o.total)}</td>
          <td>${o.confirmationSentAt ? '✓ ' + time(o.confirmationSentAt) : '<span class="muted">waiting for the worker…</span>'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No orders yet.</p>';
      $('#feed').innerHTML = feed.length ? feed.map(n =>
        `<div><span class="muted">${time(n.at)}</span> <span class="badge t-${n.channel === 'worker' ? 'Singleton' : 'Scoped'}">${esc(n.channel)}</span> ${esc(n.to)}: ${esc(n.message)}</div>`).join('')
        : '<span class="muted">Nothing sent yet.</span>';
    } catch { /* app may be restarting */ }
  };

  const buttons = ['place', 'reset'].map(id => $('#' + id));
  $('#place').onclick = async () => {
    setBusy(buttons, true);
    try { await placeOne(); } catch (e) { $('#happened').outerHTML = happened(`<p class="err-text">${esc(e.message)}</p>`); }
    setBusy(buttons, false);
    refresh();
  };
  $('#reset').onclick = async () => {
    setBusy(buttons, true);
    try {
      await post('/api/reset');
      state.lastGraph = null; state.user = 'alice';
      const s = await api('/api/settings');
      $('#user').value = 'alice'; $('#gateway').value = s.paymentProvider; $('#channel').value = s.notifyChannel;
      products_ = await api('/api/products');
      state.cart = Object.fromEntries(products_.slice(0, 2).map(p => [p.id, 1]));
      drawProducts();
      $('#happened').outerHTML = waiting(WAIT);
      $('#why').innerHTML = '';
      toast('Demo reset: stock restored, orders cleared.');
    } catch (e) { toast('Reset failed: ' + e.message); }
    setBusy(buttons, false);
    refresh();
  };

  refresh();
  state.timer = setInterval(refresh, 3000);
}

