"use client"

import { WorkflowPalette } from "@/components/pipelines/WorkflowPalette"
import { PipelineCanvas } from "@/components/pipelines/PipelineCanvas"
import { PipelineSummary } from "@/components/pipelines/PipelineSummary"

export default function PipelinesPage() {
  // TODO: wire wallet provider (e.g. wagmi useAccount) to get real address
  const ownerAddress: string | undefined = undefined

  return (
    <>
      {/* Mobile notice */}
      <div className="flex h-full items-center justify-center p-8 md:hidden">
        <p className="text-center text-sm text-muted-foreground">
          The pipeline builder is best experienced on desktop.
          <br />
          Please switch to a wider screen.
        </p>
      </div>

      {/* Desktop layout */}
      <div className="hidden h-full flex-col md:flex">
        <div className="flex flex-1 overflow-hidden">
          <WorkflowPalette />
          <PipelineCanvas />
        </div>
        <PipelineSummary ownerAddress={ownerAddress} />
      </div>
    </>
  )
}
