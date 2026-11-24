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
          <span className="home-pill"><span aria-hidden="true">✧</span> A FRIENDLIER WAY TO LEARN PRECALCULUS</span>
          <span className="home-pill"><span aria-hidden="true">✧</span> DO PRECAL WITH A PAL</span>
          <h1 id="home-heading">Make sense<br />of the <span>math.</span></h1>
          <p>PreCalPal helps cater to your curiosity. Don't be afraid to ask questions. Set your own pace and explore PreCal with your Pal.</p>
          <div className="home-actions"><Link className="home-primary" href="/signup">Let's Get Started <span aria-hidden="true">→</span></Link><Link href="/login">Already learning? Log in</Link></div>
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
        <div className="home-method-heading"><p className="eyebrow">MORE UNDERSTANDING.</p><h2 id="method-heading">Don't just memorize. Understand.</h2></div>
        <ol>
          <li><span className="home-step-number">01</span><h3>Start with the basics.</h3><p>Get started with the foundations. Familiarize yourself with basic concepts and examples.</p><span className="home-step-tag">READ & LEARN</span></li>
          <li><span className="home-step-number">02</span><h3>Get to chatting.</h3><p>Your PreCalPal is there for you. Ask them questions, request examples and explain what you know. </p><span className="home-step-tag">YOUR AI TUTOR</span></li>
          <li><span className="home-step-number">03</span><h3>Test yourself.</h3><p>Try testing what you know, apply what you've learned, and see how you did.</p><span className="home-step-tag">PRACTICE & PROGRESS</span></li>
        </ol>
      </section>
      <footer className="home-footer"><strong>PreCalPal<span>.</span></strong><p>Made for curious minds.</p><Link href="/signup">Let’s get started <span aria-hidden="true">↗</span></Link></footer>
    </main>
    </>
  )
}
