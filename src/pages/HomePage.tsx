import { Hero } from '../components/hero/Hero'
import { ProblemSection } from '../components/landing/ProblemSection'
import { WorkflowSection } from '../components/landing/WorkflowSection'
import { CapabilitiesSection } from '../components/landing/CapabilitiesSection'
import { CredibilitySection } from '../components/landing/CredibilitySection'
import { ClosingCta } from '../components/landing/ClosingCta'

export function HomePage() {
  return (
    <>
      <Hero />
      <ProblemSection />
      <WorkflowSection />
      <CapabilitiesSection />
      <CredibilitySection />
      <ClosingCta />
    </>
  )
}
