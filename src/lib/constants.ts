export const ACTIVITY_TYPES = [
  { value: "CALL", label: "Call" },
  { value: "MEETING", label: "Meeting" },
  { value: "EMAIL", label: "Email" },
  { value: "UNANSWERED_CALL", label: "Missed call" },
  { value: "TASK", label: "Task" },
  { value: "DEADLINE", label: "Deadline" },
  { value: "LUNCH", label: "Lunch" },
  { value: "BUUKKAUS", label: "Booking" },
  { value: "PERUTTU_PALAVERI", label: "Cancelled meeting" },
] as const;

export const DEAL_STATUSES = [
  { value: "OPEN", label: "Open", color: "bg-blue-100 text-blue-800" },
  { value: "WON", label: "Won", color: "bg-green-100 text-green-800" },
  { value: "LOST", label: "Lost", color: "bg-red-100 text-red-800" },
] as const;

export const PAGE_SIZE = 25;
