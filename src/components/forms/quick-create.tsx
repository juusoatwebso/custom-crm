"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { X } from "lucide-react";
import { useToast } from "@/components/ui/toast";

export interface QuickOrg {
  id: string;
  name: string;
}

export interface QuickPerson {
  id: string;
  firstName: string;
  lastName?: string;
  organizationId?: string;
}

// --- Quick-create popup for Organization ---
export function QuickCreateOrg({
  onCreated,
  onCancel,
}: {
  onCreated: (org: QuickOrg) => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [ytunnus, setYtunnus] = useState("");
  const [website, setWebsite] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSave = async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    setIsSaving(true);
    setError("");
    try {
      const res = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          ytunnus: ytunnus.trim() || undefined,
          website: website.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to create");
      const created = await res.json();
      toast("Organization created");
      onCreated({ id: created.id, name: created.name });
    } catch {
      setError("Failed to create organization");
      toast("Failed to create organization", "error");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div
        className="bg-card border border-border shadow-2xl p-5 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold">New organization</h3>
          <button type="button" onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <Label htmlFor="qc-org-name">Name *</Label>
            <Input
              ref={inputRef}
              id="qc-org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Organization name"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSave(); } }}
            />
          </div>
          <div>
            <Label htmlFor="qc-org-ytunnus">Business ID</Label>
            <Input
              id="qc-org-ytunnus"
              value={ytunnus}
              onChange={(e) => setYtunnus(e.target.value)}
              placeholder="1234567-8"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSave(); } }}
            />
          </div>
          <div>
            <Label htmlFor="qc-org-website">Website</Label>
            <Input
              id="qc-org-website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://example.com"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSave(); } }}
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button type="button" onClick={handleSave} disabled={isSaving} className="flex-1">
              {isSaving ? "Creating..." : "Create"}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Quick-create popup for Contact ---
export function QuickCreatePerson({
  organizations,
  selectedOrgId,
  onCreated,
  onCancel,
}: {
  organizations: QuickOrg[];
  selectedOrgId?: string;
  onCreated: (person: QuickPerson) => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [organizationId, setOrganizationId] = useState(selectedOrgId || "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSave = async () => {
    if (!firstName.trim()) { setError("First name is required"); return; }
    setIsSaving(true);
    setError("");
    try {
      const res = await fetch("/api/persons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          jobTitle: jobTitle.trim() || undefined,
          organizationId: organizationId || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to create");
      const created = await res.json();
      toast("Contact created");
      onCreated({
        id: created.id,
        firstName: created.firstName,
        lastName: created.lastName,
        organizationId: created.organizationId,
      });
    } catch {
      setError("Failed to create contact");
      toast("Failed to create contact", "error");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div
        className="bg-card border border-border shadow-2xl p-5 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold">New contact</h3>
          <button type="button" onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="qc-p-first">First name *</Label>
              <Input
                ref={inputRef}
                id="qc-p-first"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSave(); } }}
              />
            </div>
            <div>
              <Label htmlFor="qc-p-last">Last name</Label>
              <Input
                id="qc-p-last"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSave(); } }}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="qc-p-email">Email</Label>
            <Input
              id="qc-p-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSave(); } }}
            />
          </div>
          <div>
            <Label htmlFor="qc-p-phone">Phone</Label>
            <Input
              id="qc-p-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+358 40 123 4567"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSave(); } }}
            />
          </div>
          <div>
            <Label htmlFor="qc-p-title">Job title</Label>
            <Input
              id="qc-p-title"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="CEO"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSave(); } }}
            />
          </div>
          <div>
            <Label htmlFor="qc-p-org">Organization</Label>
            <Select
              id="qc-p-org"
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
            >
              <option value="">Select organization</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </Select>
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button type="button" onClick={handleSave} disabled={isSaving} className="flex-1">
              {isSaving ? "Creating..." : "Create"}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
