import { PipelineDashboard } from "@/components/pipelines/PipelineDashboard"

export const metadata = {
  title: "My Pipelines — Ciel",
  description: "Manage your composable workflow pipelines",
}

export default function PipelinesPage() {
  return <PipelineDashboard />
}
