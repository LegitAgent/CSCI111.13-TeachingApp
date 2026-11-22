import type { CSSProperties } from 'react'

const colors = ['#754bb9', '#91f6df', '#cbb7ec', '#67cab5', '#b8d8f0']

export default function DashboardConfetti() {
  return (
    <div className="dashboard-confetti" aria-hidden="true">
      {Array.from({ length: 64 }, (_, index) => (
        <span key={index} style={{
          '--confetti-left': `${(index * 37) % 101}%`,
          '--confetti-drift': `${((index * 53) % 241) - 120}px`,
          '--confetti-delay': `${(index % 12) * 0.1}s`,
          '--confetti-duration': `${3.2 + (index % 7) * 0.25}s`,
          '--confetti-color': colors[index % colors.length],
          '--confetti-spin': `${index % 2 ? -1 : 1}turn`,
        } as CSSProperties} />
      ))}
    </div>
  )
}
