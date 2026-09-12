export function practiceDate(at: number) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}
export function taskOverdue(task: { dueAt?: number; allDay: boolean; status: string }, now: number) {
  return task.status !== "done" && task.dueAt !== undefined && (task.allDay ? practiceDate(task.dueAt) < practiceDate(now) : task.dueAt < now);
}
export function taskDueBy(task: { dueAt?: number }, now: number, days = 0) {
  if (task.dueAt === undefined) return false;
  const end = new Date(`${practiceDate(now)}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + days);
  return practiceDate(task.dueAt) <= end.toISOString().slice(0, 10);
}

export function practiceMonth(at: number) { return practiceDate(at).slice(0, 7); }
