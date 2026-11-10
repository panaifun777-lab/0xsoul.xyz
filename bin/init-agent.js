#!/usr/bin/env node
/**
 * 0x.SOUL 远程 MCP 配置助手 / Remote MCP config helper
 *
 * 自动探测本机 MCP 客户端配置目录（Claude Desktop / Cursor / Claude Code），
 * 安全合并注入指向 https://0xsoul.xyz/v1/mcp 的远程端点，无需本地 stdio 安装。
 *
 * Usage:
 *   node init-agent.js                      # auto-detect client
 *   node init-agent.js --client cursor      # claude | cursor | claude-code | all | auto
 *   node init-agent.js --transport stdio    # http (default) | stdio (via mcp-remote)
 *   node init-agent.js --url https://...    # override endpoint
 *   node init-agent.js --name 0xsoul        # server key in mcpServers
 *   node init-agent.js --dry-run            # preview without writing
 *
 * Dependency-free. Works under both CommonJS and ESM (dynamic import below).
 */
(async () => {
  // 动态 import 使本文件在 CJS（下载后任意目录）与 ESM（本仓库 type:module）下均可运行
  const fs = (await import('node:fs')).default;
  const os = (await import('node:os')).default;
  const path = (await import('node:path')).default;

  const HOME = os.homedir();
  const PLATFORM = process.platform;

  const opts = {
    client: 'auto',
    url: 'https://0xsoul.xyz/v1/mcp',
    transport: 'http',
    name: '0xsoul',
    dryRun: false,
  };

  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--client') opts.client = String(argv[++i] || '').toLowerCase();
    else if (a === '--url') opts.url = String(argv[++i] || '');
    else if (a === '--transport') opts.transport = String(argv[++i] || '').toLowerCase();
    else if (a === '--name') opts.name = String(argv[++i] || '0xsoul');
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--help' || a === '-h') return printHelp();
    else { console.error(`Unknown argument: ${a}`); return printHelp(1); }
  }

  if (!/^https?:\/\//i.test(opts.url)) {
    console.error(`✖ --url must be an http(s) URL, got: ${opts.url}`);
    process.exit(1);
  }
  if (!['http', 'stdio'].includes(opts.transport)) {
    console.error(`✖ --transport must be "http" or "stdio", got: ${opts.transport}`);
    process.exit(1);
  }

  const targets = resolveTargets(opts.client);
  if (targets.length === 0) {
    console.error(`✖ Unknown --client "${opts.client}". Use claude | cursor | claude-code | all | auto.`);
    process.exit(1);
  }

  const entry = buildEntry(opts);
  console.log('==========================================================');
  console.log('⚡ 0x.SOUL Remote MCP config helper');
  console.log(`   endpoint : ${opts.url}`);
  console.log(`   transport: ${opts.transport}${opts.transport === 'stdio' ? ' (mcp-remote proxy)' : ' (Streamable HTTP)'}`);
  console.log(`   server   : mcpServers["${opts.name}"]`);
  console.log(`   mode     : ${opts.dryRun ? 'DRY RUN (no writes)' : 'write'}`);
  console.log('==========================================================');

  let wrote = 0;
  for (const t of targets) {
    try {
      const result = applyConfig(t, opts, entry, fs, path);
      console.log(`${result.changed ? '✔' : '•'} [${t.label}] ${t.file}`);
      if (result.backup) console.log(`    backup: ${result.backup}`);
      if (opts.dryRun) {
        console.log('    preview:');
        console.log(indent(JSON.stringify(result.merged, null, 2), '    '));
      }
      if (result.changed && !opts.dryRun) wrote++;
    } catch (e) {
      console.error(`✖ [${t.label}] ${t.file}: ${e.message}`);
    }
  }

  console.log('----------------------------------------------------------');
  if (opts.dryRun) {
    console.log('Dry run complete. Re-run without --dry-run to apply.');
  } else {
    console.log(`Done. Updated ${wrote} config file(s). Restart your MCP client to load the 0x.SOUL tools.`);
    console.log('Verify: ask your agent to call tools/list, or run gang_tokens.');
  }

  function printHelp(code = 0) {
    console.log(`0x.SOUL Remote MCP config helper

Usage: node init-agent.js [options]

Options:
  --client <name>     claude | cursor | claude-code | all | auto (default: auto)
  --url <url>         MCP endpoint (default: https://0xsoul.xyz/v1/mcp)
  --transport <mode>  http (default, Streamable HTTP) | stdio (mcp-remote proxy)
  --name <key>        mcpServers key (default: 0xsoul)
  --dry-run           Preview merged config without writing
  -h, --help          Show this help
`);
    if (code) process.exit(code);
  }

  function resolveTargets(client) {
    const claude = {
      label: 'Claude Desktop',
      file: claudeDesktopPath(),
    };
    const cursor = {
      label: 'Cursor',
      file: path.join(HOME, '.cursor', 'mcp.json'),
    };
    const claudeCode = {
      label: 'Claude Code',
      file: path.join(HOME, '.claude.json'),
    };
    const all = [claude, cursor, claudeCode];
    if (client === 'all') return all;
    if (client === 'claude') return [claude];
    if (client === 'cursor') return [cursor];
    if (client === 'claude-code' || client === 'claudecode') return [claudeCode];
    if (client === 'auto') {
      const existing = all.filter((t) => fs.existsSync(t.file) || fs.existsSync(path.dirname(t.file)));
      return existing.length ? [existing[0]] : [claude];
    }
    return [];
  }

  function claudeDesktopPath() {
    if (PLATFORM === 'win32') {
      const appData = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
      return path.join(appData, 'Claude', 'claude_desktop_config.json');
    }
    if (PLATFORM === 'darwin') {
      return path.join(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    }
    return path.join(HOME, '.config', 'Claude', 'claude_desktop_config.json');
  }

  function buildEntry(o) {
    if (o.transport === 'stdio') {
      return { command: 'npx', args: ['-y', 'mcp-remote', o.url] };
    }
    return { url: o.url };
  }

  function applyConfig(target, o, entry, fsMod, pathMod) {
    const file = target.file;
    let existing = {};
    let backup = null;
    if (fsMod.existsSync(file)) {
      const raw = fsMod.readFileSync(file, 'utf8');
      try {
        existing = raw.trim() ? JSON.parse(raw) : {};
      } catch {
        throw new Error('existing config is not valid JSON; refusing to overwrite. Fix or move it aside first.');
      }
      if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) {
        throw new Error('existing config root is not a JSON object; refusing to overwrite.');
      }
    }
    const merged = { ...existing };
    if (typeof merged.mcpServers !== 'object' || merged.mcpServers === null || Array.isArray(merged.mcpServers)) {
      merged.mcpServers = {};
    } else {
      merged.mcpServers = { ...merged.mcpServers };
    }
    const prev = merged.mcpServers[o.name];
    const changed = JSON.stringify(prev) !== JSON.stringify(entry);
    merged.mcpServers[o.name] = entry;

    if (!o.dryRun && changed) {
      fsMod.mkdirSync(pathMod.dirname(file), { recursive: true });
      if (fsMod.existsSync(file)) {
        backup = `${file}.bak-${Date.now()}`;
        fsMod.copyFileSync(file, backup);
      }
      fsMod.writeFileSync(file, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    }
    return { merged, changed: changed || !fsMod.existsSync(file), backup };
  }

  function indent(text, pad) {
    return text.split('\n').map((l) => pad + l).join('\n');
  }
})().catch((e) => {
  console.error(`✖ ${e && e.message ? e.message : e}`);
  process.exit(1);
});