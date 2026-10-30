import { Hono } from "hono";
import { status, publish } from "../core/publisher.ts";

export const gitRoutes = new Hono()
	// GET /git/status
	.get("/status", async (c) => c.json(await status()))
	// POST /publish
	.post("/", async (c) => {
		const result = await publish();
		return c.json({ ok: true, ...result, cloudflareBuildUrl: null });
	});
