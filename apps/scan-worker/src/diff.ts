import type { ContractChange, OpenApiDocument, Severity, ChangeCategory } from '@contrava/shared';

const methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'] as const;
type JsonObject = Record<string, unknown>;
interface Field { type: string; required: boolean; enumValues?: string; schema: JsonObject }

const object = (value: unknown): JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};

function resolve(document: OpenApiDocument, value: unknown): JsonObject {
  const candidate = object(value);
  const ref = candidate.$ref;
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return candidate;
  let resolved: unknown = document;
  for (const segment of ref.slice(2).split('/')) {
    resolved = object(resolved)[segment.replaceAll('~1', '/').replaceAll('~0', '~')];
  }
  return object(resolved);
}

function schemaType(schema: JsonObject): string {
  if (typeof schema.type === 'string') return schema.type;
  if (schema.properties) return 'object';
  if (schema.oneOf) return 'oneOf';
  if (schema.anyOf) return 'anyOf';
  return 'unknown';
}

function flattenFields(document: OpenApiDocument, input: unknown, prefix = '', inheritedRequired = true): Map<string, Field> {
  const schema = resolve(document, input);
  const fields = new Map<string, Field>();
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : []);
  for (const [name, rawChild] of Object.entries(object(schema.properties))) {
    const child = resolve(document, rawChild);
    const key = prefix ? `${prefix}.${name}` : name;
    const field: Field = { type: schemaType(child), required: inheritedRequired && required.has(name), schema: child };
    if (Array.isArray(child.enum)) field.enumValues = JSON.stringify(child.enum);
    fields.set(key, field);
    for (const [nestedName, nested] of flattenFields(document, child, key, field.required)) fields.set(nestedName, nested);
  }
  return fields;
}

function contentSchema(document: OpenApiDocument, container: unknown): JsonObject {
  const resolved = resolve(document, container);
  const content = object(resolved.content);
  const media = object(content['application/json'] ?? Object.values(content)[0]);
  return resolve(document, media.schema);
}

function requestSchema(document: OpenApiDocument, operation: JsonObject): JsonObject {
  return contentSchema(document, operation.requestBody);
}

function responses(operation: JsonObject): JsonObject { return object(operation.responses); }
const successCodes = (value: JsonObject): string[] => Object.keys(value).filter((code) => /^2\d\d$/.test(code)).sort();

function add(changes: ContractChange[], severity: Severity, category: ChangeCategory, path: string, method: string | null, description: string): void {
  changes.push({ severity, category, path, method: method?.toUpperCase() ?? null, description });
}

function compareFields(changes: ContractChange[], previousDoc: OpenApiDocument, currentDoc: OpenApiDocument, previousSchema: JsonObject, currentSchema: JsonObject, context: 'request' | 'response', path: string, method: string): void {
  const before = flattenFields(previousDoc, previousSchema);
  const after = flattenFields(currentDoc, currentSchema);
  for (const [name, field] of before) {
    const next = after.get(name);
    if (!next) {
      add(changes, context === 'response' ? 'BREAKING' : 'POTENTIALLY_BREAKING', context === 'response' ? 'RESPONSE_PROPERTY_REMOVED' : 'REQUEST_PROPERTY_REMOVED', path, method, `${context === 'response' ? 'Response' : 'Request'} property ${name} was removed`);
      continue;
    }
    if (field.type !== next.type) {
      add(changes, 'BREAKING', context === 'response' ? 'RESPONSE_TYPE_CHANGED' : 'REQUEST_TYPE_CHANGED', path, method, `${context === 'response' ? 'Response' : 'Request'} property ${name} changed from ${field.type} to ${next.type}`);
    }
    if (!field.required && next.required) add(changes, 'POTENTIALLY_BREAKING', 'FIELD_BECAME_REQUIRED', path, method, `${context === 'response' ? 'Response' : 'Request'} property ${name} became required`);
    if (field.enumValues !== next.enumValues && (field.enumValues || next.enumValues)) add(changes, 'POTENTIALLY_BREAKING', 'ENUM_CHANGED', path, method, `${context === 'response' ? 'Response' : 'Request'} property ${name} enum values changed`);
  }
  for (const [name, field] of after) {
    if (before.has(name)) continue;
    const requestRequired = context === 'request' && field.required;
    add(changes, requestRequired ? 'BREAKING' : 'NON_BREAKING', context === 'response' ? 'RESPONSE_PROPERTY_ADDED' : 'REQUEST_PROPERTY_ADDED', path, method, `${field.required ? 'Required ' : ''}${context} property ${name} was added`);
  }
}

function parameters(document: OpenApiDocument, pathItem: JsonObject, operation: JsonObject): Map<string, JsonObject> {
  const result = new Map<string, JsonObject>();
  for (const raw of [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])]) {
    const parameter = resolve(document, raw);
    if (typeof parameter.name === 'string' && typeof parameter.in === 'string') result.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  return result;
}

function compareParameters(changes: ContractChange[], previousDoc: OpenApiDocument, currentDoc: OpenApiDocument, previousPath: JsonObject, currentPath: JsonObject, previousOperation: JsonObject, currentOperation: JsonObject, path: string, method: string): void {
  const before = parameters(previousDoc, previousPath, previousOperation);
  const after = parameters(currentDoc, currentPath, currentOperation);
  for (const [key, parameter] of after) {
    const old = before.get(key);
    if (!old && parameter.required === true) add(changes, 'BREAKING', 'REQUIRED_PARAMETER_ADDED', path, method, `Required ${key.replace(':', ' parameter ')} was added`);
    if (!old) continue;
    if (old.required !== true && parameter.required === true) add(changes, 'POTENTIALLY_BREAKING', 'FIELD_BECAME_REQUIRED', path, method, `${key.replace(':', ' parameter ')} became required`);
    const oldSchema = resolve(previousDoc, old.schema);
    const newSchema = resolve(currentDoc, parameter.schema);
    if (schemaType(oldSchema) !== schemaType(newSchema)) add(changes, 'BREAKING', 'REQUEST_TYPE_CHANGED', path, method, `${key.replace(':', ' parameter ')} changed type from ${schemaType(oldSchema)} to ${schemaType(newSchema)}`);
    const stricter = (typeof newSchema.minimum === 'number' && (typeof oldSchema.minimum !== 'number' || newSchema.minimum > oldSchema.minimum)) || (typeof newSchema.maximum === 'number' && (typeof oldSchema.maximum !== 'number' || newSchema.maximum < oldSchema.maximum)) || (!oldSchema.pattern && Boolean(newSchema.pattern));
    if (stricter) add(changes, 'POTENTIALLY_BREAKING', 'PARAMETER_CONSTRAINTS_TIGHTENED', path, method, `${key.replace(':', ' parameter ')} constraints became stricter`);
  }
}

function compareOperation(changes: ContractChange[], previousDoc: OpenApiDocument, currentDoc: OpenApiDocument, previousPath: JsonObject, currentPath: JsonObject, oldOperation: JsonObject, newOperation: JsonObject, path: string, method: string): void {
  compareParameters(changes, previousDoc, currentDoc, previousPath, currentPath, oldOperation, newOperation, path, method);
  compareFields(changes, previousDoc, currentDoc, requestSchema(previousDoc, oldOperation), requestSchema(currentDoc, newOperation), 'request', path, method);
  const oldResponses = responses(oldOperation);
  const newResponses = responses(newOperation);
  const oldCodes = successCodes(oldResponses);
  const newCodes = successCodes(newResponses);
  for (const code of oldCodes) if (!newCodes.includes(code)) add(changes, 'BREAKING', 'SUCCESS_RESPONSE_REMOVED', path, method, `Successful response ${code} was removed`);
  for (const code of newCodes) if (!oldCodes.includes(code)) add(changes, 'NON_BREAKING', 'SUCCESS_RESPONSE_ADDED', path, method, `Successful response ${code} was added`);
  for (const code of oldCodes.filter((code) => newCodes.includes(code))) compareFields(changes, previousDoc, currentDoc, contentSchema(previousDoc, oldResponses[code]), contentSchema(currentDoc, newResponses[code]), 'response', path, method);
  if (oldOperation.description !== newOperation.description) add(changes, 'NON_BREAKING', 'DESCRIPTION_CHANGED', path, method, 'Operation description changed');
}

export function diffSpecs(previous: OpenApiDocument, current: OpenApiDocument): ContractChange[] {
  const changes: ContractChange[] = [];
  const oldPaths = object(previous.paths);
  const newPaths = object(current.paths);
  for (const path of Object.keys(oldPaths).sort()) {
    if (!(path in newPaths)) { add(changes, 'BREAKING', 'ENDPOINT_REMOVED', path, null, `Endpoint ${path} was removed`); continue; }
    const oldPath = resolve(previous, oldPaths[path]);
    const newPath = resolve(current, newPaths[path]);
    for (const method of methods) {
      const oldOperation = oldPath[method];
      const newOperation = newPath[method];
      if (oldOperation && !newOperation) add(changes, 'BREAKING', 'METHOD_REMOVED', path, method, `${method.toUpperCase()} ${path} was removed`);
      else if (!oldOperation && newOperation) add(changes, 'NON_BREAKING', 'METHOD_ADDED', path, method, `${method.toUpperCase()} ${path} was added`);
      else if (oldOperation && newOperation) compareOperation(changes, previous, current, oldPath, newPath, resolve(previous, oldOperation), resolve(current, newOperation), path, method);
    }
  }
  for (const path of Object.keys(newPaths).sort()) if (!(path in oldPaths)) add(changes, 'NON_BREAKING', 'ENDPOINT_ADDED', path, null, `Endpoint ${path} was added`);
  return changes;
}
