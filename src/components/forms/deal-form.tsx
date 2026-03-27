"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { dealSchema, type DealInput } from "@/lib/validators";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DEAL_STATUSES } from "@/lib/constants";
import { useState, useEffect } from "react";
import { Plus } from "lucide-react";
import { QuickCreateOrg, QuickCreatePerson, type QuickOrg, type QuickPerson } from "./quick-create";
import { useToast } from "@/components/ui/toast";

type Organization = QuickOrg;
type Person = QuickPerson;

interface Pipeline {
  id: string;
  name: string;
  stages: Stage[];
}

interface Stage {
  id: string;
  name: string;
  pipelineId: string;
}


interface DealFormProps {
  defaultValues?: Partial<DealInput>;
  dealId?: string;
  onSuccess?: (data: any) => void;
}

export function DealForm({
  defaultValues,
  dealId,
  onSuccess,
}: DealFormProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [showNewOrg, setShowNewOrg] = useState(false);
  const [showNewPerson, setShowNewPerson] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(dealSchema) as any,
    defaultValues: defaultValues || {
      title: "",
      value: undefined,
      currency: "EUR",
      status: "OPEN",
      expectedCloseDate: "",
      lostReason: "",
      probability: 50,
      pipelineId: "",
      stageId: "",
      organizationId: "",
      personId: "",
    },
  });

  const statusValue = watch("status");
  const pipelineIdValue = watch("pipelineId");
  const organizationIdValue = watch("organizationId");

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [orgsRes, personsRes, pipelinesRes] = await Promise.all([
          fetch("/api/organizations?pageSize=1000"),
          fetch("/api/persons?pageSize=1000"),
          fetch("/api/pipelines"),
        ]);

        const orgsData = await orgsRes.json();
        const personsData = await personsRes.json();
        const pipelinesData = await pipelinesRes.json();

        setOrganizations(orgsData.data || []);
        setPersons(personsData.data || []);
        setPipelines(pipelinesData.data || []);
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  useEffect(() => {
    if (pipelineIdValue) {
      const pipeline = pipelines.find((p) => p.id === pipelineIdValue);
      setStages(pipeline?.stages || []);
    } else {
      setStages([]);
    }
  }, [pipelineIdValue, pipelines]);

  const handleOrgCreated = (org: Organization) => {
    setOrganizations((prev) => [...prev, org].sort((a, b) => a.name.localeCompare(b.name)));
    setValue("organizationId", org.id);
    setShowNewOrg(false);
  };

  const handlePersonCreated = (person: Person) => {
    setPersons((prev) => [...prev, person].sort((a, b) => a.firstName.localeCompare(b.firstName)));
    setValue("personId", person.id);
    setShowNewPerson(false);
  };

  const onSubmit = async (data: DealInput) => {
    setIsSubmitting(true);
    try {
      const url = dealId ? `/api/deals/${dealId}` : "/api/deals";
      const method = dealId ? "PUT" : "POST";

      // Clean empty strings for optional fields
      const cleanedData: Record<string, any> = { ...data };
      const optionalFields = ["pipelineId", "stageId", "organizationId", "personId", "ownerId", "expectedCloseDate", "lostReason"];
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
        throw new Error("Failed to save deal");
      }

      const result = await response.json();
      toast(dealId ? "Deal updated" : "Deal created");
      onSuccess?.(result);
    } catch (error) {
      console.error("Error saving deal:", error);
      toast("Failed to save deal", "error");
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
          <Label htmlFor="title">Deal title *</Label>
          <Input
            id="title"
            {...register("title")}
            placeholder="Deal title"
            disabled={isSubmitting}
          />
          {errors.title && (
            <p className="text-red-500 text-sm mt-1">{errors.title.message}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="value">Value</Label>
            <Input
              id="value"
              type="number"
              step="0.01"
              {...register("value")}
              placeholder="0"
              disabled={isSubmitting}
            />
            {errors.value && (
              <p className="text-red-500 text-sm mt-1">{errors.value.message}</p>
            )}
          </div>

          <div>
            <Label htmlFor="currency">Currency</Label>
            <Select
              id="currency"
              {...register("currency")}
              disabled={isSubmitting}
            >
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
              <option value="GBP">GBP</option>
              <option value="SEK">SEK</option>
            </Select>
            {errors.currency && (
              <p className="text-red-500 text-sm mt-1">
                {errors.currency.message}
              </p>
            )}
          </div>
        </div>

        <div>
          <Label htmlFor="status">Status</Label>
          <Select {...register("status")} disabled={isSubmitting}>
            {DEAL_STATUSES.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </Select>
          {errors.status && (
            <p className="text-red-500 text-sm mt-1">{errors.status.message}</p>
          )}
        </div>

        {statusValue === "LOST" && (
          <div>
            <Label htmlFor="lostReason">Lost reason</Label>
            <Input
              id="lostReason"
              {...register("lostReason")}
              placeholder="Why was the deal lost?"
              disabled={isSubmitting}
            />
            {errors.lostReason && (
              <p className="text-red-500 text-sm mt-1">
                {errors.lostReason.message}
              </p>
            )}
          </div>
        )}

        <div>
          <Label htmlFor="probability">Probability (%)</Label>
          <Input
            id="probability"
            type="number"
            min="0"
            max="100"
            {...register("probability")}
            placeholder="50"
            disabled={isSubmitting}
          />
          {errors.probability && (
            <p className="text-red-500 text-sm mt-1">
              {errors.probability.message}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="expectedCloseDate">Expected close date</Label>
          <Input
            id="expectedCloseDate"
            type="date"
            {...register("expectedCloseDate")}
            disabled={isSubmitting}
          />
          {errors.expectedCloseDate && (
            <p className="text-red-500 text-sm mt-1">
              {errors.expectedCloseDate.message}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="pipelineId">Pipeline</Label>
          <Select
            id="pipelineId"
            {...register("pipelineId")}
            disabled={isSubmitting}
          >
            <option value="">Select pipeline</option>
            {pipelines.map((pipeline) => (
              <option key={pipeline.id} value={pipeline.id}>
                {pipeline.name}
              </option>
            ))}
          </Select>
          {errors.pipelineId && (
            <p className="text-red-500 text-sm mt-1">
              {errors.pipelineId.message}
            </p>
          )}
        </div>

        {stages.length > 0 && (
          <div>
            <Label htmlFor="stageId">Stage</Label>
            <Select {...register("stageId")} disabled={isSubmitting}>
              <option value="">Select stage</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </Select>
            {errors.stageId && (
              <p className="text-red-500 text-sm mt-1">
                {errors.stageId.message}
              </p>
            )}
          </div>
        )}

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
