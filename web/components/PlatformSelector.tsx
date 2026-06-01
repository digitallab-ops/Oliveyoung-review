'use client'

export type Platform = 'oliveyoung' | 'coupang' | 'amazon'

const PLATFORMS: { id: Platform; label: string; flag: string; beta?: boolean }[] = [
  { id: 'oliveyoung', label: '올리브영', flag: '🇰🇷' },
  { id: 'coupang',    label: '쿠팡',     flag: '🛒',  beta: true },
  { id: 'amazon',     label: '아마존',   flag: '🇺🇸', beta: true },
]

interface Props {
  value: Platform
  onChange: (p: Platform) => void
}

export default function PlatformSelector({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-lg bg-surface border border-border">
      {PLATFORMS.map(p => (
        <button
          key={p.id}
          onClick={() => onChange(p.id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
            value === p.id
              ? 'bg-accent text-white shadow-sm'
              : 'text-text-secondary hover:text-text-primary hover:bg-background'
          }`}
        >
          <span>{p.flag}</span>
          <span>{p.label}</span>
          {p.beta && (
            <span className="ml-0.5 px-1 py-0 text-[10px] font-bold rounded bg-orange-100 text-orange-600 leading-4">
              Beta
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
