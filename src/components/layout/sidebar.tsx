"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboard,
  Handshake,
  Target,
  Building2,
  Users,
  CalendarDays,
  Kanban,
  Plus,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogHeader, DialogTitle, useDialog } from "@/components/ui/dialog"
import { DealForm } from "@/components/forms/deal-form"

const navigationItems = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Deals", href: "/deals", icon: Handshake },
  { label: "Leads", href: "/leads", icon: Target },
  { label: "Organizations", href: "/organizations", icon: Building2 },
  { label: "People", href: "/persons", icon: Users },
  { label: "Activities", href: "/activities", icon: CalendarDays },
  { label: "Pipeline", href: "/pipeline", icon: Kanban },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const newDealDialog = useDialog()

  const handleNewDealSuccess = (data: any) => {
    newDealDialog.close()
    router.push(`/deals/${data.id}`)
  }

  return (
    <aside className="w-56 bg-sidebar text-sidebar-foreground fixed left-0 top-0 bottom-0 overflow-y-auto flex flex-col border-r border-white/[0.06]">
      <div className="px-5 py-5">
        <Link href="/" className="block">
          <img
            src="/webso-logo.svg"
            alt="Webso"
            className="h-5 w-auto opacity-90"
          />
        </Link>
      </div>

      <div className="px-3 mb-2">
        <div className="h-px bg-white/[0.08]" />
      </div>

      <div className="px-3 mb-3">
        <button
          onClick={newDealDialog.open}
          className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-medium bg-white/[0.08] border border-white/[0.12] text-white hover:bg-white/[0.14] transition-colors duration-75"
        >
          <Plus className="h-3.5 w-3.5 flex-shrink-0" />
          New deal
        </button>
      </div>

      <nav className="flex-1 px-3 space-y-px">
        {navigationItems.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href))

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 text-[13px] font-medium transition-colors duration-75",
                isActive
                  ? "bg-white/[0.08] text-white border border-white/[0.06]"
                  : "text-sidebar-foreground/50 hover:bg-white/[0.04] hover:text-sidebar-foreground/80"
              )}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="px-3 py-3 mt-auto">
        <div className="h-px bg-white/[0.08] mb-3" />
        <p className="px-3 text-[11px] text-sidebar-foreground/30">Webso CRM v1.0</p>
      </div>

      <Dialog ref={newDealDialog.ref}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New deal</DialogTitle>
          </DialogHeader>
          <DealForm onSuccess={handleNewDealSuccess} />
        </DialogContent>
      </Dialog>
    </aside>
  )
}
