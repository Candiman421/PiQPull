// PiQPull — Shared Utility Functions
// Provider: Claude.ai
// Repo: Candiman421/PiQPull
//
// SECTIONS:
//   1. Timestamp
//   2. Model Inference
//   3. Branch Reconstruction
//   4. Artifact Extraction
//   5. Language / Extension Helpers
//   6. Artifact File Extraction
//   7. Export Converters (Markdown, Text, JSONL)
//   8. File Download
//   9. Server Push (legacy JSONL)
//  10. Slug + Image Asset Helpers
//  11. Conversation Stats + Branch Map
//  12. Export Payload Builder v2

// =============================================================================
// 1. TIMESTAMP
// =============================================================================

function getPiQTimestamp() {
  const now    = new Date();
  const year   = now.getFullYear();
  const month  = String(now.getMonth() + 1).padStart(2, '0');
  const day    = String(now.getDate()).padStart(2, '0');
  const hours  = String(now.getHours()).padStart(2, '0');
  const mins   = String(now.getMinutes()).padStart(2, '0');
  const secs   = String(now.getSeconds()).padStart(2, '0');
  return `${year}.${month}.${day}-${hours}${mins}${secs}`;
}

// =============================================================================
// 2. MODEL INFERENCE
// =============================================================================

const DEFAULT_MODEL_TIMELINE = [
  { date: new Date('2024-01-01'), model: 'claude-3-sonnet-20240229' },
  { date: new Date('2024-06-20'), model: 'claude-3-5-sonnet-20240620' },
  { date: new Date('2024-10-22'), model: 'claude-3-5-sonnet-20241022' },
  { date: new Date('2025-02-24'), model: 'claude-3-7-sonnet-20250219' },
  { date: new Date('2025-05-22'), model: 'claude-sonnet-4-20250514' },
  { date: new Date('2025-09-29'), model: 'claude-sonnet-4-5-20250929' },
  { date: new Date('2026-02-17'), model: 'claude-sonnet-4-6' }
];

function inferModel(conversationData) {
  if (conversationData.model) return conversationData.model;
  const convDate = new Date(conversationData.created_at);
  for (let i = DEFAULT_MODEL_TIMELINE.length - 1; i >= 0; i--) {
    if (convDate >= DEFAULT_MODEL_TIMELINE[i].date) return DEFAULT_MODEL_TIMELINE[i].model;
  }
  return DEFAULT_MODEL_TIMELINE[0].model;
}

// =============================================================================
// 3. BRANCH RECONSTRUCTION — active branch only (for converters)
// =============================================================================

function getCurrentBranch(conversationData) {
  if (!conversationData.chat_messages || !Array.isArray(conversationData.chat_messages)) return [];
  if (!conversationData.current_leaf_message_uuid) return conversationData.chat_messages;

  const messageMap = new Map();
  conversationData.chat_messages.forEach(msg => messageMap.set(msg.uuid, msg));

  const branch = [];
  let currentUuid = conversationData.current_leaf_message_uuid;

  while (currentUuid && messageMap.has(currentUuid)) {
    const msg = messageMap.get(currentUuid);
    branch.unshift(msg);
    currentUuid = msg.parent_message_uuid;
    if (!messageMap.has(currentUuid)) break;
  }

  return branch;
}

// =============================================================================
// 4. ARTIFACT EXTRACTION
// =============================================================================

function extractArtifactsFromMessage(message) {
  const artifacts = [];

  if (message.content && Array.isArray(message.content)) {
    for (const contentBlock of message.content) {
      if (contentBlock.type === 'tool_use' && contentBlock.name === 'artifacts' && contentBlock.display_content) {
        const displayContent = contentBlock.display_content;

        if (displayContent.type === 'code_block' && displayContent.code) {
          const language  = displayContent.language || 'txt';
          const filename  = displayContent.filename || 'artifact';
          const titleBase = filename.split('/').pop().replace(/\.[^.]+$/, '');
          artifacts.push({
            title: titleBase || 'Untitled', language,
            type: isProgrammingLanguage(language) ? 'code' : 'document',
            identifier: null, content: displayContent.code.trim()
          });
        } else if (displayContent.type === 'json_block' && displayContent.json_block) {
          try {
            const artifactDefinition = JSON.parse(displayContent.json_block);
            if (artifactDefinition.filename) {
              const language  = artifactDefinition.language || 'txt';
              const titleBase = artifactDefinition.filename.split('/').pop().replace(/\.[^.]+$/, '');
              artifacts.push({
                title: titleBase || 'Untitled', language,
                type: isProgrammingLanguage(language) ? 'code' : 'document',
                identifier: null, content: (artifactDefinition.code || '').trim()
              });
            }
          } catch (parseErr) {
            console.warn('PiQPull: Failed to parse artifact json_block:', parseErr);
          }
        }
      }
      if (contentBlock.text) artifacts.push(...extractArtifactsFromText(contentBlock.text));
    }
  }

  if (message.text) artifacts.push(...extractArtifactsFromText(message.text));
  return artifacts;
}

function extractArtifactsFromText(sourceText) {
  const artifactTagRegex = /<antArtifact[^>]*>([\s\S]*?)<\/antArtifact>/g;
  const artifacts = [];
  let tagMatch;

  while ((tagMatch = artifactTagRegex.exec(sourceText)) !== null) {
    const fullTag      = tagMatch[0];
    const innerContent = tagMatch[1];

    const titleMatch      = fullTag.match(/title="([^"]*)"/);
    const typeMatch       = fullTag.match(/type="([^"]*)"/);
    const languageMatch   = fullTag.match(/language="([^"]*)"/);
    const identifierMatch = fullTag.match(/identifier="([^"]*)"/);

    let artifactType = 'text';
    let language     = 'txt';

    if (typeMatch) {
      const mimeType = typeMatch[1];
      if      (mimeType === 'text/html')                   { language = 'html';     artifactType = 'code'; }
      else if (mimeType === 'text/markdown')               { language = 'markdown'; artifactType = 'document'; }
      else if (mimeType === 'application/vnd.ant.code')    { language = languageMatch ? languageMatch[1] : 'txt'; artifactType = 'code'; }
      else if (mimeType === 'text/css')                    { language = 'css';      artifactType = 'code'; }
      else if (mimeType === 'application/vnd.ant.mermaid'){ language = 'mermaid';  artifactType = 'document'; }
      else if (mimeType === 'application/vnd.ant.react')  { language = 'jsx';      artifactType = 'code'; }
      else if (mimeType === 'image/svg+xml')               { language = 'svg';      artifactType = 'code'; }
    } else if (languageMatch) {
      language = languageMatch[1]; artifactType = 'code';
    }

    artifacts.push({
      title:      titleMatch      ? titleMatch[1]      : 'Untitled',
      language,
      type:       artifactType,
      identifier: identifierMatch ? identifierMatch[1] : null,
      content:    innerContent.trim()
    });
  }

  return artifacts;
}

function extractArtifacts(sourceText) { return extractArtifactsFromText(sourceText); }

// =============================================================================
// 5. LANGUAGE / EXTENSION HELPERS
// =============================================================================

function isProgrammingLanguage(language) {
  const langs = [
    'javascript','typescript','python','java','c','cpp','c++','ruby','php',
    'swift','go','rust','jsx','tsx','shell','bash','sql','kotlin','scala',
    'r','perl','lua','dart','elixir','erlang','haskell','clojure','fsharp',
    'f#','c#','csharp','objective-c','ocaml','scheme','lisp','fortran',
    'assembly','asm','groovy','html','css','scss','sass','less','stylus'
  ];
  return langs.includes((language || '').toLowerCase());
}

function getFileExtension(language) {
  const extensionMap = {
    javascript: '.js',  typescript: '.ts',  python: '.py',   java: '.java',
    c: '.c',            cpp: '.cpp',        'c++': '.cpp',   ruby: '.rb',
    php: '.php',        swift: '.swift',    go: '.go',       rust: '.rs',
    jsx: '.jsx',        tsx: '.tsx',        shell: '.sh',    bash: '.sh',
    sql: '.sql',        kotlin: '.kt',      scala: '.scala', r: '.r',
    matlab: '.m',       json: '.json',      xml: '.xml',     yaml: '.yaml',
    yml: '.yml',        markdown: '.md',    md: '.md',       text: '.txt',
    txt: '.txt',        latex: '.tex',      tex: '.tex',     bibtex: '.bib',
    bib: '.bib',        mermaid: '.mmd',    svg: '.svg',     csv: '.csv',
    toml: '.toml',      ini: '.ini',        perl: '.pl',     lua: '.lua',
    dart: '.dart',      elixir: '.ex',      erlang: '.erl',  haskell: '.hs',
    clojure: '.clj',    fsharp: '.fs',      'f#': '.fs',     'c#': '.cs',
    csharp: '.cs',      'objective-c': '.m', ocaml: '.ml',   scheme: '.scm',
    lisp: '.lisp',      fortran: '.f90',    assembly: '.asm', asm: '.asm',
    scss: '.scss',      sass: '.sass',      less: '.less',   stylus: '.styl',
    dockerfile: '.dockerfile', makefile: '.mk', gradle: '.gradle', groovy: '.groovy'
  };
  return extensionMap[(language || '').toLowerCase()] || '.txt';
}

// =============================================================================
// 6. ARTIFACT FILE EXTRACTION
// =============================================================================

function convertArtifactToFileEntry(artifactContent, language, baseFilename, targetFormat) {
  const originalExt = getFileExtension(language);
  if (isProgrammingLanguage(language) || originalExt !== '.md') {
    return { filename: `${baseFilename}${originalExt}`, content: artifactContent };
  }
  switch (targetFormat) {
    case 'markdown':
    case 'original':
      return { filename: `${baseFilename}.md`, content: artifactContent };
    case 'text': {
      const plainText = artifactContent
        .replace(/```[\s\S]*?```/g, m => m.replace(/```\w*\n?/, '').replace(/\n?```$/, ''))
        .replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1').replace(/__([^_]+)__/g, '$1')
        .replace(/_([^_]+)_/g, '$1').replace(/^#{1,6}\s+(.+)$/gm, '$1')
        .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1').replace(/!\[([^\]]*)\]\([^\)]+\)/g, '')
        .replace(/^[-*_]{3,}$/gm, '').replace(/\n{3,}/g, '\n\n');
      return { filename: `${baseFilename}.txt`, content: plainText.trim() };
    }
    case 'json': {
      return { filename: `${baseFilename}.json`, content: JSON.stringify({ title: baseFilename, language, content: artifactContent, format: 'markdown' }, null, 2) };
    }
    default:
      return { filename: `${baseFilename}${originalExt}`, content: artifactContent };
  }
}

function extractArtifactFiles(conversationData, artifactFormat) {
  const resolvedFormat = artifactFormat || 'original';
  const artifactFiles  = [];
  const usedFilenames  = new Set();
  const branchMessages = getCurrentBranch(conversationData);

  for (const message of branchMessages) {
    for (const artifact of extractArtifactsFromMessage(message)) {
      let baseFilename   = (artifact.title || 'artifact').replace(/[<>:"/\\|?*]/g, '_');
      const fileEntry    = convertArtifactToFileEntry(artifact.content, artifact.language, baseFilename, resolvedFormat);
      let uniqueFilename = fileEntry.filename;
      const extMatch     = uniqueFilename.match(/(\.[^.]+)$/);
      const fileExt      = extMatch ? extMatch[1] : '';
      const nameNoExt    = fileExt ? uniqueFilename.slice(0, -fileExt.length) : uniqueFilename;
      let   collision    = 1;
      while (usedFilenames.has(uniqueFilename)) {
        uniqueFilename = `${nameNoExt}_${collision}${fileExt}`;
        collision++;
      }
      usedFilenames.add(uniqueFilename);
      artifactFiles.push({ filename: uniqueFilename, content: fileEntry.content });
    }
  }
  return artifactFiles;
}

// =============================================================================
// 7. EXPORT CONVERTERS
// =============================================================================

function convertToMarkdown(conversationData, includeMetadata, conversationId, includeArtifacts, includeThinking) {
  let markdown = `# ${conversationData.name || 'Untitled Conversation'}\n\n`;

  if (includeMetadata) {
    markdown += `**Provider:** claude.ai\n`;
    markdown += `**Created:** ${new Date(conversationData.created_at).toLocaleString()}\n`;
    markdown += `**Updated:** ${new Date(conversationData.updated_at).toLocaleString()}\n`;
    markdown += `**Exported:** ${new Date().toLocaleString()}\n`;
    markdown += `**Model:** ${conversationData.model}\n`;
    if (conversationId) markdown += `**Link:** [https://claude.ai/chat/${conversationId}](https://claude.ai/chat/${conversationId})\n`;
    markdown += `\n---\n\n`;
  }

  for (const message of getCurrentBranch(conversationData)) {
    markdown += message.sender === 'human' ? '## User\n' : '## Claude\n';
    if (includeMetadata && message.created_at) markdown += `**${new Date(message.created_at).toISOString()}**\n`;
    markdown += '\n';

    const messageArtifacts = includeArtifacts ? extractArtifactsFromMessage(message) : [];

    if (message.content) {
      for (const contentBlock of message.content) {
        if (contentBlock.type === 'thinking' && contentBlock.thinking && includeThinking) {
          markdown += `### Thinking\n\`\`\`\`\n${contentBlock.thinking}\n\`\`\`\`\n\n`;
        } else if (contentBlock.type === 'text' && contentBlock.text) {
          const stripped = contentBlock.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
          if (stripped) markdown += `${stripped}\n\n`;
        }
      }
    } else if (message.text) {
      const stripped = message.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
      if (stripped) markdown += `${stripped}\n\n`;
    }

    for (const attachment of (message.attachments || [])) {
      if (attachment.extracted_content) markdown += `### Pasted\n\`\`\`\`\n${attachment.extracted_content}\n\`\`\`\`\n\n`;
    }

    for (const artifact of messageArtifacts) {
      markdown += `#### Artifact: ${artifact.title}\n`;
      markdown += `**Type:** ${artifact.type} | **Language:** ${artifact.language}\n\n`;
      if (artifact.type === 'code' || isProgrammingLanguage(artifact.language)) {
        markdown += `\`\`\`${artifact.language}\n${artifact.content}\n\`\`\`\n\n`;
      } else {
        markdown += `${artifact.content}\n\n`;
      }
    }
  }
  return markdown;
}

function convertToText(conversationData, includeMetadata, includeArtifacts, includeThinking) {
  let plainText = '';

  if (includeMetadata) {
    plainText += `${conversationData.name || 'Untitled Conversation'}\n`;
    plainText += `Provider: claude.ai\nCreated: ${new Date(conversationData.created_at).toLocaleString()}\n`;
    plainText += `Updated: ${new Date(conversationData.updated_at).toLocaleString()}\nModel: ${conversationData.model}\n\n---\n\n`;
  }

  for (const message of getCurrentBranch(conversationData)) {
    const artifacts     = includeArtifacts ? extractArtifactsFromMessage(message) : [];
    let   messageText   = '';
    let   thinkingText  = '';

    if (message.content) {
      for (const contentBlock of message.content) {
        if (contentBlock.type === 'thinking' && contentBlock.thinking && includeThinking) {
          const summary = contentBlock.summaries && contentBlock.summaries.length > 0
            ? contentBlock.summaries[contentBlock.summaries.length - 1].summary : 'Thought process';
          thinkingText += `[Thinking: ${summary}]\n${contentBlock.thinking}\n[End Thinking]\n\n`;
        } else if (contentBlock.type === 'text' && contentBlock.text) {
          messageText += contentBlock.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim() + ' ';
        }
      }
    } else if (message.text) {
      messageText = message.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
    }

    if (thinkingText) plainText += thinkingText;
    plainText += `${message.sender === 'human' ? 'User' : 'Claude'}: ${messageText.trim()}\n`;

    for (const artifact of artifacts) {
      plainText += `\n[Artifact: ${artifact.title} (${artifact.language})]\n${artifact.content}\n[End Artifact]\n`;
    }

    for (const attachment of (message.attachments || [])) {
      if (attachment.extracted_content) {
        const sizeNote = attachment.file_size ? ` (${attachment.file_size} bytes)` : '';
        plainText += `\n[Pasted content${sizeNote}]\n${attachment.extracted_content}\n[End Pasted content]\n`;
      }
    }
    plainText += '\n';
  }
  return plainText.trim();
}

function convertToJSONL(conversationData, conversationId) {
  const branch     = getCurrentBranch(conversationData);
  const exportedAt = new Date().toISOString();
  const lines      = [];

  branch.forEach((message, messageIndex) => {
    const artifacts      = extractArtifactsFromMessage(message);
    let   messageText    = '';
    const thinkingBlocks = [];

    if (message.content) {
      for (const contentBlock of message.content) {
        if (contentBlock.type === 'thinking' && contentBlock.thinking) {
          thinkingBlocks.push(contentBlock.thinking);
        } else if (contentBlock.type === 'text' && contentBlock.text) {
          messageText += contentBlock.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim() + ' ';
        }
      }
    } else if (message.text) {
      messageText = message.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
    }

    const attachmentSummaries = [];
    for (const attachment of (message.attachments || [])) {
      if (attachment.extracted_content) {
        attachmentSummaries.push({ content: attachment.extracted_content, size: attachment.file_size || null });
      }
    }

    lines.push(JSON.stringify({
      provider:                'claude.ai',
      conversation_id:         conversationId || conversationData.uuid || null,
      conversation_name:       conversationData.name || 'Untitled',
      model:                   conversationData.model,
      conversation_created_at: conversationData.created_at,
      conversation_updated_at: conversationData.updated_at,
      exported_at:             exportedAt,
      message_index:           messageIndex,
      message_uuid:            message.uuid || null,
      sender:                  message.sender,
      created_at:              message.created_at || null,
      text:                    messageText.trim(),
      thinking:                thinkingBlocks.length > 0 ? thinkingBlocks : null,
      artifacts:               artifacts.length > 0 ? artifacts.map(a => ({ title: a.title, language: a.language, type: a.type, content: a.content })) : null,
      attachments:             attachmentSummaries.length > 0 ? attachmentSummaries : null
    }));
  });
  return lines.join('\n');
}

// =============================================================================
// 8. FILE DOWNLOAD
// =============================================================================

function downloadFile(fileContent, filename, mimeType) {
  const blob      = new Blob([fileContent], { type: mimeType || 'application/json' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor    = document.createElement('a');
  anchor.href     = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
}

// =============================================================================
// 9. SERVER PUSH — legacy JSONL to /export/write
// =============================================================================

async function pushToServer(jsonlContent, filename) {
  try {
    const serverResponse = await fetch('http://localhost:7432/export/write', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ filename, content: jsonlContent })
    });
    if (!serverResponse.ok) {
      const errorText = await serverResponse.text();
      return { success: false, error: `Server ${serverResponse.status}: ${errorText}` };
    }
    return { success: true };
  } catch (networkErr) {
    return { success: false, error: networkErr.message };
  }
}

// =============================================================================
// 10. SLUG + IMAGE ASSET HELPERS
// =============================================================================

function generateChatSlug(conversationName) {
  const resolved = conversationName || 'untitled';
  const slugged  = resolved.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 80);
  return slugged || 'untitled';
}

function getMimeTypeExtension(mimeType) {
  const map = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp',
    'image/tiff': 'tiff', 'image/avif': 'avif', 'image/heic': 'heic'
  };
  return map[mimeType] || 'bin';
}

function arrayBufferToBase64(arrayBuffer) {
  const byteArray = new Uint8Array(arrayBuffer);
  let   binaryStr = '';
  for (let i = 0; i < byteArray.length; i++) binaryStr += String.fromCharCode(byteArray[i]);
  return btoa(binaryStr);
}

async function fetchImageAssetBytes(imageUrl) {
  try {
    const fetchResponse = await fetch(imageUrl, { credentials: 'include' });
    if (!fetchResponse.ok) return null;
    return arrayBufferToBase64(await fetchResponse.arrayBuffer());
  } catch (_fetchErr) {
    return null;
  }
}

async function collectImageAssets(conversationData, exportTimestamp) {
  const imageAssets    = [];
  const branchMessages = getCurrentBranch(conversationData);
  let   imageCounter   = 0;

  for (const message of branchMessages) {
    for (const fileAttachment of (message.files || [])) {
      if (!fileAttachment.file_type || !fileAttachment.file_type.startsWith('image/')) continue;
      imageCounter++;
      const assetFilename = `img_${String(imageCounter).padStart(3, '0')}_${exportTimestamp}.${getMimeTypeExtension(fileAttachment.file_type)}`;
      const entry = {
        asset_filename: assetFilename,
        message_uuid:   message.uuid || null,
        file_uuid:      fileAttachment.file_uuid || null,
        source_url:     fileAttachment.preview_url || null,
        mime_type:      fileAttachment.file_type,
        data_base64:    null
      };
      if (fileAttachment.preview_url) entry.data_base64 = await fetchImageAssetBytes(fileAttachment.preview_url);
      imageAssets.push(entry);
    }

    for (const attachment of (message.attachments || [])) {
      if (!attachment.file_type || !attachment.file_type.startsWith('image/')) continue;
      imageCounter++;
      const assetFilename = `img_${String(imageCounter).padStart(3, '0')}_${exportTimestamp}.${getMimeTypeExtension(attachment.file_type)}`;
      imageAssets.push({
        asset_filename: assetFilename,
        message_uuid:   message.uuid || null,
        file_uuid:      attachment.id || null,
        source_url:     null,
        mime_type:      attachment.file_type,
        data_base64:    null
      });
    }
  }
  return imageAssets;
}

// =============================================================================
// 11. CONVERSATION STATS + BRANCH MAP
// =============================================================================

// Derive all countable stats from raw chat_messages — no API calls, pure computation.
function computeConversationStats(conversationData) {
  const allMessages    = conversationData.chat_messages || [];
  const branchMessages = getCurrentBranch(conversationData);

  let humanCount = 0, assistantCount = 0;
  let thinkingCount = 0, artifactCount = 0;
  let toolUseCount = 0, toolResultCount = 0;
  let imageCount = 0, citationCount = 0;
  let truncatedCount = 0;

  for (const msg of allMessages) {
    if (msg.sender === 'human') humanCount++;
    else assistantCount++;

    if (msg.truncated) truncatedCount++;

    for (const block of (msg.content || [])) {
      switch (block.type) {
        case 'thinking':     thinkingCount++;   break;
        case 'tool_result':  toolResultCount++; break;
        case 'tool_use':
          toolUseCount++;
          if (block.name === 'artifacts') artifactCount++;
          break;
        case 'text':
          // Count citations inside text blocks
          if (Array.isArray(block.citations)) citationCount += block.citations.length;
          break;
      }
    }

    for (const f of (msg.files || [])) {
      if (f.file_type && f.file_type.startsWith('image/')) imageCount++;
    }
    for (const a of (msg.attachments || [])) {
      if (a.file_type && a.file_type.startsWith('image/')) imageCount++;
    }
  }

  // Detect branch points: any parent with more than one child = branched conversation
  const childCountByParent = {};
  for (const msg of allMessages) {
    const parentId = msg.parent_message_uuid;
    if (parentId) childCountByParent[parentId] = (childCountByParent[parentId] || 0) + 1;
  }
  const hasAlternateBranches = Object.values(childCountByParent).some(n => n > 1);

  // All leaf nodes = one leaf per branch
  const msgUuidSet = new Set(allMessages.map(m => m.uuid));
  const parentSet  = new Set(allMessages.map(m => m.parent_message_uuid).filter(Boolean));
  const leafUuids  = allMessages.filter(m => !parentSet.has(m.uuid)).map(m => m.uuid);

  return {
    total_messages:       allMessages.length,
    branch_message_count: branchMessages.length,
    human_message_count:  humanCount,
    assistant_message_count: assistantCount,
    thinking_block_count: thinkingCount,
    artifact_block_count: artifactCount,
    tool_use_count:       toolUseCount,
    tool_result_count:    toolResultCount,
    image_asset_count:    imageCount,
    citation_count:       citationCount,
    truncated_message_count: truncatedCount,
    has_alternate_branches: hasAlternateBranches,
    branch_count:         leafUuids.length,
  };
}

// Walk the full message tree and return a descriptor for every branch (path from root to leaf).
// Uses sentinel UUID as the root marker.
function buildBranchMap(conversationData) {
  const SENTINEL = '00000000-0000-4000-8000-000000000000';
  const allMessages   = conversationData.chat_messages || [];
  const activeLeafId  = conversationData.current_leaf_message_uuid || null;

  if (allMessages.length === 0) return [];

  const msgMap = new Map(allMessages.map(m => [m.uuid, m]));

  // childrenMap: parentUuid → [childUuid, ...]
  const childrenMap = {};
  for (const msg of allMessages) {
    if (!childrenMap[msg.uuid]) childrenMap[msg.uuid] = [];
    const parentId = msg.parent_message_uuid;
    if (parentId && parentId !== SENTINEL) {
      if (!childrenMap[parentId]) childrenMap[parentId] = [];
      childrenMap[parentId].push(msg.uuid);
    }
  }

  // Find leaves: messages with no children
  const leafUuids = allMessages.filter(m => !childrenMap[m.uuid] || childrenMap[m.uuid].length === 0).map(m => m.uuid);

  return leafUuids.map((leafUuid, idx) => {
    // Walk from leaf back to root to build path
    const path = [];
    let cur = leafUuid;
    while (cur && msgMap.has(cur)) {
      path.unshift(cur);
      const parent = msgMap.get(cur).parent_message_uuid;
      cur = (!parent || parent === SENTINEL) ? null : parent;
    }
    const senders = path.map(uid => {
      const msg = msgMap.get(uid);
      return msg ? msg.sender : null;
    }).filter(Boolean);

    return {
      branch_index:   idx,
      leaf_uuid:      leafUuid,
      is_active:      leafUuid === activeLeafId,
      message_count:  path.length,
      human_turns:    senders.filter(s => s === 'human').length,
      assistant_turns: senders.filter(s => s === 'assistant').length,
      message_uuids:  path,
    };
  });
}

// Extract all artifacts from the active branch and format them for server disk write.
// Returns [{ filename, content }] — same shape expected by /export/incoming artifactFiles.
function collectArtifactsForTransport(conversationData) {
  return extractArtifactFiles(conversationData, 'original');
}

// =============================================================================
// 12. EXPORT PAYLOAD BUILDER v2
//
// v2 schema adds:
//   org_id, org_name         — account/organization identity
//   claudeai_project_name    — Claude.ai project name (if conversation is in a project)
//   claudeai_project_uuid    — Claude.ai project UUID
//   is_starred, is_temporary — conversation flags
//   conversation_stats       — all derived counts (thinking, artifacts, tools, etc.)
//   branch_map               — every branch path in the message tree
//   feature_flags            — raw conversation.settings (bananagrams, sourdough, etc.)
//   platform                 — conversation.platform field
//   artifacts_manifest       — list of artifact files written to disk
// =============================================================================

function buildExportPayload(
  conversationData,
  conversationId,
  conversationUrl,
  projectFolder,
  projectName,
  imageAssets,
  exportTimestamp,
  // v2 enrichment fields — all optional, gracefully null when absent
  orgId              = null,
  orgName            = null,
  claudeaiProjectName = null,
  claudeaiProjectUuid = null,
  artifactsManifest  = []
) {
  const stats      = computeConversationStats(conversationData);
  const branchMap  = buildBranchMap(conversationData);

  const assetManifest = imageAssets.map(asset => ({
    asset_filename: asset.asset_filename,
    message_uuid:   asset.message_uuid,
    file_uuid:      asset.file_uuid,
    source_url:     asset.source_url,
    mime_type:      asset.mime_type,
    fetched:        asset.data_base64 !== null
  }));

  // Pull claudeai project fields from raw conversation data if not passed explicitly
  const resolvedProjectUuid = claudeaiProjectUuid || conversationData.project_uuid || null;

  return {
    piqpull_meta: {
      export_version:  2,
      exported_at:     exportTimestamp,
      provider:        'claude.ai',

      // Account / organization identity — who owns this conversation
      org_id:          orgId   || null,
      org_name:        orgName || null,

      // PiQuix pipeline routing
      piQuix_project:  projectName   || null,
      piQuix_folder:   projectFolder || null,

      // Conversation identity
      conversation_url:  conversationUrl,
      conversation_id:   conversationId,
      conversation_name: conversationData.name || 'Untitled',

      // Claude.ai project context — where the conversation lives within Claude.ai
      claudeai_project_name: claudeaiProjectName       || null,
      claudeai_project_uuid: resolvedProjectUuid       || null,

      // Model
      model:      conversationData.model      || null,

      // Timestamps
      created_at: conversationData.created_at || null,
      updated_at: conversationData.updated_at || null,

      // Conversation flags
      is_starred:   conversationData.is_starred   || false,
      is_temporary: conversationData.is_temporary || false,
      is_pinned:    conversationData.is_pinned    || false,

      // Derived counts (human/assistant turns, blocks, artifacts, images, etc.)
      conversation_stats: stats,

      // Full branch map — every path in the message tree
      branch_map: branchMap,

      // Raw Claude.ai feature flags (bananagrams, sourdough, foccacia, paprika_mode, etc.)
      feature_flags: conversationData.settings || null,

      // Platform field from raw conversation (always "CLAUDE_AI" currently)
      platform: conversationData.platform || null,

      // Summary if Claude.ai generated one
      summary: conversationData.summary || null,

      // Image assets written to assets/ subfolder
      image_asset_count: imageAssets.length,
      image_assets:      assetManifest,

      // Artifact files written to artifacts/ subfolder
      artifacts_manifest: artifactsManifest || [],
    },
    conversation: conversationData
  };
}
