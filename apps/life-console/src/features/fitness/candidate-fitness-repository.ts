/** Candidate-only, in-memory synthetic data. Never imported by production mode. */
import type {
  FitnessAppointment,
  FitnessRepositoryPort,
} from "../../domain/fitness";
import { RepositoryError } from "../../supabase/repository";
import { compareAppointments, localInstant, shanghaiParts } from "./calendar";
export function createCandidateFitnessRepository(
  now = new Date(),
): FitnessRepositoryPort {
  const day = shanghaiParts(now).date,
    stamp = now.toISOString();
  const seed: FitnessAppointment = {
    id: crypto.randomUUID(),
    user_id: "synthetic-fitness-preview",
    title: "合成私教训练",
    start_at: localInstant(day, "18:30"),
    end_at: localInstant(day, "19:30"),
    time_zone: "Asia/Shanghai",
    location: "示例健身房",
    notes: "仅供界面演示；不会创建真实预约。",
    revision: 1,
    deleted_at: null,
    created_at: stamp,
    updated_at: stamp,
  };
  const rows = new Map([[seed.id, seed]]);
  const receipts = new Map<string, { input: string; id: string }>();
  const conflict = () =>
    new RepositoryError(
      "conflict",
      409,
      "40001",
      "Synthetic revision conflict",
    );
  return {
    async listRange({ from, to, cursor }) {
      const all = [...rows.values()]
        .filter(
          (x) =>
            !x.deleted_at &&
            shanghaiParts(x.start_at).date >= from &&
            shanghaiParts(x.start_at).date < to &&
            (!cursor ||
              x.start_at > cursor.startAt ||
              (x.start_at === cursor.startAt && x.id > cursor.id)),
        )
        .sort(compareAppointments);
      const items = all.slice(0, 100).map((x) => ({ ...x })),
        last = items.at(-1);
      return {
        items,
        nextCursor:
          all.length > 100 && last
            ? { startAt: last.start_at, id: last.id }
            : null,
      };
    },
    async get(id) {
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
    async create(input) {
      const payload = JSON.stringify(input),
        receipt = receipts.get(input.operationKey);
      if (receipt) {
        if (receipt.input !== payload) throw conflict();
        return { ...rows.get(receipt.id)! };
      }
      const row = {
        ...seed,
        id: crypto.randomUUID(),
        title: input.title,
        start_at: input.startAt,
        end_at: input.endAt,
        location: input.location ?? "",
        notes: input.notes ?? "",
      };
      rows.set(row.id, row);
      receipts.set(input.operationKey, { input: payload, id: row.id });
      return { ...row };
    },
    async update(input) {
      const row = rows.get(input.id);
      if (!row || row.deleted_at || row.revision !== input.expectedRevision)
        throw conflict();
      const next = {
        ...row,
        title: input.title,
        start_at: input.startAt,
        end_at: input.endAt,
        location: input.location ?? "",
        notes: input.notes ?? "",
        revision: row.revision + 1,
        updated_at: new Date().toISOString(),
      };
      rows.set(next.id, next);
      return { ...next };
    },
    async softDelete(input) {
      const row = rows.get(input.id);
      if (!row) throw conflict();
      if (row.deleted_at) return { ...row };
      if (row.revision !== input.expectedRevision) throw conflict();
      const next = {
        ...row,
        revision: row.revision + 1,
        deleted_at: new Date().toISOString(),
      };
      rows.set(next.id, next);
      return { ...next };
    },
  };
}
