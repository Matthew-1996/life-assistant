// @vitest-environment jsdom
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@supabase/supabase-js";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { FitnessRepository } from "../../src/supabase/fitness";
import { FitnessPanel } from "../../src/features/fitness/FitnessPanel";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("connects calendar CRUD through the real repository and SQL RPCs in a synthetic database", async () => {
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("File", NodeFile);
  const db = new PGlite();
  try {
    await db.exec(
      await readFile("tests/supabase/fixtures/auth-shim.sql", "utf8"),
    );
    await db.exec(
      await readFile("supabase/migrations/0001_life_console.sql", "utf8"),
    );
    const dir = "supabase/migrations/";
    const name = (await readdir(dir)).find((n) =>
      n.endsWith("_fitness_appointments.sql"),
    )!;
    await db.exec(await readFile(dir + name, "utf8"));
    const owner = "11111111-1111-4111-8111-111111111111";
    await db.exec(
      `insert into auth.users(id) values ('${owner}');insert into life_console_private.fitness_owners(user_id) values ('${owner}');set request.jwt.claim.sub='${owner}';set role authenticated;`,
    );
    const signature: Record<string, string[]> = {
      list_fitness_appointments: [
        "p_from",
        "p_to",
        "p_cursor_start",
        "p_cursor_id",
      ],
      get_fitness_appointment: ["p_id"],
      create_fitness_appointment: [
        "p_operation_key",
        "p_title",
        "p_start_at",
        "p_end_at",
        "p_location",
        "p_notes",
      ],
      update_fitness_appointment: [
        "p_id",
        "p_expected_revision",
        "p_title",
        "p_start_at",
        "p_end_at",
        "p_location",
        "p_notes",
      ],
      soft_delete_fitness_appointment: ["p_id", "p_expected_revision"],
    };
    const client = createClient(
      "https://fitness-integration.invalid",
      "synthetic-public-key",
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: async (url, options) => {
            const fn = new URL(String(url)).pathname.split("/").at(-1)!;
            const keys = signature[fn];
            if (!keys) throw Error("Unexpected RPC");
            const args = JSON.parse(String(options?.body));
            try {
              const { rows } = await db.query(
                `select * from public.${fn}(${keys.map((_, i) => `$${i + 1}`).join(",")})`,
                keys.map((k) => args[k]),
              );
              return new Response(JSON.stringify(rows), {
                status: 200,
                headers: { "content-type": "application/json" },
              });
            } catch (e) {
              return new Response(
                JSON.stringify({
                  code: (e as { code: string }).code,
                  message: "Synthetic RPC failure",
                }),
                {
                  status: 409,
                  headers: { "content-type": "application/json" },
                },
              );
            }
          },
        },
      },
    );
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
    render(
      <FitnessPanel
        repository={new FitnessRepository(client)}
        now={new Date("2030-05-01T00:00Z")}
      />,
    );
    await screen.findByText("当天暂无预约");
    await userEvent.click(screen.getByRole("button", { name: "新增预约" }));
    fireEvent.change(screen.getByLabelText("健身事件"), {
      target: { value: "合成端到端预约" },
    });
    fireEvent.change(screen.getByLabelText("开始时间"), {
      target: { value: "18:30" },
    });
    fireEvent.change(screen.getByLabelText("结束时间"), {
      target: { value: "19:30" },
    });
    await userEvent.click(screen.getByRole("button", { name: "保存预约" }));
    await screen.findByRole("article", { name: "合成端到端预约" });
    await userEvent.click(
      screen.getByRole("button", { name: "编辑合成端到端预约" }),
    );
    fireEvent.change(screen.getByLabelText("预约日期"), {
      target: { value: "2030-06-02" },
    });
    await userEvent.click(screen.getByRole("button", { name: "保存预约" }));
    await screen.findByRole("heading", { name: "2030 年 6 月" });
    const result = await db.query<{ revision: number; start_at: Date }>(
      "select revision,start_at from public.fitness_appointments",
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].revision).toBe(2);
    expect(result.rows[0].start_at.toISOString()).toBe(
      "2030-06-02T10:30:00.000Z",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "删除合成端到端预约" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await screen.findByText("当天暂无预约");
    const deleted = await db.query<{ revision: number; deleted_at: Date }>(
      "select revision,deleted_at from public.fitness_appointments",
    );
    expect(deleted.rows[0].revision).toBe(3);
    expect(deleted.rows[0].deleted_at).not.toBeNull();
  } finally {
    cleanup();
    await db.close();
  }
}, 15000);
