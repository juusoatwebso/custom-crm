"use client"

import { useState, useEffect } from "react"
import { Select } from "@/components/ui/select"
import { KanbanBoard } from "./board"
import { Skeleton } from "@/components/ui/skeleton"

interface Pipeline {
  id: string
  name: string
}

interface KanbanDeal {
  id: string
  title: string
  value: number | null
  currency: string
  organization?: { name: string } | null
  person?: { firstName: string; lastName?: string | null } | null
  owner?: { name: string } | null
}

interface KanbanStage {
  id: string
  name: string
  deals: KanbanDeal[]
}

interface PipelineData {
  stages: KanbanStage[]
}

interface PipelineViewProps {
  pipelines: Pipeline[]
}

export function PipelineView({ pipelines }: PipelineViewProps) {
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>(
    pipelines[0]?.id || ""
  )
  const [pipelineData, setPipelineData] = useState<PipelineData | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!selectedPipelineId) return

    const fetchPipelineData = async () => {
      setIsLoading(true)
      try {
        const response = await fetch(`/api/pipelines/${selectedPipelineId}`)
        if (!response.ok) throw new Error("Failed to fetch pipeline")
        const data = await response.json()
        setPipelineData(data)
      } catch (error) {
        console.error("Error fetching pipeline:", error)
        setPipelineData(null)
      } finally {
        setIsLoading(false)
      }
    }

    fetchPipelineData()
  }, [selectedPipelineId])

  return (
    <div className="flex flex-col h-full gap-4 p-6">
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-muted-foreground">Pipeline:</label>
        <Select
          value={selectedPipelineId}
          onChange={(e) => setSelectedPipelineId(e.target.value)}
          className="max-w-xs"
        >
          {pipelines.map((pipeline) => (
            <option key={pipeline.id} value={pipeline.id}>
              {pipeline.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex-shrink-0 w-72">
                <Skeleton className="h-12 w-full mb-3 rounded-xl" />
                <div className="space-y-2.5">
                  {[1, 2, 3].map((j) => (
                    <Skeleton key={j} className="h-28 w-full rounded-xl" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : pipelineData ? (
          <KanbanBoard stages={pipelineData.stages} />
        ) : (
          <div className="text-center text-muted-foreground py-12">
            Ei vaiheita tälle putkelle
          </div>
        )}
      </div>
    </div>
  )
}
