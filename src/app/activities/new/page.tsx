"use client";

import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivityForm } from "@/components/forms/activity-form";

export default function NewActivityPage() {
  const router = useRouter();

  const handleSuccess = (data: any) => {
    router.back();
  };

  return (
    <div className="flex flex-col h-full">
      <Header title="Uusi aktiviteetti" description="Luo uusi aktiviteetti" />
      <div className="flex-1 p-6">
        <div className="max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle>Aktiviteetin tiedot</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityForm onSuccess={handleSuccess} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
