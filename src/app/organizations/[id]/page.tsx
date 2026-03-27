import { prisma } from "@/lib/prisma";
import { Header } from "@/components/layout/header";
import { OrganizationDetail } from "@/components/detail/organization-detail";
import { notFound } from "next/navigation";

interface OrganizationPageProps {
  params: Promise<{ id: string }>;
}

export default async function OrganizationPage({ params }: OrganizationPageProps) {
  const { id } = await params;
  const organization = await prisma.organization.findUnique({
    where: { id },
    include: {
      persons: { select: { id: true, firstName: true, lastName: true, email: true } },
      deals: { include: { stage: { select: { name: true } } } },
      notes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
      activities: { orderBy: { createdAt: "desc" } },
      owner: { select: { name: true } },
    },
  });

  if (!organization) notFound();

  return (
    <div className="flex flex-col h-full">
      <Header title={organization.name} description="Organisaation tiedot" />
      <div className="flex-1 p-6">
        <OrganizationDetail organization={organization as any} />
      </div>
    </div>
  );
}
