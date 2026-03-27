import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatCurrency } from "@/lib/utils";
import { RecentActivities } from "@/components/dashboard/recent-activities";
import {
  Handshake,
  TrendingUp,
  CalendarDays,
  Target,
  ArrowRight,
} from "lucide-react";

async function getStats() {
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [openDeals, wonDeals, activities, newLeads] = await Promise.all([
    prisma.deal.aggregate({
      where: {
        status: "OPEN",
        isDeleted: false,
      },
      _count: true,
      _sum: {
        value: true,
      },
    }),
    prisma.deal.aggregate({
      where: {
        status: "WON",
        isDeleted: false,
        createdAt: {
          gte: firstDayOfMonth,
        },
      },
      _count: true,
      _sum: {
        value: true,
      },
    }),
    prisma.activity.count({
      where: {
        isDeleted: false,
        createdAt: {
          gte: firstDayOfMonth,
        },
      },
    }),
    prisma.deal.count({
      where: {
        isLead: true,
        isDeleted: false,
        createdAt: {
          gte: weekAgo,
        },
      },
    }),
  ]);

  return {
    openDeals: {
      count: openDeals._count,
      value: openDeals._sum.value || 0,
    },
    wonDeals: {
      count: wonDeals._count,
      value: wonDeals._sum.value || 0,
    },
    activities,
    newLeads,
  };
}

async function getRecentData() {
  const [activities, deals] = await Promise.all([
    prisma.activity.findMany({
      take: 10,
      orderBy: {
        createdAt: "desc",
      },
      where: {
        isDeleted: false,
      },
    }),
    prisma.deal.findMany({
      take: 10,
      orderBy: {
        createdAt: "desc",
      },
      where: {
        isDeleted: false,
      },
      include: {
        stage: {
          select: {
            name: true,
          },
        },
      },
    }),
  ]);

  return { activities, deals };
}


export default async function DashboardPage() {
  const stats = await getStats();
  const { activities, deals } = await getRecentData();

  const statCards = [
    {
      title: "Open deals",
      value: stats.openDeals.count.toString(),
      description: "Active sales cycles",
      icon: Handshake,
      color: "text-foreground bg-muted",
    },
    {
      title: "Pipeline value",
      value: formatCurrency(stats.openDeals.value),
      description: "Total value of open deals",
      icon: TrendingUp,
      color: "text-foreground bg-muted",
    },
    {
      title: "Activities",
      value: stats.activities.toString(),
      description: "This month",
      icon: CalendarDays,
      color: "text-foreground bg-muted",
    },
    {
      title: "New leads",
      value: stats.newLeads.toString(),
      description: "Last 7 days",
      icon: Target,
      color: "text-foreground bg-muted",
    },
  ];

  return (
    <div className="flex flex-col h-full">
      <Header title="Dashboard" description="Welcome to Webso CRM" />
      <div className="flex-1 p-6 overflow-auto">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          {statCards.map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.title}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{stat.title}</p>
                      <p className="text-xl font-bold tracking-tight">{stat.value}</p>
                      <p className="text-[11px] text-muted-foreground">{stat.description}</p>
                    </div>
                    <div className={`p-2 ${stat.color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <CardTitle className="text-base">Recent activities</CardTitle>
              <Link href="/activities" className="text-xs text-primary hover:underline flex items-center gap-1">
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </CardHeader>
            <CardContent>
              <RecentActivities activities={activities} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <CardTitle className="text-base">Recent deals</CardTitle>
              <Link href="/deals" className="text-xs text-primary hover:underline flex items-center gap-1">
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </CardHeader>
            <CardContent>
              {deals.length > 0 ? (
                <div className="space-y-1">
                  {deals.map((deal) => (
                    <Link
                      key={deal.id}
                      href={`/deals/${deal.id}`}
                      className="flex items-center gap-3 rounded-lg p-2.5 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{deal.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {deal.stage?.name || "No stage"} · {formatDate(deal.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {deal.value && (
                          <span className="text-xs font-semibold text-foreground">
                            {formatCurrency(deal.value, deal.currency)}
                          </span>
                        )}
                        <Badge
                          variant={
                            deal.status === "WON" ? "success" :
                            deal.status === "LOST" ? "destructive" : "info"
                          }
                          className="text-[10px]"
                        >
                          {deal.status === "WON" ? "Won" :
                           deal.status === "LOST" ? "Lost" : "Open"}
                        </Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No deals</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
