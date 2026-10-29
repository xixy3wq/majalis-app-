/* مجالس المشايخ — الواجهة. البيانات من /api/data و/api/majlis، والتعديلات عبر /api/act */
(function () {
  'use strict';
  var app = document.getElementById('app');
  // رقم نسخة هذا الملف (من رابطه)، نقارنه برقم النسخة المنشورة عشان الصفحة القديمة تحدّث نفسها
  var MY_BUILD = ((document.currentScript && document.currentScript.src || '').match(/[?&]v=([^&]+)/) || [])[1] || '';
  function checkBuild(j) {
    if (!j || !j.build || !MY_BUILD || j.build === MY_BUILD || j.build === 'dev') return;
    var k = 'majalis-reload-' + j.build;
    try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1'); } catch (e) { return; }
    if (typeof REC !== 'undefined' && REC) return; // لا نقطع تسجيل شغال
    location.reload();
  }
  var GROUPS = [
    { key: 'core', label: 'الأساسية', note: 'بالترتيب' },
    { key: 'ask', label: 'طلب في آخر اللقاء', note: '' },
    { key: 'spare', label: 'احتياط لو بقي وقت', note: '' }
  ];
  var GLABEL = { core: 'الأساسية', ask: 'طلب في آخر اللقاء', spare: 'احتياط' };
  var DIG = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  function ar(n) { return String(n).replace(/[0-9]/g, function (d) { return DIG[+d]; }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function newId() { return (Date.now().toString(36) + Math.random().toString(36).slice(2, 9)).replace(/[^a-z0-9]/g, ''); }
  function str(v) { return typeof v === 'string' ? v : ''; }
  function nMin(n) { return n === 1 ? 'دقيقة' : n === 2 ? 'دقيقتين' : n >= 3 && n <= 10 ? ar(n) + ' دقائق' : ar(n) + ' دقيقة'; }
  function nQ(n) { return n === 1 ? 'سؤال واحد' : n === 2 ? 'سؤالين' : n >= 3 && n <= 10 ? ar(n) + ' أسئلة' : ar(n) + ' سؤال'; }
  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2600);
  }

  /* ---------- API ---------- */
  function ApiErr(status, msg) { this.status = status; this.message = msg; }
  function api(path, body) {
    var opt = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' };
    return fetch(path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) {
          if (r.status === 401) showLogin();
          throw new ApiErr(r.status, j.error || 'تعذّر الاتصال');
        }
        return j;
      });
    }, function () { throw new ApiErr(0, 'ما فيه اتصال'); });
  }
  function act(op, payload) { var b = payload || {}; b.op = op; return api('/api/act', b); }

  /* ---------- mini markdown for preparation and profile ---------- */
  function inline(s) {
    var keep = [];
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (m, t, u) { keep.push('<a href="' + u + '" target="_blank" rel="noopener">' + t + '</a>'); return '\u0000' + (keep.length - 1) + '\u0000'; });
    s = s.replace(/(https?:\/\/[^\s<]+)/g, function (u) { keep.push('<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>'); return '\u0000' + (keep.length - 1) + '\u0000'; });
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    return s.replace(/\u0000(\d+)\u0000/g, function (m, i) { return keep[+i]; });
  }
  function md(src) {
    var out = [], list = null;
    function close() { if (list) { out.push('</' + list + '>'); list = null; } }
    String(src || '').split(/\r?\n/).forEach(function (raw) {
      var line = raw.replace(/\s+$/, ''), m;
      if (!line.trim()) { close(); return; }
      if ((m = line.match(/^###\s+(.*)$/))) { close(); out.push('<h4>' + inline(esc(m[1])) + '</h4>'); return; }
      if ((m = line.match(/^##\s+(.*)$/))) { close(); out.push('<h3>' + inline(esc(m[1])) + '</h3>'); return; }
      if ((m = line.match(/^>\s?(.*)$/))) { close(); out.push('<blockquote>' + inline(esc(m[1])) + '</blockquote>'); return; }
      if ((m = line.match(/^[-•]\s+(.*)$/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(esc(m[1])) + '</li>'); return; }
      if ((m = line.match(/^[0-9٠-٩]+[.)]\s+(.*)$/))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(esc(m[1])) + '</li>'); return; }
      close(); out.push('<p>' + inline(esc(line)) + '</p>');
    });
    close();
    return out.join('');
  }

  function fmtDate(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { g: '', h: '' };
    var p = iso.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2], 12);
    var g = '', h = '';
    try { g = d.toLocaleDateString('ar-SA-u-ca-gregory-nu-arab', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { g = iso; }
    try { h = d.toLocaleDateString('ar-SA-u-ca-islamic-umalqura-nu-arab', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { h = ''; }
    return { g: g, h: h };
  }

  /* ---------- local drafts: nothing typed is lost during a connection gap ---------- */
  var DKEY = 'majalis-drafts-v1';
  var drafts = {};
  try { drafts = JSON.parse(localStorage.getItem(DKEY) || '{}') || {}; } catch (e) { drafts = {}; }
  function saveDrafts() { try { localStorage.setItem(DKEY, JSON.stringify(drafts)); } catch (e) {} }
  function setDraft(key, rec) { drafts[key] = rec; saveDrafts(); }
  function clearDraft(key) { if (drafts[key]) { delete drafts[key]; saveDrafts(); } }

  /* ---------- write queue: one write at a time per field ---------- */
  var WQ = {};
  var netState = 'connecting'; // connecting | live
  function enqueue(key, fn, delay, draftKey) {
    var w = WQ[key] || (WQ[key] = { timer: null, inflight: false, again: false, fn: null, failed: false, tries: 0 });
    w.fn = fn; w.draftKey = draftKey; w.tries = 0;
    clearTimeout(w.timer);
    w.timer = setTimeout(function () { w.timer = null; run(key); }, delay || 0);
    refreshStatus();
  }
  function run(key) {
    var w = WQ[key];
    if (!w) return;
    if (w.timer) { clearTimeout(w.timer); w.timer = null; }
    if (w.inflight) { w.again = true; return; }
    if (!w.fn) return;
    var fn = w.fn; w.fn = null; w.inflight = true;
    refreshStatus();
    Promise.resolve().then(fn).then(function () {
      w.failed = false;
      if (!w.fn && !w.again && w.draftKey) clearDraft(w.draftKey);
    }, function (err) {
      var st = err && err.status;
      if (st && st >= 400 && st < 500 && st !== 401 && st !== 429) {
        w.failed = false;
        if (w.draftKey) clearDraft(w.draftKey);
        return;
      }
      w.failed = true;
      if (!w.fn) w.fn = fn;
      if (st !== 401 && w.tries < 3) {
        w.tries++;
        setTimeout(function () { if (w.failed && !w.inflight && !w.timer) run(key); }, 4000 + Math.random() * 2000);
      }
    }).then(function () {
      w.inflight = false;
      if (w.again) { w.again = false; run(key); }
      refreshStatus();
    });
  }
  function pending(key) { var w = WQ[key]; return !!(w && (w.timer || w.inflight || w.fn)); }
  function anyPending() { return Object.keys(WQ).some(function (k) { return pending(k); }); }
  function flushAll() { Object.keys(WQ).forEach(function (k) { var w = WQ[k]; if (w.timer || (w.failed && w.fn && !w.inflight)) run(k); }); }
  window.addEventListener('online', flushAll);

  var STATUS = { connecting: 'جاري التجهيز', saved: 'محفوظ', saving: 'جاري الحفظ', fail: 'ما انحفظ، أعيد المحاولة' };
  function refreshStatus() {
    var el = document.getElementById('status');
    if (!el) return;
    var s;
    if (netState === 'connecting') s = 'connecting';
    else {
      var keys = Object.keys(WQ);
      if (keys.some(function (k) { return WQ[k].timer || WQ[k].inflight; })) s = 'saving';
      else if (keys.some(function (k) { return WQ[k].failed; })) s = 'fail';
      else s = 'saved';
    }
    el.dataset.s = s; el.textContent = STATUS[s];
  }

  /* ---------- state ---------- */
  var me = null, ai = null, list = [], listLoaded = false;
  var view = null; // 'login' | 'home' | 'session'
  var cur = null;

  var pendingN = 0;
  function pendingHtml() {
    return me && me.role === 'admin' && pendingN > 0
      ? '<p class="banner" id="pendBanner"><a href="#admin">' + (pendingN === 1 ? 'فيه طلب تسجيل واحد ينتظر موافقتك' : 'فيه ' + ar(pendingN) + ' طلبات تسجيل تنتظر موافقتك') + '</a></p>'
      : '';
  }
  function boot() {
    var sh = shareTokenFromHash();
    if (sh) { renderShare(sh); return; }
    api('/api/data').then(function (j) {
      checkBuild(j);
      me = j.me; ai = j.ai || null; list = j.majalis || []; listLoaded = true; netState = 'live'; pendingN = j.pending || 0;
      route();
    }, function (e) {
      if (e.status === 401) return; // showLogin already rendered
      app.innerHTML = '<div class="wrap"><p class="boot">' + esc(e.status === 503 ? e.message : 'ما قدرت أوصل للموقع. تأكد من الاتصال وحدّث الصفحة.') + '</p></div>';
    });
  }

  /* ---------- routing ---------- */
  function route() {
    if (!me) return;
    var h = (location.hash || '').slice(1);
    try { h = decodeURIComponent(h); } catch (e) {}
    if (h.indexOf('share-') === 0) { renderShare(h.slice(6)); return; }
    if (h.indexOf('s-') === 0 && h.length > 2) { var parts = h.slice(2).split('~'); openSession(parts[0], parts[1]); }
    else if (h === 'admin' && me.role === 'admin') openAdmin();
    else if (h === 'sheikhs') openSheikhs();
    else if (h.indexOf('sh-') === 0) openSheikh(h.slice(3));
    else if (h === 'library') openLibrary();
    else if (h === 'chat') openChat();
    else openHome();
  }
  window.addEventListener('hashchange', function () {
    if (!me && shareTokenFromHash()) { renderShare(shareTokenFromHash()); return; }
    if (!me && view === 'share') { view = null; boot(); return; }
    if (!me && view === 'login' && location.hash === '#register') { renderAuth('register'); return; }
    route();
  });
  function leaveSession() { closeFocus(true); endSel(); if (!cur) return; flushAll(); cur = null; }

  /* ================= LOGIN / FIRST-RUN SETUP ================= */
  function showLogin() {
    if (view === 'login') return;
    leaveSession(); view = 'login'; me = null;
    renderAuth(location.hash === '#register' ? 'register' : 'login');
    fetch('/api/setup', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      if (view !== 'login') return;
      if (j && j.db === false) { app.innerHTML = '<div class="wrap"><p class="boot">قاعدة البيانات غير مربوطة بعد. من Vercel: Storage ← Neon، ثم Redeploy.</p></div>'; return; }
      if (j && j.needed) renderAuth('setup');
    }, function () {});
  }
  // mode: login | register | setup (أول حساب في الموقع ويصير المدير)
  function renderAuth(mode) {
    var setup = mode === 'setup', reg = mode === 'register', newAcc = setup || reg;
    app.innerHTML =
      '<div class="login wrap"><form class="login-card" id="loginForm" autocomplete="on">' +
      '<div class="eyebrow">دفترك مع أهل العلم</div><h1>مجالس المشايخ</h1>' +
      (setup ? '<p class="lede">أول مرة تفتح الموقع. سوّ حسابك وبيكون حساب المدير، وتلقى فيه مجالس الشيوخ الجاهزة.</p>' : '') +
      (reg ? '<p class="lede">سوّ حسابك، ويتفعّل دخولك بعد موافقة المدير. وحسابك خاص فيك: جلساتك وبحثك ما يشوفها أحد غيرك.</p>' : '') +
      (newAcc ? '<div class="field"><label for="lg-n">اسمك</label><input class="input" id="lg-n" autocomplete="name" required></div>' : '') +
      '<div class="field"><label for="lg-u">اسم المستخدم</label><input class="input" id="lg-u" name="username" autocomplete="username" autocapitalize="none" dir="ltr" required' + (newAcc ? ' placeholder="حروف إنجليزية صغيرة"' : '') + '></div>' +
      '<div class="field"><label for="lg-p">كلمة المرور</label><input class="input" id="lg-p" name="password" type="password" autocomplete="' + (newAcc ? 'new-password' : 'current-password') + '" dir="ltr" required' + (newAcc ? ' placeholder="٨ أحرف أو أكثر"' : '') + '></div>' +
      '<p class="login-err" id="lg-err" role="alert"></p>' +
      '<button class="btn primary" type="submit">' + (newAcc ? 'إنشاء الحساب' : 'دخول') + '</button>' +
      (setup ? '' : '<p class="auth-switch">' + (reg ? 'عندك حساب؟ <button class="linkish" type="button" id="toLogin">ادخل</button>' : 'ما عندك حساب؟ <button class="linkish" type="button" id="toReg">سجّل الحين</button>') + '</p>') +
      '</form></div>';
    var tl = document.getElementById('toLogin'), tr = document.getElementById('toReg');
    if (tl) tl.addEventListener('click', function () { renderAuth('login'); });
    if (tr) tr.addEventListener('click', function () { renderAuth('register'); });
    document.getElementById('loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = e.target.querySelector('button[type=submit]'), err = document.getElementById('lg-err');
      btn.disabled = true; err.textContent = '';
      var body = { username: document.getElementById('lg-u').value, password: document.getElementById('lg-p').value };
      if (newAcc) body.name = document.getElementById('lg-n').value;
      fetch(setup ? '/api/setup' : reg ? '/api/register' : '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
        .then(function (x) {
          btn.disabled = false;
          if (!x.ok) {
            if (setup && x.status === 409) { renderAuth('login'); return; }
            err.textContent = x.j.error || 'تعذّر الدخول'; return;
          }
          if (reg && x.j.pending) { if (location.hash === '#register') history.replaceState(null, '', location.pathname); renderPending(); return; }
          view = null; boot();
        }, function () { btn.disabled = false; err.textContent = 'ما فيه اتصال، جرّب مرة ثانية.'; });
    });
  }

  function renderPending() {
    app.innerHTML =
      '<div class="login wrap"><div class="login-card">' +
      '<div class="eyebrow">دفترك مع أهل العلم</div><h1>انرسل طلبك</h1>' +
      '<p class="lede">حسابك انحفظ وينتظر موافقة المدير. بعد ما يوافق عليه تقدر تدخل باسم المستخدم وكلمة المرور اللي سويتها.</p>' +
      '<button class="btn primary" type="button" id="pendBack">رجوع لتسجيل الدخول</button>' +
      '</div></div>';
    document.getElementById('pendBack').addEventListener('click', function () { renderAuth('login'); });
  }

  /* ================= HOME ================= */
  function openHome() {
    leaveSession();
    view = 'home';
    document.title = 'مجالس المشايخ';
    app.innerHTML =
      '<header class="home-top wrap"><div class="home-head"><div class="eyebrow">دفترك مع أهل العلم</div>' +
      '<div class="who"><span>' + esc(me && me.name) + '</span>' + (me && me.role === 'admin' ? '<a class="linkish" href="#admin">المستخدمون</a>' : '') + themeBtnHtml() + '<button class="linkish" id="logout" type="button">خروج</button></div></div>' +
      '<h1>دفتر مجالس المشايخ</h1>' +
      '<p class="lede">سجّل كل مجلس: التحضير، والأسئلة، وأجوبة الشيخ، والفوائد. وتقدر تضيف أسئلة وتعدّلها وأنت في الجلسة.</p>' +
      tabsHtml('home') + '</header>' +
      '<main class="home-main wrap">' +
      pendingHtml() +
      aiPanelHtml() +
      askHtml() +
      '<div class="btns"><button class="btn" id="newBtn" type="button">جلسة يدوية</button><button class="btn ghost" id="selMaj" type="button">تحديد للحذف</button></div>' +
      '<form class="new-form" id="newForm" hidden autocomplete="off">' +
      '<div class="new-grid">' +
      '<div class="field"><label for="nf-sheikh">اسم الشيخ</label><input class="input" id="nf-sheikh" required placeholder="مثال: الشيخ عبدالله"></div>' +
      '<div class="field"><label for="nf-date">التاريخ</label><input class="input" id="nf-date" type="date"></div>' +
      '<div class="field wide"><label for="nf-topic">موضوع الجلسة</label><input class="input" id="nf-topic" placeholder="وش الموضوع اللي تبي تركز عليه؟"></div>' +
      '</div><p class="login-err" id="nf-err" role="alert"></p><div class="btns"><button class="btn primary" type="submit">إنشاء الجلسة</button><button class="btn ghost" type="button" id="nfCancel">إلغاء</button></div></form>' +
      '<div class="search-row"><label class="lbl" for="hq">بحث في جلساتك</label>' +
      '<input class="input" id="hq" type="search" autocomplete="off" placeholder="سؤال، أو جواب، أو فائدة، أو كتاب"></div>' +
      '<div class="list" id="hits" hidden></div>' +
      '<div class="list" id="list"></div>' +
      '<section class="export-row" aria-label="تنزيل جلساتك"><span class="lbl">تنزيل كل جلساتك</span><div class="btns">' +
      '<button class="btn" type="button" id="dlAllDoc">ملف Word للقراءة</button>' +
      '<button class="btn" type="button" id="dlAllJson">نسخة احتياطية</button></div>' +
      '<span class="hint">النسخة الاحتياطية ملف فيه كل شيء كتبته، احفظه عندك.</span></section></main>';
    var form = document.getElementById('newForm');
    wireSearch();
    wireAsk();
    document.getElementById('selMaj').addEventListener('click', function () { startSel('majalis'); });
    document.getElementById('dlAllDoc').addEventListener('click', function (e) { exportAll('doc', e.target); });
    document.getElementById('dlAllJson').addEventListener('click', function (e) { exportAll('json', e.target); });
    document.getElementById('logout').addEventListener('click', function () {
      fetch('/api/logout', { method: 'POST' }).then(function () { location.hash = ''; showLogin(); });
    });
    document.getElementById('newBtn').addEventListener('click', function () { form.hidden = false; document.getElementById('nf-sheikh').focus(); });
    document.getElementById('nfCancel').addEventListener('click', function () { form.hidden = true; });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var sheikh = document.getElementById('nf-sheikh').value.trim();
      if (!sheikh) return;
      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'جاري الإنشاء';
      act('createMajlis', { id: newId(), fields: { sheikh: sheikh, topic: document.getElementById('nf-topic').value.trim(), date: document.getElementById('nf-date').value || '' } })
        .then(function (j) { location.hash = 's-' + j.id; }, function (err) {
          btn.disabled = false; btn.textContent = 'إنشاء الجلسة';
          document.getElementById('nf-err').textContent = err.status === 0 ? 'ما انحفظت الجلسة. تأكد من الاتصال وجرّب مرة ثانية.' : err.message;
        });
    });
    renderList();
    homeLeftovers();
    wireAi();
    api('/api/data').then(function (j) {
      list = j.majalis || []; pendingN = j.pending || 0;
      if (view !== 'home') return;
      renderList();
      var pb = document.getElementById('pendBanner'), html = pendingHtml();
      if (pb && !html) pb.remove();
      else if (!pb && html) { var mm = document.querySelector('.home-main'); if (mm) mm.insertAdjacentHTML('afterbegin', html); }
    }, function () {});
  }

  function renderList() {
    var el = document.getElementById('list');
    if (!el) return;
    if (!listLoaded) { el.innerHTML = '<p class="empty">جاري تحميل جلساتك</p>'; return; }
    if (!list.length) { el.innerHTML = '<p class="empty">ما فيه جلسات بعد. اضغط «جلسة جديدة» وسجّل أول مجلس.</p>'; return; }
    var items = list.slice().sort(function (A, B) {
      var ka = str(A.date), kb = str(B.date);
      if (ka !== kb) return ka < kb ? 1 : -1;
      return (B.createdAt || 0) - (A.createdAt || 0);
    });
    el.innerHTML = items.map(function (s) {
      var d = fmtDate(str(s.date));
      var stats = s.qCount ? (ar(s.qCount) + ' سؤال' + (s.askedCount ? ' · سألت ' + ar(s.askedCount) : '')) : '';
      return '<a class="s-card" href="#s-' + esc(s.id) + '" data-sel="' + esc(s.id) + '" data-sel-kind="majalis"' + (sel && sel.ids[s.id] ? ' class="s-card is-sel"' : '') + '><span class="s-name">' + esc(str(s.sheikh) || 'بدون اسم') + '</span>' +
        (str(s.topic) ? '<span class="s-topic">' + esc(s.topic) + '</span>' : '') +
        '<span class="s-date">' + (d.g ? esc(d.g) + (d.h ? ' · ' + esc(d.h) : '') : 'بدون تاريخ') + '</span>' +
        (stats ? '<span class="s-stats">' + stats + '</span>' : '') + '</a>';
    }).join('');
  }

  /* ================= AI: build a session from the sheikh's name ================= */
  var JKEY = 'majalis-ai-job';
  function savedJob() { try { return JSON.parse(localStorage.getItem(JKEY) || 'null'); } catch (e) { return null; } }
  function setSavedJob(v) { try { if (v) localStorage.setItem(JKEY, JSON.stringify(v)); else localStorage.removeItem(JKEY); } catch (e) {} }

  function aiPanelHtml() {
    if (!ai) return '';
    if (!ai.ready) return ai.admin ? '<p class="banner">الذكاء الاصطناعي متوقف: أضف <span dir="ltr">ANTHROPIC_API_KEY</span> في Vercel ← Settings ← Environment Variables، ثم Redeploy.</p>' : '';
    if (!ai.allowed) return '<p class="ai-note">تقدر تسجّل جلساتك يدويًا من الحين. والجلسات الجاهزة بالذكاء الاصطناعي تتفعّل لحسابك بعد موافقة المدير.</p>';
    var left = ai.limit == null ? '' : '<span class="ai-left">باقي لك اليوم: ' + ar(Math.max(0, ai.limit - ai.used)) + ' من ' + ar(ai.limit) + '</span>';
    var sj = savedJob();
    return '<section class="ai-card" id="aiCard" aria-labelledby="ai-h">' +
      '<div class="ai-head"><h2 id="ai-h">جهّز جلسة مع شيخ</h2>' + left + '</div>' +
      '<p class="lede">اكتب اسم الشيخ وموضوعك، ويبحث الموقع عنه في الإنترنت ويجهّز لك الافتتاح والأسئلة وتحليل شخصيته مع المصادر.</p>' +
      (sj ? '<p class="ai-resume">فيه جلسة ما كملت عن «' + esc(sj.sheikh) + '». <button class="linkish" type="button" id="aiResume">كمّلها</button> <button class="linkish" type="button" id="aiDrop">تجاهلها</button></p>' : '') +
      '<form id="aiForm" autocomplete="off" class="ai-form">' +
      '<div class="new-grid">' +
      '<div class="field"><label for="ai-sheikh">اسم الشيخ</label><input class="input" id="ai-sheikh" required placeholder="مثال: الشيخ مساعد الطيار"></div>' +
      '<div class="field"><label for="ai-hint">معلومة تميّزه (اختياري)</label><input class="input" id="ai-hint" placeholder="جامعته، أو كتاب له، أو مدينته"></div>' +
      '<div class="field wide"><label for="ai-topic">موضوع الجلسة</label><input class="input" id="ai-topic" placeholder="وش تبي تركّز عليه مع الشيخ؟"></div>' +
      '<div class="field wide"><label for="ai-about">عرّف بنفسك وطلابك (اختياري)</label><input class="input" id="ai-about" placeholder="مثال: مشرف حلقة تحفيظ، طلابي في المرحلة المتوسطة" value="' + esc(me.about || '') + '"></div>' +
      '</div><p class="login-err" id="ai-err" role="alert"></p>' +
      '<div class="btns"><button class="btn primary" type="submit">جهّز الجلسة</button></div></form>' +
      '<div id="aiProgress" hidden></div></section>';
  }

  var STEPS = [
    { op: 'research', label: 'يبحث عن الشيخ في الإنترنت', note: 'أطول خطوة، ممكن تأخذ دقيقة أو دقيقتين' },
    { op: 'brief', label: 'يحلل شخصيته العلمية وأسلوبه' },
    { op: 'plan', label: 'يجهّز الافتتاح والأسئلة' },
    { op: 'save', label: 'يحفظ الجلسة في دفترك' }
  ];

  function wireAi() {
    var form = document.getElementById('aiForm'); if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var sheikh = document.getElementById('ai-sheikh').value.trim();
      if (sheikh.length < 3) { document.getElementById('ai-err').textContent = 'اكتب اسم الشيخ'; return; }
      var about = document.getElementById('ai-about').value.trim();
      if (about !== (me.about || '')) { me.about = about; api('/api/me', { about: about }).catch(function () {}); }
      runAi({ sheikh: sheikh, hint: document.getElementById('ai-hint').value.trim(), topic: document.getElementById('ai-topic').value.trim() }, null, 0);
    });
    var rs = document.getElementById('aiResume'), dr = document.getElementById('aiDrop');
    if (rs) rs.addEventListener('click', function () { var sj = savedJob(); if (sj) runAi({ sheikh: sj.sheikh }, sj.id, 0); });
    if (dr) dr.addEventListener('click', function () { setSavedJob(null); openHome(); });
  }

  function paintSteps(at, state, msg, preview) {
    var box = document.getElementById('aiProgress'); if (!box) return;
    box.hidden = false;
    document.getElementById('aiForm').hidden = true;
    var html = '<ol class="ai-steps">';
    STEPS.forEach(function (st, i) {
      var cls = i < at ? 'done' : i === at ? state : 'wait';
      html += '<li class="ai-step ' + cls + '"><span class="dot" aria-hidden="true"></span><span><b>' + st.label + '</b>' +
        (i === at && state === 'run' && st.note ? '<small>' + st.note + '</small>' : '') + '</span></li>';
    });
    html += '</ol>';
    if (preview && (preview.identity || preview.namesakes)) {
      html += '<div class="ai-preview">' + (preview.identity ? '<p><b>لقيته:</b> ' + esc(preview.identity) + '</p>' : '') +
        (preview.namesakes ? '<p class="warn-line"><b>انتبه:</b> ' + esc(preview.namesakes) + '</p>' : '') + '</div>';
    }
    if (state === 'fail') {
      html += '<p class="login-err" role="alert">' + esc(msg || 'صار خطأ') + '</p><div class="btns">' +
        '<button class="btn primary" type="button" id="aiRetry">حاول مرة ثانية</button>' +
        '<button class="btn ghost" type="button" id="aiCancel">إلغاء</button></div>';
    } else {
      html += '<p class="hint">خلّ الصفحة مفتوحة لين يخلص. ولو قفلتها، تقدر تكمّل بعدين من نفس المكان.</p>';
    }
    box.innerHTML = html;
  }

  var preview = null;
  function runAi(input, jobId, at) {
    var step = STEPS[at];
    paintSteps(at, 'run', '', preview);
    var body = jobId ? { op: step.op, id: jobId } : { op: 'start', sheikh: input.sheikh, hint: input.hint, topic: input.topic };
    api('/api/gen', body).then(function (j) {
      if (!jobId) { jobId = j.id; setSavedJob({ id: jobId, sheikh: input.sheikh }); if (ai && ai.limit != null) ai.used++; }
      if (j.preview) preview = j.preview;
      if (step.op === 'save') {
        setSavedJob(null); preview = null;
        location.hash = 's-' + j.majlisId;
        return;
      }
      runAi(input, jobId, at + 1);
    }, function (err) {
      if (view !== 'home') return;
      if (!jobId && err.status !== 0 && err.status !== 502 && err.status !== 504) {
        // ما بدأ التوليد (حد يومي، موافقة، اسم ناقص): رجّع النموذج
        document.getElementById('aiProgress').hidden = true;
        document.getElementById('aiForm').hidden = false;
        document.getElementById('ai-err').textContent = err.message;
        return;
      }
      paintSteps(at, 'fail', err.status === 0 ? 'انقطع الاتصال. تأكد من النت وحاول مرة ثانية.' : err.message, preview);
      document.getElementById('aiRetry').addEventListener('click', function () {
        if (!jobId) { var sj = savedJob(); if (sj) jobId = sj.id; }
        runAi(input, jobId, jobId ? at : 0);
      });
      document.getElementById('aiCancel').addEventListener('click', function () { setSavedJob(null); preview = null; openHome(); });
    });
  }

  /* ================= TABS between notebook views ================= */
  function tabsHtml(on) {
    var T = [['home', '#', 'الجلسات'], ['sheikhs', '#sheikhs', 'المشايخ'], ['library', '#library', 'المكتبة']];
    if (aiOk()) T.push(['chat', '#chat', 'سولف مع دفترك']);
    return '<nav class="home-tabs" aria-label="أقسام الدفتر">' + T.map(function (t) {
      return '<a href="' + t[1] + '"' + (t[0] === on ? ' class="on" aria-current="page"' : '') + '>' + t[2] + '</a>';
    }).join('') + '</nav>';
  }
  function pageTop(on, title, lede) {
    return '<header class="home-top wrap"><div class="home-head"><div class="eyebrow">دفترك مع أهل العلم</div>' +
      '<div class="who"><span>' + esc(me && me.name) + '</span>' + themeBtnHtml() + '</div></div>' +
      '<h1>' + title + '</h1>' + (lede ? '<p class="lede">' + lede + '</p>' : '') + tabsHtml(on) + '</header>';
  }

  /* ================= ALL DATA (search, sheikhs, library, export) ================= */
  var all = null, allP = null;
  function loadAll(force) {
    if (all && !force) return Promise.resolve(all);
    if (allP && !force) return allP;
    allP = api('/api/all').then(function (j) { all = j.majalis || []; allP = null; return all; }, function (e) { allP = null; throw e; });
    return allP;
  }
  // Arabic-aware normalisation with a map back to the original text (for highlighting)
  function normMap(src) {
    var out = '', map = [];
    for (var i = 0; i < src.length; i++) {
      var c = src[i];
      if (/[ً-ْٰـ]/.test(c)) continue;
      if (/[إأآٱ]/.test(c)) c = 'ا'; else if (c === 'ى') c = 'ي'; else if (c === 'ة') c = 'ه'; else if (c === 'ؤ') c = 'و'; else if (c === 'ئ') c = 'ي';
      out += c.toLowerCase(); map.push(i);
    }
    return { n: out, map: map };
  }
  function norm(s) { return normMap(String(s || '')).n; }
  function snippet(src, q) {
    var nm = normMap(src), k = nm.n.indexOf(q);
    if (k < 0) return null;
    var a = nm.map[k], b = nm.map[k + q.length - 1] + 1;
    var from = Math.max(0, a - 60), to = Math.min(src.length, b + 90);
    return (from > 0 ? '… ' : '') + esc(src.slice(from, a)) + '<mark>' + esc(src.slice(a, b)) + '</mark>' + esc(src.slice(b, to)) + (to < src.length ? ' …' : '');
  }
  function dateLine(m) { var d = fmtDate(str(m.date)); return d.g ? d.g : 'بدون تاريخ'; }

  /* ---------- search ---------- */
  function wireSearch() {
    var inp = document.getElementById('hq'), hits = document.getElementById('hits'), listEl = document.getElementById('list');
    var t = null;
    inp.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        var q = norm(inp.value.trim());
        if (q.length < 2) { hits.hidden = true; listEl.hidden = false; return; }
        hits.hidden = false; listEl.hidden = true;
        if (!all) hits.innerHTML = '<p class="empty">جاري البحث</p>';
        loadAll().then(function (rows) {
          if (view !== 'home' || norm(inp.value.trim()) !== q) return;
          var out = [];
          rows.forEach(function (m) {
            var head = '<span class="h-sheikh">' + esc(m.sheikh || 'بدون اسم') + '</span><span class="h-date">' + esc(dateLine(m)) + '</span>';
            [['topic', 'الموضوع'], ['general', 'الفوائد'], ['books', 'الكتب'], ['opening', 'التحضير']].forEach(function (f) {
              var sn = snippet(str(m[f[0]]), q);
              if (sn) out.push('<a class="hit" href="#s-' + esc(m.id) + '"><span class="h-head">' + head + '<span class="chip">' + f[1] + '</span></span><span class="h-snip">' + sn + '</span></a>');
            });
            (m.questions || []).forEach(function (qq) {
              var sn = snippet(str(qq.text), q), where = 'السؤال';
              if (!sn) { sn = snippet(str(qq.answer), q); where = 'الجواب'; }
              if (sn) out.push('<a class="hit" href="#s-' + esc(m.id) + '~' + esc(qq.id) + '"><span class="h-head">' + head + '<span class="chip">' + where + '</span></span>' +
                (where === 'الجواب' ? '<span class="h-q">' + esc(qq.text) + '</span>' : '') + '<span class="h-snip">' + sn + '</span></a>');
            });
          });
          hits.innerHTML = out.length ? '<p class="hint">' + (out.length === 1 ? 'نتيجة وحدة' : ar(out.length) + ' نتيجة') + '</p>' + out.slice(0, 80).join('')
            : '<p class="empty">ما لقيت شيء بهالكلمة في جلساتك.</p>';
        }, function (e) { hits.innerHTML = '<p class="empty">' + esc(e.message) + '</p>'; });
      }, 220);
    });
  }
  function jumpTo(qid) {
    if (!cur || !cur.els[qid]) return;
    var el = cur.els[qid];
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    setTimeout(function () { el.classList.remove('flash'); }, 2000);
  }

  /* ---------- sheikhs ---------- */
  function sheikhKey(name) {
    return norm(String(name || '').replace(/^\s*(فضيلة\s+)?(الشيخ|الدكتور|أ\.\s*د\.|د\.)\s*/, '')).replace(/\s+/g, ' ').trim() || 'بدون اسم';
  }
  function groupSheikhs(rows) {
    var g = {};
    rows.forEach(function (m) {
      var k = sheikhKey(m.sheikh);
      (g[k] = g[k] || { key: k, name: m.sheikh || 'بدون اسم', items: [] }).items.push(m);
    });
    return Object.keys(g).map(function (k) {
      var x = g[k];
      x.items.sort(function (a, b) { return str(b.date) < str(a.date) ? -1 : str(b.date) > str(a.date) ? 1 : (b.createdAt || 0) - (a.createdAt || 0); });
      return x;
    }).sort(function (a, b) { return b.items.length - a.items.length || (a.name < b.name ? -1 : 1); });
  }
  function openSheikhs() {
    leaveSession(); view = 'sheikhs'; document.title = 'المشايخ · مجالس المشايخ';
    app.innerHTML = pageTop('sheikhs', 'المشايخ', 'كل شيخ جلست معه، وتحت كل واحد مجالسك معه وتوجيهاته.') +
      '<main class="home-main wrap"><div class="list" id="shList"><p class="empty">جاري التحميل</p></div></main>';
    loadAll(true).then(function (rows) {
      if (view !== 'sheikhs') return;
      var gs = groupSheikhs(rows), el = document.getElementById('shList');
      el.innerHTML = gs.length ? gs.map(function (x) {
        var last = x.items[0];
        return '<a class="s-card" href="#sh-' + encodeURIComponent(x.key) + '"><span class="s-name">' + esc(x.name) + '</span>' +
          '<span class="s-stats">' + (x.items.length === 1 ? 'مجلس واحد' : x.items.length === 2 ? 'مجلسين' : ar(x.items.length) + ' مجالس') + '</span>' +
          '<span class="s-date">آخر مجلس: ' + esc(dateLine(last)) + '</span></a>';
      }).join('') : '<p class="empty">ما فيه جلسات بعد.</p>';
    }, function (e) { var el = document.getElementById('shList'); if (el) el.innerHTML = '<p class="empty">' + esc(e.message) + '</p>'; });
  }
  function openSheikh(key) {
    leaveSession(); view = 'sheikh';
    app.innerHTML = pageTop('sheikhs', 'المشايخ', '') + '<main class="home-main wrap" id="shMain"><p class="empty">جاري التحميل</p></main>';
    loadAll(true).then(function (rows) {
      if (view !== 'sheikh') return;
      var x = groupSheikhs(rows).filter(function (g) { return g.key === key; })[0];
      var main = document.getElementById('shMain');
      if (!x) { main.innerHTML = '<p class="empty">ما لقيت هذا الشيخ. <a href="#sheikhs">ارجع للمشايخ</a></p>'; return; }
      document.title = x.name + ' · مجالس المشايخ';
      var h = document.querySelector('.home-top h1'); if (h) h.textContent = x.name;
      var html = '<a class="back" href="#sheikhs">‹ كل المشايخ</a><section class="sec"><h2>المجالس</h2><div class="list">' + x.items.map(function (m) {
        var asked = (m.questions || []).filter(function (q) { return q.asked; }).length;
        return '<a class="s-card" href="#s-' + esc(m.id) + '"><span class="s-topic">' + esc(m.topic || 'بدون موضوع') + '</span>' +
          '<span class="s-date">' + esc(dateLine(m)) + '</span>' + ((m.questions || []).length ? '<span class="s-stats">' + ar(m.questions.length) + ' سؤال' + (asked ? ' · سألت ' + ar(asked) : '') + '</span>' : '') + '</a>';
      }).join('') + '</div></section>';
      var gen = x.items.filter(function (m) { return str(m.general).trim(); });
      html += '<section class="sec"><h2>توجيهاته وفوائده</h2>' + (gen.length ? gen.map(function (m) {
        return '<div class="sh-block"><a class="sh-from" href="#s-' + esc(m.id) + '">' + esc(dateLine(m)) + (m.topic ? ' · ' + esc(m.topic) : '') + '</a><div class="rich">' + md(m.general) + '</div></div>';
      }).join('') : '<p class="empty">ما كتبت فوائد في مجالسه بعد.</p>') + '</section>';
      var books = [];
      x.items.forEach(function (m) { bookLines(m.books).forEach(function (b) { books.push({ t: b, m: m }); }); });
      html += '<section class="sec"><h2>كتب وآثار ذكرها</h2>' + (books.length ? '<ul class="lib">' + books.map(function (b) {
        return '<li><span>' + esc(b.t) + '</span><a class="sh-from" href="#s-' + esc(b.m.id) + '">' + esc(dateLine(b.m)) + '</a></li>';
      }).join('') + '</ul>' : '<p class="empty">ما فيه كتب مسجّلة.</p>') + '</section>';
      main.innerHTML = html;
    }, function (e) { var el = document.getElementById('shMain'); if (el) el.innerHTML = '<p class="empty">' + esc(e.message) + '</p>'; });
  }

  /* ---------- library ---------- */
  function bookLines(txt) {
    return String(txt || '').split(/\r?\n/).map(function (l) { return l.replace(/^\s*([-•*]|[0-9٠-٩]+[.)])\s*/, '').trim(); }).filter(function (l) { return l.length > 1; });
  }
  function openLibrary() {
    leaveSession(); view = 'library'; document.title = 'المكتبة · مجالس المشايخ';
    app.innerHTML = pageTop('library', 'المكتبة', 'كل الكتب والآثار اللي ذكرها المشايخ في جلساتك.') +
      '<main class="home-main wrap"><div class="search-row"><label class="lbl" for="lq">تصفية</label><input class="input" id="lq" type="search" autocomplete="off" placeholder="اسم كتاب أو شيخ"></div>' +
      '<div id="libList"><p class="empty">جاري التحميل</p></div></main>';
    loadAll(true).then(function (rows) {
      if (view !== 'library') return;
      var items = [];
      rows.forEach(function (m) { bookLines(m.books).forEach(function (b) { items.push({ t: b, m: m }); }); });
      function paint() {
        var q = norm(document.getElementById('lq').value.trim());
        var shown = items.filter(function (it) { return !q || norm(it.t + ' ' + it.m.sheikh).indexOf(q) !== -1; });
        document.getElementById('libList').innerHTML = shown.length ? '<ul class="lib">' + shown.map(function (it) {
          return '<li><span>' + esc(it.t) + '</span><a class="sh-from" href="#s-' + esc(it.m.id) + '">' + esc(it.m.sheikh || '') + ' · ' + esc(dateLine(it.m)) + '</a></li>';
        }).join('') + '</ul>' : '<p class="empty">' + (items.length ? 'ما فيه نتيجة.' : 'ما فيه كتب مسجّلة بعد. اكتبها في «كتب وآثار ذكرها الشيخ» داخل كل جلسة.') + '</p>';
      }
      document.getElementById('lq').addEventListener('input', paint);
      paint();
    }, function (e) { var el = document.getElementById('libList'); if (el) el.innerHTML = '<p class="empty">' + esc(e.message) + '</p>'; });
  }

  /* ================= EXPORT: Word, print/PDF, backup ================= */
  function curAsRecord() {
    var by = sortedQs(), qs = [];
    GROUPS.forEach(function (g) { by[g.key].forEach(function (id) { var q = cur.qs[id]; qs.push({ text: q.text, why: q.why, group: q.group, asked: q.asked, answer: q.answer }); }); });
    var m = cur.meta || {};
    return { sheikh: m.sheikh, topic: m.topic, date: m.date, place: m.place, books: m.books, general: m.general, questions: qs };
  }
  // ASCII file names: some browsers drop Arabic download names and the file loses its extension
  function fileName(m) { return 'majlis' + (m.date ? '-' + m.date : '-' + new Date().toISOString().slice(0, 10)); }
  function docTitle(m) { return 'مجلس ' + (m.sheikh || '') + (m.date ? ' ' + m.date : ''); }
  function ansHtml(t) {
    var lines = String(t || '').split(/\r?\n/), out = [], inList = false;
    lines.forEach(function (l) {
      var m = l.match(/^\s*[-•]\s+(.*)$/);
      if (m) { if (!inList) { out.push('<ul>'); inList = true; } out.push('<li>' + esc(m[1]) + '</li>'); return; }
      if (inList) { out.push('</ul>'); inList = false; }
      if (l.trim()) out.push('<p>' + esc(l) + '</p>');
    });
    if (inList) out.push('</ul>');
    return out.join('');
  }
  function recordHtml(m) {
    var d = fmtDate(str(m.date));
    var h = '<h1>مجلس مع ' + esc(m.sheikh || 'الشيخ') + '</h1><p class="meta">' +
      [m.topic ? 'الموضوع: ' + esc(m.topic) : '', d.g ? 'التاريخ: ' + esc(d.g) + (d.h ? ' (' + esc(d.h) + ')' : '') : '', m.place ? 'المكان: ' + esc(m.place) : ''].filter(Boolean).join(' · ') + '</p>';
    var qs = (m.questions || []);
    if (qs.length) {
      h += '<h2>الأسئلة والأجوبة</h2>';
      qs.forEach(function (q, i) {
        h += '<div class="pq"><p class="qt">' + ar(i + 1) + '. ' + esc(q.text) + '</p>' + (str(q.answer).trim() ? '<div class="qa">' + ansHtml(q.answer) + '</div>' : '<p class="na">لم يُكتب جواب.</p>') + '</div>';
      });
    }
    if (str(m.general).trim()) h += '<h2>فوائد وأفكار للتطبيق</h2>' + ansHtml(m.general);
    if (str(m.books).trim()) h += '<h2>كتب وآثار ذكرها الشيخ</h2>' + ansHtml(m.books);
    return h;
  }
  var DOC_CSS = 'body{direction:rtl;font-family:"Traditional Arabic","Amiri","Arial",sans-serif;font-size:15pt;line-height:1.7;color:#111}' +
    'h1{font-size:24pt;margin:0 0 4pt}h2{font-size:17pt;color:#1D6A56;margin:18pt 0 6pt;border-bottom:1px solid #ccc}' +
    '.meta{color:#555;font-size:12pt}.qt{font-weight:bold;margin:12pt 0 2pt}.qa p,.qa li{margin:2pt 0}.na{color:#888}ul{margin:0 18pt 0 0;padding:0}' +
    '.brk{page-break-before:always}';
  function docHtml(recs) {
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40" dir="rtl">' +
      '<head><meta charset="utf-8"><title>' + esc(recs.length === 1 ? docTitle(recs[0]) : 'مجالس المشايخ') + '</title><style>' + DOC_CSS + '</style></head><body dir="rtl">' +
      recs.map(function (m, i) { return (i ? '<div class="brk"></div>' : '') + recordHtml(m); }).join('') + '</body></html>';
  }
  function download(name, content, type) {
    var blob = new Blob(['﻿', content], { type: type + ';charset=utf-8' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }
  /* ---------- real .docx (zip + WordprocessingML), right-to-left, no library ---------- */
  var CRC_T = null;
  function crc32(u8) {
    if (!CRC_T) { CRC_T = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; } }
    var crc = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) crc = CRC_T[(crc ^ u8[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function zipStore(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    function u16(v) { return [v & 255, (v >>> 8) & 255]; }
    function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
      var head = [].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      parts.push(new Uint8Array(head), name, data);
      central.push(new Uint8Array([].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
      offset += head.length + name.length + data.length;
    });
    var cdSize = central.reduce(function (a, b) { return a + b.length; }, 0);
    var end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(offset), u16(0)));
    return new Blob(parts.concat(central, [end]), { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }
  function xmlEsc(t) { return String(t == null ? '' : t).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function wP(t, o) {
    o = o || {};
    var sz = o.size || 28;
    var ppr = '<w:pPr>' + (o.pageBreak ? '<w:pageBreakBefore/>' : '') + '<w:bidi/><w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after == null ? 100 : o.after) + '"/>' + (o.ind ? '<w:ind w:right="' + o.ind + '"/>' : '') + '</w:pPr>';
    var rpr = '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Traditional Arabic"/>' + (o.bold ? '<w:b/><w:bCs/>' : '') + (o.color ? '<w:color w:val="' + o.color + '"/>' : '') + '<w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/><w:rtl/></w:rPr>';
    return '<w:p>' + ppr + '<w:r>' + rpr + '<w:t xml:space="preserve">' + xmlEsc(t) + '</w:t></w:r></w:p>';
  }
  function wLines(t) {
    return String(t || '').split(/\r?\n/).map(function (l) {
      var m = l.match(/^\s*[-•]\s+(.*)$/);
      if (m) return wP('• ' + m[1], { ind: 360 });
      return l.trim() ? wP(l) : '';
    }).join('');
  }
  function docxBody(m, first) {
    var d = fmtDate(str(m.date)), x = '';
    x += wP('مجلس مع ' + (m.sheikh || 'الشيخ'), { size: 44, bold: true, after: 60, pageBreak: !first });
    var meta = [m.topic ? 'الموضوع: ' + m.topic : '', d.g ? 'التاريخ: ' + d.g + (d.h ? ' (' + d.h + ')' : '') : '', m.place ? 'المكان: ' + m.place : ''].filter(Boolean).join(' · ');
    if (meta) x += wP(meta, { size: 24, color: '555555', after: 200 });
    var qs = m.questions || [];
    if (qs.length) {
      x += wP('الأسئلة والأجوبة', { size: 32, bold: true, color: '1D6A56', before: 200 });
      qs.forEach(function (q, i) {
        x += wP(ar(i + 1) + '. ' + (q.text || ''), { bold: true, before: 160, after: 60 });
        x += str(q.answer).trim() ? wLines(q.answer) : wP('لم يُكتب جواب.', { color: '888888' });
      });
    }
    if (str(m.general).trim()) x += wP('فوائد وأفكار للتطبيق', { size: 32, bold: true, color: '1D6A56', before: 240 }) + wLines(m.general);
    if (str(m.books).trim()) x += wP('كتب وآثار ذكرها الشيخ', { size: 32, bold: true, color: '1D6A56', before: 240 }) + wLines(m.books);
    return x;
  }
  function downloadDocx(name, recs) {
    var W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="' + W + '"><w:body>' +
      recs.map(function (m, i) { return docxBody(m, i === 0); }).join('') +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/><w:bidi/></w:sectPr></w:body></w:document>';
    var blob = zipStore([
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
      { name: 'word/document.xml', data: doc }
    ]);
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
    toast('جاري تنزيل ملف Word');
  }

  function printRecords(recs) {
    var old = document.getElementById('printArea'); if (old) old.remove();
    var el = document.createElement('div'); el.id = 'printArea'; el.dir = 'rtl';
    el.innerHTML = recs.map(function (m, i) { return (i ? '<div class="brk"></div>' : '') + recordHtml(m); }).join('');
    document.body.appendChild(el);
    document.documentElement.classList.add('printing');
    setTimeout(function () {
      window.print();
      setTimeout(function () { document.documentElement.classList.remove('printing'); el.remove(); }, 500);
    }, 50);
  }
  function exportAll(kind, btn) {
    var label = btn.textContent; btn.disabled = true; btn.textContent = 'جاري التجهيز';
    loadAll(true).then(function (rows) {
      btn.disabled = false; btn.textContent = label;
      var today = new Date().toISOString().slice(0, 10);
      if (kind === 'json') download('majalis-backup-' + today + '.json', JSON.stringify({ app: 'majalis', exportedAt: new Date().toISOString(), majalis: rows }, null, 1), 'application/json');
      else downloadDocx('majalis-' + today + '.docx', rows.slice().sort(function (a, b) { return str(a.date) < str(b.date) ? -1 : 1; }));
    }, function (e) { btn.disabled = false; btn.textContent = label; toast(e.message); });
  }

  /* ================= ADMIN: users and AI approval ================= */
  function openAdmin() {
    leaveSession();
    view = 'admin';
    document.title = 'المستخدمون · مجالس المشايخ';
    app.innerHTML =
      '<header class="s-top wrap"><div class="home-head"><a class="back" href="#">‹ كل الجلسات</a><div class="who">' + themeBtnHtml() + '</div></div><h1>المستخدمون</h1>' +
      '<p class="lede">أي حساب جديد ما يدخل الموقع إلا بعد ما تقبله. وبعد القبول يستخدم الدفتر يدويًا، وفعّل «الذكاء الاصطناعي» للي تبيهم يجهّزون جلسات من رصيدك. وكل مستخدم يشوف جلساته هو بس.</p></header>' +
      '<main class="home-main wrap">' +
      '<form class="limit-row" id="limitForm"><label for="lim">حد الجلسات بالذكاء الاصطناعي لكل مستخدم في اليوم</label>' +
      '<input class="input" id="lim" type="number" min="0" max="50" inputmode="numeric" style="max-width:110px"><button class="btn" type="submit">حفظ</button><span class="hint" id="limMsg"></span></form>' +
      '<section class="wa-card" aria-labelledby="inv-h"><h2 id="inv-h">رابط التسجيل</h2>' +
      '<p class="lede">انسخه وانشره للي يبي يسجّل. يفتح له صفحة إنشاء حساب على طول، وحسابه ينتظر موافقتك.</p>' +
      '<input class="input" id="invLink" readonly dir="ltr" value="' + esc(location.origin + location.pathname + '#register') + '">' +
      '<div class="btns"><button class="btn primary" type="button" id="invCopy">نسخ الرابط</button>' +
      '<a class="btn" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent('سجّل في دفتر مجالس المشايخ من هذا الرابط:\n' + location.origin + location.pathname + '#register') + '">إرسال واتساب</a></div></section>' +
      '<section class="wa-card" aria-labelledby="nu-h"><h2 id="nu-h">إنشاء حساب</h2><p class="lede">تسوي حساب لأحد بنفسك، ويقدر يدخل على طول بدون موافقة.</p>' +
      '<form class="wa-form" id="newUser" autocomplete="off"><div class="new-grid">' +
      '<div class="field"><label for="nu-n">الاسم</label><input class="input" id="nu-n"></div>' +
      '<div class="field"><label for="nu-u">اسم المستخدم</label><input class="input" id="nu-u" dir="ltr" autocapitalize="none" placeholder="حروف إنجليزية صغيرة"></div>' +
      '<div class="field"><label for="nu-p">كلمة المرور</label><input class="input" id="nu-p" dir="ltr" placeholder="٨ أحرف أو أكثر"></div></div>' +
      '<label class="asked"><input type="checkbox" id="nu-ai"><span>يقدر يستخدم الذكاء الاصطناعي</span></label>' +
      '<div class="btns"><button class="btn primary" type="submit">إنشاء الحساب</button></div></form></section>' +
      '<section class="wa-card" aria-labelledby="wa-h"><div class="sec-head"><h2 id="wa-h">إشعارات واتساب</h2><span class="chip" id="waState"></span></div>' +
      '<p class="lede">يوصلك على واتساب كل طلب تسجيل جديد، وتذكير قبل مجالسك بيوم. الإرسال من رقمك المربوط في «الواتس الذكي»، نفس موقع التسميع.</p>' +
      '<div id="waBody"><p class="hint">جاري التحميل</p></div></section>' +
      '<section class="wa-card" aria-labelledby="bk-h"><div class="sec-head"><h2 id="bk-h">النسخ الاحتياطي</h2><span class="chip" id="bkState"></span></div>' +
      '<p class="lede">كل ليلة الساعة ٣ الفجر ينحفظ نسخة كاملة من كل الحسابات وجلساتهم وأسئلتهم في مخزن مستقل عن قاعدة البيانات، وتبقى آخر ٣٠ نسخة. وتقدر تنزّل أي نسخة لجهازك، أو تسترجع منها.</p>' +
      '<div id="bkBody"><p class="hint">جاري التحميل</p></div></section>' +
      '<div class="btns"><button class="btn ghost" id="selUsers" type="button">تحديد عدة مستخدمين</button></div>' +
      '<div class="list" id="users"><p class="empty">جاري التحميل</p></div></main>';
    document.getElementById('selUsers').addEventListener('click', function () { startSel('users'); });
    loadWa();
    loadBackups();
    document.getElementById('invCopy').addEventListener('click', function () {
      var inp = document.getElementById('invLink');
      function fb() { inp.focus(); inp.select(); toast('حدّد الرابط وانسخه'); }
      try { navigator.clipboard.writeText(inp.value).then(function () { toast('انتسخ رابط التسجيل'); }, fb); } catch (e) { fb(); }
    });
    document.getElementById('newUser').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, btn = f.querySelector('button[type=submit]');
      var body = { op: 'createUser', name: document.getElementById('nu-n').value, username: document.getElementById('nu-u').value, password: document.getElementById('nu-p').value, ai: document.getElementById('nu-ai').checked };
      btn.disabled = true;
      api('/api/admin', body).then(function () {
        btn.disabled = false; toast('انشأ الحساب. أرسل له اسم المستخدم وكلمة المرور.');
        f.reset(); loadUsers();
      }, function (er) { btn.disabled = false; toast(er.message); });
    });
    document.getElementById('limitForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var n = Number(document.getElementById('lim').value);
      api('/api/admin', { op: 'setLimit', limit: n }).then(function () { document.getElementById('limMsg').textContent = 'انحفظ'; }, function (er) { document.getElementById('limMsg').textContent = er.message; });
    });
    loadUsers();
  }
  function loadUsers() {
    api('/api/admin').then(function (j) {
      if (view !== 'admin') return;
      document.getElementById('lim').value = j.limit;
      var el = document.getElementById('users');
      el.innerHTML = j.users.map(function (u) {
        var isAdm = u.role === 'admin';
        return '<div class="u-row" data-id="' + esc(u.id) + '"' + (isAdm ? '' : ' data-sel="' + esc(u.id) + '" data-sel-kind="users"') + '><div class="u-main"><div class="u-line"><b>' + esc(u.name) + '</b><span class="u-sub" dir="ltr">@' + esc(u.username) + '</span>' +
          (isAdm ? '<span class="chip">المدير</span>' : '') + (!isAdm && !u.approved ? '<span class="chip">بانتظار الموافقة</span>' : '') + '</div>' +
          '<span class="u-sub">' + ar(u.majalis) + ' جلسة · ' + ar(u.ai30) + ' بالذكاء الاصطناعي آخر ٣٠ يوم</span>' +
          (u.about ? '<span class="u-sub">' + esc(u.about) + '</span>' : '') + '</div>' +
          (isAdm ? '' : !u.approved
            ? '<div class="u-act"><button class="btn primary" type="button" data-approve>قبول</button>' +
              '<button class="icon-btn" type="button" data-del data-label="رفض">رفض</button></div>'
            : '<div class="u-act"><label class="asked"><input type="checkbox" data-ai ' + (u.aiAllowed ? 'checked' : '') + '><span>الذكاء الاصطناعي</span></label>' +
              '<button class="icon-btn" type="button" data-pw>كلمة مرور جديدة</button>' +
              '<button class="icon-btn" type="button" data-suspend>إيقاف</button>' +
              '<button class="icon-btn" type="button" data-del data-label="حذف">حذف</button></div>') + '</div>';
      }).join('') || '<p class="empty">ما فيه مستخدمين</p>';
      if (sel && sel.kind === 'users') el.querySelectorAll('[data-sel]').forEach(function (r) { r.classList.toggle('is-sel', !!sel.ids[r.dataset.sel]); });
    }, function (er) { var el = document.getElementById('users'); if (el) el.innerHTML = '<p class="empty">' + esc(er.message) + '</p>'; });
  }
  app.addEventListener('change', function (e) {
    if (view !== 'admin') return;
    var t = e.target; if (!t.matches || !t.matches('input[data-ai]')) return;
    var id = t.closest('.u-row').dataset.id;
    t.disabled = true;
    api('/api/admin', { op: 'setAi', id: id, allowed: t.checked }).then(function () { t.disabled = false; }, function (er) { t.disabled = false; t.checked = !t.checked; alertLine(er.message); });
  });
  app.addEventListener('click', function (e) {
    if (view !== 'admin') return;
    var pwb = e.target.closest('button[data-pw]');
    if (pwb) {
      var row = pwb.closest('.u-row');
      if (row.querySelector('.pw-form')) return;
      var f = document.createElement('form'); f.className = 'pw-form'; f.autocomplete = 'off';
      var fid = 'pw-' + row.dataset.id;
      f.innerHTML = '<label class="lbl" for="' + fid + '">كلمة المرور الجديدة</label><input class="input" id="' + fid + '" dir="ltr" autocomplete="off" placeholder="٨ أحرف أو أكثر">' +
        '<button class="btn primary" type="submit">حفظ</button><button class="btn ghost" type="button" data-pwcancel>إلغاء</button>';
      row.appendChild(f); f.querySelector('input').focus();
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var pw = f.querySelector('input').value;
        if (pw.length < 8) { toast('كلمة المرور لازم تكون ٨ أحرف أو أكثر'); return; }
        api('/api/admin', { op: 'setPassword', id: row.dataset.id, password: pw }).then(function () { f.remove(); toast('تغيّرت كلمة المرور. أرسلها له.'); }, function (er) { toast(er.message); });
      });
      f.querySelector('[data-pwcancel]').addEventListener('click', function () { f.remove(); });
      return;
    }
    var ap = e.target.closest('button[data-approve], button[data-suspend]');
    if (ap) {
      ap.disabled = true;
      api('/api/admin', { op: 'setApproved', id: ap.closest('.u-row').dataset.id, approved: ap.hasAttribute('data-approve') })
        .then(loadUsers, function (er) { ap.disabled = false; alertLine(er.message); });
      return;
    }
    var b = e.target.closest('button[data-del]'); if (!b) return;
    var lbl = b.getAttribute('data-label') || 'حذف';
    if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = 'تأكيد'; setTimeout(function () { b.classList.remove('arm'); b.textContent = lbl; }, 3000); return; }
    api('/api/admin', { op: 'deleteUser', id: b.closest('.u-row').dataset.id }).then(loadUsers, function (er) { alertLine(er.message); });
  });
  function alertLine(msg) { var m = document.getElementById('limMsg'); if (m) m.textContent = msg; }

  /* ================= SESSION ================= */
  var META_FIELDS = ['sheikh', 'topic', 'date', 'time', 'place', 'opening', 'briefing', 'books', 'general'];

  function openSession(sid, jump) {
    if (cur && cur.sid === sid) { if (jump) jumpTo(jump); return; }
    leaveSession();
    view = 'session';
    cur = { sid: sid, meta: null, qs: {}, els: {}, editing: {}, richEdit: {}, creating: {}, deleting: {}, loaded: false, jump: jump || '' };
    app.innerHTML =
      '<header class="s-top wrap">' +
      '<a class="back" href="#">‹ كل الجلسات</a>' +
      '<div class="eyebrow">مجلس مع</div>' +
      '<input class="title-in" id="m-sheikh" data-f="sheikh" aria-label="اسم الشيخ" placeholder="اسم الشيخ">' +
      '<div class="meta-grid">' +
      '<div class="field"><label for="m-topic">الموضوع</label><input class="input" id="m-topic" data-f="topic" placeholder="موضوع الجلسة"></div>' +
      '<div class="field"><label for="m-date">التاريخ</label><input class="input" id="m-date" data-f="date" type="date"><span class="hijri" id="m-hijri"></span></div>' +
      '<div class="field"><label for="m-time">الوقت</label><input class="input" id="m-time" data-f="time" type="time"></div>' +
      '<div class="field"><label for="m-place">المكان</label><input class="input" id="m-place" data-f="place" placeholder="المسجد أو المدينة"></div>' +
      '</div>' +
      '<div class="btns s-actions">' + (recAllowed() ? '<button class="btn rec-quick" id="recQuick" type="button"><span class="rec-dot" aria-hidden="true"></span> سجّل المجلس</button>' : '') +
      '<a class="btn" id="icsBtn" href="#">أضف للتقويم</a><button class="btn" id="shareBtn" type="button" aria-expanded="false">مشاركة للقراءة</button></div>' +
      '<div class="share-panel" id="sharePanel" hidden></div></header>' +
      '<nav class="bar" aria-label="أقسام الجلسة"><div class="wrap"><div class="links">' +
      '<button type="button" data-jump="sec-prep">التحضير</button>' +
      '<button type="button" data-jump="sec-q">الأسئلة</button>' +
      (recAllowed() ? '<button type="button" data-jump="sec-rec">التسجيل</button>' : '') +
      '<button type="button" data-jump="sec-notes">ملاحظات عامة</button>' +
      '<button type="button" data-jump="sec-brief">عن الشيخ</button>' +
      '</div><span class="timer-pill" id="timerPill" hidden></span><span class="status" id="status" data-s="connecting" role="status" aria-live="polite">جاري التجهيز</span></div></nav>' +
      '<main class="s-main wrap">' +
      '<p class="empty" id="loading">جاري تحميل الجلسة</p>' +
      '<div id="sessionBody" hidden style="display:grid;gap:52px">' +
      richSection('sec-prep', 'التحضير والافتتاح', 'opening', 'اكتب هنا كيف بتفتتح الجلسة وأي شيء تبي تتذكره قبلها.') +
      '<section class="sec" id="sec-q" aria-labelledby="h-q"><div class="sec-head"><h2 id="h-q">الأسئلة</h2></div>' +
      '<p class="lede">علّم على السؤال بعد ما تسأله، واكتب خلاصة جوابه تحته. وإذا طرأ لك سؤال أثناء الجلسة، أضفه من تحت.</p>' +
      '<div class="q-tools"><span class="progress" id="progress"></span><div class="btns">' +
      '<button class="btn primary" id="focusBtn" type="button">وضع المجلس</button>' +
      '<button class="btn" id="timerBtn" type="button" aria-expanded="false">المؤقت</button>' +
      '<button class="btn ghost" id="selQs" type="button">تحديد للحذف</button>' +
      '<button class="btn" id="wakeBtn" type="button" aria-pressed="false" hidden>إبقاء الشاشة شغالة</button></div></div>' +
      '<form class="timer-panel" id="timerPanel" hidden autocomplete="off">' +
      '<label for="tm-min">مدة المجلس بالدقائق</label><input class="input" id="tm-min" type="number" min="5" max="300" step="5" inputmode="numeric" value="45">' +
      '<button class="btn primary" type="submit" id="tmStart">ابدأ المؤقت</button><button class="btn ghost" type="button" id="tmStop" hidden>إيقاف المؤقت</button>' +
      '<span class="hint">إذا قرب الوقت يخلص، ينبهك على الأسئلة الأساسية اللي ما سألتها.</span></form>' +
      '<p class="time-alert" id="timeAlert" hidden></p>' +
      '<div class="groups" id="groups"></div>' +
      '<form class="add-q" id="addQ" autocomplete="off"><span class="lbl">سؤال جديد</span>' +
      '<textarea class="note" id="aq-text" placeholder="اكتب السؤال" style="min-height:72px"></textarea>' +
      '<div class="add-row"><div class="field"><label for="aq-group">القسم</label><select class="input" id="aq-group">' +
      GROUPS.map(function (g) { return '<option value="' + g.key + '">' + g.label + '</option>'; }).join('') +
      '</select></div><button class="btn primary" type="submit">إضافة السؤال</button></div></form>' +
      '</section>' +
      recSectionHtml() +
      '<section class="sec" id="sec-notes" aria-labelledby="h-notes"><h2 id="h-notes">ملاحظات عامة</h2><div class="notes-grid">' +
      '<div class="field"><label for="m-books">كتب وآثار ذكرها الشيخ</label><textarea class="note" id="m-books" data-f="books" placeholder="اكتب أسماء الكتب والآثار كما ذكرها"></textarea></div>' +
      '<div class="field"><label for="m-general">فوائد وأفكار للتطبيق</label><textarea class="note" id="m-general" data-f="general" placeholder="أي فائدة أو فكرة تبي تطبقها مع طلابك"></textarea></div>' +
      '</div><div class="btns"><button class="btn primary" id="copyAll" type="button">نسخ الجلسة كاملة</button><button class="btn" id="copyQ" type="button">نسخ الأسئلة فقط</button>' +
      '<button class="btn" id="dlDoc" type="button">تنزيل Word</button><button class="btn" id="printBtn" type="button">طباعة أو PDF</button></div>' +
      '<span class="hint">ملف Word والطباعة فيها الأسئلة والأجوبة والفوائد والكتب، بدون التحضير وتحليل الشخصية.</span>' +
      (aiOk() ? '<div class="ai-tools" id="aiTools"><span class="lbl">أدوات الذكاء الاصطناعي</span><div class="btns">' +
        '<button class="btn" type="button" data-ai-tool="guidance">استخرج التوجيهات</button>' +
        '<button class="btn" type="button" data-ai-tool="next">أسئلة للمجلس الجاي</button>' +
        '<button class="btn" type="button" data-ai-tool="thanks">رسالة شكر للشيخ</button></div>' +
        '<div class="ai-out" id="aiToolOut" hidden></div></div>' : '') +
      '<textarea id="copyBox" readonly hidden aria-label="النص للنسخ"></textarea></section>' +
      richSection('sec-brief', 'عن الشيخ', 'briefing', 'اكتب هنا ما تعرفه عن الشيخ وأسلوبه.') +
      '<div class="danger-zone"><button class="btn ghost" id="delSession" type="button">حذف الجلسة</button></div>' +
      '</div></main>';
    wireSession();
    wireRec(sid);
    paintRecPanel(sid);
    var rq = document.getElementById('recQuick');
    if (rq) rq.addEventListener('click', function () {
      var sec = document.getElementById('sec-rec');
      if (!REC && !UP[sid] && ai && ai.store) recStart(sid);
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    refreshStatus();
    loadSession(sid, true);
  }

  function loadSession(sid, first) {
    api('/api/majlis?id=' + encodeURIComponent(sid)).then(function (j) {
      if (!cur || cur.sid !== sid) return;
      applyServer(j, first);
    }, function (err) {
      if (!cur || cur.sid !== sid || !first) return;
      var l = document.getElementById('loading');
      if (l) l.textContent = err.status === 404 ? 'ما لقيت هذه الجلسة. ارجع لكل الجلسات.' : 'ما قدرت أحمّل الجلسة. تأكد من الاتصال وحدّث الصفحة.';
    });
  }

  function applyServer(j, first) {
    var sid = cur.sid, data = j.majlis || {};
    cur.meta = cur.meta || {};
    cur.share = data.shareToken || null;
    META_FIELDS.forEach(function (f) {
      var k = 'm/' + sid + '/' + f;
      var el = document.getElementById(f === 'opening' || f === 'briefing' ? 'ri-' + f : 'm-' + f);
      if (pending(k) || drafts[k] || (el && document.activeElement === el) || cur.richEdit[f]) return;
      cur.meta[f] = str(data[f]);
    });
    var seen = {};
    (j.questions || []).forEach(function (b) {
      var id = b.id;
      if (cur.deleting[id]) return;
      seen[id] = true;
      var q = cur.qs[id] || (cur.qs[id] = {});
      var ak = 'a/' + sid + '/' + id, kk = 'k/' + sid + '/' + id;
      var ans = cur.els[id] && cur.els[id].querySelector('textarea.answer');
      if (!cur.editing[id] && !pending('t/' + sid + '/' + id)) {
        q.text = str(b.text); q.why = str(b.why);
        q.group = GLABEL[b.group] ? b.group : 'core';
      }
      if (!pending('o/' + sid + '/' + id)) q.order = typeof b.order === 'number' ? b.order : 0;
      if (!pending(kk)) q.asked = !!b.asked;
      if (!pending(ak) && !drafts[ak] && !(ans && document.activeElement === ans)) q.answer = str(b.answer);
    });
    Object.keys(cur.qs).forEach(function (id) { if (!seen[id] && !cur.creating[id]) delete cur.qs[id]; });
    if (first) {
      Object.keys(drafts).forEach(function (k) {
        var d = drafts[k];
        if (!d || d.sid !== sid) return;
        if (d.kind === 'm') { cur.meta[d.field] = str(d.value); writeMeta(d.field, 0); }
        else if (d.kind === 'a') {
          if (!cur.qs[d.qid]) { clearDraft(k); return; }
          cur.qs[d.qid].answer = str(d.value); writeAnswer(d.qid, 0);
        }
      });
    }
    cur.loaded = true;
    paintMeta();
    renderQuestions();
    if (first) loadRecs(sid);
    if (first && cur.jump) { var jq = cur.jump; setTimeout(function () { jumpTo(jq); }, 60); }
    var l = document.getElementById('loading'), body = document.getElementById('sessionBody');
    if (l) l.hidden = true;
    if (body) body.hidden = false;
    document.querySelectorAll('textarea.note').forEach(grow);
    refreshStatus();
  }

  // pick up edits made on another device when coming back to the page
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { flushAll(); return; }
    if (view === 'session' && cur && cur.loaded && !anyPending()) loadSession(cur.sid, false);
    if (view === 'home') api('/api/data').then(function (j) { checkBuild(j); list = j.majalis || []; if (view === 'home') renderList(); }, function () {});
  });

  function richSection(id, title, field, placeholder) {
    return '<section class="sec" id="' + id + '" aria-labelledby="h-' + id + '"><div class="sec-head"><h2 id="h-' + id + '">' + title + '</h2>' +
      '<button class="btn" type="button" data-rich="' + field + '">تعديل</button></div>' +
      '<div class="rich" id="rv-' + field + '"></div>' +
      '<div id="re-' + field + '" hidden class="field"><textarea class="note rich-in" id="ri-' + field + '" data-f="' + field + '" placeholder="' + placeholder + '"></textarea>' +
      '<span class="hint">للتنسيق: سطر يبدأ بـ ## عنوان، و### عنوان فرعي، و- نقطة، و1. رقم، و&gt; اقتباس، و**نص** للتمييز.</span></div></section>';
  }

  function grow(ta) { if (!ta || ta.offsetParent === null) return; ta.style.height = 'auto'; ta.style.height = Math.max(ta.classList.contains('rich-in') ? 260 : 96, ta.scrollHeight + 2) + 'px'; }
  window.addEventListener('resize', function () { document.querySelectorAll('textarea.note').forEach(grow); });

  function paintMeta() {
    if (!cur || !cur.meta) return;
    ['sheikh', 'topic', 'date', 'time', 'place', 'books', 'general'].forEach(function (f) {
      var el = document.getElementById('m-' + f);
      var v = cur.meta[f] || '';
      if (el && document.activeElement !== el && el.value !== v) { el.value = v; if (el.tagName === 'TEXTAREA') grow(el); }
    });
    var d = fmtDate(cur.meta.date);
    document.getElementById('m-hijri').textContent = d.h ? d.h : '';
    ['opening', 'briefing'].forEach(function (f) {
      var v = document.getElementById('rv-' + f);
      if (!cur.richEdit[f]) {
        v.innerHTML = cur.meta[f] ? md(cur.meta[f]) : '<p class="rich-empty">' + (f === 'opening' ? 'ما فيه تحضير بعد. اضغط «تعديل» واكتب افتتاحك.' : 'ما فيه معلومات عن الشيخ بعد. اضغط «تعديل» وأضفها.') + '</p>';
      }
    });
    document.title = cur.meta.sheikh ? 'مجلس ' + cur.meta.sheikh : 'مجالس المشايخ';
  }

  function writeMeta(f, delay) {
    var sid = cur.sid, k = 'm/' + sid + '/' + f, val = cur.meta[f] || '';
    if (f === 'sheikh' && !val.trim()) return;
    setDraft(k, { sid: sid, kind: 'm', field: f, value: val });
    enqueue(k, function () { var o = {}; o[f] = val; return act('updateMajlis', { id: sid, fields: o }); }, delay, k);
  }
  function writeAnswer(qid, delay) {
    var sid = cur.sid, k = 'a/' + sid + '/' + qid, val = cur.qs[qid].answer || '';
    setDraft(k, { sid: sid, kind: 'a', qid: qid, value: val });
    enqueue(k, function () { return act('updateQ', { id: qid, fields: { answer: val } }); }, delay, k);
  }
  function writeQ(qid, prefix, fields) {
    var sid = cur.sid;
    enqueue(prefix + '/' + sid + '/' + qid, function () { return act('updateQ', { id: qid, fields: fields }); }, 0);
  }

  function sortedQs() {
    var by = { core: [], ask: [], spare: [] };
    Object.keys(cur.qs).forEach(function (id) { var q = cur.qs[id]; (by[q.group] || by.core).push(id); });
    Object.keys(by).forEach(function (g) { by[g].sort(function (a, b) { return (cur.qs[a].order || 0) - (cur.qs[b].order || 0) || (a < b ? -1 : 1); }); });
    return by;
  }

  function buildQ(id) {
    var li = document.createElement('li');
    li.className = 'q'; li.dataset.qid = id; li.dataset.sel = id; li.dataset.selKind = 'qs';
    li.innerHTML =
      '<span class="q-num" aria-hidden="true"></span><div class="q-body">' +
      '<div class="q-view"><p class="q-text"></p><p class="q-why" hidden></p></div>' +
      '<div class="q-edit" hidden>' +
      '<div class="field"><label for="qe-t-' + id + '">نص السؤال</label><textarea class="note qe-t" id="qe-t-' + id + '" style="min-height:80px"></textarea></div>' +
      '<div class="field"><label for="qe-w-' + id + '">ملاحظة لك (اختياري)</label><input class="input qe-w" id="qe-w-' + id + '" placeholder="ليش هذا السؤال مهم مع هذا الشيخ"></div>' +
      '<div class="field"><label for="qe-g-' + id + '">القسم</label><select class="input qe-g" id="qe-g-' + id + '">' +
      GROUPS.map(function (g) { return '<option value="' + g.key + '">' + g.label + '</option>'; }).join('') + '</select></div>' +
      '<div class="btns"><button class="btn primary" type="button" data-act="save">حفظ</button><button class="btn ghost" type="button" data-act="cancel">إلغاء</button></div></div>' +
      '<div class="q-row"><label class="asked" for="ck-' + id + '"><input type="checkbox" id="ck-' + id + '"><span>سألته</span></label>' +
      '<span class="tools"><button class="icon-btn" type="button" data-act="up" aria-label="تقديم">↑</button><button class="icon-btn" type="button" data-act="down" aria-label="تأخير">↓</button>' +
      '<button class="icon-btn" type="button" data-act="edit">تعديل</button><button class="icon-btn" type="button" data-act="del">حذف</button></span></div>' +
      '<div class="field"><label for="ans-' + id + '">جواب الشيخ</label><textarea class="note answer" id="ans-' + id + '" placeholder="اكتب خلاصة جوابه هنا"></textarea>' +
      '<div class="ans-tools"><button class="icon-btn star-btn" type="button" data-act="star">أضف المحدد للفوائد</button>' +
      (aiOk() ? '<button class="icon-btn ai-btn" type="button" data-act="tidy">رتّب بالذكاء الاصطناعي</button>' : '') + '</div>' +
      '<div class="ai-prev" hidden></div></div>' +
      '</div>';
    return li;
  }

  function renderQuestions() {
    if (!cur) return;
    var host = document.getElementById('groups');
    var by = sortedQs();
    var n = 0;
    GROUPS.forEach(function (g) {
      var ids = by[g.key];
      var gEl = document.getElementById('g-' + g.key);
      if (!gEl) {
        gEl = document.createElement('div'); gEl.className = 'group'; gEl.id = 'g-' + g.key;
        gEl.innerHTML = '<div class="group-head"><h3>' + g.label + '</h3>' + (g.note ? '<span>' + g.note + '</span>' : '') + '</div><ol class="qlist"></ol>';
        host.appendChild(gEl);
      }
      gEl.hidden = ids.length === 0 && g.key !== 'core';
      var ol = gEl.querySelector('.qlist');
      ids.forEach(function (id, i) {
        n++;
        var li = cur.els[id] || (cur.els[id] = buildQ(id));
        if (ol.children[i] !== li) ol.insertBefore(li, ol.children[i] || null);
        paintQ(id, n, i === 0, i === ids.length - 1);
      });
      while (ol.children.length > ids.length) ol.removeChild(ol.children[ids.length]);
      if (g.key === 'core' && ids.length === 0) ol.innerHTML = '<li class="empty">ما فيه أسئلة بعد. أضف أول سؤال من تحت.</li>';
    });
    Object.keys(cur.els).forEach(function (id) { if (!cur.qs[id]) { var el = cur.els[id]; if (el.parentNode) el.parentNode.removeChild(el); delete cur.els[id]; } });
    var core = by.core, done = core.filter(function (id) { return cur.qs[id].asked; }).length;
    document.getElementById('progress').textContent = n === 0 ? '' :
      (done === 0 ? 'ما سألت شيئًا بعد' : 'سألت ' + ar(done) + ' من ' + ar(core.length) + ' أسئلة أساسية');
    paintTimer();
  }

  function paintQ(id, num, first, last) {
    var q = cur.qs[id], li = cur.els[id];
    li.classList.toggle('done', !!q.asked);
    li.querySelector('.q-num').textContent = ar(num);
    li.querySelector('.q-text').textContent = q.text || '';
    var why = li.querySelector('.q-why');
    why.textContent = q.why || ''; why.hidden = !q.why;
    var ck = li.querySelector('input[type=checkbox]'); if (ck.checked !== !!q.asked) ck.checked = !!q.asked;
    var ans = li.querySelector('textarea.answer');
    if (document.activeElement !== ans && ans.value !== (q.answer || '')) { ans.value = q.answer || ''; grow(ans); }
    li.querySelector('[data-act=up]').disabled = first;
    li.querySelector('[data-act=down]').disabled = last;
  }

  /* app-level listeners: attached once, they read the current session from `cur` */
  app.addEventListener('input', function (e) {
    var t = e.target;
    if (view !== 'session' || !cur || !cur.meta) return;
    if (t.dataset && t.dataset.f) {
      cur.meta[t.dataset.f] = t.value;
      if (t.tagName === 'TEXTAREA') grow(t);
      if (t.dataset.f === 'date') paintMeta();
      writeMeta(t.dataset.f, t.dataset.f === 'date' || t.dataset.f === 'time' ? 0 : 900);
      return;
    }
    if (t.classList && t.classList.contains('answer')) {
      var qid = t.closest('.q').dataset.qid;
      if (!cur.qs[qid]) return;
      cur.qs[qid].answer = t.value; grow(t);
      writeAnswer(qid, 900);
      return;
    }
    if (t.tagName === 'TEXTAREA' && t.classList.contains('note')) grow(t);
  });
  app.addEventListener('focusout', function (e) {
    var t = e.target; if (view !== 'session' || !cur) return;
    if (t.dataset && t.dataset.f) { var k = 'm/' + cur.sid + '/' + t.dataset.f; if (WQ[k] && WQ[k].timer) run(k); }
    if (t.classList && t.classList.contains('answer')) { var k2 = 'a/' + cur.sid + '/' + t.closest('.q').dataset.qid; if (WQ[k2] && WQ[k2].timer) run(k2); }
  });
  app.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-rich]'); if (!b || !cur || !cur.meta) return;
    var f = b.dataset.rich;
    var editing = !cur.richEdit[f];
    cur.richEdit[f] = editing;
    document.getElementById('rv-' + f).hidden = editing;
    document.getElementById('re-' + f).hidden = !editing;
    b.textContent = editing ? 'تم' : 'تعديل';
    if (editing) { var ta = document.getElementById('ri-' + f); ta.value = cur.meta[f] || ''; grow(ta); ta.focus(); }
    else { var k = 'm/' + cur.sid + '/' + f; if (WQ[k] && WQ[k].timer) run(k); paintMeta(); }
  });

  function wireSession() {
    document.querySelector('nav.bar .links').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-jump]'); if (!b) return;
      var t = document.getElementById(b.dataset.jump); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    var groups = document.getElementById('groups');
    groups.addEventListener('change', function (e) {
      var t = e.target; if (t.type !== 'checkbox') return;
      var qid = t.closest('.q').dataset.qid; if (!cur.qs[qid]) return;
      cur.qs[qid].asked = t.checked;
      writeQ(qid, 'k', { asked: t.checked });
      renderQuestions();
    });
    groups.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]'); if (!b) return;
      var li = b.closest('.q'); var qid = li.dataset.qid; var q = cur.qs[qid]; if (!q) return;
      var actName = b.dataset.act;
      if (actName === 'star') { starFrom(li.querySelector('textarea.answer')); return; }
      if (actName === 'tidy' || actName === 'tidyOk' || actName === 'tidyNo') { tidyAction(actName, qid, li, b); return; }
      if (actName === 'up' || actName === 'down') {
        var lst = sortedQs()[q.group];
        var i = lst.indexOf(qid), j = actName === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= lst.length) return;
        lst.splice(i, 1); lst.splice(j, 0, qid);
        lst.forEach(function (id, idx) {
          if (cur.qs[id].order !== idx) { cur.qs[id].order = idx; writeQ(id, 'o', { order: idx }); }
        });
        renderQuestions();
        return;
      }
      if (actName === 'edit') {
        cur.editing[qid] = true;
        li.querySelector('.q-view').hidden = true; li.querySelector('.q-edit').hidden = false;
        var ta = li.querySelector('.qe-t'); ta.value = q.text || ''; grow(ta);
        li.querySelector('.qe-w').value = q.why || '';
        li.querySelector('.qe-g').value = q.group;
        ta.focus();
        return;
      }
      if (actName === 'cancel' || actName === 'save') {
        if (actName === 'save') {
          var text = li.querySelector('.qe-t').value.trim();
          if (!text) return;
          var why = li.querySelector('.qe-w').value.trim();
          var group = li.querySelector('.qe-g').value;
          var fields = { text: text, why: why };
          if (group !== q.group) {
            var target = sortedQs()[group];
            var ord = target.length ? (cur.qs[target[target.length - 1]].order || 0) + 1 : 0;
            fields.group = group; fields.order = ord; q.group = group; q.order = ord;
          }
          q.text = text; q.why = why;
          writeQ(qid, 't', fields);
        }
        cur.editing[qid] = false;
        li.querySelector('.q-view').hidden = false; li.querySelector('.q-edit').hidden = true;
        renderQuestions();
        return;
      }
      if (actName === 'del') {
        if (!b.classList.contains('arm')) {
          b.classList.add('arm'); b.textContent = 'تأكيد الحذف';
          setTimeout(function () { b.classList.remove('arm'); b.textContent = 'حذف'; }, 3000);
          return;
        }
        var sid = cur.sid, ak = 'a/' + sid + '/' + qid;
        delete cur.qs[qid];
        cur.deleting[qid] = true;
        if (WQ[ak]) { clearTimeout(WQ[ak].timer); WQ[ak].timer = null; WQ[ak].fn = null; WQ[ak].failed = false; }
        clearDraft(ak);
        enqueue('d/' + sid + '/' + qid, function () { return act('deleteQ', { id: qid }); }, 0);
        renderQuestions();
      }
    });

    document.getElementById('addQ').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!cur) return;
      var ta = document.getElementById('aq-text');
      var text = ta.value.trim(); if (!text) return;
      var group = document.getElementById('aq-group').value;
      var lst = sortedQs()[group];
      var ord = lst.length ? (cur.qs[lst[lst.length - 1]].order || 0) + 1 : 0;
      var qid = newId(), sid = cur.sid;
      cur.qs[qid] = { text: text, why: '', group: group, order: ord, asked: false, answer: '' };
      cur.creating[qid] = true;
      enqueue('c/' + sid + '/' + qid, function () {
        return act('addQ', { majlisId: sid, id: qid, fields: { text: text, group: group, order: ord } }).then(function () { if (cur) delete cur.creating[qid]; });
      }, 0);
      ta.value = ''; grow(ta);
      renderQuestions();
      var el = cur.els[qid]; if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    var copyBox = document.getElementById('copyBox');
    function text(withAnswers) {
      var m = cur.meta || {}, d = fmtDate(m.date);
      var lines = ['مجلس مع ' + (m.sheikh || 'الشيخ')];
      if (m.topic) lines.push('الموضوع: ' + m.topic);
      if (d.g) lines.push('التاريخ: ' + d.g + (d.h ? ' (' + d.h + ')' : ''));
      if (m.place) lines.push('المكان: ' + m.place);
      lines.push('');
      var by = sortedQs(), n = 0;
      GROUPS.forEach(function (g) {
        if (!by[g.key].length) return;
        lines.push(g.label + ':');
        by[g.key].forEach(function (id) {
          n++; var q = cur.qs[id];
          lines.push(ar(n) + '. ' + q.text);
          if (withAnswers && (q.answer || '').trim()) lines.push('الجواب: ' + q.answer.trim());
        });
        lines.push('');
      });
      if (withAnswers) {
        if ((m.books || '').trim()) lines.push('كتب وآثار ذكرها الشيخ:', m.books.trim(), '');
        if ((m.general || '').trim()) lines.push('فوائد وأفكار للتطبيق:', m.general.trim(), '');
      }
      return lines.join('\n').trim();
    }
    function wire(btn, withAnswers) {
      var label = btn.textContent;
      btn.addEventListener('click', function () {
        if (!cur || !cur.meta) return;
        var t = text(withAnswers);
        function fallback() { copyBox.value = t; copyBox.hidden = false; copyBox.focus(); copyBox.select(); btn.textContent = 'حدّد النص وانسخه'; setTimeout(function () { btn.textContent = label; }, 3000); }
        try {
          navigator.clipboard.writeText(t).then(function () { copyBox.hidden = true; btn.textContent = 'تم النسخ'; setTimeout(function () { btn.textContent = label; }, 2000); }, fallback);
        } catch (e) { fallback(); }
      });
    }
    wire(document.getElementById('copyAll'), true);
    wire(document.getElementById('copyQ'), false);
    document.getElementById('dlDoc').addEventListener('click', function () { if (cur && cur.meta) downloadDocx(fileName(curAsRecord()) + '.docx', [curAsRecord()]); });
    document.getElementById('printBtn').addEventListener('click', function () { if (cur && cur.meta) printRecords([curAsRecord()]); });
    var aiTools = document.getElementById('aiTools');
    if (aiTools) aiTools.addEventListener('click', function (e) { var b = e.target.closest('[data-ai-tool]'); if (b) runTool(b.dataset.aiTool, b); });

    var del = document.getElementById('delSession');
    del.addEventListener('click', function () {
      if (!cur) return;
      if (!del.classList.contains('arm')) {
        del.classList.add('arm'); del.textContent = 'اضغط مرة ثانية لحذف الجلسة وكل أسئلتها';
        setTimeout(function () { del.classList.remove('arm'); del.textContent = 'حذف الجلسة'; }, 4000);
        return;
      }
      var sid = cur.sid;
      del.disabled = true; del.textContent = 'جاري الحذف';
      act('deleteMajlis', { id: sid }).then(function () {
        Object.keys(drafts).forEach(function (k) { if (drafts[k] && drafts[k].sid === sid) delete drafts[k]; }); saveDrafts();
        list = list.filter(function (s) { return s.id !== sid; });
        location.hash = '';
      }, function () { del.disabled = false; del.classList.remove('arm'); del.textContent = 'ما انحذفت، جرّب مرة ثانية'; });
    });

    document.getElementById('focusBtn').addEventListener('click', openFocus);
    document.getElementById('selQs').addEventListener('click', function () { startSel('qs'); });
    document.getElementById('icsBtn').addEventListener('click', function (e) {
      e.preventDefault();
      if (!cur || !cur.meta) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cur.meta.date || '')) { toast('حدّد تاريخ المجلس أول'); document.getElementById('m-date').focus(); return; }
      var sid = cur.sid, keys = ['date', 'time', 'place', 'topic', 'sheikh'].map(function (f) { return 'm/' + sid + '/' + f; });
      keys.forEach(function (k) { if (WQ[k] && WQ[k].timer) run(k); });
      var tries = 0;
      (function go() {
        if (keys.some(pending) && tries++ < 30) { setTimeout(go, 150); return; }
        location.href = '/api/ics?id=' + encodeURIComponent(sid);
      })();
    });
    document.getElementById('shareBtn').addEventListener('click', function () {
      var pn = document.getElementById('sharePanel'), btn = document.getElementById('shareBtn');
      pn.hidden = !pn.hidden; btn.setAttribute('aria-expanded', pn.hidden ? 'false' : 'true');
      if (!pn.hidden) paintShare();
    });
    var timerBtn = document.getElementById('timerBtn'), panel = document.getElementById('timerPanel');
    timerBtn.addEventListener('click', function () {
      panel.hidden = !panel.hidden; timerBtn.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
      var st = timerState(cur.sid);
      document.getElementById('tmStop').hidden = !st;
      document.getElementById('tmStart').textContent = st ? 'ابدأ من جديد' : 'ابدأ المؤقت';
      if (st) document.getElementById('tm-min').value = st.dur;
    });
    panel.addEventListener('submit', function (e) {
      e.preventDefault();
      var m = Math.round(Number(document.getElementById('tm-min').value));
      if (!(m >= 5 && m <= 300)) { toast('اكتب مدة من ٥ إلى ٣٠٠ دقيقة'); return; }
      setTimerState(cur.sid, { start: Date.now(), dur: m });
      panel.hidden = true; timerBtn.setAttribute('aria-expanded', 'false');
      paintTimer(); toast('بدأ المؤقت: ' + nMin(m));
    });
    document.getElementById('tmStop').addEventListener('click', function () {
      setTimerState(cur.sid, null); panel.hidden = true; timerBtn.setAttribute('aria-expanded', 'false'); paintTimer();
    });

    var wakeBtn = document.getElementById('wakeBtn');
    if ('wakeLock' in navigator) {
      wakeBtn.hidden = false;
      paintWake();
      wakeBtn.addEventListener('click', function () {
        if (wake.lock) { wake.want = false; wake.lock.release(); return; }
        wake.want = true; wake.acquire().catch(function () { wake.want = false; wakeBtn.hidden = true; });
      });
    }
  }

  /* ================= AI TOOLS ================= */
  function aiOk() { return !!(ai && ai.ready && ai.allowed); }
  function renderRefs(html, refs) {
    return html.replace(/\[\[(q|s):([a-z0-9]+)(?:~([a-z0-9]+))?\]\]/g, function (m, k, id, qid) {
      var label = (refs && refs[id]) || 'الجلسة';
      return '<a class="ref" href="#s-' + id + (k === 'q' && qid ? '~' + qid : '') + '">' + esc(label) + '</a>';
    });
  }
  var CHAT_SUGGEST = ['كم مجلس حضرت، ومع مين أكثر؟', 'وش أفضل فائدة مرت علي؟ وليش؟', 'لخّص لي أهم توجيهات المشايخ', 'وش الأسئلة اللي ما كتبت جوابها؟', 'وش تنصحني أركز عليه في المجلس الجاي؟'];
  function suggestHtml() {
    return '<div class="chat-sugg" role="list">' + CHAT_SUGGEST.map(function (t) { return '<button class="sugg" type="button" role="listitem" data-sugg="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') + '</div>';
  }
  function askHtml() {
    if (!aiOk()) return '';
    return '<section class="ask-card" aria-labelledby="ask-h"><h2 id="ask-h">سولف مع دفترك</h2>' +
      '<p class="lede">يعرف كل جلساتك. اسأله كم مجلس حضرت، أو وين قال الشيخ فائدة معيّنة، أو اطلب رأيه في أفضل فائدة.</p>' +
      '<form id="askForm" class="ask-form" autocomplete="off"><label class="lbl" for="askQ" hidden>رسالتك</label><input class="input" id="askQ" placeholder="اكتب رسالتك"><button class="btn primary" type="submit">أرسل</button></form>' +
      suggestHtml() + '</section>';
  }
  function wireAsk() {
    var f = document.getElementById('askForm'); if (!f) return;
    function go(q) { chatPending = q; location.hash = 'chat'; }
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = document.getElementById('askQ').value.trim();
      if (q.length < 2) { toast('اكتب رسالتك'); return; }
      go(q);
    });
    f.parentNode.querySelectorAll('[data-sugg]').forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.sugg); }); });
  }

  /* ================= CHAT with the notebook ================= */
  var chat = { msgs: null, busy: false, ctl: null, uid: null }, chatPending = null;
  function chatKey() { return 'majalis-chat-v1:' + ((me && me.id) || ''); }
  function chatLoad() {
    if (chat.msgs && chat.uid === (me && me.id)) return;
    chat.uid = me && me.id; chat.msgs = [];
    try { var x = JSON.parse(localStorage.getItem(chatKey()) || '[]'); if (Array.isArray(x)) chat.msgs = x.filter(function (m) { return m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'; }); } catch (e) {}
  }
  function chatSave() {
    try { localStorage.setItem(chatKey(), JSON.stringify(chat.msgs.slice(-40).map(function (m) { return { role: m.role, content: m.content, error: m.error || '', stopped: !!m.stopped }; }))); } catch (e) {}
  }
  function chatRefs() {
    var r = {};
    (list || []).forEach(function (m) {
      var n = String(m.sheikh || '').replace(/^\s*(فضيلة\s+)?(الشيخ|الدكتور|د\.)\s*/, '').trim() || 'الجلسة', d = fmtDate(str(m.date)).g;
      r[m.id] = n + (d ? ' · ' + d : '');
    });
    return r;
  }
  function chatBody(m, live) {
    var t = String(m.content || '');
    if (live) t = t.replace(/\[\[[^\]]*\]?$/, '');
    var html = renderRefs(md(t), chatRefs()).replace(/\[\[[^\]]*\]\]/g, '');
    return html;
  }
  function msgHtml(m, i) {
    if (m.role === 'user') return '<div class="msg me" data-i="' + i + '"><div class="bubble">' + esc(m.content).replace(/\n/g, '<br>') + '</div></div>';
    var live = chat.busy && i === chat.msgs.length - 1;
    var body = m.content ? '<div class="rich">' + chatBody(m, live) + '</div>' : (live ? '<p class="typing" aria-label="يكتب"><span></span><span></span><span></span></p>' : '');
    var foot = '';
    if (m.error) foot = '<p class="login-err">' + esc(m.error) + '</p><div class="btns"><button class="btn" type="button" data-chat="retry">أعد المحاولة</button></div>';
    else if (m.stopped) foot = '<p class="hint">وقّفت الرد.</p>';
    else if (!live && m.content) foot = '<div class="msg-tools"><button class="linkish" type="button" data-chat="copy" data-i="' + i + '">نسخ</button></div>';
    return '<div class="msg bot" data-i="' + i + '">' + body + foot + '</div>';
  }
  function paintChat() {
    var th = document.getElementById('chatThread'); if (!th || view !== 'chat') return;
    th.innerHTML = chat.msgs.length ? chat.msgs.map(msgHtml).join('') :
      '<div class="chat-empty"><p class="lede">ابدأ بأي سؤال، أو اختر واحد من هذي:</p>' + suggestHtml() + '</div>';
    th.querySelectorAll('[data-sugg]').forEach(function (b) { b.addEventListener('click', function () { sendChat(b.dataset.sugg); }); });
    var nb = document.getElementById('chatNew'); if (nb) nb.hidden = !chat.msgs.length;
    paintComposer();
  }
  var paintRaf = 0;
  function paintLast() {
    if (paintRaf) return;
    paintRaf = requestAnimationFrame(function () {
      paintRaf = 0;
      var th = document.getElementById('chatThread'); if (!th || view !== 'chat') return;
      var i = chat.msgs.length - 1, el = th.querySelector('.msg[data-i="' + i + '"]');
      var stick = nearBottom();
      if (el) el.outerHTML = msgHtml(chat.msgs[i], i); else { paintChat(); }
      if (stick) scrollChatEnd();
    });
  }
  function nearBottom() { return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160; }
  function scrollChatEnd() { window.scrollTo(0, document.documentElement.scrollHeight); }
  function paintComposer() {
    var send = document.getElementById('chatSend'), stop = document.getElementById('chatStop');
    if (!send) return;
    send.hidden = chat.busy; stop.hidden = !chat.busy;
  }
  function chatHistory() {
    return chat.msgs.filter(function (m) { return m.content && !(m.role === 'assistant' && m.error && !m.content); })
      .slice(-16).map(function (m) { return { role: m.role, content: m.content }; });
  }
  function sendChat(txt, isRetry) {
    txt = String(txt || '').trim();
    if (!txt || chat.busy) return;
    chatLoad();
    if (!isRetry) chat.msgs.push({ role: 'user', content: txt });
    var hist = chatHistory();
    var a = { role: 'assistant', content: '' };
    chat.msgs.push(a); chat.busy = true;
    var ctl = window.AbortController ? new AbortController() : null; chat.ctl = ctl;
    paintChat(); scrollChatEnd(); chatSave();
    fetch('/api/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'chat', messages: hist }), signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { if (r.status === 401) showLogin(); throw new ApiErr(r.status, j.error || 'تعذّر الاتصال'); });
        if (!r.body || !r.body.getReader || !window.TextDecoder) return r.text().then(function (t) { a.content = t; });
        var reader = r.body.getReader(), dec = new TextDecoder();
        function pump() {
          return reader.read().then(function (x) {
            if (x.done) { a.content += dec.decode(); return; }
            a.content += dec.decode(x.value, { stream: true }); paintLast(); return pump();
          });
        }
        return pump();
      })
      .then(null, function (e) {
        if (e && e.name === 'AbortError') { a.stopped = true; return; }
        a.error = (e && e instanceof ApiErr) ? e.message : 'انقطع الاتصال، جرّب مرة ثانية';
      })
      .then(function () {
        var k = a.content.indexOf('\u0000');
        if (k !== -1) { a.error = a.content.slice(k + 1).trim() || 'انقطع الرد'; a.content = a.content.slice(0, k).trim(); }
        a.content = a.content.trim();
        if (!a.content && !a.error && !a.stopped) a.error = 'ما وصل رد، جرّب مرة ثانية';
        chat.busy = false; chat.ctl = null;
        chatSave(); paintChat();
        if (view === 'chat' && nearBottom()) scrollChatEnd();
      });
  }
  function openChat() {
    leaveSession(); view = 'chat'; document.title = 'سولف مع دفترك · مجالس المشايخ';
    chatLoad();
    app.innerHTML = pageTop('chat', 'سولف مع دفترك', 'يعرف كل جلساتك وأجوبة المشايخ فيها. اسأله، واطلب رأيه، وكمّل معه السالفة.') +
      '<main class="home-main wrap chat-main">' +
      (aiOk() ?
        '<div class="chat-bar"><button class="linkish" type="button" id="chatNew">محادثة جديدة</button></div>' +
        '<div class="chat-thread" id="chatThread" aria-live="polite"></div>' +
        '<form class="chat-compose" id="chatForm" autocomplete="off"><label class="lbl" for="chatIn" hidden>رسالتك</label>' +
        '<textarea class="input" id="chatIn" rows="1" placeholder="اكتب رسالتك"></textarea>' +
        '<button class="btn primary" type="submit" id="chatSend">أرسل</button><button class="btn" type="button" id="chatStop" hidden>إيقاف</button></form>' +
        '<p class="hint chat-note">الروابط تحت الردود تفتح الجلسة والسؤال اللي جاءت منه المعلومة. والمحادثة محفوظة في جهازك هذا فقط.</p>'
        : '<p class="empty">' + (ai && !ai.ready ? 'الذكاء الاصطناعي غير مفعّل في الموقع بعد.' : 'المحادثة تحتاج موافقة المدير على استخدام الذكاء الاصطناعي في حسابك.') + '</p>') +
      '</main>';
    if (!aiOk()) return;
    var f = document.getElementById('chatForm'), inp = document.getElementById('chatIn');
    function fit() { inp.style.height = 'auto'; inp.style.height = Math.min(220, inp.scrollHeight + 2) + 'px'; }
    inp.addEventListener('input', fit);
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(hover: hover)').matches) { e.preventDefault(); f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true })); }
    });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      if (chat.busy) return;
      var t = inp.value.trim(); if (!t) return;
      inp.value = ''; fit(); sendChat(t);
    });
    document.getElementById('chatStop').addEventListener('click', function () { if (chat.ctl) chat.ctl.abort(); });
    document.getElementById('chatNew').addEventListener('click', function () {
      if (chat.busy && chat.ctl) chat.ctl.abort();
      chat.msgs = []; chatSave(); paintChat(); inp.focus();
    });
    document.getElementById('chatThread').addEventListener('click', function (e) {
      var b = e.target.closest('[data-chat]'); if (!b) return;
      if (b.dataset.chat === 'retry') {
        if (chat.busy) return;
        var last = chat.msgs[chat.msgs.length - 1];
        if (last && last.role === 'assistant') chat.msgs.pop();
        var u = chat.msgs[chat.msgs.length - 1];
        if (u && u.role === 'user') sendChat(u.content, true);
      } else if (b.dataset.chat === 'copy') {
        var m = chat.msgs[+b.dataset.i]; if (!m) return;
        var plain = String(m.content).replace(/\s*\[\[[^\]]*\]\]/g, '');
        (navigator.clipboard ? navigator.clipboard.writeText(plain) : Promise.reject()).then(function () { toast('انتسخ الرد'); }, function () { toast('ما قدرت أنسخ'); });
      }
    });
    paintChat();
    if (chatPending) { var q = chatPending; chatPending = null; sendChat(q); }
    else if (chat.msgs.length) scrollChatEnd();
    else inp.focus();
  }
  function tidyAction(kind, qid, li, b) {
    var box = li.querySelector('.ai-prev'), q = cur.qs[qid];
    if (kind === 'tidyNo') { box.hidden = true; box.innerHTML = ''; return; }
    if (kind === 'tidyOk') {
      var t = box.dataset.text || '';
      if (t) { q.answer = t; writeAnswer(qid, 0); var ta = li.querySelector('textarea.answer'); ta.value = t; grow(ta); toast('انحفظ الجواب المرتّب'); }
      box.hidden = true; box.innerHTML = ''; return;
    }
    if (!(q.answer || '').trim()) { toast('اكتب الجواب أول'); return; }
    b.disabled = true; var lbl = b.textContent; b.textContent = 'يرتّب…';
    api('/api/assist', { op: 'tidy', qid: qid, answer: q.answer }).then(function (j) {
      b.disabled = false; b.textContent = lbl;
      box.dataset.text = j.answer || '';
      box.hidden = false;
      box.innerHTML = '<span class="lbl">الجواب بعد الترتيب</span><div class="ai-prev-text"></div>' +
        '<div class="btns"><button class="btn primary" type="button" data-act="tidyOk">اعتمده بدل جوابي</button><button class="btn ghost" type="button" data-act="tidyNo">إلغاء</button></div>';
      box.querySelector('.ai-prev-text').textContent = j.answer || '';
    }, function (er) { b.disabled = false; b.textContent = lbl; toast(er.message); });
  }
  function runTool(kind, b) {
    if (!cur) return;
    var out = document.getElementById('aiToolOut'), sid = cur.sid;
    flushAll();
    b.disabled = true; var lbl = b.textContent; b.textContent = 'يجهّز…';
    out.hidden = false; out.innerHTML = '<p class="hint">' + (kind === 'next' ? 'يجهّز أسئلة مبنية على أجوبة الشيخ…' : kind === 'thanks' ? 'يكتب رسالة الشكر…' : 'يقرأ أجوبة الشيخ ويستخرج التوجيهات…') + '</p>';
    setTimeout(function () {
      api('/api/assist', { op: kind, id: sid }).then(function (j) {
        b.disabled = false; b.textContent = lbl;
        if (!cur || cur.sid !== sid) return;
        if (kind === 'guidance') {
          out.innerHTML = '<span class="lbl">التوجيهات العملية</span><div class="rich"></div>' +
            '<div class="btns"><button class="btn primary" type="button" id="gAdd">أضفها للفوائد</button><button class="btn ghost" type="button" id="gNo">إغلاق</button></div>';
          out.querySelector('.rich').innerHTML = md(j.lines);
          document.getElementById('gAdd').addEventListener('click', function () {
            var g = cur.meta.general || '';
            cur.meta.general = (g.trim() ? g.replace(/\s+$/, '') + '\n' : '') + j.lines.trim();
            writeMeta('general', 0); paintMeta(); out.hidden = true; toast('انضافت للفوائد');
          });
          document.getElementById('gNo').addEventListener('click', function () { out.hidden = true; });
        } else if (kind === 'thanks') {
          out.innerHTML = '<label class="lbl" for="thTxt">رسالة الشكر (تقدر تعدّلها)</label><textarea class="note" id="thTxt"></textarea>' +
            '<div class="btns"><button class="btn primary" type="button" id="thCopy">نسخ</button><a class="btn" id="thWa" target="_blank" rel="noopener">فتح واتساب</a><button class="btn ghost" type="button" id="thNo">إغلاق</button></div>';
          var ta = document.getElementById('thTxt'); ta.value = j.text; grow(ta);
          var wa = document.getElementById('thWa');
          function upd() { wa.href = 'https://wa.me/?text=' + encodeURIComponent(ta.value); }
          upd(); ta.addEventListener('input', function () { upd(); grow(ta); });
          document.getElementById('thCopy').addEventListener('click', function () {
            try { navigator.clipboard.writeText(ta.value).then(function () { toast('انتسخت الرسالة'); }, function () { ta.select(); }); } catch (e) { ta.select(); }
          });
          document.getElementById('thNo').addEventListener('click', function () { out.hidden = true; });
        } else {
          out.innerHTML = '<span class="lbl">أسئلة مقترحة للمجلس الجاي مع ' + esc(j.sheikh || 'الشيخ') + '</span><ul class="next-list">' + j.questions.map(function (q, i) {
            return '<li><label class="asked"><input type="checkbox" checked data-i="' + i + '"><span class="nq"><b></b><small></small></span></label></li>';
          }).join('') + '</ul><div class="btns"><button class="btn primary" type="button" id="nCreate">أنشئ جلسة جديدة بالمحدد</button><button class="btn ghost" type="button" id="nNo">إغلاق</button></div>';
          out.querySelectorAll('.next-list li').forEach(function (li, i) { li.querySelector('b').textContent = j.questions[i].text; li.querySelector('small').textContent = j.questions[i].why || ''; });
          document.getElementById('nNo').addEventListener('click', function () { out.hidden = true; });
          document.getElementById('nCreate').addEventListener('click', function (e) {
            var picked = Array.prototype.filter.call(out.querySelectorAll('input[data-i]'), function (c) { return c.checked; }).map(function (c) { return j.questions[+c.dataset.i]; });
            if (!picked.length) { toast('حدد سؤال واحد على الأقل'); return; }
            var btn = e.target; btn.disabled = true; btn.textContent = 'جاري الإنشاء';
            var nid = newId();
            act('createMajlis', { id: nid, fields: { sheikh: j.sheikh || cur.meta.sheikh, topic: 'متابعة' + (j.topic ? ': ' + j.topic : '') } }).then(function (r) {
              var mid = r.id || nid, chain = Promise.resolve();
              picked.forEach(function (q, i) { chain = chain.then(function () { return act('addQ', { majlisId: mid, id: newId(), fields: { text: q.text, why: q.why || '', group: 'core', order: i } }); }); });
              return chain.then(function () { location.hash = 's-' + mid; });
            }).catch(function (er) { btn.disabled = false; btn.textContent = 'أنشئ جلسة جديدة بالمحدد'; toast(er.message); });
          });
        }
      }, function (er) { b.disabled = false; b.textContent = lbl; out.innerHTML = '<p class="login-err">' + esc(er.message) + '</p>'; });
    }, 300);
  }

  /* ================= ADMIN: WhatsApp notifications ================= */
  function loadWa(devices) {
    api('/api/admin', { op: 'waGet' }).then(function (st) { if (view === 'admin') renderWa(st, devices); }, function (er) { var b = document.getElementById('waBody'); if (b) b.innerHTML = '<p class="login-err">' + esc(er.message) + '</p>'; });
  }
  function renderWa(st, devices) {
    var body = document.getElementById('waBody'); if (!body) return;
    var chip = document.getElementById('waState'); chip.textContent = st.linked ? 'مربوط' : 'مو مربوط'; chip.classList.toggle('off', !st.linked);
    var html = '';
    if (devices && devices.length) {
      html += '<div class="wa-pick"><p>حسابك فيه أكثر من رقم مربوط. اختر الرقم اللي ترسل منه:</p>' + devices.map(function (d, i) {
        return '<button class="btn" type="button" data-wa-dev="' + esc(d.id) + '">' + esc(d.name || 'رقم ' + ar(i + 1)) + '</button>';
      }).join('') + '</div>';
    } else if (!st.linked) {
      html += '<form class="wa-form" id="waLinkForm" autocomplete="off"><b>١. اربط حسابك في الواتس الذكي</b>' +
        '<div class="new-grid"><div class="field"><label for="wa-ph">رقم حسابك في الواتس الذكي</label><input class="input" id="wa-ph" dir="ltr" inputmode="tel" placeholder="05xxxxxxxx"></div>' +
        '<div class="field"><label for="wa-pw">كلمة المرور</label><input class="input" id="wa-pw" type="password" dir="ltr" autocomplete="off"></div></div>' +
        '<span class="hint">نفس الرقم وكلمة المرور اللي تدخل فيها موقع الواتس الذكي. كلمة المرور ما تنحفظ، تُستخدم مرة وحدة للربط.</span>' +
        '<div class="btns"><button class="btn primary" type="submit">اربط</button></div></form>';
    }
    html += '<form class="wa-form" id="waSaveForm" autocomplete="off"><b>' + (st.linked ? '' : '٢. ') + 'وين توصلك الإشعارات</b>' +
      '<div class="field"><label for="wa-to">رقم جوالك</label><input class="input" id="wa-to" dir="ltr" inputmode="tel" placeholder="05xxxxxxxx" value="' + esc(st.notifyPhone || '') + '"></div>' +
      '<label class="asked"><input type="checkbox" id="wa-reg"' + (st.onRegister ? ' checked' : '') + '><span>لما أحد يسجّل وينتظر موافقتك</span></label>' +
      '<label class="asked"><input type="checkbox" id="wa-rem"' + (st.onReminder ? ' checked' : '') + '><span>تذكير قبل مجالسك بيوم (العصر تقريبًا)</span></label>' +
      '<div class="btns"><button class="btn primary" type="submit">حفظ</button>' +
      (st.linked ? '<button class="btn" type="button" id="waTest">رسالة تجريبية</button><button class="btn ghost" type="button" id="waUnlink">إلغاء الربط</button>' : '') + '</div></form>';
    body.innerHTML = html;
    var lf = document.getElementById('waLinkForm');
    if (lf) lf.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = lf.querySelector('button'); btn.disabled = true; btn.textContent = 'جاري الربط';
      api('/api/admin', { op: 'waLink', phone: document.getElementById('wa-ph').value, password: document.getElementById('wa-pw').value }).then(function (j) {
        toast(j.linked ? 'انربط الواتساب' : 'اختر الرقم'); loadWa(j.devices);
      }, function (er) { btn.disabled = false; btn.textContent = 'اربط'; document.getElementById('wa-pw').value = ''; toast(er.message); });
    });
    body.querySelectorAll('[data-wa-dev]').forEach(function (b) {
      b.addEventListener('click', function () { api('/api/admin', { op: 'waPick', device: b.dataset.waDev }).then(function () { toast('انربط الواتساب'); loadWa(); }, function (er) { toast(er.message); }); });
    });
    document.getElementById('waSaveForm').addEventListener('submit', function (e) {
      e.preventDefault();
      api('/api/admin', { op: 'waSave', notifyPhone: document.getElementById('wa-to').value, onRegister: document.getElementById('wa-reg').checked, onReminder: document.getElementById('wa-rem').checked })
        .then(function () { toast('انحفظ'); }, function (er) { toast(er.message); });
    });
    var tb = document.getElementById('waTest');
    if (tb) tb.addEventListener('click', function () {
      tb.disabled = true;
      api('/api/admin', { op: 'waTest' }).then(function () { tb.disabled = false; toast('انرسلت، شيك على جوالك'); }, function (er) { tb.disabled = false; toast(er.message); });
    });
    var ub = document.getElementById('waUnlink');
    if (ub) ub.addEventListener('click', function () {
      if (!ub.classList.contains('arm')) { ub.classList.add('arm'); ub.textContent = 'تأكيد إلغاء الربط'; return; }
      api('/api/admin', { op: 'waUnlink' }).then(function () { toast('انلغى الربط'); loadWa(); }, function (er) { toast(er.message); });
    });
  }

  /* ================= THEME: system / dark / light ================= */
  var THKEY = 'majalis-theme';
  function getTheme() { try { var t = localStorage.getItem(THKEY); return t === 'light' || t === 'dark' ? t : ''; } catch (e) { return ''; } }
  function applyTheme(t) { if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); }
  function themeLabel() { var t = getTheme(); return t === 'dark' ? 'المظهر: داكن' : t === 'light' ? 'المظهر: فاتح' : 'المظهر: تلقائي'; }
  function themeBtnHtml() { return '<button class="linkish" type="button" data-theme-btn>' + themeLabel() + '</button>'; }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-theme-btn]'); if (!b) return;
    var t = getTheme(), nt = t === '' ? 'dark' : t === 'dark' ? 'light' : '';
    try { if (nt) localStorage.setItem(THKEY, nt); else localStorage.removeItem(THKEY); } catch (er) {}
    applyTheme(nt);
    document.querySelectorAll('[data-theme-btn]').forEach(function (x) { x.textContent = themeLabel(); });
    toast(nt === 'dark' ? 'صار المظهر داكن' : nt === 'light' ? 'صار المظهر فاتح' : 'المظهر يتبع جهازك');
  });
  applyTheme(getTheme());

  /* ================= MULTI-SELECT: delete (and approve) many at once ================= */
  var sel = null; // { kind: 'majalis' | 'qs' | 'users', ids: {} }
  function startSel(kind) {
    sel = { kind: kind, ids: {}, armed: false };
    document.documentElement.classList.add('selecting');
    paintSel();
  }
  function endSel() {
    if (!sel) return;
    sel = null;
    document.documentElement.classList.remove('selecting');
    var bar = document.getElementById('selBar'); if (bar) bar.remove();
    document.querySelectorAll('.is-sel').forEach(function (e) { e.classList.remove('is-sel'); });
  }
  function selItems() { return Array.prototype.filter.call(document.querySelectorAll('[data-sel]'), function (e) { return e.dataset.selKind === sel.kind && e.offsetParent !== null; }); }
  function paintSel() {
    if (!sel) return;
    var n = Object.keys(sel.ids).length;
    var bar = document.getElementById('selBar');
    if (!bar) { bar = document.createElement('div'); bar.id = 'selBar'; bar.className = 'sel-bar'; document.body.appendChild(bar); }
    var what = sel.kind === 'majalis' ? 'جلسة' : sel.kind === 'qs' ? 'سؤال' : 'مستخدم';
    bar.innerHTML = '<div class="sel-in"><span class="sel-n">' + (n ? 'محدد: ' + ar(n) + ' ' + what : 'اضغط على اللي تبي تحدده') + '</span>' +
      '<button class="btn" type="button" id="selAll">' + (n && n === selItems().length ? 'إلغاء تحديد الكل' : 'تحديد الكل') + '</button>' +
      (sel.kind === 'users' ? '<button class="btn" type="button" id="selApprove"' + (n ? '' : ' disabled') + '>قبول</button>' : '') +
      '<button class="btn danger" type="button" id="selDel"' + (n ? '' : ' disabled') + '>' + (sel.armed ? 'تأكيد حذف ' + ar(n) : 'حذف') + '</button>' +
      '<button class="btn ghost" type="button" id="selCancel">إلغاء</button></div>';
    document.getElementById('selCancel').addEventListener('click', endSel);
    document.getElementById('selAll').addEventListener('click', function () {
      var items = selItems(), allOn = n && n === items.length;
      sel.ids = {}; sel.armed = false;
      items.forEach(function (e) { if (!allOn) sel.ids[e.dataset.sel] = true; e.classList.toggle('is-sel', !allOn); });
      paintSel();
    });
    var ap = document.getElementById('selApprove');
    if (ap) ap.addEventListener('click', function () {
      ap.disabled = true;
      api('/api/admin', { op: 'approveMany', ids: Object.keys(sel.ids) }).then(function (j) { toast('انقبل ' + ar(j.n || 0)); endSel(); loadUsers(); }, function (e) { ap.disabled = false; toast(e.message); });
    });
    document.getElementById('selDel').addEventListener('click', function () {
      if (!sel.armed) { sel.armed = true; paintSel(); setTimeout(function () { if (sel && sel.armed) { sel.armed = false; paintSel(); } }, 4000); return; }
      doSelDelete();
    });
  }
  function doSelDelete() {
    var ids = Object.keys(sel.ids), kind = sel.kind;
    var btn = document.getElementById('selDel'); if (btn) { btn.disabled = true; btn.textContent = 'جاري الحذف'; }
    if (kind === 'majalis') {
      act('deleteMajlisMany', { ids: ids }).then(function (j) {
        Object.keys(drafts).forEach(function (k) { if (drafts[k] && ids.indexOf(drafts[k].sid) !== -1) delete drafts[k]; }); saveDrafts();
        list = list.filter(function (x) { return ids.indexOf(x.id) === -1; }); all = null;
        endSel(); renderList(); toast('انحذف ' + ar(j.n || 0) + ' جلسة');
      }, function (e) { toast(e.message); paintSel(); });
    } else if (kind === 'qs') {
      if (!cur) return;
      var sid = cur.sid;
      act('deleteQMany', { ids: ids }).then(function (j) {
        if (!cur || cur.sid !== sid) return;
        ids.forEach(function (qid) {
          var ak = 'a/' + sid + '/' + qid;
          if (WQ[ak]) { clearTimeout(WQ[ak].timer); WQ[ak].timer = null; WQ[ak].fn = null; WQ[ak].failed = false; }
          clearDraft(ak); delete cur.qs[qid]; cur.deleting[qid] = true;
        });
        endSel(); renderQuestions(); toast('انحذف ' + ar(j.n || 0) + ' سؤال');
      }, function (e) { toast(e.message); paintSel(); });
    } else {
      api('/api/admin', { op: 'deleteUsers', ids: ids }).then(function (j) { endSel(); loadUsers(); toast('انحذف ' + ar(j.n || 0) + ' مستخدم'); }, function (e) { toast(e.message); paintSel(); });
    }
  }
  document.addEventListener('click', function (e) {
    if (!sel) return;
    var it = e.target.closest && e.target.closest('[data-sel]');
    if (!it || it.dataset.selKind !== sel.kind) return;
    e.preventDefault(); e.stopPropagation();
    var id = it.dataset.sel;
    if (sel.ids[id]) delete sel.ids[id]; else sel.ids[id] = true;
    it.classList.toggle('is-sel', !!sel.ids[id]);
    sel.armed = false; paintSel();
  }, true);

  /* ================= SHARE (read-only link) ================= */
  function shareTokenFromHash() { var m = (location.hash || '').match(/^#share-([A-Za-z0-9_-]{16,64})$/); return m ? m[1] : ''; }
  function shareUrl(t) { return location.origin + location.pathname + '#share-' + t; }
  function paintShare() {
    var pn = document.getElementById('sharePanel'); if (!pn || !cur) return;
    if (!cur.share) {
      pn.innerHTML = '<p>أي أحد معه الرابط يقدر يقرأ الأسئلة والأجوبة والفوائد والكتب، بدون التحضير وتحليل الشخصية. وتقدر توقف الرابط متى ما بغيت.</p>' +
        '<div class="btns"><button class="btn primary" type="button" id="shOn">أنشئ الرابط</button></div>';
      document.getElementById('shOn').addEventListener('click', function (e) { setShare(true, e.target); });
      return;
    }
    pn.innerHTML = '<label class="lbl" for="shLink">رابط القراءة</label><input class="input" id="shLink" readonly dir="ltr" value="' + esc(shareUrl(cur.share)) + '">' +
      '<div class="btns"><button class="btn primary" type="button" id="shCopy">نسخ الرابط</button>' +
      '<a class="btn" id="shWa" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent('مجلس ' + (cur.meta.sheikh || '') + '\n' + shareUrl(cur.share)) + '">إرسال واتساب</a>' +
      '<button class="btn ghost" type="button" id="shOff">إيقاف المشاركة</button></div>';
    document.getElementById('shCopy').addEventListener('click', function () {
      var inp = document.getElementById('shLink');
      function fb() { inp.focus(); inp.select(); toast('حدّد الرابط وانسخه'); }
      try { navigator.clipboard.writeText(inp.value).then(function () { toast('انتسخ الرابط'); }, fb); } catch (e) { fb(); }
    });
    document.getElementById('shOff').addEventListener('click', function (e) { setShare(false, e.target); });
  }
  function setShare(on, btn) {
    if (!cur) return;
    var sid = cur.sid; btn.disabled = true;
    act('share', { id: sid, on: on }).then(function (j) {
      if (!cur || cur.sid !== sid) return;
      cur.share = j.token || null; paintShare();
      toast(on ? 'جهز الرابط' : 'توقفت المشاركة، والرابط القديم ما عاد يفتح');
    }, function (e) { btn.disabled = false; toast(e.message); });
  }
  function renderShare(token) {
    leaveSession(); view = 'share';
    app.innerHTML = '<main class="wrap share-view"><p class="boot">جاري التحميل</p></main>';
    fetch('/api/share?t=' + encodeURIComponent(token), { cache: 'no-store' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new ApiErr(r.status, j.error || 'تعذّر الفتح'); return j; });
    }).then(function (j) {
      if (view !== 'share') return;
      var m = j.majlis || {}, d = fmtDate(str(m.date));
      document.title = 'مجلس ' + (m.sheikh || '');
      var qs = (j.questions || []).filter(function (q) { return str(q.answer).trim() || q.asked; });
      app.innerHTML = '<header class="s-top wrap"><div class="eyebrow">مجلس مع</div><h1>' + esc(m.sheikh || '') + '</h1>' +
        '<p class="lede">' + [m.topic ? esc(m.topic) : '', d.g ? esc(d.g) + (d.h ? ' · ' + esc(d.h) : '') : '', m.place ? esc(m.place) : ''].filter(Boolean).join(' · ') + '</p></header>' +
        '<main class="s-main wrap share-view">' +
        (qs.length ? '<section class="sec"><h2>الأسئلة والأجوبة</h2><ol class="qlist">' + qs.map(function (q, i) {
          return '<li class="q"><span class="q-num" aria-hidden="true">' + ar(i + 1) + '</span><div class="q-body"><p class="q-text">' + esc(q.text) + '</p>' +
            (str(q.answer).trim() ? '<div class="rich">' + md(q.answer) + '</div>' : '') + '</div></li>';
        }).join('') + '</ol></section>' : '') +
        (str(m.general).trim() ? '<section class="sec"><h2>فوائد وأفكار للتطبيق</h2><div class="rich">' + md(m.general) + '</div></section>' : '') +
        (str(m.books).trim() ? '<section class="sec"><h2>كتب وآثار ذكرها الشيخ</h2><div class="rich">' + md(m.books) + '</div></section>' : '') +
        '<p class="hint">من دفتر مجالس المشايخ. هذي نسخة للقراءة فقط.</p></main>';
    }, function (e) {
      if (view !== 'share') return;
      app.innerHTML = '<main class="wrap"><p class="boot">' + esc(e.message || 'ما قدرت أفتح الجلسة') + '</p></main>';
    });
  }

  /* ================= SESSION TIMER ================= */
  var TKEY = 'majalis-timer-v1';
  function timerAll() { try { return JSON.parse(localStorage.getItem(TKEY) || '{}') || {}; } catch (e) { return {}; } }
  function timerState(sid) { var t = timerAll()[sid]; return t && t.start && t.dur ? t : null; }
  function setTimerState(sid, v) { var all = timerAll(); if (v) all[sid] = v; else delete all[sid]; try { localStorage.setItem(TKEY, JSON.stringify(all)); } catch (e) {} }
  function paintTimer() {
    if (view !== 'session' || !cur) return;
    var st = timerState(cur.sid);
    var pills = [document.getElementById('timerPill'), document.getElementById('fTimer')];
    var alertEl = document.getElementById('timeAlert');
    var urgent = {};
    if (!st) {
      pills.forEach(function (p) { if (p) p.hidden = true; });
      if (alertEl) alertEl.hidden = true;
    } else {
      var leftMs = st.start + st.dur * 60000 - Date.now();
      var left = Math.ceil(leftMs / 60000);
      var low = left <= Math.max(5, Math.round(st.dur * 0.25));
      var txt = left > 0 ? 'باقي ' + nMin(left) : 'انتهى الوقت';
      pills.forEach(function (p) { if (!p) return; p.hidden = false; p.textContent = txt; p.classList.toggle('low', low); });
      var by = cur.loaded ? sortedQs() : { core: [] };
      var open = by.core.filter(function (id) { return cur.qs[id] && !cur.qs[id].asked; });
      if (alertEl) {
        if (low && open.length) {
          alertEl.hidden = false;
          alertEl.textContent = (left > 0 ? 'باقي ' + nMin(left) : 'انتهى وقت المجلس') + '، وباقي ' + nQ(open.length) + ' من الأساسية ما سألتها. المعلّمة بالأحمر هي الأهم.';
          open.slice(0, 3).forEach(function (id) { urgent[id] = true; });
        } else alertEl.hidden = true;
      }
    }
    Object.keys(cur.els).forEach(function (id) { cur.els[id].classList.toggle('urgent', !!urgent[id]); });
  }
  setInterval(function () { if (document.visibilityState === 'visible') paintTimer(); }, 15000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') paintTimer(); });

  /* ================= STAR: selected answer text goes to the benefits field ================= */
  function starFrom(ta) {
    if (!cur || !cur.meta || !ta) return;
    var a = ta.selectionStart, b = ta.selectionEnd;
    var t = (typeof a === 'number' && b > a) ? ta.value.slice(a, b) : '';
    t = t.replace(/\s+/g, ' ').trim();
    if (!t) { toast('حدّد جملة من الجواب أول، بعدين اضغط الزر'); return; }
    var g = cur.meta.general || '';
    if (g.indexOf(t) !== -1) { toast('هذي الفائدة موجودة من قبل'); return; }
    cur.meta.general = (g.trim() ? g.replace(/\s+$/, '') + '\n' : '') + '- ' + t;
    writeMeta('general', 0);
    paintMeta();
    toast('انضافت لفوائد الجلسة');
  }
  // keep the textarea selection when the star button is pressed
  document.addEventListener('mousedown', function (e) { if (e.target.closest && e.target.closest('[data-act=star], #fStar')) e.preventDefault(); });

  /* ================= FOCUS MODE: one question at a time, big ================= */
  var focus = null;
  function focusIds() { var by = sortedQs(); return by.core.concat(by.ask, by.spare); }
  function openFocus() {
    if (!cur || !cur.loaded) return;
    var ids = focusIds();
    if (!ids.length) { toast('ما فيه أسئلة بعد'); return; }
    var i = ids.findIndex(function (id) { return cur.qs[id].group === 'core' && !cur.qs[id].asked; });
    if (i < 0) i = ids.findIndex(function (id) { return !cur.qs[id].asked; });
    if (i < 0) i = 0;
    focus = { ids: ids, i: i };
    var ov = document.createElement('div');
    ov.className = 'focus-ov'; ov.id = 'focusOv';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'وضع المجلس');
    ov.innerHTML =
      '<div class="f-top"><span class="f-count" id="fCount"></span><span class="timer-pill" id="fTimer" hidden></span>' +
      '<button class="btn ghost" type="button" id="fClose">إغلاق</button></div>' +
      '<div class="f-body"><span class="f-group" id="fGroup"></span><p class="f-q" id="fQ"></p><p class="f-why" id="fWhy" hidden></p>' +
      '<label class="lbl" for="fAns">جواب الشيخ</label><textarea class="f-ans" id="fAns" placeholder="اكتب خلاصة جوابه هنا"></textarea>' +
      '<div class="ans-tools"><button class="icon-btn star-btn" type="button" id="fStar">أضف المحدد للفوائد</button></div></div>' +
      '<div class="f-nav"><button class="btn" type="button" id="fPrev">السابق</button><button class="btn" type="button" id="fSkip">تخطّي</button>' +
      '<button class="btn primary" type="button" id="fDone"></button></div>';
    document.body.appendChild(ov);
    document.documentElement.classList.add('no-scroll');
    var ans = document.getElementById('fAns');
    ans.addEventListener('input', function () {
      var id = focus && focus.ids[focus.i]; if (!id || !cur.qs[id]) return;
      cur.qs[id].answer = ans.value; writeAnswer(id, 900);
    });
    ans.addEventListener('blur', function () { var id = focus && focus.ids[focus.i]; if (!id) return; var k = 'a/' + cur.sid + '/' + id; if (WQ[k] && WQ[k].timer) run(k); });
    document.getElementById('fStar').addEventListener('click', function () { starFrom(ans); });
    document.getElementById('fClose').addEventListener('click', function () { closeFocus(); });
    document.getElementById('fPrev').addEventListener('click', function () { moveFocus(-1); });
    document.getElementById('fSkip').addEventListener('click', function () { moveFocus(1); });
    document.getElementById('fDone').addEventListener('click', function () {
      var id = focus.ids[focus.i], q = cur.qs[id];
      if (q && !q.asked) { q.asked = true; writeQ(id, 'k', { asked: true }); }
      if (focus.i >= focus.ids.length - 1) { closeFocus(); toast('خلّصت كل الأسئلة'); return; }
      moveFocus(1);
    });
    ov.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeFocus(); });
    if ('wakeLock' in navigator && !wake.lock) { wake.want = true; wake.acquire().catch(function () { wake.want = false; }); }
    paintFocus();
    document.getElementById('fDone').focus();
  }
  function moveFocus(d) {
    if (!focus) return;
    flushFocusAnswer();
    focus.i = Math.max(0, Math.min(focus.ids.length - 1, focus.i + d));
    paintFocus();
  }
  function flushFocusAnswer() { var id = focus && focus.ids[focus.i]; if (!id || !cur) return; var k = 'a/' + cur.sid + '/' + id; if (WQ[k] && WQ[k].timer) run(k); }
  function paintFocus() {
    if (!focus || !cur) return;
    focus.ids = focus.ids.filter(function (id) { return !!cur.qs[id]; });
    if (!focus.ids.length) { closeFocus(); return; }
    if (focus.i >= focus.ids.length) focus.i = focus.ids.length - 1;
    var id = focus.ids[focus.i], q = cur.qs[id], n = focus.ids.length;
    document.getElementById('fCount').textContent = 'السؤال ' + ar(focus.i + 1) + ' من ' + ar(n);
    document.getElementById('fGroup').textContent = GLABEL[q.group] || '';
    document.getElementById('fQ').textContent = q.text || '';
    var why = document.getElementById('fWhy'); why.textContent = q.why || ''; why.hidden = !q.why;
    var ans = document.getElementById('fAns'); if (ans.value !== (q.answer || '')) ans.value = q.answer || '';
    document.getElementById('fPrev').disabled = focus.i === 0;
    document.getElementById('fSkip').disabled = focus.i >= n - 1;
    var last = focus.i >= n - 1;
    document.getElementById('fDone').textContent = q.asked ? (last ? 'إنهاء' : 'التالي') : (last ? 'سألته، وخلّصت' : 'سألته، التالي');
    document.getElementById('focusOv').classList.toggle('asked', !!q.asked);
    paintTimer();
  }
  function closeFocus(silent) {
    var ov = document.getElementById('focusOv');
    if (!ov) { focus = null; return; }
    flushFocusAnswer();
    ov.remove(); focus = null;
    document.documentElement.classList.remove('no-scroll');
    if (!silent && cur && cur.loaded) renderQuestions();
  }

  function paintWake() {
    var b = document.getElementById('wakeBtn'); if (!b) return;
    var on = !!wake.lock;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.textContent = on ? 'الشاشة بتبقى شغالة' : 'إبقاء الشاشة شغالة';
  }
  var wake = { lock: null, want: false, acquire: function () {
    return navigator.wakeLock.request('screen').then(function (l) {
      wake.lock = l; paintWake();
      l.addEventListener('release', function () { wake.lock = null; paintWake(); });
    });
  } };
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && wake.want && !wake.lock && 'wakeLock' in navigator) wake.acquire().catch(function () {});
  });

  /* ================= RECORDING: record, upload, transcribe, summarize ================= */
  function recAllowed() { return !!(ai && ai.allowed); }
  function recSupported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder); }
  function fmtSize(b) {
    b = Number(b) || 0;
    if (b < 1024 * 1024) return ar(Math.max(1, Math.round(b / 1024))) + ' كيلو';
    if (b < 1024 * 1024 * 1024) return ar((b / 1048576).toFixed(b < 10485760 ? 1 : 0)).replace('.', '٫') + ' ميجا';
    return ar(String(+(b / 1073741824).toFixed(2))).replace('.', '٫') + ' جيجا';
  }
  function fmtClock(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return ar((h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0'));
  }
  function fmtDur(sec) {
    sec = Math.round(sec || 0); if (!sec) return '';
    var m = Math.round(sec / 60);
    if (m < 1) return ar(sec) + ' ثانية';
    if (m < 60) return nMin(m);
    var h = Math.floor(m / 60), r = m % 60;
    return (h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : ar(h) + ' ساعات') + (r ? ' و' + nMin(r) : '');
  }
  function atSecs(t) {
    var p = String(t || '').replace(/[٠-٩]/g, function (d) { return DIG.indexOf(d); }).split(':').map(Number);
    if (p.some(isNaN)) return -1;
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : -1;
  }
  function blobLib() {
    return new Promise(function (res, rej) {
      var n = 0;
      (function wait() {
        if (window.majalisBlob) { window.majalisBlob().then(res, function () { rej(new ApiErr(0, 'ما تحمّلت أداة الرفع، حدّث الصفحة')); }); return; }
        if (++n > 50) { rej(new ApiErr(0, 'ما تحمّلت أداة الرفع، حدّث الصفحة')); return; }
        setTimeout(wait, 200);
      })();
    });
  }

  /* ---- local backup of recording chunks (IndexedDB) so nothing is lost if the page closes ---- */
  var idbP = null;
  function idb() {
    if (!window.indexedDB) return Promise.reject(new Error('no idb'));
    if (idbP) return idbP;
    idbP = new Promise(function (res, rej) {
      var r;
      try { r = indexedDB.open('majalis-rec', 1); } catch (e) { rej(e); return; }
      r.onupgradeneeded = function () {
        var db = r.result;
        if (!db.objectStoreNames.contains('recs')) db.createObjectStore('recs', { keyPath: 'rid' });
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { autoIncrement: true }).createIndex('rid', 'rid');
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { idbP = null; rej(r.error); };
    });
    return idbP;
  }
  function idbDo(stores, mode, fn) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(stores, mode), out = { v: undefined };
        fn(tx, out);
        tx.oncomplete = function () { res(out.v); };
        tx.onerror = tx.onabort = function () { rej(tx.error); };
      });
    });
  }
  function idbPutRec(rec) { return idbDo(['recs'], 'readwrite', function (tx) { tx.objectStore('recs').put(rec); }).catch(function () {}); }
  function idbAddChunk(rid, seq, data) { return idbDo(['chunks'], 'readwrite', function (tx) { tx.objectStore('chunks').add({ rid: rid, seq: seq, data: data }); }).catch(function () {}); }
  function idbList() {
    return idbDo(['recs'], 'readonly', function (tx, out) { var q = tx.objectStore('recs').getAll(); q.onsuccess = function () { out.v = q.result || []; }; })
      .then(function (l) { return (l || []).filter(function (r) { return r.uid === (me && me.id); }); }, function () { return []; });
  }
  function idbBlob(rec) {
    return idbDo(['chunks'], 'readonly', function (tx, out) {
      var q = tx.objectStore('chunks').index('rid').getAll(rec.rid);
      q.onsuccess = function () { out.v = q.result || []; };
    }).then(function (rows) {
      rows.sort(function (a, b) { return a.seq - b.seq; });
      return new Blob(rows.map(function (x) { return x.data; }), { type: rec.mime || 'audio/webm' });
    });
  }
  function idbDel(rid) {
    return idbDo(['recs', 'chunks'], 'readwrite', function (tx) {
      tx.objectStore('recs').delete(rid);
      var c = tx.objectStore('chunks').index('rid').openKeyCursor(IDBKeyRange.only(rid));
      c.onsuccess = function () { var cur2 = c.result; if (cur2) { tx.objectStore('chunks').delete(cur2.primaryKey); cur2.continue(); } };
    }).catch(function () {});
  }

  /* ---- the recorder (one at a time, keeps going if you move between pages) ---- */
  var REC = null, UP = {}, recTick = null, recWake = null, recNotice = null;
  function recElapsed() { if (!REC) return 0; return Math.floor((REC.acc + (REC.paused ? 0 : Date.now() - REC.t0)) / 1000); }
  function pickMime() {
    var c = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < c.length; i++) { try { if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c[i])) return c[i]; } catch (e) {} }
    return '';
  }
  function extFor(mime) { mime = String(mime || ''); return /mp4|aac|m4a/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : /mpeg|mp3/.test(mime) ? 'mp3' : /wav/.test(mime) ? 'wav' : 'webm'; }
  function stampName() { var d = new Date(); function p(n) { return String(n).padStart(2, '0'); } return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); }
  function holdWake() {
    if (!('wakeLock' in navigator) || recWake) return;
    navigator.wakeLock.request('screen').then(function (l) { recWake = l; l.addEventListener('release', function () { recWake = null; }); }, function () {});
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (REC) {
      holdWake();
      if (REC.mutedAt || REC.gap > 3000) {
        recNotice = { sid: REC.sid, text: 'الجوال وقف الميكروفون لما قفلت الشاشة أو طلعت من الصفحة' + (REC.gap > 60000 ? ' (حوالي ' + nMin(Math.round(REC.gap / 60000)) + ')' : '') + '. بدل القفل استخدم «الشاشة السوداء»: الجوال يبان مطفي والتسجيل شغال.' };
      }
    }
    paintRecAll();
  });
  window.addEventListener('beforeunload', function (e) {
    if (REC || Object.keys(UP).length) { e.preventDefault(); e.returnValue = ''; }
  });

  function recStart(sid) {
    if (REC) { toast('فيه تسجيل شغال'); return; }
    if (!recSupported()) { toast('المتصفح هذا ما يدعم التسجيل، ارفع ملف بدلها'); return; }
    var sheikh = (cur && cur.sid === sid && cur.meta && cur.meta.sheikh) || '';
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 } }).then(function (stream) {
      var mime = pickMime(), opts = { audioBitsPerSecond: 48000 }, mr;
      if (mime) opts.mimeType = mime;
      try { mr = new MediaRecorder(stream, opts); } catch (e) { mr = new MediaRecorder(stream); }
      var rid = newId();
      REC = { rid: rid, sid: sid, sheikh: sheikh, mr: mr, stream: stream, chunks: [], seq: 0, mime: mr.mimeType || mime || 'audio/webm', t0: Date.now(), acc: 0, paused: false, started: Date.now(), gap: 0, mutedAt: 0 };
      recNotice = null;
      var meta = { rid: rid, uid: me && me.id, sid: sid, sheikh: sheikh, mime: REC.mime, started: REC.started, seconds: 0 };
      idbPutRec(meta);
      mr.ondataavailable = function (e) {
        if (!e.data || !e.data.size || !REC || REC.rid !== rid) return;
        REC.chunks.push(e.data); idbAddChunk(rid, REC.seq++, e.data);
        meta.seconds = recElapsed(); idbPutRec(meta);
      };
      mr.onstop = function () { recFinish(rid, meta); };
      mr.onerror = function () { toast('صار خطأ في التسجيل، حفظت اللي تسجّل'); recStop(); };
      stream.getAudioTracks().forEach(function (t) {
        t.addEventListener('ended', function () {
          if (!REC || REC.rid !== rid) return;
          recNotice = { sid: sid, text: 'التسجيل وقف لأن الجوال قفل الميكروفون (غالبًا لما انقفلت الشاشة)، وانحفظ كل اللي قبلها. تقدر تبدأ تسجيل ثاني، واستخدم «الشاشة السوداء» بدل القفل.' };
          toast('انقطع الميكروفون، حفظت اللي تسجّل'); recStop();
        });
        // آيفون: إذا انقفلت الشاشة غالبًا «يكتم» الميكروفون بدل ما يوقفه، فنحسب مدة الانقطاع وننبّه
        t.addEventListener('mute', function () { if (REC && REC.rid === rid && !REC.mutedAt) REC.mutedAt = Date.now(); });
        t.addEventListener('unmute', function () { if (REC && REC.rid === rid && REC.mutedAt) { REC.gap += Date.now() - REC.mutedAt; REC.mutedAt = 0; paintRecAll(); } });
      });
      mr.start(5000);
      holdWake();
      clearInterval(recTick); recTick = setInterval(paintRecTime, 1000);
      paintRecAll();
      toast('بدأ التسجيل');
    }, function (err) {
      toast(err && err.name === 'NotAllowedError' ? 'لازم تسمح للموقع يستخدم الميكروفون من إعدادات المتصفح' : 'ما قدرت أشغّل الميكروفون');
    });
  }
  function recPause() {
    if (!REC) return;
    try {
      if (REC.paused) { REC.mr.resume(); REC.paused = false; REC.t0 = Date.now(); }
      else { REC.mr.pause(); REC.acc += Date.now() - REC.t0; REC.paused = true; }
    } catch (e) {}
    paintRecAll();
  }
  function recStop() {
    if (!REC || REC.stopping) return;
    REC.stopping = true;
    if (!REC.paused) { REC.acc += Date.now() - REC.t0; REC.paused = true; }
    try { if (REC.mr.state !== 'inactive') REC.mr.stop(); else recFinish(REC.rid, null); } catch (e) { recFinish(REC.rid, null); }
  }
  function recFinish(rid, meta) {
    if (!REC || REC.rid !== rid) return;
    var r = REC; REC = null;
    clearInterval(recTick); recTick = null;
    closeDark();
    try { r.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    if (recWake) { try { recWake.release(); } catch (e) {} recWake = null; }
    var seconds = Math.floor(r.acc / 1000);
    var blob = new Blob(r.chunks, { type: r.mime.split(';')[0] || 'audio/webm' });
    paintRecAll();
    if (!blob.size) { idbDel(rid); toast('التسجيل فاضي'); return; }
    if (meta) { meta.seconds = seconds; meta.done = true; idbPutRec(meta); }
    uploadRec(r.sid, blob, { file: 'majlis-' + stampName() + '.' + extFor(r.mime), display: 'تسجيل ' + fmtClockShort(r.started), seconds: seconds, rid: rid })
      .then(null, function () {});
  }
  function fmtClockShort(t) {
    try { return new Date(t).toLocaleString('ar-SA-u-ca-gregory-nu-arab', { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; }
  }

  function uploadRec(sid, blob, info) {
    UP[sid] = { pct: 0, name: info.display };
    paintRecAll();
    return api('/api/rec', { op: 'prepare', majlisId: sid, size: blob.size }).then(function (p) {
      return blobLib().then(function (lib) {
        var type = String(blob.type || '').split(';')[0];
        return lib.upload(p.prefix + info.file, blob, {
          access: p.access || 'private', handleUploadUrl: '/api/upload',
          clientPayload: JSON.stringify({ kind: 'rec', majlisId: sid, size: blob.size }),
          multipart: blob.size > 8 * 1024 * 1024, contentType: type || undefined,
          onUploadProgress: function (e) { if (UP[sid]) { UP[sid].pct = Math.round(e.percentage || 0); paintUp(sid); } }
        });
      });
    }).then(function (res) {
      return api('/api/rec', { op: 'add', majlisId: sid, url: res.url, pathname: res.pathname, size: blob.size, seconds: info.seconds || 0, mime: String(blob.type || '').split(';')[0], name: info.display });
    }).then(function (j) {
      delete UP[sid];
      if (info.rid) idbDel(info.rid);
      toast('انرفع التسجيل');
      if (view === 'session' && cur && cur.sid === sid) loadRecs(sid);
      paintRecAll();
      return j;
    }, function (e) {
      delete UP[sid];
      paintRecAll();
      var msg = (e && e.message) || 'ما انرفع';
      toast(info.rid ? 'ما انرفع التسجيل، بس محفوظ في جهازك وتقدر ترفعه بعدين' : msg);
      if (view === 'session' && cur && cur.sid === sid) { var el = document.getElementById('recErr'); if (el) el.textContent = msg; renderLeftovers(sid); }
      throw e;
    });
  }
  function fileDuration(file) {
    return new Promise(function (res) {
      var done = false, a = document.createElement('audio'), url = URL.createObjectURL(file);
      function end(v) { if (done) return; done = true; URL.revokeObjectURL(url); res(v); }
      a.preload = 'metadata';
      a.onloadedmetadata = function () { end(isFinite(a.duration) ? Math.round(a.duration) : 0); };
      a.onerror = function () { end(0); };
      setTimeout(function () { end(0); }, 5000);
      a.src = url;
    });
  }

  /* ---- black screen while recording: looks switched off, keeps the mic alive ---- */
  var darkTap = 0, darkMove = null;
  function openDark() {
    if (!REC || document.getElementById('darkOv')) return;
    var ov = document.createElement('div');
    ov.id = 'darkOv'; ov.className = 'dark-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'الشاشة السوداء، التسجيل شغال');
    ov.innerHTML = '<div class="dark-info" id="darkInfo"><span class="rec-dot" aria-hidden="true"></span> <b id="darkT">' + fmtClock(recElapsed()) + '</b><br>اضغط مرتين بسرعة للرجوع</div>';
    document.body.appendChild(ov);
    document.documentElement.classList.add('no-scroll');
    holdWake();
    try { var fe = document.documentElement; (fe.requestFullscreen || fe.webkitRequestFullscreen || function () {}).call(fe); } catch (e) {}
    ov.addEventListener('pointerup', function (e) {
      e.preventDefault();
      var now = Date.now();
      if (now - darkTap < 450) closeDark(); else darkTap = now;
    });
    ov.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // نحرّك النص كل دقيقة عشان ما يعلق أثره على الشاشة
    clearInterval(darkMove);
    darkMove = setInterval(function () {
      var i = document.getElementById('darkInfo'); if (!i) return;
      i.style.transform = 'translate(' + Math.round(Math.random() * 60 - 30) + 'px,' + Math.round(Math.random() * 200 - 100) + 'px)';
    }, 60000);
  }
  function closeDark() {
    var ov = document.getElementById('darkOv'); if (!ov) return;
    ov.remove(); clearInterval(darkMove); darkMove = null;
    if (!document.querySelector('.focus-ov')) document.documentElement.classList.remove('no-scroll');
    try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); else if (document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen(); } catch (e) {}
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDark(); });

  /* ---- painting ---- */
  function paintRecAll() { paintRecFloat(); if (view === 'session' && cur) paintRecPanel(cur.sid); }
  function paintRecTime() {
    var t = fmtClock(recElapsed());
    var d = document.getElementById('darkT'); if (d) d.textContent = t;
    var a = document.getElementById('recTime'); if (a) a.textContent = t;
    var f = document.getElementById('recFloatT'); if (f) f.textContent = t;
  }
  function paintRecFloat() {
    var f = document.getElementById('recFloat');
    if (!REC) { if (f) f.remove(); return; }
    if (!f) {
      f = document.createElement('a'); f.id = 'recFloat'; f.className = 'rec-float';
      document.body.appendChild(f);
    }
    f.href = '#s-' + REC.sid;
    f.onclick = function () { setTimeout(function () { var s = document.getElementById('sec-rec'); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 400); };
    f.innerHTML = '<span class="rec-dot' + (REC.paused ? ' paused' : '') + '" aria-hidden="true"></span><span>' + (REC.paused ? 'التسجيل موقّف' : 'يسجّل') + '</span><b id="recFloatT">' + fmtClock(recElapsed()) + '</b>' +
      (REC.sheikh ? '<span class="rec-who">' + esc(REC.sheikh) + '</span>' : '');
  }
  function paintUp(sid) {
    var b = document.getElementById('recUpBar'), t = document.getElementById('recUpPct');
    if (b && UP[sid]) b.style.width = UP[sid].pct + '%';
    if (t && UP[sid]) t.textContent = ar(UP[sid].pct) + '٪';
  }
  function recSectionHtml() {
    if (!recAllowed()) return '';
    return '<section class="sec" id="sec-rec" aria-labelledby="h-rec"><div class="sec-head"><h2 id="h-rec">التسجيل والتفريغ</h2></div>' +
      '<p class="lede">سجّل المجلس من هنا أو ارفع تسجيل عندك. بعدها يفرّغه الموقع، ويوزّع أجوبة الشيخ على أسئلتك، ويطلّع التوجيهات والكتب، وأنت تختار وش ينضاف للجلسة.</p>' +
      '<div class="rec-panel" id="recPanel"></div><p class="login-err" id="recErr" role="alert"></p>' +
      '<div id="recLeft"></div><div class="rec-list" id="recList"></div>' +
      '<input type="file" id="recFile" accept="audio/*,video/*,.m4a,.mp3,.ogg,.opus,.wav,.aac,.amr,.webm" hidden></section>';
  }
  function paintRecPanel(sid) {
    var el = document.getElementById('recPanel'); if (!el) return;
    if (ai && !ai.store) {
      el.innerHTML = '<p class="rich-empty">' + (ai.admin ? 'الموقع ما لقى مخزن الملفات. التفاصيل في صفحة <a href="#admin">المستخدمون</a> ← النسخ الاحتياطي.' : 'التسجيل غير مفعّل في الموقع بعد.') + '</p>';
      return;
    }
    if (UP[sid]) {
      el.innerHTML = '<div class="rec-up"><span>يرفع «' + esc(UP[sid].name) + '»</span><b id="recUpPct">' + ar(UP[sid].pct) + '٪</b>' +
        '<div class="rec-bar"><i id="recUpBar" style="width:' + UP[sid].pct + '%"></i></div><span class="hint">خلّ الصفحة مفتوحة لين يخلص الرفع.</span></div>';
      return;
    }
    if (REC && REC.sid === sid) {
      el.innerHTML = '<div class="rec-live' + (REC.paused ? ' paused' : '') + '"><span class="rec-dot" aria-hidden="true"></span><b class="rec-time" id="recTime">' + fmtClock(recElapsed()) + '</b>' +
        '<span class="rec-state">' + (REC.paused ? 'موقّف مؤقتًا' : 'يسجّل الحين') + '</span>' +
        '<div class="btns"><button class="btn" type="button" data-rec="pause">' + (REC.paused ? 'كمّل التسجيل' : 'إيقاف مؤقت') + '</button>' +
        '<button class="btn primary" type="button" data-rec="stop">إنهاء وحفظ</button>' +
        '<button class="btn dark-btn" type="button" data-rec="dark">الشاشة السوداء</button></div>' +
        (recNotice && recNotice.sid === sid ? '<p class="rec-warn">' + esc(recNotice.text) + '</p>' : '') +
        '<span class="hint">لا تقفل الجوال وقت التسجيل، لأن الآيفون يوقف الميكروفون في المتصفح إذا انقفلت الشاشة. اضغط «الشاشة السوداء» وحط الجوال على وجهه: يبان مطفي، والتسجيل شغال، ويستهلك بطارية أقل. والتسجيل ينحفظ في جهازك أول بأول.</span></div>';
      return;
    }
    var other = REC && REC.sid !== sid;
    el.innerHTML = (recNotice && recNotice.sid === sid ? '<p class="rec-warn">' + esc(recNotice.text) + '</p>' : '') + '<div class="btns">' +
      (recSupported() ? '<button class="btn primary" type="button" data-rec="start"' + (other ? ' disabled' : '') + '><span class="rec-dot" aria-hidden="true"></span> ابدأ التسجيل</button>' : '') +
      '<button class="btn" type="button" data-rec="file">ارفع ملف صوتي</button></div>' +
      (other ? '<p class="hint">فيه تسجيل شغال لمجلس ثاني، أنهه أول.</p>' : '') +
      (recSupported() ? '' : '<p class="hint">المتصفح هذا ما يدعم التسجيل المباشر، سجّل بتطبيق التسجيل في جوالك وارفع الملف.</p>');
  }

  /* ---- recordings list for the open session ---- */
  var recState = { sid: null, recs: [], flags: {}, busy: {}, pollT: null, texts: {} };
  function loadRecs(sid) {
    if (!recAllowed() || !document.getElementById('recList')) return;
    api('/api/rec', { op: 'list', majlisId: sid }).then(function (j) {
      if (!cur || cur.sid !== sid) return;
      recState.sid = sid; recState.recs = j.recs || []; recState.flags = j;
      renderRecs(); schedulePoll();
    }, function () {});
    renderLeftovers(sid);
  }
  function renderLeftovers(sid) {
    var box = document.getElementById('recLeft'); if (!box) return;
    idbList().then(function (l) {
      if (!cur || cur.sid !== sid) return;
      var left = l.filter(function (r) { return r.sid === sid && (!REC || REC.rid !== r.rid) && !UP[sid]; });
      box.innerHTML = left.map(function (r) {
        return '<div class="rec-left" data-lrid="' + esc(r.rid) + '"><span>تسجيل محفوظ في جهازك وما انرفع' + (r.seconds ? ' (' + fmtDur(r.seconds) + ')' : '') + ' — ' + esc(fmtClockShort(r.started)) + '</span>' +
          '<div class="btns"><button class="btn primary" type="button" data-left="up">ارفعه الحين</button><button class="btn ghost" type="button" data-left="del">احذفه</button></div></div>';
      }).join('');
    });
  }
  function statusHtml(r) {
    var f = recState.flags || {};
    if (r.gone) return '<p class="hint">الملف الصوتي محذوف' + (r.hasText ? '، والتفريغ موجود.' : '.') + '</p>';
    switch (r.status) {
      case 'transcribing': return '<p class="rec-st run"><span class="spin" aria-hidden="true"></span>يفرّغ الصوت… عادة ياخذ دقايق قليلة، وتقدر تطلع من الصفحة وترجع.</p>';
      case 'summarizing': return '<p class="rec-st run"><span class="spin" aria-hidden="true"></span>يقرأ التفريغ ويوزّع كلام الشيخ على أسئلتك… ياخذ من دقيقة إلى أربع.</p>';
      case 'transcribed': return '<p class="rec-st">التفريغ جاهز.' + (r.error ? ' <span class="login-err">' + esc(r.error) + '</span>' : '') + '</p>';
      case 'ready': return '<p class="rec-st ok">جاهز، راجع اللي طلع تحت واختر وش ينضاف.</p>';
      case 'applied': return '<p class="rec-st ok">انضاف للجلسة.</p>';
      case 'error': return '<p class="login-err">' + esc(r.error || 'صار خطأ') + '</p>';
      default: return f.asr ? '' : '<p class="hint">' + (ai && ai.admin ? 'التفريغ يحتاج مفتاح AssemblyAI في Vercel باسم ASSEMBLYAI_API_KEY.' : 'التفريغ غير مفعّل في الموقع بعد.') + '</p>';
    }
  }
  function actionsHtml(r) {
    var f = recState.flags || {}, b = [];
    var busy = recState.busy[r.id];
    if (!r.gone && f.asr && (r.status === 'uploaded' || r.status === 'error')) b.push('<button class="btn primary" type="button" data-ra="asr"' + (busy ? ' disabled' : '') + '>' + (r.status === 'error' ? 'أعد التفريغ' : 'فرّغ ولخّص') + '</button>');
    if (r.status === 'transcribed' && f.ai) b.push('<button class="btn primary" type="button" data-ra="sum"' + (busy ? ' disabled' : '') + '>لخّص ووزّع على الأسئلة</button>');
    if (r.hasText) b.push('<button class="btn" type="button" data-ra="text" aria-expanded="' + (recState.texts[r.id] ? 'true' : 'false') + '">' + (recState.texts[r.id] ? 'إخفاء التفريغ' : 'عرض التفريغ') + '</button>');
    if (r.play) b.push('<a class="btn ghost" href="' + esc(r.play) + '" download target="_blank" rel="noopener">تنزيل الصوت</a>');
    b.push('<button class="btn ghost" type="button" data-ra="del">حذف</button>');
    return '<div class="btns">' + b.join('') + '</div>';
  }
  function previewHtml(r) {
    var s = r.summary; if (!s || r.status !== 'ready') return '';
    var out = ['<div class="rec-prev"><h3>اللي طلع من التسجيل</h3><p class="hint">علّم على اللي تبيه ينضاف للجلسة. الأوقات بجانب الأجوبة تشغّل التسجيل من مكان الجواب.</p>'];
    if (s.summary) out.push('<label class="pick"><input type="checkbox" data-pk="summary" checked><b>ملخص المجلس</b> <span class="hint">ينضاف لـ «فوائد وأفكار للتطبيق»</span></label><div class="rich pick-body">' + md(s.summary) + '</div>');
    if ((s.answers || []).length) {
      out.push('<h4>أجوبة أسئلتك (' + ar(s.answers.length) + ')</h4>');
      s.answers.forEach(function (a) {
        var q = cur && cur.qs[a.qid], had = q && (q.answer || '').trim();
        out.push('<label class="pick"><input type="checkbox" data-pk="a" value="' + esc(a.qid) + '" checked><b>' + esc(q ? q.text : 'سؤال') + '</b>' + tsBtn(a.at) + '</label>' +
          '<div class="rich pick-body">' + md(a.answer) + '</div>' + (had ? '<p class="hint pick-body">عندك جواب مكتوب لهذا السؤال، الجديد بينضاف تحته.</p>' : ''));
      });
    }
    if ((s.extra || []).length) {
      out.push('<h4>أسئلة انسألت وما كانت في قائمتك (' + ar(s.extra.length) + ')</h4>');
      s.extra.forEach(function (x, i) {
        out.push('<label class="pick"><input type="checkbox" data-pk="e" value="' + i + '" checked><b>' + esc(x.q) + '</b>' + tsBtn(x.at) + '</label><div class="rich pick-body">' + md(x.answer) + '</div>');
      });
    }
    if ((s.guidance || []).length) out.push('<h4>توجيهات الشيخ</h4><label class="pick"><input type="checkbox" data-pk="guidance" checked><b>أضف التوجيهات (' + ar(s.guidance.length) + ')</b></label><ul class="pick-body plain">' + s.guidance.map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') + '</ul>');
    if ((s.books || []).length) out.push('<h4>الكتب اللي ذكرها</h4><label class="pick"><input type="checkbox" data-pk="books" checked><b>أضف الكتب (' + ar(s.books.length) + ')</b></label><ul class="pick-body plain">' + s.books.map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') + '</ul>');
    if (!s.summary && !(s.answers || []).length && !(s.extra || []).length) out.push('<p class="rich-empty">ما لقيت في التسجيل أجوبة واضحة للشيخ.</p>');
    out.push('<div class="btns"><button class="btn primary" type="button" data-ra="apply">أضف المحدد للجلسة</button><button class="btn ghost" type="button" data-ra="dismiss">تجاهل</button></div></div>');
    return out.join('');
  }
  function tsBtn(at) { return atSecs(at) >= 0 ? ' <button class="ts" type="button" data-at="' + esc(at) + '" title="شغّل من هنا">' + ar(at) + '</button>' : ''; }
  function renderRecs() {
    var el = document.getElementById('recList'); if (!el) return;
    var playing = {};
    el.querySelectorAll('.rec-card audio').forEach(function (a) { var id = a.closest('.rec-card').dataset.rec; playing[id] = { t: a.currentTime, p: !a.paused }; });
    el.innerHTML = recState.recs.map(function (r) {
      var meta = [fmtClockShort(r.createdAt), fmtDur(r.seconds), r.size ? fmtSize(r.size) : ''].filter(Boolean).join('، ');
      return '<div class="rec-card" data-rec="' + esc(r.id) + '"><div class="rec-head"><b>' + esc(r.name || 'تسجيل') + '</b><span class="u-sub">' + esc(meta) + '</span></div>' +
        (r.play ? '<audio controls preload="none" src="' + esc(r.play) + '"></audio>' : '') +
        statusHtml(r) + actionsHtml(r) +
        (recState.texts[r.id] ? '<div class="rec-text"><div class="btns"><button class="btn" type="button" data-ra="copyText">نسخ التفريغ</button><button class="btn" type="button" data-ra="dlText">تنزيل نص</button></div><div class="rec-text-body">' + esc(recState.texts[r.id]) + '</div></div>' : '') +
        previewHtml(r) + '</div>';
    }).join('');
    Object.keys(playing).forEach(function (id) {
      var a = el.querySelector('.rec-card[data-rec="' + id + '"] audio');
      if (a && playing[id].t) { try { a.currentTime = playing[id].t; } catch (e) {} if (playing[id].p) a.play().catch(function () {}); }
    });
  }
  function recById(id) { return recState.recs.filter(function (r) { return r.id === id; })[0]; }
  function putRec(r) {
    var i = recState.recs.findIndex(function (x) { return x.id === r.id; });
    if (i === -1) recState.recs.push(r); else { if (!r.play && recState.recs[i].play) r.play = recState.recs[i].play; recState.recs[i] = r; }
  }
  function schedulePoll() {
    clearTimeout(recState.pollT);
    var sid = recState.sid;
    var tr = recState.recs.filter(function (r) { return r.status === 'transcribing'; });
    var sm = recState.recs.filter(function (r) { return r.status === 'summarizing' && !recState.busy[r.id]; });
    if (!tr.length && !sm.length) return;
    recState.pollT = setTimeout(function () {
      if (view !== 'session' || !cur || cur.sid !== sid) return;
      if (sm.length && !tr.length) { loadRecs(sid); return; }
      Promise.all(tr.map(function (r) {
        return api('/api/rec', { op: 'poll', id: r.id }).then(function (j) {
          putRec(j.rec);
          if (j.rec.status === 'transcribed' && recState.flags.ai) summarizeRec(j.rec.id);
        }, function () {});
      })).then(function () { renderRecs(); schedulePoll(); });
    }, sm.length && !tr.length ? 15000 : 8000);
  }
  function summarizeRec(id) {
    if (recState.busy[id]) return;
    recState.busy[id] = true;
    var r = recById(id); if (r) { r.status = 'summarizing'; r.error = ''; }
    renderRecs();
    flushAll();
    api('/api/rec', { op: 'summarize', id: id }).then(function (j) {
      delete recState.busy[id]; putRec(j.rec); renderRecs();
      if (j.rec.status === 'ready') toast('جهز ملخص التسجيل، راجعه في قسم التسجيل');
    }, function (e) {
      delete recState.busy[id];
      if (e.status === 504 || e.status === 0) { if (cur) loadRecs(cur.sid); return; }
      var r2 = recById(id); if (r2) { r2.status = 'transcribed'; r2.error = e.message; }
      renderRecs();
    });
  }
  function pickFrom(card) {
    var p = { answers: [], extra: [], summary: false, guidance: false, books: false };
    card.querySelectorAll('input[data-pk]').forEach(function (i) {
      if (!i.checked) return;
      var k = i.dataset.pk;
      if (k === 'a') p.answers.push(i.value); else if (k === 'e') p.extra.push(Number(i.value)); else p[k] = true;
    });
    return p;
  }
  function wireRec(sid) {
    var sec = document.getElementById('sec-rec'); if (!sec) return;
    var file = document.getElementById('recFile');
    file.addEventListener('change', function () {
      var f = file.files && file.files[0]; file.value = '';
      if (!f) return;
      if (f.size > 500 * 1024 * 1024) { toast('الملف أكبر من ٥٠٠ ميجا'); return; }
      var ext = (String(f.name).match(/\.([a-z0-9]{2,5})$/i) || [])[1] || extFor(f.type);
      fileDuration(f).then(function (secs) {
        uploadRec(sid, f, { file: 'upload-' + stampName() + '.' + ext.toLowerCase(), display: f.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'تسجيل مرفوع', seconds: secs }).then(null, function () {});
      });
    });
    sec.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var errEl = document.getElementById('recErr');
      if (b.dataset.rec) {
        if (errEl) errEl.textContent = '';
        if (b.dataset.rec === 'start') recStart(sid);
        else if (b.dataset.rec === 'pause') recPause();
        else if (b.dataset.rec === 'stop') recStop();
        else if (b.dataset.rec === 'dark') openDark();
        else if (b.dataset.rec === 'file') file.click();
        return;
      }
      if (b.dataset.left) {
        var lrid = b.closest('[data-lrid]').dataset.lrid;
        idbList().then(function (l) {
          var r = l.filter(function (x) { return x.rid === lrid; })[0]; if (!r) return;
          if (b.dataset.left === 'del') {
            if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = 'متأكد؟ اضغط مرة ثانية'; return; }
            idbDel(lrid).then(function () { renderLeftovers(sid); toast('انحذف التسجيل من جهازك'); });
            return;
          }
          idbBlob(r).then(function (blob) {
            if (!blob.size) { idbDel(lrid); renderLeftovers(sid); toast('التسجيل المحفوظ فاضي'); return; }
            document.getElementById('recLeft').innerHTML = '';
            uploadRec(sid, blob, { file: 'majlis-' + stampName() + '.' + extFor(r.mime), display: 'تسجيل ' + fmtClockShort(r.started), seconds: r.seconds || 0, rid: r.rid }).then(null, function () {});
          }, function () { toast('ما قدرت أقرأ التسجيل المحفوظ'); });
        });
        return;
      }
      if (b.classList.contains('ts')) {
        var a = b.closest('.rec-card').querySelector('audio'), s = atSecs(b.dataset.at);
        if (a && s >= 0) { a.preload = 'auto'; try { a.currentTime = s; } catch (er) {} a.play().catch(function () {}); a.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        e.preventDefault();
        return;
      }
      var card = b.closest('.rec-card'); if (!card || !b.dataset.ra) return;
      var id = card.dataset.rec, r = recById(id); if (!r) return;
      var ra = b.dataset.ra;
      if (ra === 'asr') {
        recState.busy[id] = true; renderRecs();
        api('/api/rec', { op: 'transcribe', id: id }).then(function (j) { delete recState.busy[id]; putRec(j.rec); renderRecs(); schedulePoll(); toast('بدأ التفريغ'); },
          function (er) { delete recState.busy[id]; renderRecs(); toast(er.message); });
      } else if (ra === 'sum') summarizeRec(id);
      else if (ra === 'text') {
        if (recState.texts[id]) { delete recState.texts[id]; renderRecs(); return; }
        api('/api/rec', { op: 'transcript', id: id }).then(function (j) { recState.texts[id] = j.text || 'ما فيه نص'; renderRecs(); }, function (er) { toast(er.message); });
      } else if (ra === 'copyText') {
        (navigator.clipboard ? navigator.clipboard.writeText(recState.texts[id] || '') : Promise.reject()).then(function () { toast('انتسخ التفريغ'); }, function () { toast('ما قدرت أنسخ'); });
      } else if (ra === 'dlText') {
        var blob = new Blob(['﻿' + (recState.texts[id] || '')], { type: 'text/plain;charset=utf-8' });
        var u = URL.createObjectURL(blob), lk = document.createElement('a');
        lk.href = u; lk.download = 'majlis-transcript-' + (cur && cur.meta && cur.meta.date || stampName()) + '.txt'; document.body.appendChild(lk); lk.click(); lk.remove();
        setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
      } else if (ra === 'del') {
        if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = 'متأكد؟ يحذف الصوت والتفريغ'; return; }
        api('/api/rec', { op: 'del', id: id }).then(function () {
          recState.recs = recState.recs.filter(function (x) { return x.id !== id; }); delete recState.texts[id]; renderRecs(); toast('انحذف التسجيل');
        }, function (er) { toast(er.message); });
      } else if (ra === 'apply' || ra === 'dismiss') {
        var p = ra === 'apply' ? pickFrom(card) : {};
        b.disabled = true;
        flushAll();
        api('/api/rec', { op: 'apply', id: id, pick: p }).then(function (j) {
          r.status = 'applied'; r.summary = null; renderRecs();
          if (ra === 'apply') {
            var parts = [];
            if (j.answers) parts.push(j.answers === 1 ? 'جواب واحد' : j.answers === 2 ? 'جوابين' : ar(j.answers) + ' أجوبة');
            if (j.extra) parts.push(j.extra === 1 ? 'سؤال جديد' : j.extra === 2 ? 'سؤالين جداد' : ar(j.extra) + ' أسئلة جديدة');
            if (j.notes) parts.push('الفوائد');
            if (j.books) parts.push('الكتب');
            toast(parts.length ? 'انضاف للجلسة: ' + parts.join('، ') : 'ما انضاف شي');
            loadSession(cur.sid, false);
          }
        }, function (er) { b.disabled = false; toast(er.message); });
      }
    });
  }

  /* ---- home: remind about recordings that stayed on this device ---- */
  function homeLeftovers() {
    if (!recAllowed()) return;
    idbList().then(function (l) {
      var left = l.filter(function (r) { return (!REC || REC.rid !== r.rid) && !UP[r.sid]; });
      var main = document.querySelector('.home-main'); if (!left.length || !main || view !== 'home') return;
      var box = document.createElement('div'); box.className = 'rec-left';
      box.innerHTML = '<span>عندك ' + (left.length === 1 ? 'تسجيل محفوظ' : ar(left.length) + ' تسجيلات محفوظة') + ' في جهازك وما انرفع' + (left[0].sheikh ? ' (مجلس ' + esc(left[0].sheikh) + ')' : '') + '.</span>' +
        '<div class="btns"><a class="btn primary" href="#s-' + esc(left[0].sid) + '">افتح الجلسة وارفعه</a></div>';
      main.insertBefore(box, main.firstChild);
    });
  }

  /* ================= BACKUPS (admin) ================= */
  var KIND = { auto: 'تلقائية', manual: 'يدوية', 'pre-restore': 'قبل استرجاع', upload: 'ملف مرفوع' };
  function fmtWhen(iso) {
    try { return new Date(iso).toLocaleString('ar-SA-u-ca-gregory-nu-arab', { timeZone: 'Asia/Riyadh', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }); } catch (e) { return iso; }
  }
  function countsLine(c) {
    c = c || {};
    return [ar(c.users || 0) + ' مستخدم', ar(c.majalis || 0) + ' جلسة', ar(c.questions || 0) + ' سؤال'].join('، ');
  }
  var bk = { users: [] };
  function loadBackups() {
    var body = document.getElementById('bkBody'); if (!body) return;
    api('/api/backup', { op: 'status' }).then(function (j) {
      if (view !== 'admin') return;
      bk.users = j.users || [];
      var st = document.getElementById('bkState');
      if (!j.ready) {
        st.textContent = 'غير مفعّل'; st.classList.add('off');
        body.innerHTML = '<p class="rich-empty">الموقع ما لقى مفتاح مخزن الملفات (BLOB_READ_WRITE_TOKEN). من Vercel: Storage ← تأكد إن مخزن Blob مربوط بمشروع majalis-app، وبعدها Deployments ← آخر نشر ← Redeploy.' +
          ((j.env || []).length ? '<br>المتغيرات الموجودة الحين: <span dir="ltr">' + j.env.map(esc).join('، ') + '</span>' : '<br>ما فيه أي متغير للمخزن في المشروع الحين.') + '</p>';
        return;
      }
      st.classList.remove('off');
      var last = (j.log || [])[0];
      st.textContent = last ? 'آخر نسخة: ' + fmtWhen(last.at) : 'ما فيه نسخ بعد';
      var s = j.storage || { total: 0, quota: 1, recBytes: 0, backupBytes: 0 };
      var pct = Math.min(100, Math.round(s.total / s.quota * 100));
      body.innerHTML =
        '<div class="meter"><div class="meter-line"><span>المساحة المستخدمة</span><b>' + fmtSize(s.total) + ' من ' + fmtSize(s.quota) + '</b></div>' +
        '<div class="rec-bar' + (pct >= 70 ? ' warn' : '') + '"><i style="width:' + Math.max(1, pct) + '%"></i></div>' +
        '<span class="hint">التسجيلات ' + fmtSize(s.recBytes) + '، والنسخ الاحتياطية ' + fmtSize(s.backupBytes) + '. إذا وصلت ٨٥٪ يوقف رفع التسجيلات، فاحذف تسجيلات قديمة بعد تفريغها.</span></div>' +
        '<div class="btns"><button class="btn primary" type="button" id="bkNow">خذ نسخة الحين</button><button class="btn" type="button" id="bkFileBtn">استرجاع من ملف</button>' +
        '<input type="file" id="bkFile" accept=".gz,.json,application/gzip,application/json" hidden></div>' +
        '<div id="bkMsg" class="hint" role="status"></div>' +
        '<div class="bk-list">' + ((j.log || []).length ? j.log.map(function (e) {
          return '<div class="bk-row" data-bk="' + esc(e.id) + '"><div class="u-main"><div class="u-line"><b>' + esc(fmtWhen(e.at)) + '</b><span class="chip">' + esc(KIND[e.kind] || e.kind) + '</span></div>' +
            '<span class="u-sub">' + countsLine(e.counts) + '، الحجم ' + fmtSize(e.size) + '</span></div>' +
            '<div class="btns"><button class="btn" type="button" data-bk-act="dl">تنزيل</button><button class="btn" type="button" data-bk-act="restore">استرجاع</button></div>' +
            '<div class="bk-restore" hidden></div></div>';
        }).join('') : '<p class="empty">أول نسخة تلقائية الليلة الساعة ٣ الفجر، أو خذ نسخة الحين.</p>') + '</div>';
      wireBackups();
    }, function (e) { body.innerHTML = '<p class="login-err">' + esc(e.message) + '</p>'; });
  }
  function restoreFormHtml() {
    return '<div class="field"><label>وش ترجّع؟</label><select class="input" data-r="user"><option value="">كل المستخدمين</option>' +
      bk.users.map(function (u) { return '<option value="' + esc(u.id) + '">' + esc(u.name) + ' (@' + esc(u.username) + ')</option>'; }).join('') + '</select></div>' +
      '<label class="pick"><input type="radio" name="rmode" value="missing" checked><span><b>رجّع المحذوف بس</b> (الأسلم): يرجّع الجلسات والأسئلة والحسابات اللي انحذفت بعد وقت النسخة، وما يلمس شي موجود.</span></label>' +
      '<label class="pick"><input type="radio" name="rmode" value="all"><span><b>رجّع كل شي مثل ما كان وقتها</b>: يرجّع المحذوف، ويرجّع أي تعديل صار بعد النسخة لحالته القديمة. اللي انضاف بعدها يبقى.</span></label>' +
      '<p class="hint">قبل الاسترجاع ياخذ الموقع نسخة من الوضع الحالي، عشان لو تبي ترجع عن الاسترجاع.</p>' +
      '<div class="btns"><button class="btn primary" type="button" data-r="go">استرجع</button><button class="btn ghost" type="button" data-r="cancel">إلغاء</button></div><p class="hint" data-r="out" role="status"></p>';
  }
  function runRestore(box, src) {
    var go = box.querySelector('[data-r=go]'), out = box.querySelector('[data-r=out]');
    var mode = (box.querySelector('input[name=rmode]:checked') || {}).value || 'missing';
    var body = { op: 'restore', mode: mode, userId: box.querySelector('[data-r=user]').value || null };
    Object.keys(src).forEach(function (k) { body[k] = src[k]; });
    if (!go.classList.contains('arm')) { go.classList.add('arm'); go.textContent = 'متأكد؟ اضغط مرة ثانية'; return; }
    go.disabled = true; out.textContent = 'جاري الاسترجاع… لا تقفل الصفحة';
    api('/api/backup', body).then(function (j) {
      var r = j.res || {};
      var parts = [];
      if (r.users) parts.push(ar(r.users) + ' حساب');
      if (r.majalis) parts.push(ar(r.majalis) + ' جلسة');
      if (r.questions) parts.push(ar(r.questions) + ' سؤال');
      if (r.recordings) parts.push(ar(r.recordings) + ' تسجيل');
      if (r.updated) parts.push('ورجّع ' + ar(r.updated) + ' تعديل');
      toast('تم الاسترجاع');
      loadBackups();
      setTimeout(function () { var m = document.getElementById('bkMsg'); if (m) m.textContent = 'تم الاسترجاع: ' + (parts.length ? 'رجع ' + parts.join('، ') : 'ما فيه شي ناقص، كل شي موجود') + (r.skipped ? '. وتخطى ' + ar(r.skipped) + ' عنصر ما يمديه يرجع.' : '.'); }, 300);
      loadUsers();
    }, function (e) { go.disabled = false; go.classList.remove('arm'); go.textContent = 'استرجع'; out.textContent = e.message; });
  }
  function wireBackups() {
    var now = document.getElementById('bkNow');
    if (now) now.addEventListener('click', function () {
      now.disabled = true; now.textContent = 'ياخذ نسخة…';
      api('/api/backup', { op: 'now' }).then(function () { toast('انحفظت نسخة احتياطية'); loadBackups(); }, function (e) { now.disabled = false; now.textContent = 'خذ نسخة الحين'; toast(e.message); });
    });
    var fileBtn = document.getElementById('bkFileBtn'), file = document.getElementById('bkFile');
    if (fileBtn) fileBtn.addEventListener('click', function () { file.click(); });
    if (file) file.addEventListener('change', function () {
      var f = file.files && file.files[0]; file.value = ''; if (!f) return;
      var msg = document.getElementById('bkMsg'); msg.textContent = 'يرفع الملف…';
      api('/api/rec', { op: 'prepare', kind: 'backup', size: f.size }).then(function (p) {
        return blobLib().then(function (lib) {
          return lib.upload(p.prefix + 'majalis-upload-' + stampName() + (/\.gz$/i.test(f.name) ? '.json.gz' : '.json'), f, { access: p.access || 'private', handleUploadUrl: '/api/upload', clientPayload: JSON.stringify({ kind: 'backup', size: f.size }), contentType: /\.gz$/i.test(f.name) ? 'application/gzip' : 'application/json' });
        });
      }).then(function (res) {
        msg.innerHTML = '';
        var box = document.createElement('div'); box.className = 'bk-restore'; box.innerHTML = '<p><b>استرجاع من «' + esc(f.name) + '»</b></p>' + restoreFormHtml();
        msg.appendChild(box);
        box.addEventListener('click', function (e) {
          var b = e.target.closest('[data-r]'); if (!b) return;
          if (b.dataset.r === 'cancel') { msg.innerHTML = ''; return; }
          if (b.dataset.r === 'go') runRestore(box, { url: res.url, pathname: res.pathname, size: f.size });
        });
      }, function (e) { msg.textContent = e.message || 'ما انرفع الملف'; });
    });
    document.querySelectorAll('.bk-row').forEach(function (row) {
      row.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        var id = row.dataset.bk, box = row.querySelector('.bk-restore');
        if (b.dataset.bkAct === 'dl') {
          b.disabled = true;
          api('/api/backup', { op: 'link', id: id }).then(function (j) { b.disabled = false; window.open(j.url, '_blank', 'noopener'); }, function (er) { b.disabled = false; toast(er.message); });
        } else if (b.dataset.bkAct === 'restore') {
          box.hidden = !box.hidden;
          if (!box.hidden) box.innerHTML = restoreFormHtml();
        } else if (b.dataset.r === 'cancel') { box.hidden = true; }
        else if (b.dataset.r === 'go') runRestore(box, { id: id });
      });
    });
  }

  boot();
})();
