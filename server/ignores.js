const crypto = require('crypto');
const { load, save } = require('./store');
const { ApiError, pickText } = require('./errors');

const MAX_OPERATOR_LENGTH = 40;

// 一条命中的身份：规则 + 文件 + 行号，同一轮里同一条命中只出现一次
function hitKey(ruleId, fileId, lineNo) {
  return `${ruleId}|${fileId}|${lineNo}`;
}

// 把某一条命中标成已忽略：同一条命中重复标不会留下两条记录
function ignoreHit(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const ruleId = pickText(input.ruleId);
  const fileId = pickText(input.fileId);
  const lineNo = Number(input.lineNo);
  const operator = pickText(input.operator).slice(0, MAX_OPERATOR_LENGTH);

  if (!ruleId) throw new ApiError(400, 'RULE_REQUIRED', '缺少要忽略的规则编号', '');
  if (!fileId) throw new ApiError(400, 'FILE_REQUIRED', '缺少要忽略的文件编号', '');
  if (!Number.isInteger(lineNo) || lineNo < 1) {
    throw new ApiError(400, 'LINE_NO_INVALID', '行号要是正整数', '');
  }

  const data = load();
  const rule = data.rules.find((item) => item.id === ruleId);
  if (!rule) throw new ApiError(404, 'RULE_NOT_FOUND', '这条规则不存在或已被删除', '');
  const file = data.files.find((item) => item.id === fileId);
  if (!file) throw new ApiError(404, 'FILE_NOT_FOUND', '这个文件不存在或已被移出清单', '');

  const key = hitKey(ruleId, fileId, lineNo);
  const existing = data.ignores.find((item) => hitKey(item.ruleId, item.fileId, item.lineNo) === key);
  if (existing) return { ignore: existing, created: false };

  const ignore = {
    id: crypto.randomUUID(),
    ruleId,
    fileId,
    lineNo,
    code: rule.code,
    path: file.path,
    operator,
    ignoredAt: new Date().toISOString(),
  };
  data.ignores.push(ignore);
  save(data);
  return { ignore, created: true };
}

// 取消某一条命中的忽略
function unignoreHit(id) {
  const data = load();
  const index = data.ignores.findIndex((item) => item.id === id);
  if (index === -1) throw new ApiError(404, 'IGNORE_NOT_FOUND', '这条忽略记录不存在或已被取消', '');
  const [removed] = data.ignores.splice(index, 1);
  save(data);
  return { id: removed.id, ruleId: removed.ruleId, fileId: removed.fileId, lineNo: removed.lineNo };
}

module.exports = { ignoreHit, unignoreHit };
