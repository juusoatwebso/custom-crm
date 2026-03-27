"use client";

import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DealForm } from "@/components/forms/deal-form";

export default function NewDealPage() {
  const router = useRouter();

  const handleSuccess = (data: any) => {
    router.push(`/deals/${data.id}`);
  };

  return (
    <div className="flex flex-col h-full">
      <Header title="Uusi kauppa" description="Luo uusi kauppa" />
      <div className="flex-1 p-6">
        <div className="max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle>Kaupan tiedot</CardTitle>
            </CardHeader>
            <CardContent>
              <DealForm onSuccess={handleSuccess} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
