import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import en from "@/messages/en.json";
import zhCN from "@/messages/zh-CN.json";
import { defaultLocale, isAppLocale, locales } from "./config";

function leafKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key)
  );
}

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filename);
    return /\.tsx?$/.test(entry.name) ? [filename] : [];
  });
}

function hasMessage(catalog: Record<string, unknown>, namespace: string, key: string): boolean {
  let current: unknown = catalog[namespace];
  for (const segment of key.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return false;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string";
}

describe("internationalization catalogs", () => {
  it("uses Chinese as the default locale", () => {
    expect(defaultLocale).toBe("zh-CN");
    expect(locales).toEqual(["zh-CN", "en"]);
    expect(isAppLocale("zh-CN")).toBe(true);
    expect(isAppLocale("en")).toBe(true);
    expect(isAppLocale("fr")).toBe(false);
  });

  it("keeps the Chinese and English message keys in sync", () => {
    expect(leafKeys(en).sort()).toEqual(leafKeys(zhCN).sort());
  });

  it("defines every statically referenced UI message", () => {
    const missing: string[] = [];
    const files = [
      ...sourceFiles(path.join(process.cwd(), "app")),
      ...sourceFiles(path.join(process.cwd(), "components")),
    ];

    for (const filename of files) {
      const source = fs.readFileSync(filename, "utf8");
      const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const translators = new Map<string, Set<string>>();

      const collectTranslators = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
          const call = node.initializer;
          if (ts.isIdentifier(call.expression) && call.expression.text === "useTranslations" && call.arguments.length === 1 && ts.isStringLiteral(call.arguments[0])) {
            const namespaces = translators.get(node.name.text) ?? new Set<string>();
            namespaces.add(call.arguments[0].text);
            translators.set(node.name.text, namespaces);
          }
        }
        ts.forEachChild(node, collectTranslators);
      };
      collectTranslators(sourceFile);

      const checkCalls = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
          const namespaces = translators.get(node.expression.text);
          if (namespaces) {
            for (const namespace of namespaces) {
              if (!hasMessage(en as Record<string, unknown>, namespace, node.arguments[0].text)) {
                missing.push(`${path.relative(process.cwd(), filename)}: ${namespace}.${node.arguments[0].text}`);
              }
            }
          }
        }
        if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(sourceFile) === "I18nText") {
          const id = node.attributes.properties.find(
            (attribute): attribute is ts.JsxAttribute => ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === "id"
          );
          if (id?.initializer && ts.isStringLiteral(id.initializer) && !hasMessage(en as Record<string, unknown>, "Home", id.initializer.text)) {
            missing.push(`${path.relative(process.cwd(), filename)}: Home.${id.initializer.text}`);
          }
        }
        ts.forEachChild(node, checkCalls);
      };
      checkCalls(sourceFile);
    }

    expect(missing).toEqual([]);
  });
});
