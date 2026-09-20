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
  checkedHits: new Set(),
  lastExport: null,
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

// 一条命中的身份：规则 + 文件 + 行号，与服务端忽略、导出的口径一致
function hitKeyOf(hit) {
  return `${hit.ruleId}|${hit.fileId}|${hit.lineNo}`;
}

// 目录按路径里最后一个斜线切，根目录下的文件记成空串
function dirOfPath(filePath) {
  const index = filePath.lastIndexOf('/');
  return index === -1 ? '' : filePath.slice(0, index);
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

// 扫一遍，把概要与命中清单都画出来；新的一轮开始后，上一轮的勾选与导出说明都清掉
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
    state.checkedHits = new Set();
    state.lastExport = null;
    renderExportResult();
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

  const summaryBox = el('scan-summary');
  const ignoredText = result.summary.ignored ? `（其中已忽略 ${result.summary.ignored} 条）` : '';
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
    <div class="summary-line"><strong>一共命中 ${result.summary.total} 条</strong>${ignoredText}　${escapeHtml(levelText)}</div>
    <div class="summary-line">按规则：${escapeHtml(ruleText)}</div>
    <div class="summary-line">按文件：${escapeHtml(fileText)}</div>`;
  summaryBox.classList.remove('hidden');

  const body = el('hit-body');
  body.innerHTML = result.hits.map((hit) => {
    const key = hitKeyOf(hit);
    const checked = state.checkedHits.has(key) ? ' checked' : '';
    let ignoreTitle = '';
    if (hit.ignored && hit.ignoredAt) {
      ignoreTitle = `${hit.ignoredBy ? `${hit.ignoredBy} ` : ''}忽略于 ${formatTime(hit.ignoredAt)}`;
    }
    const ignoreCell = hit.ignored
      ? `<span class="tag tag-ignored" title="${escapeHtml(ignoreTitle)}">已忽略</span>
         <button type="button" class="link" data-hit-unignore="${escapeHtml(hit.ignoreId)}">取消忽略</button>`
      : `<button type="button" class="link" data-hit-ignore="${escapeHtml(key)}">忽略</button>`;
    return `<tr class="${hit.ignored ? 'hit-ignored' : ''}">
      <td class="check-col"><input type="checkbox" data-hit-check="${escapeHtml(key)}"${checked}></td>
      <td class="mono">${escapeHtml(hit.code)}</td>
      <td><span class="tag ${levelClass(hit.level)}">${escapeHtml(hit.level)}</span></td>
      <td>${escapeHtml(hit.ruleName)}</td>
      <td class="mono">${escapeHtml(hit.path)}</td>
      <td class="mono">${hit.lineNo}</td>
      <td class="mono line-cell">${escapeHtml(hit.lineText)}</td>
      <td class="actions">${ignoreCell}</td>
    </tr>`;
  }).join('');
  el('hit-empty').classList.toggle('hidden', result.hits.length > 0);
  renderExportBar();
}

// 导出入口的状态：扫过且这一轮有命中才能导出，顺带刷新已勾选条数
function renderExportBar() {
  const hitCount = state.lastScan ? state.lastScan.hits.length : 0;
  el('export-checked-info').textContent = `已勾选 ${state.checkedHits.size} 条`;
  el('export-open').disabled = hitCount === 0;
}

// 导出完成后在页面上留下说明：多少条、按规则各多少条、文件名，数字与预演对得上
function renderExportResult() {
  const box = el('export-result');
  if (!state.lastExport) {
    box.classList.add('hidden');
    box.textContent = '';
    return;
  }
  const { filename, summary } = state.lastExport;
  const ruleText = summary.byRule.map((item) => `${item.code} ${item.count} 条`).join('、') || '没有规则命中';
  box.textContent = `导出完成：一共 ${summary.total} 条（其中已忽略 ${summary.ignored} 条）；按规则：${ruleText}；文件名 ${filename}`;
  box.classList.remove('hidden');
}

// 导出对话框：范围、级别、规则、目录都在这一轮命中的基础上选，
// 预演与正式导出走同一个接口，两边看到的数字自然对得上
let previewSeq = 0;

function checkedValues(selector, prop) {
  return Array.from(document.querySelectorAll(selector)).map((node) => node.dataset[prop]);
}

function collectExportSelection() {
  const modeNode = document.querySelector('input[name="export-mode"]:checked');
  return {
    mode: modeNode ? modeNode.value : 'all',
    checkedKeys: Array.from(state.checkedHits),
    levels: checkedValues('input[data-export-level]:checked', 'exportLevel'),
    rules: checkedValues('input[data-export-rule]:checked', 'exportRule'),
    directories: checkedValues('input[data-export-dir]:checked', 'exportDir'),
  };
}

function updateExportModeLabels() {
  const total = state.lastScan ? state.lastScan.hits.length : 0;
  el('export-mode-all-label').textContent = `当前这一轮全部命中（${total} 条）`;
  el('export-mode-checked-label').textContent = `只带勾选的命中（${state.checkedHits.size} 条）`;
  el('export-mode-checked').disabled = state.checkedHits.size === 0;
}

function openExportDialog() {
  if (!state.lastScan || !state.lastScan.hits.length) return;
  clearNotice();

  const levelCounts = {};
  state.lastScan.hits.forEach((hit) => { levelCounts[hit.level] = (levelCounts[hit.level] || 0) + 1; });
  el('export-levels').innerHTML = state.levels.map((level) => `
    <label class="check"><input type="checkbox" data-export-level="${escapeHtml(level)}" checked> ${escapeHtml(level)}（${levelCounts[level] || 0} 条）</label>`).join('');

  const ruleMap = new Map();
  state.lastScan.hits.forEach((hit) => {
    if (!ruleMap.has(hit.code)) ruleMap.set(hit.code, { code: hit.code, ruleName: hit.ruleName, count: 0 });
    ruleMap.get(hit.code).count += 1;
  });
  const ruleItems = Array.from(ruleMap.values()).sort((a, b) => (a.code < b.code ? -1 : 1));
  el('export-rules').innerHTML = ruleItems.map((item) => `
    <label class="check"><input type="checkbox" data-export-rule="${escapeHtml(item.code)}" checked> ${escapeHtml(item.code)} ${escapeHtml(item.ruleName)}（${item.count} 条）</label>`).join('');

  const dirMap = new Map();
  state.lastScan.hits.forEach((hit) => {
    const dir = dirOfPath(hit.path);
    dirMap.set(dir, (dirMap.get(dir) || 0) + 1);
  });
  const dirItems = Array.from(dirMap.keys()).sort();
  el('export-dirs').innerHTML = dirItems.map((dir) => `
    <label class="check"><input type="checkbox" data-export-dir="${escapeHtml(dir)}" checked> ${escapeHtml(dir || '（根目录）')}（${dirMap.get(dir)} 条）</label>`).join('');

  el('export-mode-all').checked = true;
  updateExportModeLabels();
  el('export-dialog').classList.remove('hidden');
  refreshExportPreview();
}

function closeExportDialog() {
  previewSeq += 1;
  el('export-dialog').classList.add('hidden');
}

async function refreshExportPreview() {
  if (!state.lastScan) return;
  const seq = ++previewSeq;
  const selection = collectExportSelection();
  try {
    const result = await request('/api/scan/export', {
      method: 'POST',
      body: JSON.stringify({ scannedAt: state.lastScan.scannedAt, hits: state.lastScan.hits, selection }),
    });
    if (seq !== previewSeq) return;
    renderExportPreview(result.summary);
  } catch (err) {
    if (seq !== previewSeq) return;
    el('export-preview').innerHTML = `<div class="summary-line">${escapeHtml(err.message)}</div>`;
    el('export-confirm').disabled = true;
  }
}

function renderExportPreview(summary) {
  const levelText = state.levels.map((key) => `${key} ${summary.byLevel[key] || 0} 条`).join('　');
  const ruleText = summary.byRule.map((item) => `${item.code} ${item.count} 条`).join('　') || '没有规则命中';
  el('export-preview').innerHTML = `
    <div class="summary-line"><strong>预演：一共 ${summary.total} 条</strong>（其中已忽略 ${summary.ignored} 条）</div>
    <div class="summary-line">按级别：${escapeHtml(levelText)}</div>
    <div class="summary-line">按规则：${escapeHtml(ruleText)}</div>`;
  el('export-confirm').disabled = summary.total === 0;
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function confirmExport() {
  if (!state.lastScan) return;
  clearNotice();
  const selection = collectExportSelection();
  try {
    const result = await request('/api/scan/export', {
      method: 'POST',
      body: JSON.stringify({ scannedAt: state.lastScan.scannedAt, hits: state.lastScan.hits, selection }),
    });
    downloadTextFile(result.filename, result.content);
    state.lastExport = { filename: result.filename, summary: result.summary };
    renderExportResult();
    closeExportDialog();
    notify(`已导出 ${result.summary.total} 条命中`, 'ok');
  } catch (err) {
    notify(err.message, 'error');
  }
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

  // 忽略只改这一条命中的状态，命中清单本身不动，就地更新后重画
  if (node.dataset.hitIgnore) {
    clearNotice();
    const hit = state.lastScan && state.lastScan.hits.find((item) => hitKeyOf(item) === node.dataset.hitIgnore);
    if (!hit) return;
    try {
      const ignore = await request('/api/ignores', {
        method: 'POST',
        body: JSON.stringify({
          ruleId: hit.ruleId,
          fileId: hit.fileId,
          lineNo: hit.lineNo,
          operator: currentOperator(),
        }),
      });
      hit.ignored = true;
      hit.ignoreId = ignore.id;
      hit.ignoredBy = ignore.operator;
      hit.ignoredAt = ignore.ignoredAt;
      state.lastScan.summary.ignored += 1;
      renderScan(state.lastScan);
      notify(`已忽略 ${hit.code} 在 ${hit.path} 第 ${hit.lineNo} 行的命中`, 'ok');
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.hitUnignore) {
    clearNotice();
    const hit = state.lastScan && state.lastScan.hits.find((item) => item.ignoreId === node.dataset.hitUnignore);
    try {
      await request(`/api/ignores/${encodeURIComponent(node.dataset.hitUnignore)}`, { method: 'DELETE' });
      if (hit) {
        hit.ignored = false;
        hit.ignoreId = '';
        hit.ignoredBy = '';
        hit.ignoredAt = '';
        state.lastScan.summary.ignored = Math.max(0, state.lastScan.summary.ignored - 1);
        renderScan(state.lastScan);
      }
      notify('已取消忽略', 'ok');
    } catch (err) {
      notify(err.message, 'error');
    }
  }
});

// 命中行的勾选框用 change 委托，勾了哪些跟着状态走，重画清单也不丢
document.addEventListener('change', (event) => {
  const node = event.target;
  if (!(node instanceof HTMLInputElement) || !node.dataset.hitCheck) return;
  if (node.checked) state.checkedHits.add(node.dataset.hitCheck);
  else state.checkedHits.delete(node.dataset.hitCheck);
  renderExportBar();
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
el('export-open').addEventListener('click', openExportDialog);
el('export-cancel').addEventListener('click', closeExportDialog);
el('export-confirm').addEventListener('click', confirmExport);
el('export-dialog').addEventListener('change', (event) => {
  if (event.target instanceof HTMLInputElement) refreshExportPreview();
});
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
