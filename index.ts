import * as dotenv from 'dotenv'
dotenv.config()

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const LOGSEQ_TOKEN = process.env.LOGSEQ_TOKEN

const server = new McpServer({
	name: 'Logseq Tools',
	version: '1.0.0',
})

// Regular expression to find Logseq page links like [[page name]]
const PAGE_LINK_REGEX = /\[\[(.*?)\]\]/g

server.tool('getAllPages', async () => {
	try {
		const response = await fetch('http://127.0.0.1:12315/api', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${LOGSEQ_TOKEN}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				method: 'logseq.Editor.getAllPages',
			}),
		})

		if (!response.ok) {
			throw new Error(
				`Logseq API error: ${response.status} ${response.statusText}`
			)
		}

		const pages = await response.json()

		return {
			content: [
				{
					type: 'text',
					text: JSON.stringify(pages),
				},
			],
		}
	} catch (error) {
		return {
			content: [
				{
					type: 'text',
					text: `Error fetching Logseq pages: ${error.message}`,
				},
			],
		}
	}
})

// Get content for a specific page by name or UUID
async function getPageContent(pageNameOrUuid: string) {
	try {
		const response = await fetch('http://127.0.0.1:12315/api', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${LOGSEQ_TOKEN}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				method: 'logseq.Editor.getPageBlocksTree',
				args: [pageNameOrUuid],
			}),
		})

		if (!response.ok) {
			throw new Error(
				`Logseq API error: ${response.status} ${response.statusText}`
			)
		}

		return await response.json()
	} catch (error) {
		console.error(`Error fetching page content: ${error.message}`)
		return null
	}
}

// Format a date as a string in the format that Logseq journal pages use
function formatJournalDate(date: Date): string {
	const month = date.toLocaleString('en-US', { month: 'short' }).toLowerCase()
	const day = date.getDate()
	const year = date.getFullYear()
	return `${month} ${day}${getDaySuffix(day)}, ${year}`
}

// Get the appropriate suffix for a day number (1st, 2nd, 3rd, etc.)
function getDaySuffix(day: number): string {
	if (day >= 11 && day <= 13) return 'th'

	switch (day % 10) {
		case 1:
			return 'st'
		case 2:
			return 'nd'
		case 3:
			return 'rd'
		default:
			return 'th'
	}
}

// Helper function to parse date range from natural language
function parseDateRange(dateRange: string): {
	start: Date
	end: Date
	title: string
} {
	const today = new Date()
	const end = new Date(today)
	end.setHours(23, 59, 59, 999) // End of today
	let start = new Date(today)
	let title = ''

	const normalizedRange = dateRange.toLowerCase().trim()

	switch (normalizedRange) {
		case 'today':
			start.setHours(0, 0, 0, 0) // Start of today
			title = "Today's Journal Summary"
			break
		case 'yesterday':
			start.setDate(today.getDate() - 1)
			start.setHours(0, 0, 0, 0)
			end.setDate(today.getDate() - 1)
			title = "Yesterday's Journal Summary"
			break
		case 'this week':
			start.setDate(today.getDate() - today.getDay()) // Start of week (Sunday)
			start.setHours(0, 0, 0, 0)
			title = 'Weekly Journal Summary'
			break
		case 'last week':
			start.setDate(today.getDate() - today.getDay() - 7) // Start of last week
			start.setHours(0, 0, 0, 0)
			end.setDate(today.getDate() - today.getDay() - 1)
			end.setHours(23, 59, 59, 999)
			title = "Last Week's Journal Summary"
			break
		case 'this month':
			start.setDate(1) // Start of current month
			start.setHours(0, 0, 0, 0)
			title = `Journal Summary for ${today.toLocaleString('en-US', {
				month: 'long',
			})} ${today.getFullYear()}`
			break
		case 'last month':
			start.setMonth(today.getMonth() - 1, 1) // Start of last month
			start.setHours(0, 0, 0, 0)
			end.setDate(0) // Last day of previous month
			title = `Journal Summary for ${start.toLocaleString('en-US', {
				month: 'long',
			})} ${start.getFullYear()}`
			break
		case 'this year':
			start.setMonth(0, 1) // January 1st
			start.setHours(0, 0, 0, 0)
			title = `Journal Summary for ${today.getFullYear()}`
			break
		case 'last year':
			start.setFullYear(today.getFullYear() - 1, 0, 1) // January 1st of last year
			start.setHours(0, 0, 0, 0)
			end.setFullYear(today.getFullYear() - 1, 11, 31) // December 31st of last year
			end.setHours(23, 59, 59, 999)
			title = `Journal Summary for ${today.getFullYear() - 1}`
			break
		case 'year to date':
			start.setMonth(0, 1) // January 1st of current year
			start.setHours(0, 0, 0, 0)
			title = `Year-to-Date Journal Summary for ${today.getFullYear()}`
			break
		default:
			// Default to current week if input doesn't match any pattern
			start.setDate(today.getDate() - today.getDay()) // Start of week (Sunday)
			start.setHours(0, 0, 0, 0)
			title = 'Weekly Journal Summary'
	}

	return { start, end, title }
}

// Get a page's content and extract linked pages
server.tool(
	'getPage',
	{
		pageName: z.string().describe('Name of the Logseq page to retrieve'),
	},
	async ({ pageName }) => {
		try {
			const content = await getPageContent(pageName)

			if (!content) {
				return {
					content: [
						{
							type: 'text',
							text: `Page "${pageName}" not found or has no content.`,
						},
					],
				}
			}

			// Format the page content
			let formattedContent = `# ${pageName}\n\n`

			// Process blocks to extract text and maintain hierarchy
			const processBlocks = (blocks: any[], indent = 0) => {
				let text = ''
				for (const block of blocks) {
					if (block.content) {
						const indentation = '  '.repeat(indent)
						text += `${indentation}- ${block.content}\n`

						if (block.children && block.children.length > 0) {
							text += processBlocks(block.children, indent + 1)
						}
					}
				}
				return text
			}

			formattedContent += processBlocks(content)

			return {
				content: [
					{
						type: 'text',
						text: formattedContent,
					},
				],
			}
		} catch (error) {
			return {
				content: [
					{
						type: 'text',
						text: `Error retrieving page content: ${error.message}`,
					},
				],
			}
		}
	}
)

// Extract and fetch linked pages from content
async function extractLinkedPages(content: string): Promise<{
	pages: Record<string, string>
	occurrences: Record<string, number>
}> {
	const linkedPages: Record<string, string> = {}
	const occurrences: Record<string, number> = {}
	const matches = [...content.matchAll(PAGE_LINK_REGEX)]

	for (const match of matches) {
		const pageName = match[1].trim()
		// Count occurrences of each page
		occurrences[pageName] = (occurrences[pageName] || 0) + 1

		if (!linkedPages[pageName]) {
			const pageContent = await getPageContent(pageName)
			if (pageContent) {
				// Process blocks to extract text and maintain hierarchy
				const processBlocks = (blocks: any[], indent = 0) => {
					let text = ''
					for (const block of blocks) {
						if (block.content) {
							const indentation = '  '.repeat(indent)
							text += `${indentation}- ${block.content}\n`

							if (block.children && block.children.length > 0) {
								text += processBlocks(block.children, indent + 1)
							}
						}
					}
					return text
				}

				linkedPages[pageName] = processBlocks(pageContent)
			}
		}
	}

	return { pages: linkedPages, occurrences }
}

// Get summary of journal entries for a flexible date range
server.tool(
	'getJournalSummary',
	{
		dateRange: z
			.string()
			.describe(
				'Date range like "today", "this week", "last month", "this year", "year to date", etc.'
			),
	},
	async ({ dateRange }) => {
		try {
			// Get all pages
			const response = await fetch('http://127.0.0.1:12315/api', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${LOGSEQ_TOKEN}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					method: 'logseq.Editor.getAllPages',
				}),
			})

			if (!response.ok) {
				throw new Error(
					`Logseq API error: ${response.status} ${response.statusText}`
				)
			}

			const pages = await response.json()

			// Parse the date range
			const { start, end, title } = parseDateRange(dateRange)

			// Filter for journal pages within the date range
			const journalPages = pages.filter((page: any) => {
				const pageDate = new Date(page.updatedAt)
				return page['journal?'] === true && pageDate >= start && pageDate <= end
			})

			// Sort by date
			journalPages.sort((a: any, b: any) => a.journalDay - b.journalDay)

			// For each journal page, get its content
			const journalContents: Array<{ date: string; content: any }> = []
			for (const page of journalPages) {
				const content = await getPageContent(page.name)
				if (content) {
					journalContents.push({
						date: page.originalName,
						content: content,
					})
				}
			}

			// Format the summary
			let summary = `# ${title}\n\n`
			summary += `*Date range: ${start.toLocaleDateString()} to ${end.toLocaleDateString()}*\n\n`

			if (journalContents.length === 0) {
				summary += `No journal entries found for ${dateRange}.`
			} else {
				// Track all linked pages across all entries
				const allLinkedPages: Record<string, string> = {}
				const allPageOccurrences: Record<string, number> = {}

				for (const entry of journalContents) {
					summary += `## ${entry.date}\n\n`

					// Process blocks to extract text and maintain hierarchy
					const processBlocks = (blocks: any[], indent = 0) => {
						let text = ''
						for (const block of blocks) {
							if (block.content) {
								const indentation = '  '.repeat(indent)
								text += `${indentation}- ${block.content}\n`

								if (block.children && block.children.length > 0) {
									text += processBlocks(block.children, indent + 1)
								}
							}
						}
						return text
					}

					const entryText = processBlocks(entry.content)
					summary += entryText
					summary += '\n'

					// Extract linked pages from this entry
					const { pages: linkedPages, occurrences } = await extractLinkedPages(
						entryText
					)

					// Merge the linked pages
					Object.assign(allLinkedPages, linkedPages)

					// Merge occurrences counts
					for (const [pageName, count] of Object.entries(occurrences)) {
						allPageOccurrences[pageName] =
							(allPageOccurrences[pageName] || 0) + count
					}
				}

				// Add top concepts section (most frequently referenced pages)
				if (Object.keys(allPageOccurrences).length > 0) {
					// Sort pages by occurrence count (most frequent first)
					const sortedPages = Object.entries(allPageOccurrences).sort(
						(a, b) => b[1] - a[1]
					)

					// Add a "Top Concepts" section if we have any pages
					if (sortedPages.length > 0) {
						summary += `\n## Top Concepts\n\n`
						for (const [pageName, count] of sortedPages.slice(0, 10)) {
							summary += `- [[${pageName}]] (${count} references)\n`
						}
						summary += '\n'
					}

					// Add detailed referenced pages section
					summary += `\n## Referenced Pages\n\n`
					for (const [pageName, content] of Object.entries(allLinkedPages)) {
						const occurrenceCount = allPageOccurrences[pageName]
						summary += `### ${pageName}\n\n`
						if (occurrenceCount > 1) {
							summary += `*Referenced ${occurrenceCount} times*\n\n`
						}
						summary += `${content}\n\n`
					}
				}
			}

			return {
				content: [
					{
						type: 'text',
						text: summary,
					},
				],
			}
		} catch (error) {
			return {
				content: [
					{
						type: 'text',
						text: `Error generating journal summary: ${error.message}`,
					},
				],
			}
		}
	}
)

const transport = new StdioServerTransport()
await server.connect(transport)
