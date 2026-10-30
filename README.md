# seo-audit-mcp

An [MCP](https://modelcontextprotocol.io) server that lets AI assistants (Claude, ChatGPT, Cursor, Windsurf and any MCP client) **audit web pages for technical SEO and AI-search readiness**.

Ask your assistant things like:

- "Audit https://example.com/pricing and tell me what to fix first."
- "Check every link on our homepage."
- "Is our site blocking AI crawlers, and do we have a sitemap and llms.txt?"

It is read-only: it only sends GET/HEAD requests to the URLs you give it. No API keys, no accounts.

## Tools

| Tool | What it returns |
|---|---|
| `audit_page` | Status, response time, title and meta description (with lengths), H1/H2s, canonical, robots meta, `lang`, viewport, hreflang, Open Graph tags, JSON-LD types and validity, images without alt text, internal/external link counts, word count in the HTML, and a prioritised issue list (high / medium / low). |
| `check_links` | HTTP status of up to 200 links on a page: broken (4xx/5xx/unreachable), redirected and slow links. |
| `check_site_files` | `robots.txt` (sitemaps declared, AI crawlers blocked: GPTBot, ClaudeBot, PerplexityBot, Google-Extended…), sitemap URL count and a status sample, and whether `/llms.txt` exists. |

## Install

Requires Node.js 18+.

**Claude Code**

```bash
claude mcp add seo-audit -- npx -y github:Nexariza-AI/seo-audit-mcp
```

**Claude Desktop, Cursor, Windsurf** (add to the MCP config file)

```json
{
  "mcpServers": {
    "seo-audit": {
      "command": "npx",
      "args": ["-y", "github:Nexariza-AI/seo-audit-mcp"]
    }
  }
}
```

**From source**

```bash
git clone https://github.com/Nexariza-AI/seo-audit-mcp.git
cd seo-audit-mcp && npm install && npm test
```

## Notes

- Pages that render entirely with JavaScript show little HTML to crawlers that don't run scripts; `audit_page` flags this as thin content so you can add server-side or prerendered HTML.
- Some sites (LinkedIn, Cloudflare-protected pages) refuse automated requests with 403 or 999. `check_links` lists them, but open them in a browser before treating them as broken.

## About

Built and maintained by [Nexariza AI](https://nexariza.com), an AI and software development company in Lahore, Pakistan. We build production [MCP servers](https://nexariza.com/services/mcp-server-development) that connect Claude, ChatGPT and AI agents to CRMs, ERPs and databases, with OAuth, permissions and audit logs. New to MCP? Read [What is an MCP server?](https://nexariza.com/blog/what-is-an-mcp-server)

Issues and pull requests are welcome.

## License

MIT
