const { LEVELS } = require('./store');
const { ApiError, pickText } = require('./errors');

// 一条命中的身份：规则 + 文件 + 行号，与忽略记录用的是同一套口径
function hitKey(hit) {
  return `${hit.ruleId}|${hit.fileId}|${hit.lineNo}`;
}

// 目录按路径里最后一个斜线切，根目录下的文件记成空串
function dirOf(filePath) {
  const index = filePath.lastIndexOf('/');
  return index === -1 ? '' : filePath.slice(0, index);
}

function displayDir(dir) {
  return dir || '(根目录)';
}

// 页面把这一轮的命中原样带回来，这里只认需要的字段，缺了身份的条目直接丢掉
function normalizeHit(item) {
  const source = item && typeof item === 'object' ? item : {};
  const ruleId = pickText(source.ruleId);
  const fileId = pickText(source.fileId);
  const lineNo = Number(source.lineNo);
  if (!ruleId || !fileId || !Number.isInteger(lineNo) || lineNo < 1) return null;
  return {
    ruleId,
    fileId,
    lineNo,
    code: pickText(source.code),
    ruleName: pickText(source.ruleName),
    level: LEVELS.includes(source.level) ? source.level : LEVELS[0],
    path: pickText(source.path),
    lineText: typeof source.lineText === 'string' ? source.lineText : '',
    ignored: source.ignored === true,
  };
}

// 导出范围：整轮还是勾选的，再叠加级别、规则、目录三组过滤；
// 没传的组当作全选，传了空数组的组一条都选不中
function normalizeSelection(value) {
  const input = value && typeof value === 'object' ? value : {};
  const mode = pickText(input.mode) || 'all';
  if (mode !== 'all' && mode !== 'checked') {
    throw new ApiError(400, 'EXPORT_MODE_INVALID', '导出范围只能是这一轮全部命中或者勾选的命中', '');
  }
  const levels = Array.isArray(input.levels)
    ? Array.from(new Set(input.levels.map(pickText)))
    : LEVELS.slice();
  const unknownLevel = levels.find((item) => !LEVELS.includes(item));
  if (unknownLevel !== undefined) {
    throw new ApiError(400, 'LEVEL_INVALID', `级别只能是 ${LEVELS.join('、')} 其中之一`, '');
  }
  const checkedKeys = Array.isArray(input.checkedKeys)
    ? input.checkedKeys.map(pickText).filter(Boolean)
    : [];
  const rules = Array.isArray(input.rules)
    ? Array.from(new Set(input.rules.map(pickText).filter(Boolean)))
    : null;
  const directories = Array.isArray(input.directories)
    ? Array.from(new Set(input.directories.map((item) => (typeof item === 'string' ? item.trim() : ''))))
    : null;
  return { mode, checkedKeys, levels, rules, directories };
}

// 命中顺序固定按规则编码、文件路径、行号排，同一轮重复导出顺序才会一致
function pickHits(hits, selection) {
  const checkedSet = new Set(selection.checkedKeys);
  const levelSet = new Set(selection.levels);
  const ruleSet = selection.rules ? new Set(selection.rules) : null;
  const dirSet = selection.directories ? new Set(selection.directories) : null;
  return hits
    .filter((hit) => (selection.mode === 'checked' ? checkedSet.has(hitKey(hit)) : true))
    .filter((hit) => levelSet.has(hit.level))
    .filter((hit) => (ruleSet ? ruleSet.has(hit.code) : true))
    .filter((hit) => (dirSet ? dirSet.has(dirOf(hit.path)) : true))
    .sort((a, b) => {
      if (a.code !== b.code) return a.code < b.code ? -1 : 1;
      if (a.path !== b.path) return a.path < b.path ? -1 : 1;
      return a.lineNo - b.lineNo;
    });
}

function summarize(picked) {
  const byLevel = {};
  LEVELS.forEach((item) => { byLevel[item] = 0; });
  picked.forEach((hit) => { byLevel[hit.level] += 1; });

  const byRuleMap = new Map();
  picked.forEach((hit) => {
    if (!byRuleMap.has(hit.code)) {
      byRuleMap.set(hit.code, { code: hit.code, ruleName: hit.ruleName, level: hit.level, count: 0 });
    }
    byRuleMap.get(hit.code).count += 1;
  });

  return {
    total: picked.length,
    ignored: picked.filter((hit) => hit.ignored).length,
    byLevel,
    byRule: Array.from(byRuleMap.values()).sort((a, b) => (a.code < b.code ? -1 : 1)),
  };
}

// 扫描时刻是这一轮的属性，原样写进内容里，两次导出看到的才是同一轮
function formatScanTime(value) {
  const text = pickText(value);
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z$/.exec(text);
  return match ? `${match[1]} ${match[2]} UTC` : (text || '未知');
}

function scopeText(selection) {
  const parts = [];
  parts.push(selection.mode === 'checked' ? '勾选的命中' : '这一轮全部命中');
  parts.push(selection.levels.length === LEVELS.length ? '全部级别' : `级别 ${selection.levels.join('、') || '（未选）'}`);
  parts.push(selection.rules === null ? '全部规则' : `规则 ${selection.rules.join('、') || '（未选）'}`);
  parts.push(selection.directories === null ? '全部目录' : `目录 ${selection.directories.map(displayDir).join('、') || '（未选）'}`);
  return parts.join('；');
}

function escapeCell(text) {
  return String(text).replace(/\|/g, '\\|');
}

// 导出内容只由这一轮的数据与所选范围决定，不写导出时刻，
// 同一轮重复导出的内容才会一字不差（导出时刻放在文件名里）
function buildContent(scannedAt, selection, picked, summary) {
  const lines = [];
  lines.push('# 检查命中导出');
  lines.push('');
  lines.push(`扫描时刻：${formatScanTime(scannedAt)}`);
  lines.push(`导出范围：${scopeText(selection)}`);
  lines.push(`命中一共 ${summary.total} 条，其中已忽略 ${summary.ignored} 条`);
  lines.push('');
  lines.push('## 按级别汇总');
  lines.push('');
  lines.push(LEVELS.map((item) => `${item} ${summary.byLevel[item]} 条`).join('　'));
  lines.push('');
  lines.push('## 按规则汇总');
  lines.push('');
  if (summary.byRule.length) {
    summary.byRule.forEach((item) => {
      lines.push(`- ${item.code} ${item.ruleName}（${item.level}）：${item.count} 条`);
    });
  } else {
    lines.push('没有规则命中');
  }
  lines.push('');
  lines.push('## 命中明细');
  lines.push('');
  if (picked.length) {
    lines.push('| 序号 | 规则编码 | 级别 | 规则名称 | 文件 | 行号 | 行内容 | 状态 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    picked.forEach((hit, index) => {
      lines.push(`| ${index + 1} | ${escapeCell(hit.code)} | ${hit.level} | ${escapeCell(hit.ruleName)} | ${escapeCell(hit.path)} | ${hit.lineNo} | ${escapeCell(hit.lineText)} | ${hit.ignored ? '已忽略' : '未忽略'} |`);
    });
  } else {
    lines.push('这一范围没有命中');
  }
  lines.push('');
  return lines.join('\n');
}

function pad2(num) {
  return String(num).padStart(2, '0');
}

function filenameStamp(date) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

// 文件名里不能出现的字符统一换成短横线
function safePart(text) {
  return String(text).replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
}

// 文件名要能看出导出时刻与覆盖的范围：时刻精确到秒，范围列级别、规则、目录与条数
function buildFilename(selection, total, now) {
  const parts = [];
  if (selection.mode === 'checked') parts.push('勾选');
  parts.push(selection.levels.length === LEVELS.length ? '级别全部' : `级别${selection.levels.join('+') || '无'}`);
  if (selection.rules === null) {
    parts.push('规则全部');
  } else {
    parts.push(selection.rules.length <= 3 ? `规则${selection.rules.join('+') || '无'}` : `规则共${selection.rules.length}条`);
  }
  if (selection.directories === null) {
    parts.push('目录全部');
  } else {
    parts.push(selection.directories.length <= 2
      ? `目录${selection.directories.map(displayDir).join('+') || '无'}`
      : `目录共${selection.directories.length}个`);
  }
  parts.push(`共${total}条`);
  return `命中导出-${filenameStamp(now)}-${safePart(parts.join('-'))}.md`;
}

// 导出：页面把这一轮的命中与所选范围带上来，这里统一过滤、排序、汇总并生成内容。
// 预演与正式导出走同一个入口，两边看到的数字自然对得上
function buildExport(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  if (!Array.isArray(input.hits)) {
    throw new ApiError(400, 'EXPORT_HITS_INVALID', '导出需要带上这一轮的命中清单', '');
  }
  const hits = input.hits.map(normalizeHit).filter(Boolean);
  const selection = normalizeSelection(input.selection);
  const picked = pickHits(hits, selection);
  const summary = summarize(picked);
  return {
    filename: buildFilename(selection, summary.total, new Date()),
    content: buildContent(input.scannedAt, selection, picked, summary),
    summary,
  };
}

module.exports = { buildExport };
