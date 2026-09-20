const path = require('path');
const express = require('express');
const api = require('./api');

const app = express();
const PORT = process.env.PORT || 5101;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// 健康检查：页面右上角据此显示服务连接状态
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, port: PORT });
});

app.get('/api/rules', (req, res) => {
  res.json(api.listRules({
    level: api.readQuery(req.query, 'level'),
    status: api.readQuery(req.query, 'status'),
    fileType: api.readQuery(req.query, 'fileType'),
    keyword: api.readQuery(req.query, 'keyword'),
  }));
});

app.post('/api/rules', (req, res) => {
  try {
    res.status(201).json(api.createRule(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/rules/:id', (req, res) => {
  try {
    res.json(api.getRule(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

app.patch('/api/rules/:id', (req, res) => {
  try {
    res.json(api.updateRule(req.params.id, req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/rules/:id', (req, res) => {
  try {
    res.json(api.deleteRule(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/files', (req, res) => {
  res.json(api.listFiles({
    type: api.readQuery(req.query, 'type'),
    keyword: api.readQuery(req.query, 'keyword'),
  }));
});

app.post('/api/files', (req, res) => {
  try {
    res.status(201).json(api.createFile(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/files/:id', (req, res) => {
  try {
    res.json(api.getFile(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

app.patch('/api/files/:id', (req, res) => {
  try {
    res.json(api.updateFile(req.params.id, req.body));
  } catch (err) {
    sendError(res, err);
  }
});

app.delete('/api/files/:id', (req, res) => {
  try {
    res.json(api.deleteFile(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

// 扫一遍：可以只扫某一条规则、某一个文件，也可以只留某个级别
app.post('/api/scan', (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    res.json(api.scan({
      level: body.level,
      fileId: body.fileId,
      ruleId: body.ruleId,
    }));
  } catch (err) {
    sendError(res, err);
  }
});

// 把某一条命中标成已忽略，重复标同一条不会留下两条记录
app.post('/api/ignores', (req, res) => {
  try {
    const result = api.ignoreHit(req.body);
    res.status(result.created ? 201 : 200).json(result.ignore);
  } catch (err) {
    sendError(res, err);
  }
});

// 取消某一条命中的忽略
app.delete('/api/ignores/:id', (req, res) => {
  try {
    res.json(api.unignoreHit(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

// 导出：页面把这一轮的命中与所选范围带上来，返回文件名、可读内容与汇总；
// 预演与正式导出都走这里，两边数字自然对得上
app.post('/api/scan/export', (req, res) => {
  try {
    res.json(api.buildExport(req.body));
  } catch (err) {
    sendError(res, err);
  }
});

// 未匹配到的接口路径统一返回说明，避免前端拿到一串页面内容
app.use('/api', (_req, res) => {
  res.status(404).json({ error: { code: 'API_NOT_FOUND', message: '接口不存在', field: '' } });
});

// 统一错误出口：业务异常按状态码与错误码返回，其余按服务异常处理
function sendError(res, err) {
  if (err instanceof api.ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, field: err.field },
    });
  }
  console.error('[tp101] 处理请求时出现未预期的问题：', err);
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: '服务内部异常，请稍后重试', field: '' },
  });
}

// 请求体解析失败时给出明确说明
app.use((err, _req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'BODY_INVALID_JSON', message: '提交的内容不是合法的 JSON', field: '' },
    });
  }
  if (err) return sendError(res, err);
  return next();
});

app.listen(PORT, () => {
  console.log(`检查规则与命中清单工作台已启动：http://localhost:${PORT}`);
});
