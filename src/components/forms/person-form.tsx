"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { personSchema, type PersonInput } from "@/lib/validators";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useState, useEffect } from "react";
import { Plus } from "lucide-react";
import { QuickCreateOrg, type QuickOrg } from "./quick-create";
import { useToast } from "@/components/ui/toast";

interface PersonFormProps {
  defaultValues?: Partial<PersonInput>;
  personId?: string;
  onSuccess?: (data: any) => void;
}

export function PersonForm({
  defaultValues,
  personId,
  onSuccess,
}: PersonFormProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [organizations, setOrganizations] = useState<QuickOrg[]>([]);
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(true);
  const [showNewOrg, setShowNewOrg] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(personSchema) as any,
    defaultValues: defaultValues || {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      jobTitle: "",
      organizationId: "",
    },
  });

  useEffect(() => {
    const fetchOrganizations = async () => {
      try {
        const response = await fetch("/api/organizations?pageSize=1000");
        const data = await response.json();
        setOrganizations(data.data || []);
      } catch (error) {
        console.error("Error fetching organizations:", error);
      } finally {
        setIsLoadingOrgs(false);
      }
    };
    fetchOrganizations();
  }, []);

  const handleOrgCreated = (org: QuickOrg) => {
    setOrganizations((prev) => [...prev, org].sort((a, b) => a.name.localeCompare(b.name)));
    setValue("organizationId", org.id);
    setShowNewOrg(false);
  };

  const onSubmit = async (data: PersonInput) => {
    setIsSubmitting(true);
    try {
      const url = personId ? `/api/persons/${personId}` : "/api/persons";
      const method = personId ? "PUT" : "POST";

      // Clean empty strings for optional fields
      const cleanedData: Record<string, any> = { ...data };
      const optionalFields = ["organizationId", "ownerId", "email", "phone", "jobTitle", "lastName"];
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
        throw new Error("Failed to save person");
      }

      const result = await response.json();
      toast(personId ? "Contact updated" : "Contact created");
      onSuccess?.(result);
    } catch (error) {
      console.error("Error saving person:", error);
      toast("Failed to save contact", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <form onSubmit={handleSubmit(onSubmit as any)} className="space-y-4">
        <div>
          <Label htmlFor="firstName">First name *</Label>
          <Input
            id="firstName"
            {...register("firstName")}
            placeholder="First name"
            disabled={isSubmitting}
          />
          {errors.firstName && (
            <p className="text-red-500 text-sm mt-1">{errors.firstName.message}</p>
          )}
        </div>

        <div>
          <Label htmlFor="lastName">Last name</Label>
          <Input
            id="lastName"
            {...register("lastName")}
            placeholder="Last name"
            disabled={isSubmitting}
          />
          {errors.lastName && (
            <p className="text-red-500 text-sm mt-1">{errors.lastName.message}</p>
          )}
        </div>

        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            {...register("email")}
            placeholder="john@example.com"
            disabled={isSubmitting}
          />
          {errors.email && (
            <p className="text-red-500 text-sm mt-1">{errors.email.message}</p>
          )}
        </div>

        <div>
          <Label htmlFor="phone">Phone number</Label>
          <Input
            id="phone"
            {...register("phone")}
            placeholder="+358 10 123 4567"
            disabled={isSubmitting}
          />
          {errors.phone && (
            <p className="text-red-500 text-sm mt-1">{errors.phone.message}</p>
          )}
        </div>

        <div>
          <Label htmlFor="jobTitle">Job title</Label>
          <Input
            id="jobTitle"
            {...register("jobTitle")}
            placeholder="CEO"
            disabled={isSubmitting}
          />
          {errors.jobTitle && (
            <p className="text-red-500 text-sm mt-1">{errors.jobTitle.message}</p>
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
            disabled={isSubmitting || isLoadingOrgs}
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
    </>
  );
}
