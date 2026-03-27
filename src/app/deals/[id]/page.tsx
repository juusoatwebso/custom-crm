import { prisma } from "@/lib/prisma";
import { Header } from "@/components/layout/header";
import { DealDetail } from "@/components/detail/deal-detail";
import { notFound } from "next/navigation";

interface DealPageProps {
  params: Promise<{ id: string }>;
}

export default async function DealPage({ params }: DealPageProps) {
  const { id } = await params;
  const deal = await prisma.deal.findUnique({
    where: { id },
    include: {
      organization: { select: { id: true, name: true } },
      person: { select: { id: true, firstName: true, lastName: true } },
      stage: { select: { name: true } },
      pipeline: { select: { name: true, stages: { select: { id: true, name: true, orderNr: true }, orderBy: { orderNr: "asc" } } } },
      notes: { orderBy: { createdAt: "desc" }, select: { id: true, content: true, createdAt: true, pipedriveId: true, author: { select: { name: true } } } },
      activities: { where: { isDeleted: false }, orderBy: { createdAt: "desc" }, include: { assignee: { select: { name: true } } } },
      owner: { select: { name: true } },
      flowEvents: {
        orderBy: { timestamp: "desc" },
        include: { user: { select: { name: true } } },
      },
    },
  });

  if (!deal) notFound();

  return (
    <div className="flex flex-col h-full">
      <Header title={deal.title} description="Kaupan tiedot" />
      <div className="flex-1 p-6 overflow-auto">
        <DealDetail deal={deal as any} />
      </div>
    </div>
  );
}
