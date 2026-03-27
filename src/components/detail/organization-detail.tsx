"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, useDialog } from "@/components/ui/dialog";
import { OrganizationForm } from "@/components/forms/organization-form";
import { formatDate, formatCurrency } from "@/lib/utils";
import { Pencil, Globe, MapPin, Hash, Building2, Users2, TrendingUp, Calendar } from "lucide-react";

interface Organization {
  id: string;
  name: string;
  address?: string;
  website?: string;
  ytunnus?: string;
  virallinen_nimi?: string;
  henkilokunta?: string;
  liikevaihto?: string;
  perustettu?: string;
  paatoimiala_tol?: string;
  paatoimiala_pf?: string;
  markkinointinimi?: string;
  owner?: {
    name: string;
  };
  persons: Array<{
    id: string;
    firstName: string;
    lastName?: string;
    email?: string;
  }>;
  deals: Array<{
    id: string;
    title: string;
    value?: number;
    status: string;
    stage?: {
      name: string;
    };
  }>;
  notes: Array<{
    id: string;
    content: string;
    createdAt: string;
    author?: {
      name: string;
    };
  }>;
  activities: Array<{
    id: string;
    subject: string;
    type: string;
    done: boolean;
    dueDate?: string;
  }>;
  createdAt: string;
}

interface OrganizationDetailProps {
  organization: Organization;
}

export function OrganizationDetail({
  organization,
}: OrganizationDetailProps) {
  const router = useRouter();
  const editDialog = useDialog();
  const [isLoading, setIsLoading] = useState(false);

  const handleEditSuccess = async (data: any) => {
    editDialog.close();
    router.refresh();
  };

  const infoItems = [
    { icon: Hash, label: "Business ID", value: organization.ytunnus },
    { icon: Building2, label: "Official name", value: organization.virallinen_nimi },
    { icon: MapPin, label: "Address", value: organization.address },
    { icon: Globe, label: "Website", value: organization.website, isLink: true },
    { icon: Building2, label: "Marketing name", value: organization.markkinointinimi },
    { icon: Users2, label: "Staff", value: organization.henkilokunta },
    { icon: TrendingUp, label: "Revenue", value: organization.liikevaihto },
    { icon: Calendar, label: "Founded", value: organization.perustettu },
  ].filter(item => item.value);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{organization.name}</h2>
          <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
            {organization.owner && <span>Owner: {organization.owner.name}</span>}
            {organization.ytunnus && <span className="font-mono">{organization.ytunnus}</span>}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={editDialog.open}>
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Button>
      </div>

      {infoItems.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {infoItems.map((item) => {
            const Icon = item.icon;
            return (
              <Card key={item.label}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Icon className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">{item.label}</span>
                  </div>
                  {item.isLink ? (
                    <a href={item.value!} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary hover:underline break-all">
                      {item.value}
                    </a>
                  ) : (
                    <p className="text-sm font-medium">{item.value}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Tabs defaultValue="persons">
        <TabsList>
          <TabsTrigger value="persons">People ({organization.persons.length})</TabsTrigger>
          <TabsTrigger value="deals">Deals ({organization.deals.length})</TabsTrigger>
          <TabsTrigger value="activities">Activities ({organization.activities.length})</TabsTrigger>
          <TabsTrigger value="notes">Notes ({organization.notes.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="persons">
          <Card>
            <CardContent className="p-4">
              {organization.persons.length > 0 ? (
                <div className="space-y-1">
                  {organization.persons.map((person) => (
                    <Link
                      key={person.id}
                      href={`/persons/${person.id}`}
                      className="flex items-center gap-3  p-2.5 hover:bg-muted/50 transition-colors"
                    >
                      <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold flex-shrink-0">
                        {person.firstName[0]}{(person.lastName || "")[0] || ""}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{person.firstName} {person.lastName || ""}</p>
                        {person.email && (
                          <p className="text-xs text-muted-foreground truncate">{person.email}</p>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm text-center py-8">
                  No people added
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="deals">
          <Card>
            <CardContent className="p-4">
              {organization.deals.length > 0 ? (
                <div className="space-y-1">
                  {organization.deals.map((deal) => (
                    <Link
                      key={deal.id}
                      href={`/deals/${deal.id}`}
                      className="flex items-center justify-between  p-2.5 hover:bg-muted/50 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{deal.title}</p>
                        {deal.stage && (
                          <p className="text-xs text-muted-foreground">{deal.stage.name}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {deal.value && (
                          <span className="text-xs font-semibold">{formatCurrency(deal.value)}</span>
                        )}
                        <Badge
                          variant={deal.status === "WON" ? "success" : deal.status === "LOST" ? "destructive" : "info"}
                        >
                          {deal.status === "WON" ? "Voitettu" : deal.status === "LOST" ? "Hävitty" : "Avoin"}
                        </Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm text-center py-8">
                  Ei kauppoja lisätty
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activities">
          <Card>
            <CardContent className="p-4">
              {organization.activities.length > 0 ? (
                <div className="space-y-1">
                  {organization.activities.map((activity) => (
                    <div
                      key={activity.id}
                      className="flex items-center gap-3  p-2.5 hover:bg-muted/50 transition-colors"
                    >
                      <div className={`h-2 w-2 rounded-full flex-shrink-0 ${activity.done ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${activity.done ? "line-through text-muted-foreground" : "font-medium"}`}>
                          {activity.subject}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {activity.type}
                          {activity.dueDate && ` · ${formatDate(activity.dueDate)}`}
                        </p>
                      </div>
                      <Badge variant={activity.done ? "success" : "warning"} className="text-[10px]">
                        {activity.done ? "Tehty" : "Avoin"}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm text-center py-8">
                  Ei aktiviteetteja lisätty
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notes">
          <Card>
            <CardContent className="p-4">
              {organization.notes.length > 0 ? (
                <div className="space-y-3">
                  {organization.notes.map((note) => (
                    <div key={note.id} className="p-3  bg-muted/50">
                      <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                      <p className="text-xs text-muted-foreground mt-2">
                        {note.author && `${note.author.name} · `}
                        {formatDate(note.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm text-center py-8">
                  Ei muistiinpanoja lisätty
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog ref={editDialog.ref}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Muokkaa organisaatiota</DialogTitle>
          </DialogHeader>
          <OrganizationForm
            defaultValues={{
              name: organization.name,
              address: organization.address,
              website: organization.website,
              ytunnus: organization.ytunnus,
              virallinen_nimi: organization.virallinen_nimi,
              henkilokunta: organization.henkilokunta,
              liikevaihto: organization.liikevaihto,
              perustettu: organization.perustettu,
              paatoimiala_tol: organization.paatoimiala_tol,
              paatoimiala_pf: organization.paatoimiala_pf,
              markkinointinimi: organization.markkinointinimi,
            }}
            organizationId={organization.id}
            onSuccess={handleEditSuccess}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
