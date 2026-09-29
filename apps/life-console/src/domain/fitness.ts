export const FITNESS_TIME_ZONE = "Asia/Shanghai" as const;
export const FITNESS_PAGE_SIZE = 100;

export interface FitnessAppointment {
  id: string;
  user_id: string;
  title: string;
  start_at: string;
  end_at: string;
  time_zone: typeof FITNESS_TIME_ZONE;
  time_kind?: "timed" | "all_day";
  location: string;
  notes: string;
  revision: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FitnessFields {
  timeKind?: "timed" | "all_day";
  title: string;
  startAt: string;
  endAt: string;
  location?: string;
  notes?: string;
}
export interface CreateFitnessAppointment extends FitnessFields {
  operationKey: string;
}
export interface FitnessRevision {
  id: string;
  expectedRevision: number;
}
export interface UpdateFitnessAppointment extends FitnessFields, FitnessRevision {}
export interface FitnessCursor {
  startAt: string;
  id: string;
}
export interface FitnessRange {
  /** Shanghai calendar dates, inclusive from / exclusive to, at most 62 days. */
  from: string;
  to: string;
  cursor?: FitnessCursor;
}
export interface FitnessPage {
  items: FitnessAppointment[];
  nextCursor: FitnessCursor | null;
}
export interface FitnessRepositoryPort {
  listRange(input: FitnessRange): Promise<FitnessPage>;
  /** Includes soft-deleted rows so an editor can explain a conflict. */
  get(id: string): Promise<FitnessAppointment | null>;
  create(input: CreateFitnessAppointment): Promise<FitnessAppointment>;
  update(input: UpdateFitnessAppointment): Promise<FitnessAppointment>;
  softDelete(input: FitnessRevision): Promise<FitnessAppointment>;
}
