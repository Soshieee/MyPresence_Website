import type { AttendanceType, EventType, SundaySession } from "@/lib/attendance";

export type UserFace = {
  id: string;
  student_id: string;
  full_name: string;
  age: number | null;
  gender: "Male" | "Female" | "Other" | null;
  newcomer: boolean;
  is_active?: boolean | null;
  descriptor: number[];
  created_at: string;
};

export type AttendanceLog = {
  id: string;
  student_id: string;
  full_name: string;
  was_newcomer: boolean;
  attendance_context: AttendanceType | null;
  attendance_group: string | null;
  service_type?: SundaySession | null;
  event_id?: string | null;
  attended_date: string;
  attended_at: string;
};

export type EventItem = {
  id: string;
  title: string;
  details: string | null;
  event_date: string | null;
  location: string | null;
  poster_url: string | null;
  event_type: EventType | null;
  created_at: string;
};

export type PollStatus = "open" | "closed" | "archived";

export type EventSuggestion = {
  id: string;
  event_id: string;
  suggestion_text: string;
  main_question?: string | null;
  suggestion_question_text?: string | null;
  created_at: string;
  poll_key?: string | null;
  item_kind?: "question" | "choice" | null;
  poll_status?: PollStatus | null;
  archived_at?: string | null;
  sort_order?: number | null;
  updated_at?: string | null;
};

export type EventPollSubmission = {
  event_id: string;
  poll_id: string;
  question_id?: string | null;
  voter_key?: string | null;
  created_at: string;
  updated_at?: string | null;
};

export type CalendarImageRow = {
  id: string;
  calendar_img_url: string | null;
  storage_path: string | null;
  created_at: string;
  updated_at: string | null;
};

export type AppSettings = {
  newcomerClearScanCount: 1 | 2;
};
