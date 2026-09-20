const crypto = require('crypto');
const { load, save, ignoreKeyOf } = require('./store');
const { ApiError, pickText } = require('./errors');
const { lineCountOf } = require('./files');

const MAX_OPERATOR_LENGTH = 40;

// 一条命中靠规则、文件与行号定位，三个都先核对确实存在
function readHitTarget(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const ruleId = pickText(input.ruleId);
  const fileId = pickText(input.fileId);
  const lineNo = Number(input.lineNo);

  const data = load();
  const rule = data.rules.find((item) => item.id === ruleId);
  if (!ruleId || !rule) throw new ApiError(404, 'RULE_NOT_FOUND', '选中的规则不在清单里', 'ruleId');
  const file = data.files.find((item) => item.id === fileId);
  if (!fileId || !file) throw new ApiError(404, 'FILE_NOT_FOUND', '选中的文件不在清单里', 'fileId');
  if (!Number.isInteger(lineNo) || lineNo < 1 || lineNo > lineCountOf(file.content)) {
    throw new ApiError(400, 'LINE_NO_INVALID', '行号要是这个文件里确实存在的一行', 'lineNo');
  }
  return { data, rule, file, lineNo };
}

// 忽略一条命中：已经忽略过的直接返回原来那条记录，不重复登记
function ignoreHit(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const { data, rule, file, lineNo } = readHitTarget(input);
  const key = `${rule.id}|${file.id}|${lineNo}`;
  const existing = data.ignores.find((item) => ignoreKeyOf(item) === key);
  if (existing) return { ignore: existing, created: false };

  const ignore = {
    id: crypto.randomUUID(),
    ruleId: rule.id,
    fileId: file.id,
    lineNo,
    operator: pickText(input.operator).slice(0, MAX_OPERATOR_LENGTH),
    ignoredAt: new Date().toISOString(),
  };
  data.ignores.push(ignore);
  save(data);
  return { ignore, created: true };
}

// 恢复一条命中：没找到对应的忽略记录就明说
function restoreHit(payload) {
  const { data, rule, file, lineNo } = readHitTarget(payload);
  const key = `${rule.id}|${file.id}|${lineNo}`;
  const index = data.ignores.findIndex((item) => ignoreKeyOf(item) === key);
  if (index === -1) throw new ApiError(404, 'IGNORE_NOT_FOUND', '这条命中没有被忽略过', '');
  const [removed] = data.ignores.splice(index, 1);
  save(data);
  return { removed: { ruleId: removed.ruleId, fileId: removed.fileId, lineNo: removed.lineNo } };
}

module.exports = { ignoreHit, restoreHit };
