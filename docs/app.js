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
  dayoff:    {label:"쉬는 날",  tag:"쉬는날", cls:"k-weekend",  desc:"원래 안 나오는 날 · 차감 없음", off:0},
  future:    {label:"예정",     tag:null,   cls:"k-future",   desc:"아직 오지 않은 날",        off:0},

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
  { title: "그 외",            kinds: ["substitute", "official", "dayoff"] },
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
  // 쉰 날은 연차를 깎는 것과 안 깎는 것이 섞여 있다. 나눠서 보여 준다.
  let d = 0, used = 0, flat = 0;
  for (const ds of trackedDates()){
    const k = kindOf(ds), K = KINDS[k];
    if (!K) continue;
    d += offOn(ds, k);
    used += consumeOn(ds, k);
    if (deductOn(ds, k)) flat += 1;
  }
  const r = x => Math.round(x * 10) / 10;
  const freeOff = r(d - used - flat);              // 연차도 급여도 안 깎인 휴무
  const parts = [];
  if (used)    parts.push("연차 " + r(used) + "일");
  if (freeOff) parts.push("차감 없는 휴무 " + freeOff + "일");
  if (flat)    parts.push("무급 " + flat + "일");
  $("tOff").textContent = r(d) + "일";
  $("tOffSub").textContent = parts.join(" + ") || "쉰 날 없음";
}
function refNet(){
  // 역산한 달(2월처럼 일할계산된 달)은 기준이 될 수 없다
  const p = B.payslips.find(p => !p.derived && !p.deductedHours && !p.leaveCashed);
  return p ? p.net : 0;
}

/* ── 달력 ── */
/* 달력 칸에 몇 줄이 들어가는지는 화면이 정한다.
   칸 높이(--cell-h)는 화면 높이에서, 일정 줄 수는 그 칸에 남는 자리에서
   계산한다. 일정이 그 줄 수를 넘을 때만 마지막 줄이 +N 이 된다.
   줄 수는 주(가로 한 줄)마다 따로 잰다 — 막대는 같은 주 안에서만 이어지므로
   주마다 달라도 선이 끊기지 않고, 공휴일 이름이 붙은 주만 줄 수가 줄어든다. */
let laneCaps = [3, 3, 3, 3, 3, 3];
let cellH = 0;

function drawCal(skipLayout){
  const [y,m] = view.split("-").map(Number);
  $("mYear").textContent = y + "년";
  $("mMonth").textContent = m + "월";
  const first = new Date(y, m-1, 1), last = new Date(y, m, 0);
  const lanes = gcLanes(view);
  const g = $("grid"); g.textContent = "";
  // 앞뒤 빈 칸에는 이웃 달의 날짜를 흐리게 적는다 — 구글 캘린더와 같다.
  // 달마다 4~6주로 줄 수가 달라지면 칸 크기가 바뀌므로, 늘 여섯 줄로 그린다.
  const padCell = d => {
    const c = document.createElement("div"); c.className = "cell pad";
    const dd = document.createElement("span"); dd.className = "d"; dd.textContent = d.getDate();
    c.appendChild(dd); g.appendChild(c);
  };
  for (let i = first.getDay(); i > 0; i--) padCell(new Date(y, m-1, 1 - i));
  const WEEKS = 6;
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
    if (planPick === 2 && ds === pf) b.classList.add("rpick");   // 끝날 날을 고르는 중
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
    const acc = accrualEvents().find(e => e.ds === ds);
    if (acc){
      b.classList.add("accday");
      b.dataset.acc = "연차 +" + acc.days;
      b.dataset.accShort = "+" + acc.days;        // 좁은 화면에서는 날짜를 가리지 않게
      b.title = acc.from.replace(/-/g,".") + " ~ " + acc.to.replace(/-/g,".")
              + " 만근 시 연차 " + acc.days + "일 발생";
    }
    const gev = gcEvents.get(ds);
    if (gev && gev.length){
      const wi = Math.floor((lanes.pad + day - 1) / 7);
      const wk = lanes.weeks[wi], cap = Math.max(2, laneCaps[wi]);      // 최소 두 줄: 막대 하나 + '+N'
      const here = wk.here.filter(s => s.from <= ds && ds <= s.to);
      if (!gcTitles() || !here.length){
        b.classList.add("hasev");                 // 제목을 끈 경우에만 점을 찍는다
      } else {
        const box = document.createElement("span"); box.className = "evs";
        const slot = [];
        for (const s of here) slot[wk.lane.get(s)] = s;
        const need = Math.max(...here.map(s => wk.lane.get(s))) + 1;   // 이 칸이 쓰는 줄 수
        const overflow = need > cap;                                    // 칸을 넘을 때만 +N
        const shown = overflow ? cap - 1 : cap;                         // +N 이 한 줄을 쓴다
        // 줄 수는 늘 같아야 막대가 칸을 건너 나란히 놓인다
        for (let i = 0; i < shown; i++){
          const s = slot[i];
          const v = document.createElement("span");
          if (!s){ v.className = "ev blank"; box.appendChild(v); continue; }
          // 한 주의 시작·끝에서도 막대를 끊어 준다
          const head = s.from === ds || w0 === 0 || day === 1;
          const tailEnd = s.to === ds || w0 === 6 || day === last.getDate();
          v.className = "ev bar" + (head ? " s" : "") + (tailEnd ? " e" : "");
          v.style.background = s.color;
          v.style.color = gcInk(s.color);
          if (head) v.textContent = s.title;      // 시각은 좁아서 못 넣는다. 시트에 있다.
          box.appendChild(v);
        }
        if (overflow){
          const hid = here.filter(s => wk.lane.get(s) >= shown);
          // 가려진 것이 하루짜리 하나뿐이면 '+1' 자리에 그 일정을 적는다 (이어질 막대가 없으니 줄이 어긋나지 않는다)
          if (hid.length === 1 && hid[0].from === hid[0].to){
            const v = document.createElement("span");
            v.className = "ev bar s e"; v.style.background = hid[0].color; v.style.color = gcInk(hid[0].color);
            v.textContent = hid[0].title; box.appendChild(v);
          } else {
            const more = document.createElement("span"); more.className = "ev more";
            more.textContent = "+" + hid.length;
            box.appendChild(more);
          }
        }
        b.appendChild(box);
      }
    }
    const a = ATT.get(ds);
    b.setAttribute("aria-label", ds + " " + (K?K.label:"기록 없음")
      + (hn ? " · " + hn : "") + (a&&a.start ? " "+a.start+"~"+a.end : ""));
    g.appendChild(b);
  }
  for (let i = first.getDay() + last.getDate(), k = 1; i < WEEKS * 7; i++, k++) padCell(new Date(y, m, k));
  gcOnView();
  $("prev").disabled = view <= B.calendarFrom;
  $("next").disabled = view >= B.calendarTo;
  if (!skipLayout){ layoutCal.n = 0; layoutCal(); }
}

/* ── 달력을 화면에 맞추기 ──
   스크롤 없이 달력 한 장이 화면에 들어오도록 칸 높이를 화면 높이에서 뽑는다.
   폰은 주소창이 오르내리며 화면 높이가 출렁이므로, 늘 가장 작은 높이(svh)를
   기준으로 삼는다. 그렇지 않으면 스크롤할 때마다 칸이 커졌다 작아진다. */
function viewportH(){
  let p = document.getElementById("vhProbe");
  if (!p){
    p = document.createElement("div"); p.id = "vhProbe";
    p.style.cssText = "position:fixed;left:0;top:0;width:0;height:100svh;visibility:hidden;pointer-events:none";
    document.body.appendChild(p);
  }
  return p.offsetHeight || innerHeight;
}

function targetCellH(){
  const sec = $("calSec"), grid = $("grid");
  if (!sec || !grid.offsetHeight) return 0;                  // 접혔거나 아직 안 보인다
  const extra = sec.scrollHeight - grid.offsetHeight;        // 제목줄·요일줄·범례·여백
  const wrap = document.querySelector(".wrap");
  let reserved = 12;
  if (getComputedStyle(wrap).display === "grid"){            // 두 칼럼 — 머리글 밑에서 시작한다
    const hd = document.querySelector(".hd");
    // 달력이 붙어 있을 수 있는 높이(CSS max-height = 화면 − 제목줄 − 28px)보다 늘 조금 작게 잡는다.
    // 딱 맞추면 반올림 때문에 몇 px 넘쳐서 달력 안에서 미세하게 스크롤된다.
    reserved = hd.offsetTop + hd.offsetHeight + 34;
  }
  const gap = parseFloat(getComputedStyle(grid).rowGap) || 2;
  const weeks = 6;                                                      // 늘 여섯 줄 — 달이 바뀌어도 칸 크기가 같다
  return Math.max(80, Math.min(260, Math.floor((viewportH() - reserved - extra - gap * (weeks - 1)) / weeks)));
}

/* 각 주에 일정 줄이 몇 개 들어가는지 잰다 — 날짜·분류·공휴일 이름이 쓰고 남은 자리 */
function measureLanes(){
  const cells = [...$("grid").querySelectorAll(".cell")];
  const gs = getComputedStyle($("grid"));
  const lane = parseFloat(gs.getPropertyValue("--lane")) || 14;
  const gap = parseFloat(gs.getPropertyValue("--lane-gap")) || 2;
  const caps = [];
  for (let w = 0; w < 6; w++){
    if (w * 7 >= cells.length){ caps.push(laneCaps[w]); continue; }     // 이 달에 없는 주
    let worst = 0, inner = 0;
    for (const c of cells.slice(w * 7, w * 7 + 7)){
      if (c.classList.contains("pad")) continue;
      const cs = getComputedStyle(c);
      inner = c.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      let t = 0, k = 0;
      for (const el of c.children){
        if (el.classList.contains("evs")) continue;
        t += el.getBoundingClientRect().height; k++;
      }
      worst = Math.max(worst, t + k);                        // 자식 사이 1px
    }
    caps.push(inner ? Math.max(0, Math.min(6, Math.floor((inner - worst - 3 + gap) / (lane + gap)))) : laneCaps[w]);
  }
  return caps;
}

function layoutCal(){
  if (layoutCal.busy) return;
  layoutCal.busy = true;
  try {
    const hdh = document.querySelector(".hd").offsetHeight;      // 고정된 제목줄 높이 — 달력이 그 밑에 붙는다
    if (hdh) document.documentElement.style.setProperty("--hd-h", hdh + "px");
    const h = targetCellH();
    if (h && h !== cellH){
      cellH = h;
      document.documentElement.style.setProperty("--cell-h", h + "px");
    }
    if (!$("grid").offsetHeight) return;
    const caps = measureLanes();
    if (caps.join() !== laneCaps.join() && layoutCal.n < 4){   // 무한히 다시 그리지 않게
      laneCaps = caps; layoutCal.n++;
      drawCal(true);
    }
  } finally { layoutCal.busy = false; }
}
layoutCal.n = 0;

let layoutTimer = 0;
const relayout = () => {
  cancelAnimationFrame(layoutTimer);
  layoutTimer = requestAnimationFrame(() => { layoutCal.n = 0; layoutCal(); });
};
window.addEventListener("resize", relayout);
if (window.ResizeObserver) new ResizeObserver(relayout).observe($("calSec"));   // 접기·경고 줄 따위로 크기가 바뀔 때

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
      off += offOn(ds, k);
      if (deductOn(ds, k)) unpaidDays += 1;
      if (k === "half") half += 1;
    }
    const why = document.createElement("div"); why.className = "mrow-why";
    const bits = [];
    if (p && p.derived) bits.push(p.note || "명세서가 만료돼 실수령액에서 역산");
    if (p && p.leaveCashed) bits.push("연차수당 +" + WON(p.leaveCashed*B.dayPay) + " (" + p.leaveCashed + "일분)");
    if (p && p.deductedHours){
      const fullH = B.fullBase / B.hourly;
      bits.push("기본급 " + fullH + "시간 → " + (fullH - p.deductedHours) + "시간"
                + "  (−" + p.deductedHours + "시간, −" + WON(p.deductedHours*B.hourly) + "원)");
    }
    if (off) bits.push("쉰 날 " + (Math.round(off*10)/10) + "일" + (half?" (반차 "+half+")":""));
    if (p && p.deductedHours && p.deductedHours % 4 !== 0)
      bits.push("차감이 4시간 단위가 아님 — 지각·조퇴가 반영된 것으로 보임");
    const rw = restWorkOf(mo);
    if (rw.n){
      const when = rw.list.map(x => x.ds.slice(5).replace("-", ".") + " " + x.hours + "시간").join(", ");
      if (p && !p.derived){
        const has = Object.keys(p.earnings).some(name => /휴일|가산|연장|야간/.test(name));
        bits.push("쉬는 날 근무 " + rw.n + "일 (" + when + ")"
          + (has ? " — 명세서에 휴일근로 항목이 있음"
                 : " — 명세서에 휴일근로수당이 없음. 법정 기준이면 약 " + WON(rw.pay)
                   + "원인데, 대체휴무로 갈음했는지 확인이 필요합니다"));
      } else {
        bits.push("쉬는 날 근무 " + rw.n + "일 (" + when + ") — 휴일근로수당 약 " + WON(rw.pay) + "원 (추정)");
      }
    }
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
/* 쉬는 날 = 주말과 공휴일. 원래 일하지 않는 날이라 연차도, 무급 차감도,
   '쉰 날' 집계도 붙지 않는다. 그 날을 연차로 찍어 놓아도 마찬가지다. */
function isRest(ds){
  const w = new Date(ds + "T00:00:00").getDay();
  return w === 0 || w === 6 || !!(B.holidays && B.holidays[ds]);
}
const consumeOn = (ds, k) => isRest(ds) ? 0 : (CONSUMES[k] || 0);
const deductOn  = (ds, k) => !isRest(ds) && (k in DEDUCTS);
const offOn     = (ds, k) => (isRest(ds) || !KINDS[k]) ? 0 : KINDS[k].off;

/* 쉬는 날에 일한 시간. 시각을 적었으면 그것, 근태 기록이 있으면 그것, 없으면 8시간 */
function restHours(ds){
  const tm = timesOf(ds), a = ATT.get(ds);
  return tm ? hoursBetween(tm.s, tm.e) : (a && a.hours) ? a.hours : B.dailyHours;
}
/* 휴일근로 법정 기준: 8시간까지 1.5배, 넘는 시간은 2배 (근로기준법 56조) */
const restPay = h => Math.round(B.hourly * (1.5 * Math.min(h, 8) + 2 * Math.max(0, h - 8)));

function restWorkOf(mo){
  const list = [];
  for (const ds of trackedDates()){
    if (monthOf(ds) !== mo || !isRest(ds) || !WORK_KINDS.has(kindOf(ds))) continue;
    const h = restHours(ds);
    if (h > 0) list.push({ ds, hours: h, pay: restPay(h) });
  }
  const hours = Math.round(list.reduce((a, x) => a + x.hours, 0) * 100) / 100;
  return { list, n: list.length, hours, pay: list.reduce((a, x) => a + x.pay, 0) };
}

// 급여에서 차감되는 분류 (명세서의 기본급 차감과 대조한다)
const DEDUCTS = { unpaid:1, coUnpaid:1 };   // 급여에서 깎이는 것

/* 그 달에 생긴 연차 일수 */
function accOf(mo){
  let n = 0;
  for (const e of accrualEvents()) if (monthOf(e.ds) === mo && e.ds <= TODAY) n += e.days;
  return n;
}
/* 그 달에 연차를 쓴 일수 (반차는 0.5) */
function useOf(mo){
  let u = 0;
  for (const ds of trackedDates())
    if (monthOf(ds) === mo) u += consumeOn(ds, kindOf(ds));
  return u;
}
/* 연차와 무관하게 무급으로 적어 둔 날 */
function flatUnpaidOf(mo){
  let n = 0;
  for (const ds of trackedDates())
    if (monthOf(ds) === mo && deductOn(ds, kindOf(ds))) n += 1;
  return n;
}
/* 그 달 발생분을 넘겨 쓴 일수 — 이미 수당으로 받아 둔 재고를 쓰는 것이라 급여에서 빠진다 */
function stockUseOf(mo){ return Math.max(0, useOf(mo) - accOf(mo)); }
/* 그 달 기본급에서 빠지는 시간 */
function deductHoursOf(mo){ return (flatUnpaidOf(mo) + stockUseOf(mo)) * B.dailyHours; }
/* 그 달에 현금으로 받을 연차수당 일수 */
function cashDaysOf(mo){ return Math.max(0, accOf(mo) - useOf(mo)); }

const iso = d => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");

/* 연차가 생기는 일정.
   1년 미만은 한 달 개근마다 1일씩, 최대 11일 (근로기준법 60조 2항).
   1년이 차면 15일이 한꺼번에 생기고 (60조 1항), 그 직전에 1년 미만 몫은
   전부 사라진다 (60조 7항, 2020.3.31 개정). */
function accrualEvents(){
  const [hy,hm,hd] = B.hireDate.split("-").map(Number), out = [];
  // 하루 앞당긴 날짜 — 만근해야 하는 기간의 끝은 발생일 전날이다
  const eve = d => { const x = new Date(d); x.setDate(x.getDate() - 1); return iso(x); };
  for (let k=1; k<=11; k++){
    const a = new Date(hy, hm-1+k-1, hd), z = new Date(hy, hm-1+k, hd);
    out.push({ ds: iso(z), days: 1, kind: "monthly", from: iso(a), to: eve(z) });
  }
  for (let y=1; y<=2; y++){
    const a = new Date(hy+y-1, hm-1, hd), z = new Date(hy+y, hm-1, hd);
    out.push({ ds: iso(z), days: 15, kind: "annual", from: iso(a), to: eve(z) });
  }
  return out.filter(e => e.ds <= B.serviceEnd);
}
/* "09.03~10.02" 처럼 짧게 */
const spanText = e => e.from.slice(5).replace("-", ".") + "~" + e.to.slice(5).replace("-", ".");
/* 1년 미만 연차가 사라지는 날 — 입사 1주년 하루 전 */
function expiryDate(){
  const [hy,hm,hd] = B.hireDate.split("-").map(Number);
  const d = new Date(hy+1, hm-1, hd); d.setDate(d.getDate() - 1);
  return iso(d);
}
function accrualDates(){                 // 이미 지난 것만
  return accrualEvents().filter(e => e.ds <= TODAY);
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

  const events = accrualEvents(), exp = expiryDate();
  let freeDays = 0, cutDays = 0;
  for (const mo of Object.keys(byMonth)){
    const cnt = byMonth[mo];
    // 그 달에 생기는 월 1일분까지는 급여가 깎이지 않는다
    const a = events.filter(e => e.kind === "monthly" && monthOf(e.ds) === mo)
                    .reduce((x, e) => x + e.days, 0);
    freeDays += Math.min(cnt, a);
    cutDays  += Math.max(0, cnt - a);
  }
  // 계획이 시작되기 전까지 더 쌓이는 몫. 1주년 전날 한 번 비워진다.
  let stock = from > exp ? 0 : Math.max(0, curBal);
  for (const e of events)
    if (e.ds > TODAY && e.ds < from && (from <= exp || e.ds > exp)) stock += e.days;
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

  const note = (cls, head, text) => {
    const w = document.createElement("div"); w.className = "ptip " + cls;
    const a = document.createElement("b"); a.textContent = head;
    const b = document.createElement("span"); b.textContent = text;
    w.append(a, b); out.appendChild(w);
  };
  if (from <= exp && to > exp)
    note("warn", "소멸일을 걸쳐 있습니다",
         exp.replace(/-/g,".") + " 에 1년 미만 연차가 사라지고 다음 날 15일이 새로 생깁니다. "
         + "걸쳐서 쉬면 계산이 달라지니 앞뒤로 나눠 잡는 편이 낫습니다.");
  else if (from > exp)
    note("", "1년차 이후 구간입니다",
         "15일이 한꺼번에 생긴 뒤라, 회사가 그것도 매달 수당으로 정산하는지는 아직 "
         + "확인되지 않았습니다. 아래 숫자는 지금 규칙을 그대로 적용한 추정입니다.");
}

function drawLeave(){
  const fmt = n => Math.round(n * 10) / 10;
  EXPIRY = expiryDate();

  /* 출처 1 — 법정 발생. 근로기준법 제60조 2항. */
  const accByMonth = {};
  for (const e of accrualDates()) accByMonth[monthOf(e.ds)] = (accByMonth[monthOf(e.ds)] || 0) + e.days;

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
  for (const e of accrualDates())
    detailRows.acc.push({ ds: e.ds, k: spanText(e) + " 만근 +" + e.days + "일" });
  for (const ds of trackedDates()){
    const mo = monthOf(ds), a = ATT.get(ds), base = a ? baseKind(a) : null;
    if ((base === "company" || base === "personal") && !overrides.has(ds))
      untouched[mo] = (untouched[mo] || 0) + 1;          // 엑셀 기본값 그대로인 휴무일
    const k = kindOf(ds);
    if (!(k in CONSUMES) || isRest(ds)) continue;      // 쉬는 날은 연차도 급여도 건드리지 않는다
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
    // 1년이 차면 그때까지 안 쓴 1년 미만 몫은 사라진다. 돈은 이미 수당으로
    // 받았으므로 금전 손해는 없고, 쉴 권리만 없어진다.
    let wiped = 0;
    if (mo === monthOf(EXPIRY) && bal > 0){ wiped = bal; bal = 0; }
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
    if (wiped) tag("un", "소멸 −" + fmt(wiped) + "일");
    if (acc)  tag("acc",  "발생 +" + acc);
    if (cash) tag("cash", "수당 " + cash + "일분");
    const d = detail[mo] || {};
    for (const k of ["personal","half","coAnnual","substitute","official","company"])
      if (d[k]) tag(k === "coAnnual" || k === "personal" || k === "half" ? "use" : "acc",
                     KO[k] + " " + d[k] + (k === "half" ? "회" : "일"));
    const stock = stockUseOf(mo);
    if (stock) tag("un", "모아둔 연차 " + fmt(stock) + "일 사용 → " + (stock * B.dailyHours) + "시간 차감");
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
  drawExpiry(rest);

  /* ── 경고 ── */
  const al = $("lvAlerts"); al.textContent = "";
  void 0;
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
let EXPIRY = '';
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

/* ── 구글 캘린더 ──
   구글 API 서버는 CORS 를 허용하므로 브라우저가 직접 부른다. 일정은 우리
   금고를 거치지 않고 구글과 이 기기 사이에서만 오간다. 토큰도 메모리에만
   둔다 — 한 시간이면 만료되고, 다시 받을 때는 조용히 갱신을 시도한다. */
const GC_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const GC_PICK = "salary.gcal.pick";     // 어떤 캘린더를 볼지 (이 기기에만 저장)
const GC_ON   = "salary.gcal.on";       // 전에 연결한 적이 있는지
const GC_TITLES = "salary.gcal.titles"; // 칸에 제목까지 적을지

let gcToken = null, gcClient = null, gcCals = [], gcQuiet = null;
let gcEvents = new Map();               // "2026-10-05" -> [{t, title, allDay}]  (시트용)
let gcSpans = [];                       // [{from, to, ...}]                  (달력 막대용)
let gcColors = null;                    // 구글이 쓰는 색표 — colorId 를 실제 색으로 푼다
let gcLoaded = new Set();               // 이미 받아 온 달

const gcTitles = () => { try { return localStorage.getItem(GC_TITLES) !== "0"; } catch { return true; } };
const gcPick = () => { try { return JSON.parse(localStorage.getItem(GC_PICK)) || null; } catch { return null; } };
/* 고른 것이 없으면 전부 본다. 빈 목록이 저장되면 아무것도 안 보이면서
   체크도 전부 풀려 빠져나올 수가 없기 때문이다. */
const gcUses = id => { const p = gcPick(); return !p || !p.length || p.includes(id); };
const gcSavePick = v => { try { localStorage.setItem(GC_PICK, JSON.stringify(v)); } catch {} };

function gcMsg(text, bad){
  const m = $("gcMsg");
  m.textContent = text || "";
  m.className = "gc-msg" + (bad ? " bad" : "");
  m.hidden = !text;
}

/* 토큰은 한 시간짜리다. 만료되면 동의 창 없이 한 번 다시 받아 보고,
   그래도 안 되면 그때만 버튼을 누르라고 한다. */
function gcQuietToken(){
  return new Promise(resolve => {
    if (!gcClient) return resolve(false);
    gcQuiet = resolve;
    try { gcClient.requestAccessToken({ prompt: "" }); }
    catch { gcQuiet = null; resolve(false); }
    setTimeout(() => { if (gcQuiet){ gcQuiet = null; resolve(false); } }, 8000);
  });
}

async function gcApi(path, params, retried){
  const u = new URL("https://www.googleapis.com/calendar/v3/" + path);
  for (const k in (params || {})) u.searchParams.set(k, params[k]);
  const r = await fetch(u, { headers: { authorization: "Bearer " + gcToken } });
  if (r.status === 401 || r.status === 403){
    gcToken = null;
    if (!retried && await gcQuietToken()) return gcApi(path, params, true);
    throw new Error("로그인이 만료되었습니다. 다시 연결해 주세요.");
  }
  if (!r.ok) throw new Error("구글 캘린더 오류 " + r.status);
  return r.json();
}

/* 하루 종일 일정은 끝 날짜가 하루 뒤로 적혀 온다. 그 규칙을 그대로 따른다. */
/* 일정 하나를 시작~끝 기간으로 만든다. 하루 종일 일정은 끝 날짜가
   하루 뒤로 적혀 오므로 그 규칙을 그대로 따른다. */
function gcSpan(ev, cal){
  const allDay = !!(ev.start && ev.start.date);
  const from = allDay ? ev.start.date : ev.start.dateTime.slice(0, 10);
  let to = allDay ? ev.end.date : (ev.end && ev.end.dateTime ? ev.end.dateTime.slice(0, 10) : from);
  if (allDay){                       // 끝 날짜를 하루 당긴다
    const d = new Date(to + "T00:00:00"); d.setDate(d.getDate() - 1); to = iso(d);
  }
  if (to < from) to = from;
  // 일정에 따로 색을 준 것이 있으면 그것을 먼저 쓴다
  const own = ev.colorId && gcColors && gcColors.event && gcColors.event[ev.colorId];
  return { calId: cal.id, from, to, allDay,
           t: allDay ? "" : ev.start.dateTime.slice(11, 16),
           title: ev.summary || "(제목 없음)",
           color: (own && own.background) || cal.color || "#8a7d7d" };
}

/* 고른 캘린더만 골라 날짜별 목록을 다시 만든다. 받아 둔 일정은 건드리지
   않으므로 체크를 껐다 켜도 다시 받아올 일이 없다. */
function gcRebuild(){
  gcEvents = new Map();
  for (const sp of gcSpans) if (gcUses(sp.calId)) gcFill(sp);
  for (const list of gcEvents.values())
    list.sort((a, b) => (a.allDay ? "" : a.t).localeCompare(b.allDay ? "" : b.t));
}

/* 기간을 날짜별 목록으로 펼친다 — 시트에서 그날 일정을 보여 줄 때 쓴다 */
function gcFill(sp){
  const d = new Date(sp.from + "T00:00:00"), last = new Date(sp.to + "T00:00:00");
  for (let i = 0; d <= last && i < 400; d.setDate(d.getDate() + 1), i++){
    const ds = iso(d);
    if (!gcEvents.has(ds)) gcEvents.set(ds, []);
    gcEvents.get(ds).push({ ds, allDay: sp.allDay, t: sp.t, title: sp.title, color: sp.color });
  }
}

/* 배경색이 밝으면 글씨를 어둡게 — 구글 캘린더 색이 밝은 것도 섞여 있다 */
function gcInk(hex){
  const c = String(hex || "").replace("#", "");
  if (c.length < 6) return "#ffffff";
  const r = parseInt(c.slice(0,2),16), g = parseInt(c.slice(2,4),16), b = parseInt(c.slice(4,6),16);
  return (r*0.299 + g*0.587 + b*0.114) > 150 ? "#1a1414" : "#ffffff";
}

/* 이 달에 걸치는 일정에 줄 번호를 매긴다. 같은 일정이 여러 칸에 걸쳐도
   늘 같은 줄에 오게 해야 막대가 이어져 보인다. */
function gcLanes(mo){
  const [y, m] = mo.split("-").map(Number);
  const pad = new Date(y, m-1, 1).getDay();          // 첫 주에 비는 칸 수
  const all = gcSpans.filter(s => gcUses(s.calId));
  const weeks = [];
  for (let w = 0; w < 6; w++){
    const ws = iso(new Date(y, m-1, 1 - pad + w*7));
    const we = iso(new Date(y, m-1, 1 - pad + w*7 + 6));
    // 길이는 '그 주 안에서 보이는 만큼' 으로 잰다. 전체 길이로 줄 세우면, 지난주부터 이어져
    // 이번 주 하루만 걸친 긴 일정이 위 줄을 차지하고 정작 이번 주 내내 이어지는 일정은 아래로 밀린다.
    const from = s => s.from > ws ? s.from : ws, to = s => s.to < we ? s.to : we;
    const days = s => (new Date(to(s)) - new Date(from(s))) / 864e5;
    const here = all.filter(s => s.to >= ws && s.from <= we)
      .sort((a, b) => days(b) - days(a)               // 이번 주에 더 길게 보이는 것을 위로
                   || (a.allDay === b.allDay ? 0 : (a.allDay ? -1 : 1))
                   || from(a).localeCompare(from(b))
                   || a.t.localeCompare(b.t));
    const lanesUsed = [], lane = new Map();          // 줄마다 이미 들어간 일정들
    for (const s of here){
      let i = 0;
      while (lanesUsed[i] && lanesUsed[i].some(o => o.from <= s.to && s.from <= o.to)) i++;
      (lanesUsed[i] = lanesUsed[i] || []).push(s); lane.set(s, i);
    }
    weeks.push({ here, lane });
  }
  return { pad, weeks };
}

async function gcLoadMonth(mo){
  if (!gcToken || gcLoaded.has(mo)) return;
  const use = gcCals;            // 전부 받아 두고 그릴 때 고른 것만 쓴다
  if (!use.length) return;
  const [y, m] = mo.split("-").map(Number);
  const from = new Date(y, m - 1, 1), to = new Date(y, m, 1);
  gcLoaded.add(mo);
  // 캘린더마다 차례로 기다리면 개수만큼 느려진다. 한꺼번에 보낸다.
  let got;
  try {
    got = await Promise.all(use.map(cal =>
      gcApi("calendars/" + encodeURIComponent(cal.id) + "/events", {
        timeMin: from.toISOString(), timeMax: to.toISOString(),
        singleEvents: "true",          // 반복 일정을 구글이 펼쳐서 준다
        orderBy: "startTime", maxResults: "250" }).then(r => [cal, r])));
  } catch (e){ gcLoaded.delete(mo); gcMsg(e.message, true); return; }
  for (const [cal, r] of got){
    for (const ev of (r.items || [])){
      if (ev.status === "cancelled" || !ev.start) continue;
      const sp = gcSpan(ev, cal);
      if (gcSpans.some(o => o.calId === sp.calId && o.from === sp.from
                         && o.to === sp.to && o.title === sp.title)) continue;
      gcSpans.push(sp);
    }
  }
  gcRebuild();
  drawCal();
}

function gcDrawCals(){
  const box = $("gcCals"); box.textContent = ""; box.hidden = !gcCals.length;
  for (const c of gcCals){
    const l = document.createElement("label"); l.className = "gc-cal";
    const i = document.createElement("input");
    i.type = "checkbox"; i.value = c.id;
    i.checked = gcUses(c.id);
    const dot = document.createElement("i"); dot.style.background = c.color || "var(--muted)";
    const t = document.createElement("span"); t.textContent = c.name;
    l.append(i, dot, t); box.appendChild(l);
  }
}

async function gcAfterToken(){
  try {
    const [r, colors] = await Promise.all([
      gcApi("users/me/calendarList", { minAccessRole: "reader" }),
      gcApi("colors").catch(() => null)]);
    gcColors = colors;
    gcCals = (r.items || []).map(c => ({ id: c.id, name: c.summary, color: c.backgroundColor }));
    gcDrawCals();
    const sw = $("gcShowTitles");
    sw.checked = gcTitles();
    $("gcTitleOpt").hidden = false;
    $("gcAgain").hidden = false;
    sw.onchange = () => {
      try { localStorage.setItem(GC_TITLES, sw.checked ? "1" : "0"); } catch {}
      drawCal();
    };
    $("gcConnect").textContent = "구글 캘린더 " + gcCals.length + "개";
    $("gcConnect").classList.add("done");
    gcMsg("");
    try { localStorage.setItem(GC_ON, "1"); } catch {}
    await gcLoadMonth(view);
  } catch (e){ gcMsg(e.message, true); }
}

function gcInit(){
  if (!B.gcalClientId) return;                 // 설정이 없으면 이 칸을 아예 숨긴다
  $("gcal").hidden = false;
  const ready = () => window.google && google.accounts && google.accounts.oauth2;
  const start = () => {
    gcClient = google.accounts.oauth2.initTokenClient({
      client_id: B.gcalClientId, scope: GC_SCOPE,
      callback: res => {
        const quiet = gcQuiet; gcQuiet = null;
        if (res.error){
          if (quiet) return quiet(false);        // 조용히 받아 보려던 것이면 말없이 넘어간다
          gcMsg("연결하지 못했습니다: " + res.error, true); return;
        }
        gcToken = res.access_token;
        if (quiet){ gcMsg(""); return quiet(true); }
        gcAfterToken();
      } });
    // 전에 연결한 적이 있으면 동의 창 없이 조용히 받아 본다
    let was = null; try { was = localStorage.getItem(GC_ON); } catch {}
    if (was) gcClient.requestAccessToken({ prompt: "" });
  };
  if (ready()) start();
  else { let k = 0; const t = setInterval(() => { if (ready() || ++k > 40){ clearInterval(t); if (ready()) start(); } }, 150); }

  // 체크박스는 다시 그려도 상자 자체는 그대로이므로 여기서 한 번만 단다
  $("gcCals").addEventListener("change", () => {
    gcSavePick([...$("gcCals").querySelectorAll("input:checked")].map(i => i.value));
    gcRebuild();                       // 다시 받아오지 않는다 — 거르기만 한다
    gcDrawCals();                      // 빈 목록이면 전부 켜진 모습으로 되돌아간다
    drawCal();
  });

  const openPanel = on => {
    $("gcPanel").hidden = !on;
    $("gcConnect").setAttribute("aria-expanded", String(on));
    $("gcConnect").classList.toggle("on", on);
  };
  $("gcConnect").addEventListener("click", () => {
    if (!gcClient){ gcMsg("구글 로그인 스크립트를 아직 불러오는 중입니다.", true); return; }
    if (gcToken) return openPanel($("gcPanel").hidden);   // 이미 연결됐으면 판을 연다
    gcClient.requestAccessToken({ prompt: "consent" });
  });
  $("gcAgain").addEventListener("click", () => gcClient.requestAccessToken({ prompt: "consent" }));
  document.addEventListener("click", e => {              // 바깥을 누르면 닫는다
    if (!$("gcPanel").hidden && !e.target.closest(".gcwrap")) openPanel(false);
  });
}

/* ── 소멸 예정 ──
   1년 미만 연차는 입사 1주년 전날 한꺼번에 사라진다. 돈은 매달 수당으로
   받아 두었으므로 금전 손해는 없지만, 그때까지 안 쓰면 쉴 기회가 없어진다. */
function drawExpiry(rest){
  const box = $("lvExpiry");
  if (TODAY > EXPIRY){ box.hidden = true; return; }   // 이미 1년차로 넘어갔다
  const left = Math.round((new Date(EXPIRY+"T00:00:00") - new Date(TODAY+"T00:00:00")) / 864e5);
  const coming = accrualEvents()
    .filter(e => e.kind === "monthly" && e.ds > TODAY && e.ds <= EXPIRY)
    .reduce((a, e) => a + e.days, 0);
  const total = Math.round((Math.max(0, rest) + coming) * 10) / 10;

  box.textContent = ""; box.hidden = false;
  const t = document.createElement("div"); t.className = "exp-t";
  t.textContent = "1년 미만 연차 소멸까지";
  const d = document.createElement("div"); d.className = "exp-d num";
  d.textContent = EXPIRY.replace(/-/g, ".") + "  ·  D-" + left;
  const s = document.createElement("div"); s.className = "exp-s";
  s.textContent = coming
    ? "지금 " + (Math.round(rest*10)/10) + "일 + 앞으로 " + coming + "일 = 그날까지 최대 " + total + "일을 쓸 수 있습니다."
    : "남은 " + (Math.round(rest*10)/10) + "일을 그날까지 쓰지 않으면 사라집니다.";
  box.append(t, d, s);

  const next = accrualEvents().find(e => e.ds > TODAY);
  if (next){
    const days = Math.round((new Date(next.ds+"T00:00:00") - new Date(TODAY+"T00:00:00")) / 864e5);
    const g = document.createElement("div"); g.className = "exp-s";
    g.textContent = "다음 연차는 " + spanText(next) + " 를 만근하면 "
      + next.ds.replace(/-/g, ".") + " 에 " + next.days + "일 생깁니다 (D-" + days + ").";
    box.appendChild(g);
  }
  const grant = accrualEvents().find(e => e.kind === "annual");
  if (grant){
    const g = document.createElement("div"); g.className = "exp-s";
    g.textContent = grant.from.replace(/-/g, ".") + " ~ " + grant.to.replace(/-/g, ".")
      + " 1년을 채우면, 그 다음 날 " + grant.ds.replace(/-/g, ".") + " 에 15일이 새로 생깁니다.";
    box.appendChild(g);
  }
}

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
  const shown = (k === "weekend" || k === "holiday") ? "dayoff" : k;   // 기본값은 '쉬는 날' 로 보인다
  const dt = new Date(ds+"T00:00:00");
  $("shTitle").textContent = ds.replace(/-/g,".") + " (" + "일월화수목금토"[dt.getDay()] + ")";
  const hol = a?.holiday || (B.holidays && B.holidays[ds]);
  const tm = timesOf(ds);
  $("shSub").textContent = tm
    ? tm.s + " ~ " + tm.e + " · " + hoursBetween(tm.s, tm.e) + "시간" + (tm.mine ? " (직접 적음)" : "")
    : (hol || "출근 기록 없음");
  const keep = $("shTimes");
  if (keep) $("sheet").appendChild(keep);      // 지워지지 않게 잠시 밖으로
  const evs = gcEvents.get(ds) || [];
  deferred = evs.length > 0;
  pendKind = shown;
  const tm0 = timesOf(ds);
  pendTimes = tm0 && tm0.mine ? { s: tm0.s, e: tm0.e } : null;
  $("shSave").hidden = !deferred;
  $("shClose").classList.toggle("pri", !deferred);
  $("shClose").textContent = deferred ? "취소" : "닫기";
  drawSheetBal(k, ds);
  drawSheetEvents(ds);
  const box = $("shOpts"); box.textContent = "";
  for (const g of GROUPS){
    const h = document.createElement("div"); h.className = "opt-h"; h.textContent = g.title;
    box.appendChild(h);
    const row = document.createElement("div"); row.className = "opt-row";
    for (const key of g.kinds){
      const K = KINDS[key];
      const b = document.createElement("button");
      b.type = "button"; b.className = "opt"; b.dataset.kind = key;
      b.setAttribute("aria-pressed", String(shown === key));
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
/* 그날 구글 캘린더 일정 */
function drawSheetEvents(ds){
  const box = $("shEvents"); box.textContent = "";
  const list = gcEvents.get(ds);
  box.hidden = !(list && list.length);
  $("shEvHead").hidden = box.hidden;
  if (box.hidden) return;
  $("shEvHead").textContent = "이 날 일정 " + list.length + "개";
  for (const e of list){
    const r = document.createElement("div"); r.className = "shev";
    const i = document.createElement("i"); i.style.background = e.color || "var(--muted)";
    const t = document.createElement("span"); t.className = "shev-t num";
    t.textContent = e.allDay ? "종일" : e.t;
    const s = document.createElement("span"); s.className = "shev-s"; s.textContent = e.title;
    r.append(i, t, s); box.appendChild(r);
  }
}

/* 이 날을 연차로 잡으면 얼마가 깎이는지 미리 알려 준다. */
function drawSheetBal(k, ds){
  const acc = ds && accrualEvents().find(e => e.ds === ds);
  const box = $("shBal");
  if (ds && isRest(ds)){                     // 쉬는 날 — 연차 계산이 붙지 않는다
    const why = holName(ds) || "주말";
    const grew0 = acc ? spanText(acc) + " 만근으로 이 날 연차 " + acc.days + "일 생김 · " : "";
    box.className = "shbal calm";
    box.textContent = grew0 + (WORK_KINDS.has(k)
      ? "쉬는 날(" + why + ")에 일하면 휴일근로입니다 · 법정 기준 약 " + WON(restPay(restHours(ds)))
        + "원 (추정, 대체휴무로 갈음하면 없음)"
      : "쉬는 날(" + why + ")이라 연차도 급여도 깎이지 않습니다");
    box.hidden = false;
    return;
  }
  const already = CONSUMES[k] || 0;        // 이미 연차로 잡혀 있던 몫은 되돌려 센다
  const free = Math.round((curBal + already) * 10) / 10;
  box.className = "shbal" + (free >= 1 ? "" : " warn");
  const grew = acc ? spanText(acc) + " 만근으로 이 날 연차 " + acc.days + "일 생김 · " : "";
  box.textContent = grew + (free >= 1
    ? "쓸 수 있는 연차 " + free + "일"
    : "쓸 수 있는 연차 " + free + "일 — 하루를 연차로 잡으면 "
      + (Math.round((1 - free) * 10) / 10) + "일이 모자라 약 "
      + WON((1 - free) * B.dayPay) + "원이 깎입니다");
  box.hidden = false;
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
  if (deferred){ pendKind = k; pendTimes = { s: a, e: b }; }
  else setKind(picked, k, { s: a, e: b });
  markOpt(k);
  $("shSub").textContent = a + " ~ " + b + " · " + hoursBetween(a, b) + "시간 (직접 적음)";
}

/* 일정이 있는 날은 곧바로 저장하지 않고 '저장하기' 를 누를 때 확정한다.
   일정을 읽다가 잘못 눌러 기록이 바뀌는 일을 막기 위해서다. */
let deferred = false, pendKind = null, pendTimes = null;

function markOpt(k){
  for (const el of $("shOpts").querySelectorAll(".opt"))
    el.setAttribute("aria-pressed", String(el.dataset.kind === k));
  if (picked && isRest(picked)) drawSheetBal(k, picked);    // 고른 종류에 맞춰 안내를 바꾼다
}

/* '쉬는 날' 을 고르면, 그 날의 원래 모습이 주말·공휴일일 때는 기록을 지워
   기본값으로 되돌린다. 평일이면 '쉬는 날' 로 남긴다. */
function storeKind(ds, k, times){
  const d = defaultKind(ds);
  if (k === "dayoff" && (d === "weekend" || d === "holiday")) return setKind(ds, null);
  return setKind(ds, k, times);
}
function commitSheet(){
  if (picked && pendKind) storeKind(picked, pendKind, pendTimes);
  closeSheet();
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
    if (k !== "기본급" && k !== "연차수당" && !/휴일|가산|연장|야간/.test(k)) fixed[k] = v;
  // 그 달 발생분을 안 쓰면 그만큼 연차수당으로 나온다
  const cash = Math.round(cashDaysOf(target) * B.dayPay);

  const earn = [["기본급", base], ...Object.entries(fixed)];
  if (cash) earn.push(["연차수당", cash, true]);
  const rw = restWorkOf(target);
  if (rw.pay) earn.push(["휴일근로수당", rw.pay, true, rw.n + "일 · " + rw.hours + "시간 × 1.5배 (쉬는 날 근무)"]);
  const gross = earn.reduce((a, e) => a + e[1], 0);

  const ded = {};
  for (const [k, v] of Object.entries(last.deductions)) ded[k] = v;
  ded["고용보험"] = Math.floor(gross * 0.009 / 10) * 10;
  const dedTotal = Object.values(ded).reduce((a, b) => a + b, 0);

  const t = $("fcTable"); t.textContent = "";
  const row = (label, val, cls, guess, note) => {
    const tr = document.createElement("tr");
    if (cls) tr.className = cls;
    const a = document.createElement("td");
    a.textContent = label;
    if (guess){ const g = document.createElement("span"); g.className = "guess"; g.textContent = "추정"; a.appendChild(g); }
    if (note){ const s = document.createElement("small"); s.textContent = note; a.appendChild(s); }
    const b = document.createElement("td");
    b.textContent = (cls === "minus" ? "−" : "") + WON(Math.abs(val)) + "원";
    tr.append(a, b); t.appendChild(tr);
  };
  const fullH = B.fullBase / B.hourly;                 // 만근 소정근로시간 (209)
  for (const [k, v, g, nt] of earn)
    row(k, v, null, g, nt || (k === "기본급" && deductH
      ? fullH + "시간 − " + deductH + "시간 = " + (fullH - deductH) + "시간"
      : k === "기본급" ? fullH + "시간 (만근)" : null));
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
      // 나중 날을 먼저 골랐으면 둘을 뒤집는다
      const first = $("plFrom").value;
      if (ds < first){ $("plFrom").value = ds; $("plTo").value = first; }
      else $("plTo").value = ds;
      planPick = 0; planSaved = null;
    }
    syncPick(); drawCal(); drawPlan(); return;
  }
  openSheet(b.dataset.date);
});

let planSaved = null;                    // 고르기를 시작할 때의 값 — 취소하면 되돌린다

function syncPick(){
  const b = $("plPick");
  b.classList.toggle("on", !!planPick);
  b.textContent = planPick === 1 ? "시작할 날을 누르세요 (취소)"
                : planPick === 2 ? "끝날 날을 누르세요 (취소)"
                : "달력에서 고르기";
  $("plClear").hidden = !!planPick || !($("plFrom").value || $("plTo").value);
}
$("plPick").addEventListener("click", () => {
  if (planPick){                         // 고르는 중이었다면 취소 — 원래대로 되돌린다
    planPick = 0;
    $("plFrom").value = planSaved ? planSaved.from : "";
    $("plTo").value   = planSaved ? planSaved.to   : "";
  } else {
    planSaved = { from: $("plFrom").value, to: $("plTo").value };
    planPick = 1;
    $("plFrom").value = ""; $("plTo").value = "";
  }
  syncPick(); drawCal(); drawPlan();
  if (planPick) $("calSec").scrollIntoView({ behavior:"smooth", block:"start" });
});
$("plClear").addEventListener("click", () => {
  planPick = 0; planSaved = null;
  $("plFrom").value = ""; $("plTo").value = "";
  syncPick(); drawCal(); drawPlan();
});
for (const id of ["plFrom","plTo"]) $(id).addEventListener("change", () => { syncPick(); drawCal(); drawPlan(); });
$("shOpts").addEventListener("click", e => {
  const b = e.target.closest(".opt"); if (!b || !picked) return;
  const k = b.dataset.kind;
  markOpt(k);
  if (deferred){                          // 일정이 있는 날 — 저장 단추로 확정한다
    pendKind = k;
    if (!WORK_KINDS.has(k)) pendTimes = null;
    syncTimes(picked, k);
    return;
  }
  if (WORK_KINDS.has(k)){                 // 출근이면 시각을 적을 수 있게 열어 둔다
    const tm = timesOf(picked);
    setKind(picked, k, tm && tm.mine ? tm : null);
    syncTimes(picked, k);
    return;
  }
  storeKind(picked, k); closeSheet();
});
$("shSave").addEventListener("click", commitSheet);
for (const id of ["shStart", "shEnd"]) $(id).addEventListener("change", saveTimes);
$("shClose").addEventListener("click", closeSheet);
$("scrim").addEventListener("click", closeSheet);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });
$("prev").addEventListener("click", () => { closePicker(); view = shift(view,-1); drawCal(); });
$("next").addEventListener("click", () => { closePicker(); view = shift(view, 1); drawCal(); });
function gcOnView(){
  if (!gcToken) return;
  gcLoadMonth(view);
  for (const d of [-1, 1]) gcLoadMonth(shift(view, d));   // 앞뒤 달을 미리 받아 둔다
}

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
  // 둘은 서로를 기다릴 이유가 없다. 같이 보내면 왕복이 한 번으로 준다.
  const [bundle, lv] = await Promise.all([apiCall("bundle", "GET"), apiCall("leave", "GET")]);
  if (!bundle || !Array.isArray(bundle.payslips))
    throw new Error("데이터가 아직 올라가지 않았습니다 (python src/push_data.py 를 먼저 실행하세요)");
  B = bundle;
  overrides = new Map(Object.entries(lv || {}).filter(([, v]) => kindName(v)));
}

/* ── 시안 고르는 줄 ──
   주소에 ?palette= 가 있을 때만 나온다. 고른 것은 주소와 이 기기에 남는다. */
function initPalettePicker(){
  if (new URLSearchParams(location.search).get("palette") === null) return;
  const bar = document.createElement("div"); bar.className = "palpick";
  const set = v => {
    if (v) document.documentElement.dataset.palette = v; else delete document.documentElement.dataset.palette;
    try { localStorage.setItem("salary.palette", v); } catch {}
    const u = new URL(location.href); u.searchParams.set("palette", v); history.replaceState(null, "", u);
    for (const b of bar.children) b.setAttribute("aria-pressed", String((b.dataset.v || "") === v));
    relayout();
  };
  for (const [v, t] of [["", "기본"], ["a", "A 페이퍼"], ["b", "B 슬레이트"], ["c", "C 블루"]]){
    const b = document.createElement("button"); b.type = "button"; b.dataset.v = v; b.textContent = t;
    b.setAttribute("aria-pressed", String((document.documentElement.dataset.palette || "") === v));
    b.addEventListener("click", () => set(v)); bar.appendChild(b);
  }
  document.body.appendChild(bar);
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
  gcInit();
  initPalettePicker();
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
