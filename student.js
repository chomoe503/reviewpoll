(function () {
  'use strict';

  var POLL_WAITING = 5000;   // 老師還沒開始時，每 5 秒看一次
  var POLL_OPEN = 30000;     // 題目出來後，每 30 秒看一次老師有沒有換題
  var state = null;          // { open, version, groups }
  var mine = { picks: new Set(), all: false };
  var submittedKey = null;
  var sending = false;
  var failed = false;
  var timer = null;

  function $(s) { return document.querySelector(s); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* 這支手機的代號：隨機產生，只用來讓同一人重送時覆蓋舊的，不含任何個人資料 */
  function randomId() {
    var a = new Uint8Array(12);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  var CLIENT = null;
  try { CLIENT = localStorage.getItem('rv-client'); } catch (e) {}
  if (!CLIENT) {
    CLIENT = randomId();
    try { localStorage.setItem('rv-client', CLIENT); } catch (e) {}
  }

  function saveLocal() {
    if (!state) return;
    try {
      localStorage.setItem('rv-pick-' + state.version, JSON.stringify({
        picks: Array.from(mine.picks), all: mine.all, sent: submittedKey
      }));
    } catch (e) {}
  }
  function loadLocal() {
    mine = { picks: new Set(), all: false };
    submittedKey = null;
    if (!state) return;
    try {
      var raw = localStorage.getItem('rv-pick-' + state.version);
      if (!raw) return;
      var d = JSON.parse(raw);
      mine.picks = new Set(d.picks || []);
      mine.all = !!d.all;
      submittedKey = d.sent || null;
    } catch (e) {}
  }

  function key() { return mine.all ? 'ok' : Array.from(mine.picks).sort().join(','); }

  function summaryText() {
    return state.groups.map(function (g) { return g.name + ' ' + g.labels.length + ' 題'; }).join('・');
  }
  function shortName(n) {
    var t = (n || '').trim();
    return (t.length > 1 && t.slice(-1) === '題') ? t.slice(0, -1) : t;
  }

  function renderGrid() {
    var box = $('#groups');
    box.textContent = '';
    state.groups.forEach(function (g, gi) {
      var sec = el('div', 'group');
      var head = el('div', 'group-head');
      head.appendChild(el('h3', null, g.name));
      head.appendChild(el('span', 'meta', '共 ' + g.labels.length + ' 題'));
      var grid = el('div', 'bubbles');
      g.labels.forEach(function (label, k) {
        var b = el('button', 'bubble' + (label.length > 5 ? ' xlong' : label.length > 3 ? ' long' : ''), label);
        b.type = 'button';
        b.dataset.q = gi + '-' + k;
        b.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-label', g.name + ' 第 ' + label + ' 題');
        grid.appendChild(b);
      });
      sec.appendChild(head);
      sec.appendChild(grid);
      box.appendChild(sec);
    });
    $('#exam-meta').textContent = summaryText();
  }

  function sync() {
    document.querySelectorAll('#groups .bubble').forEach(function (b) {
      b.setAttribute('aria-pressed', mine.picks.has(b.dataset.q) ? 'true' : 'false');
    });
    $('#all-good').setAttribute('aria-pressed', mine.all ? 'true' : 'false');
    var n = mine.picks.size;
    $('#picked').textContent = mine.all ? '我都會了' : n + ' 題想問';
    var can = mine.all || n > 0;
    var k = key();
    var btn = $('#submit-btn');
    var st = $('#submit-state');
    if (sending) {
      btn.textContent = '送出中…'; btn.disabled = true; st.textContent = '';
    } else if (!can) {
      btn.textContent = '送出'; btn.disabled = true;
      st.textContent = '先點題號，或按「我都會了」';
    } else if (failed) {
      btn.textContent = '再送一次'; btn.disabled = false;
      st.textContent = '沒送出去，請確認網路後再按一次';
    } else if (submittedKey === k) {
      btn.textContent = '已送出'; btn.disabled = true;
      st.textContent = '已送出，匿名';
    } else {
      btn.textContent = submittedKey === null ? '送出' : '更新回覆';
      btn.disabled = false;
      st.textContent = submittedKey === null ? '選好後按送出' : '有改動，按更新回覆';
    }
  }

  function render() {
    var isOpen = !!(state && state.open);
    $('#exam').hidden = !isOpen;
    $('#wait').hidden = isOpen;
    $('#submit-bar').hidden = !isOpen;
    if (!isOpen) {
      $('#wait-title').textContent = state ? '老師還沒開始' : '正在連線…';
      $('#wait-text').textContent = state ? '老師設定好這次的題目後，這裡就會出現題號。' : '';
      return;
    }
    renderGrid();
    sync();
  }

  function apply(s) {
    var changed = !state || state.version !== s.version || state.open !== s.open;
    state = s;
    if (changed) {
      failed = false;
      loadLocal();
      render();
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (document.hidden) return;
    timer = setTimeout(load, state && state.open ? POLL_OPEN : POLL_WAITING);
  }

  function load() {
    fetch('/api/state', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('bad'); return r.json(); })
      .then(function (s) { apply(s); })
      .catch(function () {
        if (!state) {
          $('#wait-title').textContent = '連不上網路';
          $('#wait-text').textContent = '請確認手機有網路。畫面會自動重試。';
        }
      })
      .then(schedule);
  }

  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });

  $('#groups').addEventListener('click', function (e) {
    var b = e.target.closest('.bubble');
    if (!b || !state || !state.open) return;
    var id = b.dataset.q;
    mine.all = false;
    failed = false;
    if (mine.picks.has(id)) mine.picks.delete(id); else mine.picks.add(id);
    saveLocal();
    sync();
  });
  $('#all-good').addEventListener('click', function () {
    if (!state || !state.open) return;
    mine.all = !mine.all;
    failed = false;
    if (mine.all) mine.picks.clear();
    saveLocal();
    sync();
  });

  $('#submit-btn').addEventListener('click', function () {
    if (sending || !state || !state.open || !(mine.all || mine.picks.size)) return;
    sending = true;
    failed = false;
    sync();
    var sentKey = key();
    fetch('/api/vote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client: CLIENT, version: state.version, all: mine.all, picks: Array.from(mine.picks) })
    }).then(function (r) {
      if (r.status === 409) { sending = false; load(); return; }   // 老師剛換了題目
      if (!r.ok) throw new Error('bad');
      submittedKey = sentKey;
      saveLocal();
      sending = false;
      sync();
    }).catch(function () {
      sending = false;
      failed = true;
      sync();
    });
  });

  render();
  load();
})();
