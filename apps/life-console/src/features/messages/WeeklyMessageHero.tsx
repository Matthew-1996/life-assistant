import { useEffect, useState } from "react";

import type {
  DashboardMessage,
  DashboardMessageRepositoryPort,
} from "../../supabase/dashboard-messages";

function monday(date: string): string {
  const value = new Date(`${date}T12:00:00+08:00`);
  const weekday = value.getDay() || 7;
  value.setDate(value.getDate() - weekday + 1);
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

interface WeeklyMessageHeroProps {
  date: string;
  repository?: DashboardMessageRepositoryPort;
}

export function WeeklyMessageHero({ date, repository }: WeeklyMessageHeroProps) {
  const [message, setMessage] = useState<DashboardMessage | null>(null);

  useEffect(() => {
    let active = true;
    if (!repository) {
      setMessage(null);
      return () => { active = false; };
    }
    void repository.getCurrentWeek(monday(date)).then((next) => {
      if (active) setMessage(next);
    }).catch(() => {
      if (active) setMessage(null);
    });
    return () => { active = false; };
  }, [date, repository]);

  const updated = message
    ? new Intl.DateTimeFormat("zh-CN", { day: "numeric", month: "long" }).format(new Date(message.generated_at))
    : null;
  const imageStyle = message?.image_url
    ? { backgroundImage: `linear-gradient(90deg, rgb(19 31 54 / 82%), rgb(23 44 71 / 44%)), url("${message.image_url}")` }
    : undefined;

  return (
    <section aria-label="本周寄语" className={`weekly-message weekly-message--${message?.fallback_theme ?? "ocean"}`} role="region" style={imageStyle}>
      <div>
        <p className="eyebrow">本周寄语 · {updated ?? date} 更新</p>
        <h1 id="today-title">{message?.message ?? "把重要的事情放在看得见的地方，给今天留出一段真正能完成的时间。"}</h1>
        {message?.quote_source && <p className="weekly-message__source">出处：{message.quote_source}</p>}
      </div>
      {message?.image_author_name && message.image_author_url && message.image_platform_url && (
        <p className="weekly-message__credit">
          摄影：<a href={message.image_author_url} rel="noreferrer" target="_blank">{message.image_author_name}</a>
          {" · "}<a href={message.image_platform_url} rel="noreferrer" target="_blank">Unsplash</a>
        </p>
      )}
    </section>
  );
}
