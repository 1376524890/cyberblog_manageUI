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
import { quotaFor } from "../ai/quota.ts";
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
