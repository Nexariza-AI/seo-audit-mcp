#!/usr/bin/env node
/**
 * seo-audit-mcp — an MCP server that lets AI assistants (Claude, ChatGPT, Cursor, …) audit
 * any public web page for technical SEO and AI-search readiness.
 *
 * Tools
 *   audit_page        title, meta, headings, canonical, robots, Open Graph, JSON-LD, images,
 *                     links, word count and a prioritised list of issues for one URL
 *   check_links       status of every link on a page (broken, redirected, slow)
 *   check_site_files  robots.txt, sitemap.xml and llms.txt for a whole site
 *
 * Read-only: it only sends GET/HEAD requests to the URLs you give it.
 * Built and maintained by Nexariza AI — https://nexariza.com
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { parse } from 'node-html-parser'

const UA = 'Mozilla/5.0 (compatible; seo-audit-mcp/0.1; +https://github.com/Nexariza-AI/seo-audit-mcp)'
const TIMEOUT_MS = 15000

async function get(url, { method = 'GET', redirect = 'follow' } = {}) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  const started = Date.now()
  try {
    const res = await fetch(url, { method, redirect, signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*' } })
    const body = method === 'HEAD' ? '' : await res.text()
    return { ok: true, status: res.status, url: res.url, redirected: res.redirected, headers: res.headers, body, ms: Date.now() - started }
  } catch (e) {
    return { ok: false, status: 0, url, error: e.name === 'AbortError' ? `timeout after ${TIMEOUT_MS} ms` : e.message, ms: Date.now() - started }
  } finally {
    clearTimeout(t)
  }
}

const text = (s = '') => s.replace(/\s+/g, ' ').trim()
const asResult = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] })

function auditHtml(pageUrl, html, res) {
  const root = parse(html, { comment: false })
  const head = root.querySelector('head') || root
  const meta = (sel, attr = 'content') => head.querySelector(sel)?.getAttribute(attr) || ''
  const title = text(root.querySelector('title')?.text || '')
  const description = meta('meta[name="description"]')
  const canonical = meta('link[rel="canonical"]', 'href')
  const robots = meta('meta[name="robots"]')
  const lang = root.querySelector('html')?.getAttribute('lang') || ''
  const viewport = meta('meta[name="viewport"]')
  const og = Object.fromEntries(['og:title', 'og:description', 'og:image', 'og:url', 'og:type'].map((p) => [p, meta(`meta[property="${p}"]`)]))
  const hreflang = head.querySelectorAll('link[rel="alternate"][hreflang]').map((l) => ({ lang: l.getAttribute('hreflang'), href: l.getAttribute('href') }))

  const headings = ['h1', 'h2', 'h3'].reduce((o, h) => ({ ...o, [h]: root.querySelectorAll(h).map((e) => text(e.text)).filter(Boolean) }), {})

  const jsonLd = root.querySelectorAll('script[type="application/ld+json"]').map((s) => {
    try {
      const data = JSON.parse(s.text)
      const types = []
      const walk = (n) => {
        if (Array.isArray(n)) return n.forEach(walk)
        if (n && typeof n === 'object') {
          if (n['@type']) types.push(...[].concat(n['@type']))
          Object.values(n).forEach(walk)
        }
      }
      walk(data)
      return { valid: true, types: [...new Set(types)] }
    } catch (e) {
      return { valid: false, error: e.message }
    }
  })

  const images = root.querySelectorAll('img')
  const missingAlt = images.filter((i) => !i.hasAttribute('alt')).map((i) => i.getAttribute('src')).slice(0, 10)

  const base = new URL(res.url || pageUrl)
  const links = root.querySelectorAll('a[href]').map((a) => a.getAttribute('href')).filter((h) => h && !/^(#|mailto:|tel:|javascript:)/i.test(h))
  let internal = 0
  let external = 0
  for (const h of links) {
    try { new URL(h, base).host === base.host ? internal++ : external++ } catch {}
  }
  const bodyText = text((root.querySelector('main') || root.querySelector('body') || root).text)
  const words = bodyText ? bodyText.split(' ').length : 0

  const issues = []
  const add = (severity, message) => issues.push({ severity, message })
  if (res.status !== 200) add('high', `HTTP status ${res.status}`)
  if (!title) add('high', 'Missing <title>')
  else if (title.length > 60) add('medium', `Title is ${title.length} characters (search results show about 50–60)`)
  else if (title.length < 25) add('low', `Title is short (${title.length} characters); add the main keyword and brand`)
  if (!description) add('high', 'Missing meta description')
  else if (description.length > 160) add('low', `Meta description is ${description.length} characters (about 150–160 are shown)`)
  else if (description.length < 70) add('low', `Meta description is short (${description.length} characters)`)
  if (headings.h1.length === 0) add('high', 'No <h1> in the HTML (if the page renders client-side, crawlers that skip JavaScript see none)')
  if (headings.h1.length > 1) add('medium', `${headings.h1.length} <h1> elements; use one`)
  if (!canonical) add('medium', 'No canonical URL')
  else if (new URL(canonical, base).href.replace(/\/$/, '') !== base.href.replace(/\/$/, '').split('#')[0].split('?')[0]) add('low', `Canonical points elsewhere: ${canonical}`)
  if (/noindex/i.test(robots)) add('high', `robots meta contains noindex (${robots})`)
  if (!lang) add('low', 'No lang attribute on <html>')
  if (!viewport) add('medium', 'No viewport meta (mobile rendering)')
  if (!og['og:title'] || !og['og:image']) add('low', 'Incomplete Open Graph tags (og:title / og:image) for link previews')
  if (jsonLd.length === 0) add('medium', 'No JSON-LD structured data (Organization, Service, Article, FAQPage, …) for rich results and AI answers')
  jsonLd.filter((j) => !j.valid).forEach((j) => add('high', `Invalid JSON-LD: ${j.error}`))
  if (missingAlt.length) add('low', `${missingAlt.length}+ images without alt text`)
  if (words < 300) add('medium', `Thin content in the HTML: about ${words} words (pages that render with JavaScript may look empty to some crawlers and AI bots)`)
  if (res.ms > 2000) add('medium', `Slow server response: ${res.ms} ms`)

  const order = { high: 0, medium: 1, low: 2 }
  issues.sort((a, b) => order[a.severity] - order[b.severity])

  return {
    url: pageUrl,
    finalUrl: res.url,
    status: res.status,
    responseMs: res.ms,
    title: { text: title, length: title.length },
    metaDescription: { text: description, length: description.length },
    canonical, robots, lang, viewport: Boolean(viewport), hreflang,
    headings: { h1: headings.h1, h2Count: headings.h2.length, h3Count: headings.h3.length, h2: headings.h2.slice(0, 15) },
    openGraph: og,
    structuredData: jsonLd,
    images: { total: images.length, missingAlt },
    links: { internal, external },
    wordCount: words,
    issues,
  }
}

const server = new McpServer({ name: 'seo-audit-mcp', version: '0.1.0' })

server.registerTool(
  'audit_page',
  {
    title: 'Audit a web page',
    description: 'Technical SEO and AI-search readiness audit of one public URL: title, meta description, headings, canonical, robots, Open Graph, JSON-LD structured data, images, links, word count and a prioritised issue list.',
    inputSchema: { url: z.string().url().describe('The full URL to audit, e.g. https://example.com/pricing') },
  },
  async ({ url }) => {
    const res = await get(url)
    if (!res.ok) return asResult({ url, error: res.error })
    const type = res.headers.get('content-type') || ''
    if (!/html/i.test(type)) return asResult({ url, status: res.status, error: `Not an HTML page (content-type: ${type})` })
    return asResult(auditHtml(url, res.body, res))
  },
)

server.registerTool(
  'check_links',
  {
    title: 'Check the links on a page',
    description: 'Fetches a page and checks the HTTP status of its links. Reports broken (4xx/5xx/unreachable), redirected and slow links.',
    inputSchema: {
      url: z.string().url().describe('The page whose links to check'),
      limit: z.number().int().min(1).max(200).optional().describe('Maximum links to check (default 60)'),
      externalOnly: z.boolean().optional().describe('Only check links to other sites'),
    },
  },
  async ({ url, limit = 60, externalOnly = false }) => {
    const res = await get(url)
    if (!res.ok) return asResult({ url, error: res.error })
    const base = new URL(res.url)
    const root = parse(res.body)
    const all = [...new Set(root.querySelectorAll('a[href]').map((a) => a.getAttribute('href')).filter((h) => h && !/^(#|mailto:|tel:|javascript:)/i.test(h)).map((h) => { try { return new URL(h, base).href.split('#')[0] } catch { return null } }).filter(Boolean))]
    const targets = all.filter((h) => !externalOnly || new URL(h).host !== base.host).slice(0, limit)
    const results = []
    const queue = [...targets]
    await Promise.all(Array.from({ length: 6 }, async () => {
      for (let h = queue.shift(); h; h = queue.shift()) {
        let r = await get(h, { method: 'HEAD', redirect: 'manual' })
        if (r.ok && (r.status === 405 || r.status === 403)) r = await get(h, { redirect: 'manual' })
        results.push({ href: h, status: r.status, ms: r.ms, location: r.ok ? r.headers.get('location') : undefined, error: r.error })
      }
    }))
    const broken = results.filter((r) => r.status === 0 || r.status >= 400)
    const redirected = results.filter((r) => r.status >= 300 && r.status < 400)
    const slow = results.filter((r) => r.ms > 3000 && r.status < 400)
    return asResult({ url, checked: results.length, totalLinksOnPage: all.length, broken, redirected, slow, note: 'Some sites (e.g. LinkedIn, Cloudflare-protected pages) refuse automated requests with 403/999; open those manually before treating them as broken.' })
  },
)

server.registerTool(
  'check_site_files',
  {
    title: 'Check robots.txt, sitemap and llms.txt',
    description: 'For a site origin: reads robots.txt (and which AI crawlers it blocks), finds and counts sitemap URLs, samples a few for status, and checks for /llms.txt used by AI assistants.',
    inputSchema: { site: z.string().url().describe('The site origin, e.g. https://example.com') },
  },
  async ({ site }) => {
    const origin = new URL(site).origin
    const robots = await get(`${origin}/robots.txt`)
    const robotsText = robots.ok && robots.status === 200 ? robots.body : ''
    const sitemapRefs = [...robotsText.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1])
    const aiBots = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'CCBot', 'Bytespider']
    const blocked = aiBots.filter((b) => new RegExp(`user-agent:\\s*${b}[\\s\\S]*?disallow:\\s*/\\s*$`, 'im').test(robotsText))
    const sitemapUrl = sitemapRefs[0] || `${origin}/sitemap.xml`
    const sm = await get(sitemapUrl)
    const locs = sm.ok && sm.status === 200 ? [...sm.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]) : []
    const isIndex = sm.ok && /<sitemapindex/i.test(sm.body || '')
    const sample = locs.slice(0, 10)
    const sampled = await Promise.all(sample.map(async (u) => { const r = await get(u, { method: 'HEAD', redirect: 'manual' }); return { url: u, status: r.status } }))
    const llms = await get(`${origin}/llms.txt`)
    return asResult({
      origin,
      robotsTxt: { status: robots.status, sitemaps: sitemapRefs, blocksAiCrawlers: blocked },
      sitemap: { url: sitemapUrl, status: sm.status, isSitemapIndex: isIndex, urlCount: locs.length, sampleStatuses: sampled },
      llmsTxt: { status: llms.status, present: llms.ok && llms.status === 200 && !/<html/i.test(llms.body || '') },
    })
  },
)

await server.connect(new StdioServerTransport())
