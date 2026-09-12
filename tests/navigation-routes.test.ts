import { expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
function files(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]); }
test("internal link destinations resolve to real application routes", () => {
  const routes = files("src/app").filter(f => /\/(page|route)\.tsx?$/.test(f)).map(f => {
    const segments = f.replace(/^src\/app\//, "").replace(/(^|\/)(page|route)\.tsx?$/, "").split("/").filter(p => !p.startsWith("("));
    return new RegExp("^" + segments.filter(Boolean).map(p => p.startsWith("[[...") ? "(?:/.*)?" : p.startsWith("[...") ? "/.+" : p.startsWith("[") ? "/[^/]+" : "/" + p).join("") + "/?$");
  });
  const broken: string[] = [];
  for (const file of files("src/components").filter(f => f.endsWith(".tsx"))) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node: ts.Node) {
      if (ts.isJsxAttribute(node) && node.name.getText(source) === "href" && node.initializer) {
        const expr: ts.Expression | ts.StringLiteral | undefined = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
        if (expr && (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr) || ts.isTemplateExpression(expr))) {
          if (ts.isTemplateExpression(expr) && !/[/?#]$/.test(expr.head.text) && !expr.head.text.includes("?")) return; // Arbitrary computed suffixes need runtime verification.
          const href = ts.isTemplateExpression(expr) ? expr.head.text + expr.templateSpans.map(s => "fixture" + s.literal.text).join("") : expr.text;
          if (href === "" || href === "#") broken.push(`${file}: empty link`);
          if (href.startsWith("/") && !href.startsWith("//") && !routes.some(r => r.test(href.split(/[?#]/)[0]))) broken.push(`${file}: ${href}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  expect(broken).toEqual([]);
});
