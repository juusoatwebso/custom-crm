"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { organizationSchema, type OrganizationInput } from "@/lib/validators";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";

interface OrganizationFormProps {
  defaultValues?: Partial<OrganizationInput>;
  organizationId?: string;
  onSuccess?: (data: any) => void;
}

export function OrganizationForm({
  defaultValues,
  organizationId,
  onSuccess,
}: OrganizationFormProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(organizationSchema) as any,
    defaultValues: defaultValues || {
      name: "",
      address: "",
      website: "",
      ytunnus: "",
      virallinen_nimi: "",
      henkilokunta: "",
      liikevaihto: "",
      perustettu: "",
      paatoimiala_tol: "",
      paatoimiala_pf: "",
      markkinointinimi: "",
    },
  });

  const onSubmit = async (data: OrganizationInput) => {
    setIsSubmitting(true);
    try {
      const url = organizationId
        ? `/api/organizations/${organizationId}`
        : "/api/organizations";
      const method = organizationId ? "PUT" : "POST";

      // Clean empty strings for optional fields
      const cleanedData: Record<string, any> = { ...data };
      const optionalFields = ["ownerId", "address", "website", "ytunnus", "virallinen_nimi", "henkilokunta", "liikevaihto", "perustettu", "paatoimiala_tol", "paatoimiala_pf", "markkinointinimi"];
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
        throw new Error("Failed to save organization");
      }

      const result = await response.json();
      toast(organizationId ? "Organization updated" : "Organization created");
      onSuccess?.(result);
    } catch (error) {
      console.error("Error saving organization:", error);
      toast("Failed to save organization", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit as any)} className="space-y-4">
      <div>
        <Label htmlFor="name">Name *</Label>
        <Input
          id="name"
          {...register("name")}
          placeholder="Organization name"
          disabled={isSubmitting}
        />
        {errors.name && (
          <p className="text-red-500 text-sm mt-1">{errors.name.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="ytunnus">Business ID</Label>
        <Input
          id="ytunnus"
          {...register("ytunnus")}
          placeholder="12345678-9"
          disabled={isSubmitting}
        />
        {errors.ytunnus && (
          <p className="text-red-500 text-sm mt-1">{errors.ytunnus.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="virallinen_nimi">Official name</Label>
        <Input
          id="virallinen_nimi"
          {...register("virallinen_nimi")}
          placeholder="Official name"
          disabled={isSubmitting}
        />
        {errors.virallinen_nimi && (
          <p className="text-red-500 text-sm mt-1">
            {errors.virallinen_nimi.message}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="address">Address</Label>
        <Input
          id="address"
          {...register("address")}
          placeholder="Street address, city"
          disabled={isSubmitting}
        />
        {errors.address && (
          <p className="text-red-500 text-sm mt-1">{errors.address.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="website">Website</Label>
        <Input
          id="website"
          {...register("website")}
          placeholder="https://example.com"
          disabled={isSubmitting}
        />
        {errors.website && (
          <p className="text-red-500 text-sm mt-1">{errors.website.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="markkinointinimi">Marketing name</Label>
        <Input
          id="markkinointinimi"
          {...register("markkinointinimi")}
          placeholder="Marketing name"
          disabled={isSubmitting}
        />
        {errors.markkinointinimi && (
          <p className="text-red-500 text-sm mt-1">
            {errors.markkinointinimi.message}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="henkilokunta">Staff</Label>
        <Input
          id="henkilokunta"
          {...register("henkilokunta")}
          placeholder="Count or range"
          disabled={isSubmitting}
        />
        {errors.henkilokunta && (
          <p className="text-red-500 text-sm mt-1">
            {errors.henkilokunta.message}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="liikevaihto">Revenue</Label>
        <Input
          id="liikevaihto"
          {...register("liikevaihto")}
          placeholder="Revenue"
          disabled={isSubmitting}
        />
        {errors.liikevaihto && (
          <p className="text-red-500 text-sm mt-1">
            {errors.liikevaihto.message}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="perustettu">Founded</Label>
        <Input
          id="perustettu"
          {...register("perustettu")}
          placeholder="Year or date"
          disabled={isSubmitting}
        />
        {errors.perustettu && (
          <p className="text-red-500 text-sm mt-1">
            {errors.perustettu.message}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="paatoimiala_tol">Main industry (TOL)</Label>
        <Input
          id="paatoimiala_tol"
          {...register("paatoimiala_tol")}
          placeholder="TOL code"
          disabled={isSubmitting}
        />
        {errors.paatoimiala_tol && (
          <p className="text-red-500 text-sm mt-1">
            {errors.paatoimiala_tol.message}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="paatoimiala_pf">Main industry (PF)</Label>
        <Input
          id="paatoimiala_pf"
          {...register("paatoimiala_pf")}
          placeholder="PF code"
          disabled={isSubmitting}
        />
        {errors.paatoimiala_pf && (
          <p className="text-red-500 text-sm mt-1">
            {errors.paatoimiala_pf.message}
          </p>
        )}
      </div>

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "Saving..." : "Save"}
      </Button>
    </form>
  );
}
