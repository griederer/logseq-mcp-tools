#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { v4 as uuidv4 } from 'uuid'

const server = new McpServer({
	name: 'Logseq Complete MCP',
	version: '3.0.0',
})

// Default Logseq directories to check
const POSSIBLE_LOGSEQ_PATHS = [
	'/Users/gonzaloriederer/logseq-graph',
	path.join(os.homedir(), 'Documents', 'logseq'),
	path.join(os.homedir(), 'logseq'),
	path.join(os.homedir(), 'Logseq'),
	path.join(os.homedir(), 'Documents', 'Logseq'),
]

// Find Logseq directory
function findLogseqDirectory(): string | null {
	for (const possiblePath of POSSIBLE_LOGSEQ_PATHS) {
		try {
			if (fs.existsSync(possiblePath)) {
				const pagesDir = path.join(possiblePath, 'pages')
				const journalsDir = path.join(possiblePath, 'journals')
				if (fs.existsSync(pagesDir) || fs.existsSync(journalsDir)) {
					return possiblePath
				}
			}
		} catch (error) {
			// Continue to next path
		}
	}
	return null
}

const LOGSEQ_PATH = findLogseqDirectory()

interface LogseqBlock {
	uuid: string
	content: string
	level: number
	todo?: 'TODO' | 'DOING' | 'DONE' | 'LATER' | 'NOW' | 'WAITING' | 'IN-PROGRESS'
	scheduled?: string
	deadline?: string
	priority?: 'A' | 'B' | 'C'
	properties?: Record<string, any>
	children?: LogseqBlock[]
	parent?: string
	refs?: string[]
	createdAt?: Date
	updatedAt?: Date
}

interface LogseqPage {
	uuid: string
	name: string
	title?: string
	path: string
	blocks: LogseqBlock[]
	properties?: Record<string, any>
	aliases?: string[]
	namespace?: string
	isJournal?: boolean
	journalDay?: number
	tags?: string[]
	lastModified: Date
	createdAt?: Date
}

// Utility functions
function generateUUID(): string {
	return uuidv4()
}

function findMarkdownFiles(dir: string): string[] {
	const files: string[] = []
	if (!fs.existsSync(dir)) return files
	
	try {
		const items = fs.readdirSync(dir)
		for (const item of items) {
			const fullPath = path.join(dir, item)
			const stat = fs.statSync(fullPath)
			
			if (stat.isDirectory()) {
				files.push(...findMarkdownFiles(fullPath))
			} else if (item.endsWith('.md') || item.endsWith('.org')) {
				files.push(fullPath)
			}
		}
	} catch (error) {
		console.error(`Error reading directory ${dir}:`, error)
	}
	
	return files
}

function parseBlocks(content: string): LogseqBlock[] {
	const lines = content.split('\n')
	const blocks: LogseqBlock[] = []

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		if (line.trim() === '') continue
		
		const level = Math.floor((line.match(/^\s*/)?.[0]?.length || 0) / 2)
		let cleanLine = line.trim()
		
		// Skip headers for block parsing
		if (cleanLine.startsWith('#')) continue
		
		// Remove bullet points
		cleanLine = cleanLine.replace(/^[-*+]\s*/, '')
		
		// Parse block UUID if present
		let uuid = generateUUID()
		const uuidMatch = cleanLine.match(/^([a-f0-9-]{36})\s+(.*)$/)
		if (uuidMatch) {
			uuid = uuidMatch[1]
			cleanLine = uuidMatch[2]
		}
		
		// Parse TODO status
		let todo: LogseqBlock['todo'] | undefined
		const todoMatch = cleanLine.match(/^(TODO|DOING|DONE|LATER|NOW|WAITING|IN-PROGRESS)\s+(.*)$/)
		if (todoMatch) {
			todo = todoMatch[1] as LogseqBlock['todo']
			cleanLine = todoMatch[2]
		}
		
		// Parse priority
		let priority: LogseqBlock['priority'] | undefined
		const priorityMatch = cleanLine.match(/\[#([ABC])]\s*(.*)$/)
		if (priorityMatch) {
			priority = priorityMatch[1] as LogseqBlock['priority']
			cleanLine = priorityMatch[2]
		}
		
		// Parse scheduled/deadline
		const scheduledMatch = cleanLine.match(/SCHEDULED:\s*<([^>]+)>/)
		const deadlineMatch = cleanLine.match(/DEADLINE:\s*<([^>]+)>/)
		
		// Parse properties
		const propertyMatches = cleanLine.matchAll(/([\\w-]+):\s*([^\s]+)/g)
		const properties: Record<string, any> = {}
		for (const match of propertyMatches) {
			properties[match[1]] = match[2]
		}
		
		// Parse block references
		const refs: string[] = []
		const refMatches = cleanLine.matchAll(/\(\(([a-f0-9-]{36})\)\)/g)
		for (const match of refMatches) {
			refs.push(match[1])
		}
		
		// Parse page references  
		const pageRefMatches = cleanLine.matchAll(/\[\[([^\]]+)\]\]/g)
		for (const match of pageRefMatches) {
			refs.push(match[1])
		}
		
		// Parse tags
		const tagMatches = cleanLine.matchAll(/#([\\w-]+)/g)
		for (const match of tagMatches) {
			refs.push(match[1])
		}
		
		// Clean content
		const content_clean = cleanLine
			.replace(/SCHEDULED:\s*<[^>]+>/g, '')
			.replace(/DEADLINE:\s*<[^>]+>/g, '')
			.replace(/([\\w-]+):\s*([^\s]+)/g, '')
			.replace(/\[#[ABC]\]/g, '')
			.trim()
		
		if (content_clean) {
			const block: LogseqBlock = {
				uuid,
				content: content_clean,
				level,
				todo,
				priority,
				scheduled: scheduledMatch?.[1],
				deadline: deadlineMatch?.[1],
				properties: Object.keys(properties).length > 0 ? properties : undefined,
				refs: refs.length > 0 ? refs : undefined,
				createdAt: new Date(),
				updatedAt: new Date()
			}
			
			blocks.push(block)
		}
	}
	
	return blocks
}

async function readPageFile(filePath: string): Promise<LogseqPage | null> {
	try {
		const content = fs.readFileSync(filePath, 'utf-8')
		const stats = fs.statSync(filePath)
		
		// Parse front matter
		let properties: Record<string, any> = {}
		let markdownContent = content
		
		if (content.startsWith('---')) {
			const endIndex = content.indexOf('---', 3)
			if (endIndex !== -1) {
				const frontMatter = content.slice(3, endIndex).trim()
				markdownContent = content.slice(endIndex + 3)
				
				frontMatter.split('\n').forEach(line => {
					const colonIndex = line.indexOf(':')
					if (colonIndex > 0) {
						const key = line.slice(0, colonIndex).trim()
						const value = line.slice(colonIndex + 1).trim()
						properties[key] = value
					}
				})
			}
		}
		
		const pageName = path.basename(filePath, path.extname(filePath))
		const blocks = parseBlocks(markdownContent)
		
		// Determine if it's a journal page
		const isJournal = filePath.includes('/journals/')
		let journalDay: number | undefined
		if (isJournal) {
			const dateMatch = pageName.match(/^(\d{4})_(\d{2})_(\d{2})$/)
			if (dateMatch) {
				journalDay = parseInt(dateMatch[1] + dateMatch[2] + dateMatch[3])
			}
		}
		
		// Extract namespace
		const namespace = pageName.includes('/') ? pageName.split('/').slice(0, -1).join('/') : undefined
		
		// Extract aliases
		const aliases = properties.alias ? 
			(Array.isArray(properties.alias) ? properties.alias : [properties.alias]) : 
			undefined
		
		return {
			uuid: generateUUID(),
			name: pageName,
			title: properties.title || pageName,
			path: filePath,
			blocks,
			properties: Object.keys(properties).length > 0 ? properties : undefined,
			aliases,
			namespace,
			isJournal,
			journalDay,
			lastModified: stats.mtime,
			createdAt: stats.birthtime
		}
	} catch (error) {
		console.error(`Error reading page file ${filePath}:`, error)
		return null
	}
}

async function getAllPages(): Promise<LogseqPage[]> {
	if (!LOGSEQ_PATH) {
		throw new Error('Logseq directory not found')
	}

	const pages: LogseqPage[] = []
	
	// Read pages directory
	const pagesDir = path.join(LOGSEQ_PATH, 'pages')
	if (fs.existsSync(pagesDir)) {
		const pageFiles = findMarkdownFiles(pagesDir)
		for (const filePath of pageFiles) {
			const page = await readPageFile(filePath)
			if (page) pages.push(page)
		}
	}
	
	// Read journals directory
	const journalsDir = path.join(LOGSEQ_PATH, 'journals')
	if (fs.existsSync(journalsDir)) {
		const journalFiles = findMarkdownFiles(journalsDir)
		for (const filePath of journalFiles) {
			const page = await readPageFile(filePath)
			if (page) pages.push(page)
		}
	}
	
	return pages
}

// TOOLS USING OFFICIAL API

// 1. System Information (no parameters)
server.registerTool("get_system_info", {
	description: "Get comprehensive information about the Logseq system",
	inputSchema: z.object({})
}, async () => {
	try {
		if (!LOGSEQ_PATH) {
			return {
				content: [{
					type: 'text',
					text: `❌ Logseq directory not found. Checked paths:\n${POSSIBLE_LOGSEQ_PATHS.map(p => `- ${p}`).join('\n')}`
				}],
			}
		}
		
		const pages = await getAllPages()
		const totalBlocks = pages.reduce((sum, page) => sum + page.blocks.length, 0)
		const totalTodos = pages.reduce((sum, page) => 
			sum + page.blocks.filter(block => block.todo).length, 0)
		const journalPages = pages.filter(p => p.isJournal).length
		const regularPages = pages.length - journalPages
		
		return {
			content: [{
				type: 'text',
				text: `🔥 **Logseq Complete MCP Server v3.0** \n\n` +
					`📁 **Graph Path**: ${LOGSEQ_PATH}\n` +
					`📄 **Total Pages**: ${pages.length} (${regularPages} regular, ${journalPages} journals)\n` +
					`📝 **Total Blocks**: ${totalBlocks}\n` +
					`✅ **Total TODOs**: ${totalTodos}\n` +
					`🚀 **Complete Logseq control available!**`
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// 2. List pages (optional filter)
server.registerTool("list_pages", {
	description: "List all pages with optional filter",
	inputSchema: z.object({
		filter: z.string().optional().describe("Optional filter for page names")
	})
}, async ({ filter }) => {
	try {
		let pages = await getAllPages()
		
		// Apply filter if provided
		if (filter) {
			pages = pages.filter(p => 
				p.name.toLowerCase().includes(filter.toLowerCase()) ||
				(p.title && p.title.toLowerCase().includes(filter.toLowerCase()))
			)
		}
		
		// Sort by name
		pages.sort((a, b) => a.name.localeCompare(b.name))
		
		return {
			content: [{
				type: 'text',
				text: `📋 Found ${pages.length} pages:\n\n` + 
					pages.map(p => {
						const type = p.isJournal ? '📅' : '📄'
						const todos = p.blocks.filter(b => b.todo).length
						return `${type} **${p.name}**\n` +
							   `   - ${p.blocks.length} blocks, ${todos} todos\n` +
							   `   - Modified: ${p.lastModified.toLocaleDateString()}`
					}).join('\n\n')
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// 3. Read page (required parameter)
server.registerTool("read_page", {
	description: "Read complete page content",
	inputSchema: z.object({
		pageName: z.string().describe("Name of the page to read")
	})
}, async ({ pageName }) => {
	try {
		const pages = await getAllPages()
		const page = pages.find(p => 
			p.name.toLowerCase() === pageName.toLowerCase() ||
			(p.title && p.title.toLowerCase() === pageName.toLowerCase())
		)
		
		if (!page) {
			return {
				content: [{
					type: 'text',
					text: `❌ Page "${pageName}" not found.\n\n📋 Available pages: ${pages.map(p => p.name).slice(0, 10).join(', ')}${pages.length > 10 ? '...' : ''}`
				}],
			}
		}
		
		let content = `# 📄 ${page.title || page.name}\n\n`
		
		// Add metadata
		content += `**Metadata:**\n`
		content += `- UUID: ${page.uuid}\n`
		content += `- Type: ${page.isJournal ? 'Journal' : 'Regular'} Page\n`
		content += `- Modified: ${page.lastModified.toLocaleDateString()}\n`
		content += `- Blocks: ${page.blocks.length}\n\n`
		
		// Add blocks
		content += `**Content:**\n`
		for (const block of page.blocks) {
			const indent = '  '.repeat(block.level)
			let line = `${indent}- `
			
			if (block.todo) {
				const emoji = block.todo === 'DONE' ? '✅' : 
						     block.todo === 'DOING' ? '🔄' : 
						     block.todo === 'NOW' ? '🔥' : '⭕'
				line += `${emoji} ${block.todo} `
			}
			
			if (block.priority) line += `[#${block.priority}] `
			line += block.content
			
			if (block.scheduled) line += ` 📅 ${block.scheduled}`
			if (block.deadline) line += ` ⏰ ${block.deadline}`
			
			content += line + '\n'
		}
		
		return {
			content: [{ type: 'text', text: content }],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// 4. Search (required parameter)
server.registerTool("search", {
	description: "Search across all content",
	inputSchema: z.object({
		query: z.string().describe("Search query")
	})
}, async ({ query }) => {
	try {
		const pages = await getAllPages()
		const results: any[] = []
		
		const searchRegex = new RegExp(
			query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
			'gi'
		)
		
		for (const page of pages) {
			// Search in page name/title
			if (searchRegex.test(page.name) || (page.title && searchRegex.test(page.title))) {
				results.push({
					type: 'page',
					page: page.name,
					match: `Page title matches "${query}"`
				})
			}
			
			// Search in blocks
			for (const block of page.blocks) {
				if (searchRegex.test(block.content)) {
					results.push({
						type: 'block',
						page: page.name,
						content: block.content,
						blockId: block.uuid.slice(0, 8),
						todo: block.todo
					})
				}
			}
		}
		
		if (results.length === 0) {
			return {
				content: [{
					type: 'text',
					text: `🔍 No results found for "${query}"`
				}],
			}
		}
		
		let output = `🔍 Found ${results.length} results for "${query}":\n\n`
		
		for (const result of results.slice(0, 10)) {
			if (result.type === 'page') {
				output += `📄 **${result.page}**: ${result.match}\n`
			} else {
				output += `📝 **${result.page}**: ${result.content}\n`
				if (result.todo) output += `    ${result.todo}`
				output += `\n    🆔 ${result.blockId}\n`
			}
		}
		
		if (results.length > 10) {
			output += `\n... and ${results.length - 10} more results`
		}
		
		return {
			content: [{ type: 'text', text: output }],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error searching: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// 5. Create page (required pageName, optional content)
server.registerTool("create_page", {
	description: "Create a new page",
	inputSchema: z.object({
		pageName: z.string().describe("Name of the page to create"),
		content: z.string().optional().describe("Initial content for the page")
	})
}, async ({ pageName, content }) => {
	try {
		const pagesDir = path.join(LOGSEQ_PATH!, 'pages')
		const filePath = path.join(pagesDir, `${pageName}.md`)
		
		let pageContent = `# ${pageName}\n\n`
		if (content) {
			pageContent += content
		} else {
			pageContent += `- Created on ${new Date().toLocaleDateString()}`
		}
		
		fs.writeFileSync(filePath, pageContent)
		
		return {
			content: [{
				type: 'text',
				text: `✅ Successfully created page "${pageName}" at ${filePath}`
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error creating page: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// 6. Get TODOs (no parameters)
server.registerTool("get_todos", {
	description: "Get all TODOs organized by status",
	inputSchema: z.object({})
}, async () => {
	try {
		const pages = await getAllPages()
		const todos: { page: string; block: LogseqBlock }[] = []
		
		for (const page of pages) {
			for (const block of page.blocks) {
				if (block.todo) {
					todos.push({ page: page.name, block })
				}
			}
		}
		
		if (todos.length === 0) {
			return {
				content: [{
					type: 'text',
					text: '📋 No TODOs found in your Logseq graph'
				}],
			}
		}
		
		// Group by status
		const grouped = todos.reduce((acc, { page, block }) => {
			const status = block.todo!
			if (!acc[status]) acc[status] = []
			acc[status].push({ page, block })
			return acc
		}, {} as Record<string, { page: string; block: LogseqBlock }[]>)
		
		let output = `✅ **Found ${todos.length} TODOs across your graph:**\n\n`
		
		for (const [status, items] of Object.entries(grouped)) {
			const emoji = status === 'DONE' ? '✅' : 
						 status === 'DOING' ? '🔄' : 
						 status === 'NOW' ? '🔥' : 
						 status === 'LATER' ? '⏰' : '⭕'
			
			output += `## ${emoji} ${status} (${items.length})\n`
			for (const { page, block } of items.slice(0, 5)) {
				output += `- **${page}**: ${block.content} ${block.uuid.slice(0, 8)}\n`
			}
			if (items.length > 5) {
				output += `  ... and ${items.length - 5} more\n`
			}
			output += '\n'
		}
		
		return {
			content: [{ type: 'text', text: output }],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error getting TODOs: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// 7. Get config (no parameters)
server.registerTool("get_config", {
	description: "Get Logseq configuration",
	inputSchema: z.object({})
}, async () => {
	try {
		if (!LOGSEQ_PATH) return { content: [{ type: 'text', text: '❌ Logseq path not found' }] }
		
		const configPath = path.join(LOGSEQ_PATH, 'logseq', 'config.edn')
		if (!fs.existsSync(configPath)) {
			return {
				content: [{
					type: 'text',
					text: `⚙️ **Logseq Configuration:**\n\n📝 No config file found, using defaults\n📅 Journal Format: MMM do, yyyy\n📆 Start of Week: 0 (Sunday)\n📓 Journals Enabled: true\n🎨 Theme: system`
				}],
			}
		}
		
		const configContent = fs.readFileSync(configPath, 'utf-8')
		return {
			content: [{
				type: 'text',
				text: `⚙️ **Logseq Configuration:**\n\n\`\`\`edn\n${configContent}\n\`\`\``
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error reading config: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// 8. Export graph (no parameters)
server.registerTool("export_graph", {
	description: "Export the entire graph as JSON",
	inputSchema: z.object({})
}, async () => {
	try {
		const pages = await getAllPages()
		
		const exportData = {
			version: '3.0',
			exportDate: new Date().toISOString(),
			totalPages: pages.length,
			totalBlocks: pages.reduce((sum, p) => sum + p.blocks.length, 0),
			logseqPath: LOGSEQ_PATH,
			pages: pages.map(p => ({
				uuid: p.uuid,
				name: p.name,
				title: p.title,
				isJournal: p.isJournal,
				blocks: p.blocks.length,
				lastModified: p.lastModified,
				properties: p.properties
			}))
		}
		
		return {
			content: [{
				type: 'text',
				text: `📦 **Graph Export Complete:**\n\n\`\`\`json\n${JSON.stringify(exportData, null, 2)}\n\`\`\``
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error exporting graph: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// 9. Create journal page
server.registerTool("create_journal_page", {
	description: "Create a journal page for a specific date",
	inputSchema: z.object({
		date: z.string().optional().describe("Date in YYYY-MM-DD format, defaults to today")
	})
}, async ({ date }) => {
	try {
		let targetDate = new Date()
		
		if (date) {
			if (date === 'today') {
				targetDate = new Date()
			} else if (date === 'tomorrow') {
				targetDate = new Date()
				targetDate.setDate(targetDate.getDate() + 1)
			} else {
				const parsed = new Date(date)
				if (!isNaN(parsed.getTime())) {
					targetDate = parsed
				}
			}
		}
		
		const journalsDir = path.join(LOGSEQ_PATH!, 'journals')
		const dateStr = targetDate.toISOString().split('T')[0]
		const filePath = path.join(journalsDir, `${dateStr}.md`)
		
		if (fs.existsSync(filePath)) {
			return {
				content: [{
					type: 'text',
					text: `✅ Journal page for ${dateStr} already exists at ${filePath}`
				}],
			}
		}
		
		const journalContent = `# ${dateStr}\n\n- Journal entry for ${targetDate.toLocaleDateString()}\n- TODO Add your thoughts for today\n`
		
		fs.writeFileSync(filePath, journalContent)
		
		return {
			content: [{
				type: 'text',
				text: `✅ Successfully created journal page for ${dateStr} at ${filePath}`
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error creating journal page: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// 10. Get today's journal
server.registerTool("get_today_journal", {
	description: "Get today's journal page",
	inputSchema: z.object({})
}, async () => {
	try {
		const today = new Date().toISOString().split('T')[0]
		const journalsDir = path.join(LOGSEQ_PATH!, 'journals')
		const filePath = path.join(journalsDir, `${today}.md`)
		
		if (!fs.existsSync(filePath)) {
			return {
				content: [{
					type: 'text',
					text: `📅 No journal entry for today (${today}). Use create_journal_page to create one.`
				}],
			}
		}
		
		const content = fs.readFileSync(filePath, 'utf-8')
		return {
			content: [{
				type: 'text',
				text: `📅 **Today's Journal (${today}):**\n\n\`\`\`markdown\n${content}\n\`\`\``
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error reading today's journal: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// 11. Insert block
server.registerTool("insert_block", {
	description: "Insert a new block into a page",
	inputSchema: z.object({
		pageName: z.string().describe("Name of the page"),
		content: z.string().describe("Content of the block"),
		todo: z.string().optional().describe("TODO status (TODO, DOING, DONE, etc.)"),
		priority: z.string().optional().describe("Priority (A, B, C)")
	})
}, async ({ pageName, content, todo, priority }) => {
	try {
		const pages = await getAllPages()
		const page = pages.find(p => p.name.toLowerCase() === pageName.toLowerCase())
		
		if (!page) {
			return {
				content: [{
					type: 'text',
					text: `❌ Page "${pageName}" not found`
				}],
			}
		}
		
		const uuid = generateUUID()
		let blockContent = `- `
		
		if (todo) blockContent += `${todo} `
		if (priority) blockContent += `[#${priority}] `
		blockContent += content
		
		const existingContent = fs.readFileSync(page.path, 'utf-8')
		const newContent = existingContent + '\n' + blockContent
		
		fs.writeFileSync(page.path, newContent)
		
		return {
			content: [{
				type: 'text',
				text: `✅ Successfully inserted block into "${pageName}"\n🆔 Block UUID: ${uuid.slice(0, 8)}\n📝 Content: ${blockContent}`
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error inserting block: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// 12. List blocks
server.registerTool("list_blocks", {
	description: "List all blocks from a specific page",
	inputSchema: z.object({
		pageName: z.string().describe("Name of the page")
	})
}, async ({ pageName }) => {
	try {
		const pages = await getAllPages()
		const page = pages.find(p => p.name.toLowerCase() === pageName.toLowerCase())
		
		if (!page) {
			return {
				content: [{
					type: 'text',
					text: `❌ Page "${pageName}" not found`
				}],
			}
		}
		
		if (page.blocks.length === 0) {
			return {
				content: [{
					type: 'text',
					text: `📝 Page "${pageName}" has no blocks`
				}],
			}
		}
		
		let output = `📝 **Blocks in "${pageName}" (${page.blocks.length} total):**\n\n`
		
		for (let i = 0; i < page.blocks.length; i++) {
			const block = page.blocks[i]
			const indent = '  '.repeat(block.level)
			
			output += `${i + 1}. ${indent}`
			if (block.todo) output += `${block.todo} `
			if (block.priority) output += `[#${block.priority}] `
			output += `${block.content}\n`
			output += `   🆔 ${block.uuid.slice(0, 8)}\n\n`
		}
		
		return {
			content: [{ type: 'text', text: output }],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error listing blocks: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

async function main() {
	const transport = new StdioServerTransport()
	await server.connect(transport)
	console.error('🔥 Logseq Complete MCP Server v3.0 running on stdio')
	console.error(`📁 Logseq path: ${LOGSEQ_PATH || 'Not found'}`)
	console.error('🚀 Using OFFICIAL MCP SDK API!')
	console.error('📊 Registered 12 tools with proper parameter handling!')
}

main().catch(console.error)