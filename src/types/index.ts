export type UserFace = {
  id: string;
  student_id: string;
  full_name: string;
  age: number | null;
  gender: "Male" | "Female" | "Other" | null;
  newcomer: boolean;
  descriptor: number[];
  created_at: string;
};

export type AttendanceLog = {
  id: string;
  student_id: string;
  full_name: string;
  was_newcomer: boolean;
  attendance_context: "Sunday Service" | "Events" | null;
  attendance_group: "First Service" | "Second Service" | "Rooftop" | "Male" | "Female" | null;
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
  created_at: string;
};

export type EventSuggestion = {
  id: string;
  event_id: string;
  suggestion_text: string;
  created_at: string;
};

export type AppSettings = {
  newcomerClearScanCount: 1 | 2;
};
