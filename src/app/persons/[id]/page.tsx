import { prisma } from "@/lib/prisma";
import { Header } from "@/components/layout/header";
import { PersonDetail } from "@/components/detail/person-detail";
import { notFound } from "next/navigation";

interface PersonPageProps {
  params: Promise<{ id: string }>;
}

export default async function PersonPage({ params }: PersonPageProps) {
  const { id } = await params;
  const person = await prisma.person.findUnique({
    where: { id },
    include: {
      organization: { select: { id: true, name: true } },
      deals: { select: { id: true, title: true, status: true } },
      notes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
      activities: { orderBy: { createdAt: "desc" } },
      owner: { select: { name: true } },
    },
  });

  if (!person) notFound();

  return (
    <div className="flex flex-col h-full">
      <Header title={`${person.firstName} ${person.lastName || ""}`} description="Henkilön tiedot" />
      <div className="flex-1 p-6">
        <PersonDetail person={person as any} />
      </div>
    </div>
  );
}
