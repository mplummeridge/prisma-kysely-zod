import type { DMMF } from "@prisma/generator-helper";
import CodeBlockWriter from "code-block-writer";
import { generateZodField } from "./generateZodField";
import { normalizeCase } from "~/utils/normalizeCase";
import type { Config } from "~/utils/validateConfig";

export type ZodSchemaType = {
  modelName: string;
  schemaName: string;
  content: string;
  imports: Set<string>;
};

export const generateZodSchema = (
  model: DMMF.Model,
  config: Config
): ZodSchemaType => {
  const writer = new CodeBlockWriter({
    indentNumberOfSpaces: 2,
    useSingleQuote: false,
  });
  
  const imports = new Set<string>();
  
  // Always need zod import
  imports.add(`import { z } from "zod/v4";`);
  
  // Check if we need enum imports
  const enumFields = model.fields.filter(field => field.kind === "enum");
  enumFields.forEach(field => {
    // Import the enum for z.nativeEnum()
    imports.add(`import { ${field.type} } from "./enums";`);
  });
  
  // Check for @kyselyType imports
  model.fields.forEach(field => {
    if (field.documentation) {
      const typeOverride = field.documentation.match(/@kyselyType\((.+)\)/);
      if (typeOverride) {
        // Handle union types by extracting all imports
        const unionTypes = typeOverride[1].split('|').map(t => t.trim());
        const importMap = new Map<string, Set<string>>(); // path -> schema names
        
        unionTypes.forEach(type => {
          const match = type.match(/import\(['"]([^'"]+)['"]\)\.(\w+)/);
          if (match) {
            const [, importPath, typeName] = match;
            const schemaName = `${typeName}Schema`;
            
            if (!importMap.has(importPath)) {
              importMap.set(importPath, new Set());
            }
            importMap.get(importPath)!.add(schemaName);
          }
        });
        
        // Generate imports grouped by path
        importMap.forEach((schemas, path) => {
          const importStatement = `import { ${Array.from(schemas).join(', ')} } from "${path}";`;
          imports.add(importStatement);
        });
      }
    }
  });
  
  // Write JSDoc for the model if present
  if (model.documentation) {
    writer.writeLine("/**");
    model.documentation.split("\n").forEach(line => {
      writer.writeLine(` * ${line.trim()}`);
    });
    writer.writeLine(" */");
  }
  
  // Write the schema export
  const schemaName = `${model.name}Schema`;
  writer.write(`export const ${schemaName} = z.object({`);
  writer.newLine();
  writer.indent(() => {
    // Process all fields except relations and unsupported
    model.fields
      .filter(field => field.kind !== "object" && field.kind !== "unsupported")
      .forEach(field => {
        const dbName = typeof field.dbName === "string" ? field.dbName : null;
        
        generateZodField(
          {
            name: normalizeCase(dbName || field.name, config),
            type: field.type,
            kind: field.kind,
            nullable: !field.isRequired,
            list: field.isList,
            documentation: field.documentation,
            config,
            hasDefaultValue: field.hasDefaultValue,
            default: field.default,
          },
          writer
        );
        writer.newLine();
      });
  });
  writer.write("});");
  writer.newLine();
  writer.newLine();
  
  // Type inference is available via z.infer<typeof ${schemaName}> when needed
  // No duplicate type export needed - types.ts already exports the Kysely type
  
  return {
    modelName: model.name,
    schemaName,
    content: writer.toString(),
    imports,
  };
};