"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

const Dialog = React.forwardRef<
  HTMLDialogElement,
  React.DialogHTMLAttributes<HTMLDialogElement>
>(({ className, ...props }, ref) => (
  <dialog
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 max-h-[85vh] w-full max-w-lg overflow-y-auto border border-border bg-card shadow-2xl backdrop:bg-black/60",
      className
    )}
    {...props}
  />
))
Dialog.displayName = "Dialog"

interface DialogTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode
}

const DialogTrigger = React.forwardRef<HTMLButtonElement, DialogTriggerProps>(
  ({ onClick, children, ...props }, ref) => (
    <button ref={ref} onClick={onClick} {...props}>{children}</button>
  )
)
DialogTrigger.displayName = "DialogTrigger"

const DialogContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] border border-border bg-card p-6 shadow-2xl",
      className
    )}
    {...props}
  />
))
DialogContent.displayName = "DialogContent"

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 pb-4 mb-4 border-b border-border", className)} {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 pt-4 mt-4 border-t border-border", className)} {...props} />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h2 ref={ref} className={cn("text-base font-bold leading-none tracking-tight", className)} {...props} />
))
DialogTitle.displayName = "DialogTitle"

const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
))
DialogDescription.displayName = "DialogDescription"

function useDialog() {
  const [isOpen, setIsOpen] = React.useState(false)
  const dialogRef = React.useRef<HTMLDialogElement>(null)
  const open = () => { setIsOpen(true); dialogRef.current?.showModal() }
  const close = () => { setIsOpen(false); dialogRef.current?.close() }
  return { open, close, isOpen, ref: dialogRef }
}

export { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription, useDialog }
