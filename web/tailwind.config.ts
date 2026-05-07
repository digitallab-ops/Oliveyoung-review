import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-pretendard)', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
      },
      colors: {
        background: '#FAFAF9',
        surface: '#FFFFFF',
        border: {
          DEFAULT: '#E8E4DE',
          subtle: '#F0EDE8',
        },
        text: {
          primary:   '#1C1917',
          secondary: '#78716C',
          tertiary:  '#A8A29E',
        },
        accent: {
          DEFAULT: '#C9956C',
          bg:      '#FDF3EC',
          fg:      '#7C3D1F',
          border:  '#F0CAAA',
        },
        score: {
          5: '#16A34A',
          4: '#2D9C6E',
          3: '#CA8A04',
          2: '#EA580C',
          1: '#DC2626',
        },
      },
      fontSize: {
        '2xs': ['11px', { lineHeight: '1.4', letterSpacing: '0.04em' }],
        xs:    ['12px', { lineHeight: '1.5' }],
        sm:    ['13px', { lineHeight: '1.6' }],
        base:  ['14px', { lineHeight: '1.7' }],
        md:    ['15px', { lineHeight: '1.7' }],
        lg:    ['16px', { lineHeight: '1.75' }],
        xl:    ['18px', { lineHeight: '1.5' }],
        '2xl': ['20px', { lineHeight: '1.4' }],
        '3xl': ['24px', { lineHeight: '1.3' }],
        '4xl': ['28px', { lineHeight: '1.2', letterSpacing: '-0.02em' }],
        '5xl': ['36px', { lineHeight: '1.1', letterSpacing: '-0.03em' }],
      },
      spacing: {
        '4.5': '18px',
        '18':  '72px',
      },
      maxWidth: {
        content: '680px',
        wide:    '900px',
      },
      borderRadius: {
        '2xs': '4px',
        xs:    '6px',
        sm:    '8px',
        DEFAULT: '10px',
        md:    '12px',
        lg:    '14px',
        xl:    '16px',
        '2xl': '20px',
      },
      boxShadow: {
        card:   '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)',
        kpi:    '0 0 0 1px rgba(0,0,0,0.05), 0 2px 8px rgba(0,0,0,0.04)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
      },
      animation: {
        'fade-up':  'fade-up 0.4s cubic-bezier(0.16,1,0.3,1) both',
        'fade-in':  'fade-in 0.3s ease both',
        shimmer:    'shimmer 1.4s infinite linear',
      },
    },
  },
  plugins: [],
}

export default config
