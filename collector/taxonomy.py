"""상품명 분류 체계 — 효능 / 제형 / 프로모션 3축.

하드코딩된 키워드 목록은 반드시 낡는다. 새 성분 트렌드나 마케팅 용어가
나오면 조용히 미분류로 빠지고 아무도 모른다. (PDRN이 78회 등장하는데
목록에 없었던 것이 그 예다.)

그래서 이 모듈은 두 가지를 함께 제공한다:
  1) classify()  — 투명한 키워드 매칭. 왜 그렇게 분류됐는지 바로 따질 수 있다.
  2) discover()  — 어느 축에도 안 걸리는 빈출어를 찾아낸다. 목록이 낡으면 알려준다.

sentinel이 (2)를 주기적으로 돌려 미분류율과 신규 빈출어를 감시한다.
"""

from __future__ import annotations

import re
from collections import Counter

# ── 축 1: 효능 (소비자가 무슨 고민을 해결하려 하는가) ──────────────
EFFICACY: dict[str, list[str]] = {
    '쿨링':        ['쿨링', '아이스', '시원', '쿨러', '냉감', '쿨다운'],
    '보습/수분':   ['수분', '보습', '촉촉', '히알루론', '모이스', '아쿠아', '워터', 'water',
                   '하이드라', '세라마이딘', '속건조'],
    '진정':        ['진정', '시카', '카밍', '센텔라', '센테카', '수딩', '릴리프', '마데카',
                   '판테놀', '무자극', '어성초', '병풀'],
    # PDRN은 영문·한글 표기가 함께 돈다. discover()가 '피디알엔' 33회를 잡아내 추가됨.
    '재생/리페어': ['리페어', 'pdrn', '피디알엔', '재생', '회복', '턴오버', '리쥬란',
                   '엑소좀', '성장인자', '저분자'],
    '트러블':      ['트러블', '여드름', '블레미쉬', '노스카', '스팟', '아크네', '에빠끌라'],
    '미백/잡티':   ['잡티', '미백', '토닝', '브라이트', '비타', '나이아신', '광채', '글로우',
                   '톤업', '기미', '화이트닝'],
    '모공':        ['모공', '포어', '피지', '블랙헤드', '세비엄', '모공톡스'],
    '장벽/약산성': ['장벽', '약산성', '패리어', '배리어', '세라마이드', '저자극', '센시비오',
                   '시카페어', '민감'],
    '안티에이징':  ['주름', '탄력', '리프팅', '레티놀', '레티날', '콜라겐', '안티에이징',
                   '리쥬버', '펩타이드', '에이징'],
    '선케어':      ['선크림', '썬크림', '선스크린', '썬스크린', '선스틱', '썬스틱', 'spf',
                   '자외선', '유브이', 'uv', '선세럼', '썬세럼', '선스프레이', '선젤',
                   '선쿠션', '안뗄리오스', '유비데아', '선밀크', '선패치', '무기자차',
                   '유기자차', '선베이스', 'pa+'],
    '각질':        ['각질', '필링', '스크럽', 'aha', 'bha', 'pha', '엔자임', '퓨리파잉'],
    '메이크업밀착': ['화잘먹', '파데프리', '메이크업', '베이스', '프라이머', '밀착'],
}

# ── 축 2: 제형 (어떤 형태로 쓰는가) ──────────────────────────────
FORM: dict[str, list[str]] = {
    '마스크/팩':  ['마스크', '시트팩', '페이셜팩', '코팩', '팩'],
    '패드':       ['패드', '토너패드'],
    '앰플/세럼':  ['앰플', '세럼', '에센스'],
    '토너':       ['토너', '스킨'],
    '크림':       ['크림'],
    '로션':       ['로션', '에멀전', '밀크'],
    '스틱':       ['스틱'],
    '클렌저':     ['클렌저', '클렌징', '폼', '워시'],
    '오일/밤':    ['오일', '밤'],
    '미스트':     ['미스트', '스프레이'],
    '파우더':     ['파우더'],
    '패치':       ['패치'],
    '연고':       ['연고', '오인트'],
    '올인원':     ['올인원', '올인'],
}

# ── 축 3: 프로모션 기제 (어떻게 파는가) ──────────────────────────
PROMO: dict[str, list[str]] = {
    '콜라보':     ['콜라보', '산리오', '헬로키티', '포켓몬', '짱구', '카카오', '라인프렌즈',
                  'nct', '아이브', '한교동', '조앤프렌즈', '진로', '레오파드', '에디션'],
    '증정/기획':  ['증정', '기획', '더블', '1+1', '2+1', '사은품', '리필', '대용량'],
    '올영픽':     ['올영픽', '올영단독', '올리브영픽'],
    '랭킹소구':   ['1위', '1등', 'pick', '화해1위', '베스트', '랭킹'],
    '한정':       ['한정', '단독', '하루특가', '온라인단독'],
}

AXES: dict[str, dict[str, list[str]]] = {
    'efficacy': EFFICACY,
    'form': FORM,
    'promo': PROMO,
}

# ── 발굴 시 제외할 말 ────────────────────────────────────────────
# 용량·수량 표기, 배송/판매 관련 사무어. 테마 신호가 아니다.
_STOP_PATTERN = re.compile(
    r'^(?:\d+|[\d.]+(?:ml|g|kg|매|포|개|입|종|p|호|색|주|일)|'
    r'택1|택일|신상|new|best|출시|추천|케어|데일리|퍼펙트|무료|배송|업체|공식|정품|본품|'
    r'브랜드|샘플|키트|플러스|스페셜|패키지|구성|파우치|미니|리뉴얼|굿즈|이벤트|리뷰이벤트|'
    r'특가|할인|세일|쿠폰|적립|선물|추가|전용|국내|정식|당일|무배|단품|'
    r'\d{1,2}월|오리지널|클리어|레드|핑크|블루|그린|화이트|블랙)$',
    re.I,
)

# 브랜드명은 테마가 아니다. 상품명 첫 토큰이 대개 브랜드라 자동 수집된다.
_BRAND_CACHE: set[str] = set()


def _norm(s: str) -> str:
    """공백 제거 + 소문자. '썬 스틱'과 '썬스틱'을 같게 본다."""
    return re.sub(r'\s+', '', s).lower()


_AXES_NORM = {
    axis: {label: [_norm(k) for k in kws] for label, kws in groups.items()}
    for axis, groups in AXES.items()
}

# 짧은 키워드를 부분 문자열로 매칭하면 엉뚱한 곳에 걸린다.
# ('포'가 '포스트 알파', '아쿠아포린'에 걸려 파우더 17개로 집계되던 버그)
# 다만 한국어는 복합어를 붙여 쓰므로('기획세트', '더블기획') 2글자까지 부분매칭을
# 허용해야 한다. 1글자만 토큰 단위 완전일치를 요구한다.
_SHORT_KW_LEN = 1
_TOKEN_SPLIT = re.compile(r'[\s/,·|+()\[\]]+')


def _tokens(goods_name: str) -> set[str]:
    return {_norm(t) for t in _TOKEN_SPLIT.split(goods_name) if t.strip()}


def _matches(kw: str, joined: str, tokens: set[str]) -> bool:
    if len(kw) <= _SHORT_KW_LEN:
        return kw in tokens
    return kw in joined


def classify(goods_name: str, axis: str = 'efficacy') -> list[str]:
    """상품명을 지정한 축으로 분류한다. 해당 없으면 빈 리스트.

    한 상품이 여러 라벨을 가질 수 있다 ('시카 쿨링 마스크' = 쿨링 + 진정).
    """
    groups = _AXES_NORM.get(axis)
    if not groups:
        return []
    joined = _norm(goods_name)
    tokens = _tokens(goods_name)
    return [
        label for label, kws in groups.items()
        if any(_matches(k, joined, tokens) for k in kws)
    ]


def classify_all(goods_name: str) -> dict[str, list[str]]:
    """세 축 전부로 분류."""
    return {axis: classify(goods_name, axis) for axis in AXES}


def register_brands(names: list[str]) -> None:
    """브랜드명을 발굴 제외 목록에 등록한다. 상품명 첫 토큰이 보통 브랜드다."""
    for name in names:
        body = re.sub(r'\[[^\]]*\]', ' ', name).strip()
        first = re.split(r'[\s/,·|+()]+', body)[0] if body else ''
        if len(first) >= 2:
            _BRAND_CACHE.add(_norm(first))


def _is_covered(token: str) -> bool:
    """이미 어느 축의 키워드로 잡히는 말인가. 발굴 대상에서 제외하기 위함."""
    n = _norm(token)
    if not n:
        return True
    for groups in _AXES_NORM.values():
        for kws in groups.values():
            for k in kws:
                if k == n or (len(k) > _SHORT_KW_LEN and (k in n or n in k)):
                    return True
    return False


def discover(goods_names: list[str], min_count: int = 10) -> list[tuple[str, int, str]]:
    """어느 축에도 안 걸리는 빈출어를 찾는다.

    반환: (단어, 빈도, 출처) — 출처는 'tag'(대괄호 안) 또는 'body'.
    대괄호 안은 브랜드가 직접 붙인 포지셔닝이라 테마 신호로서 가치가 높다.
    """
    register_brands(goods_names)
    tag_c: Counter[str] = Counter()
    body_c: Counter[str] = Counter()

    for name in goods_names:
        if not name:
            continue
        for tag in re.findall(r'\[([^\]]*)\]', name):
            for tok in re.split(r'[/,·\s|+]+', tag):
                tok = tok.strip()
                if _usable(tok):
                    tag_c[tok] += 1
        body = re.sub(r'\[[^\]]*\]', ' ', name)
        for tok in re.split(r'[/,·\s|+()]+', body):
            tok = tok.strip()
            if _usable(tok):
                body_c[tok] += 1

    out: list[tuple[str, int, str]] = []
    out += [(t, n, 'tag') for t, n in tag_c.items() if n >= min_count]
    out += [(t, n, 'body') for t, n in body_c.items() if n >= min_count]
    out.sort(key=lambda x: -x[1])
    return out


def _usable(tok: str) -> bool:
    if len(tok) < 2:
        return False
    if _STOP_PATTERN.match(tok):
        return False
    if _norm(tok) in _BRAND_CACHE:
        return False
    return not _is_covered(tok)


def coverage(goods_names: list[str], axis: str = 'efficacy') -> float:
    """해당 축으로 분류된 상품의 비율(%). 목록이 낡으면 이 값이 떨어진다."""
    if not goods_names:
        return 100.0
    hit = sum(1 for n in goods_names if classify(n, axis))
    return round(hit * 100.0 / len(goods_names), 1)
