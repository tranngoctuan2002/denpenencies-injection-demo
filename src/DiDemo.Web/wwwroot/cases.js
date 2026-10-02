'use strict';

// ======================================================================
// Case studies A–G: each one is a small lab. The viewer MAKES the mistake
// (changes a registration, turns the concurrency up, logs users in, …)
// and then sees what the container / runtime does with it.
// Loaded after app.js, which provides the helpers ($, esc, api, chip, badge, tree, flow, …).
// ======================================================================

const STATUS_BANNER = {
  ok: ['ok', '✓ It works'],
  bug: ['bug', '⚠ Wrong result – and no error was shown!'],
  error: ['error', '✗ The program threw an error']
};

const bannerFor = status => { const [cls, label] = STATUS_BANNER[status] ?? STATUS_BANNER.error; return `<div class="banner ${cls}">${label}</div>`; };
const labId = () => 'lab' + Math.random().toString(36).slice(2, 10);

// ---- form helpers ----
function radios(id, options, selected) {
  return `<div class="radios" id="${id}">${options.map(o =>
    `<label class="rad"><input type="radio" name="${id}" value="${esc(o.value)}" ${o.value === selected ? 'checked' : ''}>
      <span><b>${o.label}</b>${o.hint ? `<small>${o.hint}</small>` : ''}</span></label>`).join('')}</div>`;
}
const getRadio = id => $(`input[name="${id}"]:checked`)?.value;
const onChange = (id, fn) => document.querySelectorAll(`input[name="${id}"]`).forEach(i => { i.onchange = fn; });
const codePreview = id => `<pre class="json codeprev" id="${id}"></pre>`;

function casePage(view, c) {
  view.innerHTML = `
    <h1>${esc(c.title)}</h1>
    <p class="lead">${esc(c.idea)}</p>
    ${split(
      contextCard(c.context, c.look) + section(2, 'Try it', c.left),
      waiting(c.waiting) + '<div id="why"></div>'
    )}
    ${codePanel(c.snippets)}`;
}

const showWhy = html => { $('#why').innerHTML = whyBox(`<p>${html}</p>`); };

function renderCase(view, id) {
  const pages = { circular: renderCircular, captive: renderCaptive, dbcontext: renderDb, race: renderRace, worker: renderWorker, multi: renderMulti };
  return pages[id](view);
}

// ======================================================================
// A · Circular dependency: you choose what InventoryService asks for
// ======================================================================
function circularView(graph) {
  const cyc = hasCycle(graph);
  const order = cyc ? [] : buildOrder(graph);
  return `<h3>What the container tries to build</h3>${tree(graph)}
    ${cyc
      ? '<p class="explain">The red box needs something that is still waiting to be built – so there is <b>no valid first step</b>. Nothing gets created.</p>'
      : `<h3>The order it creates the objects in</h3>
         <ol>${order.map(o => `<li><b>${esc(o.name)}</b> ${badge(o.lifetime)}</li>`).join('')}</ol>
         <p class="muted small">Dependencies first, then the classes that need them – possible because the arrows never loop back.</p>`}`;
}

async function renderCircular(view) {
  casePage(view, {
    title: 'A · Circular dependency',
    idea: 'Two classes that each need the other cannot be built.',
    context: 'Product asks: “<code>InventoryService</code> must know how many orders are pending.” <code>OrderService</code> already needs <code>InventoryService</code> (to check stock). <b>You</b> decide what <code>InventoryService</code>’s constructor asks for.',
    look: 'Pick the first option and watch the tree on the right – then start the app.',
    waiting: 'Choose what InventoryService asks for.',
    left: `
      <h3>Change the code</h3>
      <p>What does <code>InventoryService</code> ask for in its constructor?</p>
      ${radios('inv', [
        { value: 'orders', label: '<code>ICircularOrders orders</code>', hint: 'the OrderService – it already knows about orders' },
        { value: 'query', label: '<code>IPendingOrderQuery pending</code>', hint: 'a small class whose only job is counting pending orders' }
      ], 'query')}
      ${codePreview('prev')}
      <div class="row"><button class="btn primary" id="start">Start the app</button></div>`,
    snippets: [{ name: 'circular-broken', label: 'Option 1 (loop)' }, { name: 'circular-fixed', label: 'Option 2 (small class)' }, { name: 'circular-run', label: 'How it is registered' }]
  });

  const ctor = v => v === 'orders'
    ? 'public class InventoryService(ICircularOrders orders) : ICircularInventory\n//                               ^ needs OrderService, which needs us'
    : 'public class InventoryService(IPendingOrderQuery pending) : ICircularInventory';

  const preview = async () => {
    newRun();                                  // changing the code cancels any animation that is still playing
    const inv = getRadio('inv');
    $('#prev').textContent = ctor(inv);
    const r = await api(`/api/cases/circular?inventory=${inv}&preview=true`);
    $('#happened').outerHTML = happened(`
      <p class="muted">Preview – the app has not started yet. This is the tree the container <b>would</b> build:</p>
      ${tree(r.data)}
      ${hasCycle(r.data) ? '<p class="explain">⚠ Look at the red box – this is going to be a problem. Start the app to see what happens.</p>' : '<p class="explain">The arrows only point one way. Start the app.</p>'}`);
    $('#why').innerHTML = '';
  };
  onChange('inv', preview);

  $('#start').onclick = async () => {
    const btn = $('#start'); setBusy([btn], true);
    try {
      const inv = getRadio('inv');
      const run = liveBegin('Starting the app…');
      const r = await api(`/api/cases/circular?inventory=${inv}`);
      const bad = inv === 'orders';
      await liveNote(run, 'The app starts and the container is asked for <b>OrderService</b>. Watch how it works through the constructors:');
      const { stuck } = await liveTree(run, r.data);
      if (!run.alive()) return;
      await liveNote(run, stuck ? '✗ The container gave up: it cannot build something that is waiting for itself.' : '✓ Everything was built – dependencies first.');
      await wait(450);
      if (!run.alive()) return;
      $('#happened').outerHTML = happened(`
        ${bannerFor(r.status)}
        <h3>Step by step</h3>${flow(bad
          ? ['The app starts and the container is asked for <b>OrderService</b>', 'It needs an <b>InventoryService</b> – so the container tries to build that first', 'InventoryService needs an <b>OrderService</b>…', '✗ …which needs InventoryService again. A loop – the container stops with an error.']
          : ['The app starts and the container is asked for <b>OrderService</b>', 'It needs an <b>InventoryService</b>, which only needs a <b>PendingOrderQuery</b>', '✓ The arrows point one way – everything gets built, bottom-up.'])}
        <p class="explain">${bad
          ? 'Neither class can be created first. The container notices the loop and refuses (otherwise it would build for ever). The red box is the moment it spotted the loop.'
          : 'The thing both classes really wanted (“how many orders are pending?”) lives in its own small class, so dependencies no longer go in a circle.'}</p>
        ${circularView(r.data)}
        <details><summary>Technical details (exact message)</summary><pre class="json">${esc(r.message)}</pre></details>`);
      showWhy('A circular dependency is a <b>design smell</b>: two classes that know too much about each other. Don’t work around it – pull the shared need out into a third, smaller class.');
    } catch (e) { $('#happened').outerHTML = happened(`<p class="err-text">${esc(e.message)}</p>`); }
    finally { setBusy([btn], false); }
  };

  preview();
}

// ======================================================================
// B · Captive dependency: you choose the lifetime, start the app, log users in
// ======================================================================
// Row-based, so it works for any number of requests: one top card for the cache, one row per request.
const LIFE_MARK = {
  short: '<span class="lifemark short" title="created for this request, gone when it ends">✝ dies with the request</span>',
  long: '<span class="lifemark long" title="created once, never replaced">∞ lives on</span>'
};

function captiveView(rows, lifetime) {
  const good = rows.every(r => r.correct);
  const single = lifetime === 'singleton';
  const caches = new Set(rows.map(r => r.cacheContext)).size;
  const Life = lifetime[0].toUpperCase() + lifetime.slice(1);

  const card = {
    singleton: `Built <b>once</b> at start-up and kept until the app stops. It holds <b>one</b> UserContext ${chip(rows[0].cacheContext)} and never replaces it.`,
    scoped: 'A <b>new</b> CartCache is built for every request, together with that request’s UserContext. It dies when the request ends.',
    transient: 'A <b>new</b> CartCache is built every time one is asked for, using the current request’s UserContext. It never outlives the request.'
  }[lifetime];

  const body = [...rows].map((r, i) => ({ r, n: i + 1 })).reverse().map(({ r, n }) => `
    <div class="rt ${r.correct ? 'good' : 'bad'}">
      <span class="rn">#${n}</span>
      <span>👤 <b>${esc(r.scope)}</b></span>
      <span>${chip(r.scopedContext)}<br>${LIFE_MARK.short}</span>
      <span>${chip(r.cacheContext)}<br>${single ? LIFE_MARK.long : LIFE_MARK.short}</span>
      <span class="screen">Welcome, <b>${esc(r.cacheSees)}</b><br><small>${r.correct ? '✓ correct' : `✗ should be “${esc(r.scope)}”`}</small></span>
    </div>`).join('');

  return `<h3>${good ? 'Each request gets a cache that matches it' : 'One cache object serves every request'}</h3>
    <div class="stats">
      <div class="stat"><b>${rows.length}</b>request${rows.length === 1 ? '' : 's'} served</div>
      <div class="stat ${good ? 'good' : 'badx'}"><b>${caches}</b>cache object${caches === 1 ? '' : 's'} used</div>
      <div class="stat ${good ? 'good' : 'badx'}"><b>${rows.filter(r => r.correct).length}/${rows.length}</b>users shown correctly</div>
    </div>
    <div class="cachecard ${lifetime}"><div>${badge(Life)} <b>CartCache</b></div><div>${card}</div></div>
    <div class="reqtable" role="table" aria-label="Requests, newest first">
      <div class="rt head" role="row"><span>Request</span><span>User</span><span>Its own UserContext ${badge('Scoped')}</span><span>CartCache it used ${badge(Life)}</span><span>What the user sees</span></div>
      ${body}
    </div>
    <p class="muted small">Newest request first. Same colour = same object – hover a chip to find every row that used it.</p>`;
}

async function renderCaptive(view) {
  const lab = labId();
  casePage(view, {
    title: 'B · Captive dependency',
    idea: 'A long-lived Singleton that holds a short-lived Scoped object keeps it – and out of date – for ever.',
    context: '<code>CartCache</code> speeds up the site and needs to know who is logged in, so it asks for <code>UserContext</code> – a <b>Scoped</b> object (a new one for every request). <b>You</b> register the cache.',
    look: 'Start the app, then log a few users in. Who does each one see?',
    waiting: 'Change the code, start the app, then log users in.',
    left: `
      <h3>1 · Change the code</h3>
      <p>How is <code>CartCache</code> registered? <span class="muted small">(a cache should be shared by everyone… shouldn’t it?)</span></p>
      ${radios('life', [
        { value: 'singleton', label: '<code>AddSingleton&lt;CartCache&gt;()</code>', hint: 'one for the whole app' },
        { value: 'scoped', label: '<code>AddScoped&lt;CartCache&gt;()</code>', hint: 'one per request' },
        { value: 'transient', label: '<code>AddTransient&lt;CartCache&gt;()</code>', hint: 'a new one every time' }
      ], 'singleton')}
      <label class="check"><input type="checkbox" id="validate"> Check lifetimes at start-up (<code>ValidateScopes</code>) <small>ASP.NET Core turns this on in Development</small></label>
      ${codePreview('prev')}
      <div class="row"><button class="btn primary" id="start">Start the app</button></div>
      <h3>2 · Users log in <span class="muted small">(each click is one request to the running app)</span></h3>
      <div class="row">
        <button class="btn login" data-user="alice">alice logs in</button>
        <button class="btn login" data-user="bob">bob logs in</button>
        <button class="btn login" data-user="carol">carol logs in</button>
      </div>
      <div class="row"><input type="text" id="other" placeholder="another name" maxlength="20"><button class="btn login" id="otherBtn">logs in</button></div>`,
    snippets: [{ name: 'captive-lab', label: 'How the app is built' }, { name: 'captive-broken', label: 'The classes' }, { name: 'captive-fixed', label: 'The fix' }]
  });

  let started = false, rows = [], lifetime = 'singleton';
  const reg = () => `services.AddScoped<IUserContext, UserContext>();\nservices.Add${{ singleton: 'Singleton', scoped: 'Scoped', transient: 'Transient' }[getRadio('life')]}<CartCache>();`;
  const stale = () => {
    newRun(); started = false; rows = [];
    $('#prev').textContent = reg();
    $('#happened').outerHTML = waiting('You changed the code – start the app again, then log users in.');
    $('#why').innerHTML = '';
  };
  onChange('life', stale);
  $('#validate').onchange = stale;
  $('#prev').textContent = reg();

  const FLOWS = {
    singleton: ['The app started and built <b>one</b> CartCache (Singleton)', 'To build it, the container created a <b>UserContext</b> – and the cache <b>keeps that one for ever</b>', 'Each login is a new request with its <b>own</b> UserContext, which dies when the request ends', '✗ The cache never sees them – it still holds the old one.'],
    scoped: ['CartCache is <b>Scoped</b> (same lifetime as UserContext)', 'Each login builds its own CartCache <em>and</em> its own UserContext', '✓ Every user’s cache sees that user – and both die with their request.'],
    transient: ['CartCache is <b>Transient</b>: a new one every time it is asked for', 'Each login gets a fresh CartCache, built with that request’s UserContext', '✓ Correct too – a Transient may use a Scoped service because it never outlives the request.']
  };

  const draw = () => {
    if (!rows.length) {
      $('#happened').outerHTML = happened(`${bannerFor('ok').replace('It works', 'The app started')}
        <p class="explain">No error at all. Now log some users in on the left and watch what the cache does.</p>`);
      return;
    }
    const good = rows.every(r => r.correct);
    $('#happened').outerHTML = happened(`
      ${bannerFor(good ? 'ok' : 'bug')}
      <h3>Step by step</h3>${flow(FLOWS[lifetime])}
      ${lifetime === 'singleton' && !good
        ? '<p class="explain">Read the table: every request has its <b>own</b> UserContext (column 3, it dies with the request ✝), but the cache (column 4) is the <b>same chip in every row</b> – it keeps the one UserContext it grabbed at start-up (∞) and never looks at the new ones. So every user is greeted with that old object’s name. In a real app this object is shared by <b>all users at once</b> – one person’s data can end up on another person’s screen.</p>'
        : ''}
      ${captiveView(rows, lifetime)}`);
    showWhy('Rule: a service may only depend on services that live <b>as long or longer</b>. Singleton → Scoped is the classic mistake, and without validation it fails silently with wrong data. Try again with <b>Scoped</b>, or with <b>ValidateScopes</b> switched on.');
  };

  $('#start').onclick = async () => {
    const btn = $('#start'); setBusy([btn], true);
    try {
      lifetime = getRadio('life');
      const validate = $('#validate').checked;
      const run = liveBegin('Starting the app…');
      const r = await api(`/api/labs/captive/start?lab=${lab}&lifetime=${lifetime}&validate=${validate}`);
      rows = [];
      const Life = lifetime[0].toUpperCase() + lifetime.slice(1);
      await liveSteps(run, [
        `The container reads your registrations: <code>AddScoped&lt;IUserContext&gt;()</code> and <code>Add${Life}&lt;CartCache&gt;()</code>`,
        validate ? '<b>ValidateOnBuild</b> is on: checking that no long-lived service holds a shorter-lived one…' : 'Lifetime checks are <b>off</b> – nothing is verified at start-up.',
        r.status === 'error' ? '✗ A Singleton cannot hold a Scoped service – the container refuses to start.' : '✓ The app is up and running.'
      ], 520);
      if (!run.alive()) return;
      if (r.status === 'error') {
        started = false;
        $('#happened').outerHTML = happened(`
          ${bannerFor('error')}
          <h3>Step by step</h3>${flow(['The app starts and (with <b>ValidateScopes</b> on) checks every registration', 'CartCache is a <b>Singleton</b>, but it needs a <b>Scoped</b> UserContext', '✗ The container refuses to start – you find the mistake on your own machine, not in production.'])}
          <p class="explain">This is the safety net doing its job. Switch it off, or change the lifetime, and start again.</p>
          <details><summary>Technical details (exact message)</summary><pre class="json">${esc(r.message)}</pre></details>`);
        showWhy('ASP.NET Core turns <code>ValidateScopes</code> on in Development, which is why you normally see this error before it reaches production.');
      } else { started = true; draw(); }
    } catch (e) { $('#happened').outerHTML = happened(`<p class="err-text">${esc(e.message)}</p>`); }
    finally { setBusy([btn], false); }
  };

  const login = async name => {
    if (!started) { toast('Start the app first (step 1).'); return; }
    name = (name || '').trim();
    if (!name) { toast('Type a name first.'); return; }
    const run = liveBegin(`${name} logs in – one HTTP request to the running app`);
    const r = await api(`/api/labs/captive/login?lab=${lab}&user=${encodeURIComponent(name)}`);
    if (r.status === 'error') { toast(r.message); return; }
    const row = r.data;
    rows.push(row);
    const cacheStep = {
      singleton: `<b>CartCache</b> ${chip(row.cacheContext)} <b>already exists</b> (Singleton) – the container simply reuses it`,
      scoped: `A new <b>CartCache</b> ${chip(row.cacheContext)} is created for this request (Scoped)`,
      transient: `A new <b>CartCache</b> ${chip(row.cacheContext)} is created because someone asked for one (Transient)`
    }[lifetime];
    await liveSteps(run, [
      `① The request arrives: <b>${esc(name)}</b> logs in`,
      `② The container opens a <b>scope</b> and creates this request’s <b>UserContext</b> ${chip(row.scopedContext)} – its user is set to <b>${esc(name)}</b>`,
      cacheStep,
      row.correct
        ? `✓ The cache reads <b>${esc(row.cacheSees)}</b> – the page says “Welcome, ${esc(row.cacheSees)}”`
        : `✗ The cache holds ${chip(row.cacheContext)}, not this request’s ${chip(row.scopedContext)} – it reads “${esc(row.cacheSees)}”. The page says “Welcome, ${esc(row.cacheSees)}”`,
      lifetime === 'singleton'
        ? `The request ends and its scope is disposed: UserContext ${chip(row.scopedContext)} ✝ dies. The cache lives on ∞`
        : `The request ends and its scope is disposed: UserContext ${chip(row.scopedContext)} ✝ and CartCache ${chip(row.cacheContext)} ✝ both die`
    ], 470);
    if (!run.alive()) return;
    draw();
  };
  document.querySelectorAll('.login[data-user]').forEach(b => b.onclick = () => login(b.dataset.user));
  $('#otherBtn').onclick = () => { login($('#other').value); $('#other').value = ''; };
}

// ======================================================================
// C · DbContext: you choose how to load the prices
// ======================================================================
function dbView(r) {
  const total = Math.max(r.elapsedMs, 1);
  const rows = [...r.tasks].sort((a, b) => a.index - b.index).map(t => {
    const left = (t.startMs / total) * 100, width = Math.max(((t.endMs - t.startMs) / total) * 100, 1.2);
    return `<div class="grow"><span>Task ${t.index + 1}</span>
      <div class="gtrack"><div class="gbar ${t.ok ? 'ok' : 'fail'}" style="left:${left}%;width:${width}%" title="${esc(t.error || 'ok')}"></div></div>
      <span>${t.ok ? '✓' : '✗'} ${t.endMs - t.startMs} ms</span></div>`;
  }).join('');
  return `<div class="stats"><div class="stat good"><b>${r.succeeded}</b>worked</div><div class="stat ${r.failed ? 'badx' : ''}"><b>${r.failed}</b>failed</div><div class="stat"><b>${r.elapsedMs} ms</b>total time</div></div>
    <h3>When each task ran</h3>
    <div class="gantt">${rows}<div class="gaxis"><span>0 ms</span><span>time →</span><span>${r.elapsedMs} ms</span></div></div>
    <div class="glegend">🟩 finished the query · 🟥 crashed with “A second operation was started on this context instance”</div>`;
}

async function renderDb(view) {
  casePage(view, {
    title: 'C · One DbContext, many tasks',
    idea: 'A DbContext can only do one thing at a time.',
    context: 'A product page needs <b>N prices</b> from SQL Server, and each lookup takes about 200 ms. <b>You</b> decide how to load them.',
    look: 'Start with “one after another”. Then try to make it faster.',
    waiting: 'Choose how to load the prices, then load them.',
    left: `
      <h3>Change the code</h3>
      <p>How do you load the prices?</p>
      ${radios('how', [
        { value: 'sequential', label: 'One after another – <code>foreach … await</code>', hint: 'safe, but N × 200 ms' },
        { value: 'shared', label: 'All at once on the request’s DbContext – <code>Task.WhenAll</code>', hint: 'faster?' },
        { value: 'factory', label: 'All at once, one DbContext each – <code>IDbContextFactory</code>', hint: 'a fresh DbContext per task' }
      ], 'sequential')}
      <label class="field">How many prices? <span><input type="range" id="n" min="2" max="20" value="10"> <b id="nv">10</b></span></label>
      ${codePreview('prev')}
      <div class="row"><button class="btn primary" id="run">Load the prices</button></div>`,
    snippets: [{ name: 'dbcontext-sequential', label: 'One after another' }, { name: 'dbcontext-broken', label: 'All at once (shared)' }, { name: 'dbcontext-fixed', label: 'All at once (factory)' }, { name: 'registrations', label: 'Registrations (Program.cs)' }]
  });

  const CODE = {
    sequential: 'foreach (var id in ids)\n    prices.Add(await db.LoadPriceAsync(id));          // one at a time',
    shared: 'await Task.WhenAll(ids.Select(id =>\n    db.LoadPriceAsync(id)));                        // all share ONE db',
    factory: 'await Task.WhenAll(ids.Select(async id =>\n{\n    await using var db = await factory.CreateDbContextAsync();\n    return await db.LoadPriceAsync(id);               // own db per task\n}));'
  };
  const refresh = () => { $('#prev').textContent = CODE[getRadio('how')]; $('#nv').textContent = $('#n').value; };
  onChange('how', refresh); $('#n').oninput = refresh; refresh();

  const FLOW = {
    sequential: n => [`Loads the ${n} prices <b>one at a time</b> on the request’s DbContext`, 'Each query waits for the previous one to finish', `✓ It works – but ${n} × 200 ms adds up. This is why a developer reaches for <code>Task.WhenAll</code>…`],
    shared: () => ['The request has <b>one</b> DbContext (Scoped)', 'All the tasks start at the same moment and all use it', 'A DbContext can only do <b>one thing at a time</b>', '✗ One task wins; the others throw an error straight away.'],
    factory: () => ['Each task asks <b>IDbContextFactory</b> for a fresh DbContext', 'The queries run side by side on separate contexts', '✓ All succeed – and the bars overlap: parallel, as intended.']
  };
  const EXPLAIN = {
    sequential: 'Safe, but the total time grows with every price – look at the staircase in the timeline.',
    shared: 'Scoped means “one per request”, <em>not</em> “safe to use from many threads”. In the timeline, red bars are the tasks that crashed.',
    factory: 'The factory is a Singleton that hands out short-lived DbContexts on demand, so nothing is shared.'
  };

  $('#run').onclick = async () => {
    const btn = $('#run'); setBusy([btn], true);
    try {
      const mode = getRadio('how'), n = +$('#n').value;
      const run = liveBegin(mode === 'sequential' ? `Loading ${n} prices, one after another…` : `Starting ${n} lookups at the same moment…`);
      liveHtml(run, `<div class="stats" id="livestats"></div><div class="gantt" id="livegantt"></div>
        <div class="gaxis"><span>0 ms</span><span>time →</span><span id="liveaxis"></span></div>
        <div class="glegend">🟦 running now · 🟩 finished · 🟥 crashed – drawn from events streamed by the server as they happen</div>`);
      const tasks = new Map();
      let base = null, r = null;
      const drawLive = () => {
        if (!run.alive() || base === null || !$('#livegantt')) return;
        const now = performance.now() - base;
        const list = [...tasks.values()].sort((a, b) => a.i - b.i);
        const total = Math.max(600, ...list.map(t => t.end ?? now));
        $('#livegantt').innerHTML = list.map(t => {
          const end = t.end ?? now, left = (t.start / total) * 100, width = Math.max(((end - t.start) / total) * 100, 1.2);
          const cls = t.ok === null ? 'running' : t.ok ? 'ok' : 'fail';
          return `<div class="grow"><span>Task ${t.i + 1}</span><div class="gtrack"><div class="gbar ${cls}" style="left:${left}%;width:${width}%"></div></div>
            <span>${t.ok === null ? '⏳ ' + Math.round(end - t.start) + ' ms' : (t.ok ? '✓ ' : '✗ ') + (t.end - t.start) + ' ms'}</span></div>`;
        }).join('');
        const running = list.filter(t => t.ok === null).length, okN = list.filter(t => t.ok === true).length, badN = list.filter(t => t.ok === false).length;
        $('#livestats').innerHTML = `<div class="stat"><b>${running}</b>running</div><div class="stat good"><b>${okN}</b>finished</div><div class="stat ${badN ? 'badx' : ''}"><b>${badN}</b>crashed</div><div class="stat"><b>${Math.round(now)} ms</b>elapsed</div>`;
        $('#liveaxis').textContent = Math.round(total) + ' ms';
        liveProgress(run, list.length ? (okN + badN) / n : 0);
      };
      const timer = setInterval(drawLive, 60);
      try {
        await streamNdjson(`/api/cases/dbcontext?mode=${mode}&parallel=${n}&stream=true`, ev => {
          if (ev.type === 'start') { if (base === null) base = performance.now() - ev.startMs; tasks.set(ev.index, { i: ev.index, start: ev.startMs, end: null, ok: null }); }
          else if (ev.type === 'end') { const t = tasks.get(ev.index); if (t) { t.end = ev.endMs; t.ok = ev.ok; } }
          else if (ev.type === 'done') r = ev.summary;
        });
      } finally { clearInterval(timer); }
      drawLive();
      if (!run.alive()) return;
      if (!r) throw new Error('No result received from the server.');
      await wait(600);
      if (!run.alive()) return;
      const status = r.failed > 0 ? 'error' : 'ok';
      $('#happened').outerHTML = happened(`
        ${bannerFor(status)}
        <h3>Step by step</h3>${flow(FLOW[mode](n))}
        <p class="explain">${EXPLAIN[mode]}</p>
        ${dbView(r)}
        ${r.distinctErrors.length ? `<details><summary>Technical details (exact message)</summary><pre class="json">${esc(r.distinctErrors.join('\n\n'))}</pre></details>` : ''}`);
      showWhy('Never share a DbContext between threads. For parallel work, use <code>IDbContextFactory&lt;T&gt;</code> (or a new scope per task).');
    } catch (e) { $('#happened').outerHTML = happened(`<p class="err-text">${esc(e.message)}</p>`); }
    finally { setBusy([btn], false); }
  };
}

// ======================================================================
// D · Race condition: you choose the update style and how many requests at once
// ======================================================================
const RACE_STYLE = { unsafe: '<code>count++</code>', interlocked: '<code>Interlocked</code>', lock: '<code>lock</code>' };

function raceView(d, runs) {
  const pct = d.expectedOrders ? (d.actualOrders / d.expectedOrders) * 100 : 100;
  return `<h3>This run</h3>
    <div class="rbar"><span class="got" style="width:${pct}%">counted ${d.actualOrders.toLocaleString()}</span>${d.lost ? `<span class="lost" style="width:${100 - pct}%">lost ${d.lost.toLocaleString()}</span>` : ''}</div>
    <table><thead><tr><th></th><th class="num">Should be</th><th class="num">Actually counted</th></tr></thead><tbody>
      <tr><td>Orders</td><td class="num">${d.expectedOrders.toLocaleString()}</td><td class="num"><b>${d.actualOrders.toLocaleString()}</b></td></tr>
      <tr><td>Revenue</td><td class="num">${d.expectedRevenue.toLocaleString()}</td><td class="num"><b>${Number(d.actualRevenue).toLocaleString()}</b></td></tr></tbody></table>
    ${runs.length > 1 ? `<h3>All runs so far</h3><div class="runs">${runs.map((h, i) => {
      const p = (h.actualOrders / h.expectedOrders) * 100;
      return `<div class="run"><span>Run ${i + 1}</span>
        <div><div class="rbar" style="margin:0;height:16px"><span class="got" style="width:${p}%;padding:0"></span>${h.lost ? `<span class="lost" style="width:${100 - p}%;padding:0"></span>` : ''}</div>
          <small class="muted">${h.workers} request${h.workers === 1 ? '' : 's'} at once · ${RACE_STYLE[h.mode]}</small></div>
        <span>${h.lost ? '−' + h.lost.toLocaleString() : '0 lost ✓'}</span></div>`;
    }).join('')}</div><p class="muted small">Try the same settings twice: the bug loses a <b>different</b> amount every time.</p>` : ''}`;
}

async function renderRace(view) {
  const runs = [];
  casePage(view, {
    title: 'D · Race condition in a singleton',
    idea: 'A Singleton is shared by every request at the same time.',
    context: '<code>OrderMetrics</code> is a <b>Singleton</b> counting orders for the dashboard. Each “request” adds 50,000 orders. <b>You</b> choose how the counter is updated and how many requests hit it at the same moment.',
    look: 'Start with 1 request – then turn it up.',
    waiting: 'Choose the update style and the number of requests, then run it.',
    left: `
      <h3>Change the code</h3>
      <p>How does <code>OrderMetrics</code> update its counter?</p>
      ${radios('style', [
        { value: 'unsafe', label: '<code>_count++;  _revenue += total;</code>', hint: 'plain and simple' },
        { value: 'interlocked', label: '<code>Interlocked.Increment(ref _count)</code>', hint: 'one indivisible step' },
        { value: 'lock', label: '<code>lock (_gate) { _count++; … }</code>', hint: 'one thread at a time' }
      ], 'unsafe')}
      <label class="field">How many requests at the same moment? <span><input type="range" id="w" min="1" max="16" value="1"> <b id="wv">1</b></span></label>
      <div class="row"><button class="btn primary" id="run">Run it</button></div>`,
    snippets: [{ name: 'race-broken', label: 'count++' }, { name: 'metrics-safe', label: 'Interlocked' }, { name: 'race-lock', label: 'lock' }, { name: 'race-run', label: 'The test' }]
  });

  $('#w').oninput = () => { $('#wv').textContent = $('#w').value; };

  $('#run').onclick = async () => {
    const btn = $('#run'); setBusy([btn], true);
    try {
      const mode = getRadio('style'), w = +$('#w').value;
      const run = liveBegin(`${w} request${w === 1 ? '' : 's'} hit the shared OrderMetrics at the same moment…`);
      liveHtml(run, `<div class="livemeter">
          <div class="row2"><span>Calls made</span><div class="meter"><i class="made" id="mMade"></i></div><b id="nMade">0</b></div>
          <div class="row2"><span>Counted by OrderMetrics</span><div class="meter"><i class="counted" id="mCnt"></i></div><b id="nCnt">0</b></div>
          <div class="row2"><span>Missing so far</span><div class="meter"><i class="lost" id="mLost"></i></div><b class="bignum" id="nLost">0</b></div>
        </div><p class="muted small">Sampled from the running server every 40 ms. “Missing” = calls that were made but never counted.</p>`);
      let r = null;
      await streamNdjson(`/api/cases/race?mode=${mode}&workers=${w}&stream=true`, ev => {
        if (!run.alive() || !$('#mMade')) return;
        if (ev.type === 'tick') {
          const pct = x => Math.min(100, (x / ev.expected) * 100) + '%';
          const gap = Math.max(0, ev.attempted - ev.counted);
          $('#mMade').style.width = pct(ev.attempted);
          $('#mCnt').style.width = pct(ev.counted);
          $('#mLost').style.width = pct(gap);
          $('#nMade').textContent = ev.attempted.toLocaleString();
          $('#nCnt').textContent = ev.counted.toLocaleString();
          $('#nLost').textContent = gap.toLocaleString();
          $('#nLost').classList.toggle('bad', gap > 0);
          liveProgress(run, ev.attempted / ev.expected);
        } else if (ev.type === 'done') r = ev.result;
      });
      if (!run.alive()) return;
      if (!r) throw new Error('No result received from the server.');
      await wait(600);
      if (!run.alive()) return;
      runs.push(r.data);
      const safe = mode !== 'unsafe';
      const flowItems = w === 1 && mode === 'unsafe'
        ? ['Only <b>1</b> request is adding orders – nothing to race against', '✓ Every read → add → write finishes before the next one starts', 'The code looks correct… until real traffic arrives. Turn the number of requests up!']
        : safe
          ? [`${w} requests add 50,000 orders each to the <b>same</b> OrderMetrics`, `Each update is protected by ${mode === 'lock' ? '<b>a lock</b>: one thread at a time' : '<b>Interlocked</b>: read-add-write is one indivisible step'}`, '✓ Not a single update is lost.']
          : [`${w} requests add 50,000 orders each to the <b>same</b> OrderMetrics`, 'Each does: read the number → add one → write it back', 'Two threads read the same number at the same moment', '✗ Both write back the same result – one update disappears.'];
      $('#happened').outerHTML = happened(`
        ${bannerFor(r.status)}
        <h3>Step by step</h3>${flow(flowItems)}
        ${raceView(r.data, runs)}`);
      showWhy('A Singleton is shared by <b>every request and thread</b>. Any state you can change in it must be thread-safe – or it must be immutable. The bug only shows under concurrency, which is why it passes in testing and fails on Black Friday.');
    } catch (e) { $('#happened').outerHTML = happened(`<p class="err-text">${esc(e.message)}</p>`); }
    finally { setBusy([btn], false); }
  };
}

// ======================================================================
// E · Scoped service in a background job: you choose how the job gets it, start the app, tick
// ======================================================================
// Row-based, so it works for any number of ticks: one top card for the job, one row per tick.
function workerView(parsed) {
  const stores = new Set(parsed.map(p => p.store)).size;
  const same = stores === 1;
  const body = [...parsed].reverse().map(p => `
    <div class="rt wk ${same ? 'bad' : 'good'}">
      <span class="rn">tick ${p.n}</span>
      <span>${chip(p.store)}<br>${same ? LIFE_MARK.long : LIFE_MARK.short}</span>
      <span><b>${p.count}</b><br><small>${p.count === 1 ? 'fresh store' : 'same store, still counting'}</small></span>
    </div>`).join('');
  return `<div class="stats">
      <div class="stat"><b>${parsed.length}</b>tick${parsed.length === 1 ? '' : 's'} of the job</div>
      <div class="stat ${same ? 'badx' : 'good'}"><b>${stores}</b>store object${stores === 1 ? '' : 's'} used</div>
      <div class="stat ${same ? 'badx' : 'good'}"><b>${Math.max(...parsed.map(p => p.count))}</b>highest count</div></div>
    <div class="cachecard singleton"><div>${badge('Singleton')} <b>The background job</b></div>
      <div>Lives as long as the app. On every tick it needs a ${badge('Scoped')} <b>ReceiptStore</b>.</div></div>
    <div class="reqtable wkt" role="table" aria-label="Ticks, newest first">
      <div class="rt wk head" role="row"><span>Tick</span><span>ReceiptStore it used ${badge('Scoped')}</span><span>Its count</span></div>
      ${body}
    </div>
    <p class="muted small">Newest tick first. A Scoped store should die with each tick (✝) – not live on (∞).</p>`;
}

async function renderWorker(view) {
  const lab = labId();
  casePage(view, {
    title: 'E · Scoped service in a background job',
    idea: 'A background job lives as long as the app, so it cannot simply hold a Scoped service.',
    context: 'A <code>BackgroundService</code> sends receipts. It lives as long as the app (<b>Singleton</b>) but needs a <b>Scoped</b> service (think: the DbContext). <b>You</b> decide how it gets that service. The shop on page 3 already runs the correct version.',
    look: 'Start the app, then let the job tick a few times. Does each tick get a fresh object?',
    waiting: 'Choose how the job gets its service, start the app, then let it tick.',
    left: `
      <h3>1 · Change the code</h3>
      <p>How does the job get its <code>IReceiptStore</code> (Scoped)?</p>
      ${radios('inj', [
        { value: 'ctor', label: 'Constructor parameter: <code>IReceiptStore store</code>', hint: 'the obvious way' },
        { value: 'factory', label: '<code>IServiceScopeFactory</code> – <code>CreateScope()</code> on each tick', hint: 'a new scope per unit of work' }
      ], 'ctor')}
      <label class="check"><input type="checkbox" id="validate"> Check lifetimes at start-up (<code>ValidateScopes</code>) <small>ASP.NET Core turns this on in Development</small></label>
      ${codePreview('prev')}
      <div class="row"><button class="btn primary" id="start">Start the app</button></div>
      <h3>2 · Let the job work</h3>
      <div class="row"><button class="btn" id="tick">Tick</button><button class="btn" id="tick3">Tick × 3</button><button class="btn" id="auto">▶ Run the job automatically</button></div>`,
    snippets: [{ name: 'worker-broken', label: 'Constructor parameter' }, { name: 'worker-fixed', label: 'IServiceScopeFactory' }, { name: 'worker-fixed-real', label: 'The real shop worker' }]
  });

  let started = false, ticks = [], mode = 'ctor', autoOn = false;
  const stopAuto = () => {
    if (!autoOn) return;
    clearInterval(state.timer); state.timer = null; autoOn = false;
    const b = $('#auto'); if (b) b.textContent = '▶ Run the job automatically';
  };
  const CODE = {
    ctor: 'public class Worker(IReceiptStore store) : BackgroundService\n// Worker is a Singleton, IReceiptStore is Scoped',
    factory: 'public class Worker(IServiceScopeFactory scopes) : BackgroundService\n// each tick: using var scope = scopes.CreateScope();'
  };
  const stale = () => {
    newRun(); stopAuto(); started = false; ticks = [];
    $('#prev').textContent = CODE[getRadio('inj')];
    $('#happened').outerHTML = waiting('You changed the code – start the app again, then let it tick.');
    $('#why').innerHTML = '';
  };
  onChange('inj', stale); $('#validate').onchange = stale;
  $('#prev').textContent = CODE.ctor;

  const draw = () => {
    if (!ticks.length) {
      $('#happened').outerHTML = happened(`${bannerFor('ok').replace('It works', 'The app started')}<p class="explain">The background job is running. No error at all. Now let it tick a few times.</p>`);
      return;
    }
    const parsed = ticks.map(t => /store ([0-9a-f]{8}) count=(\d+)/.exec(t)).filter(Boolean)
      .map((m, i) => ({ n: i + 1, store: m[1], count: +m[2] }));
    const bad = mode === 'ctor';
    $('#happened').outerHTML = happened(`
      ${bannerFor(bad ? 'bug' : 'ok')}
      <h3>Step by step</h3>${flow(bad
        ? ['Validation is off, so the app started happily', 'The Scoped store was created <b>once</b> and kept inside the job', '✗ Every tick reuses the same object – with a real DbContext it would go stale and grow for ever.']
        : ['The job asks for <b>IServiceScopeFactory</b> (a Singleton – allowed)', 'On every tick it opens a <b>new scope</b> and asks for the store there', '✓ Each tick gets a fresh object and cleans up afterwards.'])}
      ${workerView(parsed)}`);
    showWhy('Outside a web request there is no automatic scope. Background jobs must create one themselves, once per unit of work: <code>scopeFactory.CreateScope()</code>.');
  };

  $('#start').onclick = async () => {
    const btn = $('#start'); setBusy([btn], true);
    try {
      mode = getRadio('inj');
      const validate = $('#validate').checked;
      stopAuto();
      const run = liveBegin('Starting the app…');
      const r = await api(`/api/labs/worker/start?lab=${lab}&mode=${mode === 'factory' ? 'factory' : 'inject'}&validate=${validate}`);
      ticks = [];
      await liveSteps(run, [
        mode === 'factory'
          ? 'The container builds the background job: its constructor asks for <code>IServiceScopeFactory</code> (a Singleton – allowed)'
          : 'The container builds the background job: its constructor asks for <code>IReceiptStore</code>, which is <b>Scoped</b>',
        validate ? '<b>ValidateOnBuild</b> is on: checking that no long-lived service holds a shorter-lived one…' : 'Lifetime checks are <b>off</b> – nothing is verified at start-up.',
        r.status === 'error' ? '✗ A Singleton (the job) cannot consume a Scoped service – the container refuses to start.' : '✓ The app is up and the job is waiting for its first tick.'
      ], 520);
      if (!run.alive()) return;
      if (r.status === 'error') {
        started = false;
        $('#happened').outerHTML = happened(`
          ${bannerFor('error')}
          <h3>Step by step</h3>${flow(['The app starts up and (with <b>ValidateScopes</b> on) checks the background job', 'The job’s constructor asks for a <b>Scoped</b> service', '✗ The container refuses: a Singleton cannot consume a Scoped service.'])}
          <p class="explain">This is the good outcome: you find the mistake at startup, not in production. Switch the check off to see what would happen silently, or use the scope factory.</p>
          <details><summary>Technical details (exact message)</summary><pre class="json">${esc(r.message)}</pre></details>`);
        showWhy('Outside a web request there is no automatic scope. Background jobs must create one themselves: <code>scopeFactory.CreateScope()</code>.');
      } else { started = true; draw(); }
    } catch (e) { $('#happened').outerHTML = happened(`<p class="err-text">${esc(e.message)}</p>`); }
    finally { setBusy([btn], false); }
  };

  // one tick of the job; `animate` plays the story of that tick step by step
  const tickOnce = async animate => {
    const r = await api(`/api/labs/worker/tick?lab=${lab}`);
    if (r.status === 'error') { toast(r.message); return false; }
    ticks.push(r.data);
    if (!animate) return true;
    const m = /store ([0-9a-f]{8}) count=(\d+)/.exec(r.data);
    const n = ticks.length, store = chip(m[1]), count = +m[2];
    const run = liveBegin(`Tick ${n}: the job wakes up`);
    await liveSteps(run, mode === 'ctor'
      ? [
          `⏰ Tick ${n}: the timer fires and the job wakes up`,
          `It uses the <b>ReceiptStore</b> it was given at start-up ${store}${n > 1 ? ' – <b>the very same object</b> as last time' : ''}`,
          `It does its work: the store’s count goes ${count - 1} → <b>${count}</b>`,
          `${n > 1 ? '✗ ' : ''}Back to sleep. Nothing is disposed – the “scoped” store lives on ∞`
        ]
      : [
          `⏰ Tick ${n}: the timer fires and the job wakes up`,
          'It opens a new scope: <code>scopeFactory.CreateScope()</code>',
          `The scope creates a <b>fresh ReceiptStore</b> ${store}`,
          'It does its work: the store’s count goes 0 → <b>1</b>',
          `✓ The scope is disposed ✝ – the store ${store} dies with it`
        ], 430);
    return run.alive();
  };

  const tick = async times => {
    if (!started) { toast('Start the app first (step 1).'); return; }
    stopAuto();
    for (let i = 0; i < times; i++) { if (!await tickOnce(true)) return; }
    draw();
  };
  $('#tick').onclick = () => tick(1);
  $('#tick3').onclick = () => tick(3);

  // real time: the job ticks by itself, one tick every 1.5 seconds
  $('#auto').onclick = () => {
    if (!started) { toast('Start the app first (step 1).'); return; }
    if (autoOn) { stopAuto(); return; }
    autoOn = true;
    $('#auto').textContent = '⏹ Stop the job';
    const beat = async () => { if (!autoOn) return; if (await tickOnce(false)) { newRun(); draw(); } };
    beat();
    state.timer = setInterval(beat, 1500);
  };
}

// ======================================================================
// G · Many implementations: you choose what to register, in which order, and how to ask
// ======================================================================
function multiView(d) {
  const all = [...d.registered, ...d.skipped];
  const order = [...all];
  const card = name => {
    const skipped = d.skipped.includes(name), picked = d.picked.includes(name);
    const cls = skipped ? 'skipped' : picked ? 'picked' : 'unused';
    const idx = d.registered.indexOf(name);
    return `<div class="reg ${cls}"><div class="no">${skipped ? 'not registered' : `registered #${idx + 1}`}</div><b>${esc(name)}</b>
      <div class="st">${skipped ? 'skipped by TryAdd' : picked ? '✔ handed out' : 'not used'}</div></div>`;
  };
  return `<h3>The registered senders</h3><div class="regs">${order.map(card).join('')}</div>
    <div class="how">asked with: ${esc(d.how)}</div>`;
}

async function renderMulti(view) {
  const cls = { email: 'EmailSender', sms: 'SmsSender', push: 'PushSender' };
  let list = [{ name: 'email', on: true }, { name: 'sms', on: true }, { name: 'push', on: true }];
  casePage(view, {
    title: 'G · Many implementations of one interface',
    idea: 'One interface, several classes: how do you pick?',
    context: '<b>E-mail</b>, <b>SMS</b> and <b>Push</b> senders all implement <code>IMessageSender</code>. <b>You</b> decide which ones are registered, in what order, and how a class asks for “a sender”.',
    look: 'Change the registration order and ask for “a sender” – which one wins?',
    waiting: 'Register some senders, choose how to ask, then ask the container.',
    left: `
      <h3>Change the code: register the senders</h3>
      <div id="reglist"></div>
      <label class="check"><input type="checkbox" id="tryadd"> Use <code>TryAdd</code> instead of <code>Add</code> <small>(only registers if nothing is registered yet)</small></label>
      <h3>How does the class ask?</h3>
      ${radios('ask', [
        { value: 'one', label: '<code>GetRequiredService&lt;IMessageSender&gt;()</code>', hint: '“give me a sender”' },
        { value: 'all', label: '<code>IEnumerable&lt;IMessageSender&gt;</code>', hint: '“give me all of them”' },
        { value: 'keyed', label: '<code>GetRequiredKeyedService(key)</code>', hint: '“give me the one called …”' }
      ], 'one')}
      <div class="row" id="keyrow" style="display:none"><label class="field">Key <select id="key"><option>email</option><option selected>sms</option><option>push</option></select></label></div>
      ${codePreview('prev')}
      <div class="row"><button class="btn primary" id="run">Ask the container</button></div>`,
    snippets: [{ name: 'multi-run', label: 'Registrations' }, { name: 'multi-keyed-consumer', label: 'Keyed constructor' }, { name: 'pricing', label: 'Real use: discount rules' }]
  });

  const drawList = () => {
    $('#reglist').innerHTML = list.map((it, i) => `<div class="regrow">
      <label class="check" style="margin:0"><input type="checkbox" data-i="${i}" ${it.on ? 'checked' : ''}> <b>${it.name}</b></label>
      <span class="muted small">${cls[it.name]}</span>
      <span><button class="mv" data-i="${i}" data-d="-1" aria-label="Move ${it.name} up" ${i === 0 ? 'disabled' : ''}>▲</button><button class="mv" data-i="${i}" data-d="1" aria-label="Move ${it.name} down" ${i === list.length - 1 ? 'disabled' : ''}>▼</button></span></div>`).join('');
    $('#reglist').querySelectorAll('input').forEach(c => c.onchange = () => { list[+c.dataset.i].on = c.checked; preview(); });
    $('#reglist').querySelectorAll('.mv').forEach(b => b.onclick = () => {
      const i = +b.dataset.i, j = i + +b.dataset.d;
      [list[i], list[j]] = [list[j], list[i]]; drawList(); preview();
    });
  };

  const preview = () => {
    const on = list.filter(x => x.on), tryAdd = $('#tryadd').checked, ask = getRadio('ask');
    $('#keyrow').style.display = ask === 'keyed' ? '' : 'none';
    const regs = on.map(x => `services.${tryAdd ? 'TryAddSingleton' : 'AddSingleton'}<IMessageSender, ${cls[x.name]}>();`).join('\n') || '// nothing registered';
    const call = { one: 'var sender = provider.GetRequiredService<IMessageSender>();', all: 'var senders = provider.GetServices<IMessageSender>();', keyed: `var sender = provider.GetRequiredKeyedService<IMessageSender>("${$('#key').value}");` }[ask];
    $('#prev').textContent = `${regs}\n\n${call}`;
  };
  onChange('ask', preview); $('#tryadd').onchange = preview; $('#key').onchange = preview;
  drawList(); preview();

  const FLOW = {
    one: reg => [`${reg.length} sender(s) registered, in this order: <b>${reg.join(', ') || 'none'}</b>`, 'You ask for <b>one</b> IMessageSender', reg.length > 1 ? `⚠ The container gives you the <b>last</b> one registered (<b>${reg[reg.length - 1]}</b>) – the others are silently ignored.` : '✓ Only one is registered, so there is nothing to choose.'],
    all: reg => [`${reg.length} sender(s) registered, in this order: <b>${reg.join(', ') || 'none'}</b>`, 'You ask for <b>IEnumerable&lt;IMessageSender&gt;</b>', '✓ The container gives you every registration, in order.'],
    keyed: reg => [`Each chosen sender is also registered under its own <b>key</b>`, 'You ask for the one with a specific key', '✓ You get exactly that one – independent of the registration order.']
  };

  $('#run').onclick = async () => {
    const btn = $('#run'); setBusy([btn], true);
    try {
      const on = list.filter(x => x.on).map(x => x.name);
      const ask = getRadio('ask'), tryAdd = $('#tryadd').checked;
      const run = liveBegin('Asking the container…');
      const r = await api(`/api/cases/multi?register=${on.join(',')}&how=${ask}&key=${$('#key').value}&tryAdd=${tryAdd}`);
      if (r.status === 'error') { await liveNote(run, 'The container looks for what you asked for…'); await wait(600); }
      else await liveMulti(run, r.data, on, ask);
      if (!run.alive()) return;
      if (r.status === 'error') {
        $('#happened').outerHTML = happened(`${bannerFor('error')}
          <p class="explain">${on.length === 0 ? 'Nothing was registered, so there is nothing to hand out.' : 'The container could not find what you asked for – for example a key that was never registered.'}</p>
          <details open><summary>Technical details (exact message)</summary><pre class="json">${esc(r.message)}</pre></details>`);
        $('#why').innerHTML = '';
      } else {
        $('#happened').outerHTML = happened(`
          ${bannerFor(r.status)}
          <h3>Step by step</h3>${flow(FLOW[ask](r.data.registered))}
          <p class="explain">${esc(r.message)}</p>
          ${multiView(r.data)}`);
        showWhy('One interface can have many implementations. Choose on purpose: <b>all</b> of them, one <b>by key</b>, or one <b>by factory</b> (like the payment provider in the shop). A plain “give me one” silently picks the <b>last registration</b>.');
      }
    } catch (e) { $('#happened').outerHTML = happened(`<p class="err-text">${esc(e.message)}</p>`); }
    finally { setBusy([btn], false); }
  };
}

// ======================================================================
// F · Testing with mocks: pick a scenario, WRITE your own expectations, see the verdict
// ======================================================================
async function renderMocks(view) {
  const COLLAB = ['InventoryService', 'PricingService', 'PaymentGateway', 'OrderRepository', 'Notifier', 'OrderMetrics', 'AuditLog'];
  const expectRows = COLLAB.map(c => `<div class="name">${c}</div>
    <select data-c="${c}" aria-label="Expectation for ${c}"><option value="">don’t care</option><option value="called">must be called</option><option value="never">must NEVER be called</option></select>`).join('');

  view.innerHTML = `
    <h1>F · Testing with mocks</h1>
    <p class="lead">Because <code>OrderService</code> asks for <em>interfaces</em>, a test can hand it fakes – and then check which ones were called.</p>
    ${split(
      contextCard('<code>OrderService</code> has nine collaborators: stock, pricing, payment, database, e-mail, audit… A test replaces <b>all of them</b> with fakes, runs the <b>real</b> <code>OrderService</code>, and <b>asserts</b> who was called. No database, no real card, no real e-mail.',
        'Last release, a declined card still reduced the stock. Write the test that would have caught it.') +
      section(2, 'Try it', `
        <h3>1 · Arrange: pick a scenario</h3>
        <div class="row">
          <label class="field">Payment
            <select id="mpay"><option value="approve">approves</option><option value="decline" selected>declines the card</option><option value="timeout">times out (throws)</option></select></label>
          <label class="field">Stock
            <select id="mstock"><option value="ok">in stock</option><option value="out">out of stock</option></select></label>
        </div>
        <h3>2 · Assert: what must happen?</h3>
        <div class="collab expect">${expectRows}</div>
        <div class="row">
          <button class="btn primary" id="mtest">Run my test</button>
          <button class="btn" id="mpreset">Fill in the “declined” test for me</button>
        </div>
        <p class="muted small">Then run <code>dotnet test</code> in a terminal – the same scenarios as real unit tests (8 tests, about a second, no SQL Server).</p>`),
      waiting('Pick a scenario, write your assertions and run the test – you will get PASS or FAIL, like a real test runner.') + '<div id="why"></div>'
    )}
    ${codePanel([{ name: 'mocks-run', label: 'Wiring the fakes' }, { name: 'mocks-fakes', label: 'The fakes' }, { name: 'tests-arrange', label: 'Test: set up (NSubstitute)' }, { name: 'tests-success', label: 'Test: happy path' }, { name: 'tests-declined', label: 'Test: payment declined' }, { name: 'tests-pricing', label: 'Test: pricing rules' }, { name: 'order-service', label: 'OrderService' }])}
  `;

  const EXPLAIN = {
    approve: 'Everything succeeded: stock was checked, the price worked out, the card charged, then the order was <b>saved</b>, the metrics updated and the customer <b>notified</b>.',
    decline: 'The card was declined, so <b>OrderRepository</b>, <b>Notifier</b> and <b>OrderMetrics</b> were <b>never called</b> – nothing saved, nobody e-mailed.',
    timeout: 'The gateway threw a <code>TimeoutException</code>. The exception bubbled up and <b>nothing after the payment ran</b>: no save, no e-mail.',
    out: 'Stock ran out, so the flow stopped at the inventory check: the <b>PaymentGateway was never called</b> – the card is never charged for goods we cannot ship.'
  };

  $('#mpreset').onclick = () => {
    $('#mpay').value = 'decline'; $('#mstock').value = 'ok';
    document.querySelectorAll('.expect select').forEach(s => {
      s.value = { PaymentGateway: 'called', OrderRepository: 'never', Notifier: 'never', OrderMetrics: 'never' }[s.dataset.c] ?? '';
    });
  };
  $('#mpreset').click();

  $('#mtest').onclick = async () => {
    const btn = $('#mtest'); setBusy([btn], true);
    try {
      const run = newRun();
      const pay = $('#mpay').value, stock = $('#mstock').value;
      const r = await api(`/api/cases/mocks?payment=${pay}&stock=${stock}`);
      const calls = r.calls.map((c, i) => ({ ...c, n: i + 1 }));
      const calledBy = name => calls.filter(c => c.who === name);
      let neverIdx = 0;
      const neverCount = COLLAB.filter(n => !calledBy(n).length).length;

      const grid = COLLAB.map(name => {
        const mine = calledBy(name);
        return `<div class="name">${esc(name)}</div>` + (mine.length
          ? `<div class="called" data-r="${mine[0].n}">${mine.map(c => `<span class="n">${c.n}</span>${esc(c.what)}`).join('<br>')}</div>`
          : `<div class="never" data-r="${calls.length + 1 + (neverIdx++)}">never called</div>`);
      }).join('');

      const asserts = [...document.querySelectorAll('.expect select')].filter(s => s.value).map(s => {
        const name = s.dataset.c, wasCalled = calledBy(name).length > 0;
        const ok = s.value === 'called' ? wasCalled : !wasCalled;
        return { name, want: s.value, ok, wasCalled };
      });
      const passed = asserts.length > 0 && asserts.every(a => a.ok);
      const verdict = asserts.length === 0
        ? '<div class="banner bug">Write at least one assertion above (a test with no assertions proves nothing).</div>'
        : `<div class="banner ${passed ? 'ok' : 'error'}" data-r="${calls.length + 2 + neverCount + asserts.length}">${passed ? '✓ TEST PASSED' : '✗ TEST FAILED'} – ${asserts.filter(a => a.ok).length} of ${asserts.length} assertions hold</div>
           <ul class="asserts">${asserts.map((a, i) => `<li data-r="${calls.length + 1 + neverCount + i}" class="${a.ok ? 'ok' : 'no'}">${a.ok ? '✓' : '✗'} <b>${esc(a.name)}</b> ${a.want === 'called' ? 'must be called' : 'must never be called'}
             <span class="muted small">– it ${a.wasCalled ? 'was called' : 'was never called'}</span></li>`).join('')}</ul>`;

      const outcome = r.outcome === 'placed' ? '✓ Order placed' : r.outcome === 'rejected' ? `✗ Order rejected: ${r.message}` : `✗ Exception: ${r.message}`;
      $('#happened').outerHTML = happened(`
        ${verdict}
        <h3>What OrderService did (${esc(outcome)})</h3>
        <p class="muted small">Numbers show the order in which the fakes were called.</p>
        <div class="collab">${grid}</div>
        <p class="explain">${stock === 'out' ? EXPLAIN.out : EXPLAIN[pay]}</p>`);
      $('#why').innerHTML = whyBox(`
        <p>This is the everyday payoff of DI: with <code>new StripeClient()</code> hidden inside the class (version A on page 1), none of these scenarios could be tested without really charging a card.</p>
        <p class="muted small">Try “must never be called” on <b>OrderRepository</b> with an approving payment: the test fails – exactly like a real one when the code is wrong. A constructor with nine parameters is itself a hint that the class may be doing too much.</p>`);
      await revealSequence(run, 420);      // the calls appear in the order they happened, then the assertions, then the verdict
    } catch (e) { $('#happened').outerHTML = happened(`<p class="err-text">${esc(e.message)}</p>`); }
    finally { setBusy([btn], false); }
  };
}

// The container registers the senders in your order, then answers the question – step by step.
async function liveMulti(run, d, order, ask) {
  const card = n => stage()?.querySelector(`.reg[data-name="${n}"]`);
  const caption = t => { const c = $('#livecaption'); if (c && run.alive()) c.innerHTML = t; };
  liveHtml(run, `<p class="livenote" id="livecaption">The container registers the senders, in the order you chose:</p>
    <div class="regs">${order.map(n => `<div class="reg pending" data-name="${esc(n)}"><div class="no">waiting</div><b>${esc(n)}</b><div class="st"></div></div>`).join('')}</div>
    <div class="how">asked with: ${esc(d.how)}</div>`);

  // phase 1: registration, one by one (TryAdd may refuse)
  let k = 0;
  for (const name of order) {
    if (!run.alive()) return;
    const el = card(name);
    el.classList.remove('pending'); el.classList.add('registering');
    await wait(480);
    el.classList.remove('registering');
    if (d.skipped.includes(name)) {
      el.classList.add('skipped');
      el.querySelector('.no').textContent = 'not registered';
      el.querySelector('.st').textContent = '✗ TryAdd: one already exists';
    } else {
      k++;
      el.querySelector('.no').textContent = `registered #${k}`;
    }
    liveProgress(run, (order.indexOf(name) + 1) / (order.length + 1));
  }

  // phase 2: the lookup
  caption(`Now a class asks the container: <code>${esc(d.how)}</code>`);
  await wait(550);
  const regs = d.registered;
  if (ask === 'keyed') {
    const hit = d.picked[0];
    caption(`The container looks up the key “<b>${esc(hit)}</b>” – it does not care about the order.`);
    card(hit)?.classList.add('scan');
    await wait(650);
  } else {
    caption(ask === 'all' ? 'The container returns <b>every</b> registration, in order:' : 'The container walks the registrations and keeps the <b>last</b> one:');
    for (const name of regs) {
      if (!run.alive()) return;
      card(name)?.classList.add('scan');
      await wait(420);
      if (ask === 'all') { card(name)?.classList.remove('scan'); card(name)?.classList.add('picked'); card(name).querySelector('.st').textContent = '✔ handed out'; }
      else if (name !== regs[regs.length - 1]) card(name)?.classList.remove('scan');
    }
  }
  for (const name of regs) {
    const el = card(name);
    if (!el) continue;
    el.classList.remove('scan');
    const picked = d.picked.includes(name);
    el.classList.add(picked ? 'picked' : 'unused');
    el.querySelector('.st').textContent = picked ? '✔ handed out' : 'not used';
  }
  liveProgress(run, 1);
  await wait(450);
}

// ---- start the app (after app.js and this file are loaded) ----
buildNav();
window.addEventListener('hashchange', route);
route();
