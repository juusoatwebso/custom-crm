"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { noteSchema, type NoteInput } from "@/lib/validators";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useState, useEffect } from "react";
import { Plus } from "lucide-react";
import { QuickCreateOrg, QuickCreatePerson, type QuickOrg, type QuickPerson } from "./quick-create";
import { useToast } from "@/components/ui/toast";

interface Deal {
  id: string;
  title: string;
}

interface NoteFormProps {
  defaultValues?: Partial<NoteInput>;
  noteId?: string;
  onSuccess?: (data: any) => void;
}

export function NoteForm({
  defaultValues,
  noteId,
  onSuccess,
}: NoteFormProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [organizations, setOrganizations] = useState<QuickOrg[]>([]);
  const [persons, setPersons] = useState<QuickPerson[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showNewOrg, setShowNewOrg] = useState(false);
  const [showNewPerson, setShowNewPerson] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(noteSchema) as any,
    defaultValues: defaultValues || {
      content: "",
      organizationId: "",
      personId: "",
      dealId: "",
    },
  });

  const organizationIdValue = watch("organizationId");

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [orgsRes, personsRes, dealsRes] = await Promise.all([
          fetch("/api/organizations?pageSize=1000"),
          fetch("/api/persons?pageSize=1000"),
          fetch("/api/deals?pageSize=1000"),
        ]);

        const orgsData = await orgsRes.json();
        const personsData = await personsRes.json();
        const dealsData = await dealsRes.json();

        setOrganizations(orgsData.data || []);
        setPersons(personsData.data || []);
        setDeals(dealsData.data || []);
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleOrgCreated = (org: QuickOrg) => {
    setOrganizations((prev) => [...prev, org].sort((a, b) => a.name.localeCompare(b.name)));
    setValue("organizationId", org.id);
    setShowNewOrg(false);
  };

  const handlePersonCreated = (person: QuickPerson) => {
    setPersons((prev) => [...prev, person].sort((a, b) => a.firstName.localeCompare(b.firstName)));
    setValue("personId", person.id);
    setShowNewPerson(false);
  };

  const onSubmit = async (data: NoteInput) => {
    setIsSubmitting(true);
    try {
      const url = noteId ? `/api/notes/${noteId}` : "/api/notes";
      const method = noteId ? "PUT" : "POST";

      // Clean empty strings for optional fields
      const cleanedData: Record<string, any> = { ...data };
      const optionalFields = ["organizationId", "personId", "dealId"];
      for (const field of optionalFields) {
        if (cleanedData[field] === "") cleanedData[field] = undefined;
      }

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(cleanedData),
      });

      if (!response.ok) {
        throw new Error("Failed to save note");
      }

      const result = await response.json();
      toast(noteId ? "Note updated" : "Note saved");
      onSuccess?.(result);
    } catch (error) {
      console.error("Error saving note:", error);
      toast("Failed to save note", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return <div className="text-center py-4">Loading...</div>;
  }

  return (
    <>
      <form onSubmit={handleSubmit(onSubmit as any)} className="space-y-4">
        <div>
          <Label htmlFor="content">Content *</Label>
          <Textarea
            id="content"
            {...register("content")}
            placeholder="Write a note..."
            disabled={isSubmitting}
            rows={5}
          />
          {errors.content && (
            <p className="text-red-500 text-sm mt-1">{errors.content.message}</p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <Label htmlFor="organizationId">Organization</Label>
            <button
              type="button"
              onClick={() => setShowNewOrg(true)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="h-3 w-3" />
              New
            </button>
          </div>
          <Select
            id="organizationId"
            {...register("organizationId")}
            disabled={isSubmitting}
          >
            <option value="">Select organization</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </Select>
          {errors.organizationId && (
            <p className="text-red-500 text-sm mt-1">
              {errors.organizationId.message}
            </p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <Label htmlFor="personId">Contact</Label>
            <button
              type="button"
              onClick={() => setShowNewPerson(true)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="h-3 w-3" />
              New
            </button>
          </div>
          <Select
            id="personId"
            {...register("personId")}
            disabled={isSubmitting}
          >
            <option value="">Select person</option>
            {persons.map((person) => (
              <option key={person.id} value={person.id}>
                {person.firstName} {person.lastName || ""}
              </option>
            ))}
          </Select>
          {errors.personId && (
            <p className="text-red-500 text-sm mt-1">
              {errors.personId.message}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="dealId">Deal</Label>
          <Select id="dealId" {...register("dealId")} disabled={isSubmitting}>
            <option value="">Select deal</option>
            {deals.map((deal) => (
              <option key={deal.id} value={deal.id}>
                {deal.title}
              </option>
            ))}
          </Select>
          {errors.dealId && (
            <p className="text-red-500 text-sm mt-1">{errors.dealId.message}</p>
          )}
        </div>

        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? "Saving..." : "Save"}
        </Button>
      </form>

      {showNewOrg && (
        <QuickCreateOrg
          onCreated={handleOrgCreated}
          onCancel={() => setShowNewOrg(false)}
        />
      )}

      {showNewPerson && (
        <QuickCreatePerson
          organizations={organizations}
          selectedOrgId={organizationIdValue}
          onCreated={handlePersonCreated}
          onCancel={() => setShowNewPerson(false)}
        />
      )}
    </>
  );
}
