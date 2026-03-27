import { ReactNode } from "react"

interface HeaderProps {
  title: string
  description?: string
  children?: ReactNode
}

export function Header({ title, description, children }: HeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-border bg-white px-6 py-3.5">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-lg font-bold tracking-tight text-foreground">{title}</h1>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  )
}
