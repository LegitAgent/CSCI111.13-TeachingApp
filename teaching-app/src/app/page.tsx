import Link from 'next/link'
import Image from 'next/image'
import AppHeader from '@/components/layout/AppHeader'
import MathBackdrop from '@/components/layout/MathBackdrop'
import '@/styles/home.css'

export default function HomePage() {
  return (
    <>
    <AppHeader active="home" />
    <main className="home-page" id="main-content">
      <section className="home-hero" aria-labelledby="home-heading">
        <div className="home-hero-copy">
          <span className="home-pill"><span aria-hidden="true">✧</span> A WAY TO LEARN PRECALCULUS</span>
          <h1 id="home-heading">Make sense<br />of the <span>math.</span></h1>
          <p>Big ideas start with small questions. Explore inequalities, talk things through with your AI tutor, and build understanding that sticks.</p>
          <div className="home-actions"><Link className="home-primary" href="/signup">Find your starting point <span aria-hidden="true">→</span></Link><Link href="/login">Already learning? Log in</Link></div>
          <p className="home-reassurance">Your pace. Your questions. Your little lightbulb moments.</p>
        </div>
        <div className="home-hero-art">
          <MathBackdrop />
          <span className="home-art-note home-art-note-top">“But WHY does it work?”</span>
          <Image src="/favicon.svg" alt="The smiling PreCalPal mascot wearing glasses" width={250} height={250} preload />
          <span className="home-art-note home-art-note-bottom"><span aria-hidden="true">✦</span> That’s a great place to start.</span>
        </div>
      </section>
      <section className="home-method" aria-labelledby="method-heading">
        <div className="home-method-heading"><p className="eyebrow">MORE UNDERSTANDING.</p><h2 id="method-heading">A learning path that meets you where you are.</h2></div>
        <ol>
          <li><span className="home-step-number">01</span><h3>Explore the idea.</h3><p>Start with clear explanations and worked examples. Build the foundations before moving on.</p><span className="home-step-tag">READ & LEARN</span></li>
          <li><span className="home-step-number">02</span><h3>Talk it through.</h3><p>Your pal checks what you know, guides you through tricky steps, and helps you explain the why.</p><span className="home-step-tag">YOUR AI TUTOR</span></li>
          <li><span className="home-step-number">03</span><h3>Make it click.</h3><p>Try problems independently, see how you did, and celebrate the understanding you’ve earned.</p><span className="home-step-tag">PRACTICE & PROGRESS</span></li>
        </ol>
      </section>
      <footer className="home-footer"><strong>PreCalPal<span>.</span></strong><p>Made for curious minds.</p><Link href="/signup">Let’s get started <span aria-hidden="true">↗</span></Link></footer>
    </main>
    </>
  )
}
