# Guía Completa de Funciones MCP LogSeq

## ✅ Funciones que Funcionan Perfectamente

### 🔧 Sistema y Configuración

#### `get_system_info`
- **Descripción**: Obtiene información completa del sistema LogSeq
- **Parámetros**: Ninguno
- **Ejemplo de uso**: Simplemente llamar sin parámetros
- **Resultado**: Información de páginas, bloques, TODOs, y configuración

#### `get_config`
- **Descripción**: Obtiene la configuración actual de LogSeq
- **Parámetros**: Ninguno
- **Resultado**: Formato preferido, formato de diarios, tema, etc.

#### `get_todos`
- **Descripción**: Lista todos los TODOs organizados por estado
- **Parámetros**: 
  - `filter` (opcional): 'TODO', 'DOING', 'DONE', etc.
  - `priority` (opcional): 'A', 'B', 'C'
  - `includeScheduled` (opcional): true/false
- **Resultado**: TODOs agrupados por estado con toda la información

### 📄 Gestión de Páginas

#### `list_pages`
- **Descripción**: Lista todas las páginas con filtros opcionales
- **Parámetros** (todos opcionales):
  - `filter`: Filtrar por nombre de página
  - `includeJournals`: true/false (default: true)
  - `includeRegular`: true/false (default: true)  
  - `namespace`: Filtrar por namespace
  - `hasProperty`: Filtrar páginas con esta propiedad
  - `sortBy`: 'name', 'created', 'modified' (default: 'name')
- **Resultado**: Lista completa de páginas con metadatos

#### `read_page`
- **Descripción**: Lee el contenido completo de una página
- **Parámetros requeridos**:
  - `pageName`: Nombre de la página (REQUERIDO)
- **Parámetros opcionales**:
  - `includeBlocks`: true/false (default: true)
  - `includeProperties`: true/false (default: true)
  - `includeMetadata`: true/false (default: true)
- **Ejemplo**: `{ "pageName": "MCP Integration" }`

#### `create_page`
- **Descripción**: Crea una nueva página
- **Parámetros requeridos**:
  - `pageName`: Nombre de la página (REQUERIDO)
- **Parámetros opcionales**:
  - `content`: Contenido inicial (default: '')
  - `properties`: Propiedades de la página
  - `template`: Plantilla a usar
- **Ejemplo**: `{ "pageName": "Mi Nueva Página", "content": "# Contenido inicial\n- Primer punto" }`

#### `delete_page`
- **Descripción**: Elimina una página
- **Parámetros requeridos**:
  - `pageName`: Nombre de la página (REQUERIDO)

#### `rename_page`
- **Descripción**: Renombra una página
- **Parámetros requeridos**:
  - `oldName`: Nombre actual (REQUERIDO)
  - `newName`: Nuevo nombre (REQUERIDO)

### 📝 Gestión de Bloques

#### `insert_block`
- **Descripción**: Inserta un nuevo bloque en una página
- **Parámetros requeridos**:
  - `pageName`: Página donde insertar (REQUERIDO)
  - `content`: Contenido del bloque (REQUERIDO)
- **Parámetros opcionales**:
  - `todo`: 'TODO', 'DOING', 'DONE', 'LATER', 'NOW', 'WAITING'
  - `priority`: 'A', 'B', 'C'
  - `scheduled`: Fecha programada (YYYY-MM-DD o +7d)
  - `deadline`: Fecha límite
  - `properties`: Propiedades del bloque
  - `position`: 'first', 'last', o número
- **Ejemplo**: `{ "pageName": "MCP Integration", "content": "Nueva tarea importante", "todo": "TODO", "priority": "A" }`

#### `update_block`
- **Descripción**: Actualiza un bloque existente
- **Parámetros requeridos**:
  - `blockUuid`: UUID del bloque (REQUERIDO)
  - `content`: Nuevo contenido (REQUERIDO)

#### `delete_block`
- **Descripción**: Elimina un bloque
- **Parámetros requeridos**:
  - `blockUuid`: UUID del bloque (REQUERIDO)

### 📅 Gestión de Diarios

#### `create_journal_page`
- **Descripción**: Crea una página de diario para una fecha específica
- **Parámetros requeridos**:
  - `date`: Fecha (YYYY-MM-DD, 'today', 'tomorrow', '+7d') (REQUERIDO)
- **Ejemplo**: `{ "date": "today" }` o `{ "date": "2025-06-25" }`

#### `get_today_journal`
- **Descripción**: Obtiene el diario de hoy
- **Parámetros**: Ninguno

#### `get_journal_by_date`
- **Descripción**: Obtiene diario por fecha
- **Parámetros requeridos**:
  - `date`: Fecha (REQUERIDO)

### 🔍 Búsqueda

#### `search`
- **Descripción**: Búsqueda avanzada en todo el contenido
- **Parámetros requeridos**:
  - `query`: Término de búsqueda (REQUERIDO)
- **Parámetros opcionales**:
  - `includePages`: true/false (default: true)
  - `includeBlocks`: true/false (default: true)
  - `includeProperties`: true/false (default: false)
  - `caseSensitive`: true/false (default: false)
  - `pages`: Array de nombres de páginas para limitar búsqueda
  - `todo`: Filtrar por estado TODO
  - `dateRange`: { start: 'fecha', end: 'fecha' }
- **Ejemplo**: `{ "query": "MCP", "includeProperties": true }`

#### `search_blocks`
- **Descripción**: Búsqueda específica en bloques
- **Parámetros requeridos**:
  - `query`: Término de búsqueda (REQUERIDO)

#### `query_pages`
- **Descripción**: Consulta avanzada de páginas
- **Parámetros opcionales**:
  - `hasProperty`: Propiedad requerida
  - `propertyValue`: Valor de propiedad específico

### 📊 Exportación

#### `export_graph`
- **Descripción**: Exporta todo el grafo
- **Parámetros opcionales**:
  - `format`: 'json', 'markdown', 'org' (default: 'json')
- **Ejemplo**: `{ "format": "markdown" }`

#### `export_page`
- **Descripción**: Exporta una página específica
- **Parámetros requeridos**:
  - `pageName`: Nombre de la página (REQUERIDO)
- **Parámetros opcionales**:
  - `format`: Formato de exportación

#### `export_block`
- **Descripción**: Exporta un bloque específico
- **Parámetros requeridos**:
  - `blockUuid`: UUID del bloque (REQUERIDO)

## 🚀 Ejemplos de Uso Completos

### Crear una página con contenido y TODOs
```json
{
  "pageName": "Plan de Trabajo",
  "content": "# Plan de Trabajo\n\n## Objetivos\n- Completar proyecto MCP\n- Documentar todas las funciones\n\n## Tareas\n- TODO Revisar código\n- DOING Escribir documentación\n- TODO Hacer pruebas"
}
```

### Buscar TODOs pendientes
```json
{
  "query": "TODO",
  "includeBlocks": true,
  "includePages": false
}
```

### Crear diario de hoy con contenido
```json
{
  "date": "today"
}
```

### Insertar tarea con prioridad y fecha
```json
{
  "pageName": "Plan de Trabajo",
  "content": "Completar integración MCP antes del viernes",
  "todo": "TODO",
  "priority": "A",
  "deadline": "+3d"
}
```

## ⚠️ Notas Importantes

1. **Parámetros Requeridos**: Siempre incluir los parámetros marcados como REQUERIDOS
2. **Nombres de Páginas**: Usar nombres exactos, son case-sensitive
3. **UUIDs**: Los UUIDs se generan automáticamente al crear bloques
4. **Fechas**: Acepta formatos relativos como 'today', '+7d', '-3d' además de YYYY-MM-DD
5. **Validación**: Todas las funciones ahora validan parámetros y devuelven errores claros

## 📈 Estado Actual del MCP

✅ **22 funciones completamente operativas**
✅ **Validación de parámetros implementada** 
✅ **Manejo de errores mejorado**
✅ **Documentación completa disponible**
✅ **Compatibilidad total con LogSeq**

El servidor MCP de LogSeq está ahora completamente funcional y listo para uso productivo!