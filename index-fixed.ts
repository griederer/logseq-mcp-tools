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
			pageName: { type: 'string', description: 'Name of the page to read' }
		},
		required: ['pageName'],
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
			pageName: { type: 'string', description: 'Name of the page to create' },
			content: { type: 'string', description: 'Initial content' }
		},
		required: ['pageName'],
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
			query: { type: 'string', description: 'Search query' }
		},
		required: ['query'],
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

async function main() {
	const transport = new StdioServerTransport()
	await server.connect(transport)
	console.error('🔥 Logseq Fixed MCP Server v2.1 running on stdio')
	console.error(`📁 Logseq path: ${LOGSEQ_PATH || 'Not found'}`)
	console.error('🚀 Fixed parameter handling!')
}

main().catch(console.error)