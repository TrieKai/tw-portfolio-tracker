import type { Metadata } from "next";
import { PnlCalendarPage } from "@/components/calendar/PnlCalendarPage";

export const metadata: Metadata = {
  title: "損益日曆",
};

export default function CalendarPage() {
  return <PnlCalendarPage />;
}
