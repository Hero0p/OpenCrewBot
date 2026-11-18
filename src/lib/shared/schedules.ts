// Workflow schedules in plain words, for the Workflows screen and the server alike.
// A schedule is a standard 5-part cron expression (minute hour day-of-month month day-of-week),
// read in the server's local time.

/** The schedules the New workflow form offers. "Every 5 minutes" is for demos: it uses model quota quickly. */
export const SCHEDULE_PRESETS: { label: string; cron: string }[] = [
  { label: "Every 5 minutes (for a demo)", cron: "*/5 * * * *" },
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Every day at 09:00", cron: "0 9 * * *" },
  { label: "Every Monday at 09:00", cron: "0 9 * * 1" },
  { label: "On the 1st of every month at 09:00", cron: "0 9 1 * *" },
];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const two = (n: string) => n.padStart(2, "0");

/**
 * @param cron - a 5-part cron expression
 * @returns it in plain words when it's a common pattern, else "Custom schedule: <cron>"
 */
export function describeSchedule(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return `Custom schedule: ${cron}`;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const everyMinutes = minute.match(/^\*\/(\d+)$/);
  if (everyMinutes && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") return `Every ${everyMinutes[1]} minutes`;
  const at = /^\d+$/.test(minute) && /^\d+$/.test(hour) ? `${two(hour)}:${two(minute)}` : null;
  if (/^\d+$/.test(minute) && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") return minute === "0" ? "Every hour" : `Every hour at :${two(minute)}`;
  if (at && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") return `Every day at ${at}`;
  if (at && dayOfMonth === "*" && month === "*" && /^[0-6]$/.test(dayOfWeek)) return `Every ${DAYS[Number(dayOfWeek)]} at ${at}`;
  if (at && dayOfMonth === "*" && month === "*" && dayOfWeek === "1-5") return `Every weekday at ${at}`;
  if (at && /^\d+$/.test(dayOfMonth) && month === "*" && dayOfWeek === "*") return `On day ${dayOfMonth} of every month at ${at}`;
  return `Custom schedule: ${cron}`;
}
