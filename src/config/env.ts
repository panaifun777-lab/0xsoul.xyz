/**
 * 零依赖 .env 加载器
 *
 * ## 为什么需要它
 *
 * `tsx src/server_main.ts` / `node dist/server_main.js` 默认**不会**读取 `.env`。
 * 若依赖调用方手动加 `--env-file` 参数，很容易漏掉，导致收款地址、RPC 端点等
 * 关键配置静默失效（表现为"手续费记了账但不知道打给谁"）。
 *
 * 本模块在任何入口文件的最顶部被 import，确保配置一定生效。
 *
 * ## 规则
 *
 * - 已存在的环境变量**优先**（便于容器/CI 用真实环境变量覆盖文件）
 * - 支持 `#` 注释、空行、`KEY=VALUE`、单双引号包裹
 * - 不覆盖已注入的值，避免覆盖生产环境密钥管理系统的注入
 */

import fs from 'fs';
import path from 'path';

let loaded = false;

/** 解析单行 `KEY=VALUE` */
function parseLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const eq = trimmed.indexOf('=');
  if (eq <= 0) return null;

  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();

  // 去掉成对引号
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  return [key, value];
}

/**
 * 加载 `.env`（幂等，重复调用无副作用）。
 *
 * @param explicitPath 指定文件路径；默认在当前工作目录查找 `.env`
 */
export function loadEnv(explicitPath?: string): { loaded: boolean; path?: string; count: number } {
  if (loaded && !explicitPath) return { loaded: false, count: 0 };

  const candidates = explicitPath
    ? [explicitPath]
    : [
        path.join(process.cwd(), '.env'),
        path.join(process.cwd(), '.env.local'),
      ];

  let count = 0;
  let usedPath: string | undefined;

  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const parsed = parseLine(line);
        if (!parsed) continue;
        const [key, value] = parsed;
        // 已存在的变量优先：不覆盖容器/CI 注入的真实值
        if (process.env[key] === undefined || process.env[key] === '') {
          process.env[key] = value;
          count++;
        }
      }
      usedPath = file;
      break;
    } catch (err) {
      console.warn(`[env] 读取 ${file} 失败:`, (err as Error).message);
    }
  }

  loaded = true;
  return { loaded: Boolean(usedPath), path: usedPath, count };
}

/** 校验关键环境变量是否就绪，返回缺失项 */
export function checkRequiredEnv(keys: string[]): { ok: boolean; missing: string[] } {
  const missing = keys.filter((k) => !process.env[k]);
  return { ok: missing.length === 0, missing };
}
