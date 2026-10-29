/* مجالس المشايخ — الواجهة. البيانات من /api/data و/api/majlis، والتعديلات عبر /api/act */
(function () {
  'use strict';
  var app = document.getElementById('app');
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
    api('/api/data').then(function (j) {
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
    if (h.indexOf('s-') === 0 && h.length > 2) openSession(h.slice(2));
    else if (h === 'admin' && me.role === 'admin') openAdmin();
    else openHome();
  }
  window.addEventListener('hashchange', route);
  function leaveSession() { if (!cur) return; flushAll(); cur = null; }

  /* ================= LOGIN / FIRST-RUN SETUP ================= */
  function showLogin() {
    if (view === 'login') return;
    leaveSession(); view = 'login'; me = null;
    renderAuth('login');
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
          if (reg && x.j.pending) { renderPending(); return; }
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
      '<div class="who"><span>' + esc(me && me.name) + '</span>' + (me && me.role === 'admin' ? '<a class="linkish" href="#admin">المستخدمون</a>' : '') + '<button class="linkish" id="logout" type="button">خروج</button></div></div>' +
      '<h1>دفتر مجالس المشايخ</h1>' +
      '<p class="lede">سجّل كل مجلس: التحضير، والأسئلة، وأجوبة الشيخ، والفوائد. وتقدر تضيف أسئلة وتعدّلها وأنت في الجلسة.</p></header>' +
      '<main class="home-main wrap">' +
      pendingHtml() +
      aiPanelHtml() +
      '<div class="btns"><button class="btn" id="newBtn" type="button">جلسة يدوية</button></div>' +
      '<form class="new-form" id="newForm" hidden autocomplete="off">' +
      '<div class="new-grid">' +
      '<div class="field"><label for="nf-sheikh">اسم الشيخ</label><input class="input" id="nf-sheikh" required placeholder="مثال: الشيخ عبدالله"></div>' +
      '<div class="field"><label for="nf-date">التاريخ</label><input class="input" id="nf-date" type="date"></div>' +
      '<div class="field wide"><label for="nf-topic">موضوع الجلسة</label><input class="input" id="nf-topic" placeholder="وش الموضوع اللي تبي تركز عليه؟"></div>' +
      '</div><p class="login-err" id="nf-err" role="alert"></p><div class="btns"><button class="btn primary" type="submit">إنشاء الجلسة</button><button class="btn ghost" type="button" id="nfCancel">إلغاء</button></div></form>' +
      '<div class="list" id="list"></div></main>';
    var form = document.getElementById('newForm');
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
      return '<a class="s-card" href="#s-' + esc(s.id) + '"><span class="s-name">' + esc(str(s.sheikh) || 'بدون اسم') + '</span>' +
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

  /* ================= ADMIN: users and AI approval ================= */
  function openAdmin() {
    leaveSession();
    view = 'admin';
    document.title = 'المستخدمون · مجالس المشايخ';
    app.innerHTML =
      '<header class="s-top wrap"><a class="back" href="#">‹ كل الجلسات</a><h1>المستخدمون</h1>' +
      '<p class="lede">أي حساب جديد ما يدخل الموقع إلا بعد ما تقبله. وبعد القبول يستخدم الدفتر يدويًا، وفعّل «الذكاء الاصطناعي» للي تبيهم يجهّزون جلسات من رصيدك. وكل مستخدم يشوف جلساته هو بس.</p></header>' +
      '<main class="home-main wrap">' +
      '<form class="limit-row" id="limitForm"><label for="lim">حد الجلسات بالذكاء الاصطناعي لكل مستخدم في اليوم</label>' +
      '<input class="input" id="lim" type="number" min="0" max="50" inputmode="numeric" style="max-width:110px"><button class="btn" type="submit">حفظ</button><span class="hint" id="limMsg"></span></form>' +
      '<div class="list" id="users"><p class="empty">جاري التحميل</p></div></main>';
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
        return '<div class="u-row" data-id="' + esc(u.id) + '"><div class="u-main"><div class="u-line"><b>' + esc(u.name) + '</b><span class="u-sub" dir="ltr">@' + esc(u.username) + '</span>' +
          (isAdm ? '<span class="chip">المدير</span>' : '') + (!isAdm && !u.approved ? '<span class="chip">بانتظار الموافقة</span>' : '') + '</div>' +
          '<span class="u-sub">' + ar(u.majalis) + ' جلسة · ' + ar(u.ai30) + ' بالذكاء الاصطناعي آخر ٣٠ يوم</span>' +
          (u.about ? '<span class="u-sub">' + esc(u.about) + '</span>' : '') + '</div>' +
          (isAdm ? '' : !u.approved
            ? '<div class="u-act"><button class="btn primary" type="button" data-approve>قبول</button>' +
              '<button class="icon-btn" type="button" data-del data-label="رفض">رفض</button></div>'
            : '<div class="u-act"><label class="asked"><input type="checkbox" data-ai ' + (u.aiAllowed ? 'checked' : '') + '><span>الذكاء الاصطناعي</span></label>' +
              '<button class="icon-btn" type="button" data-suspend>إيقاف</button>' +
              '<button class="icon-btn" type="button" data-del data-label="حذف">حذف</button></div>') + '</div>';
      }).join('') || '<p class="empty">ما فيه مستخدمين</p>';
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
  var META_FIELDS = ['sheikh', 'topic', 'date', 'place', 'opening', 'briefing', 'books', 'general'];

  function openSession(sid) {
    if (cur && cur.sid === sid) return;
    leaveSession();
    view = 'session';
    cur = { sid: sid, meta: null, qs: {}, els: {}, editing: {}, richEdit: {}, creating: {}, deleting: {}, loaded: false };
    app.innerHTML =
      '<header class="s-top wrap">' +
      '<a class="back" href="#">‹ كل الجلسات</a>' +
      '<div class="eyebrow">مجلس مع</div>' +
      '<input class="title-in" id="m-sheikh" data-f="sheikh" aria-label="اسم الشيخ" placeholder="اسم الشيخ">' +
      '<div class="meta-grid">' +
      '<div class="field"><label for="m-topic">الموضوع</label><input class="input" id="m-topic" data-f="topic" placeholder="موضوع الجلسة"></div>' +
      '<div class="field"><label for="m-date">التاريخ</label><input class="input" id="m-date" data-f="date" type="date"><span class="hijri" id="m-hijri"></span></div>' +
      '<div class="field"><label for="m-place">المكان</label><input class="input" id="m-place" data-f="place" placeholder="المسجد أو المدينة"></div>' +
      '</div></header>' +
      '<nav class="bar" aria-label="أقسام الجلسة"><div class="wrap"><div class="links">' +
      '<button type="button" data-jump="sec-prep">التحضير</button>' +
      '<button type="button" data-jump="sec-q">الأسئلة</button>' +
      '<button type="button" data-jump="sec-notes">ملاحظات عامة</button>' +
      '<button type="button" data-jump="sec-brief">عن الشيخ</button>' +
      '</div><span class="status" id="status" data-s="connecting" role="status" aria-live="polite">جاري التجهيز</span></div></nav>' +
      '<main class="s-main wrap">' +
      '<p class="empty" id="loading">جاري تحميل الجلسة</p>' +
      '<div id="sessionBody" hidden style="display:grid;gap:52px">' +
      richSection('sec-prep', 'التحضير والافتتاح', 'opening', 'اكتب هنا كيف بتفتتح الجلسة وأي شيء تبي تتذكره قبلها.') +
      '<section class="sec" id="sec-q" aria-labelledby="h-q"><div class="sec-head"><h2 id="h-q">الأسئلة</h2></div>' +
      '<p class="lede">علّم على السؤال بعد ما تسأله، واكتب خلاصة جوابه تحته. وإذا طرأ لك سؤال أثناء الجلسة، أضفه من تحت.</p>' +
      '<div class="q-tools"><span class="progress" id="progress"></span><div class="btns">' +
      '<button class="btn" id="wakeBtn" type="button" aria-pressed="false" hidden>إبقاء الشاشة شغالة</button></div></div>' +
      '<div class="groups" id="groups"></div>' +
      '<form class="add-q" id="addQ" autocomplete="off"><span class="lbl">سؤال جديد</span>' +
      '<textarea class="note" id="aq-text" placeholder="اكتب السؤال" style="min-height:72px"></textarea>' +
      '<div class="add-row"><div class="field"><label for="aq-group">القسم</label><select class="input" id="aq-group">' +
      GROUPS.map(function (g) { return '<option value="' + g.key + '">' + g.label + '</option>'; }).join('') +
      '</select></div><button class="btn primary" type="submit">إضافة السؤال</button></div></form>' +
      '</section>' +
      '<section class="sec" id="sec-notes" aria-labelledby="h-notes"><h2 id="h-notes">ملاحظات عامة</h2><div class="notes-grid">' +
      '<div class="field"><label for="m-books">كتب وآثار ذكرها الشيخ</label><textarea class="note" id="m-books" data-f="books" placeholder="اكتب أسماء الكتب والآثار كما ذكرها"></textarea></div>' +
      '<div class="field"><label for="m-general">فوائد وأفكار للتطبيق</label><textarea class="note" id="m-general" data-f="general" placeholder="أي فائدة أو فكرة تبي تطبقها مع طلابك"></textarea></div>' +
      '</div><div class="btns"><button class="btn primary" id="copyAll" type="button">نسخ الجلسة كاملة</button><button class="btn" id="copyQ" type="button">نسخ الأسئلة فقط</button></div>' +
      '<textarea id="copyBox" readonly hidden aria-label="النص للنسخ"></textarea></section>' +
      richSection('sec-brief', 'عن الشيخ', 'briefing', 'اكتب هنا ما تعرفه عن الشيخ وأسلوبه.') +
      '<div class="danger-zone"><button class="btn ghost" id="delSession" type="button">حذف الجلسة</button></div>' +
      '</div></main>';
    wireSession();
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
    if (view === 'home') api('/api/data').then(function (j) { list = j.majalis || []; if (view === 'home') renderList(); }, function () {});
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
    ['sheikh', 'topic', 'date', 'place', 'books', 'general'].forEach(function (f) {
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
    li.className = 'q'; li.dataset.qid = id;
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
      '<div class="field"><label for="ans-' + id + '">جواب الشيخ</label><textarea class="note answer" id="ans-' + id + '" placeholder="اكتب خلاصة جوابه هنا"></textarea></div>' +
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
      writeMeta(t.dataset.f, t.dataset.f === 'date' ? 0 : 900);
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

  boot();
})();
