/* University_Pcl Web — 纯逻辑层：课表解析、空课表解析、排班算法、导出文字。
 * 浏览器里挂到 window.PCLCore，Node 里可 require 用于测试。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PCLCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BIG_COUNT = 5;
  var BIG_LABELS = ['1-2 节', '3-4 节', '5-6 节', '7-8 节', '9-10 节'];
  var BIG_SHORT = ['1-2', '3-4', '5-6', '7-8', '9-10'];
  var WEEKDAY_LONG = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  var WEEKDAY_SHORT = ['一', '二', '三', '四', '五', '六', '日'];
  var DEFAULT_SLOT_TIMES = ['08:00-09:50', '10:10-12:00', '14:00-15:50', '16:10-18:00', '19:00-20:50'];
  var DEFAULT_MAX_WEEK = 20;

  // ---------- 通用 ----------

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function normalizeDigits(raw) {
    if (!raw) return '';
    var out = '';
    for (var i = 0; i < raw.length; i++) {
      var ch = raw[i];
      var code = ch.charCodeAt(0);
      if (code >= 0xff10 && code <= 0xff19) {
        out += String.fromCharCode(48 + code - 0xff10);
      } else if (ch === '．') {
        out += '.';
      } else if (ch === '－' || ch === '—' || ch === '–' || ch === '~' || ch === '～') {
        out += '-';
      } else {
        out += ch;
      }
    }
    return out;
  }

  var NAME_EDGE_CHARS = ' \t\r\n\u3000\u00a0、，,;；:：（()）【】[]';

  function cleanName(raw) {
    var name = String(raw || '').trim();
    // 名字后面常跟「（1-20）」「(1-3，18-20)」这类周次括号，括号和标点都不算名字
    while (name && NAME_EDGE_CHARS.indexOf(name.charAt(0)) >= 0) name = name.slice(1);
    while (name && NAME_EDGE_CHARS.indexOf(name.charAt(name.length - 1)) >= 0) name = name.slice(0, -1);
    if (name.indexOf('姓名') === 0) name = name.slice(2).replace(/^[\s:：]+/, '');
    return name;
  }

  function uniqueSorted(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (v) {
      if (!seen[v]) {
        seen[v] = 1;
        out.push(v);
      }
    });
    return out.sort(function (a, b) { return a - b; });
  }

  // ---------- 空课表：周次 / 成员 ----------

  var RANGE_RE = /(\d{1,2})\s*[-~—–－至到]\s*(\d{1,2})/;
  var RANGE_RE_G = /(\d{1,2})\s*[-~—–－至到]\s*(\d{1,2})/g;
  var SINGLE_RE_G = /\d{1,2}/g;

  /** 空课表的周次写法 -> {allWeeks, weeks} */
  function parseWeekSpec(raw) {
    var text = normalizeDigits(String(raw || '').trim());
    if (!text) return { allWeeks: true, weeks: [] };
    if (!/\d/.test(text)) return { allWeeks: true, weeks: [] };
    var weeks = {};
    var rest = text;
    var m;
    RANGE_RE_G.lastIndex = 0;
    while ((m = RANGE_RE_G.exec(text)) !== null) {
      var a = parseInt(m[1], 10);
      var b = parseInt(m[2], 10);
      if (!(a >= 1 && b >= a)) continue;
      for (var w = a; w <= b && w <= 30; w++) {
        if (w >= 1 && w <= 30) weeks[w] = 1;
      }
    }
    rest = text.replace(RANGE_RE_G, ' ');
    var m2;
    SINGLE_RE_G.lastIndex = 0;
    while ((m2 = SINGLE_RE_G.exec(rest)) !== null) {
      var single = parseInt(m2[0], 10);
      if (single >= 1 && single <= 30) weeks[single] = 1;
    }
    var list = Object.keys(weeks).map(Number).sort(function (a, b) { return a - b; });
    if (!list.length) return { allWeeks: true, weeks: [] };
    return { allWeeks: false, weeks: list };
  }

  /** 「刘如航16-20」→ {name, allWeeks, weeks} */
  function parseMemberLine(line) {
    var text = normalizeDigits(String(line || '').trim());
    if (!text) return null;
    var digitIndex = -1;
    for (var i = 0; i < text.length; i++) {
      if (/\d/.test(text[i])) { digitIndex = i; break; }
    }
    if (digitIndex < 0) {
      var wholeName = cleanName(text);
      return wholeName ? { name: wholeName, allWeeks: true, weeks: [] } : null;
    }
    var name = cleanName(text.slice(0, digitIndex));
    if (!name) return null;
    var spec = parseWeekSpec(text.slice(digitIndex));
    return { name: name, allWeeks: spec.allWeeks, weeks: spec.weeks };
  }

  function mergeMembers(a, b) {
    var weeks = uniqueSorted((a.weeks || []).concat(b.weeks || []));
    return { name: a.name, allWeeks: !!(a.allWeeks || b.allWeeks), weeks: weeks };
  }

  function parseCellMembers(text) {
    if (!text) return [];
    var order = [];
    var map = {};
    String(text).replace(/\r/g, '\n').split('\n').forEach(function (line) {
      var member = parseMemberLine(line);
      if (!member) return;
      if (map[member.name]) map[member.name] = mergeMembers(map[member.name], member);
      else { map[member.name] = member; order.push(member.name); }
    });
    return order.map(function (name) { return map[name]; });
  }

  var WEEKDAY_RE = /^(?:星期|周|礼拜)?([一二三四五六日天])$/;
  var WEEKDAY_MAP = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };

  function weekdayOf(raw) {
    var text = String(raw || '').replace(/[\s\u3000\u00a0]/g, '');
    var m = WEEKDAY_RE.exec(text);
    return m ? WEEKDAY_MAP[m[1]] : null;
  }

  var BIG_RE = /第\s*([一二三四五六七八九十\d]+)\s*大节/;
  var CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

  function chineseNumber(raw) {
    if (!raw) return null;
    if (/^\d+$/.test(raw)) return parseInt(raw, 10);
    if (raw === '十') return 10;
    if (raw.length === 2 && raw[1] === '十') return (CN_NUM[raw[0]] || 0) * 10 || null;
    if (raw.length === 3 && raw[1] === '十') {
      var tens = CN_NUM[raw[0]] || 0;
      var ones = CN_NUM[raw[2]] || 0;
      return tens * 10 + ones;
    }
    if (raw[0] === '十') return 10 + (CN_NUM[raw[1]] || 0);
    return CN_NUM[raw[0]] || null;
  }

  function bigSectionOf(label) {
    var m = BIG_RE.exec(String(label || '').trim());
    return m ? chineseNumber(m[1]) : null;
  }

  /**
   * 空课表二维表 → {days, cells, members, maxWeek}
   * cells: [{day, bigSection, members:[{name, allWeeks, weeks}]}]
   */
  function parseFreeTable(rows) {
    if (!rows || !rows.length) throw new Error('表格是空的');
    var headerRow = -1;
    var dayCols = null;
    for (var r = 0; r < rows.length; r++) {
      var found = {};
      var row = rows[r] || [];
      for (var c = 0; c < row.length; c++) {
        var day = weekdayOf(row[c]);
        if (day) found[c] = day;
      }
      if (Object.keys(found).length >= 2) {
        headerRow = r;
        dayCols = found;
        break;
      }
    }
    if (headerRow < 0) throw new Error('没找到「星期一 … 星期日」表头，确认这份文件是空课表');

    var bigRows = [];
    for (var ri = headerRow + 1; ri < rows.length; ri++) {
      var label = (rows[ri] && rows[ri][0]) ? String(rows[ri][0]).trim() : '';
      var big = bigSectionOf(label);
      if (big) bigRows.push({ row: ri, big: big });
    }
    if (!bigRows.length) throw new Error('没找到「第 X 大节」的行');

    var days = [];
    Object.keys(dayCols).forEach(function (col) {
      var d = dayCols[col];
      if (days.indexOf(d) < 0) days.push(d);
    });
    days.sort(function (a, b) { return a - b; });

    var cells = [];
    var memberMap = {};
    var memberOrder = [];
    for (var bigIndex = 1; bigIndex <= BIG_COUNT; bigIndex++) {
      var target = null;
      for (var b = 0; b < bigRows.length; b++) {
        if (bigRows[b].big === bigIndex) { target = bigRows[b]; break; }
      }
      days.forEach(function (day) {
        var col = -1;
        Object.keys(dayCols).forEach(function (key) {
          if (dayCols[key] === day && col < 0) col = Number(key);
        });
        var text = '';
        if (target && rows[target.row] && col >= 0) {
          text = rows[target.row][col] || '';
        }
        var members = parseCellMembers(text);
        cells.push({ day: day, bigSection: bigIndex, members: members });
        members.forEach(function (m) {
          if (memberMap[m.name]) memberMap[m.name] = mergeMembers(memberMap[m.name], m);
          else { memberMap[m.name] = m; memberOrder.push(m.name); }
        });
      });
    }
    if (!memberOrder.length) throw new Error('没解析到成员名字，确认单元格里是「姓名 + 周次」的写法');
    var maxWeek = 0;
    Object.keys(memberMap).forEach(function (name) {
      memberMap[name].weeks.forEach(function (w) { if (w > maxWeek) maxWeek = w; });
    });
    return {
      importedAt: Date.now(),
      sourceName: '',
      days: days,
      cells: cells,
      members: memberOrder,
      maxWeek: maxWeek
    };
  }

  function freeCell(free, day, bigSection) {
    if (!free) return null;
    for (var i = 0; i < free.cells.length; i++) {
      var c = free.cells[i];
      if (c.day === day && c.bigSection === bigSection) return c;
    }
    return null;
  }

  function memberFreeIn(member, week) {
    return member.allWeeks || (member.weeks || []).indexOf(week) >= 0;
  }

  /** 某周某时段有空的人 */
  function freeNames(free, day, bigSection, week) {
    var cell = freeCell(free, day, bigSection);
    if (!cell) return [];
    return cell.members.filter(function (m) { return memberFreeIn(m, week); }).map(function (m) { return m.name; });
  }

  // ---------- 课表（强智导出 .xls） ----------

  var TERM_RE = /学年学期[：:]\s*(\d{4}-\d{4}-[12])/;
  var SECTION_RE = /(\d+)\s*(?:[-~～]\s*(\d+))?\s*节/;
  var WEEK_RANGE_RE = /(\d+)(?:\s*[-~～]\s*(\d+))?/g;

  function parseWeekText(raw) {
    var text = String(raw || '');
    if (!text.trim()) return { weeks: [], parity: 0 };
    var normalized = text.replace(/（/g, '(').replace(/）/g, ')');
    var parity = normalized.indexOf('单') >= 0 ? 1 : (normalized.indexOf('双') >= 0 ? 2 : 0);
    var head = normalized.split('(')[0];
    if (head.indexOf('周') >= 0) head = head.split('周')[0];
    head = head.replace(/\s/g, '');
    if (!head) return { weeks: [], parity: parity };
    var weeks = {};
    var m;
    WEEK_RANGE_RE.lastIndex = 0;
    while ((m = WEEK_RANGE_RE.exec(head)) !== null) {
      var from = parseInt(m[1], 10);
      var to = m[2] ? parseInt(m[2], 10) : null;
      if (to !== null && to >= from) {
        for (var w = from; w <= Math.min(to, from + 30); w++) {
          if (w >= 1 && w <= 30) weeks[w] = 1;
        }
      } else if (from >= 1 && from <= 30) {
        weeks[from] = 1;
      }
      if (m.index === WEEK_RANGE_RE.lastIndex) WEEK_RANGE_RE.lastIndex++;
    }
    return {
      weeks: Object.keys(weeks).map(Number).sort(function (a, b) { return a - b; }),
      parity: parity
    };
  }

  function roomCompact(raw) {
    var text = String(raw || '').trim();
    if (!text) return '';
    var m = /[（(]([^（()）]+)[)）]/.exec(text);
    var compact = m ? m[1].trim() : text;
    if (compact.length > 1 && /室$/.test(compact) && /[A-Za-z0-9]/.test(compact[compact.length - 2])) {
      compact = compact.slice(0, -1);
    }
    return compact.trim();
  }

  var TIMETABLE_BIG_LABELS = ['第一大节', '第二大节', '第三大节', '第四大节', '第五大节'];

  function bigLabelOf(label) {
    var trimmed = String(label || '').trim();
    for (var i = 0; i < TIMETABLE_BIG_LABELS.length; i++) {
      if (trimmed.indexOf(TIMETABLE_BIG_LABELS[i]) === 0) return i + 1;
    }
    return null;
  }

  function parseTimetable(rows) {
    if (!rows || !rows.length) throw new Error('表格是空的');
    var term = null;
    var items = [];
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r] || [];
      var label = row[0] ? String(row[0]).trim() : '';
      if (label) {
        var termMatch = TERM_RE.exec(label);
        if (termMatch) term = termMatch[1];
      }
      var fallbackBig = bigLabelOf(label);
      if (!fallbackBig) continue;
      var columns = Math.max(row.length, 8);
      for (var day = 1; day < columns; day++) {
        var text = row[day] || '';
        if (!String(text).trim()) continue;
        parseTimetableCell(String(text), day, fallbackBig, items);
      }
    }
    return { term: term, items: items };
  }

  function parseTimetableCell(text, day, fallbackBig, out) {
    var lines = text.replace(/\r/g, '\n').split('\n').map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
    var index = 0;
    while (index < lines.length) {
      var info = lines[index];
      if (info.indexOf(';') < 0) { index++; continue; }
      var name = (index > 0 && lines[index - 1].indexOf(';') < 0) ? lines[index - 1] : '';
      var parts = info.split(';').map(function (s) { return s.trim(); });
      var teacher = parts[0] || '';
      var weekText = parts[1] || '';
      var sectionText = parts.slice(2).join(';');
      var weekResult = parseWeekText(weekText);
      var sectionMatch = SECTION_RE.exec(sectionText);
      var sectionNo = sectionMatch ? parseInt(sectionMatch[1], 10) : null;
      var bigSection = (sectionNo && sectionNo > 0)
        ? Math.max(1, Math.min(BIG_COUNT, Math.floor((sectionNo - 1) / 2) + 1))
        : fallbackBig;

      var next = index + 1;
      if (next < lines.length && /学时$/.test(lines[next])) next++;
      var room = '';
      if (next < lines.length && lines[next].indexOf(';') < 0 && !/学时$/.test(lines[next])) {
        room = lines[next];
        next++;
      }
      if (name) {
        out.push({
          day: day,
          bigSection: bigSection,
          name: name,
          room: roomCompact(room),
          teacher: teacher,
          weekText: weekText,
          weeks: weekResult.weeks,
          parity: weekResult.parity
        });
      }
      index = next;
    }
  }

  function courseActiveIn(course, week) {
    if (!week || week <= 0) return true;
    var inRange = !course.weeks || !course.weeks.length || course.weeks.indexOf(week) >= 0;
    var parityOk = course.parity === 1 ? (week % 2 === 1) : (course.parity === 2 ? (week % 2 === 0) : true);
    return inRange && parityOk;
  }

  // ---------- 排班算法 ----------

  function tieRank(name, week, day, big) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    h = (h * 31 + week * 7 + day * 13 + big * 17) | 0;
    var x = (h ^ (h >>> 16)) & 0x7fffffff;
    return x;
  }

  /**
   * 自动排班。
   * request: {startWeek, endWeek, perSlot, avoidSameDay, avoidSameWeek,
   *           sections, days, members, allowRepeat}
   */
  function generate(free, request) {
    if (!free || !free.members || !free.members.length) return [];
    var req = request || {};
    var start = Math.max(1, parseInt(req.startWeek, 10) || 1);
    var end = Math.max(start, parseInt(req.endWeek, 10) || start);
    var need = Math.max(1, Math.min(10, parseInt(req.perSlot, 10) || 1));
    var freeDays = (free.days && free.days.length) ? free.days.slice() : [1, 2, 3, 4, 5];
    var days = (req.days && req.days.length)
      ? req.days.filter(function (d) { return d >= 1 && d <= 7; }).sort(function (a, b) { return a - b; })
      : freeDays;
    if (!days.length) days = freeDays;
    var sections = (req.sections && req.sections.length)
      ? req.sections.filter(function (s) { return s >= 1 && s <= BIG_COUNT; }).sort()
      : [1, 2, 3, 4, 5];
    if (!sections.length) sections = [1, 2, 3, 4, 5];
    var memberSet = (req.members && req.members.length) ? req.members.slice() : null;
    var allowRepeat = !!req.allowRepeat;
    var anyAvoid = !!(req.avoidSameDay || req.avoidSameWeek);

    function eligible(day, big, week) {
      var names = freeNames(free, day, big, week);
      if (!memberSet) return names;
      return names.filter(function (n) { return memberSet.indexOf(n) >= 0; });
    }

    var slots = [];
    for (var w = start; w <= end; w++) {
      days.forEach(function (day) {
        sections.forEach(function (big) {
          slots.push({ week: w, day: day, big: big, eligible: eligible(day, big, w) });
        });
      });
    }
    slots.sort(function (a, b) {
      if (a.eligible.length !== b.eligible.length) return a.eligible.length - b.eligible.length;
      if (a.week !== b.week) return a.week - b.week;
      if (a.day !== b.day) return a.day - b.day;
      return a.big - b.big;
    });

    var total = {};
    (req.existing || []).forEach(function (shift) {
      (shift.names || []).forEach(function (name) { total[name] = (total[name] || 0) + 1; });
    });
    var perDay = {};
    var perWeek = {};
    var result = [];
    // 每周每人最多几班（本周时段数 / 参与人数，向上取整）
    var weeklySlots = days.length * sections.length * need;
    var peopleCount = memberSet ? memberSet.length : free.members.length;
    var weeklyCap = peopleCount > 0 ? Math.max(1, Math.ceil(weeklySlots / peopleCount)) : 1;

    slots.forEach(function (slot) {
      if (!slot.eligible.length) {
        result.push({ week: slot.week, day: slot.day, bigSection: slot.big, names: [] });
        return;
      }
      var dayKey = slot.week + '-' + slot.day;
      var dayCounts = perDay[dayKey] || (perDay[dayKey] = {});
      var weekCounts = perWeek[slot.week] || (perWeek[slot.week] = {});
      var picked = [];
      // 优先级：① 本周还没到上限（上限=本周时段数/参与人数） ② 总次数最少（跨周公平，
      // 不会因为上周排多了这周还优先被排） ③ 本周次数最少 ④ 同天约束 ⑤ 打散
      var ranked = slot.eligible.slice().sort(function (a, b) {
        var overA = (weekCounts[a] || 0) >= weeklyCap ? 1 : 0;
        var overB = (weekCounts[b] || 0) >= weeklyCap ? 1 : 0;
        if (overA !== overB) return overA - overB;
        var ca = total[a] || 0;
        var cb = total[b] || 0;
        if (ca !== cb) return ca - cb;
        var wa = weekCounts[a] || 0;
        var wb = weekCounts[b] || 0;
        if (wa !== wb) return wa - wb;
        if (req.avoidSameDay) {
          var da = dayCounts[a] || 0;
          var db = dayCounts[b] || 0;
          if (da !== db) return da - db;
        }
        return tieRank(a, slot.week, slot.day, slot.big) - tieRank(b, slot.week, slot.day, slot.big);
      });
      for (var i = 0; i < ranked.length && picked.length < need; i++) {
        var name = ranked[i];
        if (req.avoidSameDay && (dayCounts[name] || 0) > 0) continue;
        if (req.avoidSameWeek && (weekCounts[name] || 0) > 0) continue;
        picked.push(name);
      }
      if (allowRepeat && anyAvoid && picked.length < need) {
        for (var j = 0; j < ranked.length && picked.length < need; j++) {
          if (picked.indexOf(ranked[j]) >= 0) continue;
          picked.push(ranked[j]);
        }
      }
      picked.forEach(function (name) {
        total[name] = (total[name] || 0) + 1;
        dayCounts[name] = (dayCounts[name] || 0) + 1;
        weekCounts[name] = (weekCounts[name] || 0) + 1;
      });
      result.push({ week: slot.week, day: slot.day, bigSection: slot.big, names: picked.sort() });
    });

    return result.sort(function (a, b) {
      if (a.week !== b.week) return a.week - b.week;
      if (a.day !== b.day) return a.day - b.day;
      return a.bigSection - b.bigSection;
    });
  }

  function weekShifts(roster, week) {
    return (roster || []).filter(function (s) { return s.week === week; })
      .sort(function (a, b) { return a.day !== b.day ? a.day - b.day : a.bigSection - b.bigSection; });
  }

  function countByPerson(shifts) {
    var counts = {};
    (shifts || []).forEach(function (s) {
      (s.names || []).forEach(function (n) { counts[n] = (counts[n] || 0) + 1; });
    });
    return counts;
  }

  /** 值班时间显示成样本那种「8：00-9：50」（全角冒号、12 小时制） */
  function dutyTimeLabel(value) {
    var text = String(value || '').trim();
    if (!text) return '';
    var m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(text);
    if (!m) return text;
    function fmt(hour) {
      var h = parseInt(hour, 10) % 24;
      var h12 = h % 12;
      if (h12 === 0) h12 = 12;
      return h12;
    }
    return fmt(m[1]) + '：' + m[2] + '-' + fmt(m[3]) + '：' + m[4];
  }

  /**
   * 仿照「新媒体第13周j14值班表」的导出结构：
   * 每周一张表（时间 × 星期）+ 一张「值班次数统计」（序号. 姓名 / 次数）。
   * 返回 {fileName, sheets:[{name, rows}]}
   */
  function buildRosterWorkbook(shifts, startWeek, endWeek, days, sections, slotTimes, members, adjust) {
    var start = Math.max(1, startWeek || 1);
    var end = Math.max(start, endWeek || start);
    var dayList = (days && days.length) ? days.slice().sort(function (a, b) { return a - b; }) : [1, 2, 3, 4, 5];
    var sectionList = (sections && sections.length)
      ? sections.slice().sort(function (a, b) { return a - b; })
      : [1, 2, 3, 4, 5];
    var byWeek = {};
    (shifts || []).forEach(function (s) {
      (byWeek[s.week] || (byWeek[s.week] = {}))[s.day + '-' + s.bigSection] = s;
    });
    var sheets = [];
    for (var w = start; w <= end; w++) {
      var rows = [];
      var header = ['时间'];
      dayList.forEach(function (day) { header.push(WEEKDAY_LONG[day - 1]); });
      rows.push(header);
      sectionList.forEach(function (big) {
        var row = [dutyTimeLabel(slotTimes ? slotTimes[big - 1] : '')];
        dayList.forEach(function (day) {
          var slot = byWeek[w] ? byWeek[w][day + '-' + big] : null;
          row.push(slot && slot.names && slot.names.length ? slot.names.join('、') : '');
        });
        rows.push(row);
      });
      sheets.push({ name: '第' + w + '周值班表', rows: rows });
    }
    // 次数统计（按空课表成员顺序，序号 + 姓名 / 次数）
    var counts = {};
    (shifts || []).forEach(function (s) {
      if (s.week < start || s.week > end) return;
      (s.names || []).forEach(function (n) { counts[n] = (counts[n] || 0) + 1; });
    });
    var list = (members && members.length ? members.slice() : Object.keys(counts));
    var statRows = [['序号. 姓名', '', '次数']];
    list.forEach(function (name, index) {
      var total = (counts[name] || 0) + ((adjust && adjust[name]) || 0);
      statRows.push([(index + 1) + '. ' + name, '', total]);
    });
    sheets.push({ name: '值班次数统计', rows: statRows });
    var fileName = start === end ? ('第' + start + '周值班表.xlsx') : ('第' + start + '-' + end + '周值班表.xlsx');
    return { fileName: fileName, sheets: sheets };
  }

  function rosterText(shifts, startWeek, endWeek, days, sections, slotTimes) {
    var start = Math.max(1, startWeek || 1);
    var end = Math.max(start, endWeek || start);
    var dayList = (days && days.length) ? days : [1, 2, 3, 4, 5];
    var sectionList = (sections && sections.length) ? sections : [1, 2, 3, 4, 5];
    var byWeek = {};
    (shifts || []).forEach(function (s) {
      (byWeek[s.week] || (byWeek[s.week] = {}))[s.day + '-' + s.bigSection] = s;
    });
    var lines = [];
    for (var w = start; w <= end; w++) {
      if (w > start) lines.push('');
      lines.push('第 ' + w + ' 周值班表');
      dayList.forEach(function (day) {
        sectionList.forEach(function (big) {
          var key = day + '-' + big;
          var slot = byWeek[w] ? byWeek[w][key] : null;
          var names = slot && slot.names && slot.names.length ? slot.names.join('、') : '—';
          var time = (slotTimes && slotTimes[big - 1]) ? ' ' + slotTimes[big - 1] : '';
          lines.push(WEEKDAY_LONG[day - 1] + ' ' + BIG_SHORT[big - 1] + '节' + time + '：' + names);
        });
      });
    }
    return lines.join('\n');
  }

  // ---------- 日期 / 周次 ----------

  var EXACT_TERM_STARTS = {
    '2026-2027-1': '2026-08-31',
    '2025-2026-1': '2025-09-01',
    '2025-2026-2': '2026-02-23',
    '2024-2025-2': '2025-02-24'
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function parseDate(str) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || '').trim());
    if (!m) return null;
    return new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)));
  }

  function formatDate(d) {
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  /** 本地今天，形如 2026-11-27 */
  function todayString() {
    var now = new Date();
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }

  function addDays(d, days) {
    return new Date(d.getTime() + days * 86400000);
  }

  function mondayOf(d) {
    var day = d.getUTCDay(); // 0=周日
    var offset = day === 0 ? 6 : day - 1;
    return addDays(d, -offset);
  }

  function todayUTC() {
    var now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  }

  function termStart(term) {
    var key = String(term || '').trim();
    if (!key) return null;
    if (EXACT_TERM_STARTS[key]) return EXACT_TERM_STARTS[key];
    var m = /^(\d{4})-(\d{4})-([12])$/.exec(key);
    if (!m) return null;
    var year = parseInt(m[1], 10);
    var half = parseInt(m[3], 10);
    var anchor = half === 2 ? new Date(Date.UTC(year + 1, 1, 15)) : new Date(Date.UTC(year, 7, 25));
    var day = anchor.getUTCDay();
    var offset = day === 0 ? 6 : day - 1;
    if (offset === 0) return formatDate(anchor);
    return formatDate(addDays(anchor, 7 - offset));
  }

  function guessTerm(today) {
    var d = today || todayUTC();
    var y = d.getUTCFullYear();
    var m = d.getUTCMonth() + 1;
    if (m >= 8) return y + '-' + (y + 1) + '-1';
    if (m >= 2) return (y - 1) + '-' + y + '-2';
    return (y - 1) + '-' + y + '-1';
  }

  function weekFromStart(startDate, today) {
    var start = parseDate(startDate);
    if (!start) return 0;
    var now = today || todayUTC();
    var days = Math.floor((now.getTime() - start.getTime()) / 86400000);
    if (days < 0) return 1;
    return Math.floor(days / 7) + 1;
  }

  function autoWeek(prefs) {
    var term = (prefs && prefs.term) ? prefs.term : guessTerm();
    var start = (prefs && prefs.semesterStart) ? prefs.semesterStart : (termStart(term) || '');
    var week = weekFromStart(start);
    return week > 0 ? week : 1;
  }

  function currentWeek(prefs) {
    var manual = prefs && prefs.week ? parseInt(prefs.week, 10) : 0;
    if (manual > 0) return manual;
    return autoWeek(prefs);
  }

  function weekMonday(week, prefs) {
    var base = mondayOf(todayUTC());
    var diff = week - currentWeek(prefs);
    return addDays(base, diff * 7);
  }

  function formatMonthDay(d) {
    return pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function formatTime(millis) {
    if (!millis) return '未知时间';
    var d = new Date(millis);
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // ---------- 默认配置 ----------

  function defaultConfig() {
    return {
      perSlot: 1,
      avoidSameDay: false,
      avoidSameWeek: false,
      allowRepeat: false,
      sections: [1, 2, 3, 4, 5],
      days: [],
      members: [],
      slotTimes: DEFAULT_SLOT_TIMES.slice(),
      adjust: {}
    };
  }

  return {
    BIG_COUNT: BIG_COUNT,
    BIG_LABELS: BIG_LABELS,
    BIG_SHORT: BIG_SHORT,
    WEEKDAY_LONG: WEEKDAY_LONG,
    WEEKDAY_SHORT: WEEKDAY_SHORT,
    DEFAULT_SLOT_TIMES: DEFAULT_SLOT_TIMES,
    DEFAULT_MAX_WEEK: DEFAULT_MAX_WEEK,
    defaultConfig: defaultConfig,
    normalizeDigits: normalizeDigits,
    parseWeekSpec: parseWeekSpec,
    parseMemberLine: parseMemberLine,
    parseCellMembers: parseCellMembers,
    parseFreeTable: parseFreeTable,
    parseWeekText: parseWeekText,
    parseTimetable: parseTimetable,
    roomCompact: roomCompact,
    weekdayOf: weekdayOf,
    bigSectionOf: bigSectionOf,
    courseActiveIn: courseActiveIn,
    freeNames: freeNames,
    generate: generate,
    weekShifts: weekShifts,
    countByPerson: countByPerson,
    rosterText: rosterText,
    dutyTimeLabel: dutyTimeLabel,
    buildRosterWorkbook: buildRosterWorkbook,
    termStart: termStart,
    guessTerm: guessTerm,
    weekFromStart: weekFromStart,
    autoWeek: autoWeek,
    currentWeek: currentWeek,
    weekMonday: weekMonday,
    formatMonthDay: formatMonthDay,
    formatDate: formatDate,
    todayString: todayString,
    formatTime: formatTime,
    addDays: addDays,
    parseDate: parseDate
  };
});
