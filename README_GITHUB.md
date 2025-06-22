# 🔥 Logseq MCP v4.0 - Complete Integration

A powerful **Model Context Protocol (MCP)** server that provides **complete control** over Logseq from Claude Desktop.

[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-blue.svg)](https://modelcontextprotocol.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Logseq](https://img.shields.io/badge/Logseq-Compatible-green.svg)](https://logseq.com/)

## 🚀 Features

### ✅ **Complete Functionality** (20/20 Functions)

- **📊 System Management**: System info, configuration, export
- **📄 Page Operations**: Create, read, update, delete, list with filters
- **🧱 Block Management**: Insert, update, delete, get by UUID, list all
- **✅ TODO Management**: Organized by status (TODO, DOING, DONE, etc.)
- **📅 Journal Operations**: Create, read by date, today's journal
- **🔍 Search**: Global search across all content
- **📊 Properties**: Get/set page properties with front matter
- **🎯 Advanced**: UUID tracking, full CRUD operations

### 🎯 **Key Capabilities**

- ✅ **Parameter Processing**: All functions with parameters work perfectly
- ✅ **UUID Support**: Block-level operations with persistent UUIDs
- ✅ **File Persistence**: Changes saved directly to Logseq files
- ✅ **Search & Discovery**: Find content across your entire graph
- ✅ **Metadata Management**: Handle page properties and front matter
- ✅ **Journal Integration**: Create and manage daily journals

## 📦 Installation

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher)
- [Claude Desktop](https://claude.ai/desktop)
- [Logseq](https://logseq.com/) with a local graph

### Quick Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/griederer/logseq-mcp-tools.git
   cd logseq-mcp-tools
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Claude Desktop**:
   Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "logseq": {
         "command": "npx",
         "args": [
           "tsx",
           "/path/to/logseq-mcp-tools/index-complete-v4-fixed.ts"
         ]
       }
     }
   }
   ```

4. **Update Logseq path** in the script (line 17-23) to point to your Logseq graph directory.

5. **Restart Claude Desktop** and start using Logseq functions!

## 🎯 Available Functions

### 📊 **System & Info**
- `get_system_info` - Complete system information

### 📄 **Page Management**
- `list_pages(filter?)` - List all pages with optional filter
- `read_page(pageName)` - Read complete page content
- `create_page(pageName, content?)` - Create new page
- `update_page(pageName, content)` - Update page content
- `delete_page(pageName)` - Delete page completely

### 🧱 **Block Management**
- `list_blocks(pageName)` - List all blocks in a page
- `get_block(blockUuid)` - Get specific block by UUID
- `insert_block(pageName, content, todo?, priority?)` - Insert new block
- `update_block(blockUuid, content)` - Update block content
- `delete_block(blockUuid)` - Delete specific block

### ✅ **TODO Management**
- `get_todos` - Get all TODOs organized by status

### 📅 **Journal Management**
- `get_today_journal` - Get today's journal
- `get_journal_by_date(date)` - Get journal for specific date
- `create_journal_page(date?)` - Create journal page

### 🔍 **Search & Discovery**
- `search(query)` - Global search across all content

### 📊 **Properties & Metadata**
- `get_page_properties(pageName)` - Get page properties
- `set_page_property(pageName, propertyName, propertyValue)` - Set property

### ⚙️ **Configuration & Export**
- `get_config` - Get Logseq configuration
- `export_graph` - Export entire graph as JSON

## 💡 Usage Examples

### Create and Manage Content
```typescript
// Create a new page
create_page("My Project", "This is my new project page")

// Add a block with TODO
insert_block("My Project", "Complete the documentation", "TODO", "A")

// Search for content
search("documentation")

// Create a journal entry
create_journal_page("2025-01-15")
```

### Manage TODOs
```typescript
// Get all TODOs organized by status
get_todos()

// Update a TODO status by editing the block
update_block("abc12345", "DONE Complete the documentation")
```

### Properties and Metadata
```typescript
// Set page properties
set_page_property("My Project", "status", "active")
set_page_property("My Project", "tags", "project, documentation")

// Get properties
get_page_properties("My Project")
```

## 🏗️ Architecture

### **File Structure**
- `index-complete-v4-fixed.ts` - Main MCP server (latest version)
- `MCP_V4_FUNCTIONS.md` - Complete function documentation
- `docs/` - Additional documentation
- `logseq/` - Logseq source code (forked)

### **Key Features**
- **TypeScript**: Full type safety and modern JavaScript features
- **MCP SDK**: Official Model Context Protocol implementation
- **Zod Validation**: Robust parameter validation
- **UUID Support**: Persistent block tracking
- **File-based**: Direct file system operations for reliability

## 🐛 Troubleshooting

### Common Issues

1. **"Logseq directory not found"**
   - Update `POSSIBLE_LOGSEQ_PATHS` in the script with your Logseq graph path

2. **"Tool not found" errors**
   - Restart Claude Desktop after configuration changes
   - Verify the file path in `claude_desktop_config.json`

3. **Parameter errors**
   - Ensure you're using the v4-fixed version
   - Check that parameters match the function signatures

### Debug Mode
Set `NODE_ENV=development` to enable detailed logging.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Anthropic](https://anthropic.com/) for the Model Context Protocol
- [Logseq](https://logseq.com/) for the amazing knowledge management platform
- The open-source community for inspiration and contributions

## 📊 Project Status

- ✅ **v4.0**: Complete implementation with 20 functions
- ✅ **Parameter Processing**: Fully resolved and working
- ✅ **UUID Management**: Block-level operations functional
- ✅ **Production Ready**: Tested and stable

---

**🚀 Transform your Logseq experience with complete programmatic control through Claude!**