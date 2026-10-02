'use strict';

// ======================================================================
// Live progress toolkit: every action shows what is happening WHILE it happens.
//  - streamNdjson : real events streamed from the server (DbContext tasks, race counters, order steps)
//  - liveStep / liveTree / ... : the instant things (container building objects, a request being served)
//    are played back one step at a time, in their real order, so the audience can follow.
// The speed switch in the header scales (or removes) the pauses. Loaded after app.js, before cases.js.
// ======================================================================

const SPEEDS = { normal: 1, fast: 0.35, off: 0 };
const live = {
  token: 0,
  speed: (() => { try { return localStorage.getItem('speed') || 'normal'; } catch { return 'normal'; } })()
};
const speedFactor = () => SPEEDS[live.speed] ?? 1;
const wait = ms => (speedFactor() === 0 ? Promise.resolve() : new Promise(r => setTimeout(r, ms * speedFactor())));

function addSpeedControl() {
  const top = document.querySelector('.top');
  if (!top || document.getElementById('speed')) return;
  const label = document.createElement('label');
  label.className = 'speed';
  label.innerHTML = '⏱ Animation <select id="speed" aria-label="Animation speed"><option value="normal">Normal</option><option value="fast">Fast</option><option value="off">Off (instant)</option></select>';
  top.appendChild(label);
  const sel = label.querySelector('select');
  sel.value = live.speed;
  sel.onchange = () => { live.speed = sel.value; try { localStorage.setItem('speed', live.speed); } catch { /* ignore */ } };
}

// ---- runs: starting a new action cancels the animation of the previous one ----
const newRun = () => { const id = ++live.token; return { id, alive: () => id === live.token }; };

function liveBegin(title) {
  const run = newRun();
  const html = `<section class="step live" id="happened"><h2><span class="n">3</span>What happened <span class="livetag">● LIVE</span></h2>
    <div class="livebar"><i></i></div><div class="livetitle muted small">${esc(title || 'Running…')}</div><div id="livestage"></div></section>`;
  const el = document.getElementById('happened');
  if (el) el.outerHTML = html;
  return run;
}

const stage = () => document.getElementById('livestage');

// the numbered list currently at the bottom of the stage (created when needed)
function liveList() {
  const last = stage().lastElementChild;
  if (last && last.matches('ol.flow.live')) return last;
  const ol = document.createElement('ol');
  ol.className = 'flow live';
  stage().appendChild(ol);
  return ol;
}

function liveProgress(run, fraction) {
  if (!run.alive()) return;
  const bar = document.querySelector('.livebar i');
  if (bar) bar.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

function liveNote(run, html) {
  if (!run.alive() || !stage()) return Promise.resolve(false);
  stage().insertAdjacentHTML('beforeend', `<p class="livenote">${html}</p>`);
  return wait(250).then(() => run.alive());
}

function liveHtml(run, html) {
  if (!run.alive() || !stage()) return false;
  stage().insertAdjacentHTML('beforeend', html);
  return true;
}

// one numbered step: shows a spinner, then resolves (✓ / ✗ by the leading character, or `kind`)
async function liveStep(run, html, opts = {}) {
  if (!run.alive() || !stage()) return false;
  const list = liveList();
  const li = document.createElement('li');
  li.className = 'pending';
  li.dataset.n = String(list.children.length + 1);
  li.innerHTML = html;
  list.appendChild(li);
  await wait(opts.ms ?? 450);
  if (!run.alive()) return false;
  const text = li.textContent.trim();
  li.className = opts.kind ?? (text.startsWith('✗') ? 'fail' : text.startsWith('✓') ? 'good' : '');
  return true;
}

async function liveSteps(run, items, ms = 420) {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const ok = await liveStep(run, typeof it === 'string' ? it : it.html, typeof it === 'string' ? { ms } : { ms, ...it });
    if (!ok) return false;
    liveProgress(run, (i + 1) / items.length);
  }
  return true;
}

// a "working…" placeholder while we wait for the server; returns a function that removes it
function livePending(run, text) {
  if (!run.alive() || !stage()) return () => {};
  const list = liveList();
  const li = document.createElement('li');
  li.className = 'pending waiting';
  li.dataset.n = String(list.children.length + 1);
  li.textContent = text;
  list.appendChild(li);
  return () => li.remove();
}

// ---- tiny async queue: events arrive in real time, the UI consumes them at a followable pace ----
class Chan {
  constructor() { this.q = []; this.waiters = []; this.closed = false; }
  push(v) { const w = this.waiters.shift(); if (w) w({ value: v, done: false }); else this.q.push(v); }
  close() { this.closed = true; this.waiters.forEach(w => w({ value: undefined, done: true })); this.waiters = []; }
  next() {
    if (this.q.length) return Promise.resolve({ value: this.q.shift(), done: false });
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise(r => this.waiters.push(r));
  }
  [Symbol.asyncIterator]() { return this; }
}

// reads application/x-ndjson from the server and calls onEvent for every line AS IT ARRIVES
async function streamNdjson(url, onEvent, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Demo-User': state.user } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer));
}

// ---- the container building a dependency tree, animated in the order it really works ----
function animTreeNode(n, nodes) {
  const idx = nodes.length;
  nodes.push(n);
  const impl = n.implementation && n.implementation !== n.service ? ` <span class="arrow">→</span> <b>${esc(n.implementation)}</b>` : '';
  const life = n.lifetime && n.lifetime !== '-' ? ` ${badge(n.lifetime)}` : '';
  const kids = (n.needs || []).map(c => animTreeNode(c, nodes)).join('');
  return `<li class="dim ${n.cycle ? 'cycle' : ''}" data-i="${idx}"><span class="svc">${esc(n.service)}</span>${impl}${life}<span class="made"></span>${kids ? `<ul>${kids}</ul>` : ''}</li>`;
}

const isRealNode = n => !/registered|framework|picked at runtime|needs itself|not registered/.test(n.implementation || '');

/**
 * Phase 1 – resolving: the container walks DOWN the constructors (each node lights up).
 *           If it meets a loop it stops right there.
 * Phase 2 – building: dependencies are created first (post-order). A Scoped/Singleton that was already
 *           created is REUSED the second time it is needed; a Transient is created again every time.
 * Returns { stuck } – true when a circular dependency stopped the container.
 */
async function liveTree(run, graph, { label } = {}) {
  const nodes = [];
  const html = animTreeNode(graph, nodes);
  if (!liveHtml(run, `<div class="livetree">${label ? `<p class="muted small">${label}</p>` : ''}<ul class="tree root">${html}</ul></div>`)) return { stuck: false };
  const el = i => stage()?.querySelector(`.livetree li[data-i="${i}"]`);
  const pace = Math.max(50, Math.min(220, 1500 / Math.max(nodes.length, 1)));

  // phase 1: resolve (pre-order = the order the container descends)
  for (let i = 0; i < nodes.length; i++) {
    if (!run.alive()) return { stuck: false };
    const li = el(i);
    li?.classList.remove('dim'); li?.classList.add('visiting');
    await wait(pace);
    if (nodes[i].cycle) {
      li?.classList.add('stuck');
      li?.querySelector('.made').replaceChildren(document.createTextNode(' ✗ already being built – the container is stuck'));
      return { stuck: true };
    }
  }

  // phase 2: build (post-order: dependencies first)
  const order = [];
  (function post(n, i) { // returns next index
    let next = i + 1;
    const mine = i;
    (n.needs || []).forEach(c => { next = post(c, next); });
    order.push(mine);
    return next;
  })(graph, 0);

  const made = new Set();
  for (const i of order) {
    if (!run.alive()) return { stuck: false };
    const n = nodes[i], li = el(i);
    if (!isRealNode(n)) { li?.classList.remove('visiting'); continue; }
    li?.classList.add('building');
    await wait(pace);
    const key = n.implementation;
    const shared = n.lifetime === 'Scoped' || n.lifetime === 'Singleton';
    const reused = shared && made.has(key);
    made.add(key);
    li?.classList.remove('visiting', 'building');
    li?.classList.add(reused ? 'reused' : 'built');
    li?.querySelector('.made').replaceChildren(document.createTextNode(reused ? ' ♻ reused – already created' : ' ✓ created'));
  }
  return { stuck: false };
}

// reveal elements in order (data-r="0,1,2…") inside #happened
async function revealSequence(run, ms = 380) {
  const els = [...document.querySelectorAll('#happened [data-r]')].sort((a, b) => a.dataset.r - b.dataset.r);
  for (const el of els) {
    if (!run.alive()) return false;
    el.classList.add('on');
    await wait(ms);
  }
  return true;
}

addSpeedControl();
