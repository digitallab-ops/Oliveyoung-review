/** GA4 이벤트 전송.
 *
 * 대시보드는 SPA라 탭·플랫폼 전환이 page_view로 잡히지 않는다.
 * 어떤 화면이 실제로 쓰이는지 알아야 무엇을 남기고 무엇을 접을지 판단할 수 있다.
 */

type GtagFn = (command: string, ...args: unknown[]) => void

export function track(event: string, params: Record<string, string | number> = {}): void {
  if (typeof window === 'undefined') return
  const gtag = (window as unknown as { gtag?: GtagFn }).gtag
  if (typeof gtag !== 'function') return
  gtag('event', event, params)
}

/** 대시보드 탭 전환 */
export function trackTab(tabId: string, platform: string): void {
  track('tab_view', { tab_id: tabId, platform })
}

/** 플랫폼 전환 (올리브영 / 쿠팡 / 네이버 / 아마존) */
export function trackPlatform(platform: string): void {
  track('platform_view', { platform })
}
