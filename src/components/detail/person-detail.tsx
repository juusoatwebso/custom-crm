"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, useDialog } from "@/components/ui/dialog";
import { PersonForm } from "@/components/forms/person-form";
import { formatDate } from "@/lib/utils";
import { Pencil, Mail, Phone, Building2 } from "lucide-react";

interface Person {
  id: string;
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  organization?: {
    id: string;
    name: string;
  };
  owner?: {
    name: string;
  };
  deals: Array<{
    id: string;
    title: string;
    status: string;
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

interface PersonDetailProps {
  person: Person;
}

export function PersonDetail({ person }: PersonDetailProps) {
  const router = useRouter();
  const editDialog = useDialog();

  const handleEditSuccess = async (data: any) => {
    editDialog.close();
    router.refresh();
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 rounded-full bg-primary/10 text-primary flex items-center justify-center text-lg font-semibold flex-shrink-0">
            {person.firstName[0]}{(person.lastName || "")[0] || ""}
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">
              {person.firstName} {person.lastName || ""}
            </h2>
            <div className="flex items-center gap-4 text-sm text-muted-foreground mt-0.5">
              {person.jobTitle && <span>{person.jobTitle}</span>}
              {person.owner && <span>Owner: {person.owner.name}</span>}
            </div>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={editDialog.open}>
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {person.email && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Mail className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">Email</span>
              </div>
              <a href={`mailto:${person.email}`} className="text-sm font-medium text-primary hover:underline break-all">
                {person.email}
              </a>
            </CardContent>
          </Card>
        )}

        {person.phone && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Phone className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">Phone</span>
              </div>
              <a href={`tel:${person.phone}`} className="text-sm font-medium text-primary hover:underline">
                {person.phone}
              </a>
            </CardContent>
          </Card>
        )}

        {person.organization && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Building2 className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">Organization</span>
              </div>
              <Link href={`/organizations/${person.organization.id}`} className="text-sm font-medium text-primary hover:underline">
                {person.organization.name}
              </Link>
            </CardContent>
          </Card>
        )}
      </div>

      <Tabs defaultValue="deals">
        <TabsList>
          <TabsTrigger value="deals">Deals ({person.deals.length})</TabsTrigger>
          <TabsTrigger value="activities">Activities ({person.activities.length})</TabsTrigger>
          <TabsTrigger value="notes">Notes ({person.notes.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="deals">
          <Card>
            <CardContent className="p-4">
              {person.deals.length > 0 ? (
                <div className="space-y-1">
                  {person.deals.map((deal) => (
                    <Link
                      key={deal.id}
                      href={`/deals/${deal.id}`}
                      className="flex items-center justify-between  p-2.5 hover:bg-muted/50 transition-colors"
                    >
                      <p className="text-sm font-medium">{deal.title}</p>
                      <Badge
                        variant={deal.status === "WON" ? "success" : deal.status === "LOST" ? "destructive" : "info"}
                      >
                        {deal.status === "WON" ? "Won" : deal.status === "LOST" ? "Lost" : "Open"}
                      </Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm text-center py-8">
                  No deals added
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activities">
          <Card>
            <CardContent className="p-4">
              {person.activities.length > 0 ? (
                <div className="space-y-1">
                  {person.activities.map((activity) => (
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
                        {activity.done ? "Done" : "Open"}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm text-center py-8">
                  No activities added
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notes">
          <Card>
            <CardContent className="p-4">
              {person.notes.length > 0 ? (
                <div className="space-y-3">
                  {person.notes.map((note) => (
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
                  No notes added
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog ref={editDialog.ref}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit person</DialogTitle>
          </DialogHeader>
          <PersonForm
            defaultValues={{
              firstName: person.firstName,
              lastName: person.lastName,
              email: person.email,
              phone: person.phone,
              jobTitle: person.jobTitle,
              organizationId: person.organization?.id,
            }}
            personId={person.id}
            onSuccess={handleEditSuccess}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
