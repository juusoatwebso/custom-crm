"use client";

import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DealForm } from "@/components/forms/deal-form";

export default function NewLeadPage() {
  const router = useRouter();

  const handleSuccess = (data: any) => {
    router.push(`/deals/${data.id}`);
  };

  return (
    <div className="flex flex-col h-full">
      <Header title="Uusi liidi" description="Luo uusi liidi" />
      <div className="flex-1 p-6">
        <div className="max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle>Liidin tiedot</CardTitle>
            </CardHeader>
            <CardContent>
              <DealForm
                defaultValues={{ isLead: true, status: "OPEN" }}
                onSuccess={handleSuccess}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
