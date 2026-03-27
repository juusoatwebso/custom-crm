"use client";

import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PersonForm } from "@/components/forms/person-form";

export default function NewPersonPage() {
  const router = useRouter();

  const handleSuccess = (data: any) => {
    router.push(`/persons/${data.id}`);
  };

  return (
    <div className="flex flex-col h-full">
      <Header title="Uusi henkilö" description="Luo uusi henkilö" />
      <div className="flex-1 p-6">
        <div className="max-w-2xl">
          <Card>
            <CardHeader>
              <CardTitle>Henkilön tiedot</CardTitle>
            </CardHeader>
            <CardContent>
              <PersonForm onSuccess={handleSuccess} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
