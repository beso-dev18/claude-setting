// Markdown parsing shared by validate-plan.mjs and impl-review's review-scope.mjs.
// Frontmatter is flat `key: value`; lists are `[a, b]`. Tables are GitHub pipe tables.

export function splitFrontmatter(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const fm = {};
  let start = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) {
      for (const l of lines.slice(1, end)) {
        const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(l);
        if (m) fm[m[1]] = m[2].trim();
      }
      start = end + 1;
    }
  }
  return { fm, lines: lines.slice(start), offset: start };
}

export const asList = (v) => {
  const m = /^\[(.*)\]$/.exec(v ?? '');
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : null;
};

export const splitRow = (t) => t.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());

export function findTable(body) {
  for (let i = 0; i + 1 < body.length; i++) {
    if (body[i].inFence || !body[i].text.trim().startsWith('|')) continue;
    if (!/^\s*\|[\s:|-]+\|?\s*$/.test(body[i + 1].text)) continue;
    const rows = [];
    for (let j = i + 2; j < body.length && !body[j].inFence && body[j].text.trim().startsWith('|'); j++) {
      rows.push({ cells: splitRow(body[j].text), line: body[j].line });
    }
    return { header: splitRow(body[i].text), rows, line: body[i].line };
  }
  return null;
}

// Returns sections in document order; sections[0] is the preamble before the first heading.
export function parseDoc(lines, offset) {
  const sections = [];
  let cur = { level: 0, text: '', line: offset, body: [] };
  let fence = false;
  lines.forEach((raw, i) => {
    const line = offset + i + 1;
    const isFence = /^\s*```/.test(raw);
    if (isFence) fence = !fence;
    const h = !fence && !isFence && /^(#{1,6})\s+(.*?)\s*$/.exec(raw);
    if (h) {
      sections.push(cur);
      cur = { level: h[1].length, text: h[2], line, body: [] };
    } else {
      cur.body.push({ text: raw, line, inFence: fence || isFence });
    }
  });
  sections.push(cur);
  for (const s of sections) {
    s.content = s.body.map((b) => b.text).join('\n').trim();
    s.blank = s.content === '';
    s.table = findTable(s.body);
  }
  return sections;
}

// Table rows as objects keyed by column name; [] when the section is missing, None, or malformed.
export function rows(section) {
  if (!section || section.none || !section.table) return [];
  const { header } = section.table;
  return section.table.rows.map((r) => ({ line: r.line, ...Object.fromEntries(header.map((h, i) => [h, r.cells[i] ?? ''])) }));
}

// The rows of the level-2 section titled `heading` in a whole markdown file; [] if absent.
export function tableOf(text, heading) {
  if (!text) return [];
  const { lines, offset } = splitFrontmatter(text);
  return rows(parseDoc(lines, offset).find((s) => s.level === 2 && s.text === heading));
}
