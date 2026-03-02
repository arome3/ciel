import { Navbar } from "@/components/landing/Navbar"
import { HeroSection } from "@/components/landing/HeroSection"
import { LogoBar } from "@/components/landing/LogoBar"
import { StatementSection } from "@/components/landing/StatementSection"
import { FeatureSections } from "@/components/landing/FeatureSections"
import { PipelineSection } from "@/components/landing/PipelineSection"
import { AudienceTabs } from "@/components/landing/AudienceTabs"
import { DemoTerminal } from "@/components/landing/DemoTerminal"
import { CTASection } from "@/components/landing/CTASection"
import { Footer } from "@/components/landing/Footer"
import { ScrollReveal } from "@/components/landing/ScrollReveal"

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <HeroSection />

      <LogoBar />

      <ScrollReveal>
        <StatementSection />
      </ScrollReveal>

      <ScrollReveal>
        <FeatureSections />
      </ScrollReveal>

      <ScrollReveal>
        <PipelineSection />
      </ScrollReveal>

      <ScrollReveal>
        <AudienceTabs />
      </ScrollReveal>

      <ScrollReveal>
        <DemoTerminal />
      </ScrollReveal>

      <ScrollReveal>
        <CTASection />
      </ScrollReveal>

      <Footer />
    </div>
  )
}
