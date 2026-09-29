import { useEffect, useRef, useState } from "react";
import type {
  FitnessAppointment,
  FitnessCursor,
  FitnessRepositoryPort,
} from "../../domain/fitness";
import { AppointmentEditor } from "./AppointmentEditor";
import { FitnessDialog } from "./FitnessDialog";
import {
  addDays,
  compareAppointments,
  monthDays,
  shanghaiParts,
  shiftMonth,
  timeLabel,
} from "./calendar";
interface Props {
  repository?: FitnessRepositoryPort;
  now?: Date;
  sessionScope?: string;
  synthetic?: boolean;
}
/** Remount before rendering data if the authenticated source changes. */
export function FitnessPanel(props: Props) {
  const [source, setSource] = useState({
    repository: props.repository,
    scope: props.sessionScope,
    generation: 0,
  });
  if (
    source.repository !== props.repository ||
    source.scope !== props.sessionScope
  )
    setSource({
      repository: props.repository,
      scope: props.sessionScope,
      generation: source.generation + 1,
    });
  return <FitnessSession key={source.generation} {...props} />;
}
function FitnessSession({ repository, now, synthetic }: Props) {
  const today = shanghaiParts(now ?? new Date()).date;
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [data, setData] = useState<{
    month: string;
    rows: FitnessAppointment[];
  } | null>(null);
  const [loading, setLoading] = useState(Boolean(repository));
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const active = useRef(true);
  const [editor, setEditor] = useState<{
    record: FitnessAppointment | null;
    date: string;
  } | null>(null);
  const [deleting, setDeleting] = useState<FitnessAppointment | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const days = monthDays(month);
  const from = days[0],
    to = addDays(days[41], 1);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    const request = ++generation.current;
    let live = true;
    if (!repository) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    void (async () => {
      const rows: FitnessAppointment[] = [];
      let cursor: FitnessCursor | undefined;
      const seen = new Set<string>();
      do {
        const page = await repository.listRange({ from, to, cursor });
        if (!live || request !== generation.current) return;
        rows.push(...page.items);
        cursor = page.nextCursor ?? undefined;
        if (cursor) {
          const key = JSON.stringify(cursor);
          if (seen.has(key)) throw Error("Repeated cursor");
          seen.add(key);
        }
      } while (cursor);
      if (live && request === generation.current)
        setData({
          month,
          rows: [...new Map(rows.map((x) => [x.id, x])).values()]
            .filter((x) => !x.deleted_at)
            .sort(compareAppointments),
        });
    })()
      .catch(() => {
        if (live && request === generation.current)
          setError("健身计划读取失败，未刷新。请重试。");
      })
      .finally(() => {
        if (live && request === generation.current) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [repository, month, from, to, reload]);
  const rows = data?.month === month ? data.rows : [];
  const dayRows = rows.filter(
    (x) => shanghaiParts(x.start_at).date === selected,
  );
  function choose(date: string) {
    setSelected(date);
    setMonth(date.slice(0, 7));
  }
  function move(offset: number) {
    const next = shiftMonth(month, offset);
    setMonth(next);
    setSelected(`${next}-01`);
  }
  function close() {
    setEditor(null);
    setDeleting(null);
  }
  function saved(row: FitnessAppointment) {
    generation.current++;
    setEditor(null);
    choose(shanghaiParts(row.start_at).date);
    setData((current) => ({
      month: shanghaiParts(row.start_at).date.slice(0, 7),
      rows: [
        ...(current?.month === shanghaiParts(row.start_at).date.slice(0, 7)
          ? current.rows
          : []
        ).filter((x) => x.id !== row.id),
        ...(row.deleted_at ? [] : [row]),
      ].sort(compareAppointments),
    }));
    setReceipt(
      row.deleted_at ? "原预约已删除，没有重新创建。" : "预约已保存。",
    );
    setReload((x) => x + 1);
    queueMicrotask(() => addButton.current?.focus());
  }
  async function remove() {
    if (!repository || !deleting || lock.current) return;
    lock.current = true;
    setBusy(true);
    setDeleteError("");
    try {
      await repository.softDelete({
        id: deleting.id,
        expectedRevision: deleting.revision,
      });
      if (!active.current) return;
      generation.current++;
      setData((current) =>
        current
          ? {
              ...current,
              rows: current.rows.filter((x) => x.id !== deleting.id),
            }
          : null,
      );
      setDeleting(null);
      setReceipt("预约已删除。");
      setReload((x) => x + 1);
      queueMicrotask(() => addButton.current?.focus());
    } catch {
      if (active.current)
        setDeleteError(
          "未删除。可能已有其他更新，请取消后刷新日历，再核对删除。",
        );
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <section
      className="card pad fitness-panel"
      aria-label="健身计划"
      data-candidate-local-write={synthetic ? true : undefined}
    >
      <div className="section-head">
        <div>
          <p className="kicker">FITNESS PLAN</p>
          <h2>健身计划</h2>
        </div>
        <button
          ref={addButton}
          className="primary-button"
          disabled={!repository}
          onClick={() => {
            setReceipt("");
            setEditor({ record: null, date: selected });
          }}
        >
          新增预约
        </button>
      </div>
      <div className="fitness-toolbar">
        <div className="button-row">
          <button
            className="secondary-button"
            aria-label="上个月"
            onClick={() => move(-1)}
          >
            ‹
          </button>
          <h3>
            {Number(month.slice(0, 4))} 年 {Number(month.slice(5))} 月
          </h3>
          <button
            className="secondary-button"
            aria-label="下个月"
            onClick={() => move(1)}
          >
            ›
          </button>
          <button className="secondary-button" onClick={() => choose(today)}>
            今天
          </button>
        </div>
        <div className="button-row">
          <span className="quiet">上海时区</span>
          <button
            className="secondary-button"
            disabled={!repository || loading}
            onClick={() => setReload((x) => x + 1)}
          >
            刷新日历
          </button>
        </div>
      </div>
      {!repository ? (
        <p className="empty-state">健身计划暂不可用，尚未连接预约数据源。</p>
      ) : (
        <>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {receipt && (
            <p className="save-receipt" role="status">
              {receipt}
            </p>
          )}
          <div className="fitness-layout">
            <div
              className="fitness-calendar"
              aria-label="健身月历"
              aria-busy={loading}
            >
              <div className="fitness-weekdays" aria-hidden="true">
                {["一", "二", "三", "四", "五", "六", "日"].map((x) => (
                  <span key={x}>{x}</span>
                ))}
              </div>
              <div className="fitness-days">
                {days.map((date) => {
                  const events = rows.filter(
                    (x) => shanghaiParts(x.start_at).date === date,
                  );
                  return (
                    <button
                      key={date}
                      className="fitness-day"
                      aria-label={`${date}，${events.length} 项预约`}
                      aria-pressed={selected === date}
                      aria-current={date === today ? "date" : undefined}
                      data-outside={date.slice(0, 7) !== month}
                      onClick={() => choose(date)}
                    >
                      <span className="fitness-day-number">
                        {Number(date.slice(8))}
                      </span>
                      {events.slice(0, 2).map((x) => (
                        <span className="fitness-summary" key={x.id}>
                          {x.time_kind === "all_day" ? "全天" : shanghaiParts(x.start_at).time} {x.title}
                        </span>
                      ))}
                      {events.length > 2 && (
                        <span className="fitness-more">
                          另有 {events.length - 2} 项
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <section className="fitness-detail" aria-label="当日预约">
              <h3>
                {Number(selected.slice(5, 7))} 月 {Number(selected.slice(8))} 日
                ·{" "}
                {new Intl.DateTimeFormat("zh-CN", {
                  weekday: "long",
                  timeZone: "Asia/Shanghai",
                }).format(new Date(`${selected}T12:00:00+08:00`))}
              </h3>
              {loading && <p className="quiet">正在读取预约…</p>}
              {!loading && !error && dayRows.length === 0 && (
                <>
                  <p className="empty-state">当天暂无预约</p>
                  <button
                    className="secondary-button"
                    onClick={() => setEditor({ record: null, date: selected })}
                  >
                    安排当天预约
                  </button>
                </>
              )}
              {dayRows.map((row) => (
                <article
                  aria-label={row.title}
                  className="fitness-appointment"
                  key={row.id}
                >
                  <p className="fitness-time">{timeLabel(row)}</p>
                  <h4>{row.title}</h4>
                  <p>{row.location || "地点待定"}</p>
                  {row.notes && <p className="fitness-notes">{row.notes}</p>}
                  <div className="button-row">
                    <button
                      className="secondary-button"
                      aria-label={`编辑${row.title}`}
                      onClick={() => setEditor({ record: row, date: selected })}
                    >
                      编辑
                    </button>
                    <button
                      className="secondary-button danger"
                      aria-label={`删除${row.title}`}
                      onClick={() => {
                        setDeleteError("");
                        setDeleting(row);
                      }}
                    >
                      删除
                    </button>
                  </div>
                </article>
              ))}
            </section>
          </div>
        </>
      )}
      {editor && repository && (
        <AppointmentEditor
          record={editor.record}
          date={editor.date}
          repository={repository}
          onClose={close}
          onSaved={saved}
        />
      )}
      {deleting && (
        <FitnessDialog label="删除预约" busy={busy} onClose={close}>
          <h2>删除预约？</h2>
          <p>
            {deleting.title} · {timeLabel(deleting)}
          </p>
          <p>确认后从日历移除。</p>
          {deleteError && (
            <p role="alert" className="form-error">
              {deleteError}
            </p>
          )}
          <div className="button-row">
            <button
              data-initial-focus
              className="secondary-button"
              disabled={busy}
              onClick={close}
            >
              取消
            </button>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void remove()}
            >
              {busy ? "正在删除…" : "确认删除"}
            </button>
          </div>
        </FitnessDialog>
      )}
    </section>
  );
}
