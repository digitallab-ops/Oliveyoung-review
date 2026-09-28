import type { Metadata, Viewport } from 'next'
import { Suspense } from 'react'
import Script from 'next/script'
import './globals.css'
import ChatWidget from '@/components/ChatWidget'
import PwaRegister from '@/components/PwaRegister'

const GA_ID = process.env.NEXT_PUBLIC_GA_ID

export const metadata: Metadata = {
  title: '셀퓨전씨 리뷰 인사이트',
  description: '올리브영 실구매 리뷰 분석 · CellFusionC',
  robots: 'noindex',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#FAFAF9',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      {GA_ID && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
          <Script id="ga-init" strategy="afterInteractive">{`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_ID}', { page_path: window.location.pathname });
          `}</Script>
        </>
      )}
      <body className="min-h-screen bg-background antialiased">
        <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
          <div className="absolute -top-60 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-accent/[0.025] blur-3xl" />
        </div>
        <div className="relative">
          {children}
        </div>
        <Suspense>
          <ChatWidget />
        </Suspense>
        <PwaRegister />
      </body>
    </html>
  )
}
