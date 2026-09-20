// 页面交互：规则、文件与扫描三块都从服务端拉取，任何一步失败都把说明显示在顶部并标到对应输入项上

const state = {
  rules: [],
  files: [],
  levels: [],
  statuses: [],
  fileTypes: [],
  ruleLevels: [],
  ruleStatuses: [],
  ruleFileTypes: [],
  editingRuleId: '',
  editingFileId: '',
  lastScan: null,
  picked: new Set(),
  exportLevels: new Set(),
  exportRules: new Set(),
  exportDirs: new Set(),
  exportAllRules: [],
  exportAllDirs: [],
  exportMode: 'all',
  exportReady: false,
};

const el = (id) => document.getElementById(id);

// 统一的请求入口：出错时把服务端给的错误码、说明与出错位置一起抛出去
async function request(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch (err) {
    payload = null;
  }
  if (!res.ok) {
    const error = (payload && payload.error) || {};
    const failure = new Error(error.message || `请求失败（状态码 ${res.status}）`);
    failure.code = error.code || '';
    failure.field = error.field || '';
    throw failure;
  }
  return payload;
}

function notify(message, kind) {
  const box = el('notice');
  box.textContent = message;
  box.className = `notice ${kind === 'ok' ? 'ok' : 'error'}`;
}

function clearNotice() {
  const box = el('notice');
  box.className = 'notice hidden';
  box.textContent = '';
}

function clearFieldMarks() {
  document.querySelectorAll('.invalid').forEach((node) => node.classList.remove('invalid'));
}

// 把出错位置标到具体输入项上：规则区与文件区共用一套标记
function markField(field) {
  if (!field) return;
  const target = document.querySelector(`[data-field="${field}"]`);
  if (!target) return;
  target.classList.add('invalid');
  const input = target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA'
    ? target
    : target.querySelector('input, select, textarea');
  if (input) input.focus();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function levelClass(level) {
  if (level === '错误') return 'lv-error';
  if (level === '警告') return 'lv-warn';
  return 'lv-hint';
}

const OPERATOR_KEY = 'check-hits-operator';

function currentOperator() {
  return el('operator').value.trim();
}

function restoreOperator() {
  el('operator').value = window.localStorage.getItem(OPERATOR_KEY) || '';
}

async function loadHealth() {
  try {
    await request('/api/health');
    el('health').textContent = '服务正常';
    el('health').className = 'health ok';
  } catch (err) {
    el('health').textContent = '服务连不上';
    el('health').className = 'health bad';
  }
}

async function loadRules() {
  const params = new URLSearchParams();
  const level = el('rule-filter-level').value;
  const status = el('rule-filter-status').value;
  const fileType = el('rule-filter-type').value;
  const keyword = el('rule-filter-keyword').value.trim();
  if (level) params.set('level', level);
  if (status) params.set('status', status);
  if (fileType) params.set('fileType', fileType);
  if (keyword) params.set('keyword', keyword);
  const query = params.toString();
  const payload = await request(`/api/rules${query ? `?${query}` : ''}`);
  state.rules = payload.rules || [];
  state.levels = payload.levels || [];
  state.statuses = payload.statuses || [];
  state.fileTypes = payload.fileTypes || [];
  renderRuleFilters();
  renderRules();
  renderScanRuleOptions();
}

async function loadFiles() {
  const params = new URLSearchParams();
  const type = el('file-filter-type').value;
  const keyword = el('file-filter-keyword').value.trim();
  if (type) params.set('type', type);
  if (keyword) params.set('keyword', keyword);
  const query = params.toString();
  const payload = await request(`/api/files${query ? `?${query}` : ''}`);
  state.files = payload.files || [];
  state.ruleFileTypes = payload.fileTypes || [];
  renderFileFilters();
  renderFiles();
  renderScanFileOptions();
}

function renderRuleFilters() {
  const levelSelect = el('rule-filter-level');
  const levelCurrent = levelSelect.value;
  levelSelect.innerHTML = '<option value="">全部级别</option>'
    + state.levels.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.levels.includes(levelCurrent)) levelSelect.value = levelCurrent;

  const statusSelect = el('rule-filter-status');
  const statusCurrent = statusSelect.value;
  statusSelect.innerHTML = '<option value="">全部状态</option>'
    + state.statuses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.statuses.includes(statusCurrent)) statusSelect.value = statusCurrent;

  const typeSelect = el('rule-filter-type');
  const typeCurrent = typeSelect.value;
  typeSelect.innerHTML = '<option value="">全部适用文件类型</option>'
    + state.fileTypes.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.fileTypes.includes(typeCurrent)) typeSelect.value = typeCurrent;

  const formLevel = el('rule-level');
  const formLevelCurrent = formLevel.value;
  formLevel.innerHTML = state.levels.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.levels.includes(formLevelCurrent)) formLevel.value = formLevelCurrent;

  const formStatus = el('rule-status');
  const formStatusCurrent = formStatus.value;
  formStatus.innerHTML = state.statuses.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.statuses.includes(formStatusCurrent)) formStatus.value = formStatusCurrent;

  const formType = el('rule-file-type');
  const formTypeCurrent = formType.value;
  formType.innerHTML = state.fileTypes.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.fileTypes.includes(formTypeCurrent)) formType.value = formTypeCurrent;

  const scanLevel = el('scan-level');
  const scanLevelCurrent = scanLevel.value;
  scanLevel.innerHTML = '<option value="">全部级别</option>'
    + state.levels.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.levels.includes(scanLevelCurrent)) scanLevel.value = scanLevelCurrent;
}

function renderFileFilters() {
  const typeSelect = el('file-filter-type');
  const current = typeSelect.value;
  typeSelect.innerHTML = '<option value="">全部类型</option>'
    + state.ruleFileTypes.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
  if (state.ruleFileTypes.includes(current)) typeSelect.value = current;
}

function renderScanRuleOptions() {
  const select = el('scan-rule');
  const current = select.value;
  select.innerHTML = '<option value="">全部规则</option>'
    + state.rules.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.code)} ${escapeHtml(item.name)}</option>`).join('');
  if (state.rules.some((item) => item.id === current)) select.value = current;
}

function renderScanFileOptions() {
  const select = el('scan-file');
  const current = select.value;
  select.innerHTML = '<option value="">全部文件</option>'
    + state.files.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.path)}</option>`).join('');
  if (state.files.some((item) => item.id === current)) select.value = current;
}

function renderRules() {
  const body = el('rule-body');
  body.innerHTML = state.rules.map((item) => `<tr>
      <td class="mono">${escapeHtml(item.code)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td><span class="tag ${levelClass(item.level)}">${escapeHtml(item.level)}</span></td>
      <td>${escapeHtml(item.status)}</td>
      <td>${escapeHtml(item.fileType)}</td>
      <td class="mono">${escapeHtml(item.pattern)}</td>
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td class="mono">${escapeHtml(formatTime(item.updatedAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-rule-edit="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="link danger" data-rule-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('rule-empty').classList.toggle('hidden', state.rules.length > 0);
}

function renderFiles() {
  const body = el('file-body');
  body.innerHTML = state.files.map((item) => `<tr>
      <td class="mono">${escapeHtml(item.path)}</td>
      <td>${escapeHtml(item.type)}</td>
      <td>${item.lineCount} 行</td>
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td class="mono">${escapeHtml(formatTime(item.updatedAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-file-view="${escapeHtml(item.id)}">看内容</button>
        <button type="button" class="link" data-file-edit="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="link danger" data-file-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`).join('');
  el('file-empty').classList.toggle('hidden', state.files.length > 0);
}

function openRuleForm(rule) {
  state.editingRuleId = rule ? rule.id : '';
  el('rule-form-title').textContent = rule ? `编辑规则：${rule.code}` : '新建规则';
  el('rule-code').value = rule ? rule.code : '';
  el('rule-name').value = rule ? rule.name : '';
  el('rule-level').value = rule ? rule.level : (state.levels[0] || '提示');
  el('rule-status').value = rule ? rule.status : (state.statuses[0] || '启用');
  el('rule-file-type').value = rule ? rule.fileType : (state.fileTypes[0] || '全部');
  el('rule-pattern').value = rule ? rule.pattern : '';
  el('rule-note').value = rule ? rule.note : '';
  el('rule-form').classList.remove('hidden');
  el('rule-code').focus();
}

function closeRuleForm() {
  state.editingRuleId = '';
  el('rule-form').classList.add('hidden');
  clearFieldMarks();
}

function openFileForm(file) {
  state.editingFileId = file ? file.id : '';
  el('file-form-title').textContent = file ? `编辑文件：${file.path}` : '收录新文件';
  el('file-path').value = file ? file.path : '';
  el('file-content').value = file ? file.content : '';
  el('file-note').value = file ? file.note : '';
  el('file-form').classList.remove('hidden');
  el('file-path').focus();
}

function closeFileForm() {
  state.editingFileId = '';
  el('file-form').classList.add('hidden');
  clearFieldMarks();
}

async function showFileContent(id) {
  clearNotice();
  try {
    const file = await request(`/api/files/${encodeURIComponent(id)}`);
    const preview = el('file-preview');
    preview.textContent = `${file.path}（${file.lineCount} 行）\n${'─'.repeat(40)}\n${file.content}`;
    preview.classList.remove('hidden');
  } catch (err) {
    notify(err.message, 'error');
  }
}

async function submitRule(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    code: el('rule-code').value,
    name: el('rule-name').value,
    level: el('rule-level').value,
    status: el('rule-status').value,
    fileType: el('rule-file-type').value,
    pattern: el('rule-pattern').value,
    note: el('rule-note').value,
  };
  const editing = state.editingRuleId;
  try {
    if (editing) {
      await request(`/api/rules/${encodeURIComponent(editing)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      notify('规则已保存', 'ok');
    } else {
      await request('/api/rules', { method: 'POST', body: JSON.stringify(payload) });
      notify('规则已新增', 'ok');
    }
    closeRuleForm();
    await loadRules();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

async function submitFile(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    path: el('file-path').value,
    content: el('file-content').value,
    note: el('file-note').value,
  };
  const editing = state.editingFileId;
  try {
    if (editing) {
      await request(`/api/files/${encodeURIComponent(editing)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      notify('文件已保存', 'ok');
    } else {
      await request('/api/files', { method: 'POST', body: JSON.stringify(payload) });
      notify('文件已收录', 'ok');
    }
    closeFileForm();
    await loadFiles();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

// 扫一遍，把概要与命中清单都画出来；新的一轮开始时，上一轮勾选的命中与预演都作废
async function runScan() {
  clearNotice();
  const body = {
    ruleId: el('scan-rule').value,
    fileId: el('scan-file').value,
    level: el('scan-level').value,
  };
  try {
    const result = await request('/api/scan', { method: 'POST', body: JSON.stringify(body) });
    state.lastScan = result;
    state.picked = new Set();
    renderScan(result);
  } catch (err) {
    notify(err.message, 'error');
  }
}

function renderScan(result) {
  el('scan-meta').textContent = `扫描时刻 ${formatTime(result.scannedAt)}　参与比对的规则 ${result.rulesUsed} 条（启用共 ${result.enabledRules} 条）　范围里的文件 ${result.filesInScope} 个（清单共 ${result.filesTotal} 个）`;

  const warningBox = el('scan-warning');
  if (result.warning) {
    warningBox.textContent = result.warning;
    warningBox.classList.remove('hidden');
  } else {
    warningBox.classList.add('hidden');
    warningBox.textContent = '';
  }

  renderScanSummary(result);
  renderHits();
  renderExportOptions();
  invalidateExport();
  el('export-result').classList.add('hidden');
}

function renderScanSummary(result) {
  const summaryBox = el('scan-summary');
  const ignored = result.summary.ignored || 0;
  const ignoredText = ignored > 0 ? `（其中已忽略 ${ignored} 条）` : '';
  const levelText = Object.keys(result.summary.byLevel)
    .map((key) => `${key} ${result.summary.byLevel[key]} 条`)
    .join('　');
  const ruleText = result.summary.byRule
    .map((item) => `${item.code} ${item.count} 条`)
    .join('　') || '没有规则命中';
  const fileText = result.summary.byFile
    .map((item) => `${item.path} ${item.count} 条`)
    .join('　') || '没有文件命中';
  summaryBox.innerHTML = `
    <div class="summary-line"><strong>一共命中 ${result.summary.total} 条${ignoredText}</strong>　${escapeHtml(levelText)}</div>
    <div class="summary-line">按规则：${escapeHtml(ruleText)}</div>
    <div class="summary-line">按文件：${escapeHtml(fileText)}</div>`;
  summaryBox.classList.remove('hidden');
}

// 一条命中的定位串：规则编号、文件编号与行号，和服务端忽略记录的口径一致
function hitKey(hit) {
  return `${hit.ruleId}|${hit.fileId}|${hit.lineNo}`;
}

function renderHits() {
  const result = state.lastScan;
  const hits = result ? result.hits : [];
  const body = el('hit-body');
  body.innerHTML = hits.map((hit) => {
    const key = hitKey(hit);
    const checked = state.picked.has(key) ? ' checked' : '';
    const ignoredTag = hit.ignored ? ' <span class="tag tag-ignored">已忽略</span>' : '';
    return `<tr${hit.ignored ? ' class="hit-ignored"' : ''}>
      <td class="pick-col"><input type="checkbox" data-hit-pick="${escapeHtml(key)}"${checked}></td>
      <td class="mono">${escapeHtml(hit.code)}</td>
      <td><span class="tag ${levelClass(hit.level)}">${escapeHtml(hit.level)}</span>${ignoredTag}</td>
      <td>${escapeHtml(hit.ruleName)}</td>
      <td class="mono">${escapeHtml(hit.path)}</td>
      <td class="mono">${hit.lineNo}</td>
      <td class="mono line-cell">${escapeHtml(hit.lineText)}</td>
      <td class="actions"><button type="button" class="link" data-hit-ignore="${escapeHtml(key)}">${hit.ignored ? '恢复' : '忽略'}</button></td>
    </tr>`;
  }).join('');
  el('hit-empty').classList.toggle('hidden', hits.length > 0);
  el('hit-pick-all').checked = hits.length > 0 && hits.every((hit) => state.picked.has(hitKey(hit)));
  el('export-picked-count').textContent = String(state.picked.size);
}

// 忽略或恢复一条命中：服务端记下来，页面上就地更新，不用重新扫
async function toggleIgnore(key) {
  const result = state.lastScan;
  if (!result) return;
  const hit = result.hits.find((item) => hitKey(item) === key);
  if (!hit) return;
  clearNotice();
  const body = JSON.stringify({
    ruleId: hit.ruleId,
    fileId: hit.fileId,
    lineNo: hit.lineNo,
    operator: currentOperator(),
  });
  try {
    if (hit.ignored) {
      await request('/api/ignores', { method: 'DELETE', body });
      hit.ignored = false;
      notify(`已恢复 ${hit.code} 在 ${hit.path} 第 ${hit.lineNo} 行的命中`, 'ok');
    } else {
      await request('/api/ignores', { method: 'POST', body });
      hit.ignored = true;
      notify(`已忽略 ${hit.code} 在 ${hit.path} 第 ${hit.lineNo} 行的命中，重新扫也会保持`, 'ok');
    }
    result.summary.ignored = result.hits.filter((item) => item.ignored).length;
    renderScanSummary(result);
    renderHits();
    invalidateExport();
  } catch (err) {
    notify(err.message, 'error');
  }
}

// 命中所在目录：路径里最后一个斜线之前的部分，没有斜线的归到根目录
function hitDir(path) {
  const index = path.lastIndexOf('/');
  return index === -1 ? '(根目录)' : path.slice(0, index);
}

function exportCheck(cls, value, label) {
  return `<label class="export-check"><input type="checkbox" class="${cls}" value="${escapeHtml(value)}" checked> ${escapeHtml(label)}</label>`;
}

// 导出面板的可选项跟着这一轮命中走：级别给全量，规则与目录只列这一轮真正踩到的；
// 勾选状态收在 state 里，顺序固定，两次导出才会一模一样
function renderExportOptions() {
  const hits = state.lastScan ? state.lastScan.hits : [];
  state.exportLevels = new Set(state.levels);
  el('export-levels').innerHTML = state.levels
    .map((level) => exportCheck('export-level', level, level))
    .join('');

  const rules = [];
  const seenRules = new Set();
  hits.forEach((hit) => {
    if (seenRules.has(hit.code)) return;
    seenRules.add(hit.code);
    rules.push({ code: hit.code, ruleName: hit.ruleName });
  });
  rules.sort((a, b) => (a.code < b.code ? -1 : 1));
  state.exportAllRules = rules.map((rule) => rule.code);
  state.exportRules = new Set(state.exportAllRules);
  el('export-rules').innerHTML = rules.length
    ? rules.map((rule) => exportCheck('export-rule', rule.code, `${rule.code} ${rule.ruleName}`)).join('')
    : '<span class="export-none">这一轮没有命中</span>';

  const dirs = Array.from(new Set(hits.map((hit) => hitDir(hit.path)))).sort();
  state.exportAllDirs = dirs;
  state.exportDirs = new Set(dirs);
  el('export-dirs').innerHTML = dirs.length
    ? dirs.map((dir) => exportCheck('export-dir', dir, dir)).join('')
    : '<span class="export-none">这一轮没有命中</span>';

  state.exportMode = 'all';
  const allRadio = document.querySelector('input[name="export-mode"][value="all"]');
  if (allRadio) allRadio.checked = true;
}

function readExportOptions() {
  const levels = state.levels.filter((level) => state.exportLevels.has(level));
  const rules = state.exportAllRules.filter((code) => state.exportRules.has(code));
  const dirs = state.exportAllDirs.filter((dir) => state.exportDirs.has(dir));
  return {
    levels,
    rules,
    dirs,
    allLevels: levels.length === state.levels.length,
    allRules: rules.length === state.exportAllRules.length,
    allDirs: dirs.length === state.exportAllDirs.length,
    mode: state.exportMode,
  };
}

// 命中顺序固定按规则编码、文件路径、行号排，两次导出才会一模一样
function compareHits(a, b) {
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  return a.lineNo - b.lineNo;
}

function collectExportHits(options) {
  const hits = state.lastScan ? state.lastScan.hits : [];
  return hits.filter((hit) => options.levels.includes(hit.level)
    && options.rules.includes(hit.code)
    && options.dirs.includes(hitDir(hit.path))
    && (options.mode !== 'picked' || state.picked.has(hitKey(hit)))).sort(compareHits);
}

function summarizeExport(list) {
  const byLevel = {};
  state.levels.forEach((level) => { byLevel[level] = 0; });
  const byRuleMap = new Map();
  let ignored = 0;
  list.forEach((hit) => {
    byLevel[hit.level] = (byLevel[hit.level] || 0) + 1;
    if (!byRuleMap.has(hit.code)) {
      byRuleMap.set(hit.code, { code: hit.code, ruleName: hit.ruleName, level: hit.level, count: 0 });
    }
    byRuleMap.get(hit.code).count += 1;
    if (hit.ignored) ignored += 1;
  });
  return {
    total: list.length,
    ignored,
    byLevel,
    byRule: Array.from(byRuleMap.values()).sort((a, b) => (a.code < b.code ? -1 : 1)),
  };
}

// 预演：把将要导出的条数按级别、按规则、已忽略分别算清楚，确认按钮这才解锁
function previewExport() {
  clearNotice();
  if (!state.lastScan) {
    notify('先扫一遍，再导出这一轮结果', 'error');
    return;
  }
  const options = readExportOptions();
  const summary = summarizeExport(collectExportHits(options));
  const levelText = state.levels.map((level) => `${level} ${summary.byLevel[level] || 0} 条`).join('　');
  const ruleText = summary.byRule.map((item) => `${item.code} ${item.count} 条`).join('　') || '没有规则命中';
  const box = el('export-preview-box');
  box.innerHTML = `
    <div class="summary-line"><strong>预演：一共 ${summary.total} 条，其中已忽略 ${summary.ignored} 条</strong></div>
    <div class="summary-line">按级别：${escapeHtml(levelText)}</div>
    <div class="summary-line">按规则：${escapeHtml(ruleText)}</div>
    ${summary.total === 0 ? '<div class="summary-line">这个范围里没有可导出的命中</div>' : ''}`;
  box.classList.remove('hidden');
  el('export-result').classList.add('hidden');
  state.exportReady = summary.total > 0;
  el('export-confirm').disabled = !state.exportReady;
}

// 范围、挑选或忽略状态有任何变动，之前的预演就作废，确认前必须重新预演
function invalidateExport() {
  state.exportReady = false;
  el('export-confirm').disabled = true;
  el('export-preview-box').classList.add('hidden');
}

function pad2(num) {
  return String(num).padStart(2, '0');
}

// 导出时刻压进文件名：命中清单_20260919-143052_…_共N条.md
function stampOf(date) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

function buildExportFilename(options, summary, exportedAt) {
  const levelPart = options.allLevels ? '级别-全部' : `级别-${options.levels.join('+') || '无'}`;
  const rulePart = options.allRules
    ? '规则-全部'
    : (options.rules.length <= 3 ? `规则-${options.rules.join('+') || '无'}` : `规则-${options.rules.length}条`);
  const dirPart = options.allDirs
    ? '目录-全部'
    : (options.dirs.length <= 2 ? `目录-${options.dirs.join('+') || '无'}` : `目录-${options.dirs.length}个`);
  const modePart = options.mode === 'picked' ? `挑选${summary.total}条` : '整轮';
  const raw = `命中清单_${stampOf(exportedAt)}_${levelPart}_${rulePart}_${dirPart}_${modePart}_共${summary.total}条.md`;
  return raw.replace(/[\\/:*?"<>|\s]+/g, '_');
}

// 表格单元格里的竖线要转义，不然 Markdown 表格会被内容撑坏
function mdCell(text) {
  return String(text).replace(/\|/g, '\\|');
}

// 导出内容只由这一轮扫描与所选范围决定，不写导出时刻，同一轮导两次内容必然一致
function buildExportContent(list, summary, options, scan) {
  const scopeText = [
    `级别 ${options.allLevels ? '全部' : options.levels.join('、') || '无'}`,
    `规则 ${options.allRules ? '全部' : options.rules.join('、') || '无'}`,
    `目录 ${options.allDirs ? '全部' : options.dirs.join('、') || '无'}`,
    options.mode === 'picked' ? `只带选中的 ${summary.total} 条` : '整轮带走',
  ].join('；');
  const lines = [
    '# 检查命中清单',
    '',
    `- 扫描时刻：${formatTime(scan.scannedAt)}`,
    `- 参与比对的规则：${scan.rulesUsed} 条（启用共 ${scan.enabledRules} 条）`,
    `- 范围里的文件：${scan.filesInScope} 个（清单共 ${scan.filesTotal} 个）`,
    `- 导出范围：${scopeText}`,
    `- 一共 ${summary.total} 条，其中已忽略 ${summary.ignored} 条`,
    '',
    '## 按级别',
    '',
  ];
  state.levels.forEach((level) => {
    lines.push(`- ${level} ${summary.byLevel[level] || 0} 条`);
  });
  lines.push('', '## 按规则', '');
  summary.byRule.forEach((item) => {
    lines.push(`- ${item.code} ${item.ruleName}（${item.level}）：${item.count} 条`);
  });
  lines.push('', '## 命中明细', '');
  lines.push('| 序号 | 规则编码 | 级别 | 规则名称 | 文件 | 行号 | 那一行的内容 | 状态 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  list.forEach((hit, index) => {
    lines.push(`| ${index + 1} | ${mdCell(hit.code)} | ${mdCell(hit.level)} | ${mdCell(hit.ruleName)} | ${mdCell(hit.path)} | ${hit.lineNo} | ${mdCell(hit.lineText)} | ${hit.ignored ? '已忽略' : '未忽略'} |`);
  });
  return `${lines.join('\n')}\n`;
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// 确认导出：用的还是预演那套算法与当前状态，页面报出的数字自然与预演对得上
function confirmExport() {
  clearNotice();
  if (!state.lastScan || !state.exportReady) return;
  const options = readExportOptions();
  const list = collectExportHits(options);
  const summary = summarizeExport(list);
  const exportedAt = new Date();
  const filename = buildExportFilename(options, summary, exportedAt);
  downloadText(filename, buildExportContent(list, summary, options, state.lastScan));
  const ruleText = summary.byRule.map((item) => `${item.code} ${item.count} 条`).join('、');
  const box = el('export-result');
  box.innerHTML = `<strong>导出完成：</strong>${escapeHtml(formatTime(exportedAt))} 导出 ${summary.total} 条（其中已忽略 ${summary.ignored} 条），按规则：${escapeHtml(ruleText)}；文件 ${escapeHtml(filename)}`;
  box.classList.remove('hidden');
  notify(`已导出 ${summary.total} 条命中`, 'ok');
}

// 列表上的操作用事件委托统一处理，列表重绘之后不需要重新绑定
document.addEventListener('click', async (event) => {
  const node = event.target.closest('button');
  if (!node) return;

  if (node.dataset.ruleEdit) {
    clearNotice();
    const found = state.rules.find((item) => item.id === node.dataset.ruleEdit);
    if (found) openRuleForm(found);
    return;
  }

  if (node.dataset.ruleDelete) {
    clearNotice();
    const found = state.rules.find((item) => item.id === node.dataset.ruleDelete);
    if (!window.confirm(`确定删除规则 ${found ? found.code : ''} 吗？`)) return;
    try {
      await request(`/api/rules/${encodeURIComponent(node.dataset.ruleDelete)}`, { method: 'DELETE' });
      if (state.editingRuleId === node.dataset.ruleDelete) closeRuleForm();
      notify('规则已删除', 'ok');
      await loadRules();
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.fileView) {
    await showFileContent(node.dataset.fileView);
    return;
  }

  if (node.dataset.fileEdit) {
    clearNotice();
    try {
      const file = await request(`/api/files/${encodeURIComponent(node.dataset.fileEdit)}`);
      openFileForm(file);
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.fileDelete) {
    clearNotice();
    const found = state.files.find((item) => item.id === node.dataset.fileDelete);
    if (!window.confirm(`确定把 ${found ? found.path : ''} 移出清单吗？`)) return;
    try {
      await request(`/api/files/${encodeURIComponent(node.dataset.fileDelete)}`, { method: 'DELETE' });
      if (state.editingFileId === node.dataset.fileDelete) closeFileForm();
      el('file-preview').classList.add('hidden');
      notify('文件已移出清单', 'ok');
      await loadFiles();
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.hitIgnore) {
    await toggleIgnore(node.dataset.hitIgnore);
  }
});

// 勾选与导出面板的变化统一走 change 委托：任何变动都会让已做的预演作废
document.addEventListener('change', (event) => {
  const node = event.target;

  if (node.id === 'hit-pick-all') {
    const result = state.lastScan;
    if (!result || !result.hits.length) {
      node.checked = false;
      return;
    }
    if (node.checked) result.hits.forEach((hit) => state.picked.add(hitKey(hit)));
    else state.picked.clear();
    renderHits();
    invalidateExport();
    return;
  }

  if (node.dataset && node.dataset.hitPick) {
    if (node.checked) state.picked.add(node.dataset.hitPick);
    else state.picked.delete(node.dataset.hitPick);
    const result = state.lastScan;
    el('hit-pick-all').checked = result
      && result.hits.length > 0
      && result.hits.every((hit) => state.picked.has(hitKey(hit)));
    el('export-picked-count').textContent = String(state.picked.size);
    invalidateExport();
    return;
  }

  const exportSet = node.classList && node.classList.contains('export-level') ? state.exportLevels
    : node.classList.contains('export-rule') ? state.exportRules
      : node.classList.contains('export-dir') ? state.exportDirs
        : null;
  if (exportSet) {
    if (node.checked) exportSet.add(node.value);
    else exportSet.delete(node.value);
    invalidateExport();
    return;
  }

  if (node.name === 'export-mode') {
    state.exportMode = node.value;
    invalidateExport();
    return;
  }

  if (node.closest && node.closest('#export-panel')) {
    invalidateExport();
  }
});

el('rule-form').addEventListener('submit', submitRule);
el('file-form').addEventListener('submit', submitFile);
el('rule-new').addEventListener('click', () => {
  clearNotice();
  openRuleForm(null);
});
el('rule-cancel').addEventListener('click', closeRuleForm);
el('file-new').addEventListener('click', () => {
  clearNotice();
  openFileForm(null);
});
el('file-cancel').addEventListener('click', closeFileForm);
el('rule-filter-apply').addEventListener('click', () => {
  clearNotice();
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('rule-filter-reset').addEventListener('click', () => {
  el('rule-filter-level').value = '';
  el('rule-filter-status').value = '';
  el('rule-filter-type').value = '';
  el('rule-filter-keyword').value = '';
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('rule-refresh').addEventListener('click', () => {
  clearNotice();
  loadRules()
    .then(loadFiles)
    .catch((err) => notify(err.message, 'error'));
});
el('file-filter-apply').addEventListener('click', () => {
  clearNotice();
  loadFiles().catch((err) => notify(err.message, 'error'));
});
el('file-filter-reset').addEventListener('click', () => {
  el('file-filter-type').value = '';
  el('file-filter-keyword').value = '';
  loadFiles().catch((err) => notify(err.message, 'error'));
});
el('scan-run').addEventListener('click', runScan);
el('export-open').addEventListener('click', () => {
  clearNotice();
  if (!state.lastScan) {
    notify('先扫一遍，再导出这一轮结果', 'error');
    return;
  }
  el('export-panel').classList.toggle('hidden');
});
el('export-close').addEventListener('click', () => {
  el('export-panel').classList.add('hidden');
});
el('export-preview').addEventListener('click', previewExport);
el('export-confirm').addEventListener('click', confirmExport);
el('rule-filter-level').addEventListener('change', () => {
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('rule-filter-status').addEventListener('change', () => {
  loadRules().catch((err) => notify(err.message, 'error'));
});
el('operator').addEventListener('change', () => {
  window.localStorage.setItem(OPERATOR_KEY, currentOperator());
});

// 页面打开时先把规则与文件都拉一遍，扫描的范围下拉依赖这两份清单
restoreOperator();
loadHealth();
loadRules()
  .then(loadFiles)
  .catch((err) => notify(err.message, 'error'));
