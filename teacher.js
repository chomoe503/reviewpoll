(function () {
  'use strict';

  var PW = '';
  try { PW = localStorage.getItem('rv-pw') || ''; } catch (e) {}
  var R = null;               // 最近一次從伺服器拿到的結果 { open, version, groups, N, good, counts }
  var questions = [];
  var done = new Set();       // 已講解的題目（只存在這個畫面）
  var doneVersion = null;
  var draftVersion = null;
  var sortMode = 'count';
  var draft = [];
  var authed = false;
  var busy = false;
  var timer = null;

  function $(s) { return document.querySelector(s); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function parseNums(text) {
    var out = [];
    var seen = {};
    function add(s) { if (s && !seen[s] && out.length < 100) { seen[s] = true; out.push(s); } }
    var toks = String(text || '').replace(/[，、；;]/g, ',').replace(/[–—~～至到]/g, '-').split(/[,\s]+/);
    toks.forEach(function (t) {
      if (!t) return;
      var m = t.match(/^(\d{1,3})-(\d{1,3})$/);
      if (m) {
        var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        if (a <= b) { for (var n = a; n <= b && out.length < 100; n++) add(String(n)); } else { add(t); }
        return;
      }
      m = t.match(/^([A-Za-z])-([A-Za-z])$/);
      if (m) {
        var c1 = m[1].toUpperCase().charCodeAt(0), c2 = m[2].toUpperCase().charCodeAt(0);
        if (c1 <= c2) { for (var c = c1; c <= c2; c++) add(String.fromCharCode(c)); } else { add(t); }
        return;
      }
      if (/^[a-z]$/.test(t)) t = t.toUpperCase();
      add(t.slice(0, 6));
    });
    return out;
  }

  var CN_DIGIT = { '零': 0, '〇': 0, '一': 1, '二': 2, '兩': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  function cn2num(s) {
    var n = 0, cur = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '十') { n += (cur || 1) * 10; cur = 0; }
      else if (c === '百') { n += (cur || 1) * 100; cur = 0; }
      else if (CN_DIGIT[c] !== undefined) { cur = cur * 10 + CN_DIGIT[c]; }
    }
    return n + cur;
  }

  var KNOWN_NAMES = ['非選擇題', '閱讀題組', '單選題', '多選題', '選擇題', '填充題', '素養題', '進階題', '簡答題', '非選題', '計算題', '應用題', '證明題', '基礎題', '挑戰題', '混合題', '綜合題', '閱讀題', '是非題', '配合題', '圖表題', '非選擇', '單選', '多選', '選擇', '填充', '素養', '進階', '簡答', '非選', '計算', '應用', '證明', '基礎', '挑戰', '混合', '綜合', '閱讀', '是非', '配合', '圖表', '題組', '作文'];
  var BASE_NAMES = ['單選', '多選', '選擇', '填充', '素養', '進階', '簡答', '非選擇', '非選', '計算', '應用', '證明', '基礎', '挑戰', '混合', '綜合', '閱讀', '是非', '配合', '圖表'];
  function canonName(n) { return BASE_NAMES.indexOf(n) !== -1 ? n + '題' : n; }

  var KN = KNOWN_NAMES.slice().sort(function (a, b) { return b.length - a.length; }).join('|');
  var NUMCH = '零〇一二兩三四五六七八九十百';
  var SPEECH_RE = new RegExp(
    '(' + KN + ')|(\\d+)|([' + NUMCH + ']+)|([A-Za-z])|(到|至|~|～|－|–|—|-)|((?:(?!' + KN + ')[^\\sA-Za-z\\d' + NUMCH + '到至~～－–—\\-，。、；;,.:：！!？?（）()])+)',
    'g'
  );
  var EX_G = /跳過|不含|除了|除外|不包括|不要|扣掉|排除/g;
  var FILLER_G = /然後|接著|再來|還有|以及|最後|另外|加上|共有|總共|一共|題數|題目/g;

  /* Words the phone keyboard often types when it mishears a question type, mapped to the right word.
     Longer entries first so 題主題 is fixed before 主題. */
  var MISHEAR = [
    ['題主題', '題組'], ['題組提', '題組'], ['提組', '題組'], ['題祖', '題組'], ['題族', '題組'], ['主題', '題組'],
    ['數養', '素養'], ['素樣', '素養'], ['訴養', '素養'],
    ['進接', '進階'], ['近階', '進階'], ['進街', '進階'],
    ['天衝', '填充'], ['填沖', '填充'], ['田充', '填充'], ['填衝', '填充'],
    ['宣擇', '選擇'], ['選則', '選擇']
  ];
  function fixMishear(text) {
    var out = text;
    MISHEAR.forEach(function (p) { out = out.split(p[0]).join(p[1]); });
    return out;
  }

  function compress(labels) {
    var out = [];
    var i = 0;
    while (i < labels.length) {
      var a = labels[i];
      var j = i;
      if (/^\d+$/.test(a)) {
        while (j + 1 < labels.length && /^\d+$/.test(labels[j + 1]) && parseInt(labels[j + 1], 10) === parseInt(labels[j], 10) + 1) j++;
      } else if (/^[A-Z]$/.test(a)) {
        while (j + 1 < labels.length && /^[A-Z]$/.test(labels[j + 1]) && labels[j + 1].charCodeAt(0) === labels[j].charCodeAt(0) + 1) j++;
      }
      out.push(j > i ? a + '-' + labels[j] : a);
      i = j + 1;
    }
    return out.join(', ');
  }

  /* Turns typed or dictated text such as 「單選 1 到 20，素養 A 到 E」 into [{name, nums}]. */
  function parseSpeech(text) {
    var s = String(text || '').replace(/[０-９Ａ-Ｚａ-ｚ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 65248); });
    s = fixMishear(s);
    var toks = [];
    var m;
    SPEECH_RE.lastIndex = 0;
    while ((m = SPEECH_RE.exec(s)) !== null) {
      if (m[0] === '') { SPEECH_RE.lastIndex++; continue; }
      if (m[1]) {
        toks.push({ t: 'name', v: canonName(m[1]) });
      } else if (m[2]) {
        toks.push({ t: 'num', v: parseInt(m[2], 10) });
      } else if (m[3]) {
        var n = cn2num(m[3]);
        if (n > 0) toks.push({ t: 'num', v: n });
      } else if (m[4]) {
        toks.push({ t: 'let', v: m[4].toUpperCase() });
      } else if (m[5]) {
        toks.push({ t: 'to' });
      } else if (m[6]) {
        var w = m[6];
        if (w.replace(EX_G, '') !== w) { toks.push({ t: 'ex' }); w = w.replace(EX_G, ''); }
        w = w.replace(FILLER_G, '').replace(/^[第從由共有是的和跟與及題]+/, '').replace(/[第從由共有是的和跟與及]+$/, '');
        if (w.length >= 2) toks.push({ t: 'name', v: canonName(w) });
      }
    }

    var list = [];
    var byName = {};
    var cur = null;
    var exMode = false;
    function startGroup(name) {
      if (!byName[name]) { byName[name] = { name: name, labels: [], ex: {} }; list.push(byName[name]); }
      cur = byName[name];
      exMode = false;
    }
    function put(label) {
      if (!cur) startGroup('題目');
      if (exMode) cur.ex[label] = true;
      else if (cur.labels.indexOf(label) === -1 && cur.labels.length < 100) cur.labels.push(label);
    }
    for (var i = 0; i < toks.length; i++) {
      var tk = toks[i];
      if (tk.t === 'name') { startGroup(tk.v); }
      else if (tk.t === 'ex') { exMode = true; }
      else if (tk.t === 'num' || tk.t === 'let') {
        var nx = toks[i + 1], nn = toks[i + 2];
        if (nx && nx.t === 'to' && nn && nn.t === tk.t) {
          if (tk.t === 'num') {
            var lo = Math.min(tk.v, nn.v), hi = Math.max(tk.v, nn.v);
            for (var k = lo; k <= hi && k - lo < 100; k++) put(String(k));
          } else {
            var c1 = tk.v.charCodeAt(0), c2 = nn.v.charCodeAt(0);
            for (var c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) put(String.fromCharCode(c));
          }
          i += 2;
        } else {
          put(tk.t === 'num' ? String(tk.v) : tk.v);
        }
      }
    }
    return list.map(function (g) {
      var kept = g.labels.filter(function (l) { return !g.ex[l]; });
      return { name: g.name, nums: compress(kept) };
    }).filter(function (g) { return g.nums; });
  }


  function shortName(name) {
    var t = (name || '').trim();
    if (!t) return '題型';
    return (t.length > 1 && t.slice(-1) === '題') ? t.slice(0, -1) : t;
  }

  /* ---------- 和伺服器溝通 ---------- */
  function api(path, body) {
    var opts = { method: body !== undefined ? 'POST' : 'GET', cache: 'no-store', headers: { 'x-teacher-password': encodeURIComponent(PW) } };
    if (body !== undefined) {
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(path, opts);
  }

  var GATE_MSG = {
    bad: '密碼不對，請再試一次。',
    nopw: '還沒設定老師密碼。請照 README 的步驟，在 Cloudflare 加上 TEACHER_PASSWORD。',
    nodb: '還沒綁定資料庫。請照 README 的步驟，把 D1 資料庫綁成 DB，然後重新部署。',
    net: '連不上網路，請確認網路後再試。',
    server: '伺服器出了問題，請稍後再試。'
  };

  async function login() {
    var r;
    try { r = await api('/api/login', {}); } catch (e) { return 'net'; }
    if (r.ok) return 'ok';
    if (r.status === 401) return 'bad';
    var j = {};
    try { j = await r.json(); } catch (e) {}
    if (j.error === 'no_password') return 'nopw';
    if (j.error === 'no_database') return 'nodb';
    return 'server';
  }

  function showGate(msg) {
    authed = false;
    clearTimeout(timer);
    $('#gate').hidden = false;
    $('#main').hidden = true;
    $('#gate-err').textContent = msg || '';
  }

  function enterApp() {
    authed = true;
    $('#gate').hidden = true;
    $('#main').hidden = false;
    return refresh();
  }

  $('#gate-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var typed = $('#pw').value;
    if (!typed) { $('#gate-err').textContent = '請輸入密碼。'; return; }
    var btn = $('#gate-btn');
    btn.disabled = true;
    PW = typed;
    var res = await login();
    btn.disabled = false;
    if (res === 'ok') {
      try { localStorage.setItem('rv-pw', PW); } catch (err) {}
      $('#pw').value = '';
      enterApp();
    } else {
      $('#gate-err').textContent = GATE_MSG[res] || GATE_MSG.server;
    }
  });

  /* ---------- 拿結果 ---------- */
  function schedule() {
    clearTimeout(timer);
    if (!authed || document.hidden) return;
    timer = setTimeout(refresh, R && R.open ? 3000 : 10000);
  }

  async function refresh() {
    try {
      var r = await api('/api/results');
      if (r.status === 401) { showGate('密碼已經改了，請重新輸入。'); return; }
      if (!r.ok) throw new Error('bad');
      R = await r.json();
      $('#net').textContent = '';
      onResults();
    } catch (e) {
      $('#net').textContent = '連線不穩，稍後會自動重試。';
    }
    schedule();
  }

  document.addEventListener('visibilitychange', function () { if (!document.hidden && authed) refresh(); });

  function buildQuestions() {
    questions = [];
    (R.groups || []).forEach(function (g, gi) {
      g.labels.forEach(function (label, k) {
        questions.push({ id: gi + '-' + k, idx: questions.length, gi: gi, short: shortName(g.name), label: label });
      });
    });
  }

  function summaryText() {
    if (!R || !R.groups.length) return '尚未設定';
    return R.groups.map(function (g) { return g.name + ' ' + g.labels.length + ' 題'; }).join('・');
  }

  function onResults() {
    if (doneVersion !== R.version) { done = new Set(); doneVersion = R.version; }
    buildQuestions();
    if (draftVersion !== R.version) {
      var first = draftVersion === null;
      draftVersion = R.version;
      loadDraft();
      if (first) $('#setup').open = !R.open;
    }
    renderTeacher();
  }

  /* ---------- 畫面：結果 ---------- */
  function renderTeacher() {
    $('#setup-sum').textContent = summaryText();
    $('#n-resp').textContent = R.N;
    $('#n-detail').textContent = R.good ? R.good + ' 人選「我都會了」' : (R.open ? '還沒有人送出' : '');
    $('#end-wrap').hidden = !R.open;

    var rows = questions.map(function (q) { return { q: q, c: R.counts[q.id] || 0 }; });
    var pos = rows.map(function (r) { return r.c; }).filter(function (c) { return c > 0; }).sort(function (a, b) { return b - a; });
    var thr = pos.length ? pos[Math.min(2, pos.length - 1)] : Infinity;
    var list, zero;
    if (sortMode === 'count') {
      var sorted = rows.slice().sort(function (a, b) { return (b.c - a.c) || (a.q.idx - b.q.idx); });
      list = sorted.filter(function (r) { return r.c > 0; });
      zero = sorted.filter(function (r) { return r.c === 0; });
    } else {
      list = rows;
      zero = [];
    }

    var ol = $('#rank');
    ol.textContent = '';
    if (!list.length) {
      var msg;
      if (!R.open) msg = '還沒設定考卷。先在上面說出題型和題號。';
      else if (R.N === 0) msg = '還沒有人送出。學生掃 QR code 按完送出後，這裡會即時更新。';
      else msg = '這次沒有人要問題目。';
      ol.appendChild(el('li', 'empty', msg));
    }
    list.forEach(function (r) {
      var li = el('li');
      var isDone = done.has(r.q.id);
      var btn = el('button', 'row' + (isDone ? ' done' : ''));
      btn.type = 'button';
      btn.dataset.q = r.q.id;
      btn.setAttribute('aria-pressed', isDone ? 'true' : 'false');
      var pct = R.N ? Math.round(r.c / R.N * 100) : 0;
      btn.setAttribute('aria-label', r.q.short + ' ' + r.q.label + '，' + r.c + ' 人，' + pct + '%，點一下標記已講解');
      var q = el('span', 'q');
      q.appendChild(el('span', 'q-g', r.q.short));
      q.appendChild(el('span', 'q-n', r.q.label));
      var track = el('span', 'track');
      var fill = el('span', 'fill' + (r.c > 0 && r.c >= thr ? ' hi' : ''));
      fill.style.width = (r.c > 0 ? Math.max(2, r.c / R.N * 100) : 0) + '%';
      track.appendChild(fill);
      var cnt = el('span', 'cnt');
      cnt.appendChild(el('b', null, String(r.c)));
      cnt.appendChild(el('small', null, ' 人 · ' + pct + '%'));
      btn.appendChild(q); btn.appendChild(track); btn.appendChild(cnt);
      li.appendChild(btn);
      ol.appendChild(li);
    });

    var z = $('#zero-line');
    if (zero.length && R.N > 0) {
      var names = zero.slice(0, 12).map(function (r) { return r.q.short + ' ' + r.q.label; }).join('、');
      z.textContent = '沒人選（可以跳過）：' + names + (zero.length > 12 ? '，等 ' + zero.length + ' 題' : '');
      z.hidden = false;
    } else {
      z.hidden = true;
    }
  }

  $('#rank').addEventListener('click', function (e) {
    var b = e.target.closest('.row');
    if (!b) return;
    var id = b.dataset.q;
    if (done.has(id)) done.delete(id); else done.add(id);
    b.classList.toggle('done', done.has(id));
    b.setAttribute('aria-pressed', done.has(id) ? 'true' : 'false');
  });

  function setSort(mode) {
    sortMode = mode;
    $('#sort-count').setAttribute('aria-pressed', mode === 'count' ? 'true' : 'false');
    $('#sort-num').setAttribute('aria-pressed', mode === 'num' ? 'true' : 'false');
    if (R) renderTeacher();
  }
  $('#sort-count').addEventListener('click', function () { setSort('count'); });
  $('#sort-num').addEventListener('click', function () { setSort('num'); });

  /* ---------- 會清掉資料的按鈕：要按兩次才執行 ---------- */
  function guarded(btn, idleText, needsWarning, warnText, action) {
    var t = null;
    function reset() { clearTimeout(t); delete btn.dataset.armed; btn.textContent = idleText; }
    btn.addEventListener('click', function () {
      if (busy) return;
      if (!btn.dataset.armed && R && needsWarning()) {
        btn.dataset.armed = '1';
        btn.textContent = warnText();
        t = setTimeout(reset, 5000);
        return;
      }
      reset();
      action();
    });
  }

  async function post(path, body, okMsg) {
    busy = true;
    $('#setup-msg').textContent = '處理中…';
    try {
      var r = await api(path, body);
      if (r.status === 401) { showGate('密碼已經改了，請重新輸入。'); return false; }
      if (!r.ok) {
        $('#setup-msg').textContent = r.status === 400 ? '題目格式有問題，請檢查題型名稱和題號。' : '沒成功，請稍後再試。';
        return false;
      }
      await refresh();
      $('#setup-msg').textContent = okMsg();
      return true;
    } catch (e) {
      $('#setup-msg').textContent = '連不上網路，沒成功。請確認網路後再試。';
      return false;
    } finally {
      busy = false;
    }
  }

  function hasVotes() { return R.open && R.N > 0; }
  function warnReplace() { return '目前已有 ' + R.N + ' 人回覆，再按一次會清掉'; }

  /* ---------- 說出或打出題型 ---------- */
  function previewNl() {
    var raw = $('#nl-input').value;
    var r = parseSpeech(raw);
    var p = $('#nl-preview');
    if (!r.length) {
      p.textContent = raw.trim() ? '還沒辨識到題型和題號。例：選擇 1 到 20，素養 A 到 E' : '按鍵盤上的麥克風就能語音輸入。';
      return;
    }
    p.textContent = '辨識到：' + r.map(function (g) { return g.name + ' ' + g.nums + '（' + parseNums(g.nums).length + ' 題）'; }).join('・');
  }
  $('#nl-input').addEventListener('input', previewNl);

  guarded($('#nl-apply'), '建立這次的題目', hasVotes, warnReplace, async function () {
    var r = parseSpeech($('#nl-input').value).slice(0, 6);
    if (!r.length) { previewNl(); return; }
    var groups = r.map(function (g) { return { name: g.name, labels: parseNums(g.nums) }; });
    var ok = await post('/api/setup', { groups: groups }, function () { return '已建立，共 ' + questions.length + ' 題。學生現在可以作答。'; });
    if (ok) $('#setup').open = false;
  });

  /* ---------- 手動調整 ---------- */
  function loadDraft() {
    draft = R && R.groups.length
      ? R.groups.map(function (g) { return { name: g.name, nums: compress(g.labels) }; })
      : [{ name: '選擇題', nums: '' }];
    renderSetup();
  }

  function renderSetup() {
    var box = $('#setup-rows');
    box.textContent = '';
    draft.forEach(function (g, i) {
      var row = el('div', 'grow');
      var line = el('div', 'grow-line');
      var f1 = el('div', 'field');
      var l1 = el('label', null, '題型名稱'); l1.htmlFor = 'gn-' + i;
      var in1 = el('input', 'gn'); in1.id = 'gn-' + i; in1.type = 'text'; in1.value = g.name; in1.maxLength = 12;
      f1.appendChild(l1); f1.appendChild(in1);
      var rm = el('button', 'icon-btn', '×');
      rm.type = 'button'; rm.dataset.i = String(i);
      rm.setAttribute('aria-label', '移除「' + (g.name || '這個題型') + '」');
      rm.disabled = draft.length <= 1;
      line.appendChild(f1); line.appendChild(rm);

      var f2 = el('div', 'field');
      var l2 = el('label', null, '題號'); l2.htmlFor = 'gc-' + i;
      var in2 = el('input', 'gc'); in2.id = 'gc-' + i; in2.type = 'text'; in2.value = g.nums;
      in2.placeholder = '例：1-10, 13, 15-18';
      in2.autocomplete = 'off'; in2.spellcheck = false;
      in2.setAttribute('autocapitalize', 'off');
      in2.setAttribute('aria-describedby', 'gh-' + i);
      var hint = el('p', 'hint'); hint.id = 'gh-' + i; hint.setAttribute('aria-live', 'polite');
      f2.appendChild(l2); f2.appendChild(in2); f2.appendChild(hint);

      row.appendChild(line); row.appendChild(f2);
      box.appendChild(row);
      updateHint(i);
    });
  }

  function updateHint(i) {
    var inp = document.getElementById('gc-' + i);
    var h = document.getElementById('gh-' + i);
    if (!inp || !h) return;
    var n = parseNums(inp.value).length;
    h.textContent = n ? '共 ' + n + ' 題' : '請輸入題號';
  }

  function readDraft() {
    var rows = document.querySelectorAll('#setup-rows .grow');
    return Array.prototype.map.call(rows, function (r) {
      return { name: r.querySelector('.gn').value, nums: r.querySelector('.gc').value };
    });
  }

  $('#setup-rows').addEventListener('input', function (e) {
    var t = e.target;
    if (t.classList && t.classList.contains('gc')) updateHint(parseInt(t.id.slice(3), 10));
  });
  $('#setup-rows').addEventListener('click', function (e) {
    var b = e.target.closest('.icon-btn');
    if (!b || b.disabled) return;
    draft = readDraft();
    draft.splice(parseInt(b.dataset.i, 10), 1);
    $('#setup-msg').textContent = '';
    renderSetup();
  });
  document.querySelector('.chips').addEventListener('click', function (e) {
    var b = e.target.closest('.chip');
    if (!b) return;
    draft = readDraft();
    if (draft.length >= 6) { $('#setup-msg').textContent = '最多 6 種題型。'; return; }
    var name = b.dataset.name || '';
    draft.push({ name: name, nums: '' });
    $('#setup-msg').textContent = '';
    renderSetup();
    var target = document.getElementById((name ? 'gc-' : 'gn-') + (draft.length - 1));
    if (target) target.focus();
  });

  guarded($('#apply-setup'), '套用手動調整', hasVotes, warnReplace, async function () {
    var d = readDraft();
    var groups = [];
    d.forEach(function (g, i) {
      var labels = parseNums(g.nums);
      if (!labels.length) return;
      groups.push({ name: (g.name || '').trim() || ('題型' + (i + 1)), labels: labels });
    });
    if (!groups.length) { $('#setup-msg').textContent = '至少要有一個題型，並填上題號。'; return; }
    var skipped = d.length - groups.length;
    var ok = await post('/api/setup', { groups: groups }, function () {
      return '已套用，共 ' + questions.length + ' 題。' + (skipped ? '沒填題號的 ' + skipped + ' 個題型已略過。' : '');
    });
    if (ok) $('#setup').open = false;
  });

  guarded($('#end-btn'), '結束這次檢討', hasVotes, function () { return '已有 ' + R.N + ' 人回覆，再按一次會全部清掉'; }, async function () {
    var ok = await post('/api/end', {}, function () { return '已結束，題目和回覆都清掉了。'; });
    if (ok) { $('#nl-input').value = ''; previewNl(); $('#setup').open = true; }
  });

  /* ---------- 開頭 ---------- */
  (async function start() {
    if (!PW) { showGate(''); return; }
    var res = await login();
    if (res === 'ok') { enterApp(); return; }
    showGate(res === 'bad' ? '密碼已經改了，請重新輸入。' : (GATE_MSG[res] || ''));
  })();
})();
