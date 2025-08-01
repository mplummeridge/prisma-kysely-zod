import CodeBlockWriter from "code-block-writer";
import { getZodMethodForPrismaType } from "./generateZodFieldType";
import { generateTypeOverrideFromDocumentation } from "./generateTypeOverrideFromDocumentation";
import { parseZodAnnotations, buildValidationChain } from "./parseZodAnnotations";
import type { Config } from "~/utils/validateConfig";

type GenerateZodFieldArgs = {
  name: string;
  type: string;
  kind: string;
  nullable: boolean;
  list: boolean;
  documentation?: string;
  config: Config;
  hasDefaultValue?: boolean;
  default?: any; // DMMF default value object
};

export const generateZodField = (
  args: GenerateZodFieldArgs,
  writer: CodeBlockWriter
): void => {
  const { name, type, kind, nullable, list, documentation, config, hasDefaultValue, default: defaultValue } = args;
  
  // Check for @kyselyType override in documentation
  const typeOverride = documentation
    ? generateTypeOverrideFromDocumentation(documentation)
    : null;
  
  // Parse @zod annotations using the new parser
  const zodAnnotation = parseZodAnnotations(documentation);
  
  // Write JSDoc comment if present
  if (documentation) {
    const cleanedDoc = documentation
      .replace(/@kyselyType\([^)]+\)/g, "") // Remove @kyselyType annotations
      .replace(/^\/\/\/ @zod\..+$/gm, "") // Remove @zod annotations (line by line)
      .split('\n')
      .filter(line => line.trim())
      .join('\n')
      .trim();
    
    if (cleanedDoc) {
      writer.writeLine(`/**`);
      cleanedDoc.split("\n").forEach(line => {
        writer.writeLine(` * ${line.trim()}`);
      });
      writer.writeLine(` */`);
    }
  }
  
  // Start the field definition
  writer.write(`${name}: `);
  
  // Handle different field types
  if (typeOverride) {
    // For @kyselyType fields, use z.preprocess for JSON parsing
    // Handle union types by extracting all types
    const unionTypes = typeOverride.split('|').map(t => t.trim());
    
    if (unionTypes.length > 1) {
      // For union types, we need to handle each schema
      const schemas: string[] = [];
      unionTypes.forEach(type => {
        const match = type.match(/import\(['"]([^'"]+)['"]\)\.(\w+)/);
        if (match) {
          const [, , typeName] = match;
          schemas.push(`${typeName}Schema`);
        } else if (type === 'null') {
          // Handle null in union - will be added with .nullable()
        } else {
          // Handle other types like Record<string, unknown>
          // For now, skip them
        }
      });
      
      if (schemas.length > 0) {
        // Create a union with preprocess for JSON parsing
        writer.write(`z.preprocess((val) => {
    if (typeof val === 'string') {
      try { return JSON.parse(val); } catch { return val; }
    }
    return val;
  }, `);
        
        if (schemas.length === 1) {
          writer.write(schemas[0]);
        } else {
          writer.write(`z.union([${schemas.join(', ')}])`);
        }
        
        writer.write(`)`);
      } else {
        writer.write(`z.unknown()`);
      }
    } else {
      // Single type - extract the schema name
      const singleTypeMatch = typeOverride.match(/import\(['"]([^'"]+)['"]\)\.(\w+)/);
      if (singleTypeMatch) {
        const [, , typeName] = singleTypeMatch;
        const schemaName = `${typeName}Schema`;
        
        // Use preprocess for cleaner JSON parsing
        writer.write(`z.preprocess((val) => {
    if (typeof val === 'string') {
      try { return JSON.parse(val); } catch { return val; }
    }
    return val;
  }, ${schemaName})`);
      } else {
        writer.write(`z.string()`);
      }
    }
  } else if (kind === "enum") {
    // Handle enum types
    writer.write(`z.nativeEnum(${type})`);
  } else if (kind === "scalar") {
    // Check if we have top-level validators that should replace the base type
    const hasTopLevelValidator = zodAnnotation?.validators.some(v => 
      /^\.(string|number|boolean|bigint|date|enum|cuid|cuid2|uuid|email|url|datetime|ulid|emoji|base64|ipv4|ipv6)\(/.test(v)
    );
    
    if (hasTopLevelValidator) {
      // For top-level validators, use them directly instead of base type
      let hasWrittenBase = false;
      
      zodAnnotation?.validators.forEach((validator, index) => {
        if (/^\.(string|number|boolean|bigint|date|enum|cuid|cuid2|uuid|email|url|datetime|ulid|emoji|base64|ipv4|ipv6)\(/.test(validator)) {
          // This is a top-level validator - use z.validatorName() instead of z.string().validatorName()
          const match = validator.match(/^\.(\w+)\((.*)\)$/);
          if (match) {
            const [, validatorName, args] = match;
            if (!hasWrittenBase) {
              writer.write(`z.${validatorName}(${args})`);
              hasWrittenBase = true;
            }
          }
        } else if (hasWrittenBase) {
          // This is a chainable validator - append it
          // Replace .nullable() with .nullish() for D1/SQLite compatibility
          const processedValidator = validator.replace(/\.nullable\(\)/g, '.nullish()');
          writer.write(processedValidator);
        }
      });
      
      // If we didn't write anything (shouldn't happen), fallback to base type
      if (!hasWrittenBase) {
        writer.write(getZodMethodForPrismaType(type, config));
      }
    } else {
      // No top-level validators, use standard flow
      writer.write(getZodMethodForPrismaType(type, config));
      
      // Add default validators based on field characteristics (if enabled)
      if (config.useDefaultValidators) {
        if (type === "String") {
          // Check for CUID default (but not if already in validation chain)
          if (hasDefaultValue && defaultValue && typeof defaultValue === "object" && defaultValue.name === "cuid") {
            const hasCuidValidator = zodAnnotation?.validators.some(v => v.includes('.cuid2()'));
            if (!hasCuidValidator) {
              writer.write(".cuid2()");
            }
          }
          // Check for UUID default (but not if already in validation chain)
          else if (hasDefaultValue && defaultValue && typeof defaultValue === "object" && defaultValue.name === "uuid") {
            const hasUuidValidator = zodAnnotation?.validators.some(v => v.includes('.uuid()'));
            if (!hasUuidValidator) {
              writer.write(".uuid()");
            }
          }
        }
        // Always add .int() for Int fields when default validators are enabled
        // (unless it's already in the validation chain)
        else if (type === "Int") {
          const hasIntValidator = zodAnnotation?.validators.some(v => v.includes('.int()'));
          if (!hasIntValidator) {
            writer.write(".int()");
          }
        }
      }
      
      // Apply @zod validations if present (for chainable validators)
      if (zodAnnotation) {
        const chainableValidators = zodAnnotation.validators.filter(v => 
          !/^\.(string|number|boolean|bigint|date|enum|cuid|cuid2|uuid|email|url|datetime|ulid|emoji|base64|ipv4|ipv6)\(/.test(v)
        );
        
        if (chainableValidators.length > 0) {
          // Replace .nullable() with .nullish() to handle D1/SQLite undefined values
          const processedValidators = chainableValidators.map(v => 
            v.replace(/\.nullable\(\)/g, '.nullish()')
          );
          writer.write(processedValidators.join(''));
        }
      }
    }
  } else {
    // Fallback for unknown types
    writer.write(`z.unknown()`);
  }
  
  // Handle arrays
  if (list) {
    writer.write(`.array()`);
  }
  
  // Handle nullable fields
  // Check if nullable() is already in the validation chain from annotations
  const hasNullableInChain = zodAnnotation?.validators.some(v => v.includes('.nullable()') || v.includes('.nullish()'));
  if (nullable && !hasNullableInChain) {
    // Use .nullish() instead of .nullable() to handle both null and undefined
    // This is needed because Kysely with D1/SQLite returns undefined for NULL values
    writer.write(`.nullish()`);
  }
  
  // Add description last (after nullable) for proper ordering
  if (zodAnnotation?.description) {
    // Escape the description for JavaScript string literal
    const escapedDescription = zodAnnotation.description
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    writer.write(`.describe("${escapedDescription}")`);
  }
  
  writer.write(",");
};