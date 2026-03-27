"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ACTIVITY_TYPES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { X, Phone, Mail, Calendar, Circle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/components/ui/toast";

export interface ActivityForEdit {
  id: string;
  subject: string;
  type: string;
  done: boolean;
  note?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
}

function getActivityIcon(type: string) {
  const t = type.toLowerCase();
  if (t.includes("call")) return Phone;
  if (t.includes("email") || t.includes("mail")) return Mail;
  if (t.includes("meeting") || t.includes("lunch")) return Calendar;
  return Circle;
}

function ActivityEditForm({
  activity,
  onSuccess,
  onCancel,
}: {
  activity: ActivityForEdit;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [subject, setSubject] = useState(activity.subject);
  const [type, setType] = useState(activity.type);
  const [done, setDone] = useState(activity.done);
  const [dueDate, setDueDate] = useState(
    activity.dueDate ? new Date(activity.dueDate).toISOString().split("T")[0] : ""
  );
  const [dueTime, setDueTime] = useState(activity.dueTime || "");
  const [note, setNote] = useState(activity.note || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!subject.trim()) return;
    setIsSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/activities/${activity.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          type,
          done,
          dueDate: dueDate || undefined,
          dueTime: dueTime || undefined,
          note: note || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      toast("Activity updated");
      onSuccess();
    } catch {
      setError("Failed to save activity. Please try again.");
      toast("Failed to update activity", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Type selector */}
      <div>
        <Label>Type</Label>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {ACTIVITY_TYPES.map((t) => {
            const Icon = getActivityIcon(t.value);
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setType(t.value)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border transition-colors",
                  type === t.value
                    ? "bg-foreground text-background border-foreground"
                    : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                )}
              >
                <Icon className="h-3 w-3" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Subject */}
      <div>
        <Label>Subject</Label>
        <Input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          autoFocus
          placeholder="Activity subject"
        />
      </div>

      {/* Status toggle */}
      <div>
        <Label>Status</Label>
        <div className="flex gap-2 mt-1.5">
          <button
            type="button"
            onClick={() => setDone(false)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 border text-sm font-medium transition-colors",
              !done
                ? "bg-amber-50 border-amber-300 text-amber-700"
                : "border-border text-muted-foreground hover:border-foreground/30"
            )}
          >
            <Circle className="h-3.5 w-3.5" />
            Open
          </button>
          <button
            type="button"
            onClick={() => setDone(true)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 border text-sm font-medium transition-colors",
              done
                ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                : "border-border text-muted-foreground hover:border-foreground/30"
            )}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Done
          </button>
        </div>
      </div>

      {/* Date + time */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Due date</Label>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div>
          <Label>Time</Label>
          <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
        </div>
      </div>

      {/* Note */}
      <div>
        <Label>Note</Label>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Additional notes..."
          rows={3}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2 pt-1">
        <Button onClick={handleSubmit} disabled={isSubmitting || !subject.trim()} className="flex-1">
          {isSubmitting ? "Saving..." : "Save changes"}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function ActivityEditModal({
  activity,
  onClose,
  onSaved,
}: {
  activity: ActivityForEdit;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-card border border-border p-6 w-full max-w-md max-h-[90vh] overflow-y-auto z-10">
        <div className="flex items-center justify-between mb-5 pb-4 border-b border-border">
          <h3 className="text-base font-bold">Edit activity</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <ActivityEditForm
          activity={activity}
          onSuccess={onSaved}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}
