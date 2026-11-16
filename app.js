/* 课程应用逻辑：路由、渲染、进度、测验、工具 */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
      catch (e) { return fallback; }
    },
    set(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* file:// 下可能不可用 */ }
    }
  };

  let persistent = true;
  try { localStorage.setItem('course.probe', '1'); localStorage.removeItem('course.probe'); }
  catch (e) { persistent = false; }

  const state = {
    done: new Set(store.get('course.done', [])),
    quiz: store.get('course.quiz', {}),
    doneAt: store.get('course.doneAt', {}),
    reviews: store.get('course.reviews', {}),
    checklist: store.get('course.checklist', {}),
    filter: '全部',
    caseQ: '',
    caseSource: '全部',
    caseTag: '全部',
    caseLimit: 48
  };

  Object.keys(state.quiz).forEach(k => {
    if (typeof state.quiz[k] === 'number') {
      state.quiz[k] = { choice: state.quiz[k], correct: false, attempts: 1, at: Date.now() };
    }
  });

  const lessons = [];
  COURSE.modules.forEach((m, mi) => m.lessons.forEach((l, li) => lessons.push({ m, mi, l, li })));
  const totalMinutes = lessons.reduce((s, x) => s + (x.l.minutes || 0), 0);

  // 课程重组后清理已不存在的课节记录
  const PARTS = (COURSE.parts && COURSE.parts.length) ? COURSE.parts
    : [{ id: 'p1', title: '', sub: '', modules: COURSE.modules.map(m => m.id) }];

  function partOfModule(modId) {
    const pi = PARTS.findIndex(pt => pt.modules.indexOf(modId) >= 0);
    return { part: PARTS[Math.max(0, pi)], index: Math.max(0, pi) };
  }

  const validIds = new Set(lessons.map(x => x.l.id));
  Array.from(state.done).forEach(id => { if (!validIds.has(id)) state.done.delete(id); });
  Object.keys(state.doneAt).forEach(id => { if (!validIds.has(id)) delete state.doneAt[id]; });
  Object.keys(state.reviews).forEach(id => { if (!validIds.has(id)) delete state.reviews[id]; });
  Object.keys(state.quiz).forEach(key => { if (!validIds.has(key.split(':')[0])) delete state.quiz[key]; });
  const caseCount = (typeof CASE_LIB !== 'undefined') ? CASE_LIB.length : 0;
  const methodCount = (typeof FRAMEWORKS !== 'undefined' ? FRAMEWORKS.length : 0) +
                      (typeof METHODS !== 'undefined' ? METHODS.length : 0);

  /* ---------------- 工具 ---------------- */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function inline(s) {
    let t = esc(s);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, url) => {
      const target = /^https?:/.test(url) ? ' target="_blank" rel="noopener"' : '';
      return '<a href="' + url + '"' + target + '>' + label + '</a>';
    });
    return t;
  }
  function save() {
    store.set('course.done', Array.from(state.done));
    store.set('course.quiz', state.quiz);
    store.set('course.doneAt', state.doneAt);
    store.set('course.reviews', state.reviews);
    store.set('course.checklist', state.checklist);
  }
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 1800);
  }
  function lessonIndex(id) { return lessons.findIndex(x => x.l.id === id); }
  function pct() { return lessons.length ? Math.round(state.done.size / lessons.length * 100) : 0; }

  /* ---------------- 导航 ---------------- */
  function renderNav(activeId) {
    const nav = $('#nav');
    nav.innerHTML = PARTS.map((part, pi) => {
      const mods = part.modules.map(id => COURSE.modules.find(m => m.id === id)).filter(Boolean);
      if (!mods.length) return '';
      const head = part.title
        ? '<div class="nav-part"><span>第 ' + String(pi + 1).padStart(2, '0') + ' 部</span>' + esc(part.title) + '</div>'
        : '';
      return head + mods.map(m => {
        const mi = COURSE.modules.indexOf(m);
        const open = m.lessons.some(l => l.id === activeId) ||
          (pi === 0 && m === COURSE.modules[0]) ||
          m.lessons.some(l => l.id === activeId);
        return (
          '<div class="nav-module' + (open ? ' open' : '') + '">' +
            '<button data-mod="' + m.id + '" aria-expanded="' + open + '">' +
              '<span class="num">' + String(mi + 1).padStart(2, '0') + '</span>' +
              '<span>' + esc(m.title.split('：')[0]) + '</span>' +
              '<span class="chev">▸</span>' +
            '</button>' +
            '<div class="nav-lessons">' +
              m.lessons.map(l =>
                '<a href="#/lesson/' + l.id + '" class="' + (l.id === activeId ? 'active ' : '') + (state.done.has(l.id) ? 'done' : '') + '">' +
                  '<span class="dot"></span><span>' + esc(l.title) + '</span>' +
                '</a>'
              ).join('') +
            '</div>' +
          '</div>'
        );
      }).join('');
    }).join('');
    $$('.nav-module > button', nav).forEach(btn => {
      btn.addEventListener('click', () => btn.parentElement.classList.toggle('open'));
    });
    updateProgress();
  }

  function updateProgress() {
    const n = state.done.size;
    $('#progressText').textContent = n + ' / ' + lessons.length;
    $('#progressFill').style.width = pct() + '%';
  }

  /* ---------------- 首页 ---------------- */
  function renderHome() {
    const paths = [
      ['零基础转行', '1 → 2 → 3 → 4 → 5 → 9：先角色与需求，再文档与体验，最后数据。'],
      ['在职提升', '2 → 3 → 4 → 11 → 12：补需求、文档、规划与增长。'],
      ['面试准备', '1 → 3 → 13：项目、作品集与 30/60/90。']
    ];
    const moduleCard = (m, i) => {
      const done = m.lessons.filter(l => state.done.has(l.id)).length;
      const mins = m.lessons.reduce((s, l) => s + l.minutes, 0);
      return (
        '<a class="module-card" href="#/lesson/' + m.lessons[0].id + '">' +
          '<span class="go">↗</span>' +
          '<div class="mnum">MODULE ' + String(i + 1).padStart(2, '0') + '</div>' +
          '<h3>' + esc(m.title.split('：')[0]) +
            (done === m.lessons.length ? '<span class="badge-done">已完成</span>' : '') + '</h3>' +
          '<p>' + esc(m.sub) + '</p>' +
          '<div class="meta"><span>' + m.lessons.length + ' 节</span><span>' + mins + ' 分钟</span><span>' + done + '/' + m.lessons.length + '</span></div>' +
        '</a>'
      );
    };
    const modules = PARTS.map((part, pi) => {
      const mods = part.modules.map(id => COURSE.modules.find(m => m.id === id)).filter(Boolean);
      if (!mods.length) return '';
      return '<div class="part-block">' +
        '<div class="part-head"><span class="pnum">第 ' + String(pi + 1).padStart(2, '0') + ' 部</span>' +
        '<h3>' + esc(part.title) + '</h3><p>' + esc(part.sub) + '</p></div>' +
        '<div class="module-grid">' + mods.map(m => moduleCard(m, COURSE.modules.indexOf(m))).join('') + '</div>' +
      '</div>';
    }).join('');

    const cases = CASES.slice(0, 3).map(c =>
      '<div class="case-card"><h3>' + esc(c.name) + '</h3><div class="site">' + esc(c.site) + '</div>' +
      '<p>' + esc(c.desc) + '</p><div class="tags">' + c.tags.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' +
      '<div class="use"><b>怎么用：</b>' + esc(c.use) + '</div></div>'
    ).join('');

    $('#view').innerHTML =
      '<div class="page">' +
        '<section class="hero">' +
          '<div class="kicker">产品经理 · 入门课</div>' +
          '<h1>从需求到上线，先学会<em>判断</em>。</h1>' +
          '<p class="lede">' + esc(COURSE.intro) + '</p>' +
          '<div class="hero-meta">' +
            '<span class="chip"><b>' + PARTS.length + '</b> 个篇章</span>' +
            '<span class="chip"><b>' + COURSE.modules.length + '</b> 个模块</span>' +
            '<span class="chip"><b>' + lessons.length + '</b> 节课</span>' +
            '<span class="chip">约 <b>' + Math.round(totalMinutes / 60) + '</b> 小时</span>' +
            '<span class="chip"><b>' + caseCount.toLocaleString() + '</b> 个案例</span>' +
            '<span class="chip"><b>' + CASES.length + '</b> 个库</span>' +
            (reviewDue().length ? '<a class="chip" href="#/review"><b>' + reviewDue().length + '</b> 项待复习 →</a>' : '') +
          '</div>' +
          '<div class="btn-row">' +
            '<a class="btn" href="#/lesson/' + lessons[0].l.id + '">开始第一课 →</a>' +
            '<a class="btn ghost" href="#/toolkit">打开工具箱</a>' +
            '<a class="btn ghost" href="#/cases">浏览案例库</a>' +
          '</div>' +
        '</section>' +

        '<div class="stats">' +
          '<div class="stat"><b>' + lessons.length + '</b><span>节课</span></div>' +
          '<div class="stat"><b>' + Math.round(totalMinutes / 60) + 'h</b><span>总时长</span></div>' +
          '<div class="stat"><b>' + caseCount.toLocaleString() + '</b><span>案例</span></div>' +
          '<div class="stat"><b>' + pct() + '%</b><span>进度</span></div>' +
        '</div>' +

        '<div class="section-head"><h2>课程结构</h2><span class="hint">' + PARTS.length + ' 部 · ' + COURSE.modules.length + ' 模块 · ' + lessons.length + ' 节，从判断到交付</span></div>' +
        modules +

        '<div class="section-head"><h2>三条学习路径</h2><span class="hint">时间有限就按任务选</span></div>' +
        '<div class="paths">' + paths.map(p => '<div class="path"><b>' + p[0] + '</b><span>' + p[1] + '</span></div>').join('') + '</div>' +

        '<div class="section-head"><h2>方法库与深度案例</h2><span class="hint">框架负责选，指标负责验</span></div>' +
        '<div class="paths">' +
          '<a class="path" href="#/library"><b>方法库 →</b><span>' + methodCount + ' 张方法卡：访谈、可用性测试、双钻、JTBD、RICE、HEART、NPS……每个都标了适用边界与误用。</span></a>' +
          '<a class="path" href="#/studies"><b>深度案例 →</b><span>' + (typeof STUDIES !== 'undefined' ? STUDIES.length : 0) + ' 个真实改版：GOV.UK、Monzo、Duolingo、Shopify，按问题→干预→结果拆解。</span></a>' +
          '<a class="path" href="#/review"><b>间隔复习 →</b><span>按 1/3/7/14 天回来，答错的测验 3 天后重做；复习先回忆，再对照。</span></a>' +
        '</div>' +

        '<div class="section-head"><h2>案例库怎么用</h2><span class="hint">已收录 ' + caseCount.toLocaleString() + ' 个具体案例</span></div>' +
        '<div class="case-grid">' + cases + '</div>' +
        '<div class="btn-row" style="margin-top:14px"><a class="btn ghost" href="#/cases">进入案例目录（' + caseCount.toLocaleString() + ' 条）→</a></div>' +

        '<div class="footer">内容整理自 NN/g 交互设计主题、Web UX 指南、GOV.UK Design System、Ant Design 规范、GOV.UK 用户研究、IxDF。仅供学习使用。</div>' +
      '</div>';
  }

  /* ---------------- 课程页 ---------------- */
  function renderOne(b) {
    switch (b.t) {
        case 'p': return '<p>' + inline(b.x) + '</p>';
        case 'h': return '<h2>' + inline(b.x) + '</h2>';
        case 'quote': return '<blockquote>' + inline(b.x) + '</blockquote>';
        case 'ul': return '<ul>' + b.x.map(i => '<li>' + inline(i) + '</li>').join('') + '</ul>';
        case 'ol': return '<ol>' + b.x.map(i => '<li>' + inline(i) + '</li>').join('') + '</ol>';
        case 'tip': case 'warn': case 'case':
          return '<div class="callout ' + b.t + '"><span class="ct">' +
            (b.t === 'tip' ? '判断 / 建议' : b.t === 'warn' ? '注意' : '案例') + '</span>' + inline(b.x) + '</div>';
        case 'table':
          return '<div class="table-wrap"><table><thead><tr>' +
            b.head.map(h => '<th>' + inline(h) + '</th>').join('') +
            '</tr></thead><tbody>' +
            b.rows.map(r => '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') +
            '</tbody></table></div>';
        case 'ex':
          return '<div class="exercise"><div class="label">练习</div><h4>' + inline(b.title) + '</h4><p>' + inline(b.x) + '</p>' +
            (b.steps && b.steps.length ? '<ol>' + b.steps.map(s => '<li>' + inline(s) + '</li>').join('') + '</ol>' : '') +
            (b.rubric && b.rubric.length ? '<div class="rubric"><b>评分标准</b><ul>' + b.rubric.map(r => '<li>' + inline(r) + '</li>').join('') + '</ul></div>' : '') +
            '</div>';
        case 'recall':
          return '<div class="pretest recall"><span class="label">合上写 3 条</span><p>' + inline(b.q) + '</p>' +
            '<button class="pt-toggle" type="button">看参考要点</button>' +
            '<div class="pt-answer" hidden><ul>' + (b.points || []).map(x => '<li>' + inline(x) + '</li>').join('') + '</ul></div></div>';
        case 'links':
          return '<div class="links-block"><h4>延伸</h4>' +
            b.x.map(l => '<a href="' + l.u + '"' + (/^https?:/.test(l.u) ? ' target="_blank" rel="noopener"' : '') + '>' + esc(l.t) + ' ↗</a>').join('') + '</div>';
        case 'pretest':
          return '<div class="pretest"><span class="label">先判断</span><p>' + inline(b.q) + '</p>' +
            '<button class="pt-toggle" type="button">看解释</button>' +
            '<div class="pt-answer" hidden>' + inline(b.a) + '</div></div>';
        case 'quiz': return '';
        default: return '';
    }
  }

  function renderBlocks(blocks) {
    return blocks.map(renderOne).join('');
  }

  function quizKey(lessonId, idx) { return idx === 0 ? lessonId : lessonId + ':' + idx; }

  function quizExplain(q, saved) {
    if (!saved) return '';
    if (saved.correct) return '答对了。' + inline(q.why);
    let html = '正确答案：' + String.fromCharCode(65 + q.a) + '。' + inline(q.why);
    const why = (q.whyWrong || [])[saved.choice];
    if (why) html += '<br><br>你选的 ' + String.fromCharCode(65 + saved.choice) + '：' + inline(why);
    return html;
  }

  function renderQuiz(q, lessonId, idx) {
    const key = quizKey(lessonId, idx);
    const saved = state.quiz[key];
    const options = q.opts.map((o, i) => {
      let cls = 'opt';
      if (saved) {
        if (i === q.a) cls += ' correct';
        else if (i === saved.choice) cls += ' wrong';
      }
      return '<button class="' + cls + '" data-i="' + i + '"' + (saved ? ' disabled' : '') + '>' +
        String.fromCharCode(65 + i) + '. ' + inline(o) + '</button>';
    }).join('');
    return '<div class="quiz" data-quiz="' + key + '">' +
      '<div class="label">随堂测验' + (idx ? ' · ' + (idx + 1) : '') + '</div>' +
      '<h4>' + inline(q.q) + '</h4>' + options +
      '<div class="explain' + (saved ? ' show' : '') + '" id="explain-' + key + '">' + quizExplain(q, saved) + '</div>' +
      (saved && !saved.correct ? '<button class="quiz-retry" data-retry="' + key + '">再试一次</button>' : '') +
    '</div>';
  }

  function bindQuiz(q, lessonId, idx) {
    const key = quizKey(lessonId, idx);
    const box = $('[data-quiz="' + key + '"]');
    if (!box) return;
    $$('.opt', box).forEach(btn => {
      btn.addEventListener('click', () => {
        const saved = state.quiz[key];
        if (saved && saved.correct) return;
        const i = +btn.dataset.i;
        state.quiz[key] = {
          choice: i, correct: i === q.a,
          attempts: (saved ? (saved.attempts || 1) : 0) + 1, at: Date.now()
        };
        save();
        renderLesson(lessonId);
        toast(i === q.a ? '答对了' : '还不对，看看解释再试');
      });
    });
  }

  function renderLesson(id) {
    const idx = lessonIndex(id);
    if (idx < 0) { location.hash = '#/'; return; }
    const { m, mi, l, li } = lessons[idx];
    const quizBlocks = (l.blocks || []).filter(b => b.t === 'quiz');
    const prev = lessons[idx - 1], next = lessons[idx + 1];
    const done = state.done.has(id);
    const allCorrect = quizBlocks.every((q, i) => (state.quiz[quizKey(id, i)] || {}).correct);

    $('#view').innerHTML =
      '<div class="page">' +
        '<div class="lesson-head">' +
          '<div class="kicker">第 ' + String(partOfModule(m.id).index + 1).padStart(2, '0') + ' 部 · 模块 ' + String(mi + 1).padStart(2, '0') + ' · 第 ' + (li + 1) + ' 节</div>' +
          '<h1>' + esc(l.title) + '</h1>' +
          '<div class="lesson-meta">' +
            '<span>' + esc(m.title.split('：')[0]) + '</span>' +
            '<span>' + (l.minutes || 8) + ' 分钟</span>' +
            '<span>' + (done ? '✓ 已完成' : '未完成') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="objectives"><h4>你将能够</h4><ul>' + l.objectives.map(o => '<li>' + inline(o) + '</li>').join('') + '</ul></div>' +
        '<div class="prose">' + l.blocks.map(b => b.t === 'quiz' ? renderQuiz(b, id, quizBlocks.indexOf(b)) : renderOne(b)).join('') + '</div>' +
        '<div class="lesson-foot">' +
          (prev ? '<a class="icon-btn nav-btn" href="#/lesson/' + prev.l.id + '">← 上一节</a>' : '<span></span>') +
          '<div class="spacer"></div>' +
          '<button class="btn done-btn ' + (done ? 'is-done' : '') + '" id="doneBtn">' + (done ? '✓ 已完成' : '标记为已完成') + '</button>' +
          (next ? '<a class="icon-btn nav-btn" href="#/lesson/' + next.l.id + '">下一节 →</a>' : '<a class="icon-btn nav-btn" href="#/toolkit">去工具箱 →</a>') +
        '</div>' +
      '</div>';

    quizBlocks.forEach((q, i) => bindQuiz(q, id, i));
    $$('.quiz-retry').forEach(b => b.addEventListener('click', () => {
      delete state.quiz[b.dataset.retry];
      save();
      renderLesson(id);
    }));
    $$('.pt-toggle').forEach(b => b.addEventListener('click', () => {
      const ans = b.nextElementSibling;
      ans.hidden = !ans.hidden;
      b.textContent = ans.hidden ? '看解释' : '收起解释';
    }));
    $('#doneBtn').addEventListener('click', () => {
      if (!state.done.has(id) && !allCorrect) {
        toast('先答对随堂测验，再标记完成');
        const first = $('.quiz');
        if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (state.done.has(id)) {
        state.done.delete(id);
        delete state.doneAt[id];
        delete state.reviews[id];
      } else {
        state.done.add(id);
        state.doneAt[id] = Date.now();
        state.reviews[id] = state.reviews[id] || 0;
      }
      save();
      renderNav(id);
      renderLesson(id);
      toast(state.done.has(id) ? '已标记完成，1 天后进入复习' : '已取消完成');
    });
    const pInfo = partOfModule(m.id);
    $('#crumb').innerHTML = '<span>' + esc(pInfo.part.title) + '</span><span>/</span><b>' + esc(l.title) + '</b>';
    renderNav(id);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /* ---------------- 案例库 ---------------- */
  function caseTags() {
    const set = new Set();
    CASE_LIB.forEach(c => c.tags.forEach(t => set.add(t)));
    return ['全部'].concat(Array.from(set));
  }
  function sourceClass(name) {
    const i = Math.max(0, CASE_SOURCES.indexOf(name));
    return 'src-' + (i % 6);
  }
  function filteredCases() {
    const q = state.caseQ.trim().toLowerCase();
    return CASE_LIB.filter(c =>
      (state.caseSource === '全部' || c.source === state.caseSource) &&
      (state.caseTag === '全部' || c.tags.indexOf(state.caseTag) >= 0) &&
      (!q || c.search.indexOf(q) >= 0)
    );
  }
  function hueOf(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }
  function caseTile(c) {
    const initial = (c.title || '?').trim().charAt(0).toUpperCase();
    const img = c.image
      ? '<img loading="lazy" src="' + esc(c.image) + '" alt="" onerror="this.parentNode.classList.add(\'noimg\')">'
      : '';
    const hue = hueOf(c.title || '');
    const bg = c.image ? '' : ' style="background:hsl(' + hue + ' 22% 27%)"';
    return '<a class="case-tile" href="' + esc(c.url) + '" target="_blank" rel="noopener">' +
      '<div class="thumb ' + sourceClass(c.source) + (c.image ? '' : ' noimg') + '"' + bg + '>' + img +
        '<span class="mono">' + esc(initial) + '</span>' +
        '<span class="src-badge">' + esc(c.source) + '</span>' +
      '</div>' +
      '<div class="tile-body">' +
        '<h3>' + esc(c.title) + '</h3>' +
        '<p>' + esc(c.note || '') + '</p>' +
        '<div class="tile-tags">' + c.tags.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' +
      '</div>' +
    '</a>';
  }
  function renderCases() {
    const list = filteredCases();
    const shown = list.slice(0, state.caseLimit);
    const sourceChips = CASE_SOURCES.map(s =>
      '<button class="filter' + (state.caseSource === s ? ' active' : '') + '" data-source="' + esc(s) + '">' + esc(s) + '</button>').join('');
    const tagChips = caseTags().map(t =>
      '<button class="filter sm' + (state.caseTag === t ? ' active' : '') + '" data-tag="' + esc(t) + '">' + esc(t) + '</button>').join('');
    const libs = CASES.map(c =>
      '<div class="case-card"><h3>' + esc(c.name) + '</h3><div class="site">' + esc(c.site) + '</div>' +
      '<p>' + esc(c.desc) + '</p><div class="tags">' + c.tags.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' +
      '<div class="use"><b>怎么用：</b>' + esc(c.use) + '</div></div>').join('');

    $('#view').innerHTML =
      '<div class="page wide">' +
        '<div class="kicker">案例库</div>' +
        '<h1 class="page-title">' + CASE_LIB.length.toLocaleString() + ' 个案例，按问题找</h1>' +
        '<p style="color:var(--ink-2);max-width:46em">从 7 个库拉下来的目录：产品流程、增长拆解、数据叙事、整站视觉、微交互与新闻专题。带着问题搜，不要从头刷。</p>' +
        '<div class="search-row"><input id="caseSearch" type="search" placeholder="' + (window.innerWidth < 600 ? '搜案例、产品或标签…' : '搜产品、主题或标签，例如：airbnb / onboarding / 空状态') + '" value="' + esc(state.caseQ) + '"></div>' +
        '<div class="filter-bar"><span class="filter-label">来源</span>' + sourceChips + '</div>' +
        '<div class="filter-bar"><span class="filter-label">标签</span>' + tagChips + '</div>' +
        '<div class="result-meta">共 <b>' + list.length.toLocaleString() + '</b> 条 · 显示 ' + shown.length + ' 条</div>' +
        '<div class="case-grid-tiles">' + (shown.length ? shown.map(caseTile).join('') : '<div class="empty">没有匹配的案例，换个关键词或清空筛选。</div>') + '</div>' +
        (list.length > shown.length ? '<div class="load-more"><button class="btn ghost" id="loadMore">加载更多（还剩 ' + (list.length - shown.length) + ' 条）</button></div>' : '') +
        '<div class="section-head" style="margin-top:56px"><h2>七个原始库</h2><span class="hint">目录之外的浏览方式</span></div>' +
        '<div class="case-grid">' + libs + '</div>' +
        '<div class="footer">案例链接与缩略图归各来源所有；目录由 tools/fetch_cases.py 生成，仅供学习索引。</div>' +
      '</div>';

    let timer = null;
    $('#caseSearch').addEventListener('input', e => {
      clearTimeout(timer);
      const v = e.target.value;
      timer = setTimeout(() => { state.caseQ = v; state.caseLimit = 48; renderCases(); $('#caseSearch').focus(); }, 260);
    });
    $$('.filter[data-source]').forEach(btn => btn.addEventListener('click', () => {
      state.caseSource = btn.dataset.source; state.caseLimit = 48; renderCases();
    }));
    $$('.filter[data-tag]').forEach(btn => btn.addEventListener('click', () => {
      state.caseTag = btn.dataset.tag; state.caseLimit = 48; renderCases();
    }));
    const more = $('#loadMore');
    if (more) more.addEventListener('click', () => { state.caseLimit += 48; renderCases(); });
  }

  /* ---------------- 工具箱 ---------------- */
  function specMarkdown(v) {
    const lines = ['# ' + (v.name || '未命名功能') + ' 交互规格', '', '## 1. 任务与成功信号',
      '- 主任务：' + (v.task || '（待补）'), '- 成功信号：' + (v.success || '（待补）'), '',
      '## 2. 状态模型', '- 必须覆盖：' + (v.states || '加载 / 空 / 失败 / 超时 / 无权限 / 离线'), '',
      '## 3. 异步与错误', '- 失败与恢复：' + (v.error || '（待补）'), '',
      '## 4. 边界与分支', '- ' + (v.boundary || '（待补）'), '',
      '## 5. 非功能要求', '- ' + (v.nonfunc || '（待补）'), '',
      '## 6. 键盘与无障碍', '- ' + (v.a11y || '（待补）'), '',
      '## 7. 待确认', '- ' + (v.open || '（待补）'), '',
      '## 8. 验收清单', '- [ ] 主路径可完成，成功状态可见', '- [ ] 失败可重试，输入不丢',
      '- [ ] 重复提交被阻止', '- [ ] 键盘可完成主任务', '- [ ] 断网/超时表现明确'];
    return lines.join('\n');
  }

  function renderToolkit() {
    const fields = SPEC_FIELDS.map(f =>
      '<div class="field"><label for="f-' + f.id + '">' + esc(f.label) + '</label>' +
      (f.id === 'error' || f.id === 'open' || f.id === 'a11y' || f.id === 'boundary' || f.id === 'nonfunc'
        ? '<textarea id="f-' + f.id + '" placeholder="' + esc(f.ph) + '"></textarea>'
        : '<input id="f-' + f.id + '" placeholder="' + esc(f.ph) + '">') + '</div>').join('');

    const checks = HIGH_RISK.map((h, i) =>
      '<li><input type="checkbox" id="hr-' + i + '" data-i="' + i + '"' + (state.checklist[i] ? ' checked' : '') + '>' +
      '<label for="hr-' + i + '"><b>' + esc(h[0]) + '</b>：' + esc(h[1]) + '</label></li>').join('');

    $('#view').innerHTML =
      '<div class="page">' +
        '<div class="kicker">工具箱</div>' +
        '<h1 class="page-title">把判断变成交付物</h1>' +
        '<p style="color:var(--ink-2);max-width:44em">两份最小工具：一份能直接粘进需求文档的交互规格，一份上线前必查的高风险清单。数据只存在本机浏览器。</p>' +

        '<div class="tool-card">' +
          '<h3>交互规格生成器</h3>' +
          '<p class="hint">填空 → 生成 Markdown → 复制到需求文档。不要留空，留空的部分就是开发要回来问你的问题。</p>' +
          fields +
          '<div class="copy-row"><button class="btn" id="genBtn">生成规格</button>' +
          '<button class="btn ghost" id="copyBtn">复制 Markdown</button></div>' +
          '<pre class="output" id="specOut">填写上面的字段，然后点「生成规格」。</pre>' +
        '</div>' +

        '<div class="tool-card">' +
          '<h3>高风险自检（10 项）</h3>' +
          '<p class="hint">走查与提测前逐项过。没问题写「已检查」，不适用写「不适用」——跳过等于没查。</p>' +
          '<ul class="check-list">' + checks + '</ul>' +
          '<div class="copy-row"><button class="btn ghost" id="checkCopy">复制自检结果</button></div>' +
        '</div>' +

        '<div class="tool-card">' +
          '<h3>走查报告骨架</h3>' +
          '<p class="hint">直接复制，按 P0/P1/P2 填。</p>' +
          '<pre class="output" id="reviewOut"># <页面/组件> 交互走查\n\n## 0. 范围与取证\n- 主任务：\n- 本次为：静态走查 / 实际走查\n- 未验证的部分：\n\n## 结论\n- 最大风险：\n- 最值得先改的一件事：\n\n## 问题清单\n| # | 严重度 | 位置 | 问题 | 影响 | 修法 |\n|---|---|---|---|---|---|\n\n## 需确认\n| 待确认 | 为什么重要 | 怎么确认 |\n|---|---|---|\n\n## 建议的验收动作\n1.\n2.\n3.</pre>' +
          '<div class="copy-row"><button class="btn ghost" id="reviewCopy">复制骨架</button></div>' +
        '</div>' +

        '<div class="footer">模板参考本课第 8 模块与 references 中的 spec / review 模板。</div>' +
      '</div>';

    $('#genBtn').addEventListener('click', () => {
      const v = {};
      SPEC_FIELDS.forEach(f => { v[f.id] = ($('#f-' + f.id).value || '').trim(); });
      $('#specOut').textContent = specMarkdown(v);
      toast('已生成规格');
    });
    $('#copyBtn').addEventListener('click', () => copy($('#specOut').textContent));
    $('#reviewCopy').addEventListener('click', () => copy($('#reviewOut').textContent));
    $('#checkCopy').addEventListener('click', () => {
      const rows = HIGH_RISK.map((h, i) => {
        const checked = state.checklist[i];
        return '- ' + h[0] + '：' + (checked ? '已检查（问题：待填）' : '未检查') + ' — ' + h[1];
      });
      copy('## 高风险自检\n' + rows.join('\n'));
    });
    $$('.check-list input').forEach(cb => cb.addEventListener('change', () => {
      state.checklist[cb.dataset.i] = cb.checked;
      save();
    }));
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast('已复制')).catch(() => fallbackCopy(text));
    } else { fallbackCopy(text); }
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('已复制'); } catch (e) { toast('复制失败，请手动选择'); }
    document.body.removeChild(ta);
  }

  /* ---------------- 方法库与深度案例 ---------------- */
  const LIB = { q: '', kind: '全部', study: '全部', grade: '全部' };

  function sourceChips(arr) {
    return arr.map(l => '<a href="' + esc(l.u) + '" target="_blank" rel="noopener">' + esc(l.t) + ' ↗</a>').join('');
  }

  function libraryItems() {
    const methods = (typeof METHODS !== 'undefined' ? METHODS : []).map(m => ({
      name: m.name, kind: '方法', problem: m.question, how: m.how,
      io: m.output, fit: m.when, misuse: m.pitfall, sources: m.sources
    }));
    const frameworks = (typeof FRAMEWORKS !== 'undefined' ? FRAMEWORKS : []);
    return methods.concat(frameworks);
  }

  function renderLibrary() {
    const q = LIB.q.trim().toLowerCase();
    const all = libraryItems();
    const list = all.filter(f =>
      (LIB.kind === '全部' || f.kind === LIB.kind) &&
      (!q || (f.name + f.problem + f.how).toLowerCase().indexOf(q) >= 0)
    );
    const kindsArr = all.some(f => f.kind === '方法') ? ['全部', '方法', '框架', '指标'] : ['全部', '框架', '指标'];
    const kinds = kindsArr.map(k =>
      '<button class="filter' + (LIB.kind === k ? ' active' : '') + '" data-kind="' + k + '">' + k + '</button>').join('');
    const cards = list.map(f =>
      '<div class="lib-card">' +
        '<div class="lib-top"><span class="lib-kind">' + esc(f.kind) + '</span><h3>' + esc(f.name) + '</h3></div>' +
        '<p class="lib-problem">' + esc(f.problem) + '</p>' +
        '<details><summary>怎么用、容易误用在哪</summary>' +
          '<p><b>用法：</b>' + esc(f.how) + '</p>' +
          (f.io ? '<p><b>输入 / 输出：</b>' + esc(f.io) + '</p>' : '') +
          (f.misuse ? '<p><b>常见误用：</b>' + esc(f.misuse) + '</p>' : '') +
          (f.fit ? '<p><b>适用边界：</b>' + esc(f.fit) + '</p>' : '') +
          (f.sources.length ? '<div class="lib-sources">' + sourceChips(f.sources) + '</div>' : '') +
        '</details>' +
      '</div>'
    ).join('');

    $('#view').innerHTML =
      '<div class="page wide">' +
        '<div class="kicker">方法库</div>' +
        '<h1 class="page-title">' + all.length + ' 张方法卡：研究、框架与指标</h1>' +
        '<p style="color:var(--ink-2);max-width:46em">框架负责「选」，指标负责「验」。先看它解决什么问题，再看误用——大多数框架失效不是因为不会用，而是用错了场景。</p>' +
        '<div class="search-row"><input id="libSearch" type="search" placeholder="搜框架、指标或问题，例如：优先级 / NPS / 行为" value="' + esc(LIB.q) + '"></div>' +
        '<div class="filter-bar"><span class="filter-label">类型</span>' + kinds + '</div>' +
        '<div class="result-meta">共 <b>' + list.length + '</b> 条</div>' +
        '<div class="lib-grid">' + (cards || '<div class="empty">没有匹配项。</div>') + '</div>' +
        '<div class="footer">框架卡整理自 Design Council、NN/g、GOV.UK、Google HEART 等公开资料；指标口径与局限见每张卡。</div>' +
      '</div>';

    let timer = null;
    $('#libSearch').addEventListener('input', e => {
      clearTimeout(timer);
      const v = e.target.value;
      timer = setTimeout(() => { LIB.q = v; renderLibrary(); $('#libSearch').focus(); }, 240);
    });
    $$('.filter[data-kind]').forEach(b => b.addEventListener('click', () => { LIB.kind = b.dataset.kind; renderLibrary(); }));
  }

  function renderStudies() {
    const q = LIB.q.trim().toLowerCase();
    const list = (typeof STUDIES !== 'undefined' ? STUDIES : []).filter(x =>
      (LIB.study === '全部' || x.type === LIB.study) &&
      (LIB.grade === '全部' || x.grade === LIB.grade) &&
      (!q || (x.name + x.background + x.result).toLowerCase().indexOf(q) >= 0)
    );
    const types = ['全部', '公共', '消费', '工具', '金融'].map(t =>
      '<button class="filter' + (LIB.study === t ? ' active' : '') + '" data-study="' + t + '">' + t + '</button>').join('');
    const grades = ['全部', 'A', 'B', 'C'].map(g =>
      '<button class="filter sm' + (LIB.grade === g ? ' active' : '') + '" data-grade="' + g + '">' + (g === '全部' ? '全部证据' : g + ' 级证据') + '</button>').join('');
    const cards = list.map(x =>
      '<details class="study-card">' +
        '<summary>' +
          '<span class="grade grade-' + x.grade + '">' + (x.grade ? x.grade + ' 级' : '未分级') + '</span>' +
          '<span class="study-title">' + esc(x.name) + '</span>' +
          '<span class="study-type">' + esc(x.type) + '</span>' +
        '</summary>' +
        '<div class="study-body">' +
          '<p><b>问题：</b>' + esc(x.background) + '</p>' +
          '<p><b>做了什么：</b>' + esc(x.action) + '</p>' +
          '<p><b>结果：</b>' + esc(x.result) + '</p>' +
          (x.why ? '<p><b>为什么 / 代价：</b>' + esc(x.why) + '</p>' : '') +
          (x.rules ? '<p class="study-rule"><b>可迁移：</b>' + esc(x.rules) + '</p>' : '') +
          (x.sources.length ? '<div class="lib-sources">' + sourceChips(x.sources) + '</div>' : '') +
        '</div>' +
      '</details>'
    ).join('');

    $('#view').innerHTML =
      '<div class="page wide">' +
        '<div class="kicker">深度案例</div>' +
        '<h1 class="page-title">' + (typeof STUDIES !== 'undefined' ? STUDIES.length : 0) + ' 个真实案例，带证据等级</h1>' +
        '<p style="color:var(--ink-2);max-width:46em">每个案例按「问题 → 干预 → 结果 → 可迁移规则」拆开，并标注证据等级。没有公开数字的，我们写「未公开」，不补故事。</p>' +
        '<div class="search-row"><input id="studySearch" type="search" placeholder="搜案例、产品或问题，例如：Monzo / 表单 / 留存" value="' + esc(LIB.q) + '"></div>' +
        '<div class="filter-bar"><span class="filter-label">类型</span>' + types + '</div>' +
        '<div class="filter-bar"><span class="filter-label">证据</span>' + grades + '</div>' +
        '<div class="result-meta">共 <b>' + list.length + '</b> 个案例</div>' +
        '<div class="study-list">' + (cards || '<div class="empty">没有匹配的案例。</div>') + '</div>' +
        '<div class="footer">案例只写有公开来源的内容；A 级=官方数据或独立审计，B 级=官方自述或可信媒体，C 级=定性/单一来源。</div>' +
      '</div>';

    let timer = null;
    $('#studySearch').addEventListener('input', e => {
      clearTimeout(timer);
      const v = e.target.value;
      timer = setTimeout(() => { LIB.q = v; renderStudies(); $('#studySearch').focus(); }, 240);
    });
    $$('.filter[data-study]').forEach(b => b.addEventListener('click', () => { LIB.study = b.dataset.study; renderStudies(); }));
    $$('.filter[data-grade]').forEach(b => b.addEventListener('click', () => { LIB.grade = b.dataset.grade; renderStudies(); }));
  }

  /* ---------------- 复习 ---------------- */
  const REVIEW_DAYS = [1, 3, 7, 14];

  function reviewDue() {
    const now = Date.now(), DAY = 86400000, items = [];
    lessons.forEach(({ l }) => {
      if (!state.done.has(l.id)) return;
      const stage = state.reviews[l.id] || 0;
      if (stage >= REVIEW_DAYS.length) return;
      const at = state.doneAt[l.id] || 0;
      if (now - at >= REVIEW_DAYS[stage] * DAY) {
        items.push({ type: 'lesson', id: l.id, title: l.title, stage: stage, dueAt: at + REVIEW_DAYS[stage] * DAY });
      }
    });
    Object.keys(state.quiz).forEach(key => {
      const v = state.quiz[key];
      if (v && v.correct === false && now - (v.at || 0) >= 3 * DAY) {
        const lessonId = key.split(':')[0];
        const item = lessons.find(x => x.l.id === lessonId);
        if (item) items.push({ type: 'quiz', id: lessonId, key: key, title: item.l.title, dueAt: (v.at || 0) + 3 * DAY });
      }
    });
    return items;
  }

  function renderReview() {
    const items = reviewDue();
    const rows = items.map((it, i) => {
      const label = it.type === 'lesson' ? '复习第 ' + (it.stage + 1) + ' 轮' : '重做测验';
      return '<div class="review-item">' +
        '<div class="review-main"><span class="review-type">' + label + '</span>' +
        '<h3>' + esc(it.title) + '</h3>' +
        '<span class="review-due">到期：' + new Date(it.dueAt).toLocaleDateString('zh-CN') + '</span></div>' +
        '<div class="review-actions">' +
          '<a class="btn ghost" href="#/lesson/' + it.id + '">去复习</a>' +
          (it.type === 'lesson' ? '<button class="btn" data-done-review="' + it.id + '">标记已复习</button>' : '') +
        '</div></div>';
    }).join('');

    $('#view').innerHTML =
      '<div class="page">' +
        '<div class="kicker">间隔复习</div>' +
        '<h1 class="page-title">该回来看看了</h1>' +
        '<p style="color:var(--ink-2);max-width:40em">完成课程后按 1 / 3 / 7 / 14 天安排复习；答错的测验 3 天后重新出现。复习不是重读，是合上页面先回忆，再对照。</p>' +
        '<div class="result-meta">今天到期 <b>' + items.length + '</b> 项' + (items.length ? '' : ' · 都清完了，去学新内容吧') + '</div>' +
        '<div class="review-list">' + (rows || '<div class="empty">暂无到期复习。完成一节课后，明天再来。</div>') + '</div>' +
        '<div class="footer">复习节奏参考间隔重复与检索练习的研究；错题重做前先不看答案。</div>' +
      '</div>';

    $$('[data-done-review]').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.doneReview;
      state.reviews[id] = (state.reviews[id] || 0) + 1;
      state.doneAt[id] = Date.now();
      save();
      renderReview();
      toast('已记录本轮复习');
    }));
    renderNav();
  }

  /* ---------------- 路由 ---------------- */
  function route() {
    const hash = location.hash.replace(/^#\/?/, '');
    const parts = hash.split('/');
    $('#sidebar').classList.remove('open');
    if (parts[0] === 'lesson' && parts[1]) {
      renderLesson(parts[1]);
    } else if (parts[0] === 'library') {
      $('#crumb').innerHTML = '<span>方法库</span>';
      renderLibrary(); renderNav(); window.scrollTo(0, 0);
    } else if (parts[0] === 'studies') {
      $('#crumb').innerHTML = '<span>深度案例</span>';
      renderStudies(); renderNav(); window.scrollTo(0, 0);
    } else if (parts[0] === 'review') {
      $('#crumb').innerHTML = '<span>复习</span>';
      renderReview(); window.scrollTo(0, 0);
    } else if (parts[0] === 'cases') {
      $('#crumb').innerHTML = '<span>案例库</span>';
      renderCases(); renderNav(); window.scrollTo(0, 0);
    } else if (parts[0] === 'toolkit') {
      $('#crumb').innerHTML = '<span>工具箱</span>';
      renderToolkit(); renderNav(); window.scrollTo(0, 0);
    } else {
      $('#crumb').innerHTML = '<span>课程首页</span>';
      renderHome(); renderNav(); window.scrollTo(0, 0);
    }
  }

  /* ---------------- 事件 ---------------- */
  function init() {
    if (!persistent) {
      const note = document.createElement('div');
      note.className = 'sidebar-foot';
      note.textContent = '当前离线打开：进度与测验答案可能不会保存。用本地服务器（python3 -m http.server）打开可保留。';
      $('#sidebar').appendChild(note);
    }
    window.addEventListener('hashchange', route);
    $('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
    $('#resetBtn').addEventListener('click', () => {
      if (!confirm('清除本机的学习进度、测验答案与自检记录？')) return;
      state.done.clear();
      state.quiz = {};
      state.doneAt = {};
      state.reviews = {};
      state.checklist = {};
      save();
      route();
      toast('已重置');
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') $('#sidebar').classList.remove('open');
    });
    route();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
