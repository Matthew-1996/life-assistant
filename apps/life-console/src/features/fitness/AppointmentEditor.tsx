import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  CreateFitnessAppointment,
  FitnessAppointment,
  FitnessCursor,
  FitnessFields,
  FitnessRepositoryPort,
} from "../../domain/fitness";
import { RepositoryError } from "../../supabase/repository";
import { FitnessDialog } from "./FitnessDialog";
import { addDays, localInstant, shanghaiParts, timeLabel } from "./calendar";
export function AppointmentEditor({
  record,
  date,
  repository,
  onClose,
  onSaved,
}: {
  record: FitnessAppointment | null;
  date: string;
  repository: FitnessRepositoryPort;
  onClose(): void;
  onSaved(row: FitnessAppointment): void;
}) {
  const [timeKind, setTimeKind] = useState<"timed" | "all_day">(record?.time_kind ?? "timed");
  const [title, setTitle] = useState(record?.title ?? "");
  const [day, setDay] = useState(
    record ? shanghaiParts(record.start_at).date : date,
  );
  const [start, setStart] = useState(
    record ? shanghaiParts(record.start_at).time : "",
  );
  const [end, setEnd] = useState(
    record ? shanghaiParts(record.end_at).time : "",
  );
  const [location, setLocation] = useState(record?.location ?? "");
  const [notes, setNotes] = useState(record?.notes ?? "");
  const [revision, setRevision] = useState(record?.revision ?? 1);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const active = useRef(true);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<FitnessAppointment | null | undefined>(
    undefined,
  );
  const [confirmClose, setConfirmClose] = useState(false);
  const [dayAppointments, setDayAppointments] = useState<FitnessAppointment[]>(
    [],
  );
  const [overlapState, setOverlapState] = useState<
    "loading" | "ready" | "failed"
  >("loading");
  useEffect(() => {
    let live = true;
    setDayAppointments([]);
    setOverlapState("loading");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setOverlapState("failed");
      return;
    }
    void (async () => {
      const rows: FitnessAppointment[] = [];
      let cursor: FitnessCursor | undefined;
      const seen = new Set<string>();
      do {
        const page = await repository.listRange({
          from: day,
          to: addDays(day, 1),
          cursor,
        });
        if (!live) return;
        rows.push(...page.items);
        cursor = page.nextCursor ?? undefined;
        if (cursor) {
          const key = JSON.stringify(cursor);
          if (seen.has(key)) throw Error("Repeated cursor");
          seen.add(key);
        }
      } while (cursor);
      if (live) {
        setDayAppointments(rows);
        setOverlapState("ready");
      }
    })().catch(() => {
      if (live) setOverlapState("failed");
    });
    return () => {
      live = false;
    };
  }, [day, repository]);
  const changed =
    timeKind !== (record?.time_kind ?? "timed") ||
    title !== (record?.title ?? "") ||
    day !== (record ? shanghaiParts(record.start_at).date : date) ||
    start !== (record ? shanghaiParts(record.start_at).time : "") ||
    end !== (record ? shanghaiParts(record.end_at).time : "") ||
    location !== (record?.location ?? "") ||
    notes !== (record?.notes ?? "");
  function requestClose() {
    if (changed || attempt) setConfirmClose(true);
    else onClose();
  }
  let overlaps = false;
  try {
    if (timeKind === "timed" && start && end) {
      const a = Date.parse(localInstant(day, start)),
        b = Date.parse(localInstant(day, end));
      overlaps = dayAppointments.some(
        (row) =>
          row.id !== record?.id &&
          !row.deleted_at && row.time_kind !== "all_day" &&
          Date.parse(row.start_at) < b &&
          Date.parse(row.end_at) > a,
      );
    }
  } catch {
    /* Incomplete or invalid input is handled by submit validation. */
  }
  const [attempt, setAttempt] = useState<CreateFitnessAppointment | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  function fields(): FitnessFields {
    if (!title.trim()) throw Error("请填写健身事件。");
    if (!day || (timeKind === "timed" && (!start || !end || end <= start)))
      throw Error("结束时间必须晚于开始时间，且在同一天。");
    const instant = (time: string, original?: string) =>
      original &&
      shanghaiParts(original).date === day &&
      shanghaiParts(original).time === time
        ? original
        : localInstant(day, time);
    return {
      timeKind,
      title: title.trim(),
      startAt: timeKind === "all_day" ? localInstant(day, "00:00") : instant(start, record?.start_at),
      endAt: timeKind === "all_day" ? localInstant(addDays(day, 1), "00:00") : instant(end, record?.end_at),
      location,
      notes,
    };
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (lock.current || conflict) return;
    let input: FitnessFields;
    try {
      input = attempt ?? fields();
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      let row: FitnessAppointment;
      if (record)
        row = await repository.update({
          ...input,
          id: record.id,
          expectedRevision: revision,
        });
      else {
        const request = attempt ?? {
          ...input,
          operationKey: `fitness-ui-${crypto.randomUUID()}`,
        };
        setAttempt(request);
        row = await repository.create(request);
      }
      if (active.current) onSaved(row);
    } catch (e) {
      if (!active.current) return;
      if (e instanceof RepositoryError && e.kind === "conflict") {
        setConflict(true);
        setLatest(undefined);
        setError("未保存：版本冲突，请核对最新记录。");
      } else {
        if (
          !attempt &&
          e instanceof RepositoryError &&
          ["validation", "forbidden", "unauthorized"].includes(e.kind)
        )
          setAttempt(null);
        setError(
          "未保存。草稿仍在当前面板；请重试。新增请求结果未确认时，重试会使用原内容，避免重复预约。",
        );
      }
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function readLatest() {
    if (!record || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const row = await repository.get(record.id);
      if (active.current) setLatest(row);
    } catch {
      if (active.current) setError("未保存，最新版本读取失败；草稿仍保留。");
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <FitnessDialog
      label={record ? "编辑预约" : "新增预约"}
      busy={busy}
      onClose={requestClose}
    >
      <div className="section-head">
        <h2>{record ? "编辑预约" : "新增预约"}</h2>
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={requestClose}
        >
          放弃并关闭
        </button>
      </div>
      <p className="quiet">
        时间按上海时区安排。草稿仅保留在当前面板，关闭后丢弃。
      </p>
      {confirmClose && (
        <section className="fitness-conflict" aria-label="放弃草稿确认">
          <p>
            {attempt
              ? "上次新增结果尚未确认。关闭后请先刷新日历核对，避免重复新增。"
              : "草稿尚未保存，确定放弃？"}
          </p>
          <div className="button-row">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => setConfirmClose(false)}
            >
              继续编辑
            </button>
            <button
              type="button"
              className="secondary-button danger"
              disabled={busy}
              onClick={onClose}
            >
              放弃草稿
            </button>
          </div>
        </section>
      )}
      <form
        aria-label="预约编辑"
        onSubmit={(e) => void save(e)}
        className="fitness-form"
      >
        <fieldset disabled={busy || Boolean(attempt) || confirmClose}>
          <label>
            健身事件
            <input
              data-initial-focus
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            预约日期
            <input
              type="date"
              required
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
          <label>时间类型
            <select value={timeKind} onChange={(e) => setTimeKind(e.target.value as "timed" | "all_day")}>
              <option value="timed">定时</option><option value="all_day">全天</option>
            </select>
          </label>
          {timeKind === "timed" && <div className="fitness-times">
            <label>
              开始时间
              <input
                type="time"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              结束时间
              <input
                type="time"
                required
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>}
          <label>
            地点
            <input
              maxLength={240}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </label>
          <label>
            备注
            <textarea
              rows={5}
              maxLength={4000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </fieldset>
        {overlaps && (
          <p className="quiet">与已有预约时间重叠，仍可按你的安排保存。</p>
        )}
        {overlapState === "failed" && (
          <p className="quiet">暂时无法核对时间重叠，可稍后刷新日历确认。</p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {conflict && (
          <section className="fitness-conflict" aria-label="预约冲突">
            <p>
              本次草稿：{title} · {day} {timeKind === "all_day" ? "全天" : `${start}–${end}`}
            </p>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || !record}
              onClick={() => void readLatest()}
            >
              读取最新版本
            </button>
            {latest !== undefined &&
              (latest && !latest.deleted_at ? (
                <>
                  <h3>当前记录</h3>
                  <p>{latest.title}</p>
                  <p>
                    {shanghaiParts(latest.start_at).date} {timeLabel(latest)}
                  </p>
                  <p>{latest.location}</p>
                  <p className="fitness-notes">{latest.notes}</p>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => {
                      setRevision(latest.revision);
                      setConflict(false);
                      setError("已核对最新版本，草稿尚未保存。");
                    }}
                  >
                    以最新版本重提草稿
                  </button>
                </>
              ) : (
                <p>
                  该预约已删除或不可用。请放弃并关闭；如需另建，返回日历明确新增。
                </p>
              ))}
          </section>
        )}
        <button
          className="primary-button"
          type="submit"
          disabled={busy || conflict || confirmClose}
        >
          {busy ? "正在保存…" : attempt ? "重试保存" : "保存预约"}
        </button>
      </form>
    </FitnessDialog>
  );
}
