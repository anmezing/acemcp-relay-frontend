import { describe, expect, it } from "vitest";
import {
  credentialAuthErrorMessage,
  validateCredentialFields,
} from "./credential-auth";

describe("credential auth form", () => {
  it("validates registration-only fields", () => {
    expect(validateCredentialFields({
      mode: "register",
      name: "",
      email: "user@example.com",
      password: "password",
      confirmPassword: "password",
    })).toBe("请输入昵称");

    expect(validateCredentialFields({
      mode: "register",
      name: "User",
      email: "user@example.com",
      password: "password",
      confirmPassword: "different",
    })).toBe("两次输入的密码不一致");
  });

  it("does not require registration fields when logging in", () => {
    expect(validateCredentialFields({
      mode: "login",
      name: "",
      email: "user@example.com",
      password: "short",
      confirmPassword: "",
    })).toBeNull();
  });

  it("maps Better Auth errors to actionable Chinese messages", () => {
    expect(credentialAuthErrorMessage(
      { code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" },
      "register"
    )).toContain("该邮箱已注册");
    expect(credentialAuthErrorMessage(
      { message: "REGISTRATION_DISABLED" },
      "register"
    )).toBe("当前未开放新用户注册");
    expect(credentialAuthErrorMessage(
      { code: "INVALID_EMAIL_OR_PASSWORD" },
      "login"
    )).toBe("邮箱或密码错误");
  });
});
