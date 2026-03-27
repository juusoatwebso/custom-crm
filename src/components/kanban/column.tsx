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

interface Stage {
  id: string
  name: string
}

interface KanbanColumnProps {
  stage: Stage
  deals: KanbanDeal[]
  index: number
}

export function KanbanColumn({ stage, deals }: KanbanColumnProps) {
  const totalValue = deals.reduce((sum, deal) => sum + (deal.value || 0), 0)

  return (
    <div className="bg-muted/50 flex flex-col max-h-[calc(100vh-220px)] border border-border">
      <div className="p-3 sticky top-0 bg-muted/50 border-b border-border backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">{stage.name}</span>
          <span className="text-[11px] font-medium text-muted-foreground bg-card border border-border px-1.5 py-0.5">
            {deals.length}
          </span>
        </div>
        {totalValue > 0 && (
          <div className="text-xs font-medium text-muted-foreground mt-1.5 tabular-nums">
            {formatCurrency(totalValue, deals[0]?.currency || "EUR")}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {deals.map((deal, index) => (
          <Draggable key={deal.id} draggableId={deal.id} index={index}>
            {(provided, snapshot) => (
              <a
                ref={provided.innerRef}
                {...provided.draggableProps}
                {...provided.dragHandleProps}
                href={`/deals/${deal.id}`}
                className={cn(
                  "block bg-card border border-border p-3 hover:border-foreground/20 transition-all duration-75 cursor-grab active:cursor-grabbing",
                  snapshot.isDragging && "shadow-lg border-foreground/30 rotate-1"
                )}
                onClick={(e) => {
                  if (snapshot.isDragging) {
                    e.preventDefault()
                  }
                }}
              >
                <div className="font-medium text-sm truncate">
                  {deal.title}
                </div>

                {deal.organization && (
                  <div className="text-xs text-muted-foreground mt-1 truncate">
                    {deal.organization.name}
                  </div>
                )}

                {deal.value != null && deal.value > 0 && (
                  <div className="text-sm font-semibold mt-2 text-foreground tabular-nums">
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
        ))}
        {deals.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-10">
            No deals
          </div>
        )}
      </div>
    </div>
  )
}
