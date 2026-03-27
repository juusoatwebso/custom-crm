"use client"

import { Draggable } from "@hello-pangea/dnd"
import { formatCurrency } from "@/lib/utils"
import { cn } from "@/lib/utils"

interface KanbanDeal {
  id: string
  title: string
  value: number | null
  currency: string
  organization?: { name: string } | null
  person?: { firstName: string; lastName?: string | null } | null
  owner?: { name: string } | null
}

interface KanbanCardProps {
  deal: KanbanDeal
  index: number
}

export function KanbanCard({ deal, index }: KanbanCardProps) {
  return (
    <Draggable draggableId={deal.id} index={index}>
      {(provided, snapshot) => (
        <a
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          href={`/deals/${deal.id}`}
          className={cn(
            "block bg-card  shadow-sm border border-border p-3.5 hover:shadow-md hover:border-primary/20 transition-all duration-150 cursor-grab active:cursor-grabbing",
            snapshot.isDragging && "shadow-lg rotate-2 border-primary/30"
          )}
        >
          <div className="font-medium text-sm truncate">{deal.title}</div>

          {deal.organization && (
            <div className="text-xs text-muted-foreground mt-1.5 truncate">
              {deal.organization.name}
            </div>
          )}

          {deal.value && (
            <div className="text-sm font-semibold mt-2.5 text-foreground">
              {formatCurrency(deal.value, deal.currency)}
            </div>
          )}

          {(deal.person || deal.owner) && (
            <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border">
              {deal.person && (
                <span>
                  {deal.person.firstName}
                  {deal.person.lastName && ` ${deal.person.lastName}`}
                </span>
              )}
              {deal.owner && !deal.person && <span>{deal.owner.name}</span>}
            </div>
          )}
        </a>
      )}
    </Draggable>
  )
}
