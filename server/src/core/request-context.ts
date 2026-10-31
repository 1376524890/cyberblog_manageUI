import { AsyncLocalStorage } from "node:async_hooks";
import type { Identity } from "./auth.ts";
export const requestIdentity = new AsyncLocalStorage<Identity>();
export const actorKey = (user = requestIdentity.getStore()) =>
  user ? `${user.role}:${user.userId ?? user.username}` : "system";
