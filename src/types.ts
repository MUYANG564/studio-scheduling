export type Role = "admin" | "studio" | "vendor";

export interface Account {
  id: string;
  username: string;
  role: Role;
  display_name: string;
  email: string;
  admin_note?: string;
  created_at?: string;
}

export interface Studio {
  id: string;
  account_id: string;
  name: string;
  city: string;
  address: string;
  email: string;
  admin_note?: string;
}

export interface Speaker {
  id: string;
  vendor_account_id: string;
  project_name: string;
  stage_name: string;
  email: string;
  admin_note?: string;
}

export interface Slot {
  id: string;
  studio_id: string;
  date: string;
  start: string;
  status: "free" | "locked";
  booking_id: string | null;
}

export interface Booking {
  id: string;
  request_id: string;
  speaker_id: string;
  studio_id: string;
  vendor_account_id: string;
  slots: string[];
  status: "confirmed" | "released";
  created_at: string;
  studio_name?: string;
  city?: string;
  address?: string;
  project_name?: string;
  stage_name?: string;
}

export interface Appeal {
  id: string;
  booking_id: string;
  studio_id: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  resolved_at: string | null;
}

export interface ScheduleRequest {
  id: string;
  speaker_id: string;
  vendor_account_id: string;
  desired: string[];
  status: "open" | "reopened" | "closed";
  created_at: string;
}

export interface Notification {
  id: string;
  account_id: string;
  kind: string;
  message: string;
  read: boolean;
  created_at: string;
}

export interface StudioMatch {
  studioId: string;
  name: string;
  city: string;
  address: string;
  covered: string[];
  missing?: string[];
}

export interface Combination {
  studios: { studioId: string; name: string; city: string; address: string; assigned: string[] }[];
  coversAll: boolean;
  covered: string[];
  uncovered: string[];
}

export interface MatchResult {
  request_id: string;
  desired: string[];
  fullCover: StudioMatch[];
  partial: StudioMatch[];
  combination: Combination | null;
}
