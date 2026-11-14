/**
 * Remote MCP federation — lets our hosted /v1/mcp endpoint surface tools from
 * upstream remote MCP servers (e.g. MoonLauncher) under namespaced prefixes.
 *
 * Why this exists: our gateway only served its own local `gang_*` tools. To let
 * agents connected to 0x.SOUL also call an external hosted MCP server, we act as
 * an MCP *client* to that upstream and re-expose its tools/calls. Mounting is
 * config-gated (FEDERATE_REMOTE_MCP) so production behaviour is unchanged unless
 * explicitly enabled.
 *
 * Transport: MCP Streamable HTTP (JSON-RPC 2.0 over POST). A browser-like UA is
 * required because MoonLauncher sits behind Cloudflare bot management that blocks
 * default client signatures (verified: urllib/curl-without-UA -> 403).
 */

export interface RemoteMcpUpstream {
  id: string; // logical id, e.g. "moonlauncher"
  url: string; // streamable HTTP endpoint, e.g. "https://moonlauncher.app/mcp"
  prefix: string; // tool/prompt name prefix, e.g. "ml_"
}

interface CachedTool {
  prefixedName: string;
  def: any; // original tool definition (keeps original `name` for call remapping)
  upstream: RemoteMcpUpstream;
}

interface CachedPrompt {
  prefixedName: string;
  def: any;
  upstream: RemoteMcpUpstream;
}

// Required to pass MoonLauncher's Cloudflare browser-signature check.
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Origin: 'https://moonlauncher.app',
  Accept: 'application/json, text/event-stream',
};

export class RemoteMcpFederation {
  private upstreams: RemoteMcpUpstream[];
  private tools = new Map<string, CachedTool>();
  private prompts = new Map<string, CachedPrompt>();
  private sessions = new Map<string, string>(); // upstream.url -> Mcp-Session-Id
  private refreshingPromise: Promise<void> | null = null;

  constructor(upstreams: RemoteMcpUpstream[]) {
    this.upstreams = upstreams;
  }

  isEnabled(): boolean {
    return this.upstreams.length > 0;
  }

  prefixOf(name: string): string | null {
    for (const up of this.upstreams) {
      if (name.startsWith(up.prefix)) return up.prefix;
    }
    return null;
  }

  async refresh(): Promise<void> {
    // Share a single in-flight refresh so concurrent callers (e.g. the
    // constructor's auto-refresh + an explicit await) wait on the same result
    // instead of the second caller silently no-op'ing.
    if (this.refreshingPromise) return this.refreshingPromise;
    this.refreshingPromise = (async () => {
      try {
        for (const up of this.upstreams) {
          try {
            await this.refreshOne(up);
          } catch (e: any) {
            console.warn(`[federation] upstream "${up.id}" refresh failed: ${e?.message ?? e}`);
          }
        }
      } finally {
        this.refreshingPromise = null;
      }
    })();
    return this.refreshingPromise;
  }

  private async refreshOne(up: RemoteMcpUpstream): Promise<void> {
    const sid = await this.initialize(up);
    if (sid) this.sessions.set(up.url, sid);
    const toolsResp = await this.rpc(up, 'tools/list', {}, sid);
    const promptsResp = await this.rpc(up, 'prompts/list', {}, sid);
    const tools = (toolsResp?.result?.tools ?? []) as any[];
    const prompts = (promptsResp?.result?.prompts ?? []) as any[];
    for (const t of tools) {
      const prefixed = up.prefix + t.name;
      this.tools.set(prefixed, { prefixedName: prefixed, def: t, upstream: up });
    }
    for (const p of prompts) {
      const prefixed = up.prefix + p.name;
      this.prompts.set(prefixed, { prefixedName: prefixed, def: p, upstream: up });
    }
    console.log(`[federation] "${up.id}": ${tools.length} tools, ${prompts.length} prompts`);
  }

  private async initialize(up: RemoteMcpUpstream): Promise<string | undefined> {
    const resp = await this.rawPost(up, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: '0xsoul-gateway', version: '1.0.0' },
      },
    });
    // Best-effort initialized notification (some servers require it before calls).
    await this.rawPost(
      up,
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      resp.sid,
      true,
    ).catch(() => {});
    return resp.sid;
  }

  private async rpc(up: RemoteMcpUpstream, method: string, params: any, sid?: string): Promise<any> {
    const resp = await this.rawPost(
      up,
      { jsonrpc: '2.0', id: Date.now(), method, params },
      sid,
    );
    return resp.body;
  }

  private async rawPost(
    up: RemoteMcpUpstream,
    payload: any,
    sid?: string,
    isNotification = false,
  ): Promise<{ body: any; sid?: string }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...BROWSER_HEADERS,
    };
    if (sid) headers['Mcp-Session-Id'] = sid;
    const res = await fetch(up.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const newSid = res.headers.get('mcp-session-id') ?? sid ?? undefined;
    const ct = res.headers.get('content-type') ?? '';
    const text = await res.text();
    let body: any = {};
    if (ct.includes('text/event-stream')) {
      for (const line of text.split('\n')) {
        const s = line.trim();
        if (s.startsWith('data:')) {
          const json = s.slice(5).trim();
          try {
            body = JSON.parse(json);
          } catch {
            /* ignore keep-alive / non-JSON lines */
          }
        }
      }
    } else if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        /* ignore */
      }
    }
    if (!res.ok && !isNotification) {
      throw new Error(`upstream "${up.id}" HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return { body, sid: newSid };
  }

  getTools(): any[] {
    return [...this.tools.values()].map((c) => ({ ...c.def, name: c.prefixedName }));
  }

  getPrompts(): any[] {
    return [...this.prompts.values()].map((c) => ({ ...c.def, name: c.prefixedName }));
  }

  async callTool(name: string, args: any): Promise<any> {
    const cached = this.tools.get(name);
    if (!cached) throw new Error(`unknown upstream tool: ${name}`);
    const sid = this.sessions.get(cached.upstream.url);
    const resp = await this.rpc(
      cached.upstream,
      'tools/call',
      { name: cached.def.name, arguments: args ?? {} },
      sid,
    );
    if (resp?.error) throw new Error(resp.error.message ?? 'upstream error');
    return resp?.result ?? { content: [] };
  }

  async getPrompt(name: string, args: any): Promise<any> {
    const cached = this.prompts.get(name);
    if (!cached) throw new Error(`unknown upstream prompt: ${name}`);
    const sid = this.sessions.get(cached.upstream.url);
    const resp = await this.rpc(
      cached.upstream,
      'prompts/get',
      { name: cached.def.name, arguments: args ?? {} },
      sid,
    );
    if (resp?.error) throw new Error(resp.error.message ?? 'upstream error');
    return resp?.result ?? {};
  }
}
