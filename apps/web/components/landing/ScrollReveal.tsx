"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

interface ScrollRevealProps {
  children: React.ReactNode
  className?: string
  threshold?: number
  delay?: number
}

export function ScrollReveal({
  children,
  className,
  threshold = 0.15,
  delay = 0,
}: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Respect prefers-reduced-motion
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    if (mq.matches) {
      el.classList.add("scroll-reveal-visible")
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (delay > 0) {
            setTimeout(() => el.classList.add("scroll-reveal-visible"), delay)
          } else {
            el.classList.add("scroll-reveal-visible")
          }
          observer.unobserve(el)
        }
      },
      { threshold }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [threshold, delay])

  return (
    <div ref={ref} className={cn("scroll-reveal", className)}>
      {children}
    </div>
  )
}
