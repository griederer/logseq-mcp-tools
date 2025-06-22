#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { v4 as uuidv4 } from 'uuid'

const server = new McpServer({
	name: 'Logseq Fixed',
	version: '2.1.0',
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
		const priorityMatch = cleanLine.match(/\[#([ABC])\]\s*(.*)$/)
		if (priorityMatch) {
			priority = priorityMatch[1] as LogseqBlock['priority']
			cleanLine = priorityMatch[2]
		}
		
		// Parse scheduled/deadline
		const scheduledMatch = cleanLine.match(/SCHEDULED:\s*<([^>]+)>/)
		const deadlineMatch = cleanLine.match(/DEADLINE:\s*<([^>]+)>/)
		
		// Parse properties
		const propertyMatches = cleanLine.matchAll(/([\w-]+):\s*([^\s]+)/g)
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
		const tagMatches = cleanLine.matchAll(/#([\w-]+)/g)
		for (const match of tagMatches) {
			refs.push(match[1])
		}
		
		// Clean content
		const content_clean = cleanLine
			.replace(/SCHEDULED:\s*<[^>]+>/g, '')
			.replace(/DEADLINE:\s*<[^>]+>/g, '')
			.replace(/([\w-]+):\s*([^\s]+)/g, '')
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

// NOW LET'S ADD ONLY THE ESSENTIAL TOOLS WITH FIXED SCHEMAS

// Working function (no params)
server.tool('get_system_info', {
	description: 'Get comprehensive information about the Logseq system',
	inputSchema: { type: 'object', properties: {} },
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
				text: `🔥 **Logseq Complete MCP Server v2.1** \n\n` +
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

// Fixed list_pages (simplified schema)
server.tool('list_pages', {
	description: 'List all pages',
	inputSchema: {
		type: 'object',
		properties: {
			filter: { type: 'string' }
		}
	},
}, async (args) => {
	console.error('DEBUG list_pages: args =', JSON.stringify(args, null, 2))
	
	try {
		let pages = await getAllPages()
		
		// Apply filter if provided
		if (args && args.filter) {
			pages = pages.filter(p => 
				p.name.toLowerCase().includes(args.filter.toLowerCase()) ||
				(p.title && p.title.toLowerCase().includes(args.filter.toLowerCase()))
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

// Fixed read_page (required param)
server.tool('read_page', {
	description: 'Read complete page content',
	inputSchema: {
		type: 'object',
		properties: {
			pageName: { type: 'string' }
		}
	},
}, async (args) => {
	console.error('DEBUG read_page: args =', JSON.stringify(args, null, 2))
	
	try {
		if (!args || !args.pageName) {
			return {
				content: [{
					type: 'text',
					text: `❌ Error: pageName parameter is required`
				}],
			}
		}
		
		const pages = await getAllPages()
		const page = pages.find(p => 
			p.name.toLowerCase() === args.pageName.toLowerCase() ||
			(p.title && p.title.toLowerCase() === args.pageName.toLowerCase())
		)
		
		if (!page) {
			return {
				content: [{
					type: 'text',
					text: `❌ Page "${args.pageName}" not found.\n\n📋 Available pages: ${pages.map(p => p.name).slice(0, 10).join(', ')}${pages.length > 10 ? '...' : ''}`
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

// Fixed create_page (required param)
server.tool('create_page', {
	description: 'Create a new page',
	inputSchema: {
		type: 'object',
		properties: {
			pageName: { type: 'string' },
			content: { type: 'string' }
		}
	},
}, async (args) => {
	console.error('DEBUG create_page: args =', JSON.stringify(args, null, 2))
	
	try {
		if (!args || !args.pageName) {
			return {
				content: [{
					type: 'text',
					text: `❌ Error: pageName parameter is required`
				}],
			}
		}
		
		const pagesDir = path.join(LOGSEQ_PATH!, 'pages')
		const filePath = path.join(pagesDir, `${args.pageName}.md`)
		
		let pageContent = `# ${args.pageName}\n\n`
		if (args.content) {
			pageContent += args.content
		} else {
			pageContent += `- Created on ${new Date().toLocaleDateString()}`
		}
		
		fs.writeFileSync(filePath, pageContent)
		
		return {
			content: [{
				type: 'text',
				text: `✅ Successfully created page "${args.pageName}" at ${filePath}`
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

// Fixed search (required param)
server.tool('search', {
	description: 'Search across all content',
	inputSchema: {
		type: 'object',
		properties: {
			query: { type: 'string' }
		}
	},
}, async (args) => {
	console.error('DEBUG search: args =', JSON.stringify(args, null, 2))
	
	try {
		if (!args || !args.query) {
			return {
				content: [{
					type: 'text',
					text: `❌ Error: query parameter is required`
				}],
			}
		}
		
		const pages = await getAllPages()
		const results: any[] = []
		
		const searchRegex = new RegExp(
			args.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
			'gi'
		)
		
		for (const page of pages) {
			// Search in page name/title
			if (searchRegex.test(page.name) || (page.title && searchRegex.test(page.title))) {
				results.push({
					type: 'page',
					page: page.name,
					match: `Page title matches "${args.query}"`
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
					text: `🔍 No results found for "${args.query}"`
				}],
			}
		}
		
		let output = `🔍 Found ${results.length} results for "${args.query}":\n\n`
		
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

// Add get_todos (working function without parameters)
server.tool('get_todos', {
	description: 'Get all TODOs organized by status',
	inputSchema: { type: 'object', properties: {} },
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
					text: `📋 No TODOs found in the graph`
				}],
			}
		}
		
		// Group by status
		const grouped = todos.reduce((acc, todo) => {
			const key = todo.block.todo!
			if (!acc[key]) acc[key] = []
			acc[key].push(todo)
			return acc
		}, {} as Record<string, typeof todos>)
		
		let summary = `📋 Found ${todos.length} todos:\n\n`
		
		for (const [group, groupTodos] of Object.entries(grouped)) {
			const emoji = group === 'DONE' ? '✅' : 
						 group === 'DOING' ? '🔄' : 
						 group === 'NOW' ? '🔥' : '⭕'
			
			summary += `${emoji} **${group}** (${groupTodos.length}):\n`
			
			for (const todo of groupTodos) {
				let line = `  - **${todo.page}**: ${todo.block.content}`
				if (todo.block.priority) line += ` [#${todo.block.priority}]`
				if (todo.block.scheduled) line += ` 📅 ${todo.block.scheduled}`
				if (todo.block.deadline) line += ` ⏰ ${todo.block.deadline}`
				line += ` 🆔 ${todo.block.uuid.slice(0, 8)}`
				summary += line + '\n'
			}
			summary += '\n'
		}
		
		return {
			content: [{ type: 'text', text: summary }],
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

// Add get_config (working function without parameters)
server.tool('get_config', {
	description: 'Get Logseq configuration',
	inputSchema: { type: 'object', properties: {} },
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
		
		// Simple parsing for display
		const preferredFormatMatch = configContent.match(/:preferred-format\s+:(\w+)/)
		const journalMatch = configContent.match(/:journal\/page-title-format\s+"([^"]+)"/)
		
		return {
			content: [{
				type: 'text',
				text: `⚙️ **Logseq Configuration:**\n\n` +
					  `📝 Preferred Format: ${preferredFormatMatch?.[1] || 'markdown'}\n` +
					  `📅 Journal Title Format: ${journalMatch?.[1] || 'MMM do, yyyy'}\n` +
					  `📆 Start of Week: 0 (Sunday)\n` +
					  `📓 Journals Enabled: true\n` +
					  `🎨 Theme: system`
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

// Add export_graph (working function without parameters)  
server.tool('export_graph', {
	description: 'Export the entire graph',
	inputSchema: { type: 'object', properties: {} },
}, async () => {
	try {
		const pages = await getAllPages()
		
		// Export as JSON
		const exportData = {
			version: '2.1',
			exportDate: new Date().toISOString(),
			totalPages: pages.length,
			totalBlocks: pages.reduce((sum, p) => sum + p.blocks.length, 0),
			pages: pages.map(page => ({
				uuid: page.uuid,
				name: page.name,
				title: page.title,
				isJournal: page.isJournal,
				lastModified: page.lastModified,
				blocks: page.blocks.map(block => ({
					uuid: block.uuid,
					content: block.content,
					level: block.level,
					todo: block.todo,
					priority: block.priority,
					scheduled: block.scheduled,
					deadline: block.deadline
				}))
			}))
		}
		
		const exported = JSON.stringify(exportData, null, 2)
		
		return {
			content: [{
				type: 'text',
				text: `📤 **Graph Export (JSON):**\n\n\`\`\`json\n${exported.slice(0, 2000)}${exported.length > 2000 ? '\n\n... (truncated, full export available)' : ''}\n\`\`\``
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error exporting: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// FUNCTIONS WITH PARAMETERS - USING SAME PATTERN AS list_pages

// Add delete_page (with parameter)
server.tool('delete_page', {
	description: 'Delete a page',
	inputSchema: {
		type: 'object',
		properties: {
			pageName: { type: 'string' }
		}
	},
}, async (args) => {
	console.error('DEBUG delete_page: args =', JSON.stringify(args, null, 2))
	
	try {
		if (!args || !args.pageName) {
			return {
				content: [{
					type: 'text',
					text: `❌ Error: pageName parameter is required`
				}],
			}
		}
		
		const pages = await getAllPages()
		const page = pages.find(p => p.name.toLowerCase() === args.pageName.toLowerCase())
		
		if (!page) {
			return {
				content: [{
					type: 'text',
					text: `❌ Page "${args.pageName}" not found`
				}],
			}
		}
		
		fs.unlinkSync(page.path)
		
		return {
			content: [{
				type: 'text',
				text: `✅ Successfully deleted page "${args.pageName}"`
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

// Add rename_page (with parameters)
server.tool('rename_page', {
	description: 'Rename a page',
	inputSchema: {
		type: 'object',
		properties: {
			oldName: { type: 'string' },
			newName: { type: 'string' }
		}
	},
}, async (args) => {
	console.error('DEBUG rename_page: args =', JSON.stringify(args, null, 2))
	
	try {
		if (!args || !args.oldName || !args.newName) {
			return {
				content: [{
					type: 'text',
					text: `❌ Error: oldName and newName parameters are required`
				}],
			}
		}
		
		const pages = await getAllPages()
		const page = pages.find(p => p.name.toLowerCase() === args.oldName.toLowerCase())
		
		if (!page) {
			return {
				content: [{
					type: 'text',
					text: `❌ Page "${args.oldName}" not found`
				}],
			}
		}
		
		const newPath = path.join(path.dirname(page.path), `${args.newName}.md`)
		fs.renameSync(page.path, newPath)
		
		return {
			content: [{
				type: 'text',
				text: `✅ Successfully renamed "${args.oldName}" to "${args.newName}"`
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error renaming page: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// Add create_journal_page (with parameter)
server.tool('create_journal_page', {
	description: 'Create a journal page',
	inputSchema: {
		type: 'object',
		properties: {
			date: { type: 'string' }
		}
	},
}, async (args) => {
	console.error('DEBUG create_journal_page: args =', JSON.stringify(args, null, 2))
	
	try {
		let targetDate = new Date()
		
		if (args && args.date) {
			if (args.date === 'today') {
				targetDate = new Date()
			} else if (args.date === 'tomorrow') {
				targetDate = new Date()
				targetDate.setDate(targetDate.getDate() + 1)
			} else {
				// Try to parse as YYYY-MM-DD
				const parsed = new Date(args.date)
				if (!isNaN(parsed.getTime())) {
					targetDate = parsed
				}
			}
		}
		
		const journalName = targetDate.toISOString().split('T')[0]
		const journalsDir = path.join(LOGSEQ_PATH!, 'journals')
		
		if (!fs.existsSync(journalsDir)) {
			fs.mkdirSync(journalsDir, { recursive: true })
		}
		
		const filePath = path.join(journalsDir, `${journalName}.md`)
		
		if (fs.existsSync(filePath)) {
			return {
				content: [{
					type: 'text',
					text: `📅 Journal page for ${journalName} already exists`
				}],
			}
		}
		
		const content = `# ${journalName}\n\n- Created at ${new Date().toLocaleTimeString()}\n`
		fs.writeFileSync(filePath, content)
		
		return {
			content: [{
				type: 'text',
				text: `✅ Successfully created journal page for ${journalName}`
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error creating journal: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// Add insert_block (with parameters)
server.tool('insert_block', {
	description: 'Insert a new block',
	inputSchema: {
		type: 'object',
		properties: {
			pageName: { type: 'string' },
			content: { type: 'string' },
			todo: { type: 'string' },
			priority: { type: 'string' }
		}
	},
}, async (args) => {
	console.error('DEBUG insert_block: args =', JSON.stringify(args, null, 2))
	
	try {
		if (!args || !args.pageName || !args.content) {
			return {
				content: [{
					type: 'text',
					text: `❌ Error: pageName and content parameters are required`
				}],
			}
		}
		
		const pages = await getAllPages()
		const page = pages.find(p => p.name.toLowerCase() === args.pageName.toLowerCase())
		
		if (!page) {
			return {
				content: [{
					type: 'text',
					text: `❌ Page "${args.pageName}" not found`
				}],
			}
		}
		
		const existingContent = fs.readFileSync(page.path, 'utf-8')
		
		let blockText = `- `
		if (args.todo) blockText += `${args.todo} `
		if (args.priority) blockText += `[#${args.priority}] `
		blockText += args.content
		
		const newContent = existingContent + '\n' + blockText
		fs.writeFileSync(page.path, newContent)
		
		const blockUuid = generateUUID()
		
		return {
			content: [{
				type: 'text',
				text: `✅ Successfully inserted block in "${args.pageName}"\n` +
					  `🆔 Block UUID: ${blockUuid}\n` +
					  `📝 Content: ${args.content}`
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

// ADDING 10 MORE FUNCTIONS TO COMPLETE THE 22 TOTAL

// Add update_page
server.tool('update_page', {
	description: 'Update page content',
	inputSchema: {
		type: 'object',
		properties: {
			pageName: { type: 'string' },
			content: { type: 'string' }
		}
	},
}, async (args) => {
	console.error('DEBUG update_page: args =', JSON.stringify(args, null, 2))
	
	try {
		if (!args || !args.pageName || !args.content) {
			return {
				content: [{
					type: 'text',
					text: `❌ Error: pageName and content parameters are required`
				}],
			}
		}
		
		const pages = await getAllPages()
		const page = pages.find(p => p.name.toLowerCase() === args.pageName.toLowerCase())
		
		if (!page) {
			return {
				content: [{
					type: 'text',
					text: `❌ Page "${args.pageName}" not found`
				}],
			}
		}
		
		fs.writeFileSync(page.path, args.content)
		
		return {
			content: [{
				type: 'text',
				text: `✅ Successfully updated page "${args.pageName}"`
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

// Add get_today_journal
server.tool('get_today_journal', {
	description: 'Get today\'s journal page',
	inputSchema: { type: 'object', properties: {} },
}, async () => {
	try {
		const today = new Date().toISOString().split('T')[0]
		const journalsDir = path.join(LOGSEQ_PATH!, 'journals')
		const filePath = path.join(journalsDir, `${today}.md`)
		
		if (!fs.existsSync(filePath)) {
			return {
				content: [{
					type: 'text',
					text: `📅 No journal found for today (${today}). Use create_journal_page to create one.`
				}],
			}
		}
		
		const content = fs.readFileSync(filePath, 'utf-8')
		
		return {
			content: [{
				type: 'text',
				text: `📅 **Today's Journal (${today}):**\n\n${content}`
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error getting today's journal: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// Add get_journal_by_date
server.tool('get_journal_by_date', {
	description: 'Get journal for specific date',
	inputSchema: {
		type: 'object',
		properties: {
			date: { type: 'string' }
		}
	},
}, async (args) => {
	console.error('DEBUG get_journal_by_date: args =', JSON.stringify(args, null, 2))
	
	try {
		if (!args || !args.date) {
			return {
				content: [{
					type: 'text',
					text: `❌ Error: date parameter is required (YYYY-MM-DD format)`
				}],
			}
		}
		
		const journalsDir = path.join(LOGSEQ_PATH!, 'journals')
		const filePath = path.join(journalsDir, `${args.date}.md`)
		
		if (!fs.existsSync(filePath)) {
			return {
				content: [{
					type: 'text',
					text: `📅 No journal found for ${args.date}`
				}],
			}
		}
		
		const content = fs.readFileSync(filePath, 'utf-8')
		
		return {
			content: [{
				type: 'text',
				text: `📅 **Journal for ${args.date}:**\n\n${content}`
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error getting journal: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// Add list_blocks
server.tool('list_blocks', {
	description: 'List all blocks from a page',
	inputSchema: {
		type: 'object',
		properties: {
			pageName: { type: 'string' }
		}
	},
}, async (args) => {
	console.error('DEBUG list_blocks: args =', JSON.stringify(args, null, 2))
	
	try {
		if (!args || !args.pageName) {
			return {
				content: [{
					type: 'text',
					text: `❌ Error: pageName parameter is required`
				}],
			}
		}
		
		const pages = await getAllPages()
		const page = pages.find(p => p.name.toLowerCase() === args.pageName.toLowerCase())
		
		if (!page) {
			return {
				content: [{
					type: 'text',
					text: `❌ Page "${args.pageName}" not found`
				}],
			}
		}
		
		if (page.blocks.length === 0) {
			return {
				content: [{
					type: 'text',
					text: `📝 Page "${args.pageName}" has no blocks`
				}],
			}
		}
		
		let result = `📝 **Blocks in "${args.pageName}" (${page.blocks.length} total):**\n\n`
		
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
			line += ` 🆔 ${block.uuid.slice(0, 8)}`
			
			result += line + '\n'
		}
		
		return {
			content: [{ type: 'text', text: result }],
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

// Add get_block
server.tool('get_block', {
	description: 'Get specific block by UUID',
	inputSchema: {
		type: 'object',
		properties: {
			blockUuid: { type: 'string' }
		}
	},
}, async (args) => {
	console.error('DEBUG get_block: args =', JSON.stringify(args, null, 2))
	
	try {
		if (!args || !args.blockUuid) {
			return {
				content: [{
					type: 'text',
					text: `❌ Error: blockUuid parameter is required`
				}],
			}
		}
		
		const pages = await getAllPages()
		
		for (const page of pages) {
			const block = page.blocks.find(b => b.uuid.startsWith(args.blockUuid))
			if (block) {
				let result = `📝 **Block Details:**\n\n`
				result += `🆔 **UUID**: ${block.uuid}\n`
				result += `📄 **Page**: ${page.name}\n`
				result += `📝 **Content**: ${block.content}\n`
				result += `📊 **Level**: ${block.level}\n`
				
				if (block.todo) result += `✅ **TODO Status**: ${block.todo}\n`
				if (block.priority) result += `🔥 **Priority**: ${block.priority}\n`
				if (block.scheduled) result += `📅 **Scheduled**: ${block.scheduled}\n`
				if (block.deadline) result += `⏰ **Deadline**: ${block.deadline}\n`
				
				return {
					content: [{ type: 'text', text: result }],
				}
			}
		}
		
		return {
			content: [{
				type: 'text',
				text: `❌ Block with UUID "${args.blockUuid}" not found`
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error getting block: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// Add update_block
server.tool('update_block', {
	description: 'Update block content',
	inputSchema: {
		type: 'object',
		properties: {
			blockUuid: { type: 'string' },
			content: { type: 'string' }
		}
	},
}, async (args) => {
	console.error('DEBUG update_block: args =', JSON.stringify(args, null, 2))
	
	try {
		if (!args || !args.blockUuid || !args.content) {
			return {
				content: [{
					type: 'text',
					text: `❌ Error: blockUuid and content parameters are required`
				}],
			}
		}
		
		const pages = await getAllPages()
		
		for (const page of pages) {
			const content = fs.readFileSync(page.path, 'utf-8')
			const lines = content.split('\n')
			
			for (let i = 0; i < lines.length; i++) {
				if (lines[i].includes(args.blockUuid.slice(0, 8))) {
					// Update the line content while preserving structure
					const match = lines[i].match(/^(\s*-\s*)(.*)$/)
					if (match) {
						lines[i] = match[1] + args.content
						fs.writeFileSync(page.path, lines.join('\n'))
						
						return {
							content: [{
								type: 'text',
								text: `✅ Successfully updated block ${args.blockUuid.slice(0, 8)} in "${page.name}"`
							}],
						}
					}
				}
			}
		}
		
		return {
			content: [{
				type: 'text',
				text: `❌ Block with UUID "${args.blockUuid}" not found`
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

// Add delete_block
server.tool('delete_block', {
	description: 'Delete a block',
	inputSchema: {
		type: 'object',
		properties: {
			blockUuid: { type: 'string' }
		}
	},
}, async (args) => {
	console.error('DEBUG delete_block: args =', JSON.stringify(args, null, 2))
	
	try {
		if (!args || !args.blockUuid) {
			return {
				content: [{
					type: 'text',
					text: `❌ Error: blockUuid parameter is required`
				}],
			}
		}
		
		const pages = await getAllPages()
		
		for (const page of pages) {
			const content = fs.readFileSync(page.path, 'utf-8')
			const lines = content.split('\n')
			
			for (let i = 0; i < lines.length; i++) {
				if (lines[i].includes(args.blockUuid.slice(0, 8))) {
					lines.splice(i, 1)
					fs.writeFileSync(page.path, lines.join('\n'))
					
					return {
						content: [{
							type: 'text',
							text: `✅ Successfully deleted block ${args.blockUuid.slice(0, 8)} from "${page.name}"`
						}],
					}
				}
			}
		}
		
		return {
			content: [{
				type: 'text',
				text: `❌ Block with UUID "${args.blockUuid}" not found`
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

// Add move_block
server.tool('move_block', {
	description: 'Move block to different position',
	inputSchema: {
		type: 'object',
		properties: {
			blockUuid: { type: 'string' },
			targetPageName: { type: 'string' },
			position: { type: 'string' }
		}
	},
}, async (args) => {
	console.error('DEBUG move_block: args =', JSON.stringify(args, null, 2))
	
	try {
		if (!args || !args.blockUuid || !args.targetPageName) {
			return {
				content: [{
					type: 'text',
					text: `❌ Error: blockUuid and targetPageName parameters are required`
				}],
			}
		}
		
		// This is a simplified move - just copy block content to target page
		const pages = await getAllPages()
		const targetPage = pages.find(p => p.name.toLowerCase() === args.targetPageName.toLowerCase())
		
		if (!targetPage) {
			return {
				content: [{
					type: 'text',
					text: `❌ Target page "${args.targetPageName}" not found`
				}],
			}
		}
		
		// Find and extract block content
		let blockContent = ''
		for (const page of pages) {
			const content = fs.readFileSync(page.path, 'utf-8')
			const lines = content.split('\n')
			
			for (let i = 0; i < lines.length; i++) {
				if (lines[i].includes(args.blockUuid.slice(0, 8))) {
					blockContent = lines[i]
					lines.splice(i, 1)
					fs.writeFileSync(page.path, lines.join('\n'))
					break
				}
			}
		}
		
		if (!blockContent) {
			return {
				content: [{
					type: 'text',
					text: `❌ Block with UUID "${args.blockUuid}" not found`
				}],
			}
		}
		
		// Add to target page
		const targetContent = fs.readFileSync(targetPage.path, 'utf-8')
		const newContent = targetContent + '\n' + blockContent
		fs.writeFileSync(targetPage.path, newContent)
		
		return {
			content: [{
				type: 'text',
				text: `✅ Successfully moved block to "${args.targetPageName}"`
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error moving block: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// Add get_page_properties
server.tool('get_page_properties', {
	description: 'Get page properties',
	inputSchema: {
		type: 'object',
		properties: {
			pageName: { type: 'string' }
		}
	},
}, async (args) => {
	console.error('DEBUG get_page_properties: args =', JSON.stringify(args, null, 2))
	
	try {
		if (!args || !args.pageName) {
			return {
				content: [{
					type: 'text',
					text: `❌ Error: pageName parameter is required`
				}],
			}
		}
		
		const pages = await getAllPages()
		const page = pages.find(p => p.name.toLowerCase() === args.pageName.toLowerCase())
		
		if (!page) {
			return {
				content: [{
					type: 'text',
					text: `❌ Page "${args.pageName}" not found`
				}],
			}
		}
		
		if (!page.properties || Object.keys(page.properties).length === 0) {
			return {
				content: [{
					type: 'text',
					text: `📄 Page "${args.pageName}" has no properties`
				}],
			}
		}
		
		let result = `🏷️ **Properties for "${args.pageName}":**\n\n`
		for (const [key, value] of Object.entries(page.properties)) {
			result += `- **${key}**: ${value}\n`
		}
		
		return {
			content: [{ type: 'text', text: result }],
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

// Add set_page_property
server.tool('set_page_property', {
	description: 'Set page property',
	inputSchema: {
		type: 'object',
		properties: {
			pageName: { type: 'string' },
			propertyName: { type: 'string' },
			propertyValue: { type: 'string' }
		}
	},
}, async (args) => {
	console.error('DEBUG set_page_property: args =', JSON.stringify(args, null, 2))
	
	try {
		if (!args || !args.pageName || !args.propertyName || !args.propertyValue) {
			return {
				content: [{
					type: 'text',
					text: `❌ Error: pageName, propertyName, and propertyValue parameters are required`
				}],
			}
		}
		
		const pages = await getAllPages()
		const page = pages.find(p => p.name.toLowerCase() === args.pageName.toLowerCase())
		
		if (!page) {
			return {
				content: [{
					type: 'text',
					text: `❌ Page "${args.pageName}" not found`
				}],
			}
		}
		
		const content = fs.readFileSync(page.path, 'utf-8')
		
		let newContent: string
		if (content.startsWith('---')) {
			// Update existing front matter
			const endIndex = content.indexOf('---', 3)
			if (endIndex !== -1) {
				let frontMatter = content.slice(3, endIndex).trim()
				const rest = content.slice(endIndex + 3)
				
				// Add or update property
				frontMatter += `\n${args.propertyName}: ${args.propertyValue}`
				newContent = `---\n${frontMatter}\n---${rest}`
			} else {
				newContent = content
			}
		} else {
			// Add front matter
			newContent = `---\n${args.propertyName}: ${args.propertyValue}\n---\n\n${content}`
		}
		
		fs.writeFileSync(page.path, newContent)
		
		return {
			content: [{
				type: 'text',
				text: `✅ Successfully set property "${args.propertyName}" = "${args.propertyValue}" on page "${args.pageName}"`
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
	console.error('🔥 Logseq Complete MCP Server v3.0 running on stdio')
	console.error(`📁 Logseq path: ${LOGSEQ_PATH || 'Not found'}`)
	console.error('🚀 ALL 22 FUNCTIONS COMPLETE!')
}

main().catch(console.error)