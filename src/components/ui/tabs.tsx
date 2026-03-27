"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface TabsContextType {
  activeTab: string
  onTabChange: (tabId: string) => void
}

const TabsContext = React.createContext<TabsContextType | undefined>(undefined)

const useTabs = () => {
  const context = React.useContext(TabsContext)
  if (!context) throw new Error("useTabs must be used within a Tabs component")
  return context
}

interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultValue: string
  onValueChange?: (value: string) => void
}

const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  ({ className, defaultValue, onValueChange, children, ...props }, ref) => {
    const [activeTab, setActiveTab] = React.useState(defaultValue)
    const handleTabChange = (tabId: string) => { setActiveTab(tabId); onValueChange?.(tabId); }
    return (
      <TabsContext.Provider value={{ activeTab, onTabChange: handleTabChange }}>
        <div ref={ref} className={cn("w-full", className)} {...props}>{children}</div>
      </TabsContext.Provider>
    )
  }
)
Tabs.displayName = "Tabs"

const TabsList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("inline-flex h-8 items-center gap-0 border-b border-border", className)} {...props} />
  )
)
TabsList.displayName = "TabsList"

interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { value: string }

const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className, value, ...props }, ref) => {
    const { activeTab, onTabChange } = useTabs()
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center px-3 pb-2 text-sm font-medium transition-colors duration-75 cursor-pointer -mb-px",
          activeTab === value
            ? "text-foreground border-b-2 border-foreground"
            : "text-muted-foreground hover:text-foreground",
          className
        )}
        onClick={() => onTabChange(value)}
        {...props}
      />
    )
  }
)
TabsTrigger.displayName = "TabsTrigger"

interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> { value: string }

const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, value, ...props }, ref) => {
    const { activeTab } = useTabs()
    if (activeTab !== value) return null
    return <div ref={ref} className={cn("mt-4", className)} {...props} />
  }
)
TabsContent.displayName = "TabsContent"

export { Tabs, TabsList, TabsTrigger, TabsContent }
