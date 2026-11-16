'use strict';
// ---------- Данные ----------
const KEY = 'podhod.v1';
// goal — цель курса: столько за один подход (для планки — секунд)
const DEFAULTS = [
  { id: 'pushups', name: 'Отжимания', type: 'reps', goal: 200 },
  { id: 'pullups', name: 'Подтягивания', type: 'reps', goal: 100 },
  { id: 'dips', name: 'Брусья', type: 'reps', goal: 150 },
  { id: 'abs', name: 'Пресс', type: 'reps', goal: 300 },
  { id: 'squats', name: 'Приседания', type: 'reps', goal: 500 },
  { id: 'rope', name: 'Скакалка', type: 'reps', goal: 1000 },
  { id: 'plank', name: 'Планка', type: 'time', goal: 300 },
  { id: 'run', name: 'Бег 5К', type: 'run' },
];
const PCT = [0.6, 0.75, 0.6, 0.6, 0.75]; // доли от максимума; последний подход — на максимум
const PER_WEEK = 3; // после стольких тренировок — замер
// Бег: по неделям [бег сек, ходьба сек, повторов], каждая неделя — 3 тренировки
const RUN = [[60, 90, 8], [90, 120, 6], [180, 120, 5], [300, 150, 4], [480, 180, 3], [720, 180, 2], [1200, 0, 1], [1500, 0, 1], [1800, 0, 1]];
const RUN_TOTAL = RUN.length * 3;
const runWeek = lvl => RUN[Math.min(RUN.length - 1, Math.floor(lvl / 3))];

function fresh() {
  return {
    exercises: DEFAULTS.map(e => ({ ...e, max: 0, since: 0, lvl: 0, history: [] })),
    settings: { rest: 60, sound: true },
  };
}
function valid(s) {
  return s && Array.isArray(s.exercises) && s.settings &&
    s.exercises.every(e => e && e.id && typeof e.name === 'string' && Array.isArray(e.history));
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (valid(s)) return s;
  } catch (e) {}
  return fresh();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
}
let S = load();

// ---------- Подбор повторений ----------
const sum = a => a.reduce((x, y) => x + y, 0);
const plan = max => PCT.map(p => Math.max(1, Math.round(max * p)));

function nextMax(max, targets, done) {
  const t = sum(targets), d = sum(done);
  if (d >= t) {
    const bonus = Math.max(0, done[done.length - 1] - targets[targets.length - 1]);
    return max + Math.max(1, Math.round(max * 0.05)) + Math.floor(bonus / 2);
  }
  if (d < t * 0.85) return Math.max(1, Math.round(max * 0.9));
  return max;
}

// ---------- Утилиты ----------
const $ = s => document.querySelector(s);
const app = $('#app');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = d => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
const fmtTime = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
const unit = ex => ex.type === 'reps' ? '' : ' сек';
const bar = (v, of) => `<div class="bar"><i style="width:${Math.min(100, Math.round(v / of * 100))}%"></i></div>`;
const byId = id => S.exercises.find(e => e.id === id);

let ac;
function beep(freq = 880, dur = 0.15, n = 1) {
  if (!S.settings.sound) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    for (let i = 0; i < n; i++) {
      const o = ac.createOscillator(), g = ac.createGain();
      const t = ac.currentTime + i * (dur + 0.1);
      o.frequency.value = freq;
      o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.start(t); o.stop(t + dur);
    }
  } catch (e) {}
}

let wake = null;
async function keepAwake() {
  try { if (navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) {}
}
function releaseWake() { try { if (wake) wake.release(); } catch (e) {} wake = null; }
document.addEventListener('visibilitychange', () => { if (W && W.phase !== 'done' && document.visibilityState === 'visible') keepAwake(); });

// ---------- Состояние экрана ----------
let view = 'home';
let progId = null;
let W = null; // текущая тренировка

function render() {
  app.innerHTML = W ? vWorkout() : (view === 'home' ? vHome() : view === 'prog' ? vProg() : vSettings()) + vNav();
  window.scrollTo(0, 0);
}

function vNav() {
  const tab = (id, label, icon) => `<button data-a="tab" data-v="${id}" class="${view === id ? 'on' : ''}"><svg viewBox="0 0 24 24">${icon}</svg>${label}</button>`;
  return `<nav>
    ${tab('home', 'Тренировки', '<path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/>')}
    ${tab('prog', 'Прогресс', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>')}
    ${tab('set', 'Настройки', '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>')}
  </nav>`;
}

// ---------- Главный экран ----------
function vHome() {
  const weekAgo = Date.now() - 7 * 864e5;
  const week = sum(S.exercises.map(e => e.history.filter(h => !h.test && h.d > weekAgo).length));
  const cards = S.exercises.map(ex => {
    const last = ex.history[ex.history.length - 1];
    const lastTxt = last ? ' · последняя ' + fmtDate(last.d) : '';
    const btn = label => `<button class="pri fix" data-a="start" data-id="${esc(ex.id)}">${label}</button>`;
    if (ex.type === 'run') {
      if (ex.lvl >= RUN_TOTAL) {
        return `<div class="card"><div class="top"><div><b>${esc(ex.name)}</b><small>Программа пройдена${lastTxt}</small></div>${btn('Повторить')}</div>${bar(1, 1)}</div>`;
      }
      const [r, w, n] = runWeek(ex.lvl);
      return `<div class="card"><div class="top"><div><b>${esc(ex.name)}</b>
          <small>Неделя ${Math.floor(ex.lvl / 3) + 1} из ${RUN.length}, тренировка ${ex.lvl % 3 + 1} из 3${lastTxt}</small></div>${btn('Начать')}</div>
        <div class="plan">${n > 1 ? n + ' × ' : ''}бег ${fmtTime(r)}${w ? ' / ходьба ' + fmtTime(w) : ''}</div>${bar(ex.lvl, RUN_TOTAL)}</div>`;
    }
    if (!ex.max) {
      return `<div class="card"><div class="top"><div><b>${esc(ex.name)}</b><small>Сначала замер: сделайте максимум за один подход${ex.goal ? '. Цель курса: ' + ex.goal + unit(ex) : ''}</small></div>${btn('Замер')}</div></div>`;
    }
    const goalTxt = ex.goal ? (ex.max >= ex.goal ? 'Цель достигнута!' : `${ex.max} из ${ex.goal}${unit(ex)} за подход`) : `Уровень ${ex.max}${unit(ex)}`;
    const goalBar = ex.goal ? bar(ex.max, ex.goal) : '';
    if (ex.since >= PER_WEEK) {
      return `<div class="card"><div class="top"><div><b>${esc(ex.name)}</b><small>${goalTxt}${lastTxt}</small></div>${btn('Замер')}</div>
        <div class="plan">Еженедельный замер</div><small>Один подход на максимум, по нему пересчитается программа</small>${goalBar}</div>`;
    }
    return `<div class="card"><div class="top"><div><b>${esc(ex.name)}</b><small>${goalTxt}${lastTxt}</small></div>${btn('Начать')}</div>
      <div class="plan">${plan(ex.max).join(' · ')}+</div>
      <small>Тренировка ${ex.since + 1} из ${PER_WEEK} на этой неделе · отдых ${S.settings.rest} сек</small>${goalBar}</div>`;
  }).join('');
  return `<h1>Тренировки</h1><p class="sub">За 7 дней: ${week}</p>
    ${cards || '<p class="empty">Упражнений нет. Добавьте их в настройках.</p>'}
    <button class="ghost" style="width:100%" data-a="tab" data-v="set">+ Добавить упражнение</button>`;
}

// ---------- Тренировка ----------
function startWorkout(id, forceTest) {
  const ex = byId(id);
  if (!ex) return;
  if (ex.type === 'run') {
    if (ex.lvl >= RUN_TOTAL) ex.lvl = RUN_TOTAL - 1;
    const [r, w, n] = runWeek(ex.lvl), segs = [];
    for (let k = 0; k < n; k++) { segs.push({ t: 'Бег', s: r }); if (w) segs.push({ t: 'Ходьба', s: w }); }
    W = { ex, run: true, segs, i: 0, segEnd: 0, started: false, phase: 'run', lastBeep: 0 };
  } else {
    const test = forceTest || !ex.max || ex.since >= PER_WEEK;
    W = { ex, test, targets: test ? [0] : plan(ex.max), done: [], i: 0, count: 0, t0: null, phase: 'set', restEnd: 0, hit: false, lastBeep: 0, oldMax: ex.max };
  }
  beep(1, 0.01); // разблокировать звук по жесту
  keepAwake();
  render();
}

function vRun() {
  const ex = W.ex, seg = W.segs[W.i];
  const head = sub => `<header class="wh"><button class="x" data-a="quit" aria-label="Закрыть">✕</button><div><b>${esc(ex.name)}</b><small>${sub}</small></div></header>`;
  if (W.phase === 'done') {
    const secs = sum(W.segs.filter(s => s.t === 'Бег').map(s => s.s));
    return head('Тренировка завершена') + `<div class="center"><p class="goal">Бега за тренировку</p><p class="sum">${fmtTime(secs)}</p>
      <p class="sub" style="margin-top:12px">${ex.lvl >= RUN_TOTAL ? 'Программа пройдена: 30 минут без остановки!' : 'Следующая тренировка открыта'}</p>
      <button class="pri" style="width:100%" data-a="close">Готово</button></div>`;
  }
  const next = W.segs[W.i + 1];
  const left = W.started ? Math.max(0, Math.ceil((W.segEnd - Date.now()) / 1000)) : seg.s;
  return head(`Отрезок ${W.i + 1} из ${W.segs.length}`) + `<p class="goal"><b>${seg.t}</b></p>
    <button id="tap" class="big ${seg.t === 'Бег' ? 'hit' : 'rest'}"><span id="cnt" style="font-size:72px">${fmtTime(left)}</span>
    <small id="hint">${W.started ? (next ? 'далее: ' + next.t.toLowerCase() + ' ' + fmtTime(next.s) : 'последний отрезок') : 'нажмите, чтобы начать'}</small></button>
    <p class="sub center">Перед началом разомнитесь 5 минут быстрым шагом. Экран должен оставаться включённым.</p>`;
}

function vWorkout() {
  if (W.run) return vRun();
  const ex = W.ex, n = W.targets.length, isLast = W.i === n - 1, target = W.targets[W.i];
  const head = `<header class="wh"><button class="x" data-a="quit" aria-label="Закрыть">✕</button><div><b>${esc(ex.name)}</b>
    <small>${W.test ? 'Замер максимума' : W.phase === 'done' ? 'Тренировка завершена' : `Подход ${W.i + 1} из ${n}`}</small></div></header>`;
  const dots = W.test ? '' : `<div class="dots">${W.targets.map((t, i) =>
    `<span class="${i < W.done.length ? 'd' : i === W.i ? 'c' : ''}">${i < W.done.length ? W.done[i] : t + (i === n - 1 ? '+' : '')}</span>`).join('')}</div>`;

  if (W.phase === 'done') {
    if (W.test) {
      return head + `<div class="center"><p class="goal">Ваш максимум</p><p class="sum">${ex.max}${unit(ex)}</p>
        <p class="sub" style="margin-top:12px">${W.oldMax ? 'Было ' + W.oldMax + unit(ex) + '. ' : ''}Программа на неделю: ${plan(ex.max).join(' · ')}+</p>
        <button class="pri" style="width:100%" data-a="close">Готово</button></div>`;
    }
    const cls = ex.max > W.oldMax ? 'up' : ex.max < W.oldMax ? 'down' : '';
    const msg = ex.max > W.oldMax ? 'План выполнен, нагрузка повышена' : ex.max < W.oldMax ? 'Было тяжело, нагрузка снижена' : 'Почти получилось, нагрузка та же';
    return head + dots + `<div class="center"><p class="goal">Всего за тренировку</p><p class="sum">${sum(W.done)}${unit(ex)}</p>
      <p class="lvl ${cls}">Уровень ${W.oldMax} → ${ex.max}</p><p class="sub">${msg}</p>
      <button class="pri" style="width:100%" data-a="close">Готово</button></div>`;
  }

  if (W.phase === 'rest') {
    const left = Math.max(0, Math.ceil((W.restEnd - Date.now()) / 1000));
    return head + dots + `<p class="goal">Отдых. Далее: <b>${target}${isLast ? '+' : ''}${unit(ex)}</b></p>
      <div class="big rest"><span id="rest">${fmtTime(left)}</span><small>до следующего подхода</small></div>
      <div class="row"><button data-a="more">+15 сек</button><button class="pri" data-a="skip">Пропустить</button></div>`;
  }

  const goal = W.test ? `Сделайте максимум ${ex.type === 'time' ? 'по времени' : 'повторений'}`
    : isLast ? `На максимум! Не меньше <b>${target}${unit(ex)}</b>` : `Цель: <b>${target}${unit(ex)}</b>`;
  const hint = ex.type === 'time' ? (W.t0 ? 'секундомер идёт' : 'нажмите, чтобы запустить') : 'нажимайте на каждое повторение';
  return head + dots + `<p class="goal">${goal}</p>
    <button id="tap" class="big${W.hit ? ' hit' : ''}"><span id="cnt">${W.count}</span><small id="hint">${hint}</small></button>
    <div class="row">${ex.type === 'time' ? '' : '<button class="fix" data-a="minus">−1</button>'}<button class="pri" data-a="setDone">Подход выполнен</button></div>`;
}

function checkHit() {
  const target = W.targets[W.i];
  if (!W.test && !W.hit && W.count >= target) {
    W.hit = true;
    beep(1040, 0.12);
    const b = $('#tap'); if (b) b.classList.add('hit');
  }
}

function tap() {
  if (!W) return;
  if (W.run) {
    if (W.phase === 'run' && !W.started) { W.started = true; W.segEnd = Date.now() + W.segs[0].s * 1000; beep(1040, 0.2); render(); }
    return;
  }
  if (W.phase !== 'set') return;
  if (W.ex.type === 'time') {
    if (!W.t0) { W.t0 = Date.now(); $('#hint').textContent = 'секундомер идёт'; beep(660, 0.08); }
    return;
  }
  W.count++;
  $('#cnt').textContent = W.count;
  checkHit();
}

function setDone() {
  const ex = W.ex;
  if (ex.type === 'time' && W.t0) { W.count = Math.floor((Date.now() - W.t0) / 1000); W.t0 = null; }
  if (W.test) {
    if (W.count < 1) return;
    ex.max = W.count; ex.since = 0;
    ex.history.push({ d: Date.now(), sets: [W.count], max: ex.max, test: true });
    save();
    W.phase = 'done'; releaseWake(); beep(880, 0.15, 2);
    return render();
  }
  W.done.push(W.count);
  W.count = 0; W.hit = false; W.i++;
  if (W.i >= W.targets.length) {
    ex.max = nextMax(W.oldMax, W.targets, W.done);
    ex.since = (ex.since || 0) + 1;
    ex.history.push({ d: Date.now(), sets: W.done.slice(), max: ex.max });
    save();
    W.phase = 'done'; releaseWake(); beep(880, 0.15, 3);
  } else {
    W.phase = 'rest'; W.restEnd = Date.now() + S.settings.rest * 1000; W.lastBeep = 0;
  }
  render();
}

setInterval(() => {
  if (!W) return;
  if (W.run) {
    if (W.phase !== 'run' || !W.started) return;
    const left = Math.ceil((W.segEnd - Date.now()) / 1000);
    if (left <= 0) {
      W.i++; W.lastBeep = 0;
      if (W.i >= W.segs.length) {
        const ex = W.ex;
        ex.lvl++;
        ex.history.push({ d: Date.now(), sets: [sum(W.segs.filter(s => s.t === 'Бег').map(s => s.s))], max: ex.lvl });
        save();
        W.phase = 'done'; releaseWake(); beep(880, 0.15, 3);
      } else {
        W.segEnd = Date.now() + W.segs[W.i].s * 1000; beep(1040, 0.2, 2);
      }
      return render();
    }
    const el = $('#cnt'); if (el) el.textContent = fmtTime(left);
    if (left <= 3 && W.lastBeep !== left) { W.lastBeep = left; beep(660, 0.08); }
    return;
  }
  if (W.phase === 'rest') {
    const left = Math.ceil((W.restEnd - Date.now()) / 1000);
    if (left <= 0) { W.phase = 'set'; beep(1040, 0.2, 2); render(); return; }
    const el = $('#rest'); if (el) el.textContent = fmtTime(left);
    if (left <= 3 && W.lastBeep !== left) { W.lastBeep = left; beep(660, 0.08); }
  } else if (W.phase === 'set' && W.t0) {
    W.count = Math.floor((Date.now() - W.t0) / 1000);
    const el = $('#cnt'); if (el) el.textContent = W.count;
    checkHit();
  }
}, 200);

// ---------- Прогресс ----------
function vProg() {
  if (!S.exercises.length) return '<h1>Прогресс</h1><p class="empty">Упражнений нет.</p>';
  const ex = byId(progId) || S.exercises[0];
  const chips = `<div class="chips">${S.exercises.map(e => `<button data-a="prog" data-id="${esc(e.id)}" class="${e === ex ? 'on' : ''}">${esc(e.name)}</button>`).join('')}</div>`;
  const ws = ex.history.filter(h => !h.test);
  const all = ex.history.flatMap(h => h.sets);
  const u = unit(ex);
  const stats = `<div class="stats">
    <div class="card"><b>${ws.length}</b><small>тренировок</small></div>
    <div class="card"><b>${ex.type === 'run' ? Math.min(ex.lvl + 1, RUN_TOTAL) + '/' + RUN_TOTAL : (ex.max || '—')}</b><small>${ex.type === 'run' ? 'этап программы' : 'текущий уровень' + (u ? ', сек' : '')}</small></div>
    <div class="card"><b>${sum(all)}</b><small>всего ${u ? 'секунд' : 'повторений'}</small></div>
    <div class="card"><b>${all.length ? Math.max(...all) : '—'}</b><small>рекорд за подход</small></div></div>`;
  const recent = ws.slice(-20);
  const top = Math.max(1, ...recent.map(h => sum(h.sets)));
  const chart = recent.length
    ? `<div class="card"><small style="margin-bottom:28px">Сумма за тренировку, последние ${recent.length}</small>
       <div class="bars">${recent.map(h => `<i style="height:${Math.round(sum(h.sets) / top * 100)}%" data-v="${sum(h.sets)}"></i>`).join('')}</div></div>`
    : '';
  const hist = ex.history.length
    ? `<div class="card">${ex.history.slice().reverse().slice(0, 30).map(h =>
        `<div class="hist"><span>${fmtDate(h.d)}</span><div>${h.test ? 'замер: ' + h.sets[0] + u : h.sets.join(' · ')}</div><b>${h.test ? '' : sum(h.sets)}</b></div>`).join('')}</div>`
    : '<p class="empty">Пока нет тренировок по этому упражнению.</p>';
  return `<h1>Прогресс</h1><p class="sub">Статистика по упражнениям</p>${chips}${stats}${chart}<h2>История</h2>${hist}`;
}

// ---------- Настройки ----------
function vSettings() {
  const list = S.exercises.map(e => `<div class="line"><div><b>${esc(e.name)}</b><small style="color:var(--mute);display:block">${e.type === 'run' ? 'интервальный бег' : (e.type === 'time' ? 'на время' : 'на повторения') + (e.goal ? ' · цель ' + e.goal : '') + (e.max ? ' · уровень ' + e.max : '')}</small></div>
    <div class="row" style="flex:0 0 auto">${e.type === 'run' ? '' : `<button data-a="retest" data-id="${esc(e.id)}">Замер</button>`}<button class="danger" data-a="del" data-id="${esc(e.id)}">Удалить</button></div></div>`).join('');
  return `<h1>Настройки</h1><p class="sub">Данные хранятся только на этом устройстве</p>
    <div class="card">
      <div class="line"><span>Отдых между подходами</span><div class="step"><button data-a="rest" data-v="-5">−</button><b>${S.settings.rest} сек</b><button data-a="rest" data-v="5">+</button></div></div>
      <div class="line"><label for="snd">Звуковые сигналы</label><input id="snd" type="checkbox" ${S.settings.sound ? 'checked' : ''}></div>
    </div>
    <h2>Упражнения</h2>
    <div class="card">${list || '<p class="empty">Пусто</p>'}</div>
    <div class="card"><div class="row"><input id="newName" type="text" placeholder="Новое упражнение" maxlength="30">
      <select id="newType" class="fix" style="width:auto"><option value="reps">повторения</option><option value="time">время</option></select></div>
      <input id="newGoal" type="text" inputmode="numeric" placeholder="Цель за один подход (необязательно)" style="margin-top:10px">
      <button class="pri" style="width:100%;margin-top:10px" data-a="add">Добавить</button></div>
    <h2>Резервная копия</h2>
    <div class="card"><div class="row"><button data-a="export">Сохранить в файл</button><button data-a="import">Загрузить из файла</button></div>
      <input id="file" type="file" accept="application/json,.json" hidden></div>
    <button class="ghost danger" style="width:100%" data-a="reset">Сбросить все данные</button>`;
}

async function exportData() {
  const name = 'podhod-' + new Date().toISOString().slice(0, 10) + '.json';
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function importData(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const s = JSON.parse(r.result);
      if (!valid(s)) throw 0;
      if (!confirm('Заменить текущие данные данными из файла?')) return;
      S = s; save(); render();
    } catch (e) { alert('Не удалось прочитать файл: это не резервная копия приложения.'); }
  };
  r.readAsText(file);
}

// ---------- Действия ----------
const actions = {
  tab(d) { view = d.v; render(); },
  start(d) { startWorkout(d.id); },
  prog(d) { progId = d.id; render(); },
  minus() { if (W.count > 0) { W.count--; $('#cnt').textContent = W.count; } },
  setDone,
  more() { W.restEnd += 15000; $('#rest').textContent = fmtTime(Math.ceil((W.restEnd - Date.now()) / 1000)); },
  skip() { W.phase = 'set'; render(); },
  quit() {
    if (W.phase !== 'done' && !confirm('Прервать тренировку? Результат не сохранится.')) return;
    actions.close();
  },
  close() { W = null; releaseWake(); view = 'home'; render(); },
  rest(d) { S.settings.rest = Math.min(300, Math.max(10, S.settings.rest + Number(d.v))); save(); render(); },
  add() {
    const name = $('#newName').value.trim();
    if (!name) return;
    const goal = Math.max(0, parseInt($('#newGoal').value, 10) || 0);
    S.exercises.push({ id: 'x' + Date.now().toString(36), name, type: $('#newType').value, goal, max: 0, since: 0, lvl: 0, history: [] });
    save(); render();
  },
  del(d) {
    const ex = byId(d.id);
    if (!ex || !confirm(`Удалить «${ex.name}» вместе с историей?`)) return;
    S.exercises = S.exercises.filter(e => e !== ex); save(); render();
  },
  retest(d) {
    const ex = byId(d.id);
    if (!ex) return;
    if (ex.max && !confirm('Сделать замер сейчас? Программа пересчитается по новому результату.')) return;
    startWorkout(ex.id, true);
  },
  export: exportData,
  import() { $('#file').click(); },
  reset() {
    if (!confirm('Удалить все упражнения и историю? Это нельзя отменить.')) return;
    S = fresh(); save(); render();
  },
};

document.addEventListener('pointerdown', e => {
  if (e.target.closest('#tap')) { e.preventDefault(); tap(); }
});
document.addEventListener('click', e => {
  const b = e.target.closest('[data-a]');
  if (b && actions[b.dataset.a]) actions[b.dataset.a](b.dataset);
});
document.addEventListener('change', e => {
  if (e.target.id === 'snd') { S.settings.sound = e.target.checked; save(); }
  if (e.target.id === 'file' && e.target.files[0]) importData(e.target.files[0]);
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
render();
