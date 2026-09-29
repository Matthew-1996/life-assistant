// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { createCandidateFitnessRepository } from "../../src/features/fitness/candidate-fitness-repository";
import { FitnessPanel } from "../../src/features/fitness/FitnessPanel";
import type {
  FitnessAppointment,
  FitnessRepositoryPort,
} from "../../src/domain/fitness";
import { RepositoryError } from "../../src/supabase/repository";
const now = new Date("2030-05-01T02:00:00Z");
const row: FitnessAppointment = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  user_id: "synthetic",
  title: "合成训练",
  start_at: "2030-05-01T10:30:00Z",
  end_at: "2030-05-01T11:30:00Z",
  location: "示例场地",
  notes: "长备注\n<script>safe</script>",
  revision: 1,
  deleted_at: null,
  time_zone: "Asia/Shanghai",
  created_at: "2030-05-01T00:00:00Z",
  updated_at: "2030-05-01T00:00:00Z",
};
function repo(rows = [row]): FitnessRepositoryPort {
  return {
    listRange: vi.fn(async () => ({ items: rows, nextCursor: null })),
    get: vi.fn(async () => rows[0] ?? null),
    create: vi.fn(async (input) => ({
      ...row,
      title: input.title,
      start_at: input.startAt,
      end_at: input.endAt,
    })),
    update: vi.fn(async (input) => ({
      ...row,
      title: input.title,
      start_at: input.startAt,
      end_at: input.endAt,
      revision: 2,
    })),
    softDelete: vi.fn(async () => ({
      ...row,
      deleted_at: "2030-05-01T03:00:00Z",
      revision: 2,
    })),
  };
}
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function openNew(r = repo([])) {
  render(<FitnessPanel repository={r} now={now} />);
  await screen.findByText("当天暂无预约");
  await userEvent.click(screen.getByRole("button", { name: "新增预约" }));
  fireEvent.change(screen.getByLabelText("健身事件"), {
    target: { value: "新增训练" },
  });
  fireEvent.change(screen.getByLabelText("开始时间"), {
    target: { value: "18:30" },
  });
  fireEvent.change(screen.getByLabelText("结束时间"), {
    target: { value: "19:30" },
  });
  return r;
}
it("shows Shanghai month, two summaries plus overflow and safe sorted day details", async () => {
  render(
    <FitnessPanel
      repository={repo([
        row,
        { ...row, id: "b", title: "早场", start_at: "2030-05-01T01:00:00Z" },
        { ...row, id: "c", title: "晚场", start_at: "2030-05-01T12:00:00Z" },
      ])}
      now={now}
    />,
  );
  expect(await screen.findByText("另有 1 项")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "2030 年 5 月" })).toBeTruthy();
  const day = screen.getByRole("region", { name: "当日预约" });
  expect(
    within(day)
      .getAllByRole("article")
      .map((x) => x.getAttribute("aria-label")),
  ).toEqual(["早场", "合成训练", "晚场"]);
  expect(
    within(day).getAllByText("长备注 <script>safe</script>", { exact: false }),
  ).toBeTruthy();
  expect(day.querySelector("script")).toBeNull();
});
it("keeps failed create draft frozen and retries the identical idempotency key", async () => {
  const r = repo([]);
  vi.mocked(r.create).mockRejectedValueOnce(new Error("offline"));
  await openNew(r);
  await userEvent.click(screen.getByRole("button", { name: "保存预约" }));
  expect(await screen.findByText(/未保存/)).toBeTruthy();
  expect((screen.getByLabelText("健身事件") as HTMLInputElement).value).toBe(
    "新增训练",
  );
  await userEvent.click(screen.getByRole("button", { name: "重试保存" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(vi.mocked(r.create).mock.calls[0][0]).toEqual(
    vi.mocked(r.create).mock.calls[1][0],
  );
  expect(screen.getByRole("status").textContent).toContain("已保存");
});
it("requires later end time and explicitly records Shanghai offset independent of device zone", async () => {
  const r = await openNew();
  fireEvent.change(screen.getByLabelText("结束时间"), {
    target: { value: "17:00" },
  });
  await userEvent.click(screen.getByRole("button", { name: "保存预约" }));
  expect(screen.getByRole("alert").textContent).toContain("晚于");
  expect(r.create).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("结束时间"), {
    target: { value: "20:00" },
  });
  await userEvent.click(screen.getByRole("button", { name: "保存预约" }));
  await waitFor(() => expect(r.create).toHaveBeenCalledOnce());
  expect(vi.mocked(r.create).mock.calls[0][0].startAt).toBe(
    "2030-05-01T10:30:00.000Z",
  );
});
it("keeps conflict draft until latest revision is reviewed then reschedules", async () => {
  const r = repo();
  vi.mocked(r.update).mockRejectedValueOnce(
    new RepositoryError("conflict", 409, "40001", "changed"),
  );
  vi.mocked(r.get).mockResolvedValue({
    ...row,
    title: "另一端更新",
    revision: 2,
  });
  render(<FitnessPanel repository={r} now={now} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "编辑合成训练" }),
  );
  fireEvent.change(screen.getByLabelText("预约日期"), {
    target: { value: "2030-06-02" },
  });
  await userEvent.click(screen.getByRole("button", { name: "保存预约" }));
  await screen.findByText(/版本冲突/);
  await userEvent.click(screen.getByRole("button", { name: "读取最新版本" }));
  await screen.findByText("另一端更新");
  expect((screen.getByLabelText("预约日期") as HTMLInputElement).value).toBe(
    "2030-06-02",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "以最新版本重提草稿" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "保存预约" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(vi.mocked(r.update).mock.calls[1][0].expectedRevision).toBe(2);
  expect(screen.getByRole("heading", { name: "2030 年 6 月" })).toBeTruthy();
});
it("confirms deletion and never silently removes on failure", async () => {
  const r = repo();
  vi.mocked(r.softDelete).mockRejectedValueOnce(new Error("offline"));
  render(<FitnessPanel repository={r} now={now} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "删除合成训练" }),
  );
  expect(r.softDelete).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "确认删除" }));
  expect(await screen.findByText(/未删除/)).toBeTruthy();
  expect(screen.getByRole("article", { name: "合成训练" })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("does not publish partial pages on failure or pretend an unavailable source is empty", async () => {
  const r = repo();
  vi.mocked(r.listRange)
    .mockResolvedValueOnce({
      items: [row],
      nextCursor: { id: row.id, startAt: row.start_at },
    })
    .mockRejectedValueOnce(new Error("second page"));
  render(<FitnessPanel repository={r} now={now} />);
  await screen.findByRole("alert");
  expect(screen.queryByText("当天暂无预约")).toBeNull();
  expect(screen.queryByRole("article")).toBeNull();
});
it("ignores an older month response and clears state on repository replacement", async () => {
  let resolve!: (value: {
    items: FitnessAppointment[];
    nextCursor: null;
  }) => void;
  const r = repo([]);
  vi.mocked(r.listRange).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = render(<FitnessPanel repository={r} now={now} />);
  await userEvent.click(screen.getByRole("button", { name: "下个月" }));
  await screen.findByText("当天暂无预约");
  await act(async () => resolve({ items: [row], nextCursor: null }));
  expect(screen.queryByText("合成训练")).toBeNull();
  view.rerender(<FitnessPanel repository={undefined} now={now} />);
  expect(screen.queryByText("当天暂无预约")).toBeNull();
  expect(screen.getByText(/暂不可用/)).toBeTruthy();
});
it("blocks duplicate save before a request resolves", async () => {
  const r = repo([]);
  let resolve!: (value: FitnessAppointment) => void;
  vi.mocked(r.create).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await openNew(r);
  const form = screen.getByLabelText("预约编辑");
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(r.create).toHaveBeenCalledOnce();
  await act(async () => resolve(row));
});
it("offers refresh after a stale deletion so the next confirmation uses latest revision", async () => {
  const r = repo();
  vi.mocked(r.softDelete).mockRejectedValueOnce(
    new RepositoryError("conflict", 409, "40001", "changed"),
  );
  render(<FitnessPanel repository={r} now={now} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "删除合成训练" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await screen.findByText(/未删除/);
  await userEvent.click(screen.getByRole("button", { name: "取消" }));
  vi.mocked(r.listRange).mockResolvedValue({
    items: [{ ...row, revision: 2 }],
    nextCursor: null,
  });
  await userEvent.click(screen.getByRole("button", { name: "刷新日历" }));
  await waitFor(() => expect(r.listRange).toHaveBeenCalledTimes(2));
  await userEvent.click(screen.getByRole("button", { name: "删除合成训练" }));
  await userEvent.click(screen.getByRole("button", { name: "确认删除" }));
  expect(vi.mocked(r.softDelete).mock.calls[1][0].expectedRevision).toBe(2);
});
it("preserves an uncertain create key across a later authentication rejection", async () => {
  const r = repo([]);
  vi.mocked(r.create)
    .mockRejectedValueOnce(new Error("response lost"))
    .mockRejectedValueOnce(
      new RepositoryError("unauthorized", 401, "expired", "expired"),
    );
  await openNew(r);
  await userEvent.click(screen.getByRole("button", { name: "保存预约" }));
  await screen.findByText(/未保存/);
  await userEvent.click(screen.getByRole("button", { name: "重试保存" }));
  await screen.findByText(/未保存/);
  await userEvent.click(
    screen.getByRole("button", { name: /重试保存|保存预约/ }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(vi.mocked(r.create).mock.calls[2][0].operationKey).toBe(
    vi.mocked(r.create).mock.calls[0][0].operationKey,
  );
});
it("requires the user to choose times and confirms abandoning changed drafts", async () => {
  const r = repo([]);
  render(<FitnessPanel repository={r} now={now} />);
  await screen.findByText("当天暂无预约");
  await userEvent.click(screen.getByRole("button", { name: "新增预约" }));
  expect((screen.getByLabelText("开始时间") as HTMLInputElement).value).toBe(
    "",
  );
  expect((screen.getByLabelText("结束时间") as HTMLInputElement).value).toBe(
    "",
  );
  fireEvent.change(screen.getByLabelText("健身事件"), {
    target: { value: "未保存训练" },
  });
  await userEvent.click(screen.getByRole("button", { name: "放弃并关闭" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "继续编辑" }));
  expect((screen.getByLabelText("健身事件") as HTMLInputElement).value).toBe(
    "未保存训练",
  );
  await userEvent.click(screen.getByRole("button", { name: "放弃并关闭" }));
  await userEvent.click(screen.getByRole("button", { name: "放弃草稿" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(r.create).not.toHaveBeenCalled();
});
it("warns about overlapping times without blocking an explicit save", async () => {
  const r = repo();
  render(<FitnessPanel repository={r} now={now} />);
  await screen.findByRole("article", { name: "合成训练" });
  await userEvent.click(screen.getByRole("button", { name: "新增预约" }));
  fireEvent.change(screen.getByLabelText("健身事件"), {
    target: { value: "重叠训练" },
  });
  fireEvent.change(screen.getByLabelText("开始时间"), {
    target: { value: "18:45" },
  });
  fireEvent.change(screen.getByLabelText("结束时间"), {
    target: { value: "19:45" },
  });
  expect(await screen.findByText(/与已有预约时间重叠/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "保存预约" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(r.create).toHaveBeenCalledOnce();
});

 it("creates an all-day appointment without clock fields and renders all-day label", async () => {
  const r = repo([]);
  render(<FitnessPanel repository={r} now={now} />);
  await screen.findByText("当天暂无预约");
  await userEvent.click(screen.getByRole("button", { name: "新增预约" }));
  fireEvent.change(screen.getByLabelText("健身事件"), { target: { value: "安排下周训练" } });
  await userEvent.selectOptions(screen.getByLabelText("时间类型"), "all_day");
  expect(screen.queryByLabelText("开始时间")).toBeNull();
  expect(screen.queryByLabelText("结束时间")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "保存预约" }));
  await waitFor(() => expect(r.create).toHaveBeenCalledWith(expect.objectContaining({
    timeKind: "all_day", startAt: "2030-04-30T16:00:00.000Z", endAt: "2030-05-01T16:00:00.000Z"
  })));
});

it("renders and reopens all-day events, and can switch back to timed", async () => {
 const r=createCandidateFitnessRepository(now);
 await r.create({title:"全天联络",timeKind:"all_day",startAt:"2030-04-30T16:00:00.000Z",endAt:"2030-05-01T16:00:00.000Z",operationKey:"synthetic-all-day-ui"});
 render(<FitnessPanel repository={r} now={now}/>);
 await screen.findByRole("button",{name:"编辑全天联络"});
 expect(within(screen.getByRole("region",{name:"当日预约"})).getByText("全天")).toBeTruthy();
 expect(screen.getByText("全天 全天联络")).toBeTruthy();
 await userEvent.click(screen.getByRole("button",{name:"编辑全天联络"}));
 expect((screen.getByLabelText("时间类型") as HTMLSelectElement).value).toBe("all_day");
 expect(screen.queryByLabelText("开始时间")).toBeNull();
 await userEvent.selectOptions(screen.getByLabelText("时间类型"),"timed");
 fireEvent.change(screen.getByLabelText("开始时间"),{target:{value:"12:00"}});
 fireEvent.change(screen.getByLabelText("结束时间"),{target:{value:"13:00"}});
 await userEvent.click(screen.getByRole("button",{name:"保存预约"}));
 expect(await screen.findByText("12:00–13:00")).toBeTruthy();
 expect(within(screen.getByRole("region",{name:"当日预约"})).queryByText("全天")).toBeNull();
});
