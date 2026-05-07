// PiQPull — Shared Utility Functions
// Provider: Claude.ai
// Source repo: Candiman421/PiQPull

// =============================================================================
// TIMESTAMP
// =============================================================================

// PiQ standard: YYYY.MM.DD-HHmmss  e.g. 2026.05.07-143022
function getPiQTimestamp() {
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${y}.${mo}.${d}-${h}${mi}${s}`;
}

// =============================================================================
// MODEL INFERENCE
// Single source of truth — imported by content.js and browse.js.
// Dates represent when each model became the Claude.ai default.
// FIX: 2025-02-29 does not exist (2025 is not a leap year). Corrected to 2025-02-24.
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

function inferModel(conversation) {
  if (conversation.model) return conversation.model;
  const convDate = new Date(conversation.created_at);
  for (let i = DEFAULT_MODEL_TIMELINE.length - 1; i >= 0; i--) {
    if (convDate >= DEFAULT_MODEL_TIMELINE[i].date) {
      return DEFAULT_MODEL_TIMELINE[i].model;
    }
  }
  return DEFAULT_MODEL_TIMELINE[0].model;
}

// =============================================================================
// BRANCH RECONSTRUCTION
// Walks the message tree from leaf to root to get the active conversation path.
// Handles very old conversations where current_leaf_message_uuid may be absent.
// =============================================================================

function getCurrentBranch(data) {
  if (!data.chat_messages || !Array.isArray(data.chat_messages)) return [];

  // Old format fallback: no leaf UUID — return messages in order
  if (!data.current_leaf_message_uuid) {
    return data.chat_messages;
  }

  const messageMap = new Map();
  data.chat_messages.forEach(msg => messageMap.set(msg.uuid, msg));

  const branch = [];
  let currentUuid = data.current_leaf_message_uuid;

  while (currentUuid && messageMap.has(currentUuid)) {
    const message = messageMap.get(currentUuid);
    branch.unshift(message);
    currentUuid = message.parent_message_uuid;
    if (!messageMap.has(currentUuid)) break;
  }

  return branch;
}

// =============================================================================
// ARTIFACT EXTRACTION
// Supports both formats:
//   NEW: tool_use with display_content (code_block or json_block)
//   OLD: <antArtifact> tags embedded in message text
// =============================================================================

function extractArtifactsFromMessage(message) {
  const artifacts = [];

  if (message.content && Array.isArray(message.content)) {
    for (const content of message.content) {
      // NEW FORMAT — artifacts tool only; bash/web_search/repl are filtered out
      if (content.type === 'tool_use' && content.name === 'artifacts' && content.display_content) {
        const dc = content.display_content;

        if (dc.type === 'code_block' && dc.code) {
          const language = dc.language || 'txt';
          const filename = dc.filename || 'artifact';
          const title = filename.split('/').pop().replace(/\.[^.]+$/, '');
          artifacts.push({
            title: title || 'Untitled',
            language,
            type: isProgrammingLanguage(language) ? 'code' : 'document',
            identifier: null,
            content: dc.code.trim()
          });
        } else if (dc.type === 'json_block' && dc.json_block) {
          try {
            const ad = JSON.parse(dc.json_block);
            if (ad.filename) {
              const language = ad.language || 'txt';
              const title = ad.filename.split('/').pop().replace(/\.[^.]+$/, '');
              artifacts.push({
                title: title || 'Untitled',
                language,
                type: isProgrammingLanguage(language) ? 'code' : 'document',
                identifier: null,
                content: (ad.code || '').trim()
              });
            }
          } catch (e) {
            console.warn('PiQPull: Failed to parse artifact json_block:', e);
          }
        }
      }

      // OLD FORMAT — antArtifact tags in text content
      if (content.text) {
        artifacts.push(...extractArtifactsFromText(content.text));
      }
    }
  }

  // OLDEST FORMAT — message.text directly
  if (message.text) {
    artifacts.push(...extractArtifactsFromText(message.text));
  }

  return artifacts;
}

function extractArtifactsFromText(text) {
  const artifactRegex = /<antArtifact[^>]*>([\s\S]*?)<\/antArtifact>/g;
  const artifacts = [];
  let match;

  while ((match = artifactRegex.exec(text)) !== null) {
    const fullTag = match[0];
    const content = match[1];
    const titleMatch = fullTag.match(/title="([^"]*)"/);
    const typeMatch = fullTag.match(/type="([^"]*)"/);
    const languageMatch = fullTag.match(/language="([^"]*)"/);
    const identifierMatch = fullTag.match(/identifier="([^"]*)"/);

    let artifactType = 'text';
    let language = 'txt';

    if (typeMatch) {
      const t = typeMatch[1];
      if (t === 'text/html') { language = 'html'; artifactType = 'code'; }
      else if (t === 'text/markdown') { language = 'markdown'; artifactType = 'document'; }
      else if (t === 'application/vnd.ant.code') { language = languageMatch ? languageMatch[1] : 'txt'; artifactType = 'code'; }
      else if (t === 'text/css') { language = 'css'; artifactType = 'code'; }
      else if (t === 'application/vnd.ant.mermaid') { language = 'mermaid'; artifactType = 'document'; }
      else if (t === 'application/vnd.ant.react') { language = 'jsx'; artifactType = 'code'; }
      else if (t === 'image/svg+xml') { language = 'svg'; artifactType = 'code'; }
    } else if (languageMatch) {
      language = languageMatch[1];
      artifactType = 'code';
    }

    artifacts.push({
      title: titleMatch ? titleMatch[1] : 'Untitled',
      language,
      type: artifactType,
      identifier: identifierMatch ? identifierMatch[1] : null,
      content: content.trim()
    });
  }

  return artifacts;
}

// Legacy alias
function extractArtifacts(text) {
  return extractArtifactsFromText(text);
}

// =============================================================================
// LANGUAGE / EXTENSION HELPERS
// =============================================================================

function isProgrammingLanguage(language) {
  const langs = [
    'javascript', 'typescript', 'python', 'java', 'c', 'cpp', 'c++', 'ruby', 'php',
    'swift', 'go', 'rust', 'jsx', 'tsx', 'shell', 'bash', 'sql', 'kotlin', 'scala',
    'r', 'perl', 'lua', 'dart', 'elixir', 'erlang', 'haskell', 'clojure', 'fsharp',
    'f#', 'c#', 'csharp', 'objective-c', 'ocaml', 'scheme', 'lisp', 'fortran',
    'assembly', 'asm', 'groovy', 'html', 'css', 'scss', 'sass', 'less', 'stylus'
  ];
  return langs.includes((language || '').toLowerCase());
}

function getFileExtension(language) {
  const map = {
    javascript: '.js', typescript: '.ts', python: '.py', java: '.java',
    c: '.c', cpp: '.cpp', 'c++': '.cpp', ruby: '.rb', php: '.php',
    swift: '.swift', go: '.go', rust: '.rs', jsx: '.jsx', tsx: '.tsx',
    shell: '.sh', bash: '.sh', sql: '.sql', kotlin: '.kt', scala: '.scala',
    r: '.r', matlab: '.m', json: '.json', xml: '.xml', yaml: '.yaml',
    yml: '.yml', markdown: '.md', md: '.md', text: '.txt', txt: '.txt',
    latex: '.tex', tex: '.tex', bibtex: '.bib', bib: '.bib',
    mermaid: '.mmd', svg: '.svg', csv: '.csv', toml: '.toml', ini: '.ini',
    perl: '.pl', lua: '.lua', dart: '.dart', elixir: '.ex', erlang: '.erl',
    haskell: '.hs', clojure: '.clj', fsharp: '.fs', 'f#': '.fs',
    'c#': '.cs', csharp: '.cs', 'objective-c': '.m', ocaml: '.ml',
    scheme: '.scm', lisp: '.lisp', fortran: '.f90', assembly: '.asm',
    asm: '.asm', scss: '.scss', sass: '.sass', less: '.less',
    stylus: '.styl', dockerfile: '.dockerfile', makefile: '.mk',
    gradle: '.gradle', groovy: '.groovy'
  };
  return map[(language || '').toLowerCase()] || '.txt';
}

// =============================================================================
// ARTIFACT FILE EXTRACTION
// =============================================================================

function convertArtifactFormat(content, language, baseFilename, format) {
  const originalExt = getFileExtension(language);

  // Code files and non-markdown always stay in original format
  if (isProgrammingLanguage(language) || originalExt !== '.md') {
    return { filename: `${baseFilename}${originalExt}`, content };
  }

  switch (format) {
    case 'markdown':
    case 'original':
      return { filename: `${baseFilename}.md`, content };

    case 'text': {
      let plain = content
        .replace(/```[\s\S]*?```/g, m => m.replace(/```\w*\n?/, '').replace(/\n?```$/, ''))
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/^#{1,6}\s+(.+)$/gm, '$1')
        .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
        .replace(/!\[([^\]]*)\]\([^\)]+\)/g, '')
        .replace(/^[-*_]{3,}$/gm, '')
        .replace(/\n{3,}/g, '\n\n');
      return { filename: `${baseFilename}.txt`, content: plain.trim() };
    }

    case 'json': {
      const jsonData = { title: baseFilename, language, content, format: 'markdown' };
      return { filename: `${baseFilename}.json`, content: JSON.stringify(jsonData, null, 2) };
    }

    default:
      return { filename: `${baseFilename}${originalExt}`, content };
  }
}

function extractArtifactFiles(data, artifactFormat = 'original') {
  const artifactFiles = [];
  const usedFilenames = new Set();
  const branchMessages = getCurrentBranch(data);

  for (const message of branchMessages) {
    const artifacts = extractArtifactsFromMessage(message);

    for (const artifact of artifacts) {
      let baseFilename = (artifact.title || 'artifact').replace(/[<>:"/\\|?*]/g, '_');
      const converted = convertArtifactFormat(artifact.content, artifact.language, baseFilename, artifactFormat);
      let filename = converted.filename;

      const extMatch = filename.match(/(\.[^.]+)$/);
      const ext = extMatch ? extMatch[1] : '';
      const nameNoExt = ext ? filename.slice(0, -ext.length) : filename;

      let counter = 1;
      while (usedFilenames.has(filename)) {
        filename = `${nameNoExt}_${counter}${ext}`;
        counter++;
      }
      usedFilenames.add(filename);
      artifactFiles.push({ filename, content: converted.content });
    }
  }

  return artifactFiles;
}

// =============================================================================
// EXPORT CONVERTERS
// =============================================================================

function convertToMarkdown(data, includeMetadata, conversationId = null, includeArtifacts = true, includeThinking = true) {
  let md = `# ${data.name || 'Untitled Conversation'}\n\n`;

  if (includeMetadata) {
    md += `**Provider:** claude.ai\n`;
    md += `**Created:** ${new Date(data.created_at).toLocaleString()}\n`;
    md += `**Updated:** ${new Date(data.updated_at).toLocaleString()}\n`;
    md += `**Exported:** ${new Date().toLocaleString()}\n`;
    md += `**Model:** ${data.model}\n`;
    if (conversationId) {
      md += `**Link:** [https://claude.ai/chat/${conversationId}](https://claude.ai/chat/${conversationId})\n`;
    }
    md += `\n---\n\n`;
  }

  const branch = getCurrentBranch(data);

  for (const message of branch) {
    md += message.sender === 'human' ? '## User\n' : '## Claude\n';
    if (includeMetadata && message.created_at) {
      md += `**${new Date(message.created_at).toISOString()}**\n`;
    }
    md += '\n';

    const messageArtifacts = includeArtifacts ? extractArtifactsFromMessage(message) : [];

    if (message.content) {
      for (const c of message.content) {
        if (c.type === 'thinking' && c.thinking && includeThinking) {
          md += `### Thinking\n\`\`\`\`\n${c.thinking}\n\`\`\`\`\n\n`;
        } else if (c.type === 'text' && c.text) {
          const text = c.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
          if (text) md += `${text}\n\n`;
        }
      }
    } else if (message.text) {
      const text = message.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
      if (text) md += `${text}\n\n`;
    }

    if (message.attachments) {
      for (const att of message.attachments) {
        if (att.extracted_content) {
          md += `### Pasted\n\`\`\`\`\n${att.extracted_content}\n\`\`\`\`\n\n`;
        }
      }
    }

    for (const artifact of messageArtifacts) {
      md += `#### Artifact: ${artifact.title}\n`;
      md += `**Type:** ${artifact.type} | **Language:** ${artifact.language}\n\n`;
      if (artifact.type === 'code' || isProgrammingLanguage(artifact.language)) {
        md += `\`\`\`${artifact.language}\n${artifact.content}\n\`\`\`\n\n`;
      } else {
        md += `${artifact.content}\n\n`;
      }
    }
  }

  return md;
}

function convertToText(data, includeMetadata, includeArtifacts = true, includeThinking = true) {
  let text = '';

  if (includeMetadata) {
    text += `${data.name || 'Untitled Conversation'}\n`;
    text += `Provider: claude.ai\n`;
    text += `Created: ${new Date(data.created_at).toLocaleString()}\n`;
    text += `Updated: ${new Date(data.updated_at).toLocaleString()}\n`;
    text += `Model: ${data.model}\n\n---\n\n`;
  }

  const branch = getCurrentBranch(data);

  for (const message of branch) {
    const artifacts = includeArtifacts ? extractArtifactsFromMessage(message) : [];
    let messageText = '';
    let thinkingText = '';

    if (message.content) {
      for (const c of message.content) {
        if (c.type === 'thinking' && c.thinking && includeThinking) {
          const summary = c.summaries && c.summaries.length > 0
            ? c.summaries[c.summaries.length - 1].summary
            : 'Thought process';
          thinkingText += `[Thinking: ${summary}]\n${c.thinking}\n[End Thinking]\n\n`;
        } else if (c.type === 'text' && c.text) {
          messageText += c.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim() + ' ';
        }
      }
    } else if (message.text) {
      messageText = message.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
    }

    messageText = messageText.trim();
    const label = message.sender === 'human' ? 'User' : 'Claude';

    if (thinkingText) text += thinkingText;
    text += `${label}: ${messageText}\n`;

    for (const artifact of artifacts) {
      text += `\n[Artifact: ${artifact.title} (${artifact.language})]\n${artifact.content}\n[End Artifact]\n`;
    }

    if (message.attachments) {
      for (const att of message.attachments) {
        if (att.extracted_content) {
          const size = att.file_size ? ` (${att.file_size} bytes)` : '';
          text += `\n[Pasted content${size}]\n${att.extracted_content}\n[End Pasted content]\n`;
        }
      }
    }

    text += '\n';
  }

  return text.trim();
}

// JSONL format — one JSON object per message line, feeds localhost:7432/export/write
function convertToJSONL(data, conversationId) {
  const branch = getCurrentBranch(data);
  const exportedAt = new Date().toISOString();
  const lines = [];

  branch.forEach((message, index) => {
    const artifacts = extractArtifactsFromMessage(message);
    let messageText = '';
    let thinkingBlocks = [];

    if (message.content) {
      for (const c of message.content) {
        if (c.type === 'thinking' && c.thinking) {
          thinkingBlocks.push(c.thinking);
        } else if (c.type === 'text' && c.text) {
          messageText += c.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim() + ' ';
        }
      }
    } else if (message.text) {
      messageText = message.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
    }

    const attachments = [];
    if (message.attachments) {
      for (const att of message.attachments) {
        if (att.extracted_content) {
          attachments.push({ content: att.extracted_content, size: att.file_size || null });
        }
      }
    }

    lines.push(JSON.stringify({
      provider: 'claude.ai',
      conversation_id: conversationId || data.uuid || null,
      conversation_name: data.name || 'Untitled',
      model: data.model,
      conversation_created_at: data.created_at,
      conversation_updated_at: data.updated_at,
      exported_at: exportedAt,
      message_index: index,
      message_uuid: message.uuid || null,
      sender: message.sender,
      created_at: message.created_at || null,
      text: messageText.trim(),
      thinking: thinkingBlocks.length > 0 ? thinkingBlocks : null,
      artifacts: artifacts.length > 0 ? artifacts.map(a => ({
        title: a.title, language: a.language, type: a.type, content: a.content
      })) : null,
      attachments: attachments.length > 0 ? attachments : null
    }));
  });

  return lines.join('\n');
}

// =============================================================================
// DOWNLOAD
// =============================================================================

function downloadFile(content, filename, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// =============================================================================
// SERVER PUSH — POST JSONL to PiQuix localhost:7432/export/write
// Called from background.js (service worker) to avoid CORS issues.
// Returns { success, error } — caller handles UI feedback.
// =============================================================================

async function pushToServer(jsonlContent, filename) {
  try {
    const response = await fetch('http://localhost:7432/export/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, content: jsonlContent })
    });
    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Server ${response.status}: ${text}` };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
