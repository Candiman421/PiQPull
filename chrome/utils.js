// PiQPull — Shared Utility Functions v1.4.2
// v1.4.2: fetchImageAssetBytes — 15s AbortController timeout prevents single slow image from hanging export.
// All functions are defensive: null-safe, array-guarded, no implicit coercion.
// Strict equality throughout.
// Re-injection safety: top-level data structures use var (re-declaration silently allowed).
// top-level function declarations are also safely re-declarable on re-injection.
// No top-level return statement — illegal in script context regardless of environment.

// =============================================================================
// 1. TIMESTAMP
// =============================================================================

/** @returns {string} PiQ timestamp: YYYY.MM.DD-HHmmss */
function getPiQTimestamp() {
  const now   = new Date();
  const pad   = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// =============================================================================
// 2. MODEL INFERENCE
// =============================================================================

var MODEL_TIMELINE = [
  { from: new Date('2024-01-01'), model: 'claude-3-sonnet-20240229'      },
  { from: new Date('2024-06-20'), model: 'claude-3-5-sonnet-20240620'    },
  { from: new Date('2024-10-22'), model: 'claude-3-5-sonnet-20241022'    },
  { from: new Date('2025-02-24'), model: 'claude-3-7-sonnet-20250219'    },
  { from: new Date('2025-05-22'), model: 'claude-sonnet-4-20250514'      },
  { from: new Date('2025-09-29'), model: 'claude-sonnet-4-5-20250929'    },
  { from: new Date('2026-02-17'), model: 'claude-sonnet-4-6'             },
];

/** @param {{ model?: string, created_at?: string }} convData */
function inferModel(convData) {
  if (convData && convData.model) return convData.model;
  const dt = convData && convData.created_at ? new Date(convData.created_at) : new Date(0);
  for (let i = MODEL_TIMELINE.length - 1; i >= 0; i--) {
    if (dt >= MODEL_TIMELINE[i].from) return MODEL_TIMELINE[i].model;
  }
  return MODEL_TIMELINE[0].model;
}

// =============================================================================
// 3. BRANCH RECONSTRUCTION — active branch only (leaf → root walk)
// =============================================================================

/** @param {{ chat_messages?: unknown[], current_leaf_message_uuid?: string }} convData */
function getCurrentBranch(convData) {
  const msgs = Array.isArray(convData && convData.chat_messages) ? convData.chat_messages : [];
  if (msgs.length === 0) return [];

  const leafId = convData.current_leaf_message_uuid;
  if (!leafId) return msgs;

  /** @type {Map<string, object>} */
  const msgMap = new Map();
  for (const m of msgs) {
    if (m && m.uuid) msgMap.set(m.uuid, m);
  }

  if (!msgMap.has(leafId)) return msgs; // leaf not found — return all

  const branch = [];
  let cur = leafId;
  const visited = new Set();

  while (cur && msgMap.has(cur) && !visited.has(cur)) {
    visited.add(cur);
    const msg = msgMap.get(cur);
    branch.unshift(msg);
    cur = msg.parent_message_uuid || '';
  }

  return branch.length > 0 ? branch : msgs;
}

// =============================================================================
// 4. ARTIFACT EXTRACTION
// =============================================================================

/**
 * Extract all artifacts from a single message object.
 * Handles: tool_use name="artifacts" (legacy), create_file (current), antArtifact XML.
 * Bug 5 fix: else-if for message.text to prevent double-extraction.
 */
function extractArtifactsFromMessage(message) {
  if (!message) return [];
  const artifacts = [];
  const blocks = Array.isArray(message.content) ? message.content : [];

  if (blocks.length > 0) {
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;

      // Legacy Claude artifact panel: tool_use name="artifacts"
      if (block.type === 'tool_use' && block.name === 'artifacts' && block.display_content) {
        const dc = block.display_content;
        if (dc.type === 'code_block' && dc.code) {
          const lang  = dc.language || 'txt';
          const fname = String(dc.filename || 'artifact').split('/').pop().replace(/\.[^.]+$/, '');
          artifacts.push({
            title: fname || 'Untitled', language: lang,
            type: isProgrammingLanguage(lang) ? 'code' : 'document',
            identifier: null, content: String(dc.code).trim(), source: 'tool_use_artifacts'
          });
        } else if (dc.type === 'json_block' && dc.json_block) {
          try {
            const def = JSON.parse(String(dc.json_block));
            if (def && def.filename) {
              const lang  = def.language || 'txt';
              const fname = String(def.filename).split('/').pop().replace(/\.[^.]+$/, '');
              artifacts.push({
                title: fname || 'Untitled', language: lang,
                type: isProgrammingLanguage(lang) ? 'code' : 'document',
                identifier: null, content: String(def.code || '').trim(), source: 'tool_use_artifacts'
              });
            }
          } catch (_e) { /* malformed JSON block — skip */ }
        }
      }

      // Current delivery path: create_file tool_use
      if (block.type === 'tool_use' && block.name === 'create_file') {
        const inp = block.input && typeof block.input === 'object' ? block.input : {};
        if (inp.path && inp.file_text !== undefined && inp.file_text !== null) {
          const rawName = String(inp.path).replace(/\\/g, '/').split('/').pop();
          const ext     = rawName.includes('.') ? rawName.split('.').pop().toLowerCase() : 'txt';
          artifacts.push({
            title:      rawName.replace(/\.[^.]+$/, '') || 'Untitled',
            language:   LANG_MAP[ext] || ext,
            type:       DOC_EXTS.has(ext) ? 'document' : 'code',
            identifier: block.id || null,
            content:    String(inp.file_text),
            source:     'create_file'
          });
        }
      }

      // antArtifact XML tags inside text blocks
      if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
        artifacts.push(...extractArtifactsFromText(block.text));
      }
    }

  // Bug 5 fix: only fall back to .text when content blocks are absent
  } else if (typeof message.text === 'string' && message.text.length > 0) {
    artifacts.push(...extractArtifactsFromText(message.text));
  }

  return artifacts;
}

var LANG_MAP = {
  md:'markdown', markdown:'markdown', txt:'text', text:'text', csv:'csv',
  js:'javascript', mjs:'javascript', cjs:'javascript',
  ts:'typescript', jsx:'jsx', tsx:'tsx',
  py:'python', cs:'csharp', java:'java', cpp:'cpp', cc:'cpp', c:'c', h:'c',
  html:'html', htm:'html', css:'css', scss:'scss', less:'less',
  json:'json', jsonl:'json', xml:'xml', svg:'svg',
  sh:'shell', bash:'shell', ps1:'powershell', psm1:'powershell',
  yaml:'yaml', yml:'yaml', toml:'toml', ini:'ini', sql:'sql',
  rs:'rust', go:'go', rb:'ruby', php:'php', kt:'kotlin', swift:'swift',
  dart:'dart', ex:'elixir', exs:'elixir', hs:'haskell',
  clj:'clojure', fs:'fsharp', lua:'lua', pl:'perl', r:'r',
};

var DOC_EXTS = new Set(['md','txt','markdown','text','svg','xml','html','htm','css','csv']);

/** @param {string} srcText */
function extractArtifactsFromText(srcText) {
  if (!srcText || typeof srcText !== 'string') return [];
  const re = /<antArtifact[^>]*>([\s\S]*?)<\/antArtifact>/g;
  const artifacts = [];
  let m;

  while ((m = re.exec(srcText)) !== null) {
    const full  = m[0];
    const inner = m[1] || '';

    const getAttr = (/** @type {string} */ attr) => {
      const mm = full.match(new RegExp(`${attr}="([^"]*)"`));
      return mm ? mm[1] : null;
    };

    const titleAttr = getAttr('title');
    const typeAttr  = getAttr('type');
    const langAttr  = getAttr('language');
    const idAttr    = getAttr('identifier');

    let artifactType = 'text';
    let language     = 'txt';

    if (typeAttr) {
      switch (typeAttr) {
        case 'text/html':                   language = 'html';     artifactType = 'code';     break;
        case 'text/markdown':               language = 'markdown'; artifactType = 'document'; break;
        case 'application/vnd.ant.code':    language = langAttr || 'txt'; artifactType = 'code'; break;
        case 'text/css':                    language = 'css';      artifactType = 'code';     break;
        case 'application/vnd.ant.mermaid': language = 'mermaid';  artifactType = 'document'; break;
        case 'application/vnd.ant.react':   language = 'jsx';      artifactType = 'code';     break;
        case 'image/svg+xml':               language = 'svg';      artifactType = 'code';     break;
        default: break;
      }
    } else if (langAttr) {
      language = langAttr; artifactType = 'code';
    }

    artifacts.push({
      title:      titleAttr || 'Untitled',
      language, type: artifactType,
      identifier: idAttr || null,
      content:    inner.trim(),
      source:     'antArtifact'
    });
  }
  return artifacts;
}

// =============================================================================
// 5. LANGUAGE / EXTENSION HELPERS
// =============================================================================

var PROGRAMMING_LANGS = new Set([
  'javascript','typescript','python','java','c','cpp','c++','ruby','php',
  'swift','go','rust','jsx','tsx','shell','bash','sql','kotlin','scala',
  'r','perl','lua','dart','elixir','erlang','haskell','clojure','fsharp',
  'f#','c#','csharp','objective-c','ocaml','scheme','lisp','fortran',
  'assembly','asm','groovy','html','css','scss','sass','less','stylus','powershell',
]);

/** @param {string} lang */
function isProgrammingLanguage(lang) {
  return PROGRAMMING_LANGS.has((lang || '').toLowerCase());
}

var EXT_MAP = {
  javascript:'.js', typescript:'.ts', python:'.py', java:'.java', c:'.c', cpp:'.cpp',
  'c++':'.cpp', ruby:'.rb', php:'.php', swift:'.swift', go:'.go', rust:'.rs',
  jsx:'.jsx', tsx:'.tsx', shell:'.sh', bash:'.sh', sql:'.sql', kotlin:'.kt',
  scala:'.scala', r:'.r', matlab:'.m', json:'.json', xml:'.xml', yaml:'.yaml',
  yml:'.yml', markdown:'.md', md:'.md', text:'.txt', txt:'.txt', latex:'.tex',
  tex:'.tex', bibtex:'.bib', bib:'.bib', mermaid:'.mmd', svg:'.svg', csv:'.csv',
  toml:'.toml', ini:'.ini', perl:'.pl', lua:'.lua', dart:'.dart', elixir:'.ex',
  erlang:'.erl', haskell:'.hs', clojure:'.clj', fsharp:'.fs', 'f#':'.fs',
  'c#':'.cs', csharp:'.cs', 'objective-c':'.m', ocaml:'.ml', scheme:'.scm',
  lisp:'.lisp', fortran:'.f90', assembly:'.asm', asm:'.asm', scss:'.scss',
  sass:'.sass', less:'.less', stylus:'.styl', dockerfile:'.dockerfile',
  makefile:'.mk', groovy:'.groovy', powershell:'.ps1', html:'.html', css:'.css',
};

/** @param {string} lang */
function getFileExtension(lang) {
  return EXT_MAP[(lang || '').toLowerCase()] || '.txt';
}

// =============================================================================
// 6. ARTIFACT FILE EXTRACTION
// =============================================================================

/**
 * @param {string} content
 * @param {string} language
 * @param {string} baseName
 * @param {string} fmt
 * @returns {{ filename: string, content: string }}
 */
function convertArtifactToFileEntry(content, language, baseName, fmt) {
  const ext = getFileExtension(language);
  // Non-markdown code files: always use their native extension
  if (isProgrammingLanguage(language) && ext !== '.md') {
    return { filename: `${baseName}${ext}`, content };
  }
  switch (fmt) {
    case 'markdown':
    case 'original':
      return { filename: `${baseName}.md`, content };
    case 'text': {
      const plain = content
        .replace(/```[\s\S]*?```/g, s => s.replace(/^```\w*\n?/, '').replace(/\n?```$/, ''))
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1').replace(/_([^_]+)_/g, '$1')
        .replace(/^#{1,6}\s+(.+)$/gm, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
        .replace(/^[-*_]{3,}$/gm, '').replace(/\n{3,}/g, '\n\n');
      return { filename: `${baseName}.txt`, content: plain.trim() };
    }
    case 'json':
      return {
        filename: `${baseName}.json`,
        content: JSON.stringify({ title: baseName, language, content, format: 'markdown' }, null, 2)
      };
    default:
      return { filename: `${baseName}${ext}`, content };
  }
}

/** @param {{ chat_messages?: unknown[] }} convData @param {string} fmt */
function extractArtifactFiles(convData, fmt) {
  const resolvedFmt  = fmt || 'original';
  const artifactFiles = [];
  const usedNames    = new Set();

  for (const msg of getCurrentBranch(convData)) {
    for (const artifact of extractArtifactsFromMessage(msg)) {
      const baseName    = (artifact.title || 'artifact').replace(/[<>:"/\\|?*]/g, '_');
      const entry       = convertArtifactToFileEntry(artifact.content || '', artifact.language, baseName, resolvedFmt);
      const dotIdx      = entry.filename.lastIndexOf('.');
      const nameNoExt   = dotIdx > 0 ? entry.filename.slice(0, dotIdx) : entry.filename;
      const fileExt     = dotIdx > 0 ? entry.filename.slice(dotIdx) : '';
      let   uniqueName  = entry.filename;
      let   collision   = 1;

      while (usedNames.has(uniqueName)) {
        uniqueName = `${nameNoExt}_${collision}${fileExt}`;
        collision++;
      }
      usedNames.add(uniqueName);
      artifactFiles.push({ filename: uniqueName, content: entry.content });
    }
  }
  return artifactFiles;
}

// =============================================================================
// 7. EXPORT CONVERTERS
// =============================================================================

/**
 * @param {{ name?: string, chat_messages?: unknown[], model?: string, created_at?: string, updated_at?: string }} convData
 * @param {boolean} includeMetadata
 * @param {string} convId
 * @param {boolean} includeArtifacts
 * @param {boolean} includeThinking
 */
function convertToMarkdown(convData, includeMetadata, convId, includeArtifacts, includeThinking) {
  const title = convData.name || 'Untitled Conversation';
  let md = `# ${title}\n\n`;

  if (includeMetadata) {
    md += `**Provider:** claude.ai\n`;
    if (convData.created_at) md += `**Created:** ${new Date(convData.created_at).toLocaleString()}\n`;
    if (convData.updated_at) md += `**Updated:** ${new Date(convData.updated_at).toLocaleString()}\n`;
    md += `**Exported:** ${new Date().toLocaleString()}\n`;
    if (convData.model) md += `**Model:** ${convData.model}\n`;
    if (convId) md += `**Link:** [https://claude.ai/chat/${convId}](https://claude.ai/chat/${convId})\n`;
    md += `\n---\n\n`;
  }

  for (const msg of getCurrentBranch(convData)) {
    if (!msg) continue;
    md += msg.sender === 'human' ? '## User\n' : '## Claude\n';
    if (includeMetadata && msg.created_at) md += `**${new Date(msg.created_at).toISOString()}**\n`;
    md += '\n';

    const msgArtifacts = includeArtifacts ? extractArtifactsFromMessage(msg) : [];
    const blocks = Array.isArray(msg.content) ? msg.content : [];

    if (blocks.length > 0) {
      for (const block of blocks) {
        if (!block) continue;
        if (block.type === 'thinking' && block.thinking && includeThinking) {
          md += `### Thinking\n\`\`\`\`\n${block.thinking}\n\`\`\`\`\n\n`;
        } else if (block.type === 'text' && typeof block.text === 'string') {
          const stripped = block.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
          if (stripped) md += `${stripped}\n\n`;
        }
      }
    } else if (typeof msg.text === 'string' && msg.text) {
      const stripped = msg.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
      if (stripped) md += `${stripped}\n\n`;
    }

    for (const att of (Array.isArray(msg.attachments) ? msg.attachments : [])) {
      if (att && att.extracted_content) md += `### Pasted\n\`\`\`\`\n${att.extracted_content}\n\`\`\`\`\n\n`;
    }

    for (const art of msgArtifacts) {
      md += `#### Artifact: ${art.title}\n**Type:** ${art.type} | **Language:** ${art.language}\n\n`;
      if (art.type === 'code' || isProgrammingLanguage(art.language)) {
        md += `\`\`\`${art.language}\n${art.content || ''}\n\`\`\`\n\n`;
      } else {
        md += `${art.content || ''}\n\n`;
      }
    }
  }
  return md;
}

/** @param {{ name?: string, created_at?: string, updated_at?: string, model?: string, chat_messages?: unknown[] }} convData */
function convertToText(convData, includeMetadata, includeArtifacts, includeThinking) {
  let out = '';

  if (includeMetadata) {
    out += `${convData.name || 'Untitled Conversation'}\n`;
    out += `Provider: claude.ai\n`;
    if (convData.created_at) out += `Created: ${new Date(convData.created_at).toLocaleString()}\n`;
    if (convData.updated_at) out += `Updated: ${new Date(convData.updated_at).toLocaleString()}\n`;
    if (convData.model) out += `Model: ${convData.model}\n`;
    out += '\n---\n\n';
  }

  for (const msg of getCurrentBranch(convData)) {
    if (!msg) continue;
    const arts       = includeArtifacts ? extractArtifactsFromMessage(msg) : [];
    let   msgText    = '';
    let   thinkText  = '';
    const blocks     = Array.isArray(msg.content) ? msg.content : [];

    if (blocks.length > 0) {
      for (const block of blocks) {
        if (!block) continue;
        if (block.type === 'thinking' && block.thinking && includeThinking) {
          const summaries = Array.isArray(block.summaries) ? block.summaries : [];
          const summary   = summaries.length > 0 ? summaries[summaries.length - 1].summary : 'Thought process';
          thinkText += `[Thinking: ${summary}]\n${block.thinking}\n[End Thinking]\n\n`;
        } else if (block.type === 'text' && typeof block.text === 'string') {
          msgText += block.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim() + ' ';
        }
      }
    } else if (typeof msg.text === 'string') {
      msgText = msg.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
    }

    if (thinkText) out += thinkText;
    out += `${msg.sender === 'human' ? 'User' : 'Claude'}: ${msgText.trim()}\n`;

    for (const art of arts) {
      out += `\n[Artifact: ${art.title} (${art.language})]\n${art.content || ''}\n[End Artifact]\n`;
    }
    for (const att of (Array.isArray(msg.attachments) ? msg.attachments : [])) {
      if (att && att.extracted_content) {
        const sizeNote = att.file_size ? ` (${att.file_size} bytes)` : '';
        out += `\n[Pasted${sizeNote}]\n${att.extracted_content}\n[End Pasted]\n`;
      }
    }
    out += '\n';
  }
  return out.trim();
}

/** @param {{ name?: string, model?: string, created_at?: string, updated_at?: string, uuid?: string, chat_messages?: unknown[] }} convData */
function convertToJSONL(convData, convId) {
  const exportedAt = new Date().toISOString();
  const lines = [];

  getCurrentBranch(convData).forEach((msg, idx) => {
    if (!msg) return;
    const arts           = extractArtifactsFromMessage(msg);
    let   msgText        = '';
    const thinkingBlocks = [];
    const blocks         = Array.isArray(msg.content) ? msg.content : [];

    if (blocks.length > 0) {
      for (const block of blocks) {
        if (!block) continue;
        if (block.type === 'thinking' && block.thinking) {
          thinkingBlocks.push(String(block.thinking));
        } else if (block.type === 'text' && typeof block.text === 'string') {
          msgText += block.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim() + ' ';
        }
      }
    } else if (typeof msg.text === 'string') {
      msgText = msg.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
    }

    const attSummaries = (Array.isArray(msg.attachments) ? msg.attachments : [])
      .filter(a => a && a.extracted_content)
      .map(a => ({ content: String(a.extracted_content), size: a.file_size || null }));

    lines.push(JSON.stringify({
      provider:                'claude.ai',
      conversation_id:         convId   || convData.uuid || null,
      conversation_name:       convData.name   || 'Untitled',
      model:                   convData.model  || null,
      conversation_created_at: convData.created_at || null,
      conversation_updated_at: convData.updated_at || null,
      exported_at:             exportedAt,
      message_index:           idx,
      message_uuid:            msg.uuid       || null,
      sender:                  msg.sender     || null,
      created_at:              msg.created_at || null,
      text:                    msgText.trim(),
      thinking:                thinkingBlocks.length > 0 ? thinkingBlocks : null,
      artifacts:               arts.length > 0 ? arts.map(a => ({ title: a.title, language: a.language, type: a.type, content: a.content })) : null,
      attachments:             attSummaries.length > 0 ? attSummaries : null,
    }));
  });
  return lines.join('\n');
}

// =============================================================================
// 8. FILE DOWNLOAD
// =============================================================================

/** @param {string} fileContent @param {string} filename @param {string} mimeType */
function downloadFile(fileContent, filename, mimeType) {
  const blob = new Blob([fileContent], { type: mimeType || 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// =============================================================================
// 9. SLUG + IMAGE ASSET HELPERS
// =============================================================================

/** @param {string} name @returns {string} */
function generateChatSlug(name) {
  const safe = (name || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return safe.substring(0, 80) || 'untitled';
}

/** @param {string} mimeType @returns {string} */
function getMimeTypeExtension(mimeType) {
  const MAP = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp',
    'image/tiff': 'tiff', 'image/avif': 'avif', 'image/heic': 'heic',
  };
  return MAP[mimeType || ''] || 'bin';
}

/** @param {ArrayBuffer} buf @returns {string} */
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  const CHUNK = 8192;
  let   bin   = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** @param {string} url @returns {Promise<string|null>} */
async function fetchImageAssetBytes(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000); // 15s timeout — one slow image shouldn't block an export
  try {
    const res = await fetch(url, { credentials: 'include', signal: controller.signal });
    if (!res.ok) return null;
    return arrayBufferToBase64(await res.arrayBuffer());
  } catch (_e) {
    return null; // includes AbortError on timeout
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Collect image assets from the active branch.
 * Bug A fix: checks file_kind === 'image' as fallback; resolves relative preview_url.
 * @param {{ chat_messages?: unknown[] }} convData
 * @param {string} ts export timestamp
 */
async function collectImageAssets(convData, ts) {
  const assets    = [];
  const branch    = getCurrentBranch(convData);
  let   counter   = 0;

  for (const msg of branch) {
    if (!msg) continue;

    for (const f of (Array.isArray(msg.files) ? msg.files : [])) {
      if (!f) continue;
      const isImg = (typeof f.file_type === 'string' && f.file_type.startsWith('image/'))
                 || f.file_kind === 'image';
      if (!isImg) continue;

      counter++;
      const mime    = (typeof f.file_type === 'string' && f.file_type) || 'image/png';
      const fname   = `img_${String(counter).padStart(3, '0')}_${ts}.${getMimeTypeExtension(mime)}`;
      const rawUrl  = typeof f.preview_url === 'string' ? f.preview_url : null;
      const fullUrl = rawUrl ? (rawUrl.startsWith('http') ? rawUrl : `https://claude.ai${rawUrl}`) : null;

      assets.push({
        asset_filename: fname,
        message_uuid:   msg.uuid  || null,
        file_uuid:      f.file_uuid || f.uuid || null,
        source_url:     fullUrl,
        mime_type:      mime,
        data_base64:    fullUrl ? await fetchImageAssetBytes(fullUrl) : null,
      });
    }

    for (const a of (Array.isArray(msg.attachments) ? msg.attachments : [])) {
      if (!a) continue;
      const isImg = (typeof a.file_type === 'string' && a.file_type.startsWith('image/'))
                 || a.file_kind === 'image';
      if (!isImg) continue;

      counter++;
      const mime  = (typeof a.file_type === 'string' && a.file_type) || 'image/png';
      const fname = `img_${String(counter).padStart(3, '0')}_${ts}.${getMimeTypeExtension(mime)}`;

      assets.push({
        asset_filename: fname,
        message_uuid:   msg.uuid  || null,
        file_uuid:      a.id      || null,
        source_url:     null,
        mime_type:      mime,
        data_base64:    null,
      });
    }
  }
  return assets;
}

// =============================================================================
// 10. CONVERSATION STATS + BRANCH MAP
// =============================================================================

/** @param {{ chat_messages?: unknown[], current_leaf_message_uuid?: string }} convData */
function computeConversationStats(convData) {
  const allMsgs    = Array.isArray(convData && convData.chat_messages) ? convData.chat_messages : [];
  const branchMsgs = getCurrentBranch(convData);

  let human = 0, assistant = 0, thinking = 0, artifacts = 0;
  let toolUse = 0, toolResult = 0, images = 0, citations = 0, truncated = 0;

  /** @type {Object.<string,number>} */
  const childCount = {};

  for (const msg of allMsgs) {
    if (!msg) continue;
    if (msg.sender === 'human') human++; else assistant++;
    if (msg.truncated) truncated++;

    const parentId = msg.parent_message_uuid;
    if (parentId) childCount[parentId] = (childCount[parentId] || 0) + 1;

    for (const block of (Array.isArray(msg.content) ? msg.content : [])) {
      if (!block) continue;
      switch (block.type) {
        case 'thinking':    thinking++;    break;
        case 'tool_result': toolResult++;  break;
        case 'tool_use':
          toolUse++;
          if (block.name === 'artifacts' || block.name === 'create_file') artifacts++;
          break;
        case 'text':
          if (Array.isArray(block.citations)) citations += block.citations.length;
          break;
        default: break;
      }
    }

    for (const f of (Array.isArray(msg.files) ? msg.files : [])) {
      if (f && (f.file_kind === 'image' || (typeof f.file_type === 'string' && f.file_type.startsWith('image/')))) images++;
    }
    for (const a of (Array.isArray(msg.attachments) ? msg.attachments : [])) {
      if (a && (a.file_kind === 'image' || (typeof a.file_type === 'string' && a.file_type.startsWith('image/')))) images++;
    }
  }

  // Defensively wrap: Object.values can be empty but .some on [] returns false safely
  const childCounts           = Object.values(childCount);
  const hasAlternateBranches  = childCounts.some(n => n > 1);

  const parentSet = new Set(allMsgs.map(m => m && m.parent_message_uuid).filter(Boolean));
  const leafCount = allMsgs.filter(m => m && m.uuid && !parentSet.has(m.uuid)).length;

  return {
    total_messages:          allMsgs.length,
    branch_message_count:    branchMsgs.length,
    human_message_count:     human,
    assistant_message_count: assistant,
    thinking_block_count:    thinking,
    artifact_block_count:    artifacts,
    tool_use_count:          toolUse,
    tool_result_count:       toolResult,
    image_asset_count:       images,
    citation_count:          citations,
    truncated_message_count: truncated,
    has_alternate_branches:  hasAlternateBranches,
    branch_count:            Math.max(leafCount, 1), // at minimum 1 if there are any messages
  };
}

var BRANCH_SENTINEL = '00000000-0000-4000-8000-000000000000';

/** @param {{ chat_messages?: unknown[], current_leaf_message_uuid?: string }} convData */
function buildBranchMap(convData) {
  const allMsgs    = Array.isArray(convData && convData.chat_messages) ? convData.chat_messages : [];
  const activeLeaf = convData && convData.current_leaf_message_uuid || null;

  if (allMsgs.length === 0) return [];

  /** @type {Map<string, object>} */
  const msgMap     = new Map();
  /** @type {Object.<string, string[]>} */
  const childrenOf = {};

  for (const msg of allMsgs) {
    if (!msg || !msg.uuid) continue;
    msgMap.set(msg.uuid, msg);
    if (!childrenOf[msg.uuid]) childrenOf[msg.uuid] = [];

    const parentId = msg.parent_message_uuid;
    if (parentId && parentId !== BRANCH_SENTINEL) {
      if (!childrenOf[parentId]) childrenOf[parentId] = [];
      childrenOf[parentId].push(msg.uuid);
    }
  }

  const leafUuids = allMsgs
    .filter(m => m && m.uuid && (!childrenOf[m.uuid] || childrenOf[m.uuid].length === 0))
    .map(m => m.uuid);

  if (leafUuids.length === 0) return [];

  return leafUuids.map((leafUuid, branchIdx) => {
    const path    = [];
    let   cur     = leafUuid;
    const visited = new Set();

    while (cur && msgMap.has(cur) && !visited.has(cur)) {
      visited.add(cur);
      path.unshift(cur);
      const parent = msgMap.get(cur).parent_message_uuid || '';
      cur = (parent && parent !== BRANCH_SENTINEL) ? parent : '';
    }

    const senders = path.map(uid => {
      const m = msgMap.get(uid);
      return m ? m.sender : null;
    }).filter(Boolean);

    return {
      branch_index:    branchIdx,
      leaf_uuid:       leafUuid,
      is_active:       leafUuid === activeLeaf,
      message_count:   path.length,
      human_turns:     senders.filter(s => s === 'human').length,
      assistant_turns: senders.filter(s => s === 'assistant').length,
      message_uuids:   path,
    };
  });
}

/** @param {{ chat_messages?: unknown[] }} convData */
function collectArtifactsForTransport(convData) {
  return extractArtifactFiles(convData, 'original');
}

// =============================================================================
// 11. EXPORT PAYLOAD BUILDER v2
// =============================================================================

/**
 * Strip volatile session-specific MCP tool entries from feature_flags.
 * These hash-suffixed IDs change every session and have no archival value.
 * @param {Record<string,unknown>|null|undefined} settings
 */
function stripFeatureFlags(settings) {
  if (!settings || typeof settings !== 'object') return null;
  /** @type {Record<string,unknown>} */
  const result = {};
  for (const [k, v] of Object.entries(settings)) {
    if (k === 'enabled_mcp_tools') continue;
    result[k] = v;
  }
  return result;
}

/**
 * Build the full v2 export payload.
 * image_asset_count is inside conversation_stats only (not duplicated at meta top-level).
 */
function buildExportPayload(
  convData,
  convId,
  convUrl,
  piQuixFolder,
  piQuixProjectName,
  imageAssets,
  exportTimestamp,
  orgId                = null,
  orgName              = null,
  claudeProjectName    = null,
  claudeProjectUuid    = null,
  artifactsManifest    = [],
  accountSlug          = null
) {
  const safeAssets = Array.isArray(imageAssets) ? imageAssets : [];
  const stats      = computeConversationStats(convData);
  const branchMap  = buildBranchMap(convData);

  const assetManifest = safeAssets.map(a => ({
    asset_filename: a.asset_filename || null,
    message_uuid:   a.message_uuid   || null,
    file_uuid:      a.file_uuid      || null,
    source_url:     a.source_url     || null,
    mime_type:      a.mime_type      || null,
    fetched:        a.data_base64 !== null && a.data_base64 !== undefined,
  }));

  const resolvedProjectUuid = claudeProjectUuid || (convData && convData.project_uuid) || null;

  return {
    piqpull_meta: {
      export_version: 2,
      exported_at:    exportTimestamp,
      provider:       'claude.ai',
      account_slug:   accountSlug      || null,
      org_id:         orgId            || null,
      org_name:       orgName          || null,
      piQuix_project: piQuixProjectName || null,
      piQuix_folder:  piQuixFolder      || null,
      conversation_url:       convUrl   || null,
      conversation_id:        convId    || null,
      conversation_name:      (convData && convData.name) || 'Untitled',
      claudeai_project_name:  claudeProjectName     || null,
      claudeai_project_uuid:  resolvedProjectUuid   || null,
      model:                  (convData && convData.model)       || null,
      created_at:             (convData && convData.created_at)  || null,
      updated_at:             (convData && convData.updated_at)  || null,
      is_starred:             (convData && !!convData.is_starred),
      is_temporary:           (convData && !!convData.is_temporary),
      is_pinned:              (convData && !!convData.is_pinned),
      conversation_stats:     stats,
      branch_map:             branchMap,
      feature_flags:          stripFeatureFlags(convData && convData.settings),
      platform:               (convData && convData.platform) || null,
      summary:                (convData && convData.summary)  || null,
      image_assets:           assetManifest,
      artifacts_manifest:     Array.isArray(artifactsManifest) ? artifactsManifest : [],
    },
    conversation: convData,
  };
}
