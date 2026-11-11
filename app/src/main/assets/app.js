/* 화면 */
(function () {
  'use strict';
  var L = window.Logic, A = window.Android || null;
  var WD = ['일', '월', '화', '수', '목', '금', '토'];

  function load(key, def) {
    try {
      var s = A ? A.load(key) : localStorage.getItem('cd_' + key);
      return s ? JSON.parse(s) : def;
    } catch (e) { return def; }
  }
  function save(key, val) {
    try {
      var s = JSON.stringify(val);
      if (A) A.save(key, s); else localStorage.setItem('cd_' + key, s);
    } catch (e) { }
  }

  var DEF = { tier: 't5_10', generalRate: 2.2, cards: {}, extraHolidays: [], sender: '1599-8898', days: 10, tierChosen: false };
  var S = {
    settings: Object.assign({}, DEF, load('settings', {})),
    reports: load('reports', {}),
    tab: 'today', ym: L.todayStr().slice(0, 7), sel: null,
    status: '', perm: true, lastScan: load('lastScan', null)
  };

  function won(n) { return (n < 0 ? '-' : '') + Math.abs(Math.round(n)).toLocaleString('ko-KR'); }
  function compact(n) { return Math.abs(n) >= 10000000 ? Math.round(n / 10000).toLocaleString('ko-KR') + '만' : won(n); }
  function md(s) { var p = s.split('-'); return (+p[1]) + '/' + (+p[2]) + '(' + WD[L.dow(s)] + ')'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function $(id) { return document.getElementById(id); }

  /* ---------- 문자 읽기 ---------- */
  function merge(list, msgTime) {
    var n = 0;
    list.forEach(function (r) {
      var old = S.reports[r.date];
      if (old && old.msgTime && msgTime && old.msgTime > msgTime) return;
      r.msgTime = msgTime || (old && old.msgTime) || 0;
      S.reports[r.date] = r; n++;
    });
    return n;
  }
  function scan(silent) {
    if (!A) { S.status = '미리보기 모드 (문자 읽기는 앱에서만 동작)'; render(); return; }
    S.perm = A.hasPermission();
    if (!S.perm) { render(); return; }
    var raw;
    try { raw = JSON.parse(A.readSms(S.settings.sender, +S.settings.days || 10)); } catch (e) { raw = { error: String(e) }; }
    if (raw.error) { S.status = '문자 읽기 오류: ' + raw.error; render(); return; }
    var found = 0;
    raw.forEach(function (m) { found += merge(L.parseMany(m.body), m.date); });
    save('reports', S.reports);
    S.lastScan = { at: Date.now(), msgs: raw.length, reports: found };
    save('lastScan', S.lastScan);
    S.status = '';
    render();
  }
  window.onPermission = function (ok) { S.perm = ok; if (ok) scan(); else render(); };
  window.onAppResume = function () { if (A && A.hasPermission()) scan(true); };

  /* ---------- 오늘 ---------- */
  function depositTable(items, showSale) {
    var t = L.totals(items), by = {};
    items.forEach(function (i) {
      var k = i.card;
      by[k] = by[k] || { card: k, gross: 0, fee: 0, net: 0, rate: i.rate, dates: [] };
      by[k].gross += i.gross; by[k].fee += i.fee; by[k].net += i.net;
      if (by[k].dates.indexOf(i.saleDate) < 0) by[k].dates.push(i.saleDate);
    });
    var rows = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.net - a.net; });
    return '<table><thead><tr><th>카드</th><th>매출</th><th>수수료</th><th>입금액</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + esc(r.card) + (showSale ? '<small>' + r.dates.map(md).join(', ') + ' 매출</small>' : '') + '</td><td>' + won(r.gross) +
          '</td><td class="fee">-' + won(r.fee) + '<small>' + r.rate + '%</small></td><td><b>' + won(r.net) + '</b></td></tr>';
      }).join('') +
      '</tbody><tfoot><tr><td>합계</td><td>' + won(t.gross) + '</td><td class="fee">-' + won(t.fee) + '</td><td>' + won(t.net) + '</td></tr></tfoot></table>';
  }

  function viewToday() {
    var today = L.todayStr(), dep = L.computeDeposits(S.reports, S.settings);
    var items = dep[today] || [], t = L.totals(items), h = '';

    if (A && !S.perm) {
      h += '<div class="card warn"><b>문자 읽기 권한이 필요합니다.</b><br>' + esc(S.settings.sender) +
        ' 번호의 리포트 문자만 읽고, 기기 밖으로 보내지 않습니다.<br><br>' +
        '<button class="btn" data-act="perm">권한 허용</button> <button class="btn ghost" data-act="appset">앱 설정 열기</button>' +
        '<p class="note">허용 버튼이 비활성(회색)이면: 앱 설정 열기 → 우측 상단 ⋮ → "제한된 설정 허용" 후 다시 시도하세요.</p></div>';
    }
    if (S.status) h += '<div class="card warn">' + esc(S.status) + '</div>';
    if (!S.settings.tierChosen) {
      h += '<div class="card warn">수수료율이 <b>' + L.TIERS[S.settings.tier].label + '</b> 기준으로 임시 적용돼 있습니다. ' +
        '<a href="#" data-tab="set" style="color:inherit;font-weight:700">설정</a>에서 병원 매출구간을 선택해 주세요.</div>';
    }

    h += '<div class="card hero"><h2>오늘 입금 예정 · ' + md(today) + '</h2><div class="big">' + won(t.net) + '<span>원</span></div>';
    if (items.length) h += '<p>매출 ' + won(t.gross) + '원 − 수수료 ' + won(t.fee) + '원</p>';
    else if (!L.isBiz(today, L.holidaySet(S.settings))) h += '<p>오늘은 휴일이라 카드사 입금이 없습니다.</p>';
    else h += '<p>오늘 입금될 매출 내역이 없습니다.</p>';
    h += '</div>';

    var need = L.saleDatesFor(today, S.settings).filter(function (d) { return !S.reports[d]; });
    if (need.length && L.isBiz(today, L.holidaySet(S.settings))) {
      h += '<div class="card warn">' + need.map(md).join(', ') + ' 매출 리포트 문자를 찾지 못했습니다. 해당일 매출은 오늘 입금액에 빠져 있습니다.</div>';
    }
    if (items.length) h += '<div class="card"><h2>카드별 입금액</h2>' + depositTable(items, true) + '</div>';

    var up = Object.keys(dep).filter(function (d) { return d > today; }).sort();
    if (up.length) {
      h += '<div class="card"><h2>다음 입금 예정</h2>' + up.map(function (d) {
        var tt = L.totals(dep[d]);
        return '<div class="row"><span>' + md(d) + ' <span class="muted">' + dep[d].map(function (i) { return i.card; }).filter(function (c, i, a) { return a.indexOf(c) === i; }).join('·') + '</span></span><b>' + won(tt.net) + '원</b></div>';
      }).join('') + '</div>';
    }

    var dates = Object.keys(S.reports).sort().reverse().slice(0, 12);
    h += '<div class="card"><h2>읽은 리포트 (매출일 기준)</h2>';
    if (!dates.length) h += '<p class="muted">아직 읽은 리포트가 없습니다. 상단의 ↻ 문자 확인을 눌러 주세요.</p>';
    h += dates.map(function (d) {
      var r = S.reports[d], sum = L.cardSum(r);
      var bad = r.apprAmt && sum !== r.apprAmt && sum !== r.apprAmt - r.cnclAmt;
      return '<div class="row"><span>' + md(d) + ' <span class="muted">승인 ' + r.apprCnt + '건' + (r.cnclCnt ? ' · 취소 ' + r.cnclCnt + '건' : '') + (bad ? ' · ⚠ 카드합계 불일치' : '') + '</span></span><b>' + won(sum) + '원</b></div>';
    }).join('');
    if (S.lastScan) {
      var dt = new Date(S.lastScan.at);
      h += '<p class="note">마지막 확인 ' + (dt.getMonth() + 1) + '/' + dt.getDate() + ' ' + dt.getHours() + ':' + (dt.getMinutes() < 10 ? '0' : '') + dt.getMinutes() +
        ' · 최근 ' + (+S.settings.days || 10) + '일 문자 ' + S.lastScan.msgs + '통 중 리포트 ' + S.lastScan.reports + '건</p>';
    }
    h += '</div><p class="note" style="text-align:center">입금액은 설정한 수수료율·입금주기로 계산한 예상치입니다.</p>';
    return h;
  }

  /* ---------- 캘린더 ---------- */
  function viewCal() {
    var dep = L.computeDeposits(S.reports, S.settings), hs = L.holidaySet(S.settings), today = L.todayStr();
    var y = +S.ym.slice(0, 4), m = +S.ym.slice(5, 7);
    var first = L.ymd(y, m, 1), lead = L.dow(first), days = new Date(y, m, 0).getDate();
    var mt = { gross: 0, fee: 0, net: 0 }, byCard = {}, sales = 0;
    var cells = '';
    WD.forEach(function (w) { cells += '<div class="h">' + w + '</div>'; });
    for (var i = 0; i < lead; i++) cells += '<div class="d x"></div>';
    for (var d = 1; d <= days; d++) {
      var ds = L.ymd(y, m, d), items = dep[ds] || [], t = L.totals(items), w = L.dow(ds);
      mt.gross += t.gross; mt.fee += t.fee; mt.net += t.net;
      items.forEach(function (it) {
        var b = byCard[it.card] = byCard[it.card] || { card: it.card, gross: 0, fee: 0, net: 0 };
        b.gross += it.gross; b.fee += it.fee; b.net += it.net;
      });
      var sale = S.reports[ds] ? L.cardSum(S.reports[ds]) : null;
      if (sale) sales += sale;
      var cls = 'd' + (w === 0 || hs[ds] ? ' off' : w === 6 ? ' sat' : '') + (ds === today ? ' today' : '') + (ds === S.sel ? ' sel' : '');
      cells += '<div class="' + cls + '" data-day="' + ds + '"><em>' + d + '</em>' + (items.length ? '<b>' + compact(t.net) + '</b>' : '') +
        (sale != null ? '<s>' + compact(sale) + '</s>' : '') + '</div>';
    }
    var h = '<div class="card"><div class="mnav"><button data-act="prev">‹</button><b>' + y + '년 ' + m + '월</b><button data-act="next">›</button></div>' +
      '<div class="sum3"><div><small>입금 합계</small><b>' + won(mt.net) + '</b></div><div><small>수수료</small><b>' + won(mt.fee) + '</b></div><div><small>카드 매출</small><b>' + won(sales) + '</b></div></div>' +
      '<div class="cal">' + cells + '</div><p class="note">날짜 칸의 <b style="color:var(--brand)">초록 숫자</b>는 그날 입금 예정액, 회색은 그날 카드 매출입니다. 날짜를 누르면 상세가 나옵니다.</p></div>';

    if (S.sel && S.sel.slice(0, 7) === S.ym) {
      var it2 = dep[S.sel] || [], r = S.reports[S.sel];
      h += '<div class="card"><h2>' + md(S.sel) + ' 입금</h2>' + (it2.length ? depositTable(it2, true) : '<p class="muted">입금 예정 내역이 없습니다.</p>') + '</div>';
      if (r) {
        h += '<div class="card"><h2>' + md(S.sel) + ' 카드 매출 (승인 ' + r.apprCnt + '건' + (r.cnclCnt ? ', 취소 ' + r.cnclCnt + '건' : '') + ')</h2>' +
          Object.keys(r.cards).map(function (c) {
            var e = L.effective(S.settings, c), on = e.lag === 0 ? S.sel : L.addBiz(S.sel, e.lag, hs);
            return '<div class="row"><span>' + esc(c) + ' <span class="muted">→ ' + md(on) + ' 입금</span></span><b>' + won(r.cards[c]) + '원</b></div>';
          }).join('') + '</div>';
      }
    }

    var rows = Object.keys(byCard).map(function (k) { return byCard[k]; }).sort(function (a, b) { return b.net - a.net; });
    h += '<div class="card"><h2>' + m + '월 카드별 입금 집계</h2>';
    if (!rows.length) h += '<p class="muted">이 달에는 입금 내역이 없습니다.</p>';
    else h += '<table><thead><tr><th>카드</th><th>매출</th><th>수수료</th><th>입금액</th></tr></thead><tbody>' + rows.map(function (r) {
      return '<tr><td>' + esc(r.card) + '</td><td>' + won(r.gross) + '</td><td class="fee">-' + won(r.fee) + '</td><td><b>' + won(r.net) + '</b></td></tr>';
    }).join('') + '</tbody><tfoot><tr><td>합계</td><td>' + won(mt.gross) + '</td><td class="fee">-' + won(mt.fee) + '</td><td>' + won(mt.net) + '</td></tr></tfoot></table>';
    h += '</div>';
    return h;
  }

  /* ---------- 설정 ---------- */
  function viewSet() {
    var st = S.settings, tier = L.TIERS[st.tier];
    var names = L.CARDS.slice();
    Object.keys(S.reports).forEach(function (d) { Object.keys(S.reports[d].cards).forEach(function (c) { if (names.indexOf(c) < 0) names.push(c); }); });
    var baseRate = st.tier === 'general' ? st.generalRate : tier.rate;

    var h = '<div class="card"><h2>가맹점 매출구간 (수수료율 기준)</h2><select id="tier">' +
      Object.keys(L.TIERS).map(function (k) {
        var t = L.TIERS[k];
        return '<option value="' + k + '"' + (k === st.tier ? ' selected' : '') + '>' + t.label + ' · ' + (k === 'general' ? '약 ' : '') + t.rate.toFixed(2) + '%</option>';
      }).join('') + '</select>';
    if (st.tier === 'general') h += '<label>일반가맹점 수수료율 (%) — 카드사와 개별 계약한 값</label><input id="grate" type="number" step="0.01" inputmode="decimal" value="' + esc(st.generalRate) + '">';
    h += '<p class="note">우대수수료율은 신용카드 기준입니다(체크카드는 더 낮음). 문자에는 신용·체크 구분이 없어 신용카드 요율로 계산합니다. ' +
      '실제 적용 요율은 여신금융협회 "카드매출조회"에서 카드사별로 확인할 수 있습니다.</p></div>';

    h += '<div class="card"><h2>카드사별 수수료율 · 입금주기</h2><table><thead><tr><th>카드</th><th>수수료 %</th><th>입금 (영업일)</th></tr></thead><tbody>' +
      names.map(function (c) {
        var o = st.cards[c] || {};
        return '<tr><td>' + esc(c) + '</td><td><input data-card="' + esc(c) + '" data-f="rate" type="number" step="0.01" inputmode="decimal" placeholder="' + baseRate + '" value="' + esc(o.rate == null ? '' : o.rate) + '"></td>' +
          '<td><input data-card="' + esc(c) + '" data-f="lag" type="number" step="1" inputmode="numeric" placeholder="' + tier.lag + '" value="' + esc(o.lag == null ? '' : o.lag) + '"></td></tr>';
      }).join('') + '</tbody></table>' +
      '<p class="note">비워 두면 기본값(회색 숫자)이 적용됩니다. 입금주기는 매출일 다음 날부터 센 영업일 수입니다. ' +
      '예: 2 → 월요일 매출이 수요일 입금, 금·토·일 매출이 화요일 입금. 실제 통장 입금일과 다르면 해당 카드만 고쳐 주세요.</p></div>';

    h += '<div class="card"><h2>문자</h2><label>발신 번호</label><input id="sender" value="' + esc(st.sender) + '" inputmode="tel">' +
      '<label>조회 기간 (일)</label><input id="days" type="number" inputmode="numeric" value="' + esc(st.days) + '">' +
      '<p class="note">앱을 열 때마다 최근 문자를 읽어 누적 저장합니다. 지난달 캘린더까지 채우려면 기간을 한 번 40 정도로 늘려 확인한 뒤 다시 줄이면 됩니다.</p>' +
      '<label>문자 직접 붙여넣기 (자동 읽기가 안 될 때)</label><textarea id="paste" placeholder="리포트 문자 전체를 붙여넣으세요"></textarea>' +
      '<div style="margin-top:8px"><button class="btn ghost" data-act="paste">붙여넣은 문자 반영</button></div></div>';

    h += '<div class="card"><h2>추가 휴일 (임시공휴일 등)</h2><div class="inline"><input id="hday" type="date"><button class="btn ghost" data-act="addh">추가</button></div>' +
      '<div class="chips">' + (st.extraHolidays.length ? st.extraHolidays.map(function (d) { return '<span data-act="delh" data-d="' + d + '">' + d + ' ✕</span>'; }).join('') : '<span class="muted" style="background:none;padding-left:0">2026~2027년 법정공휴일·대체공휴일은 이미 반영돼 있습니다.</span>') + '</div></div>';

    h += '<div class="card"><h2>데이터</h2><p class="muted" style="margin-top:0">저장된 리포트 ' + Object.keys(S.reports).length + '일치</p>' +
      '<button class="btn danger" data-act="reset">저장된 리포트 지우기</button> <span id="resetmsg" class="muted"></span></div>';
    return h;
  }

  /* ---------- 공통 ---------- */
  function render() {
    var v = S.tab === 'cal' ? viewCal() : S.tab === 'set' ? viewSet() : viewToday();
    $('view').innerHTML = v;
    var r = S.reports[Object.keys(S.reports).sort().pop()];
    $('sub').textContent = (r && r.merchant) || '';
    Array.prototype.forEach.call(document.querySelectorAll('nav button'), function (b) {
      b.className = b.getAttribute('data-tab') === S.tab ? 'on' : '';
    });
  }
  function saveSettings() { save('settings', S.settings); }

  var armed = false;
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-tab],[data-act],[data-day]');
    if (!el) return;
    var tab = el.getAttribute('data-tab'), act = el.getAttribute('data-act'), day = el.getAttribute('data-day');
    if (tab) { ev.preventDefault(); S.tab = tab; render(); window.scrollTo(0, 0); return; }
    if (day) { S.sel = S.sel === day ? null : day; render(); return; }
    if (act === 'scan') scan();
    else if (act === 'perm') A && A.requestPermission();
    else if (act === 'appset') A && A.openAppSettings();
    else if (act === 'prev' || act === 'next') {
      var y = +S.ym.slice(0, 4), m = +S.ym.slice(5, 7) + (act === 'next' ? 1 : -1);
      if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
      S.ym = y + '-' + (m < 10 ? '0' : '') + m; S.sel = null; render();
    } else if (act === 'paste') {
      var list = L.parseMany($('paste').value), n = merge(list, 0);
      save('reports', S.reports);
      S.status = n ? '' : '붙여넣은 내용에서 리포트를 찾지 못했습니다.';
      if (n) S.tab = 'today';
      render();
    } else if (act === 'addh') {
      var d = $('hday').value;
      if (d && S.settings.extraHolidays.indexOf(d) < 0) { S.settings.extraHolidays.push(d); S.settings.extraHolidays.sort(); saveSettings(); render(); }
    } else if (act === 'delh') {
      S.settings.extraHolidays = S.settings.extraHolidays.filter(function (x) { return x !== el.getAttribute('data-d'); });
      saveSettings(); render();
    } else if (act === 'reset') {
      if (!armed) { armed = true; el.textContent = '한 번 더 누르면 지워집니다'; return; }
      armed = false; S.reports = {}; S.lastScan = null; save('reports', {}); save('lastScan', null); render();
    }
  });

  document.addEventListener('change', function (ev) {
    var el = ev.target, st = S.settings;
    if (el.id === 'tier') { st.tier = el.value; st.tierChosen = true; saveSettings(); render(); }
    else if (el.id === 'grate') { st.generalRate = el.value === '' ? 2.2 : +el.value; saveSettings(); render(); }
    else if (el.id === 'sender') { st.sender = el.value.trim(); saveSettings(); }
    else if (el.id === 'days') { st.days = Math.min(365, Math.max(1, +el.value || 10)); saveSettings(); }
    else if (el.getAttribute('data-card')) {
      var c = el.getAttribute('data-card'), f = el.getAttribute('data-f');
      st.cards[c] = st.cards[c] || {};
      if (el.value === '') delete st.cards[c][f]; else st.cards[c][f] = +el.value;
      saveSettings();
    }
  });

  window.__state = S; window.__render = render;
  render();
  scan();
})();
