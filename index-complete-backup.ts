#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { v4 as uuidv4 } from 'uuid'

const server = new McpServer({
	name: 'Logseq Complete',
	version: '2.0.0',
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

interface LogseqConfig {
	preferredFormat?: 'markdown' | 'org'
	preferredWorkflow?: 'now' | 'todo'
	journalPageTitleFormat?: string
	startOfWeek?: number
	enableJournals?: boolean
	shortcuts?: Record<string, string>
	theme?: 'light' | 'dark'
	customCSS?: string
}

// Utility functions
function generateUUID(): string {
	return uuidv4()
}

function formatDate(date: Date): string {
	return date.toISOString().split('T')[0]
}

function parseDate(dateStr: string): Date {
	if (dateStr === 'today') return new Date()
	if (dateStr === 'yesterday') {
		const date = new Date()
		date.setDate(date.getDate() - 1)
		return date
	}
	if (dateStr === 'tomorrow') {
		const date = new Date()
		date.setDate(date.getDate() + 1)
		return date
	}
	// Handle +7d, -3d format
	const relativeMatch = dateStr.match(/^([+-])(\d+)d$/)
	if (relativeMatch) {
		const date = new Date()
		const days = parseInt(relativeMatch[2])
		const direction = relativeMatch[1] === '+' ? 1 : -1
		date.setDate(date.getDate() + (days * direction))
		return date
	}
	return new Date(dateStr)
}

// Simple recursive file finder
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

// Advanced block parsing with all features
function parseBlocks(content: string): LogseqBlock[] {
	const lines = content.split('\\n')
	const blocks: LogseqBlock[] = []
	let currentBlock: LogseqBlock | null = null

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		if (line.trim() === '') continue
		
		const level = Math.floor((line.match(/^\\s*/)?.[0]?.length || 0) / 2)
		let cleanLine = line.trim()
		
		// Skip headers for block parsing
		if (cleanLine.startsWith('#')) continue
		
		// Remove bullet points
		cleanLine = cleanLine.replace(/^[-*+]\\s*/, '')
		
		// Parse block UUID if present
		let uuid = generateUUID()
		const uuidMatch = cleanLine.match(/^([a-f0-9-]{36})\\s+(.*)$/)
		if (uuidMatch) {
			uuid = uuidMatch[1]
			cleanLine = uuidMatch[2]
		}
		
		// Parse TODO status
		let todo: LogseqBlock['todo'] | undefined
		const todoMatch = cleanLine.match(/^(TODO|DOING|DONE|LATER|NOW|WAITING|IN-PROGRESS)\\s+(.*)$/)
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
		
		// Parse scheduled and deadline
		const scheduledMatch = cleanLine.match(/SCHEDULED:\\s*<([^>]+)>/)
		const deadlineMatch = cleanLine.match(/DEADLINE:\\s*<([^>]+)>/)
		
		// Parse properties
		const properties: Record<string, any> = {}
		const propertyMatches = cleanLine.matchAll(/:([\\w-]+):\\s*([^\\s]+)/g)
		for (const match of propertyMatches) {
			properties[match[1]] = match[2]
		}
		
		// Parse block references
		const refs: string[] = []
		const refMatches = cleanLine.matchAll(/\\(\\(([a-f0-9-]{36})\\)\\)/g)
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
		const tags: string[] = []
		for (const match of tagMatches) {
			tags.push(match[1])
		}
		
		// Clean content
		const content = cleanLine
			.replace(/SCHEDULED:\\s*<[^>]+>/g, '')
			.replace(/DEADLINE:\\s*<[^>]+>/g, '')
			.replace(/:([\\w-]+):\\s*([^\\s]+)/g, '')
			.replace(/\[#[ABC]\]/g, '')
			.trim()
		
		if (content) {
			const block: LogseqBlock = {
				uuid,
				content,
				level,
				todo,
				priority,
				scheduled: scheduledMatch?.[1],
				deadline: deadlineMatch?.[1],
				properties: Object.keys(properties).length > 0 ? properties : undefined,
				refs: refs.length > 0 ? refs : undefined,
				createdAt: new Date(),
				updatedAt: new Date(),
			}
			
			blocks.push(block)
		}
	}
	
	return blocks
}

// Enhanced page file reading
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
		
		const pageName = path.basename(filePath, path.extname(filePath))
		const blocks = parseBlocks(markdownContent)
		
		// Determine if it's a journal page
		const isJournal = filePath.includes('/journals/')
		let journalDay: number | undefined
		if (isJournal) {
			const dateMatch = pageName.match(/^(\\d{4})_(\\d{2})_(\\d{2})$/)
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
			createdAt: stats.birthtime,
		}
	} catch (error) {
		console.error(`Error reading page ${filePath}:`, error)
		return null
	}
}

// Get all pages from Logseq
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

// Configuration management
function getConfig(): LogseqConfig {
	if (!LOGSEQ_PATH) return {}
	
	const configPath = path.join(LOGSEQ_PATH, 'logseq', 'config.edn')
	if (!fs.existsSync(configPath)) return {}
	
	try {
		const configContent = fs.readFileSync(configPath, 'utf-8')
		// Simple EDN parsing for basic config
		const config: LogseqConfig = {}
		
		const preferredFormatMatch = configContent.match(/:preferred-format\s+:(\w+)/)
		if (preferredFormatMatch) {
			config.preferredFormat = preferredFormatMatch[1] as 'markdown' | 'org'
		}
		
		const journalMatch = configContent.match(/:journal\/page-title-format\s+"([^"]+)"/)
		if (journalMatch) {
			config.journalPageTitleFormat = journalMatch[1]
		}
		
		return config
	} catch (error) {
		console.error('Error reading config:', error)
		return {}
	}
}

function updateConfig(newConfig: Partial<LogseqConfig>): void {
	if (!LOGSEQ_PATH) throw new Error('Logseq directory not found')
	
	const logseqDir = path.join(LOGSEQ_PATH, 'logseq')
	if (!fs.existsSync(logseqDir)) {
		fs.mkdirSync(logseqDir, { recursive: true })
	}
	
	const configPath = path.join(logseqDir, 'config.edn')
	const currentConfig = getConfig()
	const mergedConfig = { ...currentConfig, ...newConfig }
	
	// Simple EDN generation
	let ednContent = '{\n'
	if (mergedConfig.preferredFormat) {
		ednContent += ` :preferred-format :${mergedConfig.preferredFormat}\\n`
	}
	if (mergedConfig.journalPageTitleFormat) {
		ednContent += ` :journal/page-title-format "${mergedConfig.journalPageTitleFormat}"\\n`
	}
	if (mergedConfig.startOfWeek !== undefined) {
		ednContent += ` :start-of-week ${mergedConfig.startOfWeek}\\n`
	}
	ednContent += '}'
	
	fs.writeFileSync(configPath, ednContent)
}

// Enhanced page creation
async function createPage(pageName: string, content: string = '', properties?: Record<string, any>): Promise<void> {
	if (!LOGSEQ_PATH) throw new Error('Logseq directory not found')
	
	const pagesDir = path.join(LOGSEQ_PATH, 'pages')
	if (!fs.existsSync(pagesDir)) {
		fs.mkdirSync(pagesDir, { recursive: true })
	}
	
	const filePath = path.join(pagesDir, `${pageName}.md`)
	
	let fileContent = ''
	
	// Add properties if provided
	if (properties && Object.keys(properties).length > 0) {
		fileContent += '---\\n'
		for (const [key, value] of Object.entries(properties)) {
			fileContent += `${key}: ${value}\\n`
		}
		fileContent += '---\\n\\n'
	}
	
	// Add title
	fileContent += `# ${pageName}\\n\\n`
	
	// Add content
	if (content.trim()) {
		fileContent += content
	} else {
		fileContent += '- '
	}
	
	fs.writeFileSync(filePath, fileContent)
}

// Create journal page
async function createJournalPage(date: Date): Promise<void> {
	if (!LOGSEQ_PATH) throw new Error('Logseq directory not found')
	
	const journalsDir = path.join(LOGSEQ_PATH, 'journals')
	if (!fs.existsSync(journalsDir)) {
		fs.mkdirSync(journalsDir, { recursive: true })
	}
	
	const dateStr = formatDate(date).replace(/-/g, '_')
	const filePath = path.join(journalsDir, `${dateStr}.md`)
	
	if (fs.existsSync(filePath)) {
		throw new Error(`Journal page for ${formatDate(date)} already exists`)
	}
	
	const config = getConfig()
	const titleFormat = config.journalPageTitleFormat || 'MMM do, yyyy'
	const title = date.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	})
	
	const content = `# ${title}\\n\\n- `
	fs.writeFileSync(filePath, content)
}

// Delete page
async function deletePage(pageName: string): Promise<void> {
	const pages = await getAllPages()
	const page = pages.find(p => p.name.toLowerCase() === pageName.toLowerCase())
	
	if (!page) {
		throw new Error(`Page "${pageName}" not found`)
	}
	
	fs.unlinkSync(page.path)
}

// Rename page
async function renamePage(oldName: string, newName: string): Promise<void> {
	const pages = await getAllPages()
	const page = pages.find(p => p.name.toLowerCase() === oldName.toLowerCase())
	
	if (!page) {
		throw new Error(`Page "${oldName}" not found`)
	}
	
	const newPath = path.join(path.dirname(page.path), `${newName}.md`)
	fs.renameSync(page.path, newPath)
}

// Block manipulation functions
async function insertBlock(pageName: string, content: string, options?: {
	todo?: string
	priority?: 'A' | 'B' | 'C'
	scheduled?: string
	deadline?: string
	properties?: Record<string, any>
	position?: 'first' | 'last' | number
}): Promise<string> {
	const pages = await getAllPages()
	let targetPage = pages.find(p => p.name.toLowerCase() === pageName.toLowerCase())
	
	let filePath: string
	if (targetPage) {
		filePath = targetPage.path
	} else {
		await createPage(pageName)
		filePath = path.join(LOGSEQ_PATH!, 'pages', `${pageName}.md`)
	}
	
	const blockUuid = generateUUID()
	let blockText = `- `
	
	// Add UUID
	blockText += `${blockUuid} `
	
	// Add TODO status
	if (options?.todo) blockText += `${options.todo} `
	
	// Add priority
	if (options?.priority) blockText += `[#${options.priority}] `
	
	// Add content
	blockText += content
	
	// Add scheduled
	if (options?.scheduled) {
		const date = parseDate(options.scheduled)
		blockText += ` SCHEDULED: <${formatDate(date)}>`
	}
	
	// Add deadline
	if (options?.deadline) {
		const date = parseDate(options.deadline)
		blockText += ` DEADLINE: <${formatDate(date)}>`
	}
	
	// Add properties
	if (options?.properties) {
		for (const [key, value] of Object.entries(options.properties)) {
			blockText += ` :${key}: ${value}`
		}
	}
	
	const existingContent = fs.readFileSync(filePath, 'utf-8')
	const lines = existingContent.split('\\n')
	
	// Find insertion point
	let insertIndex = lines.length
	if (options?.position === 'first') {
		// Find first block line (after title)
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].trim().startsWith('- ')) {
				insertIndex = i
				break
			}
		}
	} else if (typeof options?.position === 'number') {
		insertIndex = Math.min(options.position, lines.length)
	}
	
	lines.splice(insertIndex, 0, blockText)
	fs.writeFileSync(filePath, lines.join('\\n'))
	
	return blockUuid
}

// Update block
async function updateBlock(blockUuid: string, newContent: string, options?: {
	todo?: string
	priority?: 'A' | 'B' | 'C'
	scheduled?: string
	deadline?: string
	properties?: Record<string, any>
}): Promise<void> {
	const pages = await getAllPages()
	
	for (const page of pages) {
		const block = page.blocks.find(b => b.uuid === blockUuid)
		if (block) {
			const content = fs.readFileSync(page.path, 'utf-8')
			const lines = content.split('\\n')
			
			// Find and update the block
			for (let i = 0; i < lines.length; i++) {
				if (lines[i].includes(blockUuid)) {
					let newBlockText = `- ${blockUuid} `
					
					if (options?.todo) newBlockText += `${options.todo} `
					if (options?.priority) newBlockText += `[#${options.priority}] `
					
					newBlockText += newContent
					
					if (options?.scheduled) {
						const date = parseDate(options.scheduled)
						newBlockText += ` SCHEDULED: <${formatDate(date)}>`
					}
					
					if (options?.deadline) {
						const date = parseDate(options.deadline)
						newBlockText += ` DEADLINE: <${formatDate(date)}>`
					}
					
					if (options?.properties) {
						for (const [key, value] of Object.entries(options.properties)) {
							newBlockText += ` :${key}: ${value}`
						}
					}
					
					lines[i] = newBlockText
					fs.writeFileSync(page.path, lines.join('\\n'))
					return
				}
			}
		}
	}
	
	throw new Error(`Block with UUID ${blockUuid} not found`)
}

// Delete block
async function deleteBlock(blockUuid: string): Promise<void> {
	const pages = await getAllPages()
	
	for (const page of pages) {
		const content = fs.readFileSync(page.path, 'utf-8')
		const lines = content.split('\\n')
		
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].includes(blockUuid)) {
				lines.splice(i, 1)
				fs.writeFileSync(page.path, lines.join('\\n'))
				return
			}
		}
	}
	
	throw new Error(`Block with UUID ${blockUuid} not found`)
}

// Advanced search function
async function searchContent(query: string, options?: {
	pages?: string[]
	includeBlocks?: boolean
	includeProperties?: boolean
	caseSensitive?: boolean
	todo?: string
	dateRange?: { start: string; end: string }
}): Promise<any[]> {
	const pages = await getAllPages()
	const results: any[] = []
	
	const searchRegex = new RegExp(
		query.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&'),
		options?.caseSensitive ? 'g' : 'gi'
	)
	
	for (const page of pages) {
		// Filter by page names if specified
		if (options?.pages && !options.pages.some(p => 
			page.name.toLowerCase().includes(p.toLowerCase())
		)) {
			continue
		}
		
		// Search in page title
		if (searchRegex.test(page.name) || searchRegex.test(page.title || '')) {
			results.push({
				type: 'page',
				page: page.name,
				match: page.title || page.name,
				context: 'Page title'
			})
		}
		
		// Search in page properties
		if (options?.includeProperties && page.properties) {
			for (const [key, value] of Object.entries(page.properties)) {
				if (searchRegex.test(String(value))) {
					results.push({
						type: 'property',
						page: page.name,
						property: key,
						value: value,
						match: String(value)
					})
				}
			}
		}
		
		// Search in blocks
		if (options?.includeBlocks !== false) {
			for (const block of page.blocks) {
				// Filter by TODO status
				if (options?.todo && block.todo !== options.todo) continue
				
				// Filter by date range
				if (options?.dateRange) {
					const startDate = parseDate(options.dateRange.start)
					const endDate = parseDate(options.dateRange.end)
					const blockDate = block.scheduled ? parseDate(block.scheduled) : 
									 block.deadline ? parseDate(block.deadline) : null
					
					if (!blockDate || blockDate < startDate || blockDate > endDate) {
						continue
					}
				}
				
				if (searchRegex.test(block.content)) {
					results.push({
						type: 'block',
						page: page.name,
						blockId: block.uuid,
						content: block.content,
						todo: block.todo,
						scheduled: block.scheduled,
						deadline: block.deadline,
						match: block.content
					})
				}
			}
		}
	}
	
	return results
}

// Export function
async function exportGraph(format: 'json' | 'markdown' | 'org'): Promise<string> {
	const pages = await getAllPages()
	const config = getConfig()
	
	if (format === 'json') {
		return JSON.stringify({
			config,
			pages,
			exportedAt: new Date().toISOString()
		}, null, 2)
	}
	
	let output = ''
	for (const page of pages) {
		if (format === 'markdown') {
			output += `# ${page.title || page.name}\\n\\n`
		} else {
			output += `* ${page.title || page.name}\\n\\n`
		}
		
		for (const block of page.blocks) {
			const indent = '  '.repeat(block.level)
			const bullet = format === 'markdown' ? '-' : '-'
			let line = `${indent}${bullet} `
			
			if (block.todo) line += `${block.todo} `
			if (block.priority) line += `[#${block.priority}] `
			
			line += block.content
			
			if (block.scheduled) line += ` SCHEDULED: <${block.scheduled}>`
			if (block.deadline) line += ` DEADLINE: <${block.deadline}>`
			
			output += line + '\\n'
		}
		
		output += '\\n'
	}
	
	return output
}

// Now let's define all the MCP tools
server.tool('get_system_info', {
	description: 'Get comprehensive information about the Logseq system',
	inputSchema: { type: 'object', properties: {} },
}, async () => {
	try {
		if (!LOGSEQ_PATH) {
			return {
				content: [{
					type: 'text',
					text: `❌ Logseq directory not found. Checked paths:\\n${POSSIBLE_LOGSEQ_PATHS.map(p => `- ${p}`).join('\\n')}`
				}],
			}
		}
		
		const pages = await getAllPages()
		const config = getConfig()
		const totalBlocks = pages.reduce((sum, page) => sum + page.blocks.length, 0)
		const totalTodos = pages.reduce((sum, page) => 
			sum + page.blocks.filter(block => block.todo).length, 0)
		const journalPages = pages.filter(p => p.isJournal).length
		const regularPages = pages.length - journalPages
		
		return {
			content: [{
				type: 'text',
				text: `🔥 **Logseq Complete MCP Server v2.0** \\n\\n` +
					`📁 **Graph Path**: ${LOGSEQ_PATH}\\n` +
					`📄 **Total Pages**: ${pages.length} (${regularPages} regular, ${journalPages} journals)\\n` +
					`📝 **Total Blocks**: ${totalBlocks}\\n` +
					`✅ **Total TODOs**: ${totalTodos}\\n` +
					`⚙️ **Config Format**: ${config.preferredFormat || 'markdown'}\\n` +
					`📅 **Journal Format**: ${config.journalPageTitleFormat || 'default'}\\n\\n` +
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

// Page Management Tools
server.tool('list_pages', {
	description: 'List all pages with comprehensive filtering options',
	inputSchema: {
		type: 'object',
		properties: {
			filter: { type: 'string', description: 'Filter by page name' },
			includeJournals: { type: 'boolean', default: true },
			includeRegular: { type: 'boolean', default: true },
			namespace: { type: 'string', description: 'Filter by namespace' },
			hasProperty: { type: 'string', description: 'Filter pages that have this property' },
			sortBy: { type: 'string', enum: ['name', 'created', 'modified'], default: 'name' }
		},
	},
}, async (args) => {
	try {
		let pages = await getAllPages()
		
		// Apply filters
		if (!args.includeJournals) {
			pages = pages.filter(p => !p.isJournal)
		}
		if (!args.includeRegular) {
			pages = pages.filter(p => p.isJournal)
		}
		if (args.filter) {
			pages = pages.filter(p => 
				p.name.toLowerCase().includes(args.filter!.toLowerCase()) ||
				(p.title && p.title.toLowerCase().includes(args.filter!.toLowerCase()))
			)
		}
		if (args.namespace) {
			pages = pages.filter(p => p.namespace === args.namespace)
		}
		if (args.hasProperty) {
			pages = pages.filter(p => p.properties && args.hasProperty! in p.properties)
		}
		
		// Sort pages
		if (args.sortBy === 'created') {
			pages.sort((a, b) => (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0))
		} else if (args.sortBy === 'modified') {
			pages.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime())
		} else {
			pages.sort((a, b) => a.name.localeCompare(b.name))
		}
		
		return {
			content: [{
				type: 'text',
				text: `📋 Found ${pages.length} pages:\\n\\n` + 
					pages.map(p => {
						const type = p.isJournal ? '📅' : '📄'
						const namespace = p.namespace ? `${p.namespace}/` : ''
						const todos = p.blocks.filter(b => b.todo).length
						const props = p.properties ? Object.keys(p.properties).length : 0
						return `${type} **${namespace}${p.name}**\\n` +
							   `   - ${p.blocks.length} blocks, ${todos} todos, ${props} properties\\n` +
							   `   - Modified: ${p.lastModified.toLocaleDateString()}`
					}).join('\\n\\n')
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

server.tool('read_page', {
	description: 'Read complete page content with all metadata',
	inputSchema: {
		type: 'object',
		properties: {
			pageName: { type: 'string', description: 'Name of the page to read' },
			includeBlocks: { type: 'boolean', default: true },
			includeProperties: { type: 'boolean', default: true },
			includeMetadata: { type: 'boolean', default: true }
		},
		required: ['pageName'],
	},
}, async (args) => {
	try {
		const pages = await getAllPages()
		const page = pages.find(p => 
			p.name.toLowerCase() === args.pageName.toLowerCase() ||
			(p.title && p.title.toLowerCase() === args.pageName.toLowerCase())
		)
		
		if (!page) {
			return {
				content: [{
					type: 'text',
					text: `❌ Page "${args.pageName}" not found.\\n\\n📋 Available pages: ${pages.map(p => p.name).slice(0, 10).join(', ')}${pages.length > 10 ? '...' : ''}`
				}],
			}
		}
		
		let content = `# 📄 ${page.title || page.name}\\n\\n`
		
		// Metadata
		if (args.includeMetadata) {
			content += `**Metadata:**\\n`
			content += `- UUID: ${page.uuid}\\n`
			content += `- Type: ${page.isJournal ? 'Journal' : 'Regular'} Page\\n`
			if (page.namespace) content += `- Namespace: ${page.namespace}\\n`
			if (page.aliases) content += `- Aliases: ${page.aliases.join(', ')}\\n`
			content += `- Created: ${page.createdAt?.toLocaleDateString() || 'Unknown'}\\n`
			content += `- Modified: ${page.lastModified.toLocaleDateString()}\\n`
			content += `- Blocks: ${page.blocks.length}\\n\\n`
		}
		
		// Properties
		if (args.includeProperties && page.properties && Object.keys(page.properties).length > 0) {
			content += `**Properties:**\\n`
			for (const [key, value] of Object.entries(page.properties)) {
				content += `- ${key}: ${value}\\n`
			}
			content += '\\n'
		}
		
		// Blocks
		if (args.includeBlocks) {
			content += `**Content:**\\n`
			for (const block of page.blocks) {
				const indent = '  '.repeat(block.level)
				let line = `${indent}- `
				
				if (block.todo) {
					const emoji = block.todo === 'DONE' ? '✅' : 
								 block.todo === 'DOING' ? '🔄' : 
								 block.todo === 'NOW' ? '🔥' : '⭕'
					line += `${emoji} **${block.todo}** `
				}
				
				if (block.priority) {
					line += `🏷️ [#${block.priority}] `
				}
				
				line += block.content
				
				if (block.scheduled) line += ` 📅 ${block.scheduled}`
				if (block.deadline) line += ` ⏰ ${block.deadline}`
				if (block.properties) {
					const props = Object.entries(block.properties).map(([k, v]) => `${k}:${v}`).join(' ')
					line += ` 🏷️ ${props}`
				}
				
				content += line + '\\n'
			}
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

server.tool('create_page', {
	description: 'Create a new page with full configuration options',
	inputSchema: {
		type: 'object',
		properties: {
			pageName: { type: 'string', description: 'Name of the page to create' },
			content: { type: 'string', description: 'Initial content', default: '' },
			properties: { type: 'object', description: 'Page properties' },
			template: { type: 'string', description: 'Template to use' }
		},
		required: ['pageName'],
	},
}, async (args) => {
	try {
		await createPage(args.pageName, args.content || '', args.properties)
		
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

server.tool('delete_page', {
	description: 'Delete a page completely',
	inputSchema: {
		type: 'object',
		properties: {
			pageName: { type: 'string', description: 'Name of the page to delete' },
			confirm: { type: 'boolean', description: 'Confirmation flag', default: false }
		},
		required: ['pageName', 'confirm'],
	},
}, async (args) => {
	try {
		if (!args.confirm) {
			return {
				content: [{
					type: 'text',
					text: `⚠️ Page deletion requires confirmation. Use confirm: true to delete "${args.pageName}"`
				}],
			}
		}
		
		await deletePage(args.pageName)
		
		return {
			content: [{
				type: 'text',
				text: `✅ Deleted page "${args.pageName}" successfully!`
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

server.tool('rename_page', {
	description: 'Rename a page',
	inputSchema: {
		type: 'object',
		properties: {
			oldName: { type: 'string', description: 'Current page name' },
			newName: { type: 'string', description: 'New page name' }
		},
		required: ['oldName', 'newName'],
	},
}, async (args) => {
	try {
		await renamePage(args.oldName, args.newName)
		
		return {
			content: [{
				type: 'text',
				text: `✅ Renamed page from "${args.oldName}" to "${args.newName}" successfully!`
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

// Block Management Tools
server.tool('insert_block', {
	description: 'Insert a new block with full options',
	inputSchema: {
		type: 'object',
		properties: {
			pageName: { type: 'string', description: 'Page to add the block to' },
			content: { type: 'string', description: 'Block content' },
			todo: { type: 'string', enum: ['TODO', 'DOING', 'DONE', 'LATER', 'NOW', 'WAITING'] },
			priority: { type: 'string', enum: ['A', 'B', 'C'] },
			scheduled: { type: 'string', description: 'Scheduled date (YYYY-MM-DD or relative like +7d)' },
			deadline: { type: 'string', description: 'Deadline date' },
			properties: { type: 'object', description: 'Block properties' },
			position: { type: 'string', description: 'Position: first, last, or number' }
		},
		required: ['pageName', 'content'],
	},
}, async (args) => {
	try {
		const position = args.position === 'first' ? 'first' : 
						args.position === 'last' ? 'last' : 
						isNaN(Number(args.position)) ? undefined : Number(args.position)
		
		const blockUuid = await insertBlock(args.pageName, args.content, {
			todo: args.todo as any,
			priority: args.priority as any,
			scheduled: args.scheduled,
			deadline: args.deadline,
			properties: args.properties,
			position
		})
		
		return {
			content: [{
				type: 'text',
				text: `✅ Inserted block in "${args.pageName}"\\n` +
					  `🆔 Block UUID: ${blockUuid}\\n` +
					  `📝 Content: ${args.content}\\n` +
					  `${args.todo ? `✅ Status: ${args.todo}\\n` : ''}` +
					  `${args.scheduled ? `📅 Scheduled: ${args.scheduled}\\n` : ''}` +
					  `${args.deadline ? `⏰ Deadline: ${args.deadline}\\n` : ''}`
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

server.tool('update_block', {
	description: 'Update an existing block',
	inputSchema: {
		type: 'object',
		properties: {
			blockUuid: { type: 'string', description: 'UUID of the block to update' },
			content: { type: 'string', description: 'New block content' },
			todo: { type: 'string', enum: ['TODO', 'DOING', 'DONE', 'LATER', 'NOW', 'WAITING'] },
			priority: { type: 'string', enum: ['A', 'B', 'C'] },
			scheduled: { type: 'string', description: 'Scheduled date' },
			deadline: { type: 'string', description: 'Deadline date' },
			properties: { type: 'object', description: 'Block properties' }
		},
		required: ['blockUuid'],
	},
}, async (args) => {
	try {
		await updateBlock(args.blockUuid, args.content || '', {
			todo: args.todo as any,
			priority: args.priority as any,
			scheduled: args.scheduled,
			deadline: args.deadline,
			properties: args.properties
		})
		
		return {
			content: [{
				type: 'text',
				text: `✅ Updated block ${args.blockUuid} successfully!`
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

server.tool('delete_block', {
	description: 'Delete a specific block',
	inputSchema: {
		type: 'object',
		properties: {
			blockUuid: { type: 'string', description: 'UUID of the block to delete' },
			confirm: { type: 'boolean', description: 'Confirmation flag', default: false }
		},
		required: ['blockUuid', 'confirm'],
	},
}, async (args) => {
	try {
		if (!args.confirm) {
			return {
				content: [{
					type: 'text',
					text: `⚠️ Block deletion requires confirmation. Use confirm: true to delete block ${args.blockUuid}`
				}],
			}
		}
		
		await deleteBlock(args.blockUuid)
		
		return {
			content: [{
				type: 'text',
				text: `✅ Deleted block ${args.blockUuid} successfully!`
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

// TODO Management Tools
server.tool('get_todos', {
	description: 'Get all TODOs with advanced filtering',
	inputSchema: {
		type: 'object',
		properties: {
			status: { type: 'string', enum: ['TODO', 'DOING', 'DONE', 'LATER', 'NOW', 'WAITING'] },
			priority: { type: 'string', enum: ['A', 'B', 'C'] },
			scheduled: { type: 'boolean', description: 'Only show scheduled todos' },
			dueSoon: { type: 'number', description: 'Show todos due within N days' },
			page: { type: 'string', description: 'Filter by page name' },
			groupBy: { type: 'string', enum: ['status', 'priority', 'page'], default: 'status' }
		},
	},
}, async (args) => {
	try {
		const pages = await getAllPages()
		const todos: { page: string; block: LogseqBlock }[] = []
		
		for (const page of pages) {
			// Filter by page if specified
			if (args.page && !page.name.toLowerCase().includes(args.page.toLowerCase())) {
				continue
			}
			
			for (const block of page.blocks) {
				if (!block.todo) continue
				if (args.status && block.todo !== args.status) continue
				if (args.priority && block.priority !== args.priority) continue
				if (args.scheduled && !block.scheduled) continue
				
				// Check due soon
				if (args.dueSoon) {
					const dueDate = block.deadline ? parseDate(block.deadline) : 
								   block.scheduled ? parseDate(block.scheduled) : null
					if (dueDate) {
						const today = new Date()
						const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
						if (diffDays > args.dueSoon) continue
					}
				}
				
				todos.push({ page: page.name, block })
			}
		}
		
		// Group todos
		const grouped = todos.reduce((acc, todo) => {
			let key: string
			if (args.groupBy === 'priority') {
				key = todo.block.priority || 'No Priority'
			} else if (args.groupBy === 'page') {
				key = todo.page
			} else {
				key = todo.block.todo!
			}
			
			if (!acc[key]) acc[key] = []
			acc[key].push(todo)
			return acc
		}, {} as Record<string, typeof todos>)
		
		let summary = `📋 Found ${todos.length} todos:\\n\\n`
		
		for (const [group, groupTodos] of Object.entries(grouped)) {
			const emoji = group === 'DONE' ? '✅' : 
						 group === 'DOING' ? '🔄' : 
						 group === 'NOW' ? '🔥' : 
						 group === 'A' ? '🔴' :
						 group === 'B' ? '🟡' :
						 group === 'C' ? '🟢' : '⭕'
			
			summary += `${emoji} **${group}** (${groupTodos.length}):\\n`
			
			for (const todo of groupTodos) {
				let line = `  - **${todo.page}**: ${todo.block.content}`
				if (todo.block.priority) line += ` [#${todo.block.priority}]`
				if (todo.block.scheduled) line += ` 📅 ${todo.block.scheduled}`
				if (todo.block.deadline) line += ` ⏰ ${todo.block.deadline}`
				if (todo.block.properties) {
					const props = Object.entries(todo.block.properties).map(([k, v]) => `${k}:${v}`).join(' ')
					line += ` 🏷️ ${props}`
				}
				line += ` 🆔 ${todo.block.uuid}`
				summary += line + '\\n'
			}
			summary += '\\n'
		}
		
		return {
			content: [{ type: 'text', text: summary }],
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

// Journal Management
server.tool('create_journal_page', {
	description: 'Create a journal page for a specific date',
	inputSchema: {
		type: 'object',
		properties: {
			date: { type: 'string', description: 'Date (YYYY-MM-DD, today, tomorrow, +7d)' }
		},
		required: ['date'],
	},
}, async (args) => {
	try {
		const date = parseDate(args.date)
		await createJournalPage(date)
		
		return {
			content: [{
				type: 'text',
				text: `✅ Created journal page for ${formatDate(date)} successfully!`
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

// Search Tools
server.tool('search', {
	description: 'Advanced search across all content',
	inputSchema: {
		type: 'object',
		properties: {
			query: { type: 'string', description: 'Search query' },
			includePages: { type: 'boolean', default: true },
			includeBlocks: { type: 'boolean', default: true },
			includeProperties: { type: 'boolean', default: false },
			caseSensitive: { type: 'boolean', default: false },
			pages: { type: 'array', items: { type: 'string' }, description: 'Limit to specific pages' },
			todo: { type: 'string', description: 'Filter by TODO status' },
			dateRange: { 
				type: 'object', 
				properties: {
					start: { type: 'string' },
					end: { type: 'string' }
				}
			}
		},
		required: ['query'],
	},
}, async (args) => {
	try {
		const results = await searchContent(args.query, {
			pages: args.pages,
			includeBlocks: args.includeBlocks,
			includeProperties: args.includeProperties,
			caseSensitive: args.caseSensitive,
			todo: args.todo,
			dateRange: args.dateRange
		})
		
		if (results.length === 0) {
			return {
				content: [{
					type: 'text',
					text: `🔍 No results found for "${args.query}"`
				}],
			}
		}
		
		let output = `🔍 Found ${results.length} results for "${args.query}":\\n\\n`
		
		const byType = results.reduce((acc, result) => {
			if (!acc[result.type]) acc[result.type] = []
			acc[result.type].push(result)
			return acc
		}, {} as Record<string, typeof results>)
		
		for (const [type, typeResults] of Object.entries(byType)) {
			const emoji = type === 'page' ? '📄' : type === 'block' ? '📝' : '🏷️'
			output += `${emoji} **${type.toUpperCase()}** (${typeResults.length}):\\n`
			
			for (const result of typeResults.slice(0, 10)) {
				if (result.type === 'page') {
					output += `  - **${result.page}**: ${result.match}\\n`
				} else if (result.type === 'block') {
					output += `  - **${result.page}**: ${result.content}\\n`
					if (result.todo) output += `    ${result.todo}`
					if (result.scheduled) output += ` 📅 ${result.scheduled}`
					if (result.deadline) output += ` ⏰ ${result.deadline}`
					output += `\\n    🆔 ${result.blockId}\\n`
				} else {
					output += `  - **${result.page}** → ${result.property}: ${result.value}\\n`
				}
			}
			
			if (typeResults.length > 10) {
				output += `  ... and ${typeResults.length - 10} more\\n`
			}
			output += '\\n'
		}
		
		return {
			content: [{ type: 'text', text: output }],
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

// Configuration Tools
server.tool('get_config', {
	description: 'Get current Logseq configuration',
	inputSchema: { type: 'object', properties: {} },
}, async () => {
	try {
		const config = getConfig()
		
		return {
			content: [{
				type: 'text',
				text: `⚙️ **Logseq Configuration:**\\n\\n` +
					  `📝 Preferred Format: ${config.preferredFormat || 'markdown'}\\n` +
					  `📅 Journal Title Format: ${config.journalPageTitleFormat || 'MMM do, yyyy'}\\n` +
					  `📆 Start of Week: ${config.startOfWeek || 0} (0=Sunday)\\n` +
					  `📓 Journals Enabled: ${config.enableJournals !== false}\\n` +
					  `🎨 Theme: ${config.theme || 'system'}\\n`
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

server.tool('update_config', {
	description: 'Update Logseq configuration',
	inputSchema: {
		type: 'object',
		properties: {
			preferredFormat: { type: 'string', enum: ['markdown', 'org'] },
			journalPageTitleFormat: { type: 'string' },
			startOfWeek: { type: 'number', minimum: 0, maximum: 6 },
			enableJournals: { type: 'boolean' },
			theme: { type: 'string', enum: ['light', 'dark'] }
		},
	},
}, async (args) => {
	try {
		updateConfig(args)
		
		return {
			content: [{
				type: 'text',
				text: `✅ Configuration updated successfully!`
			}],
		}
	} catch (error) {
		return {
			content: [{
				type: 'text',
				text: `❌ Error updating config: ${error instanceof Error ? error.message : 'Unknown error'}`
			}],
		}
	}
})

// Export Tools
server.tool('export_graph', {
	description: 'Export the entire graph in various formats',
	inputSchema: {
		type: 'object',
		properties: {
			format: { type: 'string', enum: ['json', 'markdown', 'org'], default: 'json' },
			includeConfig: { type: 'boolean', default: true }
		},
	},
}, async (args) => {
	try {
		const exported = await exportGraph(args.format || 'json')
		
		return {
			content: [{
				type: 'text',
				text: `📤 **Graph Export (${args.format}):**\\n\\n\`\`\`${args.format}\\n${exported.slice(0, 2000)}${exported.length > 2000 ? '\\n\\n... (truncated, full export available)' : ''}\\n\`\`\``
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

async function main() {
	const transport = new StdioServerTransport()
	await server.connect(transport)
	console.error('🔥 Logseq Complete MCP Server v2.0 running on stdio')
	console.error(`📁 Logseq path: ${LOGSEQ_PATH || 'Not found'}`)
	console.error('🚀 Full Logseq control available!')
}

main().catch(console.error)