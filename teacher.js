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
  var cards = [];             // 題型卡片（老師正在編輯的這份考卷）
  var cardsDirty = false;     // 卡片有沒有被手動改過（「填入卡片」要取代之前，先提醒）
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
  var NUMCH = '零〇一二兩三四五六七八九十百';
  var CN_RUN = new RegExp('[' + NUMCH + ']+', 'g');
  /* 「二十一」→「21」，這樣後面只需要處理阿拉伯數字 */
  function cnToDigits(s) {
    return s.replace(CN_RUN, function (m) { var n = cn2num(m); return n > 0 ? String(n) : m; });
  }

  /* 題型下拉選單的選項（最後還有一個「自訂」） */
  var TYPE_LIST = ['單選題', '多選題', '選擇題', '填充題', '題組', '混合題', '素養題', '閱讀題', '進階題', '簡答題', '計算題', '非選擇題'];

  var KNOWN_NAMES = ['非選擇題', '閱讀題組', '單選題', '多選題', '選擇題', '填充題', '素養題', '進階題', '簡答題', '非選題', '計算題', '應用題', '證明題', '基礎題', '挑戰題', '混合題', '綜合題', '閱讀題', '是非題', '配合題', '圖表題', '非選擇', '單選', '多選', '選擇', '填充', '素養', '進階', '簡答', '非選', '計算', '應用', '證明', '基礎', '挑戰', '混合', '綜合', '閱讀', '是非', '配合', '圖表', '題組', '作文'];
  var BASE_NAMES = ['單選', '多選', '選擇', '填充', '素養', '進階', '簡答', '非選擇', '非選', '計算', '應用', '證明', '基礎', '挑戰', '混合', '綜合', '閱讀', '是非', '配合', '圖表'];
  function canonName(n) { return BASE_NAMES.indexOf(n) !== -1 ? n + '題' : n; }
  function isKnownName(n) { return KNOWN_NAMES.indexOf(n) !== -1 || BASE_NAMES.indexOf(n.replace(/題$/, '')) !== -1; }

  /* 手機鍵盤常把題型打錯的字，對應到正確的字。長的放前面，這樣「題主題」會先被修正。 */
  var MISHEAR = [
  ['題主題', '題組'], ['題組提', '題組'], ['提組', '題組'], ['題祖', '題組'], ['題族', '題組'], ['主題', '題組'],
  ['數量其', '素養題'], ['數養', '素養'], ['素樣', '素養'], ['訴養', '素養'],
  ['進接', '進階'], ['近階', '進階'], ['進街', '進階'],
  ['天衝', '填充'], ['填沖', '填充'], ['田充', '填充'], ['填衝', '填充'],
  ['宣擇', '選擇'], ['選則', '選擇'],
  ['小提', '小題'], ['小體', '小題'], ['消題', '小題']
];

/* ② 兩個字的題型名稱：['正確的詞', '第一個字常被聽成的字', '第二個字常被聽成的字']。
   聽錯的字（同音、音調不同、ㄑ和ㄊ這類相近的音）全部放進引號裡，字和字中間不用加逗號。
   兩個位置的字會互相搭配，所有組合都會換回正確的詞，例如「速氧」「數羊」「蘇量」都會變回「素養」。 */
var SOUNDS = [
  ['素養', '數速訴塑蘇酥宿肅粟樹述術束', '氧羊陽洋揚仰樣癢楊漾量良涼亮'],
  ['進階', '近盡晉浸禁金今', '接街節結捷揭皆潔切'],
  ['填充', '天田甜添恬前錢', '衝沖蟲重崇'],
  ['選擇', '宣懸旋玄眩軒', '則澤責'],
  ['單選', '丹蛋但淡彈擔', '宣懸旋玄眩軒'],
  ['多選', '朵躲奪哆', '宣懸旋玄眩軒'],
  ['題組', '提體梯啼蹄騎期其奇旗齊棋', '祖族租足'],
  ['小題', '笑校曉消肖效', '提體梯啼蹄騎期其奇旗齊棋'],
  ['閱讀', '月越悅岳', '毒獨度督'],
  ['混合', '魂婚', '和河何荷禾'],
  ['簡答', '檢減剪', '達搭打'],
  ['計算', '記既繼技', '酸蒜']
];

/* ③ 「題」被聽成別的字（出現在題型名稱或數字後面）。
   TI_WRONG：一定是「題」的同音字，一律換回「題」。
   TI_MAYBE：ㄑ和ㄊ容易混的字（騎期其奇…），也可能是別的詞（例如「其他」），
             所以只有後面是標點、結尾、數字、「的、有、從、到、第」或下一個題型時才換。 */
var TI_WRONG = '提體梯啼蹄';
var TI_MAYBE = '騎期其奇旗齊棋';
var NAME_START = '單多選填素進簡非計應證基挑混綜閱是配圖作';   // 題型名稱的第一個字
var TI_END = '(?=$|[\\s，。、；;,.:：！!？?\\d的有從到至第和跟與及' + NAME_START + '])';
var BASE_TI = new RegExp('(' + BASE_NAMES.join('|') + ')(?:[' + TI_WRONG + ']|[' + TI_MAYBE + ']' + TI_END + ')', 'g');
var NUM_TI = new RegExp('(\\d)\\s*(?:[' + TI_WRONG + ']|[' + TI_MAYBE + ']' + TI_END + ')', 'g');

var SOUND_FIX = SOUNDS.map(function (e) {
  return { re: new RegExp('[' + e[0].charAt(0) + e[1] + '][' + e[0].charAt(1) + e[2] + ']', 'g'), word: e[0] };
});
function fixMishear(text) {
  var out = text;
  MISHEAR.forEach(function (p) { out = out.split(p[0]).join(p[1]); });
  SOUND_FIX.forEach(function (f) { out = out.replace(f.re, f.word); });
  return out.replace(BASE_TI, '$1題').replace(NUM_TI, '$1題');
}

  var KN = KNOWN_NAMES.slice().sort(function (a, b) { return b.length - a.length; }).join('|');
  var SPEECH_RE = new RegExp(
    '(' + KN + ')|(\\d+)|([' + NUMCH + ']+)|([A-Za-z])|(到|至|~|～|－|–|—|-)|((?:(?!' + KN + ')[^\\s\\u0001\\u0002A-Za-z\\d' + NUMCH + '到至~～－–—\\-，。、；;,.:：！!？?（）()])+)|(\\u0001\\d+\\u0002)',
    'g'
  );
  var EX_G = /跳過|不含|除了|除外|不包括|不要|扣掉|排除/g;
  var FILLER_G = /然後|接著|再來|還有|以及|最後|另外|加上|共有|總共|一共|題數|題目/g;

  /* 「第 1 題有 3 個小題」。標點、「底下／裡面／共有」、「個／各」、錯置的逗號都容許。 */
  var P = '[\\s，。、；;,.:：！!？?]*';
  var SUB_RE = new RegExp('[第弟]' + P + '(\\d+)' + P + '題([^第弟\\d]{0,8}?)(?:有|又|友|共有|分成|分為|分作)' + P + '(\\d+)[^\\d第弟有]{0,2}?小' + P + '題', 'g');
  function extractSubs(s) {
    var subs = [];
    var out = s.replace(SUB_RE, function (all, n, filler, m) {
      subs.push({ n: parseInt(n, 10), m: parseInt(m, 10), text: all.replace(/[\s，。、；;,.:：！!？?]+/g, '') });
      return ' \u0001' + (subs.length - 1) + '\u0002 ';
    });
    return { text: out, subs: subs };
  }

  function isTi(s, idx) { return s.charAt(idx) === '題' && s.substr(idx, 2) !== '題組'; }

  /* ===== 題型卡片 =====
     一張卡片 = { type, custom, warn, ranges:[{from,to}], uni, subs:[{q,n}] }
       type    題型下拉選單的值（TYPE_LIST 其中一個，或「自訂」）
       custom  type 是「自訂」時的名稱
       warn    名稱是聽出來的、不在常用清單，要請老師確認
       ranges  題號的幾段，「從 from 到 to」；to 空白或和 from 一樣就是只有一題
       uni     「每題都有 uni 個小題」
       subs    「指定第 q 題有 n 個小題」，優先於 uni，n 填 0 代表這題沒有小題
     小題的題號寫成 1(1)、1(2)。 */

  var MAX_PER_GROUP = 100;   // 要和 _worker.js 的 MAX_LABELS 一致
  var MAX_SUB = 30;

  /* 題號整理：去掉空白；數字去掉前面的 0；單一英文字母轉大寫 */
  function normLabel(s) {
    var t = String(s == null ? '' : s).replace(/\s+/g, '');
    if (/^\d+$/.test(t)) return String(parseInt(t, 10));
    if (/^[A-Za-z]$/.test(t)) return t.toUpperCase();
    return t;
  }

  /* 「從 a 到 b」變成題號清單 → { list, note } */
  function expandRange(r) {
    var a = normLabel(r && r.from), b = normLabel(r && r.to);
    if (!a && !b) return { list: [], note: '' };
    if (!a || !b || a === b) return { list: [(a || b).slice(0, 4)], note: '' };
    var out = [];
    if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
      var lo = Math.min(+a, +b), hi = Math.max(+a, +b);
      for (var k = lo; k <= hi && out.length < MAX_PER_GROUP; k++) out.push(String(k));
      return { list: out, note: hi - lo + 1 > MAX_PER_GROUP ? '一段最多 ' + MAX_PER_GROUP + ' 題，後面的略過' : '' };
    }
    if (/^[A-Z]$/.test(a) && /^[A-Z]$/.test(b)) {
      for (var c = Math.min(a.charCodeAt(0), b.charCodeAt(0)); c <= Math.max(a.charCodeAt(0), b.charCodeAt(0)); c++) out.push(String.fromCharCode(c));
      return { list: out, note: '' };
    }
    return { list: [], note: '「' + a + '」到「' + b + '」不是有效的範圍（兩邊要都是數字，或都是一個英文字母）' };
  }

  function subCount(v, notes, what) {
    var raw = String(v == null ? '' : v).trim();
    if (raw === '') return 0;
    var n = parseInt(raw, 10);
    if (!(n >= 1)) return 0;
    if (n > MAX_SUB) { notes.push(what + '的小題數最多 ' + MAX_SUB + ' 個，已改成 ' + MAX_SUB); return MAX_SUB; }
    return n;
  }

  /* 一張卡片 → { labels, notes }。labels 是學生按鈕上看到的題號。 */
  function cardLabels(card) {
    var notes = [], base = [], seen = {};
    (card.ranges || []).forEach(function (r) {
      var e = expandRange(r);
      if (e.note) notes.push(e.note);
      e.list.forEach(function (l) { if (!seen[l]) { seen[l] = true; base.push(l); } });
    });

    var over = {};
    (card.subs || []).forEach(function (s) {
      var q = normLabel(s && s.q);
      var nRaw = String(s && s.n != null ? s.n : '').trim();
      if (!q && nRaw === '') return;                       // 整列空白，略過
      if (!q) { notes.push('有一列「指定某題有小題」沒填第幾題'); return; }
      if (nRaw === '') { notes.push('第 ' + q + ' 題沒填小題數（填 0 代表沒有小題）'); return; }
      if (Object.prototype.hasOwnProperty.call(over, q)) notes.push('第 ' + q + ' 題指定了兩次，以後面的為準');
      over[q] = subCount(nRaw, notes, '第 ' + q + ' 題');
    });
    var uni = subCount(card.uni, notes, '「每題都有」');

    var labels = [];
    base.forEach(function (b) {
      var n = Object.prototype.hasOwnProperty.call(over, b) ? over[b] : uni;
      if (n >= 1) { for (var k = 1; k <= n; k++) labels.push(b + '(' + k + ')'); }
      else labels.push(b);
    });
    Object.keys(over).forEach(function (q) {
      if (!seen[q] && over[q] >= 1) notes.push('第 ' + q + ' 題不在題號範圍內，那一列沒有用到');
    });
    if (labels.length > MAX_PER_GROUP) {
      notes.push('超過 ' + MAX_PER_GROUP + ' 個題號，只會用前 ' + MAX_PER_GROUP + ' 個');
      labels = labels.slice(0, MAX_PER_GROUP);
    }
    return { labels: labels, notes: notes };
  }

  function cardName(card) { return (card.type === '自訂' ? String(card.custom || '') : card.type).trim(); }

  /* 把題號清單寫成一行文字，連續的數字（或英文字母）合成 1~20。limit 是字數上限，太長會加「…」。 */
  function describe(labels, limit) {
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
      out.push(j > i ? a + '~' + labels[j] : a);
      i = j + 1;
    }
    var s = '';
    for (var k = 0; k < out.length; k++) {
      var next = (s ? s + ', ' : '') + out[k];
      if (limit && k > 0 && next.length > limit) return s + ', …';
      s = next;
    }
    return s;
  }

  /* 連續的題號合成「從到」幾段 */
  function runsOf(bases) {
    var out = [];
    var i = 0;
    while (i < bases.length) {
      var a = bases[i];
      var j = i;
      if (/^\d+$/.test(a)) {
        while (j + 1 < bases.length && /^\d+$/.test(bases[j + 1]) && parseInt(bases[j + 1], 10) === parseInt(bases[j], 10) + 1) j++;
      } else if (/^[A-Z]$/.test(a)) {
        while (j + 1 < bases.length && /^[A-Z]$/.test(bases[j + 1]) && bases[j + 1].charCodeAt(0) === bases[j].charCodeAt(0) + 1) j++;
      }
      out.push({ from: a, to: bases[j] });
      i = j + 1;
    }
    return out;
  }

  /* 題型名稱 + 題號 + 每題的小題數 → 一張卡片。counts: { 題號: 小題數 } */
  function makeCard(name, warn, bases, counts) {
    var inList = TYPE_LIST.indexOf(name) !== -1;
    var ns = bases.map(function (b) { return counts[b] || 0; });
    var uni = 0, subs = [];
    if (bases.length >= 2 && ns[0] >= 1 && ns.every(function (n) { return n === ns[0]; })) uni = ns[0];
    else bases.forEach(function (b, i) { if (ns[i] >= 1) subs.push({ q: b, n: String(ns[i]) }); });
    return {
      type: inList ? name : '自訂',
      custom: inList ? '' : String(name).slice(0, 12),
      warn: !!warn,
      ranges: runsOf(bases),
      uni: uni ? String(uni) : '',
      subs: subs
    };
  }

  /* 伺服器上已經建好的題號（含 1(1) 這種小題）→ 卡片，讓老師能接著修改 */
  function cardFromLabels(name, labels) {
    var bases = [], counts = {}, seen = {};
    labels.forEach(function (l) {
      var m = /^(.+)\((\d+)\)$/.exec(l);
      var b = m ? m[1] : l;
      if (!seen[b]) { seen[b] = true; bases.push(b); }
      if (m) counts[b] = (counts[b] || 0) + 1;
    });
    return makeCard(name, false, bases, counts);
  }

  /* 把打出來或說出來的文字整理成 { groups: [{ name, known, card, labels }], notes: [提醒] }。
     建議念法：「單選題，1~20題。」「填充題的第1題有3個小題。」 */
  function parseSpeech(text) {
    var s = String(text || '').replace(/[０-９Ａ-Ｚａ-ｚ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 65248); });
    s = fixMishear(cnToDigits(s));
    var notes = [];
    var ex = extractSubs(s);
    var subs = ex.subs;
    // 提到「小題」但沒聽懂的句子整句略過，避免亂加題號
    s = ex.text.split(/([。；;\n])/).map(function (seg) {
      if (!/小\s*題/.test(seg)) return seg;
      notes.push('「' + seg.replace(/\u0001\d+\u0002/g, '…').replace(/\s+/g, ' ').trim().slice(0, 30) + '」這句沒聽懂，整句略過');
      return ' ';
    }).join('');

    var toks = [];
    var m;
    SPEECH_RE.lastIndex = 0;
    while ((m = SPEECH_RE.exec(s)) !== null) {
      if (m[0] === '') { SPEECH_RE.lastIndex++; continue; }
      var after = SPEECH_RE.lastIndex;
      if (m[1]) {
        toks.push({ t: 'name', v: canonName(m[1]) });
      } else if (m[2]) {
        toks.push({ t: 'num', v: parseInt(m[2], 10), ti: isTi(s, after) });
      } else if (m[3]) {
        var n = cn2num(m[3]);
        if (n > 0) toks.push({ t: 'num', v: n, ti: isTi(s, after) });
      } else if (m[4]) {
        toks.push({ t: 'let', v: m[4].toUpperCase() });
      } else if (m[5]) {
        toks.push({ t: 'to' });
      } else if (m[6]) {
        var w = m[6];
        if (w.replace(EX_G, '') !== w) { toks.push({ t: 'ex' }); w = w.replace(EX_G, ''); }
        w = w.replace(FILLER_G, '').replace(/^[第從由共有是的和跟與及題]+/, '').replace(/[第從由共有是的和跟與及]+$/, '');
        if (w.length >= 2) toks.push({ t: 'name', v: canonName(w) });
      } else if (m[7]) {
        toks.push({ t: 'sub', v: subs[parseInt(m[7].slice(1, -1), 10)] });
      }
    }

    var list = [];
    var byName = {};
    var cur = null;
    var exMode = false;
    function startGroup(name) {
      if (!byName[name]) { byName[name] = { name: name, labels: [], ex: {}, subs: {} }; list.push(byName[name]); }
      cur = byName[name];
      exMode = false;
    }
    function put(label) {
      if (!cur) startGroup('題目');
      if (exMode) cur.ex[label] = true;
      else if (cur.labels.indexOf(label) === -1 && cur.labels.length < MAX_PER_GROUP) cur.labels.push(label);
    }
    for (var i = 0; i < toks.length; i++) {
      var tk = toks[i];
      if (tk.t === 'name') { startGroup(tk.v); }
      else if (tk.t === 'ex') { exMode = true; }
      else if (tk.t === 'sub') {
        if (!cur) notes.push('「' + tk.v.text + '」前面沒有題型名稱');
        else cur.subs[tk.v.n] = tk.v.m;
      }
      else if (tk.t === 'num' || tk.t === 'let') {
        var pv = toks[i - 1], nx = toks[i + 1], nn = toks[i + 2];
        if (nx && nx.t === 'to' && nn && nn.t === tk.t) {
          if (tk.t === 'num') {
            var lo = Math.min(tk.v, nn.v), hi = Math.max(tk.v, nn.v);
            for (var k = lo; k <= hi && k - lo < MAX_PER_GROUP; k++) put(String(k));
          } else {
            var c1 = tk.v.charCodeAt(0), c2 = nn.v.charCodeAt(0);
            for (var c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) put(String.fromCharCode(c));
          }
          i += 2;
        } else if (tk.t === 'num' && tk.ti && cur && cur.labels.length === 0 && !exMode && !(pv && pv.t === 'to')) {
          // 「單選題 20 題」是共 20 題，題號 1 到 20
          for (var q = 1; q <= Math.min(tk.v, MAX_PER_GROUP); q++) put(String(q));
        } else {
          put(tk.t === 'num' ? String(tk.v) : tk.v);
        }
      }
    }

    var groups = [];
    list.forEach(function (g) {
      var kept = g.labels.filter(function (l) { return !g.ex[l]; });
      var pending = Object.keys(g.subs);
      var known = isKnownName(g.name);
      if (!kept.length) {
        if (known || pending.length) notes.push('「' + g.name + '」沒有聽到題號' + (pending.length ? '，它的小題句沒有用到' : ''));
        return;
      }
      var counts = {};
      kept.forEach(function (l) {
        if (!/^\d+$/.test(l)) return;
        var key = parseInt(l, 10);
        if (g.subs[key] === undefined) return;
        var cnt = g.subs[key];
        if (cnt >= 1 && cnt <= MAX_SUB) counts[l] = cnt;
        else if (cnt > MAX_SUB) notes.push('「' + g.name + '」第 ' + l + ' 題的小題超過 ' + MAX_SUB + ' 個，那句沒有用到');
        delete g.subs[key];
      });
      Object.keys(g.subs).forEach(function (n) {
        notes.push('「' + g.name + '」沒有第 ' + n + ' 題，那句小題沒有用到');
      });
      var card = makeCard(g.name, !known, kept, counts);
      groups.push({ name: g.name, known: known, card: card, labels: cardLabels(card).labels });
    });
    return { groups: groups, notes: notes };
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
    // 有 1(1)、10(10) 這種比較長的題號時，題號欄要加寬
    ol.className = 'rank' + (questions.some(function (q) { return q.label.length > 3; }) ? ' wide' : '');
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

  /* ---------- 快速填表：用講的或打字 ---------- */
  var EXAMPLE = '單選題，1~20題。填充題，1~2題。素養題，1~5題。填充題的第1題有3個小題。填充題的第2題有2個小題。素養題的第5題有2個小題。';
  var nlInput = $('#nl-input');
  var nlMsg = $('#nl-msg');

  guarded($('#nl-example'), '帶入範例', function () { return nlInput.value.trim() !== ''; }, function () { return '輸入框有字，再按一次會換成範例'; }, function () {
    nlInput.value = EXAMPLE;
    nlMsg.textContent = '範例放進去了。按「填入卡片」看看。改成你自己的題型和數字就能用。';
  });

  guarded($('#nl-fill'), '填入卡片', function () { return cards.length > 0 && cardsDirty; }, function () { return '卡片有手動改過，再按一次會換掉'; }, function () {
    var raw = nlInput.value;
    if (!raw.trim()) { nlMsg.textContent = '輸入框是空的。先念（或打字）題型和題號，例：單選題，1~20題。'; return; }
    var res = parseSpeech(raw);
    var notes = res.notes.slice();
    if (!res.groups.length) {
      nlMsg.textContent = '還沒辨識到題型和題號。例：單選題，1~20題。' + (notes.length ? '\n⚠ ' + notes.join('\n⚠ ') : '');
      return;
    }
    if (res.groups.length > 6) notes.push('題型超過 6 種，只放前 6 種');
    cards = res.groups.slice(0, 6).map(function (g) { return g.card; });
    cardsDirty = false;
    renderCards();
    nlMsg.textContent = '已填入 ' + cards.length + ' 張卡片。請往下檢查，要改的直接用選單或數字改。' + (notes.length ? '\n⚠ ' + notes.join('\n⚠ ') : '');
    $('#cards-title').scrollIntoView({ block: 'start' });
  });

  /* 念一句：瀏覽器內建的語音辨識（Android 的 Chrome 可以用）。不支援的瀏覽器會看不到這顆按鈕。 */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var rec = null;
  var micTimer = null;
  var MIC_IDLE = '念一句';
  var MIC_ERR = {
    'not-allowed': '麥克風沒有開。請到瀏覽器的「網站設定」允許麥克風，再按一次。',
    'service-not-allowed': '麥克風沒有開。請到瀏覽器的「網站設定」允許麥克風，再按一次。',
    'no-speech': '沒聽到聲音。再按一次，靠近手機念。',
    'audio-capture': '找不到麥克風。',
    'network': '語音辨識需要網路，目前連不上。',
    'language-not-supported': '這個瀏覽器不支援中文語音辨識，請改用鍵盤上的麥克風。'
  };

  function setMic(on) {
    var b = $('#mic');
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    $('#mic-label').textContent = on ? '聽著…念完會自動停' : MIC_IDLE;
  }

  /* 把念出來的句子接在輸入框後面，句子之間補上「。」 */
  function appendSpoken(text) {
    var t = String(text).trim();
    if (!t) return false;
    var cur = nlInput.value;
    if (cur.trim() && !/[。；;\n，,.!！?？]\s*$/.test(cur)) cur += '。';
    if (!/[。；;，,.!！?？]$/.test(t)) t += '。';
    nlInput.value = cur + t;
    return true;
  }

  function listen() {
    var r;
    try { r = new SR(); } catch (e) { nlMsg.textContent = '這個瀏覽器不能用語音輸入，請改用鍵盤上的麥克風。'; return; }
    r.lang = 'zh-TW';
    r.continuous = false;
    r.interimResults = false;
    r.maxAlternatives = 1;
    var finalText = '', lastText = '', error = '';
    r.onresult = function (ev) {
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var item = ev.results[i];
        if (!item || !item[0]) continue;
        lastText = item[0].transcript;
        if (item.isFinal) finalText += item[0].transcript;
      }
    };
    r.onerror = function (ev) { error = ev && ev.error ? ev.error : 'unknown'; };
    r.onend = function () {
      clearTimeout(micTimer);
      rec = null;
      setMic(false);
      if (error && error !== 'aborted') {
        nlMsg.textContent = MIC_ERR[error] || ('語音辨識沒成功（' + error + '）。改用鍵盤上的麥克風也可以。');
        return;
      }
      if (appendSpoken(finalText || lastText)) {
        nlMsg.textContent = '已加到輸入框：「' + (finalText || lastText).trim() + '」。可以再按一次繼續念，念完按「填入卡片」。';
      } else {
        nlMsg.textContent = '沒聽到內容，再按一次。';
      }
    };
    rec = r;
    nlMsg.textContent = '';
    setMic(true);
    try {
      r.start();
    } catch (e) {
      rec = null;
      setMic(false);
      nlMsg.textContent = '語音輸入啟動失敗，請再按一次，或改用鍵盤上的麥克風。';
      return;
    }
    micTimer = setTimeout(function () { try { r.stop(); } catch (e) {} }, 20000);
  }

  if (SR) {
    $('#mic').hidden = false;
    $('#nl-help').textContent = '按「念一句」，一次念一句；或用手機鍵盤上的麥克風。念完按「填入卡片」。';
    $('#mic').addEventListener('click', function () {
      if (rec) { try { rec.stop(); } catch (e) {} return; }
      listen();
    });
  }

  /* ---------- 題型卡片 ---------- */
  function loadDraft() {
    cards = (R && R.groups.length)
      ? R.groups.slice(0, 6).map(function (g) { return cardFromLabels(g.name, g.labels); })
      : [];
    cardsDirty = false;
    renderCards();
  }

  function numInput(cls, value, label, ph) {
    var i = el('input', 'num ' + cls);
    i.type = 'text';
    i.inputMode = 'numeric';
    i.maxLength = 4;
    i.value = value;
    i.autocomplete = 'off';
    i.spellcheck = false;
    i.setAttribute('aria-label', label);
    if (ph) i.placeholder = ph;
    return i;
  }
  function xBtn(cls, label, disabled) {
    var b = el('button', 'icon-btn sm ' + cls, '×');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.disabled = !!disabled;
    return b;
  }
  function textBtn(cls, text) {
    var b = el('button', 'ghost ' + cls, text);
    b.type = 'button';
    return b;
  }

  function buildCard(c, i) {
    var n = i + 1;
    var card = el('div', 'tcard');
    card.dataset.i = String(i);

    var head = el('div', 'tcard-head');
    var f = el('div', 'field');
    var lb = el('label', null, '題型 ' + n); lb.htmlFor = 'ct-' + i;
    var sel = el('select', 'c-type'); sel.id = 'ct-' + i;
    TYPE_LIST.concat(['自訂']).forEach(function (t) {
      var o = el('option', null, t); o.value = t;
      if (t === c.type) o.selected = true;
      sel.appendChild(o);
    });
    f.appendChild(lb); f.appendChild(sel);
    var del = el('button', 'icon-btn c-del', '×');
    del.type = 'button';
    del.setAttribute('aria-label', '移除第 ' + n + ' 張卡片');
    head.appendChild(f); head.appendChild(del);
    card.appendChild(head);

    if (c.type === '自訂') {
      var cf = el('div', 'field');
      var cl = el('label', null, '題型名稱'); cl.htmlFor = 'cc-' + i;
      var ci = el('input', 'c-custom'); ci.id = 'cc-' + i; ci.type = 'text'; ci.maxLength = 12; ci.value = c.custom; ci.autocomplete = 'off';
      cf.appendChild(cl); cf.appendChild(ci);
      var ch = el('p', 'hint c-namewarn', '⚠ 這個名稱不是常用題型，請確認');
      ch.hidden = !c.warn;
      cf.appendChild(ch);
      card.appendChild(cf);
    }

    var rg = el('div', 'blk');
    rg.appendChild(el('span', 'lab', '題號（不連續就再加一段）'));
    c.ranges.forEach(function (r, k) {
      var row = el('div', 'rrow'); row.dataset.k = String(k);
      row.appendChild(el('span', null, '從'));
      row.appendChild(numInput('c-from', r.from, '第 ' + (k + 1) + ' 段，從第幾題'));
      row.appendChild(el('span', null, '到'));
      row.appendChild(numInput('c-to', r.to, '第 ' + (k + 1) + ' 段，到第幾題'));
      row.appendChild(xBtn('c-rdel', '移除第 ' + (k + 1) + ' 段', c.ranges.length <= 1));
      rg.appendChild(row);
    });
    rg.appendChild(textBtn('c-radd', '＋加一段'));
    card.appendChild(rg);

    var sg = el('div', 'blk');
    sg.appendChild(el('span', 'lab', '小題（沒有就不用填）'));
    var urow = el('div', 'rrow');
    urow.appendChild(el('span', null, '每題都有'));
    urow.appendChild(numInput('c-uni', c.uni, '每題都有幾個小題', '0'));
    urow.appendChild(el('span', null, '個小題'));
    sg.appendChild(urow);
    c.subs.forEach(function (s, k) {
      var row = el('div', 'rrow'); row.dataset.k = String(k);
      row.appendChild(el('span', null, '第'));
      row.appendChild(numInput('c-sq', s.q, '指定第幾題'));
      row.appendChild(el('span', null, '題有'));
      row.appendChild(numInput('c-sn', s.n, '這題有幾個小題'));
      row.appendChild(el('span', null, '個小題'));
      row.appendChild(xBtn('c-sdel', '移除這一列', false));
      sg.appendChild(row);
    });
    sg.appendChild(textBtn('c-sadd', '＋指定某題有小題'));
    sg.appendChild(el('p', 'hint', '指定的題優先；填 0 代表那題沒有小題。'));
    card.appendChild(sg);

    var res = el('p', 'result'); res.id = 'cr-' + i; res.setAttribute('aria-live', 'polite');
    var wn = el('p', 'cwarn'); wn.id = 'cw-' + i;
    card.appendChild(res); card.appendChild(wn);
    return card;
  }

  function updateResult(i) {
    var c = cards[i];
    var out = document.getElementById('cr-' + i);
    var wn = document.getElementById('cw-' + i);
    if (!c || !out || !wn) return;
    var info = cardLabels(c);
    out.textContent = info.labels.length
      ? '會產生：' + describe(info.labels, 70) + '（共 ' + info.labels.length + ' 題）'
      : '還沒有題號。請在「題號」填從幾題到幾題。';
    var notes = info.notes.slice();
    if (c.type === '自訂' && !cardName(c) && info.labels.length) notes.push('請填題型名稱');
    wn.textContent = notes.length ? '⚠ ' + notes.join('\n⚠ ') : '';
    wn.hidden = !notes.length;
  }

  function updateCardsSum() {
    var p = $('#cards-sum');
    var groups = 0, total = 0, seen = {}, dup = false;
    cards.forEach(function (c) {
      var info = cardLabels(c);
      if (!info.labels.length) return;
      groups++;
      total += info.labels.length;
      var nm = cardName(c);
      if (nm) { if (seen[nm]) dup = true; seen[nm] = true; }
    });
    var t = cards.length ? '共 ' + groups + ' 種題型、' + total + ' 題' : '';
    if (total > 300) t += '\n⚠ 一份考卷最多 300 題';
    if (dup) t += '\n⚠ 有兩張卡片的題型一樣。同一題型請合在一張卡片，用「＋加一段」。';
    p.textContent = t;
  }

  function renderCards() {
    var box = $('#cards');
    box.textContent = '';
    cards.forEach(function (c, i) { box.appendChild(buildCard(c, i)); });
    $('#cards-empty').hidden = cards.length > 0;
    $('#add-card').disabled = cards.length >= 6;
    $('#add-card').textContent = cards.length >= 6 ? '最多 6 種題型' : '＋加一種題型';
    cards.forEach(function (c, i) { updateResult(i); });
    updateCardsSum();
  }

  function focusIn(i, sel, last) {
    var card = document.querySelector('#cards .tcard[data-i="' + i + '"]');
    if (!card) return;
    var list = card.querySelectorAll(sel);
    var t = last ? list[list.length - 1] : list[0];
    if (t) t.focus();
  }

  $('#cards').addEventListener('input', function (e) {
    var t = e.target;
    var card = t.closest && t.closest('.tcard');
    if (!card) return;
    var i = parseInt(card.dataset.i, 10);
    var c = cards[i];
    if (!c) return;
    var row = t.closest('.rrow');
    var k = row ? parseInt(row.dataset.k, 10) : -1;
    var cl = t.classList;
    if (cl.contains('c-custom')) {
      c.custom = t.value;
      c.warn = false;
      var w = card.querySelector('.c-namewarn');
      if (w) w.hidden = true;
    }
    else if (cl.contains('c-from') && c.ranges[k]) c.ranges[k].from = t.value;
    else if (cl.contains('c-to') && c.ranges[k]) c.ranges[k].to = t.value;
    else if (cl.contains('c-uni')) c.uni = t.value;
    else if (cl.contains('c-sq') && c.subs[k]) c.subs[k].q = t.value;
    else if (cl.contains('c-sn') && c.subs[k]) c.subs[k].n = t.value;
    else return;
    cardsDirty = true;
    updateResult(i);
    updateCardsSum();
  });

  $('#cards').addEventListener('change', function (e) {
    var t = e.target;
    if (!t.classList || !t.classList.contains('c-type')) return;
    var i = parseInt(t.closest('.tcard').dataset.i, 10);
    var c = cards[i];
    if (!c) return;
    c.type = t.value;
    if (c.type !== '自訂') c.warn = false;
    cardsDirty = true;
    renderCards();
    if (c.type === '自訂') focusIn(i, '.c-custom');
    else focusIn(i, '.c-type');
  });

  $('#cards').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || b.disabled) return;
    var card = b.closest('.tcard');
    if (!card) return;
    var i = parseInt(card.dataset.i, 10);
    var c = cards[i];
    if (!c) return;
    var row = b.closest('.rrow');
    var k = row ? parseInt(row.dataset.k, 10) : -1;
    var cl = b.classList;
    if (cl.contains('c-del')) { cards.splice(i, 1); }
    else if (cl.contains('c-radd')) { c.ranges.push({ from: '', to: '' }); }
    else if (cl.contains('c-rdel') && c.ranges.length > 1) { c.ranges.splice(k, 1); }
    else if (cl.contains('c-sadd')) { c.subs.push({ q: '', n: '' }); }
    else if (cl.contains('c-sdel')) { c.subs.splice(k, 1); }
    else return;
    cardsDirty = true;
    $('#setup-msg').textContent = '';
    renderCards();
    if (cl.contains('c-radd')) focusIn(i, '.c-from', true);
    else if (cl.contains('c-sadd')) focusIn(i, '.c-sq', true);
  });

  $('#add-card').addEventListener('click', function () {
    if (cards.length >= 6) return;
    var used = {};
    cards.forEach(function (c) { used[c.type] = true; });
    var type = '單選題';
    for (var k = 0; k < TYPE_LIST.length; k++) { if (!used[TYPE_LIST[k]]) { type = TYPE_LIST[k]; break; } }
    cards.push({ type: type, custom: '', warn: false, ranges: [{ from: '', to: '' }], uni: '', subs: [] });
    cardsDirty = true;
    renderCards();
    focusIn(cards.length - 1, '.c-from');
  });

  guarded($('#build'), '建立這次的題目', hasVotes, warnReplace, async function () {
    var msg = $('#setup-msg');
    var groups = [], problems = [], skipped = 0, total = 0;
    cards.forEach(function (c, i) {
      var labels = cardLabels(c).labels;
      if (!labels.length) { skipped++; return; }
      var name = cardName(c);
      if (!name) { problems.push('第 ' + (i + 1) + ' 張卡片的題型是「自訂」，請填名稱。'); return; }
      groups.push({ name: name.slice(0, 12), labels: labels });
      total += labels.length;
    });
    if (problems.length) { msg.textContent = problems.join('\n'); return; }
    if (!groups.length) { msg.textContent = '至少要有一張卡片，並填上題號。'; return; }
    if (total > 300) { msg.textContent = '一份考卷最多 300 題，現在有 ' + total + ' 題。'; return; }
    var ok = await post('/api/setup', { groups: groups }, function () {
      return '已建立，共 ' + questions.length + ' 題。學生現在可以作答。' + (skipped ? '沒填題號的 ' + skipped + ' 張卡片已略過。' : '');
    });
    if (ok) $('#setup').open = false;
  });

  guarded($('#end-btn'), '結束這次檢討', hasVotes, function () { return '已有 ' + R.N + ' 人回覆，再按一次會全部清掉'; }, async function () {
    var ok = await post('/api/end', {}, function () { return '已結束，題目和回覆都清掉了。'; });
    if (ok) { nlInput.value = ''; nlMsg.textContent = ''; $('#setup').open = true; }
  });

  /* ---------- 開頭 ---------- */
  (async function start() {
    if (!PW) { showGate(''); return; }
    var res = await login();
    if (res === 'ok') { enterApp(); return; }
    showGate(res === 'bad' ? '密碼已經改了，請重新輸入。' : (GATE_MSG[res] || ''));
  })();
})();
