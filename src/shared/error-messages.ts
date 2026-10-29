import { interpolate, type Locale, type MessageParams } from './locale';

export const errorMessages = {
  version_invalid: { zh: '请携带有效的版本号', en: 'A valid version number is required.' },
  object_required: { zh: '请求内容必须是对象', en: 'The request body must be an object.' },
  text_length: { zh: '{field}需为 1–{max} 个字符', en: '{field} must contain 1–{max} characters.' },
  event_progress_unavailable: {
    zh: '当前事件不能使用此进展阶段',
    en: 'This progress stage is unavailable for the current event.',
  },
  event_progress_conflict: {
    zh: '进展阶段与完成状态不一致',
    en: 'The progress stage does not match the completion status.',
  },
  event_type_invalid: { zh: '事件类型无效', en: 'Invalid event type.' },
  event_monitors_invalid: {
    zh: '请选择 1–10 个关联节点',
    en: 'Select between 1 and 10 associated monitors.',
  },
  maintenance_time_invalid: {
    zh: '请填写有效的维护起止时间，结束时间须晚于开始时间',
    en: 'Enter valid maintenance times. The end must be after the start.',
  },
  event_progress_invalid: { zh: '请选择有效的进展阶段', en: 'Select a valid progress stage.' },
  event_resolve_invalid: { zh: '完成状态无效', en: 'Invalid completion status.' },
  access_unconfigured: {
    zh: '后台尚未配置 Cloudflare Access，请按 README 完成配置。',
    en: 'Cloudflare Access is not configured. Follow the README to finish setup.',
  },
  auth_required: {
    zh: '请通过 Cloudflare Access 登录后访问后台。',
    en: 'Sign in through Cloudflare Access to open the admin console.',
  },
  auth_expired: {
    zh: '登录凭证无效或已过期，请重新登录。',
    en: 'Your session is invalid or expired. Please sign in again.',
  },
  cross_site_request: { zh: '不允许跨站修改监控。', en: 'Cross-site changes to monitors are not allowed.' },
  json_required: { zh: '请求必须使用 JSON。', en: 'Requests must use JSON.' },
  json_invalid: { zh: 'JSON 格式无效。', en: 'Invalid JSON.' },
  service_unavailable: {
    zh: '服务暂时不可用，请稍后重试。',
    en: 'The service is temporarily unavailable. Please try again later.',
  },
  request_too_large: { zh: '请求内容过大。', en: 'The request body is too large.' },
  endpoint_not_found: { zh: '接口不存在。', en: 'API endpoint not found.' },
  event_not_found: { zh: '事件不存在。', en: 'Event not found.' },
  group_order_invalid: {
    zh: '排序需为 0–1000000 的整数',
    en: 'Sort order must be an integer between 0 and 1000000.',
  },
  settings_object_required: { zh: '全局设置必须是对象', en: 'Global settings must be an object.' },
  settings_version_invalid: { zh: '请携带有效的设置版本号', en: 'A valid settings version is required.' },
  auto_incident_interval_invalid: {
    zh: '自动事件阈值需为 1–1440 分钟的整数，或设为 0 关闭',
    en: 'The automatic incident threshold must be an integer from 1 to 1440 minutes, or 0 to disable it.',
  },
  refresh_interval_invalid: {
    zh: '页面刷新间隔需为 5–3600 秒的整数，或设为 0 关闭自动刷新',
    en: 'The refresh interval must be an integer from 5 to 3600 seconds, or 0 to disable automatic refresh.',
  },
  waf_enabled_invalid: { zh: 'WAF 放行开关无效', en: 'Invalid WAF bypass setting.' },
  waf_token_invalid: {
    zh: '放行密钥需为 32–256 位字母、数字、下划线或连字符，建议使用随机生成',
    en: 'The bypass token must contain 32–256 letters, digits, underscores or hyphens. A randomly generated token is recommended.',
  },
  waf_token_required: {
    zh: '启用 WAF 放行前请先配置密钥',
    en: 'Configure a token before enabling WAF bypass.',
  },
  http_url_invalid: { zh: '请输入完整的 HTTP 或 HTTPS 地址', en: 'Enter a complete HTTP or HTTPS URL.' },
  http_url_not_public: {
    zh: '仅支持公网 HTTP/HTTPS 地址，不能包含用户名或密码',
    en: 'Only public HTTP/HTTPS URLs without a username or password are supported.',
  },
  headers_object_required: {
    zh: '请求头必须是名称和值组成的对象',
    en: 'Request headers must be an object of names and values.',
  },
  header_invalid: {
    zh: '请求头名称或值无效，不能包含换行或不支持的字符',
    en: 'Invalid header name or value. Line breaks and unsupported characters are not allowed.',
  },
  header_reserved: {
    zh: '不能覆盖 WAF 凭据、Host、Content-Length 或逐跳传输头',
    en: 'WAF credentials, Host, Content-Length and hop-by-hop headers cannot be overridden.',
  },
  header_duplicate: {
    zh: '请求头名称不能重复（不区分大小写）',
    en: 'Header names must be unique (case insensitive).',
  },
  headers_too_large: { zh: '请求头合计不能超过 8 KiB', en: 'Request headers cannot exceed 8 KiB in total.' },
  body_method_unsupported: {
    zh: 'GET 和 HEAD 不支持请求体',
    en: 'GET and HEAD do not support request bodies.',
  },
  body_invalid: { zh: '请求体格式无效', en: 'Invalid request body format.' },
  body_content_required: {
    zh: '请求体需选择文本或 JSON 格式并填写内容',
    en: 'Select text or JSON and enter the request body.',
  },
  body_too_large: { zh: '请求体不能超过 16 KiB', en: 'The request body cannot exceed 16 KiB.' },
  body_json_invalid: { zh: '请求体不是有效的 JSON', en: 'The request body is not valid JSON.' },
  keywords_invalid: { zh: '关键词必须是字符串列表', en: 'Keywords must be a list of strings.' },
  keywords_too_many: { zh: '每组最多填写 20 个关键词', en: 'Each list can contain at most 20 keywords.' },
  keyword_invalid: {
    zh: '每个关键词最多 256 个字符，且不能包含换行',
    en: 'Each keyword can contain at most 256 characters and no line breaks.',
  },
  response_check_invalid: { zh: '响应校验配置无效', en: 'Invalid response check configuration.' },
  ignore_case_invalid: { zh: '忽略大小写选项无效', en: 'Invalid case sensitivity setting.' },
  head_response_check_unsupported: {
    zh: 'HEAD 不支持响应内容校验，请选择其他请求方法',
    en: 'HEAD does not support response content checks. Choose another request method.',
  },
  monitor_object_required: { zh: '监控配置必须是对象', en: 'Monitor configuration must be an object.' },
  monitor_name_invalid: { zh: '名称需为 1–80 个字符', en: 'The name must contain 1–80 characters.' },
  group_invalid: { zh: '分组无效', en: 'Invalid group.' },
  monitor_interval_invalid: {
    zh: '检测间隔需为 {min}–{max} 分钟的整数',
    en: 'The check interval must be an integer from {min} to {max} minutes.',
  },
  timeout_invalid: {
    zh: '超时需为 1–30 秒的整数',
    en: 'The timeout must be an integer from 1 to 30 seconds.',
  },
  enabled_invalid: { zh: '启用状态无效', en: 'Invalid enabled state.' },
  url_too_long: { zh: 'URL 无效或过长', en: 'The URL is invalid or too long.' },
  http_method_invalid: { zh: '请求方法无效', en: 'Invalid request method.' },
  waf_domain_required: {
    zh: 'WAF 放行仅支持公网域名，不支持 IP 地址',
    en: 'WAF bypass requires a public domain name. IP addresses are not supported.',
  },
  status_range_invalid: { zh: '期望状态码范围无效', en: 'Invalid expected status code range.' },
  hostname_required: {
    zh: '请输入公网域名或 IP，不包含协议和路径',
    en: 'Enter a public domain name or IP without a protocol or path.',
  },
  port_separate: { zh: '端口请单独填写', en: 'Enter the port separately.' },
  hostname_invalid: { zh: '主机地址无效', en: 'Invalid hostname.' },
  hostname_not_public: {
    zh: '请输入公网主机地址，端口请单独填写',
    en: 'Enter a public hostname and specify the port separately.',
  },
  port_invalid: {
    zh: '端口需为 1–65535，Cloudflare 不支持 TCP 端口 25',
    en: 'The port must be between 1 and 65535. Cloudflare does not support TCP port 25.',
  },
  monitor_type_invalid: { zh: '检测类型必须为 HTTP 或 TCP', en: 'The monitor type must be HTTP or TCP.' },
  group_conflict: {
    zh: '分组已被修改或名称已存在，请刷新后重试。',
    en: 'The group has changed or its name is already in use. Refresh and try again.',
  },
  group_not_found: {
    zh: '分组不存在，请刷新后重新选择',
    en: 'The group no longer exists. Refresh and select another group.',
  },
  group_changed: { zh: '分组已变更，请刷新后重试。', en: 'The group has changed. Refresh and try again.' },
  cursor_invalid: { zh: '分页游标无效', en: 'Invalid pagination cursor.' },
  event_monitor_not_found: {
    zh: '关联节点不存在，请刷新后重新选择',
    en: 'An associated monitor no longer exists. Refresh and select again.',
  },
  event_edit_conflict: {
    zh: '事件或关联节点已变更；自动事件不能编辑，请刷新后重试。',
    en: 'The event or its monitors have changed. Automatic events cannot be edited. Refresh and try again.',
  },
  event_changed: { zh: '事件已变更，请刷新后重试。', en: 'The event has changed. Refresh and try again.' },
  event_managed_or_ended: {
    zh: '该事件状态由检测维护，或事件已结束，请刷新后重试。',
    en: 'The event is managed by checks or has already ended. Refresh and try again.',
  },
  event_update_conflict: {
    zh: '事件已变更，或该事件状态由检测维护，请刷新后重试。',
    en: 'The event has changed or its status is managed by checks. Refresh and try again.',
  },
  event_delete_conflict: {
    zh: '事件已变更，或自动事件仍在进行中，请刷新后重试。',
    en: 'The event has changed or the automatic incident is still open. Refresh and try again.',
  },
  settings_conflict: {
    zh: '全局设置已被修改，请重新加载后重试。',
    en: 'Global settings have changed. Reload and try again.',
  },
  monitor_not_found: { zh: '监控不存在。', en: 'Monitor not found.' },
  monitor_conflict: {
    zh: '监控已被修改，请刷新后重试。',
    en: 'The monitor has changed. Refresh and try again.',
  },
  monitor_limit: {
    zh: '免费优先模式最多支持 {max} 个监控，请先删除不再使用的项目。',
    en: 'Free-tier mode supports at most {max} monitors. Remove an unused monitor first.',
  },
} as const;
export type AppErrorCode = keyof typeof errorMessages;
export const isAppErrorCode = (value: unknown): value is AppErrorCode =>
  typeof value === 'string' && Object.hasOwn(errorMessages, value);
export const textFields = {
  event_title: { zh: '事件标题', en: 'Event title' },
  event_body: { zh: '事件正文', en: 'Event body' },
  progress_title: { zh: '进展标题', en: 'Progress title' },
  progress_body: { zh: '进展说明', en: 'Progress description' },
  group_name: { zh: '分组名称', en: 'Group name' },
} as const;
export type TextField = keyof typeof textFields;
export function formatError(code: AppErrorCode, params: MessageParams = {}, locale: Locale = 'zh-CN') {
  const language = locale === 'en' ? 'en' : 'zh';
  const field = params.field;
  return interpolate(errorMessages[code][language], {
    ...params,
    ...(typeof field === 'string' && Object.hasOwn(textFields, field)
      ? { field: textFields[field as TextField][language] }
      : {}),
  });
}
