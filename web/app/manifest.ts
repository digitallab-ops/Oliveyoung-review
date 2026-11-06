import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '셀퓨전씨 인사이트',
    short_name: 'CFC 인사이트',
    description: '올리브영·쿠팡·네이버 브랜드 인사이트 대시보드',
    start_url: '/',
    display: 'standalone',
    background_color: '#FAFAF9',
    theme_color: '#FAFAF9',
    orientation: 'portrait-primary',
    // CFC.png 는 실제로 225x225 인데 192/512 로 선언돼 있었다(설치 가능성 검사에서 경고).
    // 실제 크기에 맞춘 파일을 따로 만들어 가리킨다.
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
