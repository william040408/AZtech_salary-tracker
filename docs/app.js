/* 급여·연차 기록부 — 동작
 *
 * 데이터는 두 갈래로 들어온다.
 *   · 개발 서버(src/dev.py)   #bundle 안에 박혀서 온다
 *   · 배포(GitHub Pages)      자리표시자만 오고, 금고에서 받아온다
 */
(function(){
"use strict";
// 아티팩트에서는 데이터가 페이지에 박혀 오고, 공개 호스팅에서는 원격에서 받아온다.
const RAW = document.getElementById("bundle").textContent.trim();
const EMBEDDED = RAW === "__" + "BUNDLE__" ? null : JSON.parse(RAW);
let B = null, ATT = null, PAY = null, api = null;
const WON = n => (n<0?"−":"") + Math.abs(Math.round(n)).toLocaleString("ko-KR");

// 분류 정의. base는 엑셀에서 유추한 값, 사용자가 고르면 override가 된다.
// 쉰 날은 '왜 쉬었나'와 '어떻게 처리됐나'가 따로 논다. 회사가 전체를 쉬게 한
// 날이어도 연차를 까기도, 무급이기도, 회사가 부담하기도 한다. 색은 처리 방식을
// 따르고(연차=초록, 무급=주황, 회사부담=남색) 이름이 사유를 적는다.
// label 은 선택창에 쓰는 이름, tag 는 달력 칸에 들어가는 짧은 이름이다.
// 칸이 좁아 세 글자를 넘으면 잘리므로 따로 둔다.
const KINDS = {
  work:      {label:"근무",     tag:"근무",     cls:"k-work",     desc:"정상 출근",              off:0},
  short:     {label:"지각",     tag:"지각",     cls:"k-short",    desc:"8시간 미만 근무",         off:0},
  holiday:   {label:"공휴일",   tag:null,   cls:"k-holiday",  desc:"법정 공휴일",             off:0},
  weekend:   {label:"주말",     tag:null,   cls:"k-weekend",  desc:"",                       off:0},

  personal:  {label:"연차",      tag:"연차", cls:"k-personal", desc:"유급 · 연차 1일 소모",     off:1},
  half:      {label:"반차",      tag:"반차", cls:"k-half",     desc:"유급 · 연차 0.5일 소모",   off:0.5},
  unpaid:    {label:"무급휴가",  tag:"무급휴가", cls:"k-unpaid",   desc:"연차가 없어 급여 차감",    off:1},

  coAnnual:  {label:"연차 소모", tag:"전사연차", cls:"k-personal", desc:"유급 · 연차 1일 소모",     off:1},
  coUnpaid:  {label:"무급",      tag:"전사무급", cls:"k-unpaid",   desc:"급여에서 차감",            off:1},
  company:   {label:"그냥 쉼",   tag:"전사휴무", cls:"k-company",  desc:"연차도 급여도 안 깎임",    off:1},
  substitute:{label:"대체휴무",  tag:"대체휴무", cls:"k-company",  desc:"휴일근로 보상 · 차감 없음", off:1},
  official:  {label:"공가",      tag:"공가", cls:"k-company",  desc:"병무청 교육 등 · 차감 없음", off:1},
};

// 그날의 공휴일 이름. 근태 기록에 붙은 것과 달력표를 함께 본다.
function holName(ds){
  return (ATT.get(ds) && ATT.get(ds).holiday) || (B.holidays && B.holidays[ds]) || null;
}

/* 시트에 묶어서 보여 줄 순서. 회사가 실제로 쓰는 갈래를 그대로 따른다. */
const GROUPS = [
  { title: "출근",             kinds: ["work", "short"] },
  { title: "내가 신청한 휴가",  kinds: ["personal", "half", "unpaid"] },
  { title: "회사가 지정한 휴가", kinds: ["coAnnual", "coUnpaid", "company"] },
  { title: "그 외",            kinds: ["substitute", "official"] },
];

// 엑셀이 준 기본 분류를 사용자 분류 체계로 옮긴다
const baseKind = a => a.kind === "personal_off" ? "personal"
                    : a.kind === "company_off" ? "company"
                    : a.kind;

let overrides = new Map();   // date -> kind
let dbRef = null;
let view = null;
let picked = null;

const $ = id => document.getElementById(id);
const monthOf = d => d.slice(0,7);

/* 엑셀은 초기 1회 수입으로 끝났다. 그 뒤의 날에는 기록이 없으므로
   달력만 보고 기본값을 정하고, 실제 성격은 직접 찍어 채운다. */
const TODAY = (() => { const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
})();

function defaultKind(ds){
  if (ds < B.firstWorkDay) return null;                 // 일하기 전
  const a = ATT.get(ds);
  if (a) return baseKind(a);
  if (B.holidays && B.holidays[ds]) return "holiday";   // 주말과 겹쳐도 이름을 보여준다
  const w = new Date(ds + "T00:00:00").getDay();
  if (w === 0 || w === 6) return "weekend";
  if (ds > TODAY) return "future";                      // 아직 오지 않은 날은 비워 둔다
  return "work";
}
const kindName = v => (v && typeof v === "object") ? v.k : v;
const kindOf = d => kindName(overrides.get(d)) || defaultKind(d);
const timesOf = d => {                       // 직접 적은 시각이 있으면 그것, 없으면 엑셀 기록
  const v = overrides.get(d);
  if (v && typeof v === "object" && v.s) return { s: v.s, e: v.e, mine: true };
  const a = ATT.get(d);
  return a && a.start ? { s: a.start, e: a.end, mine: false } : null;
};
const WORK_KINDS = new Set(["work", "short"]);

/** 점심(12~13시)과 겹치는 만큼만 빼고 실근무 시간을 센다. */
function hoursBetween(st, en){
  const to = t => { const [h, m] = t.split(":").map(Number); return h + m / 60; };
  let a = to(st), b = to(en);
  if (b < a) b += 24;
  const lunch = Math.max(0, Math.min(b, 13) - Math.max(a, 12));
  return Math.round((b - a - lunch) * 100) / 100;
}

/* 집계 대상 — 엑셀에서 들어온 날과 내가 직접 찍은 날 */
function trackedDates(){
  const set = new Set(overrides.keys());
  for (const a of B.attendance) set.add(a.date);
  return [...set].sort();
}

/* ── 복무 진행 ── */
function service(){
  // 이름은 소스에 적지 않는다. 저장소가 공개라 파일에 박으면 그대로 올라간다.
  if (B.person){
    const t = B.person + " 급여·연차 기록부";
    $("title").textContent = t;
    document.title = t;
  }
  $("org").textContent = "산업기능요원 · " + B.company + " " + B.team;
  $("svcRange").textContent = "복무 " + B.serviceStart.replace(/-/g,".") + " → " + B.serviceEnd.replace(/-/g,".");
  $("tRefSub").textContent = "월 " + (B.fullBase/B.hourly) + "시간 · 시급 " + WON(B.hourly) + "원";
  const s = new Date(B.serviceStart+"T00:00:00"), e = new Date(B.serviceEnd+"T00:00:00"), n = new Date();
  const total = (e-s)/864e5, done = Math.max(0, Math.min(total, (n-s)/864e5));
  const pct = done/total*100;
  $("svcBar").style.width = pct.toFixed(1)+"%";
  $("svcDone").textContent = "복무 " + Math.floor(done) + "일차";
  $("svcLeft").textContent = "남은 " + Math.ceil(total-done).toLocaleString("ko-KR") + "일";
  tickPct();
}

/* 복무율을 소수점 일곱 자리까지. 그 자리는 60밀리초마다 한 칸씩 올라간다. */
let pctTimer = null;
function tickPct(){
  const s = new Date(B.serviceStart+"T00:00:00").getTime(),
        e = new Date(B.serviceEnd+"T00:00:00").getTime();
  clearInterval(pctTimer);
  const paint = () => {
    const now = Date.now();
    const pct = Math.max(0, Math.min(100, (now - s) / (e - s) * 100));
    $("svcPct").textContent = pct.toFixed(7) + "%";
  };
  paint();
  pctTimer = setInterval(paint, 50);
}

/* ── 요약 타일 ── */
function tiles(){
  const nets = B.payslips.reduce((s,p)=>s+p.net, 0);
  $("tNet").textContent = WON(nets)+"원";
  $("tNetSub").textContent = B.payslips.length + "개월분 (" + B.payslips[0].period + "~" + B.payslips.at(-1).period + ")";
  $("tRef").textContent = WON(refNet())+"원";
  let d=0, h=0;
  for (const ds of trackedDates()){
    const k = kindOf(ds);
    if (KINDS[k]) { d += KINDS[k].off; if (k in DEDUCTS) h += 1; }
  }
  $("tOff").textContent = (Math.round(d*10)/10) + "일";
  $("tOffSub").textContent = h ? ("무급 " + h + "일 포함") : "전부 유급";
}
function refNet(){
  // 역산한 달(2월처럼 일할계산된 달)은 기준이 될 수 없다
  const p = B.payslips.find(p => !p.derived && !p.deductedHours && !p.leaveCashed);
  return p ? p.net : 0;
}

/* ── 달력 ── */
function drawCal(){
  const [y,m] = view.split("-").map(Number);
  $("mYear").textContent = y + "년";
  $("mMonth").textContent = m + "월";
  const first = new Date(y, m-1, 1), last = new Date(y, m, 0);
  const g = $("grid"); g.textContent = "";
  for (let i=0;i<first.getDay();i++){
    const c = document.createElement("div"); c.className = "cell pad"; g.appendChild(c);
  }
  for (let day=1; day<=last.getDate(); day++){
    const ds = y+"-"+String(m).padStart(2,"0")+"-"+String(day).padStart(2,"0");
    const k = kindOf(ds), K = KINDS[k];
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cell " + (K ? K.cls : "k-blank");
    b.dataset.date = ds;
    if (ds < B.firstWorkDay) b.disabled = true;
    if (ds === TODAY) b.classList.add("today");
    if (B.holidays && B.holidays[ds]) b.classList.add("hol");   // 출근했어도 빨간날임을 남긴다
    const w0 = new Date(ds + "T00:00:00").getDay();
    if (w0 === 0) b.classList.add("sun");
    const dd = document.createElement("span"); dd.className = "d"; dd.textContent = day;
    b.appendChild(dd);
    const pf = $("plFrom").value, pt = $("plTo").value;
    if (pf && (ds === pf || ds === pt)) b.classList.add("rend");
    if (pf && pt && ds >= pf && ds <= pt) b.classList.add("inrange");
    const hn = holName(ds);
    if (K && k !== "weekend" && k !== "holiday"){
      const t = document.createElement("span"); t.className = "t"; t.textContent = K.tag;
      b.appendChild(t);
    }
    if (hn){                       // 출근한 날이어도 무슨 날이었는지 남긴다
      const h = document.createElement("span"); h.className = "h"; h.textContent = hn;
      b.appendChild(h);
    }
    const a = ATT.get(ds);
    b.setAttribute("aria-label", ds + " " + (K?K.label:"기록 없음")
      + (hn ? " · " + hn : "") + (a&&a.start ? " "+a.start+"~"+a.end : ""));
    g.appendChild(b);
  }
  $("prev").disabled = view <= B.calendarFrom;
  $("next").disabled = view >= B.calendarTo;
}

/* ── 월별 대조 ── */
function drawMonths(){
  const box = $("months"); box.textContent = "";
  const months = [...new Set([].concat(
    B.payslips.map(pp => pp.period), trackedDates().map(monthOf)))].sort().reverse();
  const ref = refNet();
  for (const mo of months){
    const p = PAY.get(mo);
    const row = document.createElement("div"); row.className = "mrow";
    const top = document.createElement("div"); top.className = "mrow-top";
    const nm = document.createElement("b"); nm.textContent = mo.replace("-",".") + " 급여";
    top.appendChild(nm);
    if (p){
      const right = document.createElement("div");
      right.style.cssText = "display:flex;align-items:baseline;gap:9px";
      const d = p.net - ref;
      const badge = document.createElement("span");
      if (p.derived){
        badge.className = "delta eq";
        badge.textContent = p.workedDays ? p.workedDays + "일 근무" : "역산";
      } else {
        badge.className = "delta " + (d>0?"up":d<0?"dn":"eq");
        badge.textContent = d===0 ? "기준" : (d>0?"+":"−") + WON(Math.abs(d));
      }
      const net = document.createElement("span"); net.className = "net num";
      net.textContent = WON(p.net)+"원";
      right.append(badge, net); top.appendChild(right);
    } else {
      const s = document.createElement("span"); s.className = "pending";
      s.textContent = "명세서 미수령";
      top.appendChild(s);
    }
    row.appendChild(top);

    // 근태 집계
    let off = 0, unpaidDays = 0, half = 0;
    for (const ds of trackedDates()){
      if (monthOf(ds) !== mo) continue;
      const k = kindOf(ds);
      if (!KINDS[k]) continue;
      off += KINDS[k].off;
      if (k in DEDUCTS) unpaidDays += 1;
      if (k === "half") half += 1;
    }
    const why = document.createElement("div"); why.className = "mrow-why";
    const bits = [];
    if (p && p.derived) bits.push(p.note || "명세서가 만료돼 실수령액에서 역산");
    if (p && p.leaveCashed) bits.push("연차수당 +" + WON(p.leaveCashed*B.dayPay) + " (" + p.leaveCashed + "일분)");
    if (p && p.deductedHours) bits.push("기본급 −" + WON(p.deductedHours*B.hourly) + " (" + p.deductedHours + "시간)");
    if (off) bits.push("쉰 날 " + (Math.round(off*10)/10) + "일" + (half?" (반차 "+half+")":""));
    if (p && p.deductedHours && p.deductedHours % 4 !== 0)
      bits.push("차감이 4시간 단위가 아님 — 지각·조퇴가 반영된 것으로 보임");
    if (!bits.length) bits.push("만근, 변동 없음");
    for (const t of bits){ const s = document.createElement("span"); s.textContent = t; why.appendChild(s); }
    row.appendChild(why);

    if (p && !p.derived){
      // 내 기록상 무급 일수 vs 명세서 차감 시간
      const mine = deductHoursOf(mo);
      const ok = mine === p.deductedHours;
      if (mine || p.deductedHours){
        const c = document.createElement("div");
        c.className = "chk " + (ok ? "ok" : "bad");
        c.textContent = ok
          ? "✓ " + (mine/B.dailyHours) + "일치 차감, 명세서와 일치"
          : "⚠ 기록상 " + mine + "시간, 명세서 차감 " + p.deductedHours + "시간 — 달력에서 그 달을 확인해 주세요";
        row.appendChild(c);
      }
    }
    box.appendChild(row);
  }
}

/* ── 연차 원장 ──
   근로기준법 제60조 2항: 계속근로 1년 미만은 1개월 개근 시 1일, 최대 11일.
   무엇이 연차를 소모하는지는 달력에서 직접 분류한 값을 따른다. */
const CONSUMES = { personal:1, half:0.5, coAnnual:1,
                   unpaid:0, coUnpaid:0, company:0, substitute:0, official:0 };
// 급여에서 차감되는 분류 (명세서의 기본급 차감과 대조한다)
const DEDUCTS = { unpaid:1, coUnpaid:1 };   // 급여에서 깎이는 것

/* 그 달에 생긴 연차 일수 */
function accOf(mo){
  let n = 0;
  for (const d of accrualDates()) if (d.slice(0,7) === mo) n++;
  return n;
}
/* 그 달에 연차를 쓴 일수 (반차는 0.5) */
function useOf(mo){
  let u = 0;
  for (const ds of trackedDates())
    if (monthOf(ds) === mo){ const k = kindOf(ds); if (CONSUMES[k]) u += CONSUMES[k]; }
  return u;
}
/* 연차와 무관하게 무급으로 적어 둔 날 */
function flatUnpaidOf(mo){
  let n = 0;
  for (const ds of trackedDates())
    if (monthOf(ds) === mo && (kindOf(ds) in DEDUCTS)) n += 1;
  return n;
}
/* 그 달 발생분을 넘겨 쓴 일수 — 이미 수당으로 받아 둔 재고를 쓰는 것이라 급여에서 빠진다 */
function stockUseOf(mo){ return Math.max(0, useOf(mo) - accOf(mo)); }
/* 그 달 기본급에서 빠지는 시간 */
function deductHoursOf(mo){ return (flatUnpaidOf(mo) + stockUseOf(mo)) * B.dailyHours; }
/* 그 달에 현금으로 받을 연차수당 일수 */
function cashDaysOf(mo){ return Math.max(0, accOf(mo) - useOf(mo)); }

function accrualDates(){
  const [hy,hm,hd] = B.hireDate.split("-").map(Number);
  const today = new Date(); const out = [];
  for (let n=1; n<=11; n++){
    const d = new Date(hy, hm-1+n, hd);
    if (d > today) break;
    out.push(d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"));
  }
  return out;
}

/* 1년치 발생일 — 앞으로 생길 것까지 포함한다 */
function accrualDatesAll(){
  const [hy,hm,hd] = B.hireDate.split("-").map(Number), out = [];
  for (let k=1; k<=11; k++){
    const d = new Date(hy, hm-1+k, hd);
    out.push(d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"));
  }
  return out;
}

/* ── 연차 계획 ──
   구간 안의 평일에서 공휴일을 뺀 것이 실제로 쉬게 되는 날이다.
   달마다 그 달에 생기는 1일까지는 급여가 깎이지 않고, 그 위로는
   모아둔 연차에서 나간다. 모아둔 것마저 없으면 그때가 순손실이다. */
let planPick = 0;

function planWorkdays(from, to){
  const out = [], a = new Date(from+"T00:00:00"), b = new Date(to+"T00:00:00");
  for (const d = new Date(a); d <= b; d.setDate(d.getDate()+1)){
    const w = d.getDay(); if (w === 0 || w === 6) continue;
    const ds = d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
    if (B.holidays && B.holidays[ds]) continue;
    out.push(ds);
  }
  return out;
}

function drawPlan(){
  const out = $("plOut"); out.textContent = "";
  const from = $("plFrom").value, to = $("plTo").value;
  $("plHint").textContent = "모아둔 연차 " + (Math.round(curBal*10)/10) + "일";
  if (!from || !to || from > to){
    const e = document.createElement("div"); e.className = "pempty";
    e.textContent = planPick ? "달력에서 날짜를 눌러 주세요."
                             : "쉬려는 구간의 시작과 끝을 정해 주세요.";
    out.appendChild(e); return;
  }

  const days = planWorkdays(from, to);
  const span = Math.round((new Date(to+"T00:00:00") - new Date(from+"T00:00:00")) / 864e5) + 1;
  const byMonth = {};
  for (const ds of days) byMonth[monthOf(ds)] = (byMonth[monthOf(ds)] || 0) + 1;

  const accAll = accrualDatesAll();
  let freeDays = 0, cutDays = 0;
  for (const mo of Object.keys(byMonth)){
    const cnt = byMonth[mo];
    const a = accAll.filter(d => monthOf(d) === mo).length;   // 그 달에 생기는 연차
    freeDays += Math.min(cnt, a);
    cutDays  += Math.max(0, cnt - a);
  }
  // 계획이 시작되기 전까지 더 쌓이는 몫
  const grow = accAll.filter(d => d > TODAY && d < from).length;
  const stock = Math.max(0, curBal) + grow;
  const covered = Math.min(cutDays, stock);      // 이미 수당으로 받아 둔 몫
  const loss = Math.max(0, cutDays - covered);   // 받은 적 없이 깎이는 몫

  const box = document.createElement("div"); box.className = "psum";
  const hd = document.createElement("div"); hd.className = "ph";
  hd.textContent = from.replace(/-/g,".") + " ~ " + to.replace(/-/g,".") + " · " + span + "일간";
  box.appendChild(hd);
  const line = (label, val, cls) => {
    const d = document.createElement("div"); d.className = "pline" + (cls ? " " + cls : "");
    const a = document.createElement("span"); a.textContent = label;
    const b = document.createElement("b"); b.className = "num"; b.textContent = val;
    d.append(a, b); box.appendChild(d);
  };
  const skipped = span - days.length;
  line("실제로 쉬는 날", days.length + "일");
  if (skipped) line("주말·공휴일이라 뺀 날", skipped + "일", "sub");
  line("그 기간에 생기는 연차", "+" + freeDays + "일", "keep");
  line("그때까지 모아둘 연차", (Math.round(stock*10)/10) + "일", "keep");
  line("급여에서 빠지는 날", cutDays ? cutDays + "일  −" + WON(cutDays * B.dayPay) + "원" : "없음", cutDays ? "cut" : "keep");
  if (covered) line("이미 수당으로 받아 둔 몫", (Math.round(covered*10)/10) + "일  실손실 아님", "sub");
  line("실제 손해", loss ? "−" + WON(loss * B.dayPay) + "원" : "0원", loss ? "tot cut" : "tot keep");
  out.appendChild(box);

  const tip = document.createElement("div");
  const t = document.createElement("b"), body = document.createElement("span");
  if (!loss){
    tip.className = "ptip";
    t.textContent = "손해 없이 쉴 수 있습니다";
    body.textContent = cutDays
      ? "급여에서 " + WON(cutDays * B.dayPay) + "원이 빠지지만, 그만큼은 이미 연차수당으로 받아 둔 몫입니다."
      : "그 달에 생기는 연차로 전부 덮입니다.";
  } else {
    tip.className = "ptip warn";
    const d = new Date(from+"T00:00:00"); d.setMonth(d.getMonth() + Math.ceil(loss));
    t.textContent = WON(loss * B.dayPay) + "원을 손해 봅니다";
    body.textContent = "연차가 " + (Math.round(loss*10)/10) + "일 모자랍니다. 한 달에 1일씩 쌓이니 "
      + (d.getFullYear() + "." + String(d.getMonth()+1).padStart(2,"0")) + " 이후로 미루면 손해가 없습니다. "
      + "매달 하루씩 나눠 쉬면 급여가 한 번도 깎이지 않습니다.";
  }
  tip.append(t, body); out.appendChild(tip);
}

function drawLeave(){
  const fmt = n => Math.round(n * 10) / 10;

  /* 출처 1 — 법정 발생. 근로기준법 제60조 2항. */
  const accByMonth = {};
  for (const d of accrualDates()) accByMonth[d.slice(0,7)] = (accByMonth[d.slice(0,7)] || 0) + 1;

  /* 출처 2 — 명세서가 직접 말해주는 것. 연차수당 일수와 기본급 차감 시간뿐이고,
     며칠 쉬었는지는 적혀 있지 않다. */
  const cashByMonth = {}, dedByMonth = {};
  for (const pp of B.payslips){
    if (pp.leaveCashed)   cashByMonth[pp.period] = pp.leaveCashed;
    if (pp.deductedHours) dedByMonth[pp.period]  = pp.deductedHours;
  }
  const havePayslip = new Set(B.payslips.filter(pp => !pp.derived).map(pp => pp.period));

  /* 출처 3 — 내가 달력에 찍은 것. */
  const useByMonth = {}, mineHByMonth = {}, detail = {}, untouched = {};
  let byMe = 0, byCompany = 0;      // 내가 신청한 것 / 회사가 쓰게 한 것
  detailRows = { acc: [], mine: [], co: [] };
  for (const d of accrualDates()) detailRows.acc.push({ ds: d, k: "연차 +1일" });
  for (const ds of trackedDates()){
    const mo = monthOf(ds), a = ATT.get(ds), base = a ? baseKind(a) : null;
    if ((base === "company" || base === "personal") && !overrides.has(ds))
      untouched[mo] = (untouched[mo] || 0) + 1;          // 엑셀 기본값 그대로인 휴무일
    const k = kindOf(ds);
    if (!(k in CONSUMES)) continue;
    detail[mo] = detail[mo] || {};
    detail[mo][k] = (detail[mo][k] || 0) + 1;
    if (CONSUMES[k]){
      useByMonth[mo] = (useByMonth[mo] || 0) + CONSUMES[k];
      if (k === "coAnnual"){ byCompany += CONSUMES[k]; detailRows.co.push({ ds, k: KINDS[k].label }); }
      else { byMe += CONSUMES[k]; detailRows.mine.push({ ds, k: KINDS[k].label }); }
    }
    if (k in DEDUCTS) mineHByMonth[mo] = (mineHByMonth[mo] || 0) + B.dailyHours;
  }
  // 명세서가 있는 달은 연차 변동이 없어도 표에 남긴다
  for (const pp of B.payslips) useByMonth[pp.period] = useByMonth[pp.period] || 0;

  const months = [...new Set([].concat(
    Object.keys(accByMonth), Object.keys(useByMonth), Object.keys(cashByMonth),
    Object.keys(dedByMonth), Object.keys(mineHByMonth)))].sort();
  for (const mo of months) mineHByMonth[mo] = deductHoursOf(mo);

  /* ── 월별 원장 ── */
  const KO = {personal:"연차", half:"반차", coAnnual:"전사연차", substitute:"대체휴무", company:"전사휴무", official:"공가"};
  const box = $("ledger"); box.textContent = "";
  let bal = 0, tAcc = 0, tUse = 0, tCash = 0, tMineH = 0, tSlipH = 0;
  const mismatch = [], todo = [];

  for (const mo of months){
    const acc = accByMonth[mo]||0, use = useByMonth[mo]||0, cash = cashByMonth[mo]||0;
    const slipH = dedByMonth[mo]||0, mineH = mineHByMonth[mo]||0;
    // 수당은 돈일 뿐 '쉴 권리'는 남는다 (C안). 잔여를 줄이는 것은 실제 사용뿐이다.
    bal += acc - use;
    tAcc += acc; tUse += use; tCash += cash; tMineH += mineH; tSlipH += slipH;

    const hasSlip = havePayslip.has(mo);
    if (hasSlip && slipH !== mineH) mismatch.push({ mo, slipH, mineH });
    if (hasSlip && untouched[mo])   todo.push({ mo, n: untouched[mo] });

    const row = document.createElement("div"); row.className = "lg";
    const m = document.createElement("span"); m.className = "m num"; m.textContent = mo.replace("-", ".");
    const ev = document.createElement("span"); ev.className = "ev";
    const tag = (cls, txt) => { const e = document.createElement("span"); e.className = "tag " + cls; e.textContent = txt; ev.appendChild(e); };
    if (acc)  tag("acc",  "발생 +" + acc);
    if (cash) tag("cash", "수당 " + cash + "일분");
    const d = detail[mo] || {};
    for (const k of ["personal","half","coAnnual","substitute","official","company"])
      if (d[k]) tag(k === "coAnnual" || k === "personal" || k === "half" ? "use" : "acc",
                     KO[k] + " " + d[k] + (k === "half" ? "회" : "일"));
    const stock = stockUseOf(mo);
    if (stock) tag("un", "모아둔 연차 " + fmt(stock) + "일 사용 → 급여 차감");
    if (d.unpaid)   tag("un", "무급 " + d.unpaid + "일");
    if (d.coUnpaid) tag("un", "전사무급 " + d.coUnpaid + "일");
    if (hasSlip && slipH !== mineH) tag("un", "명세서 차감 " + slipH + "시간 ≠ 내 기록 " + mineH + "시간");
    if (!ev.childElementCount){ const e = document.createElement("span"); e.className = "m"; e.textContent = "—"; ev.appendChild(e); }
    const b = document.createElement("span"); b.className = "lgbal num"; b.textContent = fmt(bal) + "일";
    row.append(m, ev, b); box.appendChild(row);
  }

  /* ── 맞춰볼 수 있는 항목만 보여 준다 ──
     명세서에는 며칠 쉬었는지가 없고 금액만 있다. 그래서 양쪽이 모두
     말해 주는 것은 '급여에서 깎인 시간' 하나뿐이다. */
  const tb = $("cmpBody"); tb.textContent = "";
  const ok = mismatch.length === 0;
  const chk = document.createElement("div");
  chk.className = "check " + (ok ? "ok" : "bad");
  const h = document.createElement("b");
  h.textContent = ok ? "명세서와 기록이 맞습니다" : "명세서와 기록이 다릅니다";
  const l1 = document.createElement("div"); l1.className = "check-row";
  l1.innerHTML = "<span>급여명세서에서 깎인 시간</span><b class='num'>" + tSlipH + "시간</b>";
  const l2 = document.createElement("div"); l2.className = "check-row";
  l2.innerHTML = "<span>달력에 무급으로 적은 시간</span><b class='num'>" + tMineH + "시간</b>";
  const foot = document.createElement("div"); foot.className = "check-foot";
  foot.textContent = ok
    ? "명세서 " + B.payslips.length + "장이 달력 기록과 맞습니다."
    : mismatch.map(x => x.mo.replace("-",".") + " 명세서 " + x.slipH + "시간 · 기록 " + x.mineH + "시간").join(", ")
      + " — 달력에서 그 달을 확인해 주세요.";
  chk.append(h, l1, l2, foot);
  tb.appendChild(chk);

  const rest = fmt(tAcc - tUse);
  curBal = rest;
  $("heroBal").textContent = rest + "일";
  $("heroAcc").textContent = tAcc + "일";
  $("heroMine").textContent = fmt(byMe) + "일";
  $("heroCo").textContent = fmt(byCompany) + "일";
  drawDetail();
  document.querySelector(".hero").classList.toggle("neg", rest < 0);
  $("lvBal").textContent = rest + "일";
  $("lvBal").closest(".bal").classList.toggle("neg", rest < 0);
  $("lvAsOf").textContent = "오늘까지";

  /* ── 경고 ── */
  const al = $("lvAlerts"); al.textContent = "";
  const add = (cls, title, body) => {
    const d = document.createElement("div"); d.className = "alert " + cls;
    const b = document.createElement("b"); b.textContent = title;
    d.append(b, document.createTextNode(body)); al.appendChild(d);
  };
  if (todo.length)
    add("todo", "아직 기록하지 않은 휴무일이 " + todo.reduce((a,x)=>a+x.n,0) + "일 있습니다",
        todo.map(x => x.mo.replace("-",".") + " " + x.n + "일").join(", ")
        + " — 달력에서 눌러 성격을 정해 주세요.");
  if (rest < 0)
    add("bad", "생긴 것보다 " + fmt(-rest) + "일 더 나갔습니다",
        tAcc + "일이 생겼는데, 쉰 날로 " + fmt(tUse) + "일 · 수당으로 " + tCash + "일분이 나갔습니다. "
        + "회사가 법정보다 연차를 더 준 경우이거나, 연차로 찍은 날 중 일부가 실제로는 "
        + "대체휴무·회사 부담 휴무일 수 있습니다.");

  $("lvNote").textContent =
    "연차는 1개월 개근할 때마다 1일씩 생깁니다(근로기준법, 1년 미만 최대 11일). "
    + "그 달에 쓰지 않은 연차는 회사가 수당으로 미리 지급하지만, 쉴 권리는 그대로 남아 쌓입니다. "
    + "나중에 그 재고를 쓰면 돈은 이미 받았으므로 기본급에서 하루치가 빠집니다. "
    + "오른쪽 숫자가 그 시점에 남아 있는 연차입니다.";
}

/* ── 칸 접었다 펴기 ──
   화면에 한꺼번에 너무 많이 나오므로, 제목을 눌러 내용을 감출 수 있게 한다. */
const FOLDKEY = "salary.folds";
const FOLD_SHUT = ["연차 계획", "연차 대조", "월별 명세서 대조"];   // 처음에는 접어 둔다
function readFolds(){ try { return JSON.parse(localStorage.getItem(FOLDKEY)) || {}; } catch { return {}; } }
function writeFolds(f){ try { localStorage.setItem(FOLDKEY, JSON.stringify(f)); } catch {} }

function setupFolds(){
  const saved = readFolds();
  for (const sec of document.querySelectorAll(".sec")){
    if (sec.id === "setup") continue;
    const hd = sec.querySelector(".sec-hd"), h2 = hd && hd.querySelector("h2");
    if (!h2 || hd.querySelector(".fold")) continue;
    const name = h2.textContent.trim();
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "fold";
    hd.insertBefore(btn, hd.firstChild);
    btn.appendChild(h2);
    const chev = document.createElement("i"); chev.className = "chev";
    btn.appendChild(chev);
    const apply = open => {
      sec.classList.toggle("folded", !open);
      btn.setAttribute("aria-expanded", String(open));
      btn.setAttribute("aria-label", name + (open ? " 접기" : " 펴기"));
    };
    apply(name in saved ? saved[name] : !FOLD_SHUT.includes(name));
    btn.addEventListener("click", () => {
      const open = sec.classList.contains("folded");
      apply(open);
      const f = readFolds(); f[name] = open; writeFolds(f);
    });
  }
}

/* ── 요약 칸을 눌러 펼치는 목록 ──
   무엇이 언제였는지 최근 것부터 보여 주고, 누르면 달력이 그 달로 간다. */
let curBal = 0;
let detailRows = { acc: [], mine: [], co: [] }, detailOpen = null;
const DETAIL_TITLE = { acc:"연차가 생긴 날", mine:"내가 쓴 날", co:"회사가 쓰게 한 날" };
const DETAIL_EMPTY = { acc:"아직 생긴 연차가 없습니다.", mine:"아직 쓴 연차가 없습니다.",
                       co:"회사가 쓰게 한 연차가 없습니다." };

function drawDetail(){
  const box = $("heroList");
  for (const b of document.querySelectorAll(".hero-grid>button"))
    b.setAttribute("aria-expanded", String(b.dataset.detail === detailOpen));
  if (!detailOpen){ box.hidden = true; box.textContent = ""; return; }
  box.hidden = false; box.textContent = "";

  const hd = document.createElement("div"); hd.className = "hhd";
  hd.textContent = DETAIL_TITLE[detailOpen]; box.appendChild(hd);

  const rows = [...detailRows[detailOpen]].sort((a, b) => b.ds.localeCompare(a.ds));
  if (!rows.length){
    const e = document.createElement("div"); e.className = "hempty";
    e.textContent = DETAIL_EMPTY[detailOpen]; box.appendChild(e); return;
  }
  for (const r of rows){
    const isMonth = r.ds.length === 7;
    const b = document.createElement("button");
    b.type = "button"; b.className = "hrow"; b.dataset.month = r.ds.slice(0, 7);
    const d = document.createElement("span"); d.className = "hd num";
    d.textContent = r.ds.replace(/-/g, ".");
    b.appendChild(d);
    if (!isMonth){
      const w = document.createElement("span"); w.className = "hw";
      w.textContent = "(" + "일월화수목금토"[new Date(r.ds + "T00:00:00").getDay()] + ")";
      b.appendChild(w);
    }
    const k = document.createElement("span");
    k.className = "hk" + (detailOpen === "co" ? " co" : detailOpen === "cash" ? " cash" : "");
    k.textContent = r.k; b.appendChild(k);
    const go = document.createElement("span"); go.className = "hgo"; go.textContent = "›";
    b.appendChild(go);
    box.appendChild(b);
  }
}

document.querySelector(".hero-grid").addEventListener("click", e => {
  const b = e.target.closest("button[data-detail]"); if (!b) return;
  detailOpen = detailOpen === b.dataset.detail ? null : b.dataset.detail;
  drawDetail();
});

$("heroList").addEventListener("click", e => {
  const b = e.target.closest(".hrow"); if (!b) return;
  const mo = b.dataset.month;
  if (mo >= B.calendarFrom && mo <= B.calendarTo){ view = mo; drawCal(); }
  $("calSec").scrollIntoView({ behavior: "smooth", block: "start" });
});

/* ── 월 선택기 ──
   년월을 누르면 달을 고르는 판이 열리고, 연도를 누르면 연도 목록으로 바뀐다. */
let pkYear = 0, pkBase = 0, pkMode = null;   // null=닫힘 · "month" · "year"
const YEARS_PER_PAGE = 12;

function openPicker(mode){
  pkYear = Number(view.slice(0, 4));
  const fy = Number(B.calendarFrom.slice(0, 4)), ty = Number(B.calendarTo.slice(0, 4));
  // 쓸 수 있는 연도가 한 페이지에 다 들어가면 거기서부터 보여 준다
  pkBase = (ty - fy < YEARS_PER_PAGE) ? fy
         : pkYear - ((pkYear % YEARS_PER_PAGE) + YEARS_PER_PAGE) % YEARS_PER_PAGE;
  pkMode = mode;
  drawPicker();
  $("picker").hidden = false;
  $("calBody").hidden = true;
}
function closePicker(){
  pkMode = null;
  $("picker").hidden = true;
  $("calBody").hidden = false;
}
function drawPicker(){
  const fromY = Number(B.calendarFrom.slice(0, 4)), toY = Number(B.calendarTo.slice(0, 4));
  const paid = new Set(B.payslips.map(p => p.period));   // 명세서가 있는 달을 짚어 준다
  const g = $("pkGrid"); g.textContent = "";

  if (pkMode === "year"){
    $("pkTitle").textContent = pkBase + " ~ " + (pkBase + YEARS_PER_PAGE - 1);
    $("pkPrev").disabled = pkBase + YEARS_PER_PAGE - 1 <= fromY;
    $("pkNext").disabled = pkBase >= toY;
    for (let i = 0; i < YEARS_PER_PAGE; i++){
      const y = pkBase + i;
      const b = document.createElement("button");
      b.type = "button"; b.textContent = y; b.dataset.year = y;
      b.disabled = y < fromY || y > toY;
      b.setAttribute("aria-current", String(y === pkYear));
      g.appendChild(b);
    }
    return;
  }

  $("pkTitle").textContent = pkYear + "년";
  $("pkPrev").disabled = pkYear <= fromY;
  $("pkNext").disabled = pkYear >= toY;
  for (let m = 1; m <= 12; m++){
    const key = pkYear + "-" + String(m).padStart(2, "0");
    const b = document.createElement("button");
    b.type = "button"; b.textContent = m + "월"; b.dataset.month = key;
    b.disabled = key < B.calendarFrom || key > B.calendarTo;
    if (paid.has(key)) b.classList.add("has");
    b.setAttribute("aria-current", String(key === view));
    g.appendChild(b);
  }
}

const togglePicker = mode => { if (pkMode === mode) closePicker(); else openPicker(mode); };
$("mYear").addEventListener("click", () => togglePicker("year"));
$("mMonth").addEventListener("click", () => togglePicker("month"));
$("pkPrev").addEventListener("click", () => {
  if (pkMode === "year") pkBase -= YEARS_PER_PAGE; else pkYear--;
  drawPicker();
});
$("pkNext").addEventListener("click", () => {
  if (pkMode === "year") pkBase += YEARS_PER_PAGE; else pkYear++;
  drawPicker();
});
$("pkGrid").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b || b.disabled) return;
  if (b.dataset.year){ pkYear = Number(b.dataset.year); pkMode = "month"; drawPicker(); return; }
  view = b.dataset.month; closePicker(); drawCal();
});

/* ── 편집 시트 ── */
function openSheet(ds){
  picked = ds;
  const a = ATT.get(ds), k = kindOf(ds);
  const dt = new Date(ds+"T00:00:00");
  $("shTitle").textContent = ds.replace(/-/g,".") + " (" + "일월화수목금토"[dt.getDay()] + ")";
  const hol = a?.holiday || (B.holidays && B.holidays[ds]);
  const tm = timesOf(ds);
  $("shSub").textContent = tm
    ? tm.s + " ~ " + tm.e + " · " + hoursBetween(tm.s, tm.e) + "시간" + (tm.mine ? " (직접 적음)" : "")
    : (hol || "출근 기록 없음");
  const keep = $("shTimes");
  if (keep) $("sheet").appendChild(keep);      // 지워지지 않게 잠시 밖으로
  const box = $("shOpts"); box.textContent = "";
  for (const g of GROUPS){
    const h = document.createElement("div"); h.className = "opt-h"; h.textContent = g.title;
    box.appendChild(h);
    const row = document.createElement("div"); row.className = "opt-row";
    for (const key of g.kinds){
      const K = KINDS[key];
      const b = document.createElement("button");
      b.type = "button"; b.className = "opt"; b.dataset.kind = key;
      b.setAttribute("aria-pressed", String(k === key));
      const t = document.createElement("span"); t.textContent = K.label;
      const sm = document.createElement("small"); sm.textContent = K.desc;
      b.append(t, sm); row.appendChild(b);
    }
    if (g.kinds.includes("work")) row.appendChild($("shTimes"));  // 출근 줄 오른쪽 칸
    box.appendChild(row);
  }
  syncTimes(ds, k);
  $("scrim").classList.add("on"); $("sheet").classList.add("on");
}
function syncTimes(ds, k){
  const box = $("shTimes");
  if (!WORK_KINDS.has(k)){ box.hidden = true; return; }
  const tm = timesOf(ds);
  $("shStart").value = tm ? tm.s : "08:30";
  $("shEnd").value   = tm ? tm.e : "17:30";
  box.hidden = false;
  showHours();
}
function showHours(){
  const a = $("shStart").value, b = $("shEnd").value;
  $("shHours").textContent = (a && b) ? hoursBetween(a, b) + "시간" : "";
}
function saveTimes(){
  if (!picked) return;
  const a = $("shStart").value, b = $("shEnd").value;
  showHours();
  if (!a || !b) return;
  // 8시간에 못 미치면 지각으로 본다
  const k = hoursBetween(a, b) < 7.99 ? "short" : "work";
  setKind(picked, k, { s: a, e: b });
  for (const el of $("shOpts").querySelectorAll(".opt"))
    el.setAttribute("aria-pressed", String(el.dataset.kind === k));
  $("shSub").textContent = a + " ~ " + b + " · " + hoursBetween(a, b) + "시간 (직접 적음)";
}

function closeSheet(){ $("scrim").classList.remove("on"); $("sheet").classList.remove("on"); picked = null; }

async function setKind(ds, kind, times){
  const val = times && times.s ? { k: kind, s: times.s, e: times.e } : kind;
  if (kind) overrides.set(ds, val); else overrides.delete(ds);
  redraw();
  if (dbRef){
    try {
      const doc = dbRef.collection("leave").doc(ds);
      if (kind) await doc.set({ date: ds, kind, s: times?.s || null, e: times?.e || null,
                                updatedAt: new Date().toISOString() });
      else await doc.delete();
    } catch { $("dbWarn").hidden = false; }
  } else if (api){
    pushLeave();
  }
}

/* ── 이번 달 예상 명세서 ──
   명세서가 아직 안 온 달을, 지금까지의 규칙과 달력 기록으로 미리 계산한다.
   공제는 매달 같은 값이 나오므로 가장 최근 명세서의 값을 그대로 쓴다. */
function drawForecast(){
  const real = new Set(B.payslips.filter(p => !p.derived).map(p => p.period));
  const months = [...new Set(trackedDates().map(monthOf))].sort();
  const target = months.filter(m => !real.has(m)).pop();
  const last = B.payslips.filter(p => !p.derived).pop();
  if (!target || !last){ $("forecast").hidden = true; return; }

  const deductH = deductHoursOf(target), used = useOf(target);

  const base = B.fullBase - deductH * B.hourly;
  const fixed = {};
  for (const [k, v] of Object.entries(last.earnings))
    if (k !== "기본급" && k !== "연차수당") fixed[k] = v;
  // 그 달 발생분을 안 쓰면 그만큼 연차수당으로 나온다
  const cash = Math.round(cashDaysOf(target) * B.dayPay);

  const earn = [["기본급", base], ...Object.entries(fixed)];
  if (cash) earn.push(["연차수당", cash, true]);
  const gross = earn.reduce((a, e) => a + e[1], 0);

  const ded = {};
  for (const [k, v] of Object.entries(last.deductions)) ded[k] = v;
  ded["고용보험"] = Math.floor(gross * 0.009 / 10) * 10;
  const dedTotal = Object.values(ded).reduce((a, b) => a + b, 0);

  const t = $("fcTable"); t.textContent = "";
  const row = (label, val, cls, guess) => {
    const tr = document.createElement("tr");
    if (cls) tr.className = cls;
    const a = document.createElement("td");
    a.textContent = label;
    if (guess){ const g = document.createElement("span"); g.className = "guess"; g.textContent = "추정"; a.appendChild(g); }
    const b = document.createElement("td");
    b.textContent = (cls === "minus" ? "−" : "") + WON(Math.abs(val)) + "원";
    tr.append(a, b); t.appendChild(tr);
  };
  for (const [k, v, g] of earn) row(k, v, null, g);
  row("지급총액", gross, "sum");
  row("공제총액", dedTotal, "minus");
  row("예상 실수령", gross - dedTotal, "net");

  $("fcMonth").textContent = target.replace("-", ".") + " 급여";
  const pay = B.payslips.find(p => p.period === target);
  const why = [];
  const stock = stockUseOf(target);
  if (stock) why.push("그 달에 생긴 1일을 " + stock + "일 넘겨 써서, 모아둔 연차에서 " + (stock * B.dailyHours) + "시간 차감");
  else if (deductH) why.push("무급 " + (deductH / B.dailyHours) + "일 차감 반영");
  if (cash) why.push("그 달 발생분을 안 써서 연차수당이 붙는 것으로 봄");
  else why.push("그 달 발생분을 써서 연차수당은 없는 것으로 봄");
  why.push("공제는 최근 명세서와 같은 값으로 계산");
  $("fcFoot").textContent = why.join(" · ") + ".";
  $("forecast").hidden = false;
}

function redraw(){ drawCal(); drawMonths(); drawLeave(); drawForecast(); tiles(); drawPlan(); setupFolds(); }

/* ── 이벤트 ── */
$("grid").addEventListener("click", e => {
  const b = e.target.closest(".cell"); if (!b || b.disabled) return;
  if (planPick){
    const ds = b.dataset.date;
    if (planPick === 1){ $("plFrom").value = ds; $("plTo").value = ""; planPick = 2; }
    else {
      if (ds < $("plFrom").value) $("plFrom").value = ds; else $("plTo").value = ds;
      planPick = 0;
    }
    syncPick(); drawCal(); drawPlan(); return;
  }
  openSheet(b.dataset.date);
});

function syncPick(){
  const b = $("plPick");
  b.classList.toggle("on", !!planPick);
  b.textContent = planPick === 1 ? "시작할 날을 누르세요 (취소)"
                : planPick === 2 ? "끝날 날을 누르세요 (취소)"
                : "달력에서 고르기";
}
$("plPick").addEventListener("click", () => {
  planPick = planPick ? 0 : 1;
  if (planPick){ $("plFrom").value = ""; $("plTo").value = ""; }
  syncPick(); drawCal(); drawPlan();
  if (planPick) $("calSec").scrollIntoView({ behavior:"smooth", block:"start" });
});
for (const id of ["plFrom","plTo"]) $(id).addEventListener("change", () => { drawCal(); drawPlan(); });
$("shOpts").addEventListener("click", e => {
  const b = e.target.closest(".opt"); if (!b || !picked) return;
  const k = b.dataset.kind;
  if (WORK_KINDS.has(k)){                 // 출근이면 시각을 적을 수 있게 열어 둔다
    const tm = timesOf(picked);
    setKind(picked, k, tm && tm.mine ? tm : null);
    for (const el of $("shOpts").querySelectorAll(".opt"))
      el.setAttribute("aria-pressed", String(el.dataset.kind === k));
    syncTimes(picked, k);
    return;
  }
  setKind(picked, k); closeSheet();
});
for (const id of ["shStart", "shEnd"]) $(id).addEventListener("change", saveTimes);
$("shClose").addEventListener("click", closeSheet);
$("scrim").addEventListener("click", closeSheet);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });
$("prev").addEventListener("click", () => { closePicker(); view = shift(view,-1); drawCal(); });
$("next").addEventListener("click", () => { closePicker(); view = shift(view, 1); drawCal(); });
function shift(v, n){
  let [y,m] = v.split("-").map(Number); m += n;
  if (m < 1){ m = 12; y--; } if (m > 12){ m = 1; y++; }
  return y + "-" + String(m).padStart(2,"0");
}

/* ── 원격 저장소 (Cloudflare Worker) ──
   주소와 암구호는 이 기기의 브라우저에만 둔다. */
const CFGKEY = "salary.api";
function loadApi(){
  try { const v = localStorage.getItem(CFGKEY); return v ? JSON.parse(v) : null; } catch { return null; }
}
function saveApi(v){ try { localStorage.setItem(CFGKEY, JSON.stringify(v)); } catch {} }

async function apiCall(path, method, body){
  const r = await fetch(api.url.replace(/\/+$/,"") + "/" + path, {
    method, headers: { "x-pass": api.pass, ...(body ? {"content-type":"application/json"} : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = await r.json().catch(() => null);
  if (!r.ok) throw new Error((out && out.error) || ("서버가 " + r.status + " 를 돌려줬습니다"));
  return out;
}

let saveTimer = null, saveQueued = false;
function pushLeave(){                      // 연속 입력을 한 번으로 묶는다
  saveQueued = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!saveQueued || !api) return;
    saveQueued = false;
    try { await apiCall("leave", "PUT", Object.fromEntries(overrides)); $("dbWarn").hidden = true; }
    catch { $("dbWarn").hidden = false; }
  }, 600);
}

/* ── 명세서 불러오기 ──
   브라우저는 메일을 읽을 수 없으므로, 버튼은 Worker 를 거쳐 GitHub 의
   수집 작업을 깨우기만 한다. 끝났는지는 금고의 갱신 시각으로 확인한다. */
let refreshTimer = null;

const PHASES = [            // 밖에서는 어느 단계인지 알 수 없어 경과 시간으로 어림한다
  [0,  "작업을 깨우는 중"],
  [25, "필요한 것을 준비하는 중"],
  [55, "메일함을 여는 중"],
  [95, "명세서를 읽는 중"],
];
const EXPECT = 120;         // 보통 걸리는 시간(초)

function setMsg(cls, phase, hint, sec, pct){
  const m = $("refreshMsg");
  m.className = "rmsg " + cls;
  $("rphase").textContent = phase;
  $("relapsed").textContent = sec == null ? "" : fmtSec(sec);
  $("rhint").innerHTML = hint || "";
  $("rbarFill").style.width = Math.round((pct ?? 0) * 100) + "%";
  m.hidden = false;
}
const fmtSec = s => s < 60 ? s + "초" : Math.floor(s/60) + "분 " + String(s%60).padStart(2,"0") + "초";
const phaseOf = s => PHASES.reduce((acc, p) => s >= p[0] ? p[1] : acc, PHASES[0][1]);

function actionsLink(){
  return B.repo
    ? ' <a href="https://github.com/' + B.repo + '/actions" target="_blank" rel="noopener">Actions 에서 보기</a>'
    : "";
}

function showLast(iso){
  if (!iso){ $("rlast").textContent = ""; return; }
  const d = new Date(iso), now = new Date();
  const mins = Math.round((now - d) / 60000);
  const rel = mins < 1 ? "방금" : mins < 60 ? mins + "분 전"
            : mins < 1440 ? Math.floor(mins/60) + "시간 전"
            : Math.floor(mins/1440) + "일 전";
  $("rlast").textContent = "갱신 " + rel;
  $("rlast").title = d.toLocaleString("ko-KR");
}

async function metaAt(){
  const m = await apiCall("meta", "GET");
  const at = (typeof m === "string" ? JSON.parse(m) : m).updatedAt || null;
  showLast(at);
  return at;
}

async function doRefresh(){
  const btn = $("refreshBtn");
  clearTimeout(refreshTimer);
  btn.disabled = true;

  let before = null;
  try { before = await metaAt(); } catch {}

  setMsg("info", "작업을 깨우는 중", "", 0, 0.02);
  try {
    await apiCall("refresh", "POST");
  } catch (e) {
    setMsg("bad", "시작하지 못했습니다", e.message + actionsLink());
    btn.disabled = false;
    return;
  }

  const t0 = Date.now(), deadline = t0 + 8 * 60 * 1000;
  const hint = "보통 1~2분 걸립니다. 이 화면을 닫아도 작업은 계속됩니다.";

  const paint = () => {
    const sec = Math.round((Date.now() - t0) / 1000);
    setMsg("info", phaseOf(sec), hint, sec, Math.min(sec / EXPECT, 0.95));
  };
  const ui = setInterval(paint, 1000);
  paint();

  const finish = (cls, phase, note) => {
    clearInterval(ui); clearTimeout(refreshTimer);
    setMsg(cls, phase, note, Math.round((Date.now() - t0) / 1000), 1);
    btn.disabled = false;
  };

  const tick = async () => {
    if (Date.now() > deadline){
      finish("bad", "시간이 너무 오래 걸립니다",
             "8분이 지나도 끝나지 않았습니다." + actionsLink());
      return;
    }
    let now = null;
    try { now = await metaAt(); } catch {}
    if (now && now !== before){
      try {
        await loadRemote();
        start();
        finish("ok", "완료 — 명세서 " + B.payslips.length + "장", "화면을 새 자료로 다시 그렸습니다.");
      } catch (e) {
        finish("bad", "받아온 자료를 읽지 못했습니다", e.message);
      }
      return;
    }
    refreshTimer = setTimeout(tick, 10000);
  };
  refreshTimer = setTimeout(tick, 15000);
}

/* ── 설정 화면 ── */
function showSetup(msg){
  const cur = loadApi();
  if (cur){ $("apiUrl").value = cur.url || ""; $("apiPass").value = cur.pass || ""; }
  const el = $("setupMsg");
  el.classList.toggle("err", Boolean(msg));
  if (msg) el.textContent = "연결하지 못했습니다 — " + msg;
  $("setup").hidden = false;
  $("app").hidden = true;
}

$("apiSave").addEventListener("click", async () => {
  const url = $("apiUrl").value.trim(), pass = $("apiPass").value;
  if (!url || !pass){ showSetup("주소와 암구호를 모두 넣어 주세요"); return; }
  api = { url, pass };
  $("apiSave").disabled = true; $("apiSave").textContent = "연결하는 중…";
  try {
    await loadRemote();
    saveApi(api);
    $("setup").hidden = true;
    start();
  } catch (e) {
    api = null; showSetup(e.message);
  } finally {
    $("apiSave").disabled = false; $("apiSave").textContent = "연결";
  }
});
$("openSetup").addEventListener("click", () => showSetup());
$("refreshBtn").addEventListener("click", doRefresh);

async function loadRemote(){
  const bundle = await apiCall("bundle", "GET");
  if (!bundle || !Array.isArray(bundle.payslips))
    throw new Error("데이터가 아직 올라가지 않았습니다 (python src/push_data.py 를 먼저 실행하세요)");
  B = bundle;
  const lv = await apiCall("leave", "GET");
  overrides = new Map(Object.entries(lv || {}).filter(([, v]) => kindName(v)));
}

/* ── 시작 ── */
function start(){
  ATT = new Map(B.attendance.map(a => [a.date, a]));
  PAY = new Map(B.payslips.map(p => [p.period, p]));
  const now = new Date();
  const cur = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  view = cur < B.calendarFrom ? B.calendarFrom : (cur > B.calendarTo ? B.calendarTo : cur);
  service();
  redraw();
  $("app").hidden = false;
  $("openSetup").hidden = !api;
  $("refreshBtn").hidden = !api;
  if (api) metaAt().catch(() => {});
}

(async function boot(){
  if (EMBEDDED){                      // 아티팩트·개발서버: 데이터는 페이지 안에 박혀 온다
    B = EMBEDDED;
    // 달력 기록은 금고에 따로 있다. 박혀 온 것이 있으면 그것부터 반영한다.
    if (B.leave) overrides = new Map(Object.entries(B.leave).filter(([, v]) => kindName(v)));
    start();
    if (B.dev){                       // python src/dev.py 로 띄운 개발용 서버
      $("dbWarn").textContent = "개발용 서버입니다. 여기서 바꾼 기록은 저장되지 않습니다.";
      $("dbWarn").hidden = false; return;
    }
    const db = await (window.claude?.use?.("db") ?? Promise.resolve(null));
    if (!db){ $("dbWarn").hidden = false; return; }
    dbRef = db;
    db.collection("leave").onSnapshot(
      snap => {
        overrides = new Map();
        for (const d of snap.docs){
        const v = d.data(); if (!v || !v.kind) continue;
        overrides.set(d.id, v.s ? { k: v.kind, s: v.s, e: v.e } : v.kind);
      }
        redraw();
      },
      () => { $("dbWarn").hidden = false; }
    );
    return;
  }
  api = loadApi();                    // 공개 호스팅: 데이터도 저장도 원격
  if (!api){ showSetup(); return; }
  try { await loadRemote(); start(); }
  catch (e) { api = null; showSetup(e.message); }
})();
})();
