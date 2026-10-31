import { Hono } from "hono";
import { z } from "zod";
import { bodyLimit } from "hono/body-limit";
import {
  accountOverview,
  createInvites,
  revokeInvite,
  setAccountActive,
} from "../core/accounts.ts";
import { identityOf } from "../middleware.ts";
import { ApiError } from "../core/errors.ts";
import { quotaFor, setUserLimit, resetUserQuota } from "../ai/quota.ts";
function targetIdentity(id: string) {
  const user = accountOverview().users.find((u) => u.id === id);
  if (!user) throw new ApiError(404, "NOT_FOUND", "账号不存在");
  return {
    username: user.username,
    role: user.role as "admin" | "creator",
    ...(user.builtin ? {} : { userId: user.id }),
  };
}
export const accountRoutes = new Hono()
  .use("*", async (c, next) => {
    if (identityOf(c).role !== "admin")
      throw new ApiError(403, "FORBIDDEN", "账号与邀请码仅限管理员管理");
    await next();
  })
  .use(
    "*",
    bodyLimit({
      maxSize: 16384,
      onError: (c) =>
        c.json({ error: { code: "BODY_LIMIT", message: "请求过长" } }, 413),
    }),
  )
  .get("/accounts", async (c) => {
    const overview = accountOverview();
    const users = await Promise.all(
      overview.users.map(async (u) => ({
        ...u,
        quota: await quotaFor({
          username: u.username,
          role: u.role as "admin" | "creator",
          ...(u.builtin ? {} : { userId: u.id }),
        }),
      })),
    );
    return c.json({ ...overview, users });
  })
  .post("/invites", async (c) =>
    c.json(
      {
        items: await createInvites(await c.req.json(), identityOf(c).username),
      },
      201,
    ),
  )
  .post("/invites/:id/revoke", async (c) =>
    c.json(await revokeInvite(c.req.param("id"))),
  )
  .put("/users/:id/quota", async (c) => {
    const parsed = z
      .object({ limit: z.number().int().min(0).max(1_000_000_000).nullable() })
      .strict()
      .safeParse(await c.req.json());
    if (!parsed.success)
      throw new ApiError(
        422,
        "VALIDATION_FAILED",
        "每日额度需为 0–10 亿整数，或恢复默认",
      );
    return c.json(
      await setUserLimit(
        targetIdentity(c.req.param("id")),
        parsed.data.limit,
        identityOf(c),
      ),
    );
  })
  .post("/users/:id/quota/reset", async (c) =>
    c.json(
      await resetUserQuota(targetIdentity(c.req.param("id")), identityOf(c)),
    ),
  )
  .put("/users/:id", async (c) => {
    const parsed = z
      .object({ active: z.boolean() })
      .strict()
      .safeParse(await c.req.json());
    if (!parsed.success)
      throw new ApiError(422, "VALIDATION_FAILED", "请指定账号是否启用");
    return c.json(
      await setAccountActive(c.req.param("id"), parsed.data.active),
    );
  });
