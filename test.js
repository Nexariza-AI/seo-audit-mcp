// End-to-end test: start the server over stdio and call every tool. node test.js [url]
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const url = process.argv[2] || 'https://nexariza.com/'
const client = new Client({ name: 'seo-audit-mcp-test', version: '0.1.0' })
await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL('./index.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')] }))

const { tools } = await client.listTools()
console.log('tools:', tools.map((t) => t.name).join(', '))

const show = (r) => JSON.parse(r.content[0].text)
const audit = show(await client.callTool({ name: 'audit_page', arguments: { url } }))
console.log('audit_page:', JSON.stringify({ status: audit.status, title: audit.title, h1: audit.headings?.h1, jsonLd: audit.structuredData?.length, words: audit.wordCount, issues: audit.issues }, null, 1))
const links = show(await client.callTool({ name: 'check_links', arguments: { url, limit: 25 } }))
console.log('check_links:', JSON.stringify({ checked: links.checked, broken: links.broken.length, redirected: links.redirected.length }))
const files = show(await client.callTool({ name: 'check_site_files', arguments: { site: url } }))
console.log('check_site_files:', JSON.stringify(files, null, 1).slice(0, 900))
await client.close()
