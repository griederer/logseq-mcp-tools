# CLAUDE.md - joel-mcp Project Guidelines

## logseq api docs

- `./docs/logseq-plugins.txt`

## MCP SDK docs

- `./docs/modelcontextprotocol-typescriptsdk-docs.md`

## Commands

- Package manager: `pnpm` (v10.6.1)
- Run the server: `node index.js` (after transpiling TypeScript)
- Compile TypeScript: `tsc` (requires TypeScript to be installed)

## Code Style Guidelines

- TypeScript with ES modules (`"type": "module"`)
- Use async/await for async operations with proper error handling
- Document functions with comments describing purpose and parameters
- Use descriptive variable names and camelCase naming convention
- Type all function parameters and return values
- Format date strings consistently across the application

## Project Structure

- Entry point: `index.ts` - implements Model Context Protocol tools
- Implements Logseq API integration via HTTP requests to port 12315
- Tools:
  - `getAllPages`: Retrieves all Logseq pages
  - `getWeeklyJournalSummary`: Summarizes journal entries for current week

## Dependencies

- @logseq/libs: ^0.0.17
- @modelcontextprotocol/sdk: ^1.7.0
- zod: ^3.24.2 (for schema validation)
