import type { Config } from "~/utils/validateConfig";

type PrismaScalarType =
  | "String"
  | "Boolean"
  | "Int"
  | "BigInt"
  | "Float"
  | "Decimal"
  | "DateTime"
  | "Json"
  | "Bytes";

type ZodScalarType = 
  | "string"
  | "number"
  | "bigint"
  | "boolean"
  | "unknown";

// Map Prisma types to Zod types based on database provider
// This ensures Zod validates what the database actually returns
const sqliteZodTypeMap: Record<string, ZodScalarType> = {
  String: "string",
  Boolean: "boolean", // Zod should use logical types, not storage types
  Int: "number",
  BigInt: "number",
  Float: "number",
  Decimal: "number",
  DateTime: "string", // SQLite stores dates as strings
  Json: "unknown",
  Bytes: "unknown", // Will be handled specially as Buffer
};

const mysqlZodTypeMap: Record<string, ZodScalarType> = {
  String: "string",
  Boolean: "boolean", // Zod should use logical types, not storage types
  Int: "number",
  BigInt: "number",
  Float: "number",
  Decimal: "string",
  DateTime: "unknown", // Will be handled specially as Date
  Json: "unknown",
  Bytes: "unknown", // Will be handled specially as Buffer
};

const postgresqlZodTypeMap: Record<string, ZodScalarType> = {
  String: "string",
  Boolean: "boolean",
  Int: "number",
  BigInt: "string", // PostgreSQL returns bigint as string
  Float: "number",
  Decimal: "string",
  DateTime: "unknown", // Will be handled specially as Date
  Json: "unknown",
  Bytes: "unknown", // Will be handled specially as Buffer
};

const sqlServerZodTypeMap: Record<string, ZodScalarType> = {
  String: "string",
  Boolean: "boolean",
  Int: "number",
  BigInt: "number",
  Float: "number",
  Decimal: "string",
  DateTime: "unknown", // Will be handled specially as Date
  Json: "unknown",
  Bytes: "unknown", // Will be handled specially as Buffer
};

export const getZodTypeFromPrismaType = (
  type: string,
  config: Config
): ZodScalarType | null => {
  let typeMap: Record<string, ZodScalarType>;
  
  switch (config.databaseProvider) {
    case "sqlite":
      typeMap = sqliteZodTypeMap;
      break;
    case "mysql":
      typeMap = mysqlZodTypeMap;
      break;
    case "postgresql":
    case "cockroachdb":
      typeMap = postgresqlZodTypeMap;
      break;
    case "sqlserver":
      typeMap = sqlServerZodTypeMap;
      break;
    default:
      throw new Error(`Unsupported database provider: ${config.databaseProvider}`);
  }

  return typeMap[type] || null;
};

// Get the Zod method call for a given Prisma type
export const getZodMethodForPrismaType = (
  type: string,
  config: Config
): string => {
  const zodType = getZodTypeFromPrismaType(type, config);
  
  // Handle special types that need custom handling
  if (type === "DateTime") {
    // For SQLite, DateTime is stored as string
    if (config.databaseProvider === "sqlite") {
      return "z.string()";
    }
    // For other databases, use coerce.date()
    return "z.coerce.date()";
  }
  
  if (type === "Json") {
    // JSON fields need special handling
    return "z.unknown()";
  }
  
  if (type === "Bytes") {
    // Bytes are returned as Buffer
    return "z.instanceof(Buffer)";
  }
  
  if (type === "Decimal") {
    // Decimals are strings in most databases
    return "z.string()";
  }
  
  // For standard types, use the mapped Zod type
  if (zodType) {
    return `z.${zodType}()`;
  }
  
  // Fallback for unknown types
  return "z.unknown()";
};