import type { Metadata } from "next"
import { Sidebar } from "@/components/layout/sidebar"
import { ToastProvider } from "@/components/ui/toast"
import { auth } from "@/lib/auth"
import "./globals.css"

export const metadata: Metadata = {
  title: "Webso CRM",
  description: "Sales CRM",
}

export const dynamic = "force-dynamic"

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  const isLoggedIn = !!session?.user

  return (
    <html lang="en">
      <head>
        <link href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-background text-foreground">
        <ToastProvider>
          {isLoggedIn ? (
            <div className="flex h-screen">
              <Sidebar />
              <main className="flex-1 ml-56 overflow-y-auto">
                {children}
              </main>
            </div>
          ) : (
            children
          )}
        </ToastProvider>
      </body>
    </html>
  )
}
