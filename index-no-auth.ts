#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { glob } from 'glob'
import os from 'os'

const server = new McpServer({
	name: 'Logseq Tools (No Auth)',
	version: '1.0.0',
})

// Default Logseq directories to check
const POSSIBLE_LOGSEQ_PATHS = [
	path.join(os.homedir(), 'Documents', 'logseq'),
	path.join(os.homedir(), 'logseq'),
	path.join(os.homedir(), 'Logseq'),
	path.join(os.homedir(), 'Documents', 'Logseq'),
	'/Users/gonzaloriederer/logseq-graph', // Custom path
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
	content: string
	level: number
	todo?: 'TODO' | 'DOING' | 'DONE' | 'LATER' | 'NOW'
	scheduled?: string
	deadline?: string
	children?: LogseqBlock[]
}

interface LogseqPage {
	name: string
	path: string
	blocks: LogseqBlock[]
	properties?: Record<string, any>
	lastModified: Date
}

// Parse Logseq markdown blocks
function parseBlocks(content: string): LogseqBlock[] {
	const lines = content.split('\\n')
	const blocks: LogseqBlock[] = []

	for (const line of lines) {
		if (line.trim() === '') continue
		
		const level = Math.floor((line.match(/^\\s*/)?.[0]?.length || 0) / 2)
		let cleanLine = line.trim()
		
		// Remove bullet points
		cleanLine = cleanLine.replace(/^[-*+]\\s*/, '')
		
		// Parse TODO status
		let todo: LogseqBlock['todo'] | undefined
		const todoMatch = cleanLine.match(/^(TODO|DOING|DONE|LATER|NOW)\\s+(.*)$/)
		if (todoMatch) {
			todo = todoMatch[1] as LogseqBlock['todo']
			cleanLine = todoMatch[2]
		}
		
		// Parse scheduled and deadline
		const scheduledMatch = cleanLine.match(/SCHEDULED:\\s*<([^>]+)>/)
		const deadlineMatch = cleanLine.match(/DEADLINE:\\s*<([^>]+)>/)
		
		const block: LogseqBlock = {
			content: cleanLine.replace(/SCHEDULED:\\s*<[^>]+>|DEADLINE:\\s*<[^>]+>/g, '').trim(),
			level,
			todo,
			scheduled: scheduledMatch?.[1],
			deadline: deadlineMatch?.[1],
		}
		
		if (block.content) {
			blocks.push(block)
		}
	}
	
	return blocks
}

// Read a Logseq page file
async function readPageFile(filePath: string): Promise<LogseqPage | null> {
	try {
		const content = fs.readFileSync(filePath, 'utf-8')
		const stats = fs.statSync(filePath)
		
		// Parse front matter if present
		let properties: Record<string, any> = {}
		let markdownContent = content
		
		if (content.startsWith('---')) {
			const endIndex = content.indexOf('---', 3)
			if (endIndex !== -1) {
				const frontMatter = content.slice(3, endIndex).trim()
				markdownContent = content.slice(endIndex + 3)
				
				// Simple front matter parsing
				frontMatter.split('\\n').forEach(line => {
					const colonIndex = line.indexOf(':')
					if (colonIndex > 0) {
						const key = line.slice(0, colonIndex).trim()
						const value = line.slice(colonIndex + 1).trim()
						properties[key] = value
					}
				})
			}
		}
		
		const pageName = path.basename(filePath, '.md')
		const blocks = parseBlocks(markdownContent)
		
		return {
			name: pageName,
			path: filePath,
			blocks,
			properties,
			lastModified: stats.mtime,
		}
	} catch (error) {
		console.error(`Error reading page ${filePath}:`, error)
		return null
	}
}

// Get all pages from Logseq
async function getAllPages(): Promise<LogseqPage[]> {
	if (!LOGSEQ_PATH) {
		throw new Error('Logseq directory not found. Please ensure Logseq is installed and has created a graph.')
	}

	const pages: LogseqPage[] = []
	
	// Read pages directory
	const pagesDir = path.join(LOGSEQ_PATH, 'pages')
	if (fs.existsSync(pagesDir)) {
		const pageFiles = glob.sync('**/*.md', { cwd: pagesDir })
		for (const file of pageFiles) {
			const filePath = path.join(pagesDir, file)
			const page = await readPageFile(filePath)
			if (page) pages.push(page)
		}
	}
	
	// Read journals directory
	const journalsDir = path.join(LOGSEQ_PATH, 'journals')
	if (fs.existsSync(journalsDir)) {
		const journalFiles = glob.sync('**/*.md', { cwd: journalsDir })
		for (const file of journalFiles) {
			const filePath = path.join(journalsDir, file)
			const page = await readPageFile(filePath)
			if (page) pages.push(page)
		}
	}
	
	return pages
}

// Create a new page
async function createPage(pageName: string, content: string = ''): Promise<void> {
	if (!LOGSEQ_PATH) {
		throw new Error('Logseq directory not found')
	}
	
	const pagesDir = path.join(LOGSEQ_PATH, 'pages')
	if (!fs.existsSync(pagesDir)) {
		fs.mkdirSync(pagesDir, { recursive: true })
	}
	
	const filePath = path.join(pagesDir, `${pageName}.md`)
	
	let fileContent = content
	if (!content.trim()) {
		fileContent = `# ${pageName}\\n\\n- `
	}
	
	fs.writeFileSync(filePath, fileContent)
}

// Add block to page
async function addBlockToPage(pageName: string, blockContent: string, todo?: string): Promise<void> {
	const pages = await getAllPages()
	let targetPage = pages.find(p => p.name.toLowerCase() === pageName.toLowerCase())
	
	let filePath: string
	if (targetPage) {
		filePath = targetPage.path
	} else {
		// Create new page
		if (!LOGSEQ_PATH) throw new Error('Logseq directory not found')
		filePath = path.join(LOGSEQ_PATH, 'pages', `${pageName}.md`)
	}
	
	let blockText = `- `
	if (todo) blockText += `${todo} `
	blockText += blockContent
	
	if (fs.existsSync(filePath)) {
		const existingContent = fs.readFileSync(filePath, 'utf-8')
		fs.writeFileSync(filePath, existingContent + '\\n' + blockText)
	} else {
		fs.writeFileSync(filePath, `# ${pageName}\\n\\n${blockText}`)
	}
}

// Setup MCP server tools
server.tool('list_pages', {
	description: 'List all pages in the Logseq graph',
	inputSchema: {
		type: 'object',
		properties: {
			filter: {
				type: 'string',
				description: 'Optional filter to search for specific pages',
			},
		},
	},
}, async (args) => {
	try {
		const pages = await getAllPages()
		let filteredPages = pages
		
		if (args.filter) {
			filteredPages = pages.filter(page => 
				page.name.toLowerCase().includes(args.filter.toLowerCase())
			)
		}
		
		const pageList = filteredPages.map(page => ({
			name: page.name,
			blocks: page.blocks.length,
			lastModified: page.lastModified.toISOString(),
			todos: page.blocks.filter(block => block.todo).length
		}))
		
		return {
			content: [{
				type: 'text',
				text: `Found ${filteredPages.length} pages:\\n` + 
					pageList.map(p => `- **${p.name}** (${p.blocks} blocks, ${p.todos} todos, modified: ${p.lastModified.split('T')[0]})`).join('\\n')
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

server.tool('read_page', {
	description: 'Read the content of a specific page',
	inputSchema: {
		type: 'object',
		properties: {
			pageName: {
				type: 'string',
				description: 'Name of the page to read',
			},
		},
		required: ['pageName'],
	},
}, async (args) => {
	try {
		const pages = await getAllPages()
		const page = pages.find(p => p.name.toLowerCase() === args.pageName.toLowerCase())
		
		if (!page) {
			return {
				content: [{
					type: 'text',
					text: `Page "${args.pageName}" not found. Available pages: ${pages.map(p => p.name).join(', ')}`
				}],
			}
		}
		
		let content = `# ${page.name}\\n\\n`
		
		if (page.properties && Object.keys(page.properties).length > 0) {
			content += '**Properties:**\\n'
			for (const [key, value] of Object.entries(page.properties)) {
				content += `- ${key}: ${value}\\n`
			}
			content += '\\n'
		}
		
		content += '**Blocks:**\\n'
		for (const block of page.blocks) {
			const indent = '  '.repeat(block.level)
			let line = `${indent}- `
			
			if (block.todo) {
				line += `**${block.todo}** `
			}
			
			line += block.content
			
			if (block.scheduled) {
				line += ` 📅 Scheduled: ${block.scheduled}`
			}
			
			if (block.deadline) {
				line += ` ⏰ Deadline: ${block.deadline}`
			}
			
			content += line + '\\n'
		}
		
		return {
			content: [{
				type: 'text',
				text: content
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

server.tool('get_todos', {
	description: 'Get all TODO items from the graph',
	inputSchema: {
		type: 'object',
		properties: {
			status: {
				type: 'string',
				enum: ['TODO', 'DOING', 'DONE', 'LATER', 'NOW'],
				description: 'Filter by TODO status',
			},
			scheduled: {
				type: 'boolean',
				description: 'Only show scheduled todos',
				default: false,
			},
		},
	},
}, async (args) => {
	try {
		const pages = await getAllPages()
		const todos: { page: string; block: LogseqBlock }[] = []
		
		for (const page of pages) {
			for (const block of page.blocks) {
				if (!block.todo) continue
				if (args.status && block.todo !== args.status) continue
				if (args.scheduled && !block.scheduled) continue
				
				todos.push({ page: page.name, block })
			}
		}
		
		const todoText = todos.map(todo => {
			let line = `- **${todo.page}**: ${todo.block.todo} ${todo.block.content}`
			if (todo.block.scheduled) line += ` 📅 ${todo.block.scheduled}`
			if (todo.block.deadline) line += ` ⏰ ${todo.block.deadline}`
			return line
		}).join('\\n')
		
		const summary = `Found ${todos.length} todos:\\n\\n${todoText}`
		
		return {
			content: [{
				type: 'text',
				text: summary
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

server.tool('create_page', {
	description: 'Create a new page in Logseq',
	inputSchema: {
		type: 'object',
		properties: {
			pageName: {
				type: 'string',
				description: 'Name for the new page',
			},
			content: {
				type: 'string',
				description: 'Initial content for the page',
			},
		},
		required: ['pageName'],
	},
}, async (args) => {
	try {
		await createPage(args.pageName, args.content || '')
		
		return {
			content: [{
				type: 'text',
				text: `✅ Created page "${args.pageName}" successfully!`
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

server.tool('add_todo', {
	description: 'Add a TODO item to a page',
	inputSchema: {
		type: 'object',
		properties: {
			pageName: {
				type: 'string',
				description: 'Page to add the TODO to',
			},
			content: {
				type: 'string',
				description: 'Content of the TODO item',
			},
			status: {
				type: 'string',
				enum: ['TODO', 'DOING', 'LATER', 'NOW'],
				description: 'TODO status',
				default: 'TODO',
			},
		},
		required: ['pageName', 'content'],
	},
}, async (args) => {
	try {
		await addBlockToPage(args.pageName, args.content, args.status || 'TODO')
		
		return {
			content: [{
				type: 'text',
				text: `✅ Added ${args.status || 'TODO'} item to "${args.pageName}": ${args.content}`
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error adding TODO: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

server.tool('search_content', {
	description: 'Search for content across all pages',
	inputSchema: {
		type: 'object',
		properties: {
			query: {
				type: 'string',
				description: 'Text to search for',
			},
			todoOnly: {
				type: 'boolean',
				description: 'Only search in TODO blocks',
				default: false,
			},
		},
		required: ['query'],
	},
}, async (args) => {
	try {
		const pages = await getAllPages()
		const results: { page: string; block: LogseqBlock }[] = []
		
		for (const page of pages) {
			for (const block of page.blocks) {
				if (args.todoOnly && !block.todo) continue
				
				if (block.content.toLowerCase().includes(args.query.toLowerCase())) {
					results.push({ page: page.name, block })
				}
			}
		}
		
		const resultText = results.map(result => 
			`- **${result.page}**: ${result.block.todo ? result.block.todo + ' ' : ''}${result.block.content}`
		).join('\\n')
		
		return {
			content: [{
				type: 'text',
				text: `Found ${results.length} matches for "${args.query}":\\n\\n${resultText}`
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

server.tool('get_logseq_info', {
	description: 'Get information about the Logseq setup',
	inputSchema: {
		type: 'object',
		properties: {},
	},
}, async () => {
	try {
		if (!LOGSEQ_PATH) {
			return {
				content: [{
					type: 'text',
					text: `❌ Logseq directory not found. Checked paths:\\n${POSSIBLE_LOGSEQ_PATHS.map(p => `- ${p}`).join('\\n')}\\n\\nPlease ensure Logseq is installed and has created a graph.`
				}],
			}
		}
		
		const pages = await getAllPages()
		const totalBlocks = pages.reduce((sum, page) => sum + page.blocks.length, 0)
		const totalTodos = pages.reduce((sum, page) => 
			sum + page.blocks.filter(block => block.todo).length, 0)
		
		return {
			content: [{
				type: 'text',
				text: `✅ Logseq MCP Server Info:\\n\\n` +
					`📁 Graph Path: ${LOGSEQ_PATH}\\n` +
					`📄 Total Pages: ${pages.length}\\n` +
					`📝 Total Blocks: ${totalBlocks}\\n` +
					`✅ Total TODOs: ${totalTodos}\\n\\n` +
					`🔧 This server works by directly reading Logseq markdown files (no HTTP API needed).`
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

async function main() {
	const transport = new StdioServerTransport()
	await server.connect(transport)
	console.error('Logseq MCP Server (No Auth) running on stdio')
	console.error(`Logseq path: ${LOGSEQ_PATH || 'Not found'}`)
}

main().catch(console.error)