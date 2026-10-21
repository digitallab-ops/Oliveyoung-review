
(function(){
var P = JSON.parse(document.getElementById('payload').textContent);
var G = P.gen, META = G.meta, TYPES = G.types;
var DIS = P.dissect, LINES = P.lines, LMETA = P.meta;
var X = P.extra, CERT = X.certs, TAXO = X.taxonomy;
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function nf(n){ return Number(n).toLocaleString(); }

// ── 사람 말로 옮기는 사전 ──
var ROLE = {
  '기획증정': ['기획·증정 혜택', '1+1, 증정품 같은 구매 혜택을 맨 위에 크게 보여줍니다.'],
  '후킹': ['첫 화면 한 줄', '이 제품이 뭔지 한 문장으로. 스크롤을 멈추게 하는 자리예요.'],
  '실적소구': ['판매 실적', '랭킹·누적 판매량 같은 숫자로 "이미 많이 팔렸다"를 보여줍니다.'],
  '후기소셜': ['고객 후기', '실제 구매 후기와 평점을 인용해 믿음을 줍니다.'],
  '문제제기': ['고객 고민 꺼내기', '"이런 고민 있으시죠?" 하고 고객이 겪는 불편을 먼저 짚습니다.'],
  '핵심소구': ['핵심 효과', '제품의 핵심 효과 2~3개를 하나씩 크게. 페이지에서 가장 긴 부분이에요.'],
  '임상인증': ['시험·인증 근거', '인체적용시험 결과, 저자극 테스트, 인증마크로 효과를 증명합니다.'],
  '성분': ['성분 설명', '핵심 성분이 뭔지, 왜 좋은지, 얼마나 들었는지 보여줍니다.'],
  '비교': ['전후 비교', '사용 전후 사진이나 비교표로 차이를 눈으로 보여줍니다.'],
  '제형텍스처': ['제형·발림', '손등에 바르는 시연 컷으로 질감과 발림을 보여줍니다.'],
  '라인업옵션': ['라인업·옵션 고르기', '색상·타입이 여럿이면 나에게 맞는 걸 고르는 법을 정리합니다.'],
  '사용법': ['사용 방법', '언제, 얼마나, 어떻게 바르는지 알려줍니다.'],
  '브랜드': ['브랜드 소개', '어떤 브랜드인지, 이 라인이 왜 만들어졌는지 짧게.'],
  '안내': ['제품 정보·주의사항', '전성분, 용량, 사용기한, 주의사항 같은 필수 고지. 맨 끝에 둡니다.'],
  '판매처안내': ['공식 판매처 안내', '정품 구매처를 안내합니다.']
};
function rname(r){ return (ROLE[r] || [r])[0]; }
function rguide(r){ return (ROLE[r] || [r,''])[1]; }
var TONE = {'선언형':'짧고 단정하게','설명형':'풀어서 설명','수치형':'숫자를 앞세워','공감형':'고객 입장에서 공감',
  '질문형':'질문으로 시작','명령형':'하라고 안내'};
var VIS = {'제품컷':'제품 사진','모델컷':'모델 사진','시연컷':'발림 시연 컷','인포그래픽':'그림으로 정리',
  '그래프':'그래프','비교표':'비교표·전후 컷','텍스트':'글 위주'};
var EVN = {'시험결과':'시험 결과','성분함량':'성분 함량','판매실적':'판매 실적','후기인용':'후기 인용',
  '전후사진':'전후 사진','인증마크':'인증마크'};
function tone(c){ return TONE[c] || c; }
function vis(v){ return VIS[v] || v; }
function freq(a){ var n = Math.round(a/10); return n >= 10 ? '거의 모든 페이지가 넣음' : '10곳 중 ' + Math.max(1,n) + '곳이 넣음'; }
function cuts(p){ return p < 1.5 ? '1컷' : '약 ' + Math.round(p) + '컷'; }

var GROUP = {'후킹':'hook','기획증정':'hook','실적소구':'hook','핵심소구':'claim',
  '문제제기':'prob','후기소셜':'prob','임상인증':'proof','성분':'ing',
  '제형텍스처':'ing','비교':'cmp','라인업옵션':'cmp','사용법':'cmp',
  '브랜드':'brand','안내':'info','판매처안내':'info'};
var GNAME = {hook:'도입', prob:'공감·후기', claim:'핵심 효과', ing:'성분·제형',
  proof:'증명', cmp:'비교·사용', brand:'브랜드', info:'안내'};
var ORDER = ['hook','prob','claim','ing','proof','cmp','brand','info'];
function grp(r){ return GROUP[r] || 'info'; }
function gv(k){ return 'var(--g-' + k + ')'; }

$('prov').textContent = '근거: 올리브영 상세페이지 ' + META.nProd + '개 상품을 ' + nf(META.nSec) +
  '개 구간으로 잘라 분류 · 2026년 10월 수집';

// ── 상태 ──
var PROOFS = [{k:'clinical',t:'인체적용시험'},{k:'ingredient',t:'성분 함량 수치'},
  {k:'sales',t:'판매 실적·랭킹'},{k:'review',t:'실사용 후기'},
  {k:'beforeafter',t:'전후 비교 컷'},{k:'cert',t:'인증마크'},{k:'demo',t:'제형 시연 컷'}];
var S;
function fresh(){
  return {type: TYPES['선크림'] ? '선크림' : '전체', proofs:{}, drafts:{}, notes:{}, removed:{}, order:null, open:{}};
}
S = fresh();

// 1단계: 유형 칩
function drawTypes(){
  $('typeChips').innerHTML = Object.keys(TYPES).map(function(k){
    var t = TYPES[k], lab = k === '전체' ? '아직 미정' : t.label;
    return '<label class="chip"><input type="radio" name="ptype" value="' + esc(k) + '"' +
      (S.type === k ? ' checked' : '') + '>' + esc(lab) + ' <small>' + t.nProd + '</small></label>';
  }).join('');
}
drawTypes();
$('typeChips').addEventListener('change', function(e){
  if(e.target.name === 'ptype'){ S.type = e.target.value; S.order = null; S.removed = {}; render(); }
});
// 2단계: 자료 칩
function drawProofs(){
  $('proofChips').innerHTML = PROOFS.map(function(p){
    return '<label class="chip"><input type="checkbox" value="' + p.k + '"' + (S.proofs[p.k] ? ' checked' : '') +
      '>' + esc(p.t) + '</label>';
  }).join('');
}
drawProofs();
$('proofChips').addEventListener('change', function(e){
  S.proofs[e.target.value] = e.target.checked; render();
});
$('f_promo').addEventListener('change', function(){ render(); });
$('f_name').addEventListener('input', function(){ drawSummary(); });

function val(id){ return $(id).value.trim(); }
function form(){
  return {name: val('f_name') || '(제품명 미정)', ing: val('f_ing'), pos: val('f_pos'),
    promo: val('f_promo'), spf: val('f_spf'), price: val('f_price'), target: val('f_target'),
    rival: val('f_rival'), app: val('f_app'), intent: val('f_intent')};
}

// ── 구성 계산 ──
var cur = {slots:[], out:[], T:null};
function build(){
  var T = TYPES[S.type] || TYPES['전체'], f = form(), has = S.proofs;
  var slots = [], out = [];
  T.slots.forEach(function(s){
    var o = {}; for(var k in s) o[k] = s[k];
    o.flag = null; o.canDrop = false;
    if(s.role === '기획증정' && !f.promo) return;           // 단품이면 아예 없음
    if(s.needs === 'clinical' && !has.clinical){
      o.flag = '인체적용시험 결과가 필요한 칸이에요. 경쟁사 ' + s.adopt + '%가 넣는 자리라 비면 티가 납니다. 성분 함량이나 인증마크로 대신하거나, 시험 의뢰 여부를 먼저 정하세요.';
    } else if(s.needs === 'sales' && !has.sales){
      o.flag = '내세울 판매 실적이 없으면 빼는 게 낫습니다. 근거 없는 "1위" 표현은 표시광고법 위반이에요.';
      o.canDrop = true;
    } else if(s.needs === 'review' && !has.review){
      o.flag = '후기가 아직 없으면 출시 땐 비워 두고, 리뷰가 쌓인 뒤 추가하는 게 일반적이에요.';
      o.canDrop = true;
    } else if(s.needs === 'beforeafter' && !has.beforeafter){
      o.flag = '전후 비교 컷이 없으면 제형·사용감 비교표로 대신할 수 있어요.';
    } else if(s.role === '제형텍스처' && !has.demo){
      o.flag = '제형 시연 컷 촬영이 필요한 칸이에요.';
    }
    if(S.removed[s.role]) out.push(o); else slots.push(o);
  });
  if(S.order){
    var idx = {}; S.order.forEach(function(r, i){ idx[r] = i; });
    slots.sort(function(a,b){
      var ia = idx[a.role] === undefined ? 999 + a.pos : idx[a.role];
      var ib = idx[b.role] === undefined ? 999 + b.pos : idx[b.role];
      return ia - ib;
    });
  }
  cur = {slots: slots, out: out, T: T};
}
function total(){ return Math.round(cur.slots.reduce(function(a,s){ return a + s.per; }, 0)); }

// ── 그리기 ──
function drawSummary(){
  var f = form(), nFlag = cur.slots.filter(function(s){ return s.flag; }).length;
  var tlab = S.type === '전체' ? '유형 미정(전체 평균)' : cur.T.label;
  $('sumt').innerHTML = '<b>' + esc(f.name) + '</b><br>' + esc(tlab) + ' ' + cur.T.nProd +
    '개를 참고한 구성 · <b style="font-size:inherit">' + cur.slots.length + '칸</b>, 이미지 약 ' + total() + '컷 분량 ' +
    (nFlag ? '<span class="pill w">자료 확인 필요 ' + nFlag + '칸</span>'
           : '<span class="pill o">필요한 자료 다 있음</span>');
}
function slotHTML(s, i, n){
  var g = grp(s.role), open = !!S.open[s.role];
  var dr = S.drafts[s.role] || [], note = S.notes[s.role] || '';
  var nd = dr.filter(Boolean).length;
  var spec = '<span class="sp"><b>말투</b>' + esc(tone(s.copy[0][0])) + '</span>' +
    '<span class="sp"><b>그림</b>' + esc(vis(s.vis[0][0])) + '</span>' +
    '<span class="sp"><b>분량</b>' + cuts(s.per) + '</span>' +
    (s.ev && s.evRate >= 50 ? '<span class="sp"><b>근거</b>' + esc(EVN[s.ev[0][0]] || s.ev[0][0]) + '</span>' : '') +
    '<span class="sp freq">' + freq(s.adopt) + '</span>';
  var body = !open ? '' :
    '<div class="bd">' +
      '<div><div class="cap">경쟁사는 이렇게 썼어요 · 말투만 참고</div><div class="exs">' +
        s.ex.slice(0,4).map(function(e){ return '<div class="ex"><span>' + esc(e.t) + '</span><small>' + esc(e.b) + '</small></div>'; }).join('') +
      '</div></div>' +
      '<div><div class="cap">이 자리에서 자주 쓰는 단어</div><div class="terms">' +
        s.terms.slice(0,9).map(function(t){ return '<span class="tm">' + esc(t) + '</span>'; }).join('') + '</div></div>' +
      '<div><div class="cap">우리 문구 <span class="caution">AI가 쓴 건 사실·표현 검토 필요</span></div><div class="drs">' +
        dr.map(function(t, j){
          return '<div class="dr"><input type="text" data-dr="' + j + '" value="' + esc(t) + '" aria-label="우리 문구 ' + (j+1) + '">' +
            '<button type="button" data-dcp="' + j + '">복사</button><button type="button" data-ddel="' + j + '" aria-label="삭제">✕</button></div>';
        }).join('') + '</div>' +
        '<div class="acts" style="margin-top:8px">' +
          '<button class="btn" type="button" data-add="1">+ 직접 쓰기</button>' +
          '<button class="btn ai" type="button" data-ai="1">AI로 3개 뽑기</button>' +
          '<button class="btn" type="button" data-cp="1">이 칸 복사</button>' +
          '<span class="hint" data-st="1"></span></div></div>' +
      '<div><div class="cap">메모</div><textarea class="note" data-note="1" placeholder="이 칸에 대한 결정·요청사항" aria-label="메모">' + esc(note) + '</textarea></div>' +
    '</div>';
  return '<article class="blk' + (s.flag ? ' flag' : '') + '" data-r="' + esc(s.role) + '" id="b' + i + '">' +
    '<div class="bh"><span class="bn" style="background:' + gv(g) + '">' + (i+1) + '</span>' +
      '<div class="bt"><h3>' + esc(rname(s.role)) + '<small>' + esc(GNAME[g]) + '</small></h3><p>' + esc(rguide(s.role)) + '</p></div>' +
      '<div class="ops"><button class="op" type="button" data-mv="-1" aria-label="위로"' + (i===0?' disabled':'') + '>↑</button>' +
        '<button class="op" type="button" data-mv="1" aria-label="아래로"' + (i===n-1?' disabled':'') + '>↓</button>' +
        '<button class="op" type="button" data-rm="1" aria-label="이 칸 빼기">✕</button></div></div>' +
    '<div class="spec">' + spec + '</div>' +
    (s.flag ? '<div class="warnbox">' + esc(s.flag) + (s.canDrop ? '<button type="button" data-rm="1">이 칸 빼기</button>' : '') + '</div>' : '') +
    '<button class="tog" type="button" data-tog="1" aria-expanded="' + open + '">' +
      (open ? '접기' : '예시 문구 보고 우리 문구 쓰기') + (nd ? ' <span class="cnt">우리 문구 ' + nd + '</span>' : '') +
      '<span class="car">▾</span></button>' + body + '</article>';
}
function render(){
  build();
  drawSummary();
  var mix = {};
  cur.slots.forEach(function(s){ mix[grp(s.role)] = 1; });
  $('legend').innerHTML = ORDER.filter(function(k){ return mix[k]; }).map(function(k){
    return '<span><em style="background:' + gv(k) + '"></em>' + GNAME[k] + '</span>'; }).join('');
  var tot = cur.slots.reduce(function(a,s){ return a + s.per; }, 0) || 1, H = 380;
  $('map').innerHTML = cur.slots.map(function(s, i){
    var h = Math.max(7, Math.round(s.per / tot * H));
    return '<button class="mb' + (s.flag ? ' flag' : '') + '" type="button" tabindex="-1" data-go="' + i + '" title="' +
      esc((i+1) + '. ' + rname(s.role)) + '" style="height:' + h + 'px;background-color:' + gv(grp(s.role)) + '"></button>';
  }).join('');
  $('mapfoot').textContent = '약 ' + total() + '컷';
  $('list').innerHTML = cur.slots.map(function(s, i){ return slotHTML(s, i, cur.slots.length); }).join('');
  $('outs').innerHTML = cur.out.length ? '<div class="outs"><div class="cap">뺀 칸 · 누르면 다시 넣어요</div><div class="chips">' +
    cur.out.map(function(s){ return '<button type="button" data-back="' + esc(s.role) + '">+ ' + esc(rname(s.role)) + '</button>'; }).join('') +
    '</div></div>' : '';
}

// ── 편집 ──
$('map').addEventListener('click', function(e){
  var b = e.target.closest('[data-go]'); if(!b) return;
  var s = cur.slots[+b.dataset.go]; if(!s) return;
  S.open[s.role] = true; render();
  var el = $('b' + b.dataset.go); if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
});
$('outs').addEventListener('click', function(e){
  var b = e.target.closest('[data-back]'); if(!b) return;
  delete S.removed[b.dataset.back]; render();
});
$('list').addEventListener('click', function(e){
  var btn = e.target.closest('button'); if(!btn) return;
  var card = btn.closest('.blk'); if(!card) return;
  var role = card.dataset.r, i = -1;
  cur.slots.forEach(function(s, j){ if(s.role === role) i = j; });
  if(i < 0) return;
  if(btn.dataset.tog){ S.open[role] = !S.open[role]; render(); var c = document.querySelector('.blk[data-r="' + role + '"] .tog'); if(c) c.focus(); return; }
  if(btn.dataset.mv){
    var to = i + (+btn.dataset.mv); if(to < 0 || to >= cur.slots.length) return;
    var arr = cur.slots.map(function(s){ return s.role; });
    var t = arr[i]; arr[i] = arr[to]; arr[to] = t; S.order = arr; render(); return;
  }
  if(btn.dataset.rm){ S.removed[role] = true; render(); return; }
  if(btn.dataset.add){
    S.drafts[role] = (S.drafts[role] || []).concat(['']); render();
    var inp = document.querySelector('.blk[data-r="' + role + '"] input[data-dr="' + (S.drafts[role].length-1) + '"]');
    if(inp) inp.focus(); return;
  }
  if(btn.dataset.ddel !== undefined){ S.drafts[role].splice(+btn.dataset.ddel, 1); render(); return; }
  if(btn.dataset.dcp !== undefined){
    copyText(S.drafts[role][+btn.dataset.dcp], null);
    btn.textContent = '복사됨'; setTimeout(function(){ btn.textContent = '복사'; }, 1400); return;
  }
  if(btn.dataset.cp){ copyText(slotText(cur.slots[i], i), card.querySelector('[data-st]')); return; }
  if(btn.dataset.ai){ genOne(role, btn, card.querySelector('[data-st]')); return; }
});
$('list').addEventListener('input', function(e){
  var el = e.target, card = el.closest('.blk'); if(!card) return;
  var role = card.dataset.r;
  if(el.dataset.dr !== undefined){ S.drafts[role][+el.dataset.dr] = el.value; }
  else if(el.dataset.note !== undefined){ S.notes[role] = el.value; }
});
$('reset').onclick = function(){
  Array.prototype.forEach.call(document.querySelectorAll('.panel input[type=text], .panel textarea'), function(i){ i.value = ''; });
  $('f_promo').value = '';
  S = fresh(); drawTypes(); drawProofs(); render(); $('actHint').textContent = '';
};

// ── 글로 내보내기 ──
function productBlock(f){
  var L = [];
  if(f.pos) L.push('한 줄 소개: ' + f.pos);
  if(f.ing) L.push('핵심 성분: ' + f.ing);
  if(f.spf) L.push('차단 지수: ' + f.spf);
  if(f.app) L.push('강조 포인트: ' + f.app);
  if(f.promo) L.push('판매 구성: ' + f.promo);
  if(f.target) L.push('타깃: ' + f.target);
  if(f.price) L.push('가격대: ' + f.price);
  if(f.rival) L.push('경쟁 제품: ' + f.rival);
  if(f.intent) L.push('기획 의도: ' + f.intent);
  var pf = PROOFS.filter(function(p){ return S.proofs[p.k]; }).map(function(p){ return p.t; });
  L.push('보유 자료: ' + (pf.length ? pf.join(', ') : '없음'));
  return L.join('\n');
}
function slotText(s, i){
  var L = [], d = (S.drafts[s.role] || []).filter(Boolean), n = S.notes[s.role];
  L.push('### ' + (i+1) + '. ' + rname(s.role));
  L.push('- 할 일: ' + rguide(s.role));
  L.push('- 말투: ' + tone(s.copy[0][0]) + ' / 그림: ' + vis(s.vis[0][0]) + ' / 분량: ' + cuts(s.per));
  if(s.ev && s.evRate >= 50) L.push('- 근거: ' + (EVN[s.ev[0][0]] || s.ev[0][0]));
  if(s.flag) L.push('- [확인] ' + s.flag);
  L.push('- 자주 쓰는 단어: ' + s.terms.slice(0,9).join(', '));
  L.push('');
  L.push('참고 문구 (경쟁사 실제 사용, 말투만 참고):');
  s.ex.slice(0,4).forEach(function(e){ L.push('  - "' + e.t + '" — ' + e.b); });
  if(d.length){ L.push(''); L.push('우리 문구:'); d.forEach(function(t){ L.push('  - ' + t); }); }
  if(n){ L.push(''); L.push('메모: ' + n); }
  return L.join('\n');
}
var PROMPT_HEAD =
  '아래는 올리브영 상세페이지 ' + META.nProd + '개를 분석해 만든 구성안입니다.\n' +
  '이 순서와 제품 정보를 따라 상세페이지 본문 초안을 작성해 주세요.\n\n' +
  '규칙:\n- 칸마다 적힌 말투·그림·분량을 지킬 것\n' +
  '- "참고 문구"는 경쟁사 실제 문구이니 말투만 참고하고 베끼지 말 것\n' +
  '- "우리 문구"가 있으면 그 방향을 살려 다듬을 것\n- "메모"의 요청을 반영할 것\n' +
  '- 보유 자료를 넘는 주장을 쓰지 말 것\n' +
  '- 기능성 심사를 받지 않은 효능 표현(미백·주름개선 등)과 근거 없는 최상급 표현(1위·최고·유일)은 쓰지 말 것\n' +
  '- "[확인]"이 붙은 칸은 지어내지 말고 무엇을 확보해야 하는지 적을 것\n\n---\n\n';
function toText(kind){
  var f = form(), L = [];
  if(kind === 'slack'){
    L.push('*' + f.name + '* 상세페이지 구성 초안');
    L.push(cur.T.label + ' 기준 · ' + cur.slots.length + '칸 · 이미지 약 ' + total() + '컷');
    if(f.pos) L.push('_' + f.pos + '_');
    L.push('');
    cur.slots.forEach(function(s, i){
      L.push('*' + (i+1) + '. ' + rname(s.role) + '* — ' + tone(s.copy[0][0]) + ' · ' + vis(s.vis[0][0]) + ' · ' + cuts(s.per));
      (S.drafts[s.role] || []).filter(Boolean).forEach(function(t){ L.push('    • ' + t); });
      if(s.flag) L.push('    :warning: ' + s.flag);
      if(S.notes[s.role]) L.push('    _' + S.notes[s.role] + '_');
    });
    if(cur.out.length) L.push('\n뺀 칸: ' + cur.out.map(function(s){ return rname(s.role); }).join(', '));
    return L.join('\n');
  }
  if(kind === 'prompt') L.push(PROMPT_HEAD);
  L.push('# ' + f.name + ' 상세페이지 구성 초안');
  L.push('');
  L.push('- 기준: ' + cur.T.label + ' ' + cur.T.nProd + '개 상품');
  L.push('- 구성: ' + cur.slots.length + '칸 / 이미지 약 ' + total() + '컷');
  L.push('');
  L.push('## 제품 정보'); L.push(''); L.push(productBlock(f)); L.push('');
  L.push('## 구성 (위에서 아래 순서)'); L.push('');
  cur.slots.forEach(function(s, i){
    if(kind === 'brief'){
      var dr = (S.drafts[s.role] || []).filter(Boolean);
      L.push('### ' + (i+1) + '. ' + rname(s.role));
      L.push('- 그림: ' + s.vis.map(function(c){ return vis(c[0]); }).join(' 또는 '));
      L.push('- 분량: ' + cuts(s.per) + ' / 말투: ' + tone(s.copy[0][0]));
      if(dr.length){ L.push('- 들어갈 문구:'); dr.forEach(function(t){ L.push('  - ' + t); }); }
      if(S.notes[s.role]) L.push('- 메모: ' + S.notes[s.role]);
      L.push('');
    } else { L.push(slotText(s, i)); L.push(''); }
  });
  if(cur.out.length){ L.push('## 뺀 칸'); L.push(''); cur.out.forEach(function(s){ L.push('- ' + rname(s.role)); }); L.push(''); }
  L.push('---');
  L.push('출처: 올리브영 상세페이지 ' + META.nProd + '개 상품 분석 (2026년 10월 수집)');
  return L.join('\n');
}
function copyText(t, el, msg){
  function done(ok){ if(el) el.textContent = ok ? (msg || '복사했어요') : '복사가 막혔어요. 직접 선택해 주세요'; }
  try{ navigator.clipboard.writeText(t).then(function(){ done(true); }, function(){ done(false); }); }
  catch(e){ done(false); }
}
var downloads = null;
$('dl').hidden = true;
claude.use('downloads').then(function(d){ downloads = d; $('dl').hidden = !d; }, function(){});
var EXT = {prompt:'_프롬프트.md', spec:'_구성초안.md', brief:'_디자인의뢰서.md', slack:'_슬랙용.txt'};
$('copyAll').onclick = function(){ copyText(toText($('exKind').value), $('actHint')); };
$('dl').onclick = function(){
  var h = $('actHint'), k = $('exKind').value, text = toText(k);
  var name = form().name.replace(/[\\/:*?"<>|()]/g,'').trim() || '상세페이지';
  if(!downloads){ copyText(text, h, '저장을 쓸 수 없어 복사했어요'); return; }
  h.textContent = '저장 중...';
  downloads.save({filename: name + EXT[k], data: text}).then(function(){ h.textContent = '저장했어요'; },
    function(){ copyText(text, h, '저장이 취소돼서 복사해 뒀어요'); });
};

// ── AI 문구 ──
var sample = null;
document.body.classList.add('no-ai');
claude.use('sample').then(function(s){ sample = s; if(s) document.body.classList.remove('no-ai'); }, function(){});
var ERRMSG = {not_granted:'Claude 사용이 허용되지 않았어요', rate_limited:'요청이 많아요. 잠시 뒤 다시 눌러 주세요',
  refused:'이 입력으로는 만들 수 없어요', invalid_json:'형식이 어긋났어요. 다시 눌러 주세요',
  cancelled:'', prompt_too_large:'입력이 너무 길어요'};
function errText(e){ return (e && ERRMSG[e.code] !== undefined) ? (ERRMSG[e.code] || '중단했어요') : '만들지 못했어요. 다시 눌러 주세요'; }
var RULES = '당신은 한국 화장품 상세페이지 카피라이터입니다.\n규칙:\n' +
  '- 제품이 실제로 가진 근거(보유 자료)를 넘는 주장을 쓰지 마세요.\n' +
  '- 기능성 화장품 심사를 받지 않은 효능 표현(미백, 주름개선, 아토피, 여드름 치료 등)은 쓰지 마세요.\n' +
  '- 근거 없는 최상급 표현(1위, 최고, 유일)은 쓰지 마세요.\n' +
  '- 한 줄 30자 이내, 상세페이지 이미지에 얹을 헤드라인 형태로.\n';
function genOne(role, btn, st){
  if(!sample) return;
  var s = null; cur.slots.forEach(function(x){ if(x.role === role) s = x; }); if(!s) return;
  var f = form();
  btn.disabled = true; st.textContent = '만드는 중...';
  var prompt = RULES + '\n[제품]\n' + f.name + '\n' + productBlock(f) +
    '\n\n[이 칸]\n' + rname(s.role) + ': ' + rguide(s.role) + '\n말투: ' + tone(s.copy[0][0]) +
    '\n자주 쓰는 단어: ' + s.terms.slice(0,9).join(', ') +
    (S.notes[role] ? '\n요청: ' + S.notes[role] : '') +
    '\n\n[경쟁사가 이 자리에 쓴 문구 — 말투 참고용, 베끼지 말 것]\n' +
    s.ex.slice(0,4).map(function(e){ return '- ' + e.t; }).join('\n') +
    '\n\n이 칸의 헤드라인 3개를 쓰세요. JSON 배열로만 답하세요. 예: ["문구1","문구2","문구3"]';
  sample.json(prompt, {modelTier:'default'}).then(function(v){
    var arr = Array.isArray(v) ? v.map(String) : [];
    S.drafts[role] = (S.drafts[role] || []).filter(Boolean).concat(arr);
    S.open[role] = true; render();
  }, function(e){ st.textContent = errText(e); btn.disabled = false; });
}
$('aiAll').onclick = function(){
  if(!sample) return;
  var b = $('aiAll'), h = $('actHint'), f = form();
  b.disabled = true; h.textContent = '전체 문구를 만드는 중이에요. 1분쯤 걸려요...';
  var body = cur.slots.map(function(s, i){
    return (i+1) + '. ' + rname(s.role) + ' — ' + rguide(s.role) + ' 말투: ' + tone(s.copy[0][0]) +
      ', 자주 쓰는 단어: ' + s.terms.slice(0,6).join(', ') + (S.notes[s.role] ? ' / 요청: ' + S.notes[s.role] : '');
  }).join('\n');
  var prompt = RULES + '\n[제품]\n' + f.name + '\n' + productBlock(f) + '\n\n[칸 목록]\n' + body +
    '\n\n칸마다 헤드라인 2개씩 쓰세요. JSON 객체 하나로만 답하세요. 키는 칸 번호(문자열), 값은 문구 2개 배열.\n' +
    '예: {"1":["문구A","문구B"],"2":["문구C","문구D"]}';
  sample.json(prompt, {modelTier:'default'}).then(function(v){
    var got = 0;
    cur.slots.forEach(function(s, i){
      var arr = v && v[String(i+1)];
      if(Array.isArray(arr) && arr.length){
        S.drafts[s.role] = (S.drafts[s.role] || []).filter(Boolean).concat(arr.map(String)); got++;
      }
    });
    render(); b.disabled = false;
    h.textContent = got ? got + '개 칸에 문구를 넣었어요. 칸을 펼쳐서 고쳐 쓰세요.' : '결과를 읽지 못했어요. 다시 눌러 주세요.';
  }, function(e){ h.textContent = errText(e); b.disabled = false; });
};

render();

// ── 알아두면 좋은 것 ──
(function(){
  var gap = META.gapBars, worst = gap[0];
  var zb = META.zoneBars, zmax = Math.max.apply(null, zb.map(function(z){ return z.v; }));
  var tb = META.typeBars.slice().sort(function(a,b){ return b.v - a.v; });
  var tmax = tb[0].v;
  $('insSub').textContent = '구성 초안을 짤 때 판단에 도움이 되는 사실 세 가지입니다.';
  var c1 = '<div class="card"><h3>경쟁사 절반 이상이 다는 ' + esc(worst.k) + ', 셀퓨전씨는 ' + worst.our + '%</h3>' +
    '<p>셀퓨전씨와 경쟁사가 각 요소를 쓰는 비율입니다. 가장 차이가 큰 건 ' + esc(worst.k) +
    '(<b>' + worst.our + '% 대 ' + worst.comp + '%</b>). 반대로 후기 인용과 그래프는 우리가 더 많이 씁니다.</p>' +
    '<div class="pb">' + gap.map(function(b){
      var d = b.our - b.comp;
      return '<div class="pbr"><span>' + esc(b.k) + '</span><span class="pbt"><i class="o" style="width:' + b.our + '%"></i>' +
        '<i class="c" style="width:' + b.comp + '%"></i></span><span class="pbv' + (d <= -12 ? ' neg' : '') + '">' + b.our + ' / ' + b.comp + '</span></div>';
    }).join('') + '</div>' +
    '<div class="klg"><span><em style="background:var(--accent)"></em>셀퓨전씨</span><span><em style="background:var(--line2)"></em>경쟁사</span></div></div>';
  var c2 = '<div class="card"><h3>끌어들이고, 가운데서 증명하고, 끝에서 정리</h3>' +
    '<p>페이지를 다섯 구간으로 나눴을 때 시험 결과·성분 수치 같은 <b>근거를 붙인 구간 비율</b>입니다. 증명은 가운데에 몰아 두는 게 일반적이에요.</p>' +
    '<div class="cols">' + zb.map(function(z){
      return '<div class="cl' + (z.v === zmax ? ' hi' : '') + '"><b>' + z.v + '%</b><i style="height:' + Math.round(z.v / zmax * 82) + 'px"></i>' + esc(z.k) + '</div>';
    }).join('') + '</div></div>';
  var c3 = '<div class="card"><h3>분량은 유형마다 다르고, 정답은 없다</h3>' +
    '<p>유형별로 보통 몇 컷인지(중간값)입니다. 전체로 보면 짧게는 ' + META.secMin + '컷, 길게는 ' + META.secMax +
    '컷까지 있어요. 지금 고른 유형이 강조돼요.</p><div class="hb" id="typeBars">' + tb.map(function(b){
      return '<div class="hbr" data-t="' + esc(b.k) + '"><span>' + esc(b.k) + '</span><i style="width:' + Math.round(b.v / tmax * 100) + '%"></i><span class="v">' + b.v + '</span></div>';
    }).join('') + '</div></div>';
  $('ins').innerHTML = c1 + c2 + c3;
  function mark(){
    Array.prototype.forEach.call(document.querySelectorAll('#typeBars .hbr'), function(r){ r.classList.toggle('cur', r.dataset.t === S.type); });
  }
  mark(); $('typeChips').addEventListener('change', mark); $('reset').addEventListener('click', mark);
})();

// ── 인증마크 ──
(function(){
  var MC = {}; CERT.meta.forEach(function(m){ MC[m.k] = m; });
  $('certSub').textContent = '상세페이지에 박힌 인증·시험·수상 마크를 모아 종류별로 묶었습니다. ' +
    CERT.nProd + '개 중 ' + CERT.withAny + '개(' + CERT.pctAny + '%)가 하나 이상 답니다. 줄을 누르면 실제로 어떤 문구로 박는지 보여요.';
  $('certType').innerHTML = CERT.typeList.map(function(t){
    return '<option value="' + esc(t) + '">' + esc(t) + ' (' + CERT.views[t].n + '개)</option>'; }).join('');
  var ct = CERT.views[S.type] ? S.type : '전체';
  $('certType').value = ct;
  function draw(){
    var v = CERT.views[ct] || CERT.views['전체'];
    $('certHint').textContent = '이 유형 ' + v.n + '개 상품 중 몇 %가 쓰는지';
    $('crows').innerHTML = v.groups.map(function(g){
      var m = MC[g.k] || {}, tag = '';
      if((m.our || 0) === 0 && (m.comp || 0) >= 5) tag = '<span class="pill w">셀퓨전씨는 안 씀</span>';
      return '<details class="cr"><summary><span class="crn">' + esc(g.k) + '</span>' +
        '<span class="crb"><i style="width:' + g.pct + '%"></i></span><span class="crp">' + g.pct + '%</span>' +
        '<span class="crt">' + tag + '</span></summary><div class="crd">' +
        (g.marks.length ? '<div class="cap">자주 쓰는 표기 · 이 묶음을 쓰는 상품 중 비율</div>' + g.marks.map(function(k){
          return '<div class="ex"><span>' + esc(k.t) + '</span><small>' + k.pct + '%</small></div>'; }).join('')
          : '<p class="hint">이 유형에서는 쓰이지 않아요.</p>') +
        '</div></details>';
    }).join('');
  }
  draw();
  $('certType').onchange = function(){ ct = this.value; draw(); };
})();

// ── 더 보기 ──
var minH = Math.min.apply(null, DIS.map(function(d){ return d.height; }));
$('lens').innerHTML = DIS.map(function(d){
  return '<div style="min-width:0"><span class="tag' + (d.ours ? ' ours' : '') + '">' + esc(d.tag) + '</span>' +
    '<div class="cn">' + esc(d.name) + '</div><div class="cs">가장 짧은 것의 ' + (d.height/minH).toFixed(1) + '배 · ' + d.nSec + '컷</div>' +
    '<div class="strip">' + d.imgs.map(function(im){ return '<img src="' + im.d + '" alt="" loading="lazy">'; }).join('') + '</div></div>';
}).join('');

$('dictN').textContent = '선케어 ' + LMETA.nProd + '개 상품의 실제 헤드라인 ' + nf(LMETA.nLines) + '개';
var fr = $('fr'), fp = $('fp');
fr.innerHTML = '<option value="">모든 칸</option>' + LMETA.roles.map(function(r){
  return '<option value="' + esc(r) + '">' + esc(rname(r)) + '</option>'; }).join('');
fp.innerHTML = '<option value="">모든 유형</option>' + LMETA.types.map(function(t){
  return '<option>' + esc(t) + '</option>'; }).join('');
var PAGE = 40, shown = PAGE;
function drawDict(){
  var q = $('q').value.trim().toLowerCase(), r = fr.value, p = fp.value;
  var list = LINES.filter(function(l){
    if(r && l.r !== r) return false;
    if(p && l.p !== p) return false;
    if(q && l.t.toLowerCase().indexOf(q) < 0 && l.b.toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  $('cnt').textContent = nf(list.length) + '개';
  var box = $('lines');
  if(!list.length){ box.innerHTML = '<div class="none">조건에 맞는 문구가 없어요.</div>'; return; }
  box.innerHTML = list.slice(0, shown).map(function(l){
    return '<div class="ln' + (l.o ? ' mine' : '') + '"><span>' + esc(l.t) + '</span><small>' +
      esc(rname(l.r)) + ' · ' + esc(l.b) + '</small></div>';
  }).join('') + (list.length > shown ? '<button class="moreb" type="button" id="more">더 보기 (' + nf(list.length - shown) + '개 남음)</button>' : '');
  var m = $('more'); if(m) m.onclick = function(){ shown += PAGE; drawDict(); };
}
['q','fr','fp'].forEach(function(id){ $(id).addEventListener('input', function(){ shown = PAGE; drawDict(); }); });
drawDict();

(function(){
  function tbl(title, list, withN, nameFn){
    return '<div class="cap" style="margin-top:14px">' + title + '</div>' + list.map(function(e){
      return '<div class="tx"><b>' + esc(nameFn ? nameFn(e.k) : e.k) + '</b><span>' + esc(e.d) +
        (withN && e.n ? ' · ' + (e.pct||0) + '%의 상품이 씀' : '') + '</span></div>';
    }).join('');
  }
  $('taxo').innerHTML = '<p class="note2">상세페이지 이미지를 위에서부터 잘라 한 구간(컷)씩 아래 기준으로 분류했습니다. ' +
    '자동 분류라 경계가 애매한 구간도 있어요.</p>' +
    tbl('칸 종류 — 그 구간이 무슨 일을 하나', TAXO.role, true, function(k){ return rname(k); }) +
    tbl('말투', TAXO.copy, false, function(k){ return tone(k); }) +
    tbl('그림', TAXO.visual, false, function(k){ return vis(k); }) +
    tbl('근거', TAXO.evidence, false, function(k){ return EVN[k] || k; });
})();

$('foot1').textContent = '구성과 수치는 올리브영 상세페이지 ' + META.nProd + '개를 한 장씩 읽어 칸 종류·말투·그림·근거로 분류한 결과입니다. ' +
  '판매 순위와 구성은 거의 상관이 없어서(설명력 3% 수준) 순위가 아니라 제품 유형별로 나눴습니다.';
})();
