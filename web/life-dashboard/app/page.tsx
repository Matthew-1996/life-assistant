import {
  buildSevenDayPath,
  confirmedPhaseTruth,
  phaseState,
  phases,
} from "./life-plan.js";

export default function Home() {
  const state = phaseState();
  const sevenDayPath = buildSevenDayPath(state.today);
  const activePhase = state.status === "active" ? state.phase : null;
  const isActivePhase = activePhase !== null;
  const isAwaitingReview = state.status === "awaiting_review";
  const isReviewDue = state.status === "review_due";
  const stateLabel = isAwaitingReview
    ? "等待复盘"
    : isReviewDue
      ? "路线复盘"
      : "当前重点";

  return (
    <main>
      <header className="hero" id="today">
        <nav className="topbar" aria-label="页面导航">
          <a className="brand" href="#today" aria-label="回到今日">
            <span className="brand-mark">生</span>
            <span>生活助手</span>
          </a>
          <span className="privacy-pill">只读 · 私密查看</span>
        </nav>

        <div className="hero-copy">
          <p className="eyebrow">{state.today.replaceAll("-", ".")} · {stateLabel}</p>
          <h1>今天不用解决人生。<br />先让自己回来一点。</h1>
          <p className="hero-note">当前重点不会永久固定。未来阶段到复盘日再确认，不提前变成待办。</p>
        </div>

        <section className="phase-card" aria-label="当前阶段进度">
          {activePhase ? (
            <>
              <div className="phase-card-top">
                <div>
                  <p className="micro-label">阶段 {activePhase.id}</p>
                  <h2>{activePhase.title}</h2>
                </div>
                <div className="day-count">
                  <strong>{state.day}</strong><span> / {state.total} 天</span>
                </div>
              </div>
              <div className="progress" aria-label={`当前阶段完成 ${state.progress}%`}>
                <span style={{ width: `${state.progress}%` }} />
              </div>
              <div className="phase-card-bottom">
                <span>{activePhase.dates}</span>
                <span>本阶段复盘 {activePhase.end.slice(5).replace("-", "/")}</span>
              </div>
            </>
          ) : isAwaitingReview ? (
            <>
              <div className="phase-card-top route-review-card">
                <div>
                  <p className="micro-label">AWAITING REVIEW</p>
                  <h2>等待你确认下一阶段</h2>
                  <p>
                    已确认的阶段 {state.confirmedPhase.id} 已结束。先继续最低恢复锚点；
                    {state.nextPhase
                      ? `阶段 ${state.nextPhase.id}「${state.nextPhase.title}」`
                      : "后续路线"}
                    仍是建议，不会按日期自动开始。
                  </p>
                </div>
              </div>
              <div className="progress" aria-label="已确认阶段结束，等待复盘">
                <span style={{ width: "100%" }} />
              </div>
              <div className="phase-card-bottom">
                <span>已确认到阶段 {state.confirmedPhase.id} · 来源 {confirmedPhaseTruth.source}</span>
                <span>继续最低恢复锚点</span>
              </div>
            </>
          ) : isReviewDue ? (
            <>
              <div className="phase-card-top route-review-card">
                <div>
                  <p className="micro-label">ROUTE REVIEW</p>
                  <h2>路线已到复盘节点</h2>
                  <p>10/31 前的建议路线已经结束。先结合真实恢复情况选择下一重点，不自动延续旧阶段。</p>
                </div>
              </div>
              <div className="progress" aria-label="建议路线已到复盘节点">
                <span style={{ width: "100%" }} />
              </div>
              <div className="phase-card-bottom">
                <span>建议路线 8.01 — 10.31</span>
                <span>等待下一次对话复盘</span>
              </div>
            </>
          ) : (
            <>
              <div className="phase-card-top route-review-card">
                <div>
                  <p className="micro-label">UPCOMING</p>
                  <h2>路线将在 8/01 开始</h2>
                  <p>开始前不需要预先完成任务；到当天再从最低版本开始。</p>
                </div>
              </div>
              <div className="progress" aria-label="建议路线尚未开始">
                <span style={{ width: "0%" }} />
              </div>
              <div className="phase-card-bottom">
                <span>建议路线 8.01 — 10.31</span>
                <span>开始前保持安静</span>
              </div>
            </>
          )}
        </section>
      </header>

      <section className="section today-section" aria-labelledby="anchors-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow dark">TODAY</p>
            <h2 id="anchors-title">
              {isAwaitingReview ? "等待复盘时，只守最低恢复锚点" : "今天只守三个锚点"}
            </h2>
          </div>
          <span className="soft-badge">最低版也算</span>
        </div>

        <div className="anchor-list">
          <article className="anchor-card">
            <span className="anchor-number">01</span>
            <div>
              <h3>从床上离开</h3>
              <p>工作日 10:00；本周末先不晚于 11:00。</p>
              <span className="minimum">最低版：起身、拉开窗帘</span>
            </div>
          </article>
          <article className="anchor-card">
            <span className="anchor-number">02</span>
            <div>
              <h3>身体和生活各出现一次</h3>
              <p>一个轻活动，加一件不为工作服务的小事。</p>
              <span className="minimum">最低版：户外站 5 分钟</span>
            </div>
          </article>
          <article className="anchor-card">
            <span className="anchor-number">03</span>
            <div>
              <h3>晚上停止解决问题</h3>
              <p>00:30 左右开始降速；困了再上床。</p>
              <span className="minimum">最低版：保留 20 分钟切换</span>
            </div>
          </article>
        </div>

        <details className="permission-card">
          <summary>今天可以不做什么？</summary>
          <ul>
            <li>补做昨天没完成的生活任务</li>
            <li>高强度健身、系统学习或完整职业规划</li>
            <li>把休息也变成新的绩效项目</li>
          </ul>
        </details>
      </section>

      <section className="section week-section" aria-labelledby="week-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow dark">NEXT 7 DAYS</p>
            <h2 id="week-title">从今天起的七日轻量路径</h2>
          </div>
          <span className="section-caption">横向滑动 · 最低版也可以</span>
        </div>
        <div className="day-strip" role="list">
          {sevenDayPath.map((item) => (
            <article className={`day-card ${item.iso === state.today ? "active" : ""}`} role="listitem" key={item.date}>
              <span className="weekday">周{item.day}</span>
              <strong>{item.date}</strong>
              <p>{item.label}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section roadmap-section" id="roadmap" aria-labelledby="roadmap-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow dark">ROADMAP</p>
            <h2 id="roadmap-title">阶段路线</h2>
          </div>
          <span className="soft-badge neutral">后续待确认</span>
        </div>
        <div className="phase-line" aria-hidden="true">
          {phases.map((phase, index) => <span className={state.status !== "upcoming" && index <= state.confirmedIndex ? "reached" : ""} key={phase.id} />)}
        </div>
        <div className="roadmap-list">
          {phases.map((phase, index) => (
            <article className={`roadmap-card ${phase.tone} ${isActivePhase && index === state.index ? "current" : ""}`} key={phase.id}>
              <div className="roadmap-index">{phase.id}</div>
              <div className="roadmap-copy">
                <div className="roadmap-title-row">
                  <h3>{phase.title}</h3>
                  <span>{phase.dates} · {index <= state.confirmedIndex ? "已确认" : "建议"}</span>
                </div>
                <p>{phase.intent}</p>
                <small>观察：{phase.signal}</small>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section growth-section" id="growth" aria-labelledby="growth-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow dark">NEXT TRACKS</p>
            <h2 id="growth-title">两条候选分支，复盘只启用一条</h2>
          </div>
          <span className="soft-badge neutral">不自动变成待办</span>
        </div>
        <p className="growth-intro">睡眠与生活体验仍是当前重点。8/14 之前健身和职业都不排期；复盘时只选健身、职业或都先不聊。</p>
        <p className="branch-rule"><strong>互斥规则：</strong>选健身时，职业不排期；选职业时，健身只保留恢复所需的轻活动；都不选时，系统保持安静。</p>

        <div className="track-grid">
          <article className="track-card fitness-track">
            <div className="track-card-head">
              <div>
                <p className="track-kicker">FITNESS · 候选</p>
                <h3>先知道身体，再谈训练</h3>
              </div>
              <span>8/14 选择门</span>
            </div>
            <ol className="milestone-list">
              <li>
                <time>现在—8/14</time>
                <div><strong>暂未启用健身分支</strong><p>散步、见光和轻活动只属于当前恢复锚点；不新增训练任务。</p></div>
              </li>
              <li>
                <time>8/14</time>
                <div><strong>选中后才补五类信息</strong><p>只在明确选择健身后，再分批了解身体限制、运动基础、目标、偏好和现实条件。</p></div>
              </li>
              <li>
                <time>8/15—8/31</time>
                <div><strong>准备度允许才低量试运行</strong><p>建议从每周 2 次、每次 15–25 分钟开始，间隔至少一天；睡眠或精力变差就不加量。</p></div>
              </li>
              <li>
                <time>9/15 起</time>
                <div><strong>再做个性化训练块</strong><p>有两周反馈后设计 4–6 周计划，一次只增加时长、次数、负荷或难度中的一个。</p></div>
              </li>
            </ol>
            <details className="track-details">
              <summary>8/14 我会具体问什么？</summary>
              <ul>
                <li>是否有伤病、疼痛、慢性病、用药、医生限制或近期异常症状</li>
                <li>最近三个月活动量，以及过去做过的运动</li>
                <li>最想改善力量、心肺、体态、体重、情绪、精力、睡眠还是其他</li>
                <li>喜欢、愿意尝试和明确讨厌的项目</li>
                <li>场地、器械、每周现实天数和单次时长</li>
              </ul>
            </details>
            <p className="evidence-note">WHO 的 150–300 分钟中等强度有氧和每周至少 2 天力量活动是长期方向，不是现在的作业；CDC 同样建议从小量、适合自己的活动逐步增加。<a href="https://www.who.int/europe/publications/i/item/9789240014886" target="_blank" rel="noreferrer">WHO</a><a href="https://www.cdc.gov/physical-activity-basics/adding-adults/index.html" target="_blank" rel="noreferrer">CDC</a></p>
          </article>

          <article className="track-card career-track">
            <div className="track-card-head">
              <div>
                <p className="track-kicker">CAREER · 候选</p>
                <h3>先留个人资产，再验证方向</h3>
              </div>
              <span>8/14 选择门</span>
            </div>
            <ol className="milestone-list">
              <li>
                <time>现在—8/14</time>
                <div><strong>暂未启用职业分支</strong><p>不设每周额度；若自然想到可带走的去敏经验，可随手交给助手保存。</p></div>
              </li>
              <li>
                <time>8/15—8/31</time>
                <div><strong>选中后才整理个人资产</strong><p>只在明确选择职业后，再去敏整理经历、能力、工作边界和个人资料迁移。</p></div>
              </li>
              <li>
                <time>9/01—10/12</time>
                <div><strong>持续选择才换证据</strong><p>先做方向假设和低压访谈，再从案例、短课或小项目中选 2–3 个可逆实验。</p></div>
              </li>
              <li>
                <time>10/13 起</time>
                <div><strong>只选一个 6 周验证冲刺</strong><p>是否进入正式求职，等恢复与现实条件共同支持后再决定。</p></div>
              </li>
            </ol>
            <div className="career-lens">
              <span>可探索方向</span>
              <p>同领域但更健康的组织 · 相邻产品方向 · 咨询或顾问 · 创业或独立项目 · 阶段性休整后再求职</p>
            </div>
          </article>
        </div>

        <div className="activity-menu">
          <div className="activity-menu-title">
            <p className="track-kicker">LIFE MENU</p>
            <h3>其他活动每周只选一个</h3>
            <p>这不是四项清单。选最想要或最容易的一项，下一周可以换。</p>
          </div>
          <article><span>01</span><h4>低目的外出</h4><p>公园、书店、街区或附近新路线。</p></article>
          <article><span>02</span><h4>关系连接</h4><p>和一个让你放松的人吃饭、散步或通话。</p></article>
          <article><span>03</span><h4>环境恢复</h4><p>只整理一个改善休息感的小区域，限时 20 分钟。</p></article>
          <article><span>04</span><h4>兴趣与创作</h4><p>音乐、阅读、做饭、摄影或任何没有产出要求的活动。</p></article>
        </div>
        <p className="safety-inline">如有慢性健康问题、长期不活动后想直接进行高强度运动，或活动中出现胸部不适、异常气短、眩晕或晕厥，先暂停并咨询医疗专业人员。<a href="https://www.heart.org/en/health-topics/cardiac-rehab/getting-physically-active/develop-a-physical-activity-plan-for-you" target="_blank" rel="noreferrer">查看活动警示信号</a></p>
      </section>

      <section className="section journal-section" id="journal" aria-labelledby="journal-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow dark">JOURNAL</p>
            <h2 id="journal-title">把生活留给未来的自己</h2>
          </div>
          <span className="soft-badge">只在对话里记录</span>
        </div>
        <p className="journal-intro">不用另外打开文档。当你发来一段想留下的生活经历，我会按原意保存，再做不添加负担的整理。</p>

        <div className="journal-trigger-card">
          <div>
            <p className="track-kicker">HOW TO START</p>
            <h3>发消息时，用任意一个开头</h3>
          </div>
          <div className="journal-triggers" aria-label="日记触发词">
            <span>日记：</span>
            <span>日记记录：</span>
            <span>生活记录：</span>
            <span>记录一下：</span>
          </div>
          <p>不用固定格式也可以：只要你明确说“这段生活经历想留存”，我就会把它当作日记处理。</p>
        </div>

        <div className="journal-flow" aria-label="日记整理流程">
          <article>
            <span>01</span>
            <h3>保存原始事实</h3>
            <p>保留你讲述的时间、事件、感受与细节；不补写你没有说过的事。</p>
          </article>
          <article>
            <span>02</span>
            <h3>生成轻量摘要</h3>
            <p>用几句话标记这一天或这段经历的重点，保留回看时需要的上下文。</p>
          </article>
          <article>
            <span>03</span>
            <h3>添加标签与关联</h3>
            <p>按内容关联睡眠、精力、工作、关系、兴趣或重要地点，方便以后找到生活线索。</p>
          </article>
          <article>
            <span>04</span>
            <h3>形成周与月回顾</h3>
            <p>定期整理重要时刻、反复出现的感受和值得带入未来规划的线索。</p>
          </article>
        </div>

        <div className="journal-controls" aria-label="日记更正、撤回与删除方式">
          <div className="journal-controls-heading">
            <p className="track-kicker">YOUR CONTROL</p>
            <h3>记下之后，你仍然可以改主意</h3>
            <p>更正会留痕；逻辑撤回会隐藏后续索引与回顾，但原文仍留在当前项目且可以恢复；永久删除当前项目副本前，我会先展示范围并取得当次精确确认。</p>
          </div>
          <article>
            <span>更正</span>
            <code>更正刚才的日记：……</code>
            <p>保留原记录和更正关系，不静默覆盖。</p>
          </article>
          <article>
            <span>可恢复撤回</span>
            <code>不要记刚才那条</code>
            <p>用于撤回最近一次仍有效的隐式保存。它会从后续索引与回顾中隐藏，但原文仍保留在当前项目；之后可说“恢复刚才撤回的日记”。这不是删除。</p>
          </article>
          <article>
            <span>永久删除</span>
            <code>永久删除那篇日记</code>
            <p>我会先确认具体条目和历史副本边界，不会因一句模糊请求直接删除。</p>
          </article>
        </div>

        <aside className="journal-privacy" aria-label="日记隐私说明">
          <span className="journal-lock" aria-hidden="true">◆</span>
          <div>
            <h3>日记归档在你的 iCloud 项目</h3>
            <p>日记工具不会自动把原文发布到这个网页；对话平台、iCloud 同步和历史备份副本按各自设置保留。未来如果要在看板展示周回顾、月回顾或任何日记摘要，我会先取得你当次的明确授权。</p>
          </div>
        </aside>
      </section>

      <section className="section checkin-section" id="checkin" aria-labelledby="checkin-title">
        <div className="section-heading light">
          <div>
            <p className="eyebrow">CHECK-IN</p>
            <h2 id="checkin-title">你只需要回复我</h2>
          </div>
          <span className="reply-badge">不用填表</span>
        </div>
        <p className="checkin-intro">定时提醒出现时，按下面格式发一条消息。缺项也没关系，我会整理并同步到计划。</p>

        <div className="reply-template">
          <p>入睡 1:40；离床 10:10</p>
          <p>睡眠 3 / 精力 2 / 情绪 3 / 生活感 2</p>
          <p>锚点：最低版</p>
          <p>备注：下午散步后舒服一点</p>
        </div>

        <div className="checkin-grid">
          <article>
            <span>普通日 · 11:15</span>
            <h3>一分钟状态回报</h3>
            <p>睡眠、离床、四个分数、锚点和一句备注。</p>
          </article>
          <article>
            <span>8/9 · 11:15</span>
            <h3>一周轻复盘</h3>
            <p>变好、摩擦、下周实验、停止项和目标决定。</p>
          </article>
        </div>
        <p className="sync-note"><span /> 你的回复由生活助手整理；网页不收集表单数据。</p>
      </section>

      <section className="section support-section" aria-labelledby="support-title">
        <p className="eyebrow dark">WHEN TO GET HELP</p>
        <h2 id="support-title">不要只靠计划硬撑</h2>
        <p>如果失眠反复、持续或明显影响生活，建议预约睡眠门诊、精神心理科或能提供 CBT-I 的专业人员。</p>
        <details>
          <summary>查看安全提醒</summary>
          <p>如果出现不想活、自伤或伤害自己的想法，不要独处，联系可信任的人并拨打 12356；有立即危险时拨打 120/110 或去急诊。</p>
        </details>
      </section>

      <footer>
        <span>生活助手 · 当前版本 2026.08.01 · 扩展路线</span>
        <span>记录为了发现模式，不是考核</span>
      </footer>

      <nav className="mobile-nav" aria-label="移动端快捷导航">
        <a href="#today"><span>●</span>今日</a>
        <a href="#roadmap"><span>◇</span>路线</a>
        <a href="#growth"><span>＋</span>成长</a>
        <a href="#journal"><span>◆</span>日记</a>
        <a href="#checkin"><span>↗</span>回复</a>
      </nav>
    </main>
  );
}
