'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * 상세페이지 초안 생성기.
 *
 * 왜 iframe 인가 — 이 도구는 claude.ai 아티팩트에서 만들어진 독립 페이지다.
 * 자체 CSS 가 `h1,h2,h3{...}`, `button,input,select,textarea{font:inherit}`,
 * `*{box-sizing}` 같은 엘리먼트 선택자를 쓴다. 대시보드 안에 그대로 심으면
 * 다른 탭까지 글꼴과 여백이 바뀐다. iframe 이 그 경계를 공짜로 준다.
 *
 * 대신 iframe 은 높이를 스스로 못 맞춘다. 자식이 내용이 바뀔 때마다
 * postMessage 로 높이를 보내고(detail/index.html 의 로더), 여기서 받아 늘린다.
 *
 * 자산은 web/public/detail/ 에 있고 collector.detail_page_webexport 가 만든다.
 */
export default function DetailPageTab() {
  const ref = useRef<HTMLIFrameElement>(null)
  const [h, setH] = useState(1400)
  const [state, setState] = useState<'loading' | 'ok' | 'missing'>('loading')

  useEffect(() => {
    // 자산이 아직 배포되지 않았을 수 있다. 없으면 iframe 이 404 를 조용히
    // 보여주므로, 먼저 확인해서 사람이 읽을 수 있는 안내를 띄운다.
    let alive = true
    fetch('/detail/data.json', { method: 'HEAD' })
      .then(r => { if (alive) setState(r.ok ? 'ok' : 'missing') })
      .catch(() => { if (alive) setState('missing') })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      // 같은 출처에서 온 우리 프레임의 메시지만 받는다
      if (e.origin !== window.location.origin) return
      if (ref.current && e.source !== ref.current.contentWindow) return
      const d = e.data
      if (d && d.type === 'detailTabHeight' && typeof d.h === 'number' && d.h > 200) {
        setH(Math.min(d.h + 24, 40000))
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  if (state === 'missing') {
    return (
      <div className="border border-dashed border-border rounded-lg px-6 py-12 text-center">
        <p className="text-sm text-text-secondary">상세페이지 분석 데이터가 아직 없어요</p>
        <p className="text-xs text-text-tertiary mt-1">
          수집·분석 후 <code>python -m collector.detail_page_webexport</code> 로 생성합니다
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold text-text-primary">상세페이지 초안 생성기</h2>
        <p className="text-sm text-text-secondary mt-1">
          제품 유형과 가진 자료를 고르면 경쟁 상품의 실제 상세페이지를 근거로 구성 뼈대를 짜줍니다.
          AI 문구 생성은 <span className="text-text-tertiary">내보내기 → Claude·GPT 프롬프트</span>를
          복사해 쓰세요.
        </p>
      </div>
      <iframe
        ref={ref}
        src="/detail/index.html"
        title="상세페이지 초안 생성기"
        className="w-full border border-border rounded-lg bg-background"
        style={{ height: h }}
        loading="lazy"
      />
    </div>
  )
}
