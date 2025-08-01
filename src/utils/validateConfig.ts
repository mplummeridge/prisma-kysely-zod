import { logger } from "@prisma/internals";
import z from "zod";

const booleanStringLiteral = z
  .union([z.boolean(), z.literal("true"), z.literal("false")])
  .transform((arg) => {
    if (typeof arg === "boolean") return arg;
    return arg === "true";
  });

export const configValidator = z
  .object({
    // Meta information (not provided through user input)
    databaseProvider: z.union([
      z.literal("postgresql"),
      z.literal("cockroachdb"),
      z.literal("mysql"),
      z.literal("sqlite"),
      z.literal("sqlserver"),
    ]),

    // Output overrides
    fileName: z.string().optional().default("types.ts"),
    importExtension: z.string().default(""),
    enumFileName: z.string().optional(),

    // Typescript type overrides
    stringTypeOverride: z.string().optional(),
    booleanTypeOverride: z.string().optional(),
    intTypeOverride: z.string().optional(),
    bigIntTypeOverride: z.string().optional(),
    floatTypeOverride: z.string().optional(),
    decimalTypeOverride: z.string().optional(),
    dateTimeTypeOverride: z.string().optional(),
    jsonTypeOverride: z.string().optional(),
    bytesTypeOverride: z.string().optional(),
    unsupportedTypeOverride: z.string().optional(),

    // The DB type name to use in the generated types.
    dbTypeName: z.string().default("DB"),

    // Support the Kysely camel case plugin
    camelCase: booleanStringLiteral.default(false),

    // Use GeneratedAlways for IDs instead of Generated
    readOnlyIds: booleanStringLiteral.default(false),

    // Group models in a namespace by their schema. Cannot be defined if enumFileName is defined.
    groupBySchema: booleanStringLiteral.default(false),

    // Which schema should not be wrapped in a namespace
    defaultSchema: z.string().default("public"),

    // Group models in a namespace by their schema. Cannot be defined if enumFileName is defined.
    filterBySchema: z.array(z.string()).optional(),

    // Generate Zod schemas alongside TypeScript types
    generateZodSchemas: booleanStringLiteral.default(false),
    
    // Output file for Zod schemas (if separate from types)
    zodSchemasFileName: z.string().optional(),
    
    // Automatically add default validators (uuid, cuid, int) based on field characteristics
    useDefaultValidators: booleanStringLiteral.default(true),

    // Phase 3: Generate brand registry from @zod.brand() annotations
    generateBrandRegistry: booleanStringLiteral.default(false),

    // Phase 4: Generate three-layer architecture schemas
    generateThreeLayers: booleanStringLiteral.default(false),

    // Phase 5: Generate CRUD operation schemas
    generateCrudSchemas: booleanStringLiteral.default(false),
    
    // CRUD-specific configuration
    crudConfig: z.object({
      outputDir: z.string().default('crud'),
      includeModels: z.array(z.string()).optional(),
      excludeModels: z.array(z.string()).optional(),
      paginationStrategy: z.enum(['offset', 'cursor', 'both']).default('offset'),
      maxPageSize: z.number().default(100),
      generateIndex: booleanStringLiteral.default(true),
    }).optional(),

    // Phase 6: Generate SQLite boolean plugin
    generateSQLiteBooleanPlugin: booleanStringLiteral.default(false),
  })
  .strict()
  .transform((config) => {
    if (!config.enumFileName) {
      config.enumFileName = config.fileName;
    }

    if (config.groupBySchema && config.enumFileName !== config.fileName) {
      // would require https://www.typescriptlang.org/docs/handbook/namespaces.html#splitting-across-files
      // which is considered a bad practice
      throw new Error("groupBySchema is not compatible with enumFileName");
    }

    return config as Omit<typeof config, "enumFileName"> &
      Required<Pick<typeof config, "enumFileName">>;
  });

export type Config = z.infer<typeof configValidator>;

export const validateConfig = (config: unknown) => {
  const parsed = configValidator.safeParse(config);
  if (!parsed.success) {
    logger.error("Invalid prisma-kysely config");
    Object.entries(parsed.error.flatten().fieldErrors).forEach(
      ([key, value]) => {
        logger.error(`${key}: ${value.join(", ")}`);
      }
    );
    Object.values(parsed.error.flatten().formErrors).forEach((value) => {
      logger.error(`${value}`);
    });

    process.exit(1);
  }
  return parsed.data;
};
