import fs from "node:fs/promises";
import { config } from "../config.ts";
import { ApiError } from "./errors.ts";
export function checkFreeSpace(
  available: number,
  required: number,
  reserve = 1024 * 1024 * 1024,
) {
  if (
    !Number.isFinite(available) ||
    available < reserve + Math.max(0, required) * 2
  )
    throw new ApiError(
      507,
      "DISK_SPACE_LOW",
      "服务器剩余空间不足，已停止写入以保护现有内容。请查看自动清理记录或释放空间后重试。",
    );
}
export async function assertDiskSpace(
  required = 0,
  directory = config.repoPath,
) {
  const stats = await fs.statfs(directory);
  const configured = Number(process.env.CMS_MIN_FREE_MB ?? 1024);
  const reserve =
    Number.isFinite(configured) && configured >= 64
      ? configured * 1024 * 1024
      : 1024 * 1024 * 1024;
  checkFreeSpace(Number(stats.bavail) * Number(stats.bsize), required, reserve);
}
