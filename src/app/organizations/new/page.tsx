"use client";

import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OrganizationForm } from "@/components/forms/organization-form";

export default function NewOrganizationPage() {
  const router = useRouter();

  const handleSuccess = (data: any) => {
    router.push(`/organizations/${data.id}`);
  };

  return (
    <div className="flex flex-col h-full">
      <Header title="Uusi organisaatio" description="Luo uusi organisaatio" />
      <div className="flex-1 p-6">
        <div className="max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle>Organisaation tiedot</CardTitle>
            </CardHeader>
            <CardContent>
              <OrganizationForm onSuccess={handleSuccess} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
