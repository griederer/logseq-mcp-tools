# Logseq MCP Server Setup Guide

## Prerequisites
- Logseq desktop app installed
- Claude Desktop installed
- Node.js installed via Homebrew (`brew install node`)

## Step 1: Configure Logseq HTTP API

1. **Open Logseq** desktop application
2. **Go to Settings** (click the gear icon)
3. **Navigate to Features** in the left sidebar
4. **Enable HTTP API**:
   - Toggle ON "Enable HTTP API"
   - This will start a local server on `http://127.0.0.1:12315`
5. **Set Authentication Token**:
   - Find "HTTP API Authentication Token" 
   - Generate or set a secure token (e.g., `logseq-mcp-token-2024`)
   - Remember this token!

## Step 2: Configure Environment

1. **Edit the .env file** in `/Users/gonzaloriederer/logseq-mcp-tools/.env`
2. **Replace** `your-token-here` with your actual Logseq token:
   ```
   LOGSEQ_TOKEN=logseq-mcp-token-2024
   ```

## Step 3: Test the Setup

1. **Ensure Logseq is running** with HTTP API enabled
2. **Test the MCP server**:
   ```bash
   cd /Users/gonzaloriederer/logseq-mcp-tools
   npm start
   ```
3. **Restart Claude Desktop** to load the new MCP configuration

## Step 4: Verify in Claude Desktop

1. Open Claude Desktop
2. Look for MCP indicators (puzzle piece icons)
3. Try asking: "Show me my Logseq pages" or "What are my recent journal entries?"

## Available Commands

Once configured, you can ask Claude to:

- **List pages**: "Show me all my Logseq pages"
- **Read specific pages**: "Show me the content of my 'Project Ideas' page"
- **Journal summaries**: "Summarize my journal entries from this week"
- **Search**: "Find pages mentioning 'todo' or 'tasks'"
- **Create content**: "Create a new page called 'Meeting Notes' with today's date"
- **Analyze patterns**: "Analyze my knowledge graph and find connections"
- **Find todos**: "Show me all my TODO items across all pages"

## Troubleshooting

### MCP Server Not Appearing
- Ensure Node.js is installed via Homebrew (not nvm/fnm)
- Check the path in `claude_desktop_config.json` is correct
- Restart Claude Desktop after configuration changes

### Logseq API Errors
- Verify Logseq is running
- Check HTTP API is enabled in Settings > Features
- Ensure the token in `.env` matches Logseq settings
- Confirm API is accessible at `http://127.0.0.1:12315`

### View Logs
```bash
# macOS
tail -n 20 -F ~/Library/Logs/Claude/mcp*.log
```

## Next Steps

With the MCP server configured, you can now:
1. Test basic functionality
2. Explore advanced features like graph analysis
3. Customize workflows for your todo management
4. Integrate with other tools in your knowledge workflow