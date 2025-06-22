#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const server = new McpServer({
	name: 'Official Pattern Test',
	version: '1.0.0',
})

// Pattern 1: Using exact official documentation format
server.tool(
	'test_official_pattern',
	{
		description: 'Test using official MCP pattern',
		inputSchema: {
			type: 'object',
			properties: {
				message: {
					type: 'string',
					description: 'The message to process'
				}
			},
			required: ['message']
		}
	},
	async (args) => {
		console.error('Official pattern args:', JSON.stringify(args, null, 2))
		
		return {
			content: [
				{
					type: 'text',
					text: `Received: ${args.message || 'NO MESSAGE'}`
				}
			]
		}
	}
)

// Pattern 2: Minimal working pattern
server.tool(
	'test_minimal',
	{
		description: 'Minimal test',
		inputSchema: {
			type: 'object',
			properties: {
				text: { type: 'string' }
			},
			required: ['text']
		}
	},
	async (request) => {
		console.error('Minimal pattern request:', JSON.stringify(request, null, 2))
		
		return {
			content: [
				{
					type: 'text',
					text: `Got: ${request.text || 'NOTHING'}`
				}
			]
		}
	}
)

// Pattern 3: No required fields
server.tool(
	'test_optional',
	{
		description: 'Optional parameters only',
		inputSchema: {
			type: 'object',
			properties: {
				optionalParam: { type: 'string' }
			}
		}
	},
	async (args) => {
		console.error('Optional pattern args:', JSON.stringify(args, null, 2))
		
		return {
			content: [
				{
					type: 'text',
					text: `Optional param: ${args?.optionalParam || 'NOT PROVIDED'}`
				}
			]
		}
	}
)

// Pattern 4: Complex object
server.tool(
	'test_complex',
	{
		description: 'Complex object test',
		inputSchema: {
			type: 'object',
			properties: {
				config: {
					type: 'object',
					properties: {
						name: { type: 'string' },
						value: { type: 'string' }
					}
				}
			}
		}
	},
	async (args) => {
		console.error('Complex pattern args:', JSON.stringify(args, null, 2))
		
		return {
			content: [
				{
					type: 'text',
					text: `Complex: ${JSON.stringify(args.config || {})}`
				}
			]
		}
	}
)

async function main() {
	const transport = new StdioServerTransport()
	await server.connect(transport)
	console.error('🧪 Official Pattern Test Server running')
}

main().catch(console.error)