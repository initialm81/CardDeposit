/* 문자 파싱 · 영업일 · 입금 계산 (화면과 분리된 순수 로직) */
(function (root) {
  'use strict';

  // 영세·중소가맹점 우대수수료율(신용카드 기준, 2025.2.14~ 적용, 금융위원회)
  // lag = 매출일(승인일)로부터 입금까지 영업일 수
  var TIERS = {
    t3:      { label: '연매출 3억 이하 (영세)',   rate: 0.40, lag: 2 },
    t3_5:    { label: '연매출 3~5억 (중소)',      rate: 1.00, lag: 2 },
    t5_10:   { label: '연매출 5~10억 (중소)',     rate: 1.15, lag: 2 },
    t10_30:  { label: '연매출 10~30억 (중소)',    rate: 1.45, lag: 2 },
    general: { label: '연매출 30억 초과 (일반)',  rate: 2.20, lag: 3 }
  };

  var CARDS = ['신한', '삼성', '현대', '국민', '롯데', '비씨', '농협', '하나', '우리'];
  var ALIAS = {
    'KB': '국민', 'KB국민': '국민', '케이비': '국민', '국민카드': '국민',
    'NH': '농협', 'NH농협': '농협', '농협카드': '농협',
    'BC': '비씨', '비씨카드': '비씨', 'BC카드': '비씨',
    '신한카드': '신한', '삼성카드': '삼성', '현대카드': '현대', '롯데카드': '롯데',
    '하나카드': '하나', '하나SK': '하나', '외환': '하나', '우리카드': '우리'
  };

  // 공휴일(대체공휴일 포함) + 금융기관이 쉬는 노동절
  var HOLIDAYS = [
    '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-01', '2026-03-02',
    '2026-05-01', '2026-05-05', '2026-05-24', '2026-05-25', '2026-06-03', '2026-06-06',
    '2026-07-17', '2026-08-15', '2026-08-17', '2026-09-24', '2026-09-25', '2026-09-26',
    '2026-10-03', '2026-10-05', '2026-10-09', '2026-12-25',
    '2027-01-01', '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09', '2027-03-01',
    '2027-05-01', '2027-05-03', '2027-05-05', '2027-05-13', '2027-06-06', '2027-07-17',
    '2027-07-19', '2027-08-15', '2027-08-16', '2027-09-14', '2027-09-15', '2027-09-16',
    '2027-10-03', '2027-10-04', '2027-10-09', '2027-10-11', '2027-12-25', '2027-12-27'
  ];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function toUTC(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function fromUTC(dt) { return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); }
  function addDays(s, n) { var d = toUTC(s); d.setUTCDate(d.getUTCDate() + n); return fromUTC(d); }
  function dow(s) { return toUTC(s).getUTCDay(); }
  function todayStr(now) { now = now || new Date(); return ymd(now.getFullYear(), now.getMonth() + 1, now.getDate()); }

  function holidaySet(settings) {
    var set = {};
    HOLIDAYS.forEach(function (h) { set[h] = 1; });
    ((settings && settings.extraHolidays) || []).forEach(function (h) { set[h] = 1; });
    return set;
  }
  function isBiz(s, hs) { var w = dow(s); return w !== 0 && w !== 6 && !hs[s]; }
  // s 다음날부터 세어 n번째 영업일
  function addBiz(s, n, hs) {
    var d = s, left = n, guard = 0;
    while (left > 0 && guard++ < 400) { d = addDays(d, 1); if (isBiz(d, hs)) left--; }
    return d;
  }

  function num(s) { return parseInt(String(s).replace(/[^0-9]/g, ''), 10) || 0; }
  function cardName(raw) {
    var n = raw.replace(/\s+/g, '');
    return ALIAS[n] || ALIAS[n.toUpperCase()] || n.replace(/카드$/, '') || n;
  }

  // 문자 1통 → { date, merchant, cards:{카드:금액}, apprCnt, apprAmt, cnclCnt, cnclAmt } 또는 null
  function parseReport(body) {
    if (!body) return null;
    var t = String(body).replace(/\r/g, '');
    var dm = t.match(/집계일\s*[:：]?\s*(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (!dm) return null;
    var start = t.search(/카드\s*승인/);
    if (start < 0) return null;
    var rest = t.slice(start);
    var end = rest.search(/현금영수증/);
    var sec = end > 0 ? rest.slice(0, end) : rest;

    var r = { date: ymd(+dm[1], +dm[2], +dm[3]), merchant: '', cards: {}, apprCnt: 0, apprAmt: 0, cnclCnt: 0, cnclAmt: 0 };
    var mm = t.match(/통한\s*([^\n]+?)\s*승인/);
    if (mm) r.merchant = mm[1].trim();
    var a = sec.match(/승인\s*[:：]\s*([\d,]+)\s*건\s*,?\s*(-?[\d,]+)\s*원/);
    if (a) { r.apprCnt = num(a[1]); r.apprAmt = num(a[2]); }
    var c = sec.match(/취소\s*[:：]\s*([\d,]+)\s*건\s*,?\s*(-?[\d,]+)\s*원/);
    if (c) { r.cnclCnt = num(c[1]); r.cnclAmt = num(c[2]); }

    var re = /^[ \t]*([+\-−－])[ \t]*([^\d\n+\-−－]+?)[ \t]*(-?[\d,]+)[ \t]*원/gm, m;
    while ((m = re.exec(sec))) {
      var sign = m[1] === '+' ? 1 : -1;
      if (m[3].charAt(0) === '-') sign = -sign;
      var name = cardName(m[2]);
      r.cards[name] = (r.cards[name] || 0) + sign * num(m[3]);
    }
    return r;
  }

  // 여러 통이 이어 붙은 텍스트도 처리
  function parseMany(text) {
    var parts = String(text || '').split(/(?=\[Web발신\])/), out = [];
    if (parts.length < 2) parts = String(text || '').split(/(?=\[일별)/);
    parts.forEach(function (p) { var r = parseReport(p); if (r) out.push(r); });
    return out;
  }

  function cardSum(r) { var s = 0; for (var k in r.cards) s += r.cards[k]; return s; }

  function effective(settings, card) {
    var tier = TIERS[settings.tier] || TIERS.t5_10;
    var o = (settings.cards && settings.cards[card]) || {};
    var baseRate = settings.tier === 'general' && settings.generalRate != null && settings.generalRate !== ''
      ? +settings.generalRate : tier.rate;
    return {
      rate: o.rate != null && o.rate !== '' && !isNaN(+o.rate) ? +o.rate : baseRate,
      lag: o.lag != null && o.lag !== '' && !isNaN(+o.lag) ? Math.max(0, Math.round(+o.lag)) : tier.lag
    };
  }

  // reports: {매출일: report} → {입금일: [{card, saleDate, gross, fee, net, rate}]}
  function computeDeposits(reports, settings) {
    var hs = holidaySet(settings), out = {};
    Object.keys(reports).sort().forEach(function (sd) {
      var r = reports[sd];
      Object.keys(r.cards).forEach(function (card) {
        var gross = r.cards[card];
        if (!gross) return;
        var e = effective(settings, card);
        var fee = Math.round(gross * e.rate / 100);
        var dep = e.lag === 0 ? sd : addBiz(sd, e.lag, hs);
        (out[dep] = out[dep] || []).push({ card: card, saleDate: sd, gross: gross, fee: fee, net: gross - fee, rate: e.rate });
      });
    });
    return out;
  }

  function totals(items) {
    var t = { gross: 0, fee: 0, net: 0 };
    (items || []).forEach(function (i) { t.gross += i.gross; t.fee += i.fee; t.net += i.net; });
    return t;
  }

  // 기본 입금주기 기준으로, target일에 입금될 매출일 목록
  function saleDatesFor(target, settings) {
    var hs = holidaySet(settings), lag = effective(settings, '').lag, out = [];
    for (var i = 0; i <= 20; i++) {
      var sd = addDays(target, -i);
      if ((lag === 0 ? sd : addBiz(sd, lag, hs)) === target) out.push(sd);
    }
    return out.sort();
  }

  var api = {
    TIERS: TIERS, CARDS: CARDS, HOLIDAYS: HOLIDAYS, ymd: ymd, addDays: addDays, dow: dow, todayStr: todayStr,
    holidaySet: holidaySet, isBiz: isBiz, addBiz: addBiz, parseReport: parseReport, parseMany: parseMany,
    cardSum: cardSum, effective: effective, computeDeposits: computeDeposits, totals: totals, saleDatesFor: saleDatesFor
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Logic = api;
})(typeof window !== 'undefined' ? window : globalThis);
