import {
  type FormEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  AnchorKey,
  AnchorState,
  DailyAnchors,
  DailyCheckin,
  DailyCheckinFields,
  DailyCheckinRepositoryPort,
  Rating,
} from "../../supabase/daily-checkins";
import { RepositoryError } from "../../supabase/repository";

export interface SupabaseDailyCheckinPanelProps {
  date: string;
  repository: DailyCheckinRepositoryPort;
  createIdempotencyKey?: () => string;
}

type RatingField =
  | "sleepQuality"
  | "energy"
  | "mood"
  | "lifeFeeling";
type DirtyField = RatingField | AnchorKey | "notes";

interface Draft {
  sleepQuality: string;
  energy: string;
  mood: string;
  lifeFeeling: string;
  anchors: Record<AnchorKey, string>;
  notes: string;
}

interface Notice {
  kind: "success" | "error";
  message: string;
}

const ratingFields: Array<{
  key: RatingField;
  label: string;
}> = [
  { key: "sleepQuality", label: "睡眠质量" },
  { key: "energy", label: "精力" },
  { key: "mood", label: "情绪" },
  { key: "lifeFeeling", label: "生活实感" },
];
const anchorFields: Array<{
  key: AnchorKey;
  label: string;
}> = [
  { key: "wake", label: "起床" },
  { key: "body_light", label: "身体 / 光照" },
  { key: "life_action", label: "生活动作" },
  { key: "wind_down", label: "晚间降速" },
];

function emptyDraft(): Draft {
  return {
    sleepQuality: "",
    energy: "",
    mood: "",
    lifeFeeling: "",
    anchors: {
      wake: "",
      body_light: "",
      life_action: "",
      wind_down: "",
    },
    notes: "",
  };
}

function draftFromCheckin(checkin: DailyCheckin | null): Draft {
  if (!checkin) return emptyDraft();
  return {
    sleepQuality: checkin.sleep_quality?.toString() ?? "",
    energy: checkin.energy?.toString() ?? "",
    mood: checkin.mood?.toString() ?? "",
    lifeFeeling: checkin.life_feeling?.toString() ?? "",
    anchors: {
      wake: checkin.anchors?.wake ?? "",
      body_light: checkin.anchors?.body_light ?? "",
      life_action: checkin.anchors?.life_action ?? "",
      wind_down: checkin.anchors?.wind_down ?? "",
    },
    notes: checkin.notes ?? "",
  };
}

function defaultIdempotencyKey(): string {
  return `checkin_${crypto.randomUUID().replaceAll("-", "")}`;
}

function failureNotice(error: unknown): Notice {
  if (
    error instanceof RepositoryError
    && error.kind === "conflict"
  ) {
    return {
      kind: "error",
      message:
        "记录已在其他页面更新；输入仍保留，请重新载入后比较。",
    };
  }
  return {
    kind: "error",
    message: "尚未保存；输入仍保留，可稍后重试。",
  };
}

export function SupabaseDailyCheckinPanel({
  date,
  repository,
  createIdempotencyKey = defaultIdempotencyKey,
}: SupabaseDailyCheckinPanelProps): ReactElement {
  const [checkin, setCheckin] = useState<DailyCheckin | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [dirty, setDirty] = useState<Set<DirtyField>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const createKey = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    setNotice(null);
    void repository.get(date)
      .then((value) => {
        if (!active) return;
        setCheckin(value);
        setDraft(draftFromCheckin(value));
        setDirty(new Set());
        createKey.current = null;
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [date, loadAttempt, repository]);

  function markDirty(field: DirtyField) {
    setDirty((current) => new Set(current).add(field));
    setNotice(null);
  }

  function updateRating(field: RatingField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    markDirty(field);
  }

  function updateAnchor(field: AnchorKey, value: string) {
    setDraft((current) => ({
      ...current,
      anchors: { ...current.anchors, [field]: value },
    }));
    markDirty(field);
  }

  function explicitFields(): DailyCheckinFields {
    const fields: DailyCheckinFields = {};
    for (const { key } of ratingFields) {
      if (dirty.has(key)) {
        fields[key] = draft[key]
          ? Number(draft[key]) as Rating
          : null;
      }
    }
    if (anchorFields.some(({ key }) => dirty.has(key))) {
      const anchors = Object.fromEntries(
        anchorFields
          .filter(({ key }) => draft.anchors[key])
          .map(({ key }) => [key, draft.anchors[key] as AnchorState]),
      ) as DailyAnchors;
      fields.anchors = Object.keys(anchors).length > 0 ? anchors : null;
    }
    if (dirty.has("notes")) fields.notes = draft.notes;
    return fields;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dirty.size === 0) {
      setNotice({
        kind: "success",
        message: "请先填写至少一项；未记录仍保持未知。",
      });
      return;
    }

    const fields = explicitFields();
    setPending(true);
    setNotice(null);
    try {
      let saved: DailyCheckin;
      if (checkin) {
        saved = await repository.update(
          checkin.id,
          checkin.revision,
          fields,
        );
      } else {
        createKey.current ??= createIdempotencyKey();
        saved = await repository.create(createKey.current, {
          date,
          ...fields,
        });
      }
      setCheckin(saved);
      setDraft(draftFromCheckin(saved));
      setDirty(new Set());
      createKey.current = null;
      setNotice({ kind: "success", message: "每日状态已保存。" });
    } catch (error) {
      setNotice(failureNotice(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="supabase-checkin-title"
      className="supabase-checkin-panel"
    >
      <div className="section-head">
        <div>
          <p className="eyebrow">{date}</p>
          <h2 id="supabase-checkin-title">每日状态</h2>
          <p className="quiet">
            只提交明确填写的项目；未记录保持未知。
          </p>
        </div>
        <span className="status blue">1–5</span>
      </div>

      {loading ? (
        <p className="quiet" role="status">正在读取每日状态…</p>
      ) : loadFailed ? (
        <div className="empty-state">
          <p>每日状态暂时无法读取。</p>
          <button
            className="secondary-button"
            onClick={() => setLoadAttempt((value) => value + 1)}
            type="button"
          >
            重新加载
          </button>
        </div>
      ) : (
        <>
          <p className="quiet">
            {checkin
              ? `已读取 revision #${checkin.revision}`
              : "这一天还没有状态记录"}
          </p>
          <form className="supabase-checkin-form" onSubmit={save}>
            <div className="supabase-checkin-ratings">
              {ratingFields.map(({ key, label }) => (
                <label key={key}>
                  {label}
                  <select
                    onChange={(event) =>
                      updateRating(key, event.target.value)}
                    value={draft[key]}
                  >
                    <option value="">未记录</option>
                    {[1, 2, 3, 4, 5].map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            <fieldset className="supabase-checkin-anchors">
              <legend>今日锚点</legend>
              {anchorFields.map(({ key, label }) => (
                <label key={key}>
                  {label}
                  <select
                    onChange={(event) =>
                      updateAnchor(key, event.target.value)}
                    value={draft.anchors[key]}
                  >
                    <option value="">未记录</option>
                    <option value="complete">完成</option>
                    <option value="minimum">最低版</option>
                    <option value="skipped">跳过</option>
                  </select>
                </label>
              ))}
            </fieldset>

            <label>
              简短备注
              <textarea
                maxLength={160}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    notes: event.target.value,
                  }));
                  markDirty("notes");
                }}
                value={draft.notes}
              />
            </label>

            <button
              className="primary-button"
              disabled={pending}
              type="submit"
            >
              {pending ? "正在保存…" : "保存每日状态"}
            </button>
          </form>
        </>
      )}

      {notice ? (
        <p
          className={notice.kind === "error"
            ? "error-message"
            : "success-message"}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.message}
        </p>
      ) : null}
    </section>
  );
}
