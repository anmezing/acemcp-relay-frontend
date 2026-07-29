// 用户输入校验失败的标记类型：API 路由据此区分 400（用户可修复）与 500
// （内部错误，不把 message 泄给客户端）。不要用 message 文案判断错误类别。
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
