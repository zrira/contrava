import ts from 'typescript';

export const SCANNER_VERSION = '1';
export const supportedExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
export type UsageConfidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type UsageMatchType = 'STATIC_LITERAL' | 'TEMPLATE_LITERAL' | 'STRING_CONCATENATION' | 'HTTP_CLIENT_CALL' | 'BASE_URL_JOIN' | 'WRAPPER_CALL' | 'UNKNOWN';
export interface ApiUsageCandidate {
  httpMethod: string | null;
  endpointPattern: string;
  line: number;
  column: number;
  snippet: string;
  confidence: UsageConfidence;
  matchType: UsageMatchType;
  evidence: { call: string; original: string; normalizedPath: string; methodSource: string; scannerVersion: string };
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
const CLIENT_NAME = /(?:axios|api|client|http|request|service)/i;

export function normalizeEndpoint(input: string): string | null {
  let value = input.trim().replace(/\\/g, '/');
  value = value.replace(/^['"`]|['"`]$/g, '');
  value = value.replace(/^https?:\/\/[^/]+/i, '');
  const firstPath = value.indexOf('/');
  if (!value.startsWith('/') && firstPath >= 0) value = value.slice(firstPath);
  if (!value.startsWith('/')) return null;
  value = value.split(/[?#]/, 1)[0]!.replace(/\/{2,}/g, '/');
  if (value.length > 1) value = value.replace(/\/+$/, '');
  const segments = value.split('/').map((segment) => {
    if (/^\{[^}]+\}$/.test(segment) || /^\$\{[^}]+\}$/.test(segment)) return '{param}';
    if (/^[0-9]+$/.test(segment) && !/^v[0-9]+$/i.test(segment)) return '{param}';
    if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return '{param}';
    return segment;
  });
  return segments.join('/') || '/';
}

export function pathsCompatible(left: string, right: string): boolean {
  const a = normalizeEndpoint(left)?.split('/');
  const b = normalizeEndpoint(right)?.split('/');
  if (!a || !b || a.length !== b.length) return false;
  return a.every((segment, index) => segment === b[index] || segment === '{param}' || b[index] === '{param}');
}

interface ResolvedExpression { value: string; kind: 'literal' | 'template' | 'concat' | 'dynamic'; original: string; baseJoin: boolean }

export function extractApiUsages(path: string, source: string): ApiUsageCandidate[] {
  const kind = path.endsWith('.tsx') || path.endsWith('.jsx') ? ts.ScriptKind.TSX : path.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const constants = new Map<string, ts.Expression>();
  const candidates: ApiUsageCandidate[] = [];

  function collect(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isStringLiteralLike(node.initializer) || ts.isTemplateExpression(node.initializer) || ts.isBinaryExpression(node.initializer))) constants.set(node.name.text, node.initializer);
    ts.forEachChild(node, collect);
  }
  collect(file);

  function resolve(expression: ts.Expression, seen = new Set<string>()): ResolvedExpression | null {
    const original = expression.getText(file);
    if (ts.isStringLiteralLike(expression)) return { value: expression.text, kind: 'literal', original, baseJoin: false };
    if (ts.isTemplateExpression(expression)) {
      let value = expression.head.text;
      for (const span of expression.templateSpans) value += `{param}${span.literal.text}`;
      return { value, kind: 'template', original, baseJoin: !value.startsWith('/') };
    }
    if (ts.isIdentifier(expression)) {
      if (seen.has(expression.text)) return null;
      const constant = constants.get(expression.text);
      if (!constant) return null;
      seen.add(expression.text);
      return resolve(constant, seen);
    }
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = resolve(expression.left, new Set(seen));
      const right = resolve(expression.right, new Set(seen));
      const leftValue = left?.value ?? '{param}';
      const rightValue = right?.value ?? '{param}';
      if (!left && !right) return null;
      return { value: leftValue + rightValue, kind: 'concat', original, baseJoin: !leftValue.startsWith('/') || Boolean(left?.baseJoin) };
    }
    return null;
  }

  function property(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
    return object.properties.find((entry): entry is ts.PropertyAssignment => ts.isPropertyAssignment(entry) && ((ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name)) && entry.name.text === name))?.initializer;
  }
  function staticMethod(expression: ts.Expression | undefined): string | null {
    if (!expression) return null;
    if (ts.isStringLiteralLike(expression)) return expression.text.toUpperCase();
    return null;
  }
  function add(node: ts.CallExpression, endpoint: ts.Expression | undefined, method: string | null, methodSource: string, call: string, callType?: UsageMatchType): void {
    if (!endpoint) return;
    const resolved = resolve(endpoint);
    if (!resolved) return;
    const normalized = normalizeEndpoint(resolved.value);
    if (!normalized || normalized === '/') return;
    const position = file.getLineAndCharacterOfPosition(node.getStart(file));
    const lines = source.split(/\r?\n/);
    const from = Math.max(0, position.line - 2);
    const snippet = lines.slice(from, Math.min(lines.length, position.line + 3)).join('\n').slice(0, 1200);
    const syntaxType: UsageMatchType = resolved.baseJoin ? 'BASE_URL_JOIN' : resolved.kind === 'literal' ? 'STATIC_LITERAL' : resolved.kind === 'template' ? 'TEMPLATE_LITERAL' : resolved.kind === 'concat' ? 'STRING_CONCATENATION' : 'UNKNOWN';
    const matchType = callType ?? syntaxType;
    candidates.push({ httpMethod: method, endpointPattern: normalized, line: position.line + 1, column: position.character + 1, snippet, confidence: method ? (matchType === 'WRAPPER_CALL' ? 'MEDIUM' : 'HIGH') : 'MEDIUM', matchType, evidence: { call, original: resolved.original.slice(0, 300), normalizedPath: normalized, methodSource, scannerVersion: SCANNER_VERSION } });
  }

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === 'fetch') {
        const options = node.arguments[1];
        const method = options && ts.isObjectLiteralExpression(options) ? staticMethod(property(options, 'method')) ?? 'GET' : 'GET';
        add(node, node.arguments[0], method, options ? 'fetch options/default' : 'fetch default GET', 'fetch');
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        const receiver = node.expression.expression.getText(file);
        const methodName = node.expression.name.text.toLowerCase();
        if (HTTP_METHODS.has(methodName) && CLIENT_NAME.test(receiver)) add(node, node.arguments[0], methodName.toUpperCase(), 'client method name', `${receiver}.${methodName}`, receiver === 'axios' ? 'HTTP_CLIENT_CALL' : 'WRAPPER_CALL');
        else if (methodName === 'request' && CLIENT_NAME.test(receiver) && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
          const config = node.arguments[0];
          add(node, property(config, 'url'), staticMethod(property(config, 'method')), 'request config object', `${receiver}.request`, 'HTTP_CLIENT_CALL');
        }
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'axios' && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
        const config = node.arguments[0];
        add(node, property(config, 'url'), staticMethod(property(config, 'method')), 'axios config object', 'axios', 'HTTP_CLIENT_CALL');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return candidates.sort((a, b) => a.line - b.line || a.column - b.column || (a.httpMethod ?? '').localeCompare(b.httpMethod ?? ''));
}
