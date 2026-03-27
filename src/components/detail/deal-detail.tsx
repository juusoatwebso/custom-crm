"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, useDialog } from "@/components/ui/dialog";
import { DealForm } from "@/components/forms/deal-form";
import { ActivityForm } from "@/components/forms/activity-form";
import { formatDate, formatCurrency } from "@/lib/utils";
import { DEAL_STATUSES, ACTIVITY_TYPES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import {
  Pencil, Calendar, ArrowRight, Phone, Mail,
  MessageSquare, Paperclip, CheckCircle2, Circle,
  GitCommitHorizontal, StickyNote, CalendarPlus, Trophy, X,
} from "lucide-react";

interface FlowEvent {
  id: string;
  eventType: string;
  timestamp: string;
  fieldKey?: string;
  oldValue?: string;
  newValue?: string;
  oldValueFormatted?: string;
  newValueFormatted?: string;
  activitySubject?: string;
  activityType?: string;
  activityDone?: boolean;
  noteContent?: string;
  fileName?: string;
  mailSubject?: string;
  userName?: string;
  user?: { name: string };
  pipedriveId?: number;
}

interface ActivityData {
  id: string;
  subject: string;
  type: string;
  done: boolean;
  note?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  duration?: string | null;
  location?: string | null;
  createdAt?: string | null;
  pipedriveId?: number | null;
  assignee?: { name: string } | null;
}

interface Deal {
  id: string;
  title: string;
  value?: number | null;
  currency: string;
  status: string;
  isLead: boolean;
  lostReason?: string | null;
  probability?: number | null;
  expectedCloseDate?: string | null;
  stageChangedAt?: string | null;
  wonAt?: string | null;
  lostAt?: string | null;
  origin?: string | null;
  drive?: string | null;
  createdAt: string;
  organization?: { id: string; name: string } | null;
  person?: { id: string; firstName: string; lastName?: string | null } | null;
  stage?: { name: string } | null;
  pipeline?: {
    name: string;
    stages: Array<{ id: string; name: string; orderNr: number }>;
  } | null;
  owner?: { name: string } | null;
  notes: Array<{
    id: string;
    content: string;
    createdAt: string;
    pipedriveId?: number | null;
    author?: { name: string } | null;
  }>;
  activities: ActivityData[];
  flowEvents: FlowEvent[];
}

interface DealDetailProps {
  deal: Deal;
}

const FIELD_LABELS: Record<string, string> = {
  stage_id: "Stage",
  status: "Status",
  user_id: "Owner",
  person_id: "Contact",
  value: "Value",
  expected_close_date: "Expected close date",
  add_time: "Created",
};

function formatFieldChange(event: FlowEvent): { label: string; from?: string; to?: string } {
  const label = FIELD_LABELS[event.fieldKey || ""] || event.fieldKey || "Field";
  const from = event.oldValueFormatted || event.oldValue;
  const to = event.newValueFormatted || event.newValue;
  return { label, from: from || undefined, to: to || undefined };
}

function formatFlowDate(timestamp: string): string {
  const d = new Date(timestamp);
  return (
    d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) +
    " " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  );
}

function getActivityIcon(type?: string) {
  const t = (type || "").toLowerCase();
  if (t.includes("call") || t.includes("puhelu")) return Phone;
  if (t.includes("email") || t.includes("sähköposti") || t.includes("mail")) return Mail;
  if (t.includes("meeting") || t.includes("palaveri") || t.includes("lunch") || t.includes("lounas")) return Calendar;
  return Circle;
}

function computeStageDays(
  stages: Array<{ id: string; name: string; orderNr: number }>,
  flowEvents: FlowEvent[],
  createdAt: string,
  currentStageName?: string | null,
  wonAt?: string | null,
  lostAt?: string | null
): Record<string, number> {
  const stageDays: Record<string, number> = {};
  stages.forEach((s) => { stageDays[s.name] = 0; });

  const stageChanges = flowEvents
    .filter((e) => e.eventType === "DEAL_CHANGE" && e.fieldKey === "stage_id")
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const endTime = wonAt
    ? new Date(wonAt)
    : lostAt
    ? new Date(lostAt)
    : new Date();

  if (stageChanges.length === 0) {
    if (currentStageName && stageDays.hasOwnProperty(currentStageName)) {
      const days = Math.floor(
        (endTime.getTime() - new Date(createdAt).getTime()) / 86400000
      );
      stageDays[currentStageName] = Math.max(0, days);
    }
    return stageDays;
  }

  let prevTime = new Date(createdAt);
  let prevStage =
    stageChanges[0].oldValueFormatted || currentStageName || stages[0]?.name || "";

  for (const change of stageChanges) {
    const changeTime = new Date(change.timestamp);
    const days = Math.floor(
      (changeTime.getTime() - prevTime.getTime()) / 86400000
    );
    if (prevStage && stageDays.hasOwnProperty(prevStage)) {
      stageDays[prevStage] = (stageDays[prevStage] || 0) + Math.max(0, days);
    }
    prevTime = changeTime;
    prevStage = change.newValueFormatted || prevStage;
  }

  const finalDays = Math.floor(
    (endTime.getTime() - prevTime.getTime()) / 86400000
  );
  if (prevStage && stageDays.hasOwnProperty(prevStage)) {
    stageDays[prevStage] = (stageDays[prevStage] || 0) + Math.max(0, finalDays);
  }

  return stageDays;
}

// Compact activity edit form
function ActivityEditForm({
  activity,
  onSuccess,
  onCancel,
}: {
  activity: ActivityData;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [subject, setSubject] = useState(activity.subject);
  const [type, setType] = useState(activity.type);
  const [done, setDone] = useState(activity.done);
  const [dueDate, setDueDate] = useState(
    activity.dueDate
      ? new Date(activity.dueDate).toISOString().split("T")[0]
      : ""
  );
  const [dueTime, setDueTime] = useState(activity.dueTime || "");
  const [note, setNote] = useState(activity.note || "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!subject.trim()) return;
    setIsSubmitting(true);
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
      if (!res.ok) throw new Error("Failed");
      toast("Activity updated");
      onSuccess();
    } catch (e) {
      console.error(e);
      toast("Failed to update activity", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Type selector — pill buttons */}
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

      {/* Done toggle */}
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
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
        <div>
          <Label>Time</Label>
          <Input
            type="time"
            value={dueTime}
            onChange={(e) => setDueTime(e.target.value)}
          />
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

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button
          onClick={handleSubmit}
          disabled={isSubmitting || !subject.trim()}
          className="flex-1"
        >
          {isSubmitting ? "Saving..." : "Save changes"}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

type FilterType = "all" | "notes" | "activities" | "changes" | "files";

export function DealDetail({ deal }: DealDetailProps) {
  const router = useRouter();
  const { toast } = useToast();
  const editDialog = useDialog();
  const activityDialog = useDialog();
  const lostDialog = useDialog();

  const [historyFilter, setHistoryFilter] = useState<FilterType>("all");
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [isNoteSubmitting, setIsNoteSubmitting] = useState(false);
  const [editingActivity, setEditingActivity] = useState<ActivityData | null>(null);
  const [editingNote, setEditingNote] = useState<{ id: string; content: string } | null>(null);
  const [lostReason, setLostReason] = useState(deal.lostReason || "");
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Build map: pipedriveId → ActivityData (for matching flow events to activities)
  const activityByPipedriveId = new Map<number, ActivityData>();
  for (const a of deal.activities) {
    if (a.pipedriveId) activityByPipedriveId.set(a.pipedriveId, a);
  }

  // Build map: pipedriveId → Note record (for matching flow event notes to editable notes)
  const noteByPipedriveId = new Map<number, { id: string; content: string }>();
  for (const n of deal.notes) {
    if (n.pipedriveId) noteByPipedriveId.set(n.pipedriveId, { id: n.id, content: n.content });
  }

  // Build a set of note/activity pipedriveIds already represented in flowEvents
  const flowNoteIds = new Set<number>();
  const flowActivityIds = new Set<number>();
  for (const e of deal.flowEvents) {
    if (e.eventType === "NOTE" && e.pipedriveId) flowNoteIds.add(e.pipedriveId);
    if (e.eventType === "ACTIVITY" && e.pipedriveId) flowActivityIds.add(e.pipedriveId);
  }

  // Build unified timeline: flowEvents + standalone notes + standalone activities
  type TimelineEntry =
    | { kind: "flow"; event: FlowEvent; sortTime: number }
    | { kind: "note"; note: Deal["notes"][number]; sortTime: number }
    | { kind: "activity"; activity: ActivityData; sortTime: number };

  const timeline: TimelineEntry[] = [];

  // Add all flow events
  for (const event of deal.flowEvents) {
    timeline.push({ kind: "flow", event, sortTime: new Date(event.timestamp).getTime() });
  }

  // Add notes not already in flowEvents (new CRM notes, or Pipedrive notes without flow entry)
  for (const note of deal.notes) {
    const alreadyInFlow = note.pipedriveId ? flowNoteIds.has(note.pipedriveId) : false;
    if (!alreadyInFlow) {
      timeline.push({
        kind: "note",
        note,
        sortTime: new Date(note.createdAt).getTime(),
      });
    }
  }

  // Add activities not already in flowEvents
  for (const activity of deal.activities) {
    const alreadyInFlow = activity.pipedriveId ? flowActivityIds.has(activity.pipedriveId) : false;
    if (!alreadyInFlow) {
      timeline.push({
        kind: "activity",
        activity,
        sortTime: new Date(activity.dueDate || activity.createdAt || Date.now()).getTime(),
      });
    }
  }

  // Sort descending (newest first)
  timeline.sort((a, b) => b.sortTime - a.sortTime);

  // Filter
  function entryMatchesFilter(entry: TimelineEntry, filter: FilterType): boolean {
    if (filter === "all") return true;
    if (filter === "notes") return entry.kind === "note" || (entry.kind === "flow" && entry.event.eventType === "NOTE");
    if (filter === "activities") return entry.kind === "activity" || (entry.kind === "flow" && entry.event.eventType === "ACTIVITY");
    if (filter === "changes") return entry.kind === "flow" && entry.event.eventType === "DEAL_CHANGE";
    if (filter === "files") return entry.kind === "flow" && (entry.event.eventType === "FILE" || entry.event.eventType === "MAIL_MESSAGE");
    return true;
  }

  // Counts for filter tabs
  const counts = {
    notes: timeline.filter((e) => entryMatchesFilter(e, "notes")).length,
    activities: timeline.filter((e) => entryMatchesFilter(e, "activities")).length,
    changes: timeline.filter((e) => entryMatchesFilter(e, "changes")).length,
    files: timeline.filter((e) => entryMatchesFilter(e, "files")).length,
  };

  const filteredTimeline = timeline.filter((e) => entryMatchesFilter(e, historyFilter));

  // Stage days
  const stageDays = computeStageDays(
    deal.pipeline?.stages || [],
    deal.flowEvents,
    deal.createdAt,
    deal.stage?.name,
    deal.wonAt,
    deal.lostAt
  );

  const handleEditSuccess = async () => {
    editDialog.close();
    router.refresh();
  };

  const handleActivitySuccess = async () => {
    activityDialog.close();
    router.refresh();
  };

  const handleNoteSubmit = async () => {
    if (!noteText.trim()) return;
    setIsNoteSubmitting(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: noteText.trim(), dealId: deal.id }),
      });
      if (!res.ok) throw new Error("Failed to save note");
      setNoteText("");
      setShowNoteForm(false);
      toast("Note saved");
      router.refresh();
    } catch (e) {
      console.error(e);
      toast("Failed to save note", "error");
    } finally {
      setIsNoteSubmitting(false);
    }
  };

  const handleMarkWon = async () => {
    setIsUpdatingStatus(true);
    try {
      const res = await fetch(`/api/deals/${deal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "WON" }),
      });
      if (!res.ok) throw new Error("Failed");
      toast("Deal marked as won");
      router.refresh();
    } catch {
      toast("Failed to update deal status", "error");
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleMarkLost = async () => {
    setIsUpdatingStatus(true);
    try {
      const res = await fetch(`/api/deals/${deal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "LOST", lostReason: lostReason || undefined }),
      });
      if (!res.ok) throw new Error("Failed");
      toast("Deal marked as lost");
      lostDialog.close();
      router.refresh();
    } catch {
      toast("Failed to update deal status", "error");
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleReopen = async () => {
    setIsUpdatingStatus(true);
    try {
      const res = await fetch(`/api/deals/${deal.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "OPEN" }),
      });
      if (!res.ok) throw new Error("Failed");
      toast("Deal reopened");
      router.refresh();
    } catch {
      toast("Failed to reopen deal", "error");
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const statusVariant =
    deal.status === "WON"
      ? "success"
      : deal.status === "LOST"
      ? "destructive"
      : "info";
  const statusLabel =
    DEAL_STATUSES.find((s) => s.value === deal.status)?.label || deal.status;

  const pendingActivities = deal.activities.filter((a) => !a.done);

  // Pipeline stage index
  const currentStageIndex = deal.pipeline
    ? deal.pipeline.stages.findIndex((s) => s.name === deal.stage?.name)
    : -1;

  return (
    <div className="space-y-5 max-w-full">
      {/* Top bar: title + Won/Lost/Edit buttons */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">{deal.title}</h2>
          <div className="flex items-center gap-2 mt-1.5">
            <Badge variant={statusVariant as any}>{statusLabel}</Badge>
            {deal.isLead && <Badge variant="purple">Lead</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {deal.status === "WON" || deal.status === "LOST" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleReopen}
              disabled={isUpdatingStatus}
            >
              Reopen
            </Button>
          ) : null}
          {deal.status !== "WON" && (
            <Button
              size="sm"
              onClick={handleMarkWon}
              disabled={isUpdatingStatus}
              className="bg-emerald-600 hover:bg-emerald-700 text-white border-0"
            >
              <Trophy className="h-3.5 w-3.5" />
              Won
            </Button>
          )}
          {deal.status !== "LOST" && (
            <Button
              size="sm"
              variant="destructive"
              onClick={lostDialog.open}
              disabled={isUpdatingStatus}
            >
              <X className="h-3.5 w-3.5" />
              Lost
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={editDialog.open}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex gap-6">
        {/* Left sidebar */}
        <div className="w-64 flex-shrink-0 space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Value</span>
                <span className="text-sm font-semibold">
                  {deal.value != null ? formatCurrency(deal.value, deal.currency) : "–"}
                </span>
              </div>
              {deal.probability != null && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Probability</span>
                  <span className="text-sm font-semibold">{deal.probability}%</span>
                </div>
              )}
              {deal.stage && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Stage</span>
                  <span className="text-sm font-medium">{deal.stage.name}</span>
                </div>
              )}
              {deal.owner && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Owner</span>
                  <span className="text-sm font-medium">{deal.owner.name}</span>
                </div>
              )}
              {deal.expectedCloseDate && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Close date</span>
                  <span className="text-sm">{formatDate(deal.expectedCloseDate)}</span>
                </div>
              )}
              {deal.organization && (
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider flex-shrink-0">Organization</span>
                  <Link
                    href={`/organizations/${deal.organization.id}`}
                    className="text-sm text-primary hover:underline text-right"
                  >
                    {deal.organization.name}
                  </Link>
                </div>
              )}
              {deal.person && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Contact</span>
                  <Link
                    href={`/persons/${deal.person.id}`}
                    className="text-sm text-primary hover:underline"
                  >
                    {deal.person.firstName} {deal.person.lastName || ""}
                  </Link>
                </div>
              )}
              {deal.origin && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Source</span>
                  <span className="text-sm">{deal.origin}</span>
                </div>
              )}
              {deal.lostReason && (
                <div className="pt-2 border-t border-border">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Lost reason</span>
                  <p className="text-sm mt-1">{deal.lostReason}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pending activities */}
          {pendingActivities.length > 0 && (
            <Card>
              <CardHeader className="pb-2 px-4 pt-3">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Open activities
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-2">
                {pendingActivities.slice(0, 5).map((a) => {
                  const typeLabel =
                    ACTIVITY_TYPES.find((t) => t.value === a.type)?.label || a.type;
                  return (
                    <div
                      key={a.id}
                      className="flex items-start gap-2 group cursor-pointer"
                      onClick={() => setEditingActivity(a)}
                    >
                      <div className="h-1.5 w-1.5 rounded-full bg-amber-500 mt-2 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate group-hover:text-primary transition-colors">
                          {a.subject}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {typeLabel}
                          {a.dueDate && ` · ${formatDate(a.dueDate)}`}
                        </p>
                      </div>
                      <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5" />
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right main content */}
        <div className="flex-1 min-w-0">
          {/* Pipeline stage bar with days */}
          {deal.pipeline && deal.pipeline.stages.length > 0 && (
            <div className="mb-5">
              <div className="flex gap-px">
                {deal.pipeline.stages.map((s, i) => {
                  const isActive = i <= currentStageIndex;
                  const isCurrent = i === currentStageIndex;
                  const days = stageDays[s.name] ?? 0;
                  const isWon = deal.status === "WON";
                  const isLost = deal.status === "LOST";
                  return (
                    <div
                      key={s.id}
                      title={s.name}
                      className={cn(
                        "flex-1 flex flex-col items-center justify-center py-1.5 transition-colors",
                        isActive
                          ? isWon
                            ? "bg-emerald-600"
                            : isLost
                            ? "bg-red-500"
                            : "bg-foreground"
                          : "bg-muted"
                      )}
                    >
                      <span
                        className={cn(
                          "text-[10px] font-semibold tabular-nums",
                          isActive ? "text-background" : "text-muted-foreground"
                        )}
                      >
                        {days} {days === 1 ? "day" : "days"}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-px mt-px">
                {deal.pipeline.stages.map((s) => (
                  <div
                    key={s.id}
                    className="flex-1 text-center text-[9px] text-muted-foreground truncate px-0.5 pt-0.5"
                    title={s.name}
                  >
                    {s.name}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick action buttons */}
          <div className="flex items-center gap-2 mb-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowNoteForm(!showNoteForm);
                setNoteText("");
              }}
            >
              <StickyNote className="h-3.5 w-3.5" />
              Add note
            </Button>
            <Button variant="outline" size="sm" onClick={activityDialog.open}>
              <CalendarPlus className="h-3.5 w-3.5" />
              Add activity
            </Button>
          </div>

          {/* Inline note form */}
          {showNoteForm && (
            <div className="mb-4 border border-yellow-300 bg-yellow-50 p-3">
              <Textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Write a note..."
                rows={3}
                className="mb-2 bg-yellow-50 border-yellow-200 focus:border-yellow-400"
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleNoteSubmit}
                  disabled={isNoteSubmitting || !noteText.trim()}
                >
                  {isNoteSubmitting ? "Saving..." : "Save"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowNoteForm(false);
                    setNoteText("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Filter tabs */}
          <div className="flex items-center gap-1.5 mb-4 flex-wrap">
            {(
              [
                { key: "all", label: "All", count: timeline.length },
                { key: "notes", label: "Notes", count: counts.notes },
                { key: "activities", label: "Activities", count: counts.activities },
                { key: "changes", label: "Changes", count: counts.changes },
                { key: "files", label: "Files/Emails", count: counts.files },
              ] as const
            ).map((tab) => (
              <Button
                key={tab.key}
                variant={historyFilter === tab.key ? "default" : "ghost"}
                size="sm"
                onClick={() => setHistoryFilter(tab.key)}
                className="text-xs"
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="ml-1 opacity-60">({tab.count})</span>
                )}
              </Button>
            ))}
          </div>

          {/* Timeline */}
          <div className="relative">
            <div className="absolute left-5 top-0 bottom-0 w-px bg-border" />
            <div className="space-y-0">
              {filteredTimeline.length > 0 ? (
                filteredTimeline.map((entry, idx) => {
                  if (entry.kind === "flow") {
                    return (
                      <TimelineItem
                        key={`flow-${entry.event.id}`}
                        event={entry.event}
                        matchedActivity={
                          entry.event.pipedriveId
                            ? activityByPipedriveId.get(entry.event.pipedriveId)
                            : undefined
                        }
                        matchedNote={
                          entry.event.eventType === "NOTE" && entry.event.pipedriveId
                            ? noteByPipedriveId.get(entry.event.pipedriveId)
                            : undefined
                        }
                        onEditActivity={setEditingActivity}
                        onEditNote={setEditingNote}
                      />
                    );
                  }
                  if (entry.kind === "note") {
                    return (
                      <StandaloneNoteItem
                        key={`note-${entry.note.id}`}
                        note={entry.note}
                        onEdit={() => setEditingNote({ id: entry.note.id, content: entry.note.content })}
                      />
                    );
                  }
                  if (entry.kind === "activity") {
                    return (
                      <StandaloneActivityItem
                        key={`act-${entry.activity.id}`}
                        activity={entry.activity}
                        onEdit={setEditingActivity}
                      />
                    );
                  }
                  return null;
                })
              ) : (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  No events
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Edit deal dialog */}
      <Dialog ref={editDialog.ref}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit deal</DialogTitle>
          </DialogHeader>
          <DealForm
            defaultValues={{
              title: deal.title,
              value: deal.value ?? undefined,
              currency: deal.currency,
              status: deal.status as any,
              expectedCloseDate: deal.expectedCloseDate ?? undefined,
              lostReason: deal.lostReason ?? undefined,
              probability: deal.probability ?? undefined,
              organizationId: deal.organization?.id,
              personId: deal.person?.id,
            }}
            dealId={deal.id}
            onSuccess={handleEditSuccess}
          />
        </DialogContent>
      </Dialog>

      {/* Add activity dialog */}
      <Dialog ref={activityDialog.ref}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add activity</DialogTitle>
          </DialogHeader>
          <ActivityForm
            defaultValues={{
              dealId: deal.id,
              subject: "",
              type: "TASK",
              done: false,
            }}
            onSuccess={handleActivitySuccess}
          />
        </DialogContent>
      </Dialog>

      {/* Edit activity modal */}
      {editingActivity && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setEditingActivity(null)}
          />
          <div className="relative bg-card border border-border p-6 w-full max-w-md max-h-[90vh] overflow-y-auto z-10">
            <div className="flex items-center justify-between mb-5 pb-4 border-b border-border">
              <h3 className="text-base font-bold">Edit activity</h3>
              <button
                onClick={() => setEditingActivity(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ActivityEditForm
              activity={editingActivity}
              onSuccess={() => {
                setEditingActivity(null);
                router.refresh();
              }}
              onCancel={() => setEditingActivity(null)}
            />
          </div>
        </div>
      )}

      {/* Edit note modal */}
      {editingNote && (
        <NoteEditModal
          noteId={editingNote.id}
          initialContent={editingNote.content}
          onSuccess={() => {
            setEditingNote(null);
            router.refresh();
          }}
          onCancel={() => setEditingNote(null)}
        />
      )}

      {/* Mark as lost dialog */}
      <Dialog ref={lostDialog.ref}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as lost</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Lost reason (optional)</Label>
              <Textarea
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                placeholder="Why was the deal lost?"
                rows={3}
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                onClick={handleMarkLost}
                disabled={isUpdatingStatus}
                className="flex-1"
              >
                {isUpdatingStatus ? "Saving..." : "Mark as lost"}
              </Button>
              <Button variant="outline" onClick={lostDialog.close}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TimelineItem({
  event,
  matchedActivity,
  matchedNote,
  onEditActivity,
  onEditNote,
}: {
  event: FlowEvent;
  matchedActivity?: ActivityData;
  matchedNote?: { id: string; content: string };
  onEditActivity: (a: ActivityData) => void;
  onEditNote: (n: { id: string; content: string }) => void;
}) {
  const userName = event.user?.name || event.userName || "";
  const time = formatFlowDate(event.timestamp);

  if (event.eventType === "DEAL_CHANGE") {
    const { label, from, to } = formatFieldChange(event);
    return (
      <div className="relative flex gap-3 py-2.5 pl-2">
        <div className="z-10 flex-shrink-0 h-7 w-7 bg-muted border border-border flex items-center justify-center">
          <GitCommitHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-sm">
            <span className="font-medium">{label}:</span>{" "}
            {from && <span className="text-muted-foreground">{from}</span>}
            {from && to && (
              <ArrowRight className="inline h-3 w-3 mx-1 text-muted-foreground" />
            )}
            {to && <span className="font-medium">{to}</span>}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {time}
            {userName && ` · ${userName}`}
          </p>
        </div>
      </div>
    );
  }

  if (event.eventType === "ACTIVITY") {
    const Icon = getActivityIcon(event.activityType);
    const isDone = event.activityDone;
    const isClickable = !!matchedActivity;
    return (
      <div
        className={cn(
          "relative flex gap-3 py-2.5 pl-2 group transition-colors",
          isClickable
            ? "cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded"
            : ""
        )}
        onClick={() => {
          if (matchedActivity) onEditActivity(matchedActivity);
        }}
      >
        <div
          className={`z-10 flex-shrink-0 h-7 w-7 border flex items-center justify-center ${
            isDone
              ? "bg-emerald-50 border-emerald-200"
              : "bg-amber-50 border-amber-200"
          }`}
        >
          {isDone ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <Icon className="h-3.5 w-3.5 text-amber-600" />
          )}
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium">{event.activitySubject}</p>
              {event.activityType && (
                <Badge variant="secondary" className="text-[10px]">
                  {ACTIVITY_TYPES.find(
                    (t) => t.value === event.activityType?.toUpperCase()
                  )?.label || event.activityType}
                </Badge>
              )}
            </div>
            {isClickable && (
              <Pencil className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity mt-0.5" />
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {time}
            {userName && ` · ${userName}`}
          </p>
          {event.noteContent && (
            <div className="bg-amber-50 border border-amber-200 p-3 mt-1.5">
              <p className="text-sm whitespace-pre-wrap line-clamp-4 text-foreground/80">
                {event.noteContent}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (event.eventType === "NOTE") {
    const isEditable = !!matchedNote;
    return (
      <div
        className={cn(
          "relative flex gap-3 py-2.5 pl-2 group",
          isEditable && "cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded transition-colors"
        )}
        onClick={() => { if (matchedNote) onEditNote(matchedNote); }}
      >
        <div className="z-10 flex-shrink-0 h-7 w-7 bg-yellow-100 border border-yellow-300 flex items-center justify-center">
          <MessageSquare className="h-3.5 w-3.5 text-yellow-700" />
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          {event.noteContent && (
            <div className="bg-yellow-50 border border-yellow-200 p-3 mb-1.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm whitespace-pre-wrap line-clamp-6 text-foreground/90 flex-1">
                  {event.noteContent}
                </p>
                {isEditable && (
                  <Pencil className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity mt-0.5" />
                )}
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {time}
            {userName && ` · ${userName}`}
          </p>
        </div>
      </div>
    );
  }

  if (event.eventType === "FILE") {
    return (
      <div className="relative flex gap-3 py-2.5 pl-2">
        <div className="z-10 flex-shrink-0 h-7 w-7 bg-muted border border-border flex items-center justify-center">
          <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-sm">
            <span className="font-medium">File:</span>{" "}
            {event.fileName || "File"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {time}
            {userName && ` · ${userName}`}
          </p>
        </div>
      </div>
    );
  }

  if (event.eventType === "MAIL_MESSAGE") {
    return (
      <div className="relative flex gap-3 py-2.5 pl-2">
        <div className="z-10 flex-shrink-0 h-7 w-7 bg-purple-50 border border-purple-200 flex items-center justify-center">
          <Mail className="h-3.5 w-3.5 text-purple-600" />
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-sm font-medium">
            {event.mailSubject || "Email"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {time}
            {userName && ` · ${userName}`}
          </p>
          {event.noteContent && (
            <div className="bg-purple-50 border border-purple-100 p-3 mt-1.5">
              <p className="text-sm whitespace-pre-wrap line-clamp-4 text-foreground/80">
                {event.noteContent}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}

// Standalone note item (for notes not in flowEvents — i.e. notes created in the CRM)
function StandaloneNoteItem({
  note,
  onEdit,
}: {
  note: { id: string; content: string; createdAt: string; author?: { name: string } | null };
  onEdit: () => void;
}) {
  const time = formatFlowDate(note.createdAt);
  return (
    <div
      className="relative flex gap-3 py-2.5 pl-2 group cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded transition-colors"
      onClick={onEdit}
    >
      <div className="z-10 flex-shrink-0 h-7 w-7 bg-yellow-100 border border-yellow-300 flex items-center justify-center">
        <MessageSquare className="h-3.5 w-3.5 text-yellow-700" />
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="bg-yellow-50 border border-yellow-200 p-3 mb-1.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm whitespace-pre-wrap line-clamp-6 text-foreground/90 flex-1">
              {note.content}
            </p>
            <Pencil className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity mt-0.5" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {time}
          {note.author?.name && ` · ${note.author.name}`}
        </p>
      </div>
    </div>
  );
}

// Standalone activity item (for activities not in flowEvents — i.e. activities created in the CRM)
function StandaloneActivityItem({
  activity,
  onEdit,
}: {
  activity: ActivityData;
  onEdit: (a: ActivityData) => void;
}) {
  const time = formatFlowDate(activity.dueDate || activity.createdAt || new Date().toISOString());
  const Icon = getActivityIcon(activity.type);
  const typeLabel = ACTIVITY_TYPES.find((t) => t.value === activity.type)?.label || activity.type;

  return (
    <div
      className="relative flex gap-3 py-2.5 pl-2 group cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded transition-colors"
      onClick={() => onEdit(activity)}
    >
      <div
        className={`z-10 flex-shrink-0 h-7 w-7 border flex items-center justify-center ${
          activity.done
            ? "bg-emerald-50 border-emerald-200"
            : "bg-amber-50 border-amber-200"
        }`}
      >
        {activity.done ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <Icon className="h-3.5 w-3.5 text-amber-600" />
        )}
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium">{activity.subject}</p>
            <Badge variant="secondary" className="text-[10px]">
              {typeLabel}
            </Badge>
          </div>
          <Pencil className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground opacity-0 group-hover:opacity-60 transition-opacity mt-0.5" />
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {time}
          {activity.assignee?.name && ` · ${activity.assignee.name}`}
        </p>
        {activity.note && (
          <div className="bg-amber-50 border border-amber-200 p-3 mt-1.5">
            <p className="text-sm whitespace-pre-wrap line-clamp-4 text-foreground/80">
              {activity.note}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// Note edit modal
function NoteEditModal({
  noteId,
  initialContent,
  onSuccess,
  onCancel,
}: {
  noteId: string;
  initialContent: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [content, setContent] = useState(initialContent);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSave = async () => {
    if (!content.trim()) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim() }),
      });
      if (!res.ok) throw new Error("Failed");
      toast("Note updated");
      onSuccess();
    } catch {
      toast("Failed to update note", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-card border border-border p-6 w-full max-w-md z-10">
        <div className="flex items-center justify-between mb-5 pb-4 border-b border-border">
          <h3 className="text-base font-bold">Edit note</h3>
          <button
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={6}
          className="mb-4 bg-yellow-50 border-yellow-200 focus:border-yellow-400"
          autoFocus
        />
        <div className="flex gap-2">
          <Button
            onClick={handleSave}
            disabled={isSubmitting || !content.trim()}
            className="flex-1"
          >
            {isSubmitting ? "Saving..." : "Save"}
          </Button>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
