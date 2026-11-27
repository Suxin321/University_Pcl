/* University_Pcl Web — 界面与交互 */
(function () {
  'use strict';
  var C = window.PCLCore;
  var STORAGE_KEY = 'university_pcl_web_v2';
  var APP_URL = 'https://suxin321.github.io/University_Pcl/';
  var PALETTE = ['#6FBF4A', '#1FA463', '#3E8EF7', '#D06BD6', '#C07A16', '#F07A79', '#8B5CF6', '#0EA5A4'];

  var state = loadState();
  var ui = {
    week: C.currentWeek(state.prefs),
    settingsPage: null,
    dialog: null,
    gen: null,
    pickerQuery: '',
    sortByWeek: false,
    statsOpen: true,
    slotEdit: null,
    freeSlotsWeek: null
  };

  // ---------- 工具 ----------

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function colorFor(name) {
    var hash = 0;
    for (var i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
    return PALETTE[Math.abs(hash) % PALETTE.length];
  }
  function byChinese(a, b) {
    try { return a.localeCompare(b, 'zh-CN'); } catch (e) { return a < b ? -1 : (a > b ? 1 : 0); }
  }
  function toast(text) {
    var node = document.createElement('div');
    node.className = 'toast';
    node.textContent = text;
    document.body.appendChild(node);
    setTimeout(function () { node.classList.add('show'); }, 10);
    setTimeout(function () {
      node.classList.remove('show');
      setTimeout(function () { node.remove(); }, 250);
    }, 1800);
  }

  // ---------- 存储 ----------

  function defaultState() {
    return {
      cache: null,
      manual: [],
      prefs: { term: '', week: 0, semesterStart: '' },
      free: null,
      roster: [],
      cfg: C.defaultConfig()
    };
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      var parsed = JSON.parse(raw);
      var base = defaultState();
      base.cache = parsed.cache || null;
      base.manual = parsed.manual || [];
      base.prefs = Object.assign(base.prefs, parsed.prefs || {});
      base.free = parsed.free || null;
      base.roster = parsed.roster || [];
      base.cfg = Object.assign(base.cfg, parsed.cfg || {});
      if (!base.cfg.slotTimes || base.cfg.slotTimes.length !== C.BIG_COUNT) base.cfg.slotTimes = C.DEFAULT_SLOT_TIMES.slice();
      if (!base.cfg.adjust) base.cfg.adjust = {};
      return base;
    } catch (e) {
      return defaultState();
    }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* 忽略空间不足 */ }
  }

  // ---------- 派生数据 ----------

  function currentWeek() {
    var week = C.currentWeek(state.prefs);
    if (!ui.week || isNaN(ui.week)) ui.week = week;
    return ui.week;
  }

  function activeDays() {
    var free = state.free;
    if (!free) return [];
    var chosen = (state.cfg.days || []).filter(function (d) { return free.days.indexOf(d) >= 0; });
    return chosen.length ? chosen.slice().sort(function (a, b) { return a - b; }) : free.days.slice();
  }

  function activeSections() {
    var chosen = (state.cfg.sections || []).filter(function (s) { return s >= 1 && s <= C.BIG_COUNT; }).sort(function (a, b) { return a - b; });
    return chosen.length ? chosen : [1, 2, 3, 4, 5];
  }

  function activeMembers() {
    var free = state.free;
    if (!free) return [];
    var chosen = (state.cfg.members || []).filter(function (m) { return free.members.indexOf(m) >= 0; });
    return chosen.length ? chosen : free.members.slice();
  }

  function weekShiftMap(week) {
    var map = {};
    C.weekShifts(state.roster, week).forEach(function (shift) { map[shift.day + '-' + shift.bigSection] = shift; });
    return map;
  }

  function totalAssignments() {
    return state.roster.reduce(function (sum, shift) { return sum + (shift.names ? shift.names.length : 0); }, 0);
  }

  // ---------- 渲染：外壳 ----------

  function render() {
    renderTabbar();
    var html = '';
    if (state.uiTab === 'settings') html = renderSettings();
    else if (state.uiTab === 'roster') html = renderRoster();
    else html = renderTimetable();
    $('#view').innerHTML = html;
    renderDialog();
    window.scrollTo(0, 0);
  }

  function renderTabbar() {
    $$('#tabbar button').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === (state.uiTab || 'timetable'));
    });
  }

  function weekHeader(title, sub) {
    var week = currentWeek();
    var monday = C.weekMonday(week, state.prefs);
    var subText = sub || (C.formatMonthDay(monday) + ' ~ ' + C.formatMonthDay(C.addDays(monday, 6)));
    return '' +
      '<div class="page-head">' +
      '<div class="head-title"><h1>' + esc(title) + '</h1><div class="sub">' + esc(subText) + '</div></div>' +
      '<div class="week-nav">' +
      '<button class="ghost" data-act="week-prev">‹</button>' +
      '<button class="ghost" data-act="week-now">本周</button>' +
      '<button class="ghost" data-act="week-next">›</button>' +
      '</div></div>';
  }

  // ---------- 课表页 ----------

  function renderTimetable() {
    var week = currentWeek();
    var items = (state.cache && state.cache.items ? state.cache.items : []);
    var manual = state.manual.map(manualToSlot);
    var all = items.concat(manual);
    var monday = C.weekMonday(week, state.prefs);
    var html = '<div class="page">' + weekHeader('第 ' + week + ' 周');

    if (!items.length && !manual.length) {
      html += '<div class="card accent-card">' +
        '<div class="card-title">还没有课表</div>' +
        '<p class="muted">到「设置 → 课表来源」导入教务系统导出的 .xls 课表；也可以在下面的周视图里手动加课。完全离线。</p>' +
        '<button class="primary" data-act="go-settings-source">去导入课表</button>' +
        '</div>';
    }

    // 表头
    html += '<div class="scroll-x"><div class="tt-grid">';
    html += '<div class="tt-corner"></div>';
    for (var day = 1; day <= 7; day++) {
      var date = C.addDays(monday, day - 1);
      var isToday = C.formatDate(date) === C.todayString();
      html += '<div class="tt-day' + (isToday ? ' today' : '') + '">' +
        '<div class="tt-day-name">' + C.WEEKDAY_SHORT[day - 1] + '</div>' +
        '<div class="tt-day-date">' + C.formatMonthDay(date) + '</div></div>';
    }
    for (var big = 1; big <= C.BIG_COUNT; big++) {
      html += '<div class="tt-section"><div class="tt-section-label">' + C.BIG_SHORT[big - 1] + '</div>' +
        '<div class="tt-section-time">' + esc(timeLabel(state.cfg.slotTimes[big - 1])) + '</div></div>';
      for (var d = 1; d <= 7; d++) {
        var courses = all.filter(function (slot) {
          return slot.day === d && slot.bigSection === big && C.courseActiveIn(slot, week);
        });
        var cellDate = C.addDays(monday, d - 1);
        var cellToday = C.formatDate(cellDate) === C.todayString();
        html += '<div class="tt-cell' + (cellToday ? ' today' : '') + '" data-act="add-manual" data-day="' + d + '" data-big="' + big + '">';
        courses.forEach(function (course) {
          html += '<div class="course" style="background:' + colorFor(course.name) + '">' +
            '<div class="course-name">' + esc(course.name) + '</div>' +
            (course.room ? '<div class="course-room">@' + esc(course.room) + '</div>' : '') +
            '</div>';
        });
        html += '</div>';
      }
    }
    html += '</div></div>';

    if (manual.length) {
      html += '<div class="card list-card"><div class="card-title">手动加的课</div>';
      manual.forEach(function (course) {
        html += '<div class="row">' +
          '<span class="dot" style="background:' + colorFor(course.name) + '"></span>' +
          '<span class="row-main">周' + C.WEEKDAY_SHORT[course.day - 1] + ' ' + C.BIG_SHORT[course.bigSection - 1] + '节 ' + esc(course.name) +
          (course.room ? ' @' + esc(course.room) : '') + '</span>' +
          '<button class="link danger" data-act="del-manual" data-id="' + course.id + '">删除</button>' +
          '</div>';
      });
      html += '</div>';
    }

    html += '<p class="hint">点任意空格子可以手动加课；换周次用上面的 ‹ ›。</p>';
    html += '</div>';
    return html;
  }

  function manualToSlot(course) {
    return { day: course.day, bigSection: course.bigSection, name: course.name, room: course.room, teacher: course.teacher, weeks: [], parity: 0 };
  }

  function timeLabel(value) {
    return value ? String(value).replace('-', '–') : '';
  }

  // ---------- 排班页 ----------

  function renderRoster() {
    var week = currentWeek();
    var free = state.free;
    var html = '<div class="page">' + weekHeader('第 ' + week + ' 周');

    if (!free) {
      html += '<div class="card accent-card">' +
        '<div class="card-title">还没有空课表</div>' +
        '<p class="muted">空课表在「设置 → 空课表」里导入（.xlsx / .xls）。格式：表头星期一到星期日，每行一个大节，单元格写「姓名 + 没课的周次」，姓名后没数字表示所有周都没课。</p>' +
        '<button class="primary" data-act="go-settings-free">去设置导入</button>' +
        '</div></div>';
      return html;
    }

    var days = activeDays();
    var sections = activeSections();
    var members = activeMembers();
    var shifts = C.weekShifts(state.roster, week);
    var shiftMap = weekShiftMap(week);
    var assigned = shifts.reduce(function (sum, s) { return sum + s.names.length; }, 0);
    var people = {};
    shifts.forEach(function (s) { s.names.forEach(function (n) { people[n] = 1; }); });
    var noOneFree = 0;
    days.forEach(function (day) {
      sections.forEach(function (big) {
        var names = freeNamesFor(day, big, week, members);
        if (!names.length) noOneFree++;
      });
    });
    var expected = days.length * sections.length;
    var missing = Math.max(0, expected - shifts.filter(function (s) { return s.names.length; }).length);

    html += '<div class="card status-card">' +
      '<div class="row"><span class="card-title">空课表 · ' + free.members.length + ' 人</span>' +
      '<button class="link" data-act="go-settings-free">去设置</button></div>' +
      '<div class="muted small">' + free.days.length + ' 天 × ' + C.BIG_COUNT + ' 大节' +
      (free.maxWeek ? ' · 最晚第 ' + free.maxWeek + ' 周' : '') +
      ' · ' + C.formatTime(free.importedAt) + '</div>' +
      '<div class="muted small pri">排班：' + days.map(function (d) { return C.WEEKDAY_SHORT[d - 1]; }).join('、') + ' · ' +
      sections.map(function (s) { return C.BIG_SHORT[s - 1] + '节'; }).join('、') + '</div>' +
      '<div class="muted small pri">参与成员 ' + members.length + '/' + free.members.length + ' 人</div>' +
      '<div class="btn-row">' +
      '<button class="primary" data-act="open-generate">自动排班</button>' +
      '<button class="outline" data-act="open-export"' + (state.roster.length ? '' : ' disabled') + '>导出排班表</button>' +
      '<button class="outline" data-act="open-free-slots">空课详情</button>' +
      '</div></div>';

    html += '<div class="section-head"><div class="section-title">第 ' + week + ' 周值班表</div>' +
      '<span class="muted small">' + (assigned ? assigned + ' 班 · ' + Object.keys(people).length + ' 人' : '还没有排') + '</span>' +
      (assigned ? '<button class="link danger" data-act="clear-week">清空本周</button>' : '') + '</div>';

    if (!assigned) {
      html += '<p class="hint">点「自动排班」按空课表生成；排完点任意格子可以手动换人。</p>';
    }

    var monday = C.weekMonday(week, state.prefs);
    var allDays = [1, 2, 3, 4, 5, 6, 7];
    var allSections = [1, 2, 3, 4, 5];
    html += '<div class="scroll-x"><div class="roster-grid" style="--day-count:7">';
    html += '<div class="rg-corner"></div>';
    allDays.forEach(function (day) {
      var date = C.addDays(monday, day - 1);
      var isToday = C.formatDate(date) === C.todayString();
      html += '<div class="rg-day' + (isToday ? ' today' : '') + '"><div>' + C.WEEKDAY_SHORT[day - 1] + '</div><div class="tiny">' + C.formatMonthDay(date) + '</div></div>';
    });
    allSections.forEach(function (big) {
      html += '<div class="rg-section"><div>' + C.BIG_SHORT[big - 1] + '节</div><div class="tiny">' + esc(timeLabel(state.cfg.slotTimes[big - 1])) + '</div></div>';
      allDays.forEach(function (day) {
        var shift = shiftMap[day + '-' + big];
        var names = shift ? shift.names : [];
        var date = C.addDays(monday, day - 1);
        var isToday = C.formatDate(date) === C.todayString();
        html += '<div class="rg-cell' + (isToday ? ' today' : '') + '" data-act="edit-slot" data-day="' + day + '" data-big="' + big + '">';
        names.slice(0, 2).forEach(function (name) {
          html += '<span class="name-chip" style="background:' + colorFor(name) + '">' + esc(name) + '</span>';
        });
        if (names.length > 2) html += '<span class="tiny muted">+' + (names.length - 2) + ' 人</span>';
        html += '</div>';
      });
    });
    html += '</div></div>';

    html += '<p class="hint">点任意格子可手动换人' +
      (missing > 0 && assigned ? '；本周还有 ' + missing + ' 个时段留空' + (noOneFree ? '（其中 ' + noOneFree + ' 个空课表里没人有空）' : '') : '') + '</p>';

    html += renderStats(week, shifts);

    html += '<div class="btn-row end"><button class="link danger" data-act="open-reset"' + (state.roster.length ? '' : ' disabled') + '>重置全部排班</button></div>';
    html += '<p class="hint">空课表更新后到「设置 → 空课表」重新导入；排哪几天/哪几节/哪些人在「自动排班」里调。</p>';
    html += '</div>';
    return html;
  }

  function freeNamesFor(day, big, week, members) {
    var names = C.freeNames(state.free, day, big, week);
    if (!members) return names;
    return names.filter(function (n) { return members.indexOf(n) >= 0; });
  }

  function renderStats(week, shifts) {
    var free = state.free;
    if (!free) return '';
    var adjust = state.cfg.adjust || {};
    var weekCounts = C.countByPerson(shifts);
    var baseCounts = C.countByPerson(state.roster);
    var names = {};
    free.members.forEach(function (n) { names[n] = 1; });
    Object.keys(baseCounts).forEach(function (n) { names[n] = 1; });
    Object.keys(adjust).forEach(function (n) { names[n] = 1; });
    var list = Object.keys(names);
    var totalCounts = {};
    list.forEach(function (name) { totalCounts[name] = (baseCounts[name] || 0) + (adjust[name] || 0); });
    var sortByName = function (a, b) {
      if (ui.sortByWeek) {
        var d = (weekCounts[b] || 0) - (weekCounts[a] || 0);
        if (d) return d;
      }
      var diff = (totalCounts[b] || 0) - (totalCounts[a] || 0);
      if (diff) return diff;
      return byChinese(a, b);
    };
    list.sort(sortByName);
    var totalSum = list.reduce(function (sum, n) { return sum + totalCounts[n]; }, 0);
    var maxTotal = Math.max(1, list.reduce(function (m, n) { return Math.max(m, totalCounts[n]); }, 0));
    var weeks = {};
    state.roster.forEach(function (s) { weeks[s.week] = 1; });
    var html = '<div class="section-head stats-head" data-act="toggle-stats">' +
      '<div class="section-title">值班次数表</div>' +
      '<span class="muted small">' + (ui.statsOpen ? '收起' : '展开') + '</span></div>';
    if (!ui.statsOpen) return html;
    html += '<div class="card stats-card">' +
      '<div class="stat-chips">' +
      '<div class="stat-chip primary"><div class="tiny">本周</div><div class="stat-num">' + sumNames(weekCounts) + ' 班</div></div>' +
      '<div class="stat-chip"><div class="tiny">合计</div><div class="stat-num">' + totalSum + ' 班</div></div>' +
      '<div class="stat-chip"><div class="tiny">周数</div><div class="stat-num">' + Object.keys(weeks).length + ' 周</div></div>' +
      '</div>' +
      '<div class="row stats-sort"><span class="muted tiny">共 ' + list.length + ' 人 · 点人名可改次数</span>' +
      '<span class="sort-chips">' +
      '<button class="chip' + (ui.sortByWeek ? ' on' : '') + '" data-act="sort-week">按本周</button>' +
      '<button class="chip' + (!ui.sortByWeek ? ' on' : '') + '" data-act="sort-total">按合计</button>' +
      '<button class="chip" data-act="open-batch-adjust">批量调整</button>' +
      '</span></div>';
    list.forEach(function (name) {
      var total = totalCounts[name] || 0;
      var wc = weekCounts[name] || 0;
      var delta = adjust[name] || 0;
      var pct = Math.round((total / maxTotal) * 100);
      var note = delta > 0 ? '手动+' + delta : (delta < 0 ? '手动' + delta : (wc > 0 ? '本周' + wc : ''));
      html += '<div class="stat-row" data-act="adjust-person" data-name="' + esc(name) + '">' +
        '<span class="avatar" style="background:' + colorFor(name) + '">' + esc(name.slice(-1)) + '</span>' +
        '<span class="stat-name">' + esc(name) + '</span>' +
        '<span class="stat-bar"><i style="width:' + pct + '%;background:' + colorFor(name) + '"></i></span>' +
        '<span class="stat-count">' + total + '</span>' +
        '<span class="stat-note' + (delta ? ' manual' : '') + '">' + esc(note) + '</span>' +
        '</div>';
    });
    html += '</div>';
    html += '<p class="hint">「本周」只统计第 ' + currentWeek() + ' 周；「合计」= 排班次数 + 手动调整。</p>';
    return html;
  }

  function sumNames(counts) {
    return Object.keys(counts).reduce(function (sum, key) { return sum + counts[key]; }, 0);
  }

  // ---------- 设置页 ----------

  function renderSettings() {
    var page = ui.settingsPage;
    if (!page) {
      var free = state.free;
      var cache = state.cache;
      var html = '<div class="page">' +
        '<div class="page-head"><div class="head-title"><h1>设置</h1></div></div>' +
        '<div class="group-label">课表</div>' +
        settingsRow('学期与周次', termSummary(), 'term') +
        settingsRow('课表来源', cache && cache.items ? '已导入 ' + cache.items.length + ' 条课程 · ' + C.formatTime(cache.fetchedAt) : '未导入课表文件', 'source') +
        '<div class="group-label">排班</div>' +
        settingsRow('空课表', free ? free.members.length + ' 人 · ' + free.days.length + ' 天 × ' + C.BIG_COUNT + ' 大节 · ' + C.formatTime(free.importedAt) : '未导入', 'free') +
        settingsRow('值班时段', '1-2 ' + esc(state.cfg.slotTimes[0] || '') + ' 等 ' + state.cfg.slotTimes.length + ' 个时段', 'times') +
        '<div class="group-label">其他</div>' +
        settingsRow('关于', 'University_Pcl Web 1.0.0', 'about') +
        '</div>';
      return html;
    }
    var title = { term: '学期与周次', source: '课表来源', free: '空课表', times: '值班时段', about: '关于' }[page] || '设置';
    var body = '';
    if (page === 'term') {
      body = '<div class="field-row">' +
        '<label class="field"><span>学期</span><input id="in-term" value="' + esc(state.prefs.term) + '" placeholder="2026-2027-1"></label>' +
        '<label class="field narrow"><span>周次</span><input id="in-week" inputmode="numeric" value="' + (state.prefs.week || '') + '" placeholder="自动"></label>' +
        '</div>' +
        '<label class="field"><span>第 1 周周一日期（可选）</span><input id="in-start" value="' + esc(state.prefs.semesterStart) + '" placeholder="2026-08-31"></label>' +
        '<p class="hint">不填开学日期按内置校历推算；手动填了周次优先用手动值。</p>' +
        '<button class="primary" data-act="save-term">保存</button>';
    } else if (page === 'source') {
      body = '<label class="outline btn-like" for="scheduleFile">导入课表文件（.xls / .xlsx）</label>' +
        '<p class="muted small">' + (state.cache && state.cache.items ? '已导入 ' + state.cache.items.length + ' 条课程 · ' + C.formatTime(state.cache.fetchedAt) : '还没有导入课表') + '</p>' +
        '<p class="hint">教务系统 → 课表页 → 右上角「导出」下载 .xls，在这里选进来。完全离线。</p>';
    } else if (page === 'free') {
      body = '<label class="outline btn-like" for="freeFile">' + (state.free ? '更新空课表' : '导入空课表（.xlsx / .xls）') + '</label>' +
        (state.free ? '<p class="muted small pri">已导入：' + state.free.members.length + ' 人 · ' + state.free.days.length + ' 天 × ' + C.BIG_COUNT + ' 大节' +
          (state.free.maxWeek ? ' · 最晚第 ' + state.free.maxWeek + ' 周' : '') + ' · ' + C.formatTime(state.free.importedAt) + '</p>' : '') +
        '<p class="hint">空课表格式：表头星期一到星期日、每行一个大节，单元格写「姓名 + 没课的周次」（如 刘如航16-20、王妍1-6 8-11 19）；姓名后没有数字表示所有周都没课。</p>' +
        '<p class="hint">点上面的按钮会打开手机的文件选择器；如果没反应，再点一次，或换成 Chrome / Edge / 系统浏览器打开本页再试。</p>' +
        renderMemberManager();
    } else if (page === 'times') {
      body = '<p class="hint">每个大节的起止时间，会显示在排班页和导出的值班表里。格式 HH:mm（如 08:00）。</p>';
      for (var i = 0; i < C.BIG_COUNT; i++) {
        var parts = (state.cfg.slotTimes[i] || '').split('-');
        body += '<div class="time-row"><span class="time-label">' + C.BIG_SHORT[i] + '节</span>' +
          '<input class="time-input" data-time-index="' + i + '" data-time-part="0" inputmode="numeric" value="' + esc(parts[0] || '') + '">' +
          '<span class="muted">-</span>' +
          '<input class="time-input" data-time-index="' + i + '" data-time-part="1" inputmode="numeric" value="' + esc(parts[1] || '') + '"></div>';
      }
      body += '<button class="outline" data-act="save-times">保存值班时段</button>';
    } else if (page === 'about') {
      body = '<div class="card accent-card"><div class="card-title">University_Pcl Web 1.0.12</div>' +
        '<p class="muted small">纯离线网页版：课表、空课表都只在本机浏览器里解析，不上传任何数据。</p>' +
        '<p class="muted small">数据存在浏览器 localStorage 里；换浏览器/清缓存会丢失，重要排班记得先导出文字。</p>' +
        '<p class="muted small">安卓版的功能对应：周视图、排班、空课详情、次数表、导出。网页版暂不支持桌面组件。</p>' +
        '<p class="muted small">电脑上看：Chrome / Edge 打开本页后，点地址栏右边的「安装」图标即可装成桌面应用（独立窗口、可离线）。</p></div>' +
        '<div class="card"><div class="card-title">分享给同学</div>' +
        '<p class="muted small">把下面的链接发给别人，对方用手机浏览器打开就能用；每个人的数据都只存在自己手机上，互不影响。</p>' +
        '<div class="share-url" id="share-url">' + esc(APP_URL) + '</div>' +
        '<div class="share-qr"><img src="share-qr.svg" alt="网页版二维码"></div>' +
        '<div class="btn-row"><button class="outline" data-act="copy-url">复制链接</button>' +
        '<button class="primary" data-act="share-url">分享</button></div></div>';
    }
    return '<div class="page">' +
      '<div class="back-row" data-act="settings-back"><span class="back-arrow">‹</span> 设置</div>' +
      '<div class="page-head"><div class="head-title"><h1>' + title + '</h1></div></div>' +
      body + '</div>';
  }

  function renderMemberManager() {
    var free = state.free;
    if (!free) return '';
    var rows = free.members.slice().sort(byChinese).map(function (name) {
      return '<div class="member-item"><span class="avatar" style="background:' + colorFor(name) + '">' + esc(name.slice(-1)) + '</span>' +
        '<span class="member-name">' + esc(name) + '</span>' +
        '<button class="link" data-act="member-edit" data-name="' + esc(name) + '">编辑</button>' +
        '<button class="link danger" data-act="member-del" data-name="' + esc(name) + '">删除</button></div>';
    }).join('');
    return '<div class="card member-card">' +
      '<div class="row"><div class="card-title">成员管理 · ' + free.members.length + ' 人</div></div>' +
      '<div class="add-row"><button class="outline small" data-act="member-new">＋ 添加成员</button></div>' +
      '<p class="hint">添加的成员会在所有时段按你填的周次算作有空（如 1-20 或 1-8 13-20）；删除后不再参与排班，已排好的班次保留。</p>' +
      '<div class="member-list">' + rows + '</div></div>';
  }

  function weeksToText(weeks) {
    if (!weeks || !weeks.length) return '';
    var sorted = weeks.slice().sort(function (a, b) { return a - b; });
    var parts = [];
    var start = sorted[0];
    var prev = sorted[0];
    for (var i = 1; i <= sorted.length; i++) {
      var w = sorted[i];
      if (w === prev + 1) { prev = w; continue; }
      parts.push(start === prev ? String(start) : start + '-' + prev);
      start = w; prev = w;
    }
    return parts.join(' ');
  }

  function findMember(cell, name) {
    for (var i = 0; i < cell.members.length; i++) {
      if (cell.members[i].name === name) return cell.members[i];
    }
    return null;
  }

  function openMemberEdit(name) {
    var free = state.free;
    if (!free) return;
    var isNew = !name;
    var slotWeeks = {};
    if (!isNew) {
      [1,2,3,4,5,6,7].forEach(function (day) {
        for (var big = 1; big <= C.BIG_COUNT; big++) {
          var cell = findCell(day, big);
          var member = cell ? findMember(cell, name) : null;
          if (member) {
            slotWeeks[day + '-' + big] = member.allWeeks ? '' : weeksToText(member.weeks);
          }
        }
      });
    }
    ui.memberEdit = { name: name || '', isNew: isNew, slotWeeks: slotWeeks };
    renderMemberEdit();
  }

  function findCell(day, big) {
    var free = state.free;
    if (!free) return null;
    for (var i = 0; i < free.cells.length; i++) {
      if (free.cells[i].day === day && free.cells[i].bigSection === big) return free.cells[i];
    }
    return null;
  }

  function renderMemberEdit() {
    var free = state.free;
    var edit = ui.memberEdit;
    if (!free || !edit) return;
    var body = '<label class="field"><span>姓名</span><input id="member-name"' +
      (edit.isNew ? '' : ' disabled') + ' value="' + esc(edit.name) + '"></label>' +
      '<div class="muted small">勾选有空的时段，每个时段可以单独填没课的周次（留空 = 所有周）：</div>' +
      '<div class="slot-grid">';
    [1,2,3,4,5,6,7].forEach(function (day) {
      body += '<div class="slot-day"><span class="slot-day-label">周' + C.WEEKDAY_SHORT[day - 1] + '</span>';
      for (var big = 1; big <= C.BIG_COUNT; big++) {
        var key = day + '-' + big;
        body += '<label class="slot-check"><input type="checkbox" data-act="member-slot" data-key="' + key + '"' +
          (Object.prototype.hasOwnProperty.call(edit.slotWeeks, key) ? ' checked' : '') + '><span>' + C.BIG_SHORT[big - 1] + '</span></label>';
      }
      body += '</div>';
    });
    body += '</div>';
    var keys = Object.keys(edit.slotWeeks).sort(function (a, b) {
      var pa = a.split('-').map(Number);
      var pb = b.split('-').map(Number);
      return pa[0] !== pb[0] ? pa[0] - pb[0] : pa[1] - pb[1];
    });
    if (keys.length) {
      body += '<div class="muted small" style="margin-top:8px">每个时段的没课周次：</div>';
      keys.forEach(function (key) {
        var parts = key.split('-').map(Number);
        body += '<div class="slot-week-row"><span class="slot-week-label">周' + C.WEEKDAY_SHORT[parts[0] - 1] + ' ' +
          C.BIG_SHORT[parts[1] - 1] + '</span><input class="slot-week-input" data-key="' + key + '" value="' +
          esc(edit.slotWeeks[key] || '') + '" placeholder="所有周"></div>';
      });
      body += '<div class="slot-week-row"><input class="bulk-week" id="bulk-week" placeholder="统一填周次，如 1-20">' +
        '<button class="outline small" data-act="member-bulk-weeks">应用到已选</button></div>';
    }
    body += '<p class="hint">保存后按每个时段分别计算这位同学有没有空。</p>';
    openDialog(dialogShell(edit.isNew ? '添加成员' : '编辑成员 · ' + edit.name, body,
      '<button class="outline" data-act="dismiss-dialog">取消</button>' +
      '<button class="primary" data-act="member-save">保存</button>'));
  }

  function saveMemberEdit() {
    var free = state.free;
    var edit = ui.memberEdit;
    if (!free || !edit) return;
    var name = (document.getElementById('member-name').value || '').trim();
    if (!name) { toast('先填姓名'); return; }
    if (edit.isNew && free.members.indexOf(name) >= 0) { toast('已经有这个人了'); return; }
    var keys = Object.keys(edit.slotWeeks);
    if (!keys.length) { toast('至少勾一个时段'); return; }

    keys.forEach(function (key) {
      if (!findCell(Number(key.split('-')[0]), Number(key.split('-')[1]))) {
        var parts = key.split('-').map(Number);
        free.cells.push({ day: parts[0], bigSection: parts[1], members: [] });
      }
    });
    free.cells.forEach(function (cell) {
      var key = cell.day + '-' + cell.bigSection;
      var existing = findMember(cell, name);
      if (Object.prototype.hasOwnProperty.call(edit.slotWeeks, key)) {
        var spec = C.parseWeekSpec(String(edit.slotWeeks[key] || '').trim());
        if (existing) {
          existing.allWeeks = spec.allWeeks;
          existing.weeks = spec.weeks.slice();
        } else {
          cell.members.push({ name: name, allWeeks: spec.allWeeks, weeks: spec.weeks.slice() });
        }
      } else if (existing) {
        cell.members = cell.members.filter(function (m) { return m.name !== name; });
      }
    });
    if (edit.isNew) free.members.push(name);
    var daySet = {};
    free.days.forEach(function (d) { daySet[d] = 1; });
    keys.forEach(function (key) { daySet[Number(key.split('-')[0])] = 1; });
    free.days = Object.keys(daySet).map(Number).sort(function (a, b) { return a - b; });
    save();
    closeDialog();
    render();
    toast('已保存：' + name);
  }

  function openBatchAdjust() {
    var free = state.free;
    if (!free) return;
    ui.batch = { selected: {}, query: '', mode: 'plus', value: 1 };
    renderBatchAdjust();
  }

  function renderBatchAdjust() {
    var free = state.free;
    var batch = ui.batch;
    var query = (batch.query || '').trim();
    var list = free.members.slice().sort(byChinese).filter(function (n) {
      return !query || n.indexOf(query) >= 0;
    });
    var selectedCount = Object.keys(batch.selected).length;
    var modeChips = ['plus', 'minus', 'set'].map(function (mode) {
      var label = mode === 'plus' ? '加' : (mode === 'minus' ? '减' : '设为');
      return '<button class="chip' + (batch.mode === mode ? ' on' : '') + '" data-act="batch-mode" data-mode="' + mode + '">' + label + '</button>';
    }).join('');
    var body = '<div class="batch-op"><span class="muted small">操作</span><span class="sort-chips">' + modeChips + '</span>' +
      '<span class="stepper-mini"><button class="ghost" data-act="batch-value" data-delta="-1">−</button>' +
      '<b>' + batch.value + '</b>' +
      '<button class="ghost" data-act="batch-value" data-delta="1">+</button></span></div>' +
      '<input class="search" id="batch-query" placeholder="搜索姓名" value="' + esc(batch.query || '') + '">' +
      '<div class="row"><span class="muted tiny">已选 ' + selectedCount + '/' + free.members.length + ' 人</span>' +
      '<span class="bulk"><button class="link" data-act="batch-all">全选</button>' +
      '<button class="link" data-act="batch-none">清空</button>' +
      '<button class="link" data-act="batch-invert">反选</button></span></div>' +
      '<div class="picker-list">' + (list.length ? list.map(function (name) {
        return '<label class="check-row"><input type="checkbox" data-act="batch-toggle" data-name="' + esc(name) + '"' +
          (batch.selected[name] ? ' checked' : '') + '><span>' + esc(name) + '</span></label>';
      }).join('') : '<p class="muted small">没有匹配的姓名</p>') + '</div>' +
      '<p class="hint">对选中的人统一「' +
      (batch.mode === 'plus' ? '加' : batch.mode === 'minus' ? '减' : '设为') + ' ' + batch.value +
      '」次；只改手动调整，不动排班表。</p>';
    openDialog(dialogShell('批量调整次数', body,
      '<button class="outline" data-act="dismiss-dialog">取消</button>' +
      '<button class="primary" data-act="batch-apply"' + (selectedCount ? '' : ' disabled') + '>应用</button>'));
  }

  function applyBatchAdjust() {
    var batch = ui.batch;
    var names = Object.keys(batch.selected);
    if (!names.length) { toast('先选人'); return; }
    var value = Math.max(0, Math.min(99, batch.value || 0));
    names.forEach(function (name) {
      var current = state.cfg.adjust[name] || 0;
      var next = batch.mode === 'set' ? value : (batch.mode === 'plus' ? current + value : current - value);
      next = Math.max(-99, Math.min(99, next));
      if (next === 0) delete state.cfg.adjust[name];
      else state.cfg.adjust[name] = next;
    });
    save();
    closeDialog();
    render();
    var label = batch.mode === 'set' ? ('设为 ' + value) : ((batch.mode === 'plus' ? '+' : '-') + value);
    toast('已调整 ' + names.length + ' 人（' + label + '）');
  }

  function addMember(name, weeksText) {
    var free = state.free;
    if (!free) return;
    var clean = String(name || '').trim();
    if (!clean) { toast('先填姓名'); return; }
    if (free.members.indexOf(clean) >= 0) { toast('已经有这个人了'); return; }
    var spec = C.parseWeekSpec(String(weeksText || '').trim());
    var member = { name: clean, allWeeks: spec.allWeeks, weeks: spec.weeks };
    free.cells.forEach(function (cell) {
      cell.members.push({ name: member.name, allWeeks: member.allWeeks, weeks: member.weeks.slice() });
    });
    free.members.push(clean);
    save();
    render();
    toast('已添加：' + clean);
  }

  function removeMember(name) {
    var free = state.free;
    if (!free) return;
    free.cells.forEach(function (cell) {
      cell.members = cell.members.filter(function (m) { return m.name !== name; });
    });
    free.members = free.members.filter(function (n) { return n !== name; });
    state.cfg.members = (state.cfg.members || []).filter(function (n) { return n !== name; });
    save();
    render();
    toast('已删除：' + name);
  }

  function settingsRow(title, summary, page) {
    return '<div class="settings-row" data-act="settings-open" data-page="' + page + '">' +
      '<div class="sr-main"><div class="sr-title">' + esc(title) + '</div>' +
      (summary ? '<div class="sr-sum">' + esc(summary) + '</div>' : '') + '</div>' +
      '<span class="chev">›</span></div>';
  }

  function termSummary() {
    var term = state.prefs.term || '学期自动';
    var week = state.prefs.week ? '手动第 ' + state.prefs.week + ' 周' : '周次自动';
    return term + ' · ' + week;
  }

  // ---------- 对话框 ----------

  function openDialog(html) {
    ui.dialog = html;
    renderDialog();
  }
  function openConfirm(title, message, onOk) {
    ui.confirm = { title: title, message: message, onOk: onOk };
    renderConfirm();
  }

  function renderConfirm() {
    var c = ui.confirm;
    if (!c) return;
    openDialog(dialogShell(c.title,
      '<p>' + esc(c.message) + '</p>',
      '<button class="outline" data-act="dismiss-dialog">取消</button>' +
      '<button class="danger-btn" data-act="confirm-ok">确定</button>'));
  }

  function closeDialog() {
    ui.dialog = null;
    ui.gen = null;
    ui.slotEdit = null;
    renderDialog();
  }
  function renderDialog() {
    var root = $('#dialogRoot');
    if (!ui.dialog) { root.innerHTML = ''; return; }
    root.innerHTML = '<div class="scrim" data-act="dismiss-dialog"></div><div class="modal">' + ui.dialog + '</div>';
  }

  function dialogShell(title, body, footerButtons) {
    return '<div class="modal-head"><div class="modal-title">' + esc(title) + '</div>' +
      '<button class="link" data-act="dismiss-dialog">关闭</button></div>' +
      '<div class="modal-body">' + body + '</div>' +
      '<div class="modal-foot">' + footerButtons + '</div>';
  }

  // ---------- 自动排班 ----------

  function openGenerate() {
    var free = state.free;
    if (!free) return;
    var start = Math.max(1, currentWeek());
    var end = free.maxWeek > 0 ? Math.max(start, free.maxWeek) : Math.max(start, C.DEFAULT_MAX_WEEK);
    ui.gen = {
      start: start,
      end: end,
      perSlot: state.cfg.perSlot || 1,
      avoidDay: !!state.cfg.avoidSameDay,
      avoidWeek: !!state.cfg.avoidSameWeek,
      allowRepeat: !!state.cfg.allowRepeat,
      sections: activeSections().slice(),
      days: activeDays().slice(),
      members: activeMembers().slice(),
      picker: false,
      query: ''
    };
    renderGenerate();
  }

  function renderGenerate() {
    var free = state.free;
    var gen = ui.gen;
    if (!gen) return;
    gen.start = Number(gen.start) || currentWeek();
    gen.end = Math.max(gen.start, Number(gen.end) || gen.start);
    var dayChips = [1,2,3,4,5,6,7].map(function (day) {
      return '<button class="chip' + (gen.days.indexOf(day) >= 0 ? ' on' : '') + '" data-act="gen-day" data-day="' + day + '">' + C.WEEKDAY_SHORT[day - 1] + '</button>';
    }).join('');
    var sectionChips = '';
    for (var b = 1; b <= C.BIG_COUNT; b++) {
      sectionChips += '<button class="chip' + (gen.sections.indexOf(b) >= 0 ? ' on' : '') + '" data-act="gen-section" data-big="' + b + '">' + C.BIG_SHORT[b - 1] + '节</button>';
    }
    var perWeekNeed = gen.days.length * gen.sections.length * gen.perSlot;
    var willShort = (!gen.allowRepeat && gen.avoidWeek && perWeekNeed > gen.members.length)
      || (!gen.allowRepeat && gen.avoidDay && gen.sections.length * gen.perSlot > gen.members.length);
    var body = '' +
      '<div class="field-row">' +
      '<label class="field narrow"><span>起始周</span><input id="gen-start" inputmode="numeric" value="' + gen.start + '"></label>' +
      '<span class="muted" style="align-self:center">至</span>' +
      '<label class="field narrow"><span>结束周</span><input id="gen-end" inputmode="numeric" value="' + gen.end + '"></label>' +
      '</div>' +
      '<div class="stepper-row"><span>每个时段</span>' +
      '<button class="ghost" data-act="gen-need" data-delta="-1">−</button>' +
      '<b>' + gen.perSlot + ' 人</b>' +
      '<button class="ghost" data-act="gen-need" data-delta="1">+</button></div>' +
      '<div class="chips-label">排班星期</div><div class="chips">' + dayChips + '</div>' +
      '<div class="chips-label">排班大节</div><div class="chips">' + sectionChips + '</div>' +
      '<div class="row member-row"><div><div>参与成员</div><div class="tiny muted">' + gen.members.length + '/' + free.members.length + ' 人</div></div>' +
      '<button class="outline small" data-act="gen-picker">选择成员</button></div>' +
      '<label class="switch-row"><span>同一天不排同一人</span><input type="checkbox" data-act="gen-avoid-day"' + (gen.avoidDay ? ' checked' : '') + '></label>' +
      '<label class="switch-row"><span>同一周不排同一人</span><input type="checkbox" data-act="gen-avoid-week"' + (gen.avoidWeek ? ' checked' : '') + '></label>' +
      '<label class="switch-row"><span>排不下时允许同一人重复</span><input type="checkbox" data-act="gen-allow-repeat"' + (gen.allowRepeat ? ' checked' : '') + '></label>' +
      (willShort ? '<p class="warn">每周/每天需要的人次超过参与人数：严格模式会留空，需要排满请打开「允许同一人重复」。</p>' : '') +
      '<p class="muted small" id="gen-summary"></p>' +
      '<p class="warn small">会覆盖第 ' + gen.start + '–' + gen.end + ' 周已有的排班。</p>';
    var footer = '<button class="outline" data-act="dismiss-dialog">取消</button>' +
      '<button class="primary" data-act="gen-run"' + (gen.members.length ? '' : ' disabled') + '>生成</button>';
    openDialog(dialogShell('自动排班', body, footer));
    updateGenSummary();
    if (gen.picker) renderPicker();
  }

  function updateGenSummary() {
    var node = $('#gen-summary');
    if (!node || !ui.gen) return;
    var gen = ui.gen;
    var slots = (gen.end - gen.start + 1) * gen.days.length * gen.sections.length;
    node.textContent = '第 ' + gen.start + '–' + gen.end + ' 周 · ' + gen.days.length + ' 天 × ' + gen.sections.length +
      ' 节 = ' + slots + ' 个时段，每时段 ' + gen.perSlot + ' 人，约 ' + (slots * gen.perSlot) + ' 人次。';
  }

  function renderPicker() {
    var free = state.free;
    var gen = ui.gen;
    var selected = {};
    gen.members.forEach(function (n) { selected[n] = 1; });
    var query = gen.query.trim();
    var list = free.members.filter(function (n) { return !query || n.indexOf(query) >= 0; }).sort(byChinese);
    var body = '<input class="search" id="picker-query" placeholder="搜索姓名" value="' + esc(gen.query) + '">' +
      '<div class="row"><span class="muted tiny">已选 ' + gen.members.length + '/' + free.members.length + '</span>' +
      '<span class="bulk"><button class="link" data-act="picker-all">全选</button>' +
      '<button class="link" data-act="picker-none">清空</button>' +
      '<button class="link" data-act="picker-invert">反选</button></span></div>' +
      (query ? '<div class="row"><span class="muted tiny">搜索到 ' + list.length + ' 人</span><span class="bulk">' +
        '<button class="link" data-act="picker-select-filtered">选中结果</button>' +
        '<button class="link" data-act="picker-unselect-filtered">取消结果</button></span></div>' : '') +
      '<div class="picker-list">' + (list.length ? list.map(function (name) {
        return '<label class="check-row"><input type="checkbox" data-act="picker-toggle" data-name="' + esc(name) + '"' + (selected[name] ? ' checked' : '') + '><span>' + esc(name) + '</span></label>';
      }).join('') : '<p class="muted small">没有匹配的姓名</p>') + '</div>';
    openDialog(dialogShell('选择参与排班的人', body,
      '<button class="outline" data-act="picker-cancel">取消</button>' +
      '<button class="primary" data-act="picker-ok"' + (gen.members.length ? '' : ' disabled') + '>确定（' + gen.members.length + '）</button>'));
  }

  function runGenerate() {
    var gen = ui.gen;
    var free = state.free;
    if (!free || !gen) return;
    var req = {
      startWeek: gen.start,
      endWeek: gen.end,
      perSlot: gen.perSlot,
      avoidSameDay: gen.avoidDay,
      avoidSameWeek: gen.avoidWeek,
      allowRepeat: gen.allowRepeat,
      sections: gen.sections.slice().sort(function (a, b) { return a - b; }),
      days: gen.days.slice().sort(function (a, b) { return a - b; }),
      members: gen.members.length >= free.members.length ? [] : gen.members.slice().sort()
    };
    var kept = state.roster.filter(function (s) { return s.week < gen.start || s.week > gen.end; });
    req.existing = kept;
    var fresh = C.generate(free, req);
    state.roster = state.roster
      .filter(function (s) { return s.week < gen.start || s.week > gen.end; })
      .concat(fresh.filter(function (s) { return s.names.length; }))
      .sort(function (a, b) {
        if (a.week !== b.week) return a.week - b.week;
        if (a.day !== b.day) return a.day - b.day;
        return a.bigSection - b.bigSection;
      });
    state.cfg = Object.assign(state.cfg, {
      perSlot: gen.perSlot,
      avoidSameDay: gen.avoidDay,
      avoidSameWeek: gen.avoidWeek,
      allowRepeat: gen.allowRepeat,
      sections: req.sections,
      days: req.days,
      members: req.members
    });
    save();
    var full = 0, short = 0, none = 0;
    for (var w = gen.start; w <= gen.end; w++) {
      req.days.forEach(function (day) {
        req.sections.forEach(function (big) {
          var names = freeNamesFor(day, big, w, activeMembersFor(req.members));
          var got = fresh.filter(function (s) { return s.week === w && s.day === day && s.bigSection === big; })[0];
          var count = got ? got.names.length : 0;
          if (!names.length) none++;
          else if (count >= req.perSlot) full++;
          else short++;
        });
      });
    }
    ui.gen = null;
    closeDialog();
    render();
    toast('已生成第 ' + gen.start + '–' + gen.end + ' 周：' + full + ' 个时段排满' +
      (short ? '，' + short + ' 个因不重复限制留空' : '') + (none ? '，' + none + ' 个时段没人有空' : ''));
  }

  function activeMembersFor(chosen) {
    var free = state.free;
    if (!chosen || !chosen.length) return free.members;
    return chosen.filter(function (m) { return free.members.indexOf(m) >= 0; });
  }

  // ---------- 时段编辑 / 导出 / 空课详情 / 重置 / 调整 ----------

  function openSlotEdit(day, big) {
    var week = currentWeek();
    var eligible = freeNamesFor(day, big, week, activeMembers());
    var shift = weekShiftMap(week)[day + '-' + big];
    var current = shift ? shift.names.slice() : [];
    ui.slotEdit = { day: day, big: big, current: current, eligible: eligible };
    renderSlotEdit();
  }

  function renderSlotEdit() {
    var edit = ui.slotEdit;
    if (!edit) return;
    var body = '<div class="muted small">可排 ' + edit.eligible.length + ' 人 · 已选 ' + edit.current.length + ' 人</div>';
    if (!edit.eligible.length) {
      body += '<p class="muted small">这一时段在空课表里没人有空，可以先更新空课表。</p>';
    } else {
      body += '<div class="picker-list">' + edit.eligible.map(function (name) {
        return '<label class="check-row"><input type="checkbox" data-act="slot-toggle" data-name="' + esc(name) + '"' +
          (edit.current.indexOf(name) >= 0 ? ' checked' : '') + '><span>' + esc(name) + '</span></label>';
      }).join('') + '</div>';
    }
    openDialog(dialogShell('周' + C.WEEKDAY_SHORT[edit.day - 1] + ' · ' + C.BIG_SHORT[edit.big - 1] + '节 · 第 ' + currentWeek() + ' 周', body,
      '<button class="outline" data-act="slot-clear">清空</button>' +
      '<button class="outline" data-act="dismiss-dialog">取消</button>' +
      '<button class="primary" data-act="slot-save">保存</button>'));
  }

  function openExport() {
    var weeks = state.roster.map(function (s) { return s.week; });
    var start = weeks.length ? Math.min.apply(null, weeks) : currentWeek();
    var end = weeks.length ? Math.max.apply(null, weeks) : currentWeek();
    ui.export = { start: start, end: end };
    renderExport();
  }

  function renderExport() {
    var exp = ui.export;
    var text = C.rosterText(state.roster, exp.start, exp.end, [1,2,3,4,5,6,7], [1,2,3,4,5], state.cfg.slotTimes);
    var count = state.roster.filter(function (s) { return s.week >= exp.start && s.week <= exp.end && s.names.length; }).length;
    var body = '<div class="field-row">' +
      '<label class="field narrow"><span>起始周</span><input id="exp-start" inputmode="numeric" value="' + exp.start + '"></label>' +
      '<span class="muted" style="align-self:center">至</span>' +
      '<label class="field narrow"><span>结束周</span><input id="exp-end" inputmode="numeric" value="' + exp.end + '"></label>' +
      '</div>' +
      '<p class="muted small">第 ' + exp.start + '–' + exp.end + ' 周 · 共 ' + count + ' 个已排时段</p>' +
      '<pre class="export-preview" id="export-text">' + esc(text) + '</pre>' +
      '<p class="hint">「复制」后可粘贴到群里；「分享」可发到微信/QQ（手机支持时）。</p>';
    var empty = count === 0;
    if (empty) {
      body += '<p class="warn">这个周区间里还没有排班，导出会是空表。请先点「自动排班」，或把周区间改成已经排过的周。</p>';
    }
    var dis = empty ? ' disabled' : '';
    openDialog(dialogShell('导出排班表', body,
      '<button class="outline" data-act="export-share"' + dis + '>分享文字</button>' +
      '<button class="outline" data-act="dismiss-dialog">取消</button>' +
      '<button class="outline" data-act="export-copy"' + dis + '>复制文字</button>' +
      '<button class="primary" data-act="export-xlsx"' + dis + '>导出 Excel</button>'));
  }

  function openFreeSlots() {
    ui.freeSlotsWeek = currentWeek();
    renderFreeSlots();
  }

  function renderFreeSlots() {
    var free = state.free;
    if (!free) return;
    var week = ui.freeSlotsWeek || currentWeek();
    var body = '<div class="row"><button class="ghost" data-act="free-slots-prev">‹</button>' +
      '<div class="center-title">第 ' + week + ' 周</div>' +
      '<button class="ghost" data-act="free-slots-next">›</button></div>' +
      '<p class="muted tiny">每一行是一个时段，后面是该时段没课的成员。</p>';
    free.days.forEach(function (day) {
      body += '<div class="fs-day">周' + C.WEEKDAY_SHORT[day - 1] + '</div>';
      for (var big = 1; big <= C.BIG_COUNT; big++) {
        var names = C.freeNames(free, day, big, week);
        body += '<div class="fs-row"><span class="fs-label">' + C.BIG_SHORT[big - 1] + '节</span>' +
          '<span class="fs-time">' + esc(timeLabel(state.cfg.slotTimes[big - 1])) + '</span>' +
          '<span class="fs-count">' + names.length + ' 人</span></div>' +
          '<div class="fs-names ' + (names.length ? '' : 'none') + '">' + (names.length ? names.map(esc).join('、') : '无人有空') + '</div>';
      }
    });
    openDialog(dialogShell('各时段没课的人（空课表）', body, '<button class="outline" data-act="dismiss-dialog">关闭</button>'));
  }

  function openReset() {
    var weeks = {};
    state.roster.forEach(function (s) { weeks[s.week] = 1; });
    var body = '<p>会清空所有周的排班（共 ' + Object.keys(weeks).length + ' 周 · ' + totalAssignments() + ' 班），随时可以重新生成。</p>' +
      '<label class="check-row"><input type="checkbox" id="reset-adjust"><span>同时清空手动改的次数</span></label>' +
      '<p class="muted tiny">空课表、排班设置（星期/大节/成员/时间）不会被删。</p>';
    openDialog(dialogShell('重置全部排班', body,
      '<button class="outline" data-act="dismiss-dialog">取消</button>' +
      '<button class="danger-btn" data-act="reset-confirm">重置</button>'));
  }

  function openAdjust(name) {
    var base = C.countByPerson(state.roster)[name] || 0;
    var delta = (state.cfg.adjust[name] || 0);
    ui.adjust = { name: name, base: base, delta: delta };
    renderAdjust();
  }

  function renderAdjust() {
    var a = ui.adjust;
    var body = '<div class="adjust-name">' + esc(a.name) + '</div>' +
      '<div class="muted small">排班表里：' + a.base + ' 班</div>' +
      '<div class="adjust-total">合计：' + (a.base + a.delta) + ' 班</div>' +
      '<div class="stepper-row"><span>手动调整</span>' +
      '<button class="ghost" data-act="adjust-delta" data-delta="-1">−</button>' +
      '<b>' + (a.delta > 0 ? '+' + a.delta : a.delta) + '</b>' +
      '<button class="ghost" data-act="adjust-delta" data-delta="1">+</button></div>' +
      '<p class="hint">用来补录/扣除不在排班表里的值班（比如临时多值了一班），只影响「合计」，点「清零」可撤销。</p>';
    openDialog(dialogShell('修改值班次数', body,
      '<button class="outline" data-act="adjust-clear">清零</button>' +
      '<button class="outline" data-act="dismiss-dialog">取消</button>' +
      '<button class="primary" data-act="adjust-save">保存</button>'));
  }

  // ---------- 文件导入 ----------

  function readWorkbook(file, done, fail) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var wb = XLSX.read(new Uint8Array(reader.result), { type: 'array', cellText: true });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
        done(rows, file.name || '');
      } catch (e) {
        fail(e);
      }
    };
    reader.onerror = function () { fail(new Error('读取文件失败')); };
    reader.readAsArrayBuffer(file);
  }

  function importSchedule(file) {
    readWorkbook(file, function (rows) {
      try {
        var parsed = C.parseTimetable(rows);
        if (!parsed.items.length) throw new Error('文件里没有解析到课程，确认是教务系统导出的课表 .xls');
        state.cache = {
          fetchedAt: Date.now(),
          term: parsed.term || '',
          items: parsed.items
        };
        if (parsed.term) state.prefs.term = parsed.term;
        ui.week = C.currentWeek(state.prefs);
        save();
        render();
        toast('导入成功：' + parsed.items.length + ' 条课程');
      } catch (e) {
        toast(e.message || '课表解析失败');
      }
    }, function () { toast('读取文件失败'); });
  }

  function importFreeTable(file) {
    readWorkbook(file, function (rows) {
      try {
        var parsed = C.parseFreeTable(rows);
        parsed.sourceName = file.name || '空课表';
        state.free = parsed;
        save();
        render();
        toast('已导入空课表：' + parsed.members.length + ' 人、' + parsed.days.length + ' 天');
      } catch (e) {
        toast(e.message || '空课表解析失败');
      }
    }, function () { toast('读取文件失败'); });
  }

  // ---------- 事件 ----------

  function bindEvents() {
    $('#tabbar').addEventListener('click', function (event) {
      var btn = event.target.closest('button[data-tab]');
      if (!btn) return;
      state.uiTab = btn.getAttribute('data-tab');
      ui.settingsPage = null;
      if (history.state && history.state.pcl) { try { history.replaceState(null, ''); } catch (e) { } }
      save();
      render();
    });

    $('#scheduleFile').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (file) importSchedule(file);
    });
    $('#freeFile').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (file) importFreeTable(file);
    });

    document.addEventListener('click', function (event) {
      var target = event.target.closest('[data-act]');
      if (!target) return;
      handleAction(target.getAttribute('data-act'), target, event);
    });

    document.addEventListener('change', function (event) {
      var target = event.target;
      var act = target.getAttribute && target.getAttribute('data-act');
      if (act === 'gen-avoid-day') { ui.gen.avoidDay = target.checked; return; }
      if (act === 'gen-avoid-week') { ui.gen.avoidWeek = target.checked; return; }
      if (act === 'gen-allow-repeat') { ui.gen.allowRepeat = target.checked; return; }
      if (act === 'picker-toggle') {
        var name = target.getAttribute('data-name');
        var gen = ui.gen;
        if (target.checked) { if (gen.members.indexOf(name) < 0) gen.members.push(name); }
        else gen.members = gen.members.filter(function (n) { return n !== name; });
        renderPicker();
        return;
      }
      if (act === 'member-slot' && ui.memberEdit) {
        var slotKey = target.getAttribute('data-key');
        if (target.checked) {
          if (!Object.prototype.hasOwnProperty.call(ui.memberEdit.slotWeeks, slotKey)) {
            ui.memberEdit.slotWeeks[slotKey] = '';
          }
        } else {
          delete ui.memberEdit.slotWeeks[slotKey];
        }
        renderMemberEdit();
        return;
      }
      if (act === 'batch-toggle' && ui.batch) {
        var bname = target.getAttribute('data-name');
        if (target.checked) ui.batch.selected[bname] = 1;
        else delete ui.batch.selected[bname];
        renderBatchAdjust();
        return;
      }
      if (act === 'slot-toggle') {
        var sname = target.getAttribute('data-name');
        if (target.checked) { if (ui.slotEdit.current.indexOf(sname) < 0) ui.slotEdit.current.push(sname); }
        else ui.slotEdit.current = ui.slotEdit.current.filter(function (n) { return n !== sname; });
        return;
      }
    });

    document.addEventListener('change', function (event) {
      var t = event.target;
      if (!t || !t.id) return;
      if (t.id === 'gen-start' && ui.gen) { ui.gen.start = parseInt(t.value, 10) || ui.gen.start; renderGenerate(); }
      else if (t.id === 'gen-end' && ui.gen) { ui.gen.end = parseInt(t.value, 10) || ui.gen.end; renderGenerate(); }
      else if ((t.id === 'exp-start' || t.id === 'exp-end') && ui.export) {
        var v = parseInt(t.value, 10) || 1;
        if (t.id === 'exp-start') ui.export.start = v; else ui.export.end = v;
        renderExport();
      }
    });

    document.addEventListener('input', function (event) {
      var target = event.target;
      if (target.classList && target.classList.contains('slot-week-input') && ui.memberEdit) {
        var weekKey = target.getAttribute('data-key');
        ui.memberEdit.slotWeeks[weekKey] = target.value;
        return;
      }
      if (target.id === 'batch-query' && ui.batch) {
        ui.batch.query = target.value;
        var pos = target.selectionStart;
        renderBatchAdjust();
        var qinput = document.getElementById('batch-query');
        if (qinput) { qinput.focus(); qinput.setSelectionRange(pos, pos); }
      }
      if (target.id === 'picker-query' && ui.gen) {
        ui.gen.query = target.value;
        var pos = target.selectionStart;
        renderPicker();
        var input = $('#picker-query');
        if (input) { input.focus(); input.setSelectionRange(pos, pos); }
      }
      if (target.classList && target.classList.contains('time-input')) {
        var index = Number(target.getAttribute('data-time-index'));
        var part = Number(target.getAttribute('data-time-part'));
        var parts = (state.cfg.slotTimes[index] || '').split('-');
        parts[part] = target.value.replace(/[^\d:]/g, '').slice(0, 5);
        state.cfg.slotTimes[index] = (parts[0] || '') + '-' + (parts[1] || '');
      }
    });

    window.addEventListener('popstate', function () {
      if (ui.settingsPage) {
        ui.settingsPage = null;
        render();
      } else if (ui.dialog) {
        closeDialog();
      }
    });
  }

  function handleAction(act, target, event) {
    switch (act) {
      case 'week-prev': setWeek(currentWeek() - 1); break;
      case 'week-next': setWeek(currentWeek() + 1); break;
      case 'week-now':
        state.prefs.week = 0; save(); render(); break;
      case 'go-settings-source':
        state.uiTab = 'settings'; ui.settingsPage = 'source'; save(); pushPage(); render(); break;
      case 'go-settings-free':
        state.uiTab = 'settings'; ui.settingsPage = 'free'; save(); pushPage(); render(); break;
      case 'settings-open':
        ui.settingsPage = target.getAttribute('data-page');
        pushPage(); render(); break;
      case 'settings-back':
        if (history.state && history.state.pcl) history.back();
        else { ui.settingsPage = null; render(); }
        break;
      case 'save-term': {
        state.prefs.term = ($('#in-term').value || '').trim();
        var weekVal = parseInt($('#in-week').value, 10) || 0;
        state.prefs.week = weekVal;
        state.prefs.semesterStart = ($('#in-start').value || '').trim();
        ui.week = C.currentWeek(state.prefs);
        save(); render(); toast('设置已保存'); break;
      }
      case 'save-times': {
        var list = [];
        for (var i = 0; i < C.BIG_COUNT; i++) {
          var m = (state.cfg.slotTimes[i] || '').match(/^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
          list.push(m ? state.cfg.slotTimes[i] : C.DEFAULT_SLOT_TIMES[i]);
        }
        state.cfg.slotTimes = list;
        save(); render(); toast('值班时段已保存'); break;
      }
      case 'open-batch-adjust': openBatchAdjust(); break;
      case 'batch-all': {
        state.free.members.forEach(function (n) { ui.batch.selected[n] = 1; });
        renderBatchAdjust(); break;
      }
      case 'batch-none': ui.batch.selected = {}; renderBatchAdjust(); break;
      case 'batch-invert': {
        var next = {};
        state.free.members.forEach(function (n) { if (!ui.batch.selected[n]) next[n] = 1; });
        ui.batch.selected = next;
        renderBatchAdjust(); break;
      }
      case 'batch-mode': ui.batch.mode = target.getAttribute('data-mode'); renderBatchAdjust(); break;
      case 'batch-value':
        ui.batch.value = Math.max(0, Math.min(99, (ui.batch.value || 0) + Number(target.getAttribute('data-delta'))));
        renderBatchAdjust(); break;
      case 'batch-apply': applyBatchAdjust(); break;
      case 'member-bulk-weeks': {
        var bulkInput = document.getElementById('bulk-week');
        var bulkValue = (bulkInput && bulkInput.value || '').trim();
        if (!bulkValue) { toast('先填统一周次'); break; }
        Object.keys(ui.memberEdit.slotWeeks).forEach(function (key) { ui.memberEdit.slotWeeks[key] = bulkValue; });
        renderMemberEdit();
        toast('已应用到 ' + Object.keys(ui.memberEdit.slotWeeks).length + ' 个时段');
        break;
      }
      case 'member-new': openMemberEdit(null); break;
      case 'member-edit': openMemberEdit(target.getAttribute('data-name')); break;
      case 'member-save': saveMemberEdit(); break;
      case 'member-add':
        addMember($('#new-member-name') && $('#new-member-name').value,
          $('#new-member-weeks') && $('#new-member-weeks').value);
        break;
      case 'member-del': {
        var delName = target.getAttribute('data-name');
        openConfirm('删除成员', '确定删除「' + delName + '」吗？已排好的班次会保留，重新导入空课表会恢复。', function () {
          removeMember(delName);
        });
        break;
      }
      case 'confirm-ok': {
        var action = ui.confirm && ui.confirm.onOk;
        closeDialog();
        if (action) action();
        break;
      }
      case 'import-schedule': $('#scheduleFile').click(); break;
      case 'import-free': $('#freeFile').click(); break;
      case 'add-manual': openManual(target.getAttribute('data-day'), target.getAttribute('data-big')); break;
      case 'del-manual': {
        var id = Number(target.getAttribute('data-id'));
        state.manual = state.manual.filter(function (c) { return c.id !== id; });
        save(); render(); break;
      }
      case 'open-generate': openGenerate(); break;
      case 'gen-day': {
        var day = Number(target.getAttribute('data-day'));
        toggle(ui.gen, 'days', day);
        renderGenerate(); break;
      }
      case 'gen-section': {
        var big = Number(target.getAttribute('data-big'));
        toggle(ui.gen, 'sections', big);
        renderGenerate(); break;
      }
      case 'gen-need': {
        ui.gen.perSlot = Math.max(1, Math.min(6, ui.gen.perSlot + Number(target.getAttribute('data-delta'))));
        renderGenerate(); break;
      }
      case 'gen-picker': ui.gen.picker = true; renderPicker(); break;
      case 'gen-run': runGenerate(); break;
      case 'picker-all':
        ui.gen.members = state.free.members.slice(); renderPicker(); break;
      case 'picker-none':
        ui.gen.members = []; renderPicker(); break;
      case 'picker-invert': {
        ui.gen.members = state.free.members.filter(function (n) { return ui.gen.members.indexOf(n) < 0; });
        renderPicker(); break;
      }
      case 'picker-select-filtered': {
        var q = ui.gen.query.trim();
        state.free.members.forEach(function (n) {
          if ((!q || n.indexOf(q) >= 0) && ui.gen.members.indexOf(n) < 0) ui.gen.members.push(n);
        });
        renderPicker(); break;
      }
      case 'picker-unselect-filtered': {
        var q2 = ui.gen.query.trim();
        ui.gen.members = ui.gen.members.filter(function (n) { return q2 && n.indexOf(q2) < 0; });
        renderPicker(); break;
      }
      case 'picker-ok': ui.gen.picker = false; renderGenerate(); break;
      case 'picker-cancel': ui.gen.picker = false; renderGenerate(); break;
      case 'edit-slot':
        openSlotEdit(Number(target.getAttribute('data-day')), Number(target.getAttribute('data-big')));
        break;
      case 'slot-save': {
        var edit = ui.slotEdit;
        var selected = edit.current.slice();
        state.roster = state.roster.filter(function (s) {
          return !(s.week === currentWeek() && s.day === edit.day && s.bigSection === edit.big);
        });
        if (selected.length) {
          state.roster.push({ week: currentWeek(), day: edit.day, bigSection: edit.big, names: selected.sort() });
        }
        sortRoster(); save(); closeDialog(); render();
        toast(selected.length ? '已更新：' + selected.join('、') : '已清空该时段');
        break;
      }
      case 'slot-clear':
        ui.slotEdit.current = [];
        state.roster = state.roster.filter(function (s) {
          return !(s.week === currentWeek() && s.day === ui.slotEdit.day && s.bigSection === ui.slotEdit.big);
        });
        save(); closeDialog(); render(); toast('已清空该时段'); break;
      case 'clear-week': {
        var w = currentWeek();
        state.roster = state.roster.filter(function (s) { return s.week !== w; });
        save(); render(); toast('已清空第 ' + w + ' 周排班'); break;
      }
      case 'open-export': openExport(); break;
      case 'export-copy': {
        var text = $('#export-text').textContent;
        copyText(text);
        break;
      }
      case 'export-share': {
        var shareText2 = $('#export-text').textContent;
        if (navigator.share) {
          navigator.share({ title: '排班表', text: shareText2 }).then(function () { closeDialog(); }, function () { });
        } else {
          toast('这个浏览器不支持分享，用「复制」吧');
        }
        break;
      }
      case 'export-xlsx': {
        var exp = ui.export;
        var book = C.buildRosterWorkbook(state.roster, exp.start, exp.end, [1,2,3,4,5,6,7], [1,2,3,4,5],
          state.cfg.slotTimes, state.free ? state.free.members : [], state.cfg.adjust);
        var wb = XLSX.utils.book_new();
        book.sheets.forEach(function (sheet, index) {
          var ws = XLSX.utils.aoa_to_sheet(sheet.rows);
          ws['!cols'] = sheet.rows[0] && sheet.rows[0].length > 1
            ? [{ wch: 13 }].concat(sheet.rows[0].slice(1).map(function () { return { wch: 12 }; }))
            : [{ wch: 16 }, { wch: 6 }, { wch: 8 }];
          XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
        });
        XLSX.writeFile(wb, book.fileName);
        var count = state.roster.filter(function (item) {
          return item.week >= exp.start && item.week <= exp.end && item.names && item.names.length;
        }).length;
        toast('已导出：' + book.fileName + '（' + count + ' 个时段）');
        break;
      }
      case 'open-free-slots': openFreeSlots(); break;
      case 'free-slots-prev': ui.freeSlotsWeek = Math.max(1, (ui.freeSlotsWeek || 1) - 1); renderFreeSlots(); break;
      case 'free-slots-next':
        ui.freeSlotsWeek = Math.min(Math.max(1, state.free.maxWeek || 20), (ui.freeSlotsWeek || 1) + 1);
        renderFreeSlots(); break;
      case 'open-reset': openReset(); break;
      case 'reset-confirm': {
        var clearAdjust = $('#reset-adjust') && $('#reset-adjust').checked;
        state.roster = [];
        if (clearAdjust) state.cfg.adjust = {};
        save(); closeDialog(); render(); toast(clearAdjust ? '已重置全部排班和手动调整' : '已重置全部排班'); break;
      }
      case 'toggle-stats': ui.statsOpen = !ui.statsOpen; render(); break;
      case 'sort-week': ui.sortByWeek = true; render(); break;
      case 'sort-total': ui.sortByWeek = false; render(); break;
      case 'adjust-person': openAdjust(target.getAttribute('data-name')); break;
      case 'adjust-delta':
        ui.adjust.delta = Math.max(-99, Math.min(99, ui.adjust.delta + Number(target.getAttribute('data-delta'))));
        renderAdjust(); break;
      case 'adjust-clear': {
        delete state.cfg.adjust[ui.adjust.name]; save(); closeDialog(); render(); toast('已清零'); break;
      }
      case 'adjust-save': {
        var name = ui.adjust.name;
        if (!ui.adjust.delta) delete state.cfg.adjust[name];
        else state.cfg.adjust[name] = ui.adjust.delta;
        save(); closeDialog(); render(); toast('已保存'); break;
      }
      case 'copy-url':
        copyText(APP_URL);
        break;
      case 'share-url':
        if (navigator.share) {
          navigator.share({ title: '课表排班', text: '课表 + 排班网页版', url: APP_URL }).catch(function () { copyText(APP_URL); });
        } else {
          copyText(APP_URL);
        }
        break;
      case 'dismiss-dialog': closeDialog(); break;
      default: break;
    }
  }

  function toggle(obj, key, value) {
    var list = obj[key];
    var index = list.indexOf(value);
    if (index >= 0) {
      if (list.length > 1) list.splice(index, 1);
    } else {
      list.push(value);
    }
  }

  function setWeek(week) {
    state.prefs.week = Math.max(1, week);
    ui.week = state.prefs.week;
    save(); render();
  }

  function sortRoster() {
    state.roster.sort(function (a, b) {
      if (a.week !== b.week) return a.week - b.week;
      if (a.day !== b.day) return a.day - b.day;
      return a.bigSection - b.bigSection;
    });
  }

  function pushPage() {
    try { history.pushState({ pcl: 1 }, ''); } catch (e) { /* ignore */ }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('已复制'); }, function () { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); toast('排班表已复制'); }
    catch (e) { toast('复制失败，请手动长按选择'); }
    area.remove();
  }

  // 手动加课
  function openManual(day, big) {
    var body = '<label class="field"><span>课程名</span><input id="man-name" placeholder="高等数学"></label>' +
      '<label class="field"><span>地点</span><input id="man-room" placeholder="J7-205"></label>' +
      '<label class="field"><span>教师</span><input id="man-teacher" placeholder="可选"></label>' +
      '<input type="hidden" id="man-day" value="' + day + '"><input type="hidden" id="man-big" value="' + big + '">' +
      '<p class="muted small">加到周' + C.WEEKDAY_SHORT[day - 1] + ' ' + C.BIG_SHORT[big - 1] + '节</p>';
    openDialog(dialogShell('手动加课', body,
      '<button class="outline" data-act="dismiss-dialog">取消</button>' +
      '<button class="primary" data-act="manual-save">保存</button>'));
  }

  document.addEventListener('click', function (event) {
    var target = event.target.closest('[data-act="manual-save"]');
    if (!target) return;
    var name = ($('#man-name') && $('#man-name').value || '').trim();
    if (!name) { toast('先填课程名'); return; }
    state.manual.push({
      id: Date.now(),
      name: name,
      room: ($('#man-room') && $('#man-room').value || '').trim(),
      teacher: ($('#man-teacher') && $('#man-teacher').value || '').trim(),
      day: Number($('#man-day').value),
      bigSection: Number($('#man-big').value)
    });
    save(); closeDialog(); render(); toast('已添加：' + name);
  });

  // ---------- 启动 ----------

  state.uiTab = state.uiTab || 'timetable';
  if (state.uiTab !== 'settings' && state.uiTab !== 'roster') state.uiTab = 'timetable';
  bindEvents();
  render();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 忽略 */ });
    });
  }
})();
