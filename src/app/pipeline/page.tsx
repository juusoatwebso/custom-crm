import { Header } from "@/components/layout/header"
import { PipelineView } from "@/components/kanban/pipeline-view"
import { prisma } from "@/lib/prisma"

export default async function PipelinePage() {
  const pipelines = await prisma.pipeline.findMany({
    orderBy: {
      orderNr: "asc",
    },
    select: {
      id: true,
      name: true,
    },
  })

  return (
    <div className="flex flex-col h-full">
      <Header title="Pipeline" description="Manage your pipeline" />
      <div className="flex-1 overflow-hidden">
        <PipelineView pipelines={pipelines} />
      </div>
    </div>
  )
}
