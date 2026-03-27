"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ActivityEditModal, type ActivityForEdit } from "@/components/ui/activity-edit-modal";
import { formatDate } from "@/lib/utils";
import { useRouter } from "next/navigation";

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  CALL: "Call",
  MEETING: "Meeting",
  EMAIL: "Email",
  UNANSWERED_CALL: "Missed call",
  TASK: "Task",
  DEADLINE: "Deadline",
  LUNCH: "Lunch",
  BUUKKAUS: "Booking",
  PERUTTU_PALAVERI: "Cancelled meeting",
};

interface Activity {
  id: string;
  subject: string;
  type: string;
  done: boolean;
  note?: string | null;
  dueDate?: Date | string | null;
  dueTime?: string | null;
  createdAt: Date | string;
}

export function RecentActivities({ activities }: { activities: Activity[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ActivityForEdit | null>(null);

  if (activities.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">No activities</p>;
  }

  return (
    <>
      <div className="space-y-1">
        {activities.map((activity) => (
          <div
            key={activity.id}
            onClick={() => setEditing({
              id: activity.id,
              subject: activity.subject,
              type: activity.type,
              done: activity.done,
              note: activity.note,
              dueDate: activity.dueDate ? new Date(activity.dueDate).toISOString() : null,
              dueTime: activity.dueTime,
            })}
            className="flex items-center gap-3 p-2.5 hover:bg-muted/50 transition-colors cursor-pointer"
          >
            <div className={`h-2 w-2 rounded-full flex-shrink-0 ${activity.done ? "bg-emerald-500" : "bg-amber-500"}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{activity.subject}</p>
              <p className="text-xs text-muted-foreground">
                {ACTIVITY_TYPE_LABELS[activity.type] || activity.type} · {formatDate(activity.createdAt)}
              </p>
            </div>
            <Badge variant={activity.done ? "success" : "warning"} className="flex-shrink-0 text-[10px]">
              {activity.done ? "Done" : "Open"}
            </Badge>
          </div>
        ))}
      </div>

      {editing && (
        <ActivityEditModal
          activity={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); router.refresh(); }}
        />
      )}
    </>
  );
}
