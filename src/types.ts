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

export interface BusinessDay {
  enabled: boolean;
  start: string;
  end: string;
}

export type BusinessHours = Record<string, BusinessDay>;

export interface Studio {
  id: string;
  account_id: string;
  name: string;
  city: string;
  address: string;
  email: string;
  business_hours?: BusinessHours;
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
  status: "free" | "blocked" | "locked";
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
  appeal_status: "pending" | null;
  appeal_by: "studio" | "vendor" | null;
}

export interface Appeal {
  id: string;
  booking_id: string;
  studio_id: string | null;
  vendor_account_id: string | null;
  reason: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  resolved_at: string | null;
}

export type MatchMode = "schedule_first" | "location_first";
export type MatchTier = "P0" | "P1" | "P2";
export type LocationLevel = "preferred" | "nearby" | "distance" | "other" | "neutral";

export interface ScheduleRequest {
  id: string;
  speaker_id: string;
  vendor_account_id: string;
  desired: string[];
  preferred_cities?: string[];
  match_mode?: MatchMode;
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

export interface MatchLocation {
  level: LocationLevel;
  rank: number;
  nearbyTo: string | null;
  priority: number | null;
  distanceKm: number | null;
}

export interface StudioMatch {
  studioId: string;
  name: string;
  city: string;
  address: string;
  covered: string[];
  missing: string[];
  location: MatchLocation;
  reasonCodes: string[];
  alternativeSlots?: string[];
}

export interface Combination {
  studios: {
    studioId: string;
    name: string;
    city: string;
    address: string;
    assigned: string[];
    location: MatchLocation;
    reasonCodes: string[];
  }[];
  coversAll: boolean;
  covered: string[];
  uncovered: string[];
}

export interface AdjustmentOption {
  studioId: string;
  name: string;
  city: string;
  address: string;
  location: MatchLocation;
  available: string[];
  reasonCodes: string[];
}

export interface CityProximity {
  id: string;
  city: string;
  nearby_city: string;
  priority: number;
  created_at?: string;
}

export interface MatchResult {
  request_id: string;
  desired: string[];
  preferredCities: string[];
  matchMode: MatchMode;
  effectiveMode: MatchMode;
  tier: MatchTier;
  p0: StudioMatch[];
  p1: StudioMatch[];
  fullCover: StudioMatch[];
  partial: StudioMatch[];
  combination: Combination | null;
  adjustmentOptions: AdjustmentOption[];
}
