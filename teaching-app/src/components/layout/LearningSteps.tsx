import Link from 'next/link'

export default function LearningSteps({ lessonPath, current, conceptsComplete }: {
  lessonPath: string; current: 'learn' | 'tutor' | 'assessment'; conceptsComplete: boolean
}) {
  const steps = [
    { id: 'learn', title: 'Read & learn', href: lessonPath, complete: current !== 'learn' },
    { id: 'tutor', title: 'Tutor practice', href: `${lessonPath}/chat`, complete: conceptsComplete },
    { id: 'assessment', title: 'Your assessment', href: `${lessonPath}/assessment`, complete: false },
  ]
  return <nav className="learning-steps" aria-label="Learning steps"><ol>
    {steps.map((step, index) => {
      const content = <><span className="learning-step-node" aria-hidden="true">{step.complete ? '✓' : index + 1}</span><span>{step.title}{step.complete && <span className="sr-only">, completed</span>}</span></>
      return <li key={step.id} className={`learning-step${step.complete ? ' learning-step-complete' : ''}`} aria-current={step.id === current ? 'step' : undefined}>
        {step.id === 'assessment' && !conceptsComplete ? <span aria-disabled="true">{content}<span className="sr-only">, complete tutor practice to unlock</span></span> : <Link href={step.href}>{content}</Link>}
      </li>
    })}
  </ol></nav>
}
