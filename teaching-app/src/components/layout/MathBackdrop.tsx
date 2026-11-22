export default function MathBackdrop() {
  return <svg className="math-backdrop" viewBox="0 0 600 900" fill="none" aria-hidden="true">
    <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M35 220H260M70 265V50M85 195C130 190 160 160 175 125S205 80 240 65" />
      <path d="M70 70l-7 13m7-13 7 13M255 220l-12-7m12 7-12 7" />
      <path d="M375 85l110-40 75 70-115 40zM375 85v125l70 75V155m115-40v125l-115 45m-70-75 110-40 75 70" />
      <path d="M65 740h240L265 590zM90 740v-16h16v16M82 730q15-27 40-28" />
      <circle cx="450" cy="690" r="96" /><path d="M335 690h230M450 575v230M450 690l73-62" />
      <path d="M35 445h220m-190-12v24m55-24v24m55-24v24m55-24v24M365 415l130-75m-95 105 130-75" />
      <circle cx="120" cy="445" r="7" /><circle cx="175" cy="445" r="7" />
    </g>
    <g fill="currentColor" fontFamily="Georgia, serif" fontStyle="italic" fontSize="26">
      <text x="98" y="95">y = f(x)</text><text x="325" y="325">a &lt; x ≤ b</text>
      <text x="64" y="496">−∞</text><text x="190" y="496">+∞</text>
      <text x="155" y="685">x² + y²</text><text x="350" y="830">{'{x ∈ ℝ | x > 2}'}</text>
    </g>
  </svg>
}
