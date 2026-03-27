"use client"

import { useState, useCallback } from "react"
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from "@hello-pangea/dnd"
import { KanbanColumn } from "./column"
import { useToast } from "@/components/ui/toast"

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

interface KanbanBoardProps {
  stages: KanbanStage[]
}

export function KanbanBoard({ stages: initialStages }: KanbanBoardProps) {
  const { toast } = useToast()
  const [stages, setStages] = useState<KanbanStage[]>(initialStages)

  const handleDragEnd = useCallback(
    async (result: DropResult) => {
      const { source, destination, draggableId } = result

      if (!destination) return

      if (
        source.droppableId === destination.droppableId &&
        source.index === destination.index
      ) {
        return
      }

      const sourceDeal = stages
        .find((s) => s.id === source.droppableId)
        ?.deals.find((d) => d.id === draggableId)

      if (!sourceDeal) return

      setStages((prevStages) =>
        prevStages.map((stage) => {
          if (stage.id === source.droppableId) {
            return {
              ...stage,
              deals: stage.deals.filter((d) => d.id !== draggableId),
            }
          }
          if (stage.id === destination.droppableId) {
            const newDeals = [...stage.deals]
            newDeals.splice(destination.index, 0, sourceDeal)
            return { ...stage, deals: newDeals }
          }
          return stage
        })
      )

      try {
        const response = await fetch(`/api/deals/${draggableId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stageId: destination.droppableId }),
        })

        if (!response.ok) {
          setStages(initialStages)
          throw new Error("Failed to update deal")
        }
        const destStage = stages.find((s) => s.id === destination.droppableId)
        toast(`Moved to ${destStage?.name || "new stage"}`)
      } catch (error) {
        console.error("Error updating deal:", error)
        setStages(initialStages)
        toast("Failed to move deal", "error")
      }
    },
    [initialStages]
  )

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="h-full overflow-x-auto">
        <div className="flex gap-4 p-4 min-w-min">
          {stages.map((stage, index) => (
            <Droppable key={stage.id} droppableId={stage.id}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="flex-shrink-0 w-72"
                >
                  <KanbanColumn stage={stage} deals={stage.deals} index={index} />
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          ))}
        </div>
      </div>
    </DragDropContext>
  )
}
