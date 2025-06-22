#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { v4 as uuidv4 } from 'uuid'

const server = new McpServer({
	name: 'Logseq Complete MCP',
	version: '4.0.0',
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
		
		// Parse block UUID if present (full UUID or short 8-char UUID)
		let uuid = generateUUID()
		const fullUuidMatch = cleanLine.match(/^([a-f0-9-]{36})\s+(.*)$/)
		const shortUuidMatch = cleanLine.match(/^([a-f0-9]{8})\s+(.*)$/)
		
		if (fullUuidMatch) {
			uuid = fullUuidMatch[1]
			cleanLine = fullUuidMatch[2]
		} else if (shortUuidMatch) {
			// Generate full UUID from short one for consistency, but keep track of short form
			uuid = generateUUID()
			// Store the short UUID as first 8 chars for lookup compatibility
			uuid = shortUuidMatch[1] + uuid.slice(8)
			cleanLine = shortUuidMatch[2]
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
		const properties: Record<string, any> = {}
		const propertyMatches = cleanLine.matchAll(/([a-zA-Z_][a-zA-Z0-9_-]*):\s*([^\s]+)/g)
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
		const tagMatches = cleanLine.matchAll(/#([a-zA-Z0-9_-]+)/g)
		for (const match of tagMatches) {
			refs.push(match[1])
		}
		
		// Clean content
		const content_clean = cleanLine
			.replace(/SCHEDULED:\s*<[^>]+>/g, '')
			.replace(/DEADLINE:\s*<[^>]+>/g, '')
			.replace(/([a-zA-Z_][a-zA-Z0-9_-]*):\s*([^\s]+)/g, '')
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

// TOOLS USING CORRECT API

// 1. System Information (no parameters)
server.registerTool("get_system_info", {
	description: "Get comprehensive information about the Logseq system",
	inputSchema: {}
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
				text: `🔥 **Logseq Complete MCP Server v4.0** \n\n` +
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
	inputSchema: {
		filter: z.string().optional()
	}
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
	inputSchema: {
		pageName: z.string()
	}
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
	inputSchema: {
		query: z.string()
	}
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
	inputSchema: {
		pageName: z.string(),
		content: z.string().optional()
	}
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
	inputSchema: {}
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
	inputSchema: {}
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
	inputSchema: {}
}, async () => {
	try {
		const pages = await getAllPages()
		
		const exportData = {
			version: '4.0',
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

// 9. Insert block
server.registerTool("insert_block", {
	description: "Insert a new block into a page",
	inputSchema: {
		pageName: z.string(),
		content: z.string(),
		todo: z.string().optional(),
		priority: z.string().optional()
	}
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
		let blockContent = `- ${uuid.slice(0, 8)} `
		
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

// 10. Create journal page
server.registerTool("create_journal_page", {
	description: "Create a journal page for a specific date",
	inputSchema: {
		date: z.string().optional()
	}
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

// 11. Get today's journal
server.registerTool("get_today_journal", {
	description: "Get today's journal page",
	inputSchema: {}
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

// 12. Get journal by date
server.registerTool("get_journal_by_date", {
	description: "Get journal for specific date",
	inputSchema: {
		date: z.string()
	}
}, async ({ date }) => {
	try {
		const journalsDir = path.join(LOGSEQ_PATH!, 'journals')
		const filePath = path.join(journalsDir, `${date}.md`)
		
		if (!fs.existsSync(filePath)) {
			return {
				content: [{
					type: 'text',
					text: `📅 No journal entry for ${date}. Use create_journal_page to create one.`
				}],
			}
		}
		
		const content = fs.readFileSync(filePath, 'utf-8')
		return {
			content: [{
				type: 'text',
				text: `📅 **Journal for ${date}:**\n\n\`\`\`markdown\n${content}\n\`\`\``
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error reading journal for ${date}: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// 13. List blocks
server.registerTool("list_blocks", {
	description: "List all blocks from a specific page",
	inputSchema: {
		pageName: z.string()
	}
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

// 14. Get specific block by UUID
server.registerTool("get_block", {
	description: "Get specific block by UUID",
	inputSchema: {
		blockUuid: z.string()
	}
}, async ({ blockUuid }) => {
	try {
		const pages = await getAllPages()
		
		for (const page of pages) {
			for (const block of page.blocks) {
				// Support both full UUID and partial UUID (8 chars)
				const blockShortUuid = block.uuid.slice(0, 8)
				if (block.uuid === blockUuid || blockShortUuid === blockUuid || block.uuid.startsWith(blockUuid)) {
					let content = `🧱 **Block Found:**\n\n`
					content += `**Page**: ${page.name}\n`
					content += `**UUID**: ${block.uuid}\n`
					content += `**Level**: ${block.level}\n`
					if (block.todo) content += `**Status**: ${block.todo}\n`
					if (block.priority) content += `**Priority**: ${block.priority}\n`
					if (block.scheduled) content += `**Scheduled**: ${block.scheduled}\n`
					if (block.deadline) content += `**Deadline**: ${block.deadline}\n`
					content += `**Content**: ${block.content}\n`
					
					return {
						content: [{ type: 'text', text: content }],
					}
				}
			}
		}
		
		return {
			content: [{
				type: 'text',
				text: `❌ Block with UUID "${blockUuid}" not found`
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error finding block: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// 15. Update page content
server.registerTool("update_page", {
	description: "Update page content completely",
	inputSchema: {
		pageName: z.string(),
		content: z.string()
	}
}, async ({ pageName, content }) => {
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
		
		const newContent = `# ${pageName}\n\n${content}`
		fs.writeFileSync(page.path, newContent)
		
		return {
			content: [{
				type: 'text',
				text: `✅ Successfully updated page "${pageName}"\n📝 New content written to ${page.path}`
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error updating page: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// 16. Delete page
server.registerTool("delete_page", {
	description: "Delete a page completely",
	inputSchema: {
		pageName: z.string()
	}
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
		
		fs.unlinkSync(page.path)
		
		return {
			content: [{
				type: 'text',
				text: `✅ Successfully deleted page "${pageName}"\n🗑️ File removed: ${page.path}`
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error deleting page: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// 17. Update block content
server.registerTool("update_block", {
	description: "Update specific block content by UUID",
	inputSchema: {
		blockUuid: z.string(),
		content: z.string()
	}
}, async ({ blockUuid, content }) => {
	try {
		const pages = await getAllPages()
		
		for (const page of pages) {
			const fileContent = fs.readFileSync(page.path, 'utf-8')
			const lines = fileContent.split('\n')
			let updated = false
			
			for (let i = 0; i < lines.length; i++) {
				// Support both full and partial UUID lookup in file content
				const lineIncludesUuid = lines[i].includes(blockUuid) || 
					(blockUuid.length >= 8 && lines[i].includes(blockUuid.slice(0, 8))) ||
					(blockUuid.length <= 8 && lines[i].includes(blockUuid))
				if (lineIncludesUuid) {
					// Find the existing content pattern and replace it
					const line = lines[i]
					const match = line.match(/^(\s*- )(.*)$/)
					if (match) {
						lines[i] = match[1] + content
						updated = true
						break
					}
				}
			}
			
			if (updated) {
				fs.writeFileSync(page.path, lines.join('\n'))
				return {
					content: [{
						type: 'text',
						text: `✅ Successfully updated block ${blockUuid.slice(0, 8)}\n📝 New content: ${content}\n📄 Page: ${page.name}`
					}],
				}
			}
		}
		
		return {
			content: [{
				type: 'text',
				text: `❌ Block with UUID "${blockUuid}" not found`
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error updating block: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// 18. Delete block
server.registerTool("delete_block", {
	description: "Delete specific block by UUID",
	inputSchema: {
		blockUuid: z.string()
	}
}, async ({ blockUuid }) => {
	try {
		const pages = await getAllPages()
		
		// Find the block by UUID across all pages
		for (const page of pages) {
			const blockIndex = page.blocks.findIndex(block => {
				const blockShortUuid = block.uuid.slice(0, 8)
				return block.uuid === blockUuid || 
				       blockShortUuid === blockUuid || 
				       block.uuid.startsWith(blockUuid)
			})
			
			if (blockIndex !== -1) {
				const block = page.blocks[blockIndex]
				const fileContent = fs.readFileSync(page.path, 'utf-8')
				const lines = fileContent.split('\n')
				
				// Find the line containing this block's content
				let lineToDelete = -1
				
				// Try multiple strategies to find the line
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i]
					const trimmedLine = line.trim()
					
					// Strategy 1: Look for UUID at the beginning (most reliable for new blocks)
					const shortUuid = block.uuid.slice(0, 8)
					if (trimmedLine.startsWith(`- ${shortUuid} `) || 
					    trimmedLine.startsWith(`* ${shortUuid} `) || 
					    trimmedLine.startsWith(`+ ${shortUuid} `)) {
						lineToDelete = i
						break
					}
					
					// Strategy 2: Exact content match with bullet points
					if (trimmedLine.includes(block.content) && 
					    (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ') || 
					     trimmedLine.startsWith('+ ') || trimmedLine.startsWith('-') || 
					     trimmedLine.startsWith('*') || trimmedLine.startsWith('+'))) {
						lineToDelete = i
						break
					}
					
					// Strategy 3: Content after TODO/status markers and UUID
					const contentAfterMarkers = trimmedLine
						.replace(/^[-*+]\s*/, '')  // Remove bullets
						.replace(/^[a-f0-9]{8}\s+/, '')  // Remove UUID
						.replace(/^(TODO|DOING|DONE|LATER|NOW|WAITING|IN-PROGRESS)\s+/, '')  // Remove TODO status
						.replace(/\[#[ABC]\]\s*/, '')  // Remove priority
						.trim()
					
					if (contentAfterMarkers === block.content || 
					    contentAfterMarkers.includes(block.content) || 
					    block.content.includes(contentAfterMarkers)) {
						lineToDelete = i
						break
					}
					
					// Strategy 4: Partial content match on lines that look like blocks
					if ((line.includes('- ') || line.includes('* ') || line.includes('+ ')) && 
					    (line.includes(block.content.slice(0, 10)) || 
					     block.content.includes(trimmedLine.slice(2, 12)))) {
						lineToDelete = i
						break
					}
				}
				
				if (lineToDelete !== -1) {
					// Store original content for verification
					const originalLine = lines[lineToDelete]
					
					// Remove the line and save
					lines.splice(lineToDelete, 1)
					
					// Write with explicit encoding and sync
					const newContent = lines.join('\n')
					fs.writeFileSync(page.path, newContent, 'utf-8')
					
					// Force filesystem sync to ensure write is complete
					try {
						const fd = fs.openSync(page.path, 'r+')
						fs.fsyncSync(fd)
						fs.closeSync(fd)
					} catch (syncError) {
						// Sync failed but write might have succeeded
					}
					
					// Small delay to ensure filesystem consistency
					await new Promise(resolve => setTimeout(resolve, 50))
					
					// Verify deletion by re-reading file
					const verificationContent = fs.readFileSync(page.path, 'utf-8')
					const deletionVerified = !verificationContent.includes(originalLine.trim())
					
					// Additional verification: check if UUID is gone
					const uuidStillExists = verificationContent.includes(block.uuid.slice(0, 8))
					const fullVerification = deletionVerified && !uuidStillExists
					
					return {
						content: [{
							type: 'text',
							text: `✅ Successfully deleted block "${block.content}"\n` +
								  `🆔 UUID: ${block.uuid.slice(0, 8)}\n` +
								  `📄 From page: ${page.name}\n` +
								  `📝 Original line: "${originalLine.trim()}"\n` +
								  `✔️ Line deletion verified: ${deletionVerified ? 'YES' : 'NO'}\n` +
								  `🔍 UUID removal verified: ${!uuidStillExists ? 'YES' : 'NO'}\n` +
								  `🎯 Full verification: ${fullVerification ? 'COMPLETE SUCCESS' : 'POTENTIAL ISSUE'}`
						}],
					}
				} else {
					// Debug information to help understand why the block wasn't found
					const filePreview = lines.slice(0, 10).map((line, idx) => `${idx + 1}: ${line}`).join('\n')
					return {
						content: [{
							type: 'text',
							text: `❌ Block content not found in file for UUID ${blockUuid.slice(0, 8)}\n\n` +
								  `🔍 **Debug Info:**\n` +
								  `- Block content: "${block.content}"\n` +
								  `- Page: ${page.name}\n` +
								  `- File path: ${page.path}\n` +
								  `- File lines (first 10):\n${filePreview}\n\n` +
								  `Try using a more recent UUID from insert_block or list_blocks.`
						}],
					}
				}
			}
		}
		
		return {
			content: [{
				type: 'text',
				text: `❌ Block with UUID "${blockUuid}" not found in any page`
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error deleting block: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// 19. Get page properties
server.registerTool("get_page_properties", {
	description: "Get all properties of a specific page",
	inputSchema: {
		pageName: z.string()
	}
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
		
		if (!page.properties || Object.keys(page.properties).length === 0) {
			return {
				content: [{
					type: 'text',
					text: `📄 Page "${pageName}" has no properties`
				}],
			}
		}
		
		let output = `📊 **Properties for "${pageName}":**\n\n`
		for (const [key, value] of Object.entries(page.properties)) {
			output += `- **${key}**: ${value}\n`
		}
		
		return {
			content: [{ type: 'text', text: output }],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error getting properties: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// 20. Set page property
server.registerTool("set_page_property", {
	description: "Set a property on a specific page",
	inputSchema: {
		pageName: z.string(),
		propertyName: z.string(),
		propertyValue: z.string()
	}
}, async ({ pageName, propertyName, propertyValue }) => {
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
		
		let content = fs.readFileSync(page.path, 'utf-8')
		
		// Add front matter if it doesn't exist
		if (!content.startsWith('---')) {
			content = `---\n${propertyName}: ${propertyValue}\n---\n\n${content}`
		} else {
			// Add to existing front matter
			const endIndex = content.indexOf('---', 3)
			if (endIndex !== -1) {
				const frontMatter = content.slice(3, endIndex)
				const restContent = content.slice(endIndex + 3)
				const newFrontMatter = frontMatter + `\n${propertyName}: ${propertyValue}`
				content = `---${newFrontMatter}\n---${restContent}`
			}
		}
		
		fs.writeFileSync(page.path, content)
		
		return {
			content: [{
				type: 'text',
				text: `✅ Successfully set property "${propertyName}" = "${propertyValue}" on page "${pageName}"`
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error setting property: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

async function main() {
	const transport = new StdioServerTransport()
	await server.connect(transport)
	console.error('🔥 Logseq Complete MCP Server v4.0 running on stdio')
	console.error(`📁 Logseq path: ${LOGSEQ_PATH || 'Not found'}`)
	console.error('🚀 Using CORRECT MCP SDK API!')
	console.error('🎯 Registered 20 COMPLETE tools - 100% FUNCTIONALITY!')
	console.error('📊 Functions: System(1) + Pages(4) + Blocks(5) + TODOs(1) + Journals(3) + Config(1) + Properties(2) + Search(1) + Export(1) + Advanced(1)')
}

main().catch(console.error)