import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(SCRIPT_DIR, '..');
const CSS_DIR = path.join(WEB_ROOT, 'app');
const SOURCE_DIRS = ['app', 'components', 'lib', 'hooks'];

function stripCssComments(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      i += 2;
      while (i < css.length && !(css[i] === '*' && css[i + 1] === '/')) {
        if (css[i] === '\n') out += '\n';
        i += 1;
      }
      i += 2;
      out += ' ';
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < css.length) {
        const c = css[i];
        out += c;
        i += 1;
        if (c === '\\' && i < css.length) {
          out += css[i];
          i += 1;
          continue;
        }
        if (c === quote) break;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function parseCssBlocks(css) {
  const blocks = [];
  let i = 0;
  let preludeStart = 0;

  while (i < css.length) {
    const ch = css[i];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i += 1;
      while (i < css.length) {
        if (css[i] === '\\') {
          i += 2;
          continue;
        }
        if (css[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === ';' && preludeStart <= i) {
      i += 1;
      preludeStart = i;
      continue;
    }
    if (ch === '{') {
      const prelude = css.slice(preludeStart, i).trim();
      const blockStart = preludeStart;
      let depth = 1;
      const bodyStart = i + 1;
      i += 1;
      while (i < css.length && depth > 0) {
        const c = css[i];
        if (c === "'" || c === '"') {
          const q = c;
          i += 1;
          while (i < css.length) {
            if (css[i] === '\\') {
              i += 2;
              continue;
            }
            if (css[i] === q) {
              i += 1;
              break;
            }
            i += 1;
          }
          continue;
        }
        if (c === '{') depth += 1;
        else if (c === '}') depth -= 1;
        i += 1;
      }
      const bodyEnd = i - 1;
      blocks.push({
        prelude,
        body: css.slice(bodyStart, bodyEnd),
        start: blockStart,
        end: i,
      });
      preludeStart = i;
      continue;
    }
    i += 1;
  }
  return blocks;
}

function stripAttrBrackets(selector) {
  let out = '';
  let depth = 0;
  let i = 0;
  while (i < selector.length) {
    const ch = selector[i];
    if (ch === "'" || ch === '"') {
      const q = ch;
      i += 1;
      while (i < selector.length) {
        if (selector[i] === '\\') {
          i += 2;
          continue;
        }
        if (selector[i] === q) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === '[') {
      depth += 1;
      out += ' ';
      i += 1;
      continue;
    }
    if (ch === ']') {
      depth = Math.max(0, depth - 1);
      out += ' ';
      i += 1;
      continue;
    }
    out += depth > 0 ? ' ' : ch;
    i += 1;
  }
  return out;
}

export function extractClassesFromSelector(selector) {
  const cleaned = stripAttrBrackets(selector);
  const classes = new Set();
  const re = /\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g;
  let match = re.exec(cleaned);
  while (match !== null) {
    classes.add(match[1]);
    match = re.exec(cleaned);
  }
  return [...classes];
}

function isSkippedAtRule(prelude) {
  return /^@(?:-[a-z]+-)?(?:keyframes|theme|font-face|property)\b/i.test(prelude);
}

function isContainerAtRule(prelude) {
  return /^@(?:media|supports|layer|container)\b/i.test(prelude);
}

function hasNestedBlock(body) {
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === "'" || ch === '"') {
      const q = ch;
      i += 1;
      while (i < body.length) {
        if (body[i] === '\\') {
          i += 2;
          continue;
        }
        if (body[i] === q) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === '{') return true;
    i += 1;
  }
  return false;
}

function collectClassesFromCss(css, fileName, classFiles) {
  const stripped = stripCssComments(css);
  const visitBlocks = (text) => {
    for (const block of parseCssBlocks(text)) {
      if (!block.prelude || isSkippedAtRule(block.prelude)) continue;
      if (isContainerAtRule(block.prelude)) {
        visitBlocks(block.body);
        continue;
      }
      for (const cls of extractClassesFromSelector(block.prelude)) {
        let files = classFiles.get(cls);
        if (!files) {
          files = new Set();
          classFiles.set(cls, files);
        }
        files.add(fileName);
      }
      if (hasNestedBlock(block.body)) {
        visitBlocks(block.body);
      }
    }
  };
  visitBlocks(stripped);
}

function walkTsFiles(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsFiles(full, result);
    } else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
      result.push(full);
    }
  }
  return result;
}

function extractDynamicPrefixes(sources) {
  const prefixes = new Set();
  const templateRe = /([A-Za-z_][A-Za-z0-9_-]*-)\$\{/g;
  const concatRe = /['"]([A-Za-z_][A-Za-z0-9_-]*-)['"]\s*\+/g;
  for (const src of sources) {
    let m = templateRe.exec(src.content);
    while (m !== null) {
      prefixes.add(m[1]);
      m = templateRe.exec(src.content);
    }
    m = concatRe.exec(src.content);
    while (m !== null) {
      prefixes.add(m[1]);
      m = concatRe.exec(src.content);
    }
  }
  return [...prefixes].sort((a, b) => a.localeCompare(b));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function auditCssUsage() {
  const cssFiles = fs
    .readdirSync(CSS_DIR)
    .filter((name) => name.endsWith('.css'))
    .sort((a, b) => a.localeCompare(b));

  const classFiles = new Map();
  for (const name of cssFiles) {
    const content = fs.readFileSync(path.join(CSS_DIR, name), 'utf8');
    collectClassesFromCss(content, name, classFiles);
  }

  const tsPaths = SOURCE_DIRS.flatMap((dir) => walkTsFiles(path.join(WEB_ROOT, dir)));
  const sources = tsPaths.map((filePath) => ({
    filePath: path.relative(WEB_ROOT, filePath).replace(/\\/g, '/'),
    content: fs.readFileSync(filePath, 'utf8'),
  }));

  const dynamicPrefixes = extractDynamicPrefixes(sources);
  const combinedSource = sources.map((s) => s.content).join('\n');

  const allClasses = [...classFiles.keys()].sort((a, b) => a.localeCompare(b));
  const zeroRefClasses = [];
  const dynamicProtectedClasses = [];
  const deadClasses = [];

  for (const cls of allClasses) {
    const tokenRe = new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(cls)}(?![A-Za-z0-9_-])`);
    const referenced = tokenRe.test(combinedSource);
    const matchedPrefix = dynamicPrefixes.find((prefix) => cls.startsWith(prefix));
    if (!referenced) {
      zeroRefClasses.push({
        className: cls,
        files: [...(classFiles.get(cls) ?? [])],
        dynamicPrefix: matchedPrefix ?? null,
      });
      if (matchedPrefix) {
        dynamicProtectedClasses.push(cls);
      } else {
        deadClasses.push({
          className: cls,
          files: [...(classFiles.get(cls) ?? [])],
        });
      }
    }
  }

  return {
    cssFiles,
    sourceFileCount: sources.length,
    totalClasses: allClasses.length,
    dynamicPrefixes,
    dynamicProtectedClasses,
    deadClasses,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = auditCssUsage();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`CSS files scanned (${report.cssFiles.length}): ${report.cssFiles.join(', ')}`);
    console.log(`TS/TSX files scanned: ${report.sourceFileCount}`);
    console.log(`Total CSS classes found: ${report.totalClasses}`);
    console.log(`Dynamic prefixes detected (${report.dynamicPrefixes.length}): ${report.dynamicPrefixes.join(', ')}`);
    console.log(
      `Zero-direct-ref classes protected by dynamic prefix (${report.dynamicProtectedClasses.length}): ${report.dynamicProtectedClasses.join(', ')}`,
    );
    console.log(`\nUnreferenced CSS classes (${report.deadClasses.length}):`);
    for (const item of report.deadClasses) {
      console.log(`  .${item.className} (${item.files.join(', ')})`);
    }
  }
}
