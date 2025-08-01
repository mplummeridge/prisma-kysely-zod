/**
 * Phase 4: Three-Layer Architecture Generator
 * 
 * Generates three layers of Zod schemas:
 * 1. Database Layer: Raw types as stored in DB (e.g., dates as strings)
 * 2. Runtime Layer: Parsed types for application use (e.g., Date objects)
 * 3. API Layer: Serializable types for JSON APIs
 * 
 * Uses schema composition and field-level transformations for type safety.
 */

import { DMMF } from "@prisma/generator-helper";
import CodeBlockWriter from "code-block-writer";
import path from "path";
import { writeFile, ensureDir, emptyDir } from "fs-extra";
import { normalizeCase } from "../utils/normalizeCase";
import type { Config } from "../utils/validateConfig";

interface LayerConfig {
  name: string;
  suffix: string;
  description: string;
  fieldTransforms: (field: DMMF.Field) => string | null;
}

export class ThreeLayerSchemaGenerator {
  private generatedSchemas: Map<string, string[]> = new Map();
  
  private layers: LayerConfig[] = [
    {
      name: "Database",
      suffix: "DB",
      description: "Raw database types (as stored)",
      fieldTransforms: (field: DMMF.Field) => {
        // For DB layer, we need to match SQLite storage types
        // but we'll handle this through schema composition instead
        return null; // Base schema already has correct DB types
      }
    },
    {
      name: "Runtime", 
      suffix: "Runtime",
      description: "Runtime types (parsed for application use)",
      fieldTransforms: (field: DMMF.Field) => {
        switch (field.type) {
          
          case 'Boolean':
            // SQLite stores booleans as 0/1 in the database
            // But our Zod schemas use boolean, so no transformation needed
            return null;
          case 'BigInt':
            return `z.number().transform(val => BigInt(val))`;
          default:
            return null; // No transformation needed
        }
      }
    },
    {
      name: "API",
      suffix: "API", 
      description: "API types (JSON-serializable)",
      fieldTransforms: (field: DMMF.Field) => {
        switch (field.type) {
          
          case 'BigInt':
            return `z.bigint().transform(val => val.toString())`;
          case 'Decimal':
            return `z.number().transform(val => val.toString())`;
          default:
            return null; // No transformation needed
        }
      }
    }
  ];

  constructor(
    private dmmf: DMMF.Document,
    private outputDir: string,
    private brandRegistryPath?: string,
    private config?: Config
  ) {}

  async generate(): Promise<void> {
    // Clean the output directory to remove stale files
    await ensureDir(this.outputDir);
    await emptyDir(this.outputDir);
    
    // Generate schemas for each model
    for (const model of this.dmmf.datamodel.models) {
      await this.generateModelSchemas(model);
    }

    // Generate transformation utilities
    await this.generateTransformUtils();
    
    // Generate index file
    await this.generateIndexFile();
  }

  private async generateModelSchemas(model: DMMF.Model): Promise<void> {
    const writer = new CodeBlockWriter();
    
    // File header
    writer.writeLine('/**');
    writer.writeLine(` * Three-Layer Schemas for ${model.name}`);
    writer.writeLine(' * ');
    writer.writeLine(' * Provides database, runtime, and API schemas with transformations.');
    writer.writeLine(' */');
    writer.writeLine('');
    writer.writeLine('import { z } from "zod/v4";');
    writer.writeLine(`import { ${model.name}Schema } from '../schemas';`);
    
    if (this.brandRegistryPath) {
      writer.writeLine(`import * as brands from '${this.brandRegistryPath}';`);
    }
    
    writer.writeLine('');

    // Generate each layer using composition
    for (const layer of this.layers) {
      this.generateLayerSchemaWithComposition(writer, model, layer);
      writer.writeLine('');
    }

    // Generate direct transformation functions instead of pipes
    this.generateTransformFunctions(writer, model);

    // Write file
    const outputPath = path.join(this.outputDir, `${model.name.toLowerCase()}.schemas.ts`);
    await ensureDir(this.outputDir);
    await writeFile(outputPath, writer.toString());
    
    // Track generated schemas for index generation
    const exports = [
      `${model.name}DBSchema`,
      `${model.name}RuntimeSchema`,
      `${model.name}APISchema`,
      `${model.name}DB`,
      `${model.name}Runtime`,
      `${model.name}API`,
      `${model.name.toLowerCase()}DBToRuntime`,
      `${model.name.toLowerCase()}RuntimeToAPI`,
      `${model.name.toLowerCase()}DBToAPI`
    ];
    this.generatedSchemas.set(model.name, exports);
  }

  private generateLayerSchemaWithComposition(
    writer: CodeBlockWriter,
    model: DMMF.Model,
    layer: LayerConfig
  ): void {
    // Schema comment
    writer.writeLine('/**');
    writer.writeLine(` * ${layer.description}`);
    writer.writeLine(' */');
    
    // Collect fields that need transformation
    const fieldsToTransform: Array<{ field: DMMF.Field; transform: string }> = [];
    
    for (const field of model.fields) {
      if (field.kind === 'object') continue; // Skip relations
      
      const transform = layer.fieldTransforms(field);
      if (transform) {
        fieldsToTransform.push({ field, transform });
      }
    }
    
    if (layer.name === "Database") {
      // DB layer is just the base schema (already has correct types for SQLite)
      writer.writeLine(`export const ${model.name}${layer.suffix}Schema = ${model.name}Schema;`);
    } else if (fieldsToTransform.length > 0) {
      // Use .extend() to override specific fields with transformations
      writer.writeLine(`export const ${model.name}${layer.suffix}Schema = ${model.name}Schema.extend({`);
      writer.indent(() => {
        for (const { field, transform } of fieldsToTransform) {
          const fieldName = this.config ? normalizeCase(field.dbName || field.name, this.config) : (field.dbName || field.name);
          writer.write(`${fieldName}: `);
          
          // For Runtime layer, check if field has a brand
          if (layer.name === "Runtime" && this.extractBrandFromDocs(field.documentation)) {
            const brandName = this.extractBrandFromDocs(field.documentation);
            writer.write(`${model.name}Schema.shape.${fieldName}.pipe(${transform})`);
            if (brandName) {
              writer.write(`.pipe(z.any().transform(val => val as brands.${brandName}))`);
            }
          } else {
            writer.write(`${model.name}Schema.shape.${fieldName}`);
            if (!field.isRequired) {
              writer.write(`.unwrap()`); // Unwrap nullable/optional
            }
            writer.write(`.pipe(${transform})`);
            if (!field.isRequired) {
              writer.write(`.nullable()`); // Re-apply nullable
            }
          }
          
          writer.writeLine(',');
        }
      });
      writer.writeLine('});');
    } else {
      // No transformations needed, just use base schema
      writer.writeLine(`export const ${model.name}${layer.suffix}Schema = ${model.name}Schema;`);
    }
    
    writer.writeLine('');
    
    // Type export
    writer.writeLine(`export type ${model.name}${layer.suffix} = z.infer<typeof ${model.name}${layer.suffix}Schema>;`);
  }


  private extractBrandFromDocs(documentation?: string): string | null {
    if (!documentation) return null;
    
    const brandMatch = documentation.match(/@zod\..*\.brand\(["']([^"']+)["']\)/);
    return brandMatch ? brandMatch[1] : null;
  }

  private generateTransformFunctions(writer: CodeBlockWriter, model: DMMF.Model): void {
    writer.writeLine('// Transformation Functions');
    writer.writeLine('');

    // DB to Runtime
    writer.writeLine('/**');
    writer.writeLine(' * Transform from database representation to runtime objects');
    writer.writeLine(' */');
    writer.writeLine(`export function ${model.name.toLowerCase()}DBToRuntime(data: ${model.name}DB): ${model.name}Runtime {`);
    writer.indent(() => {
      writer.writeLine(`return ${model.name}RuntimeSchema.parse(data);`);
    });
    writer.writeLine('}');
    writer.writeLine('');

    // Runtime to API
    writer.writeLine('/**');
    writer.writeLine(' * Transform from runtime objects to API representation');
    writer.writeLine(' */');
    writer.writeLine(`export function ${model.name.toLowerCase()}RuntimeToAPI(data: ${model.name}Runtime): ${model.name}API {`);
    writer.indent(() => {
      writer.writeLine(`return ${model.name}APISchema.parse(data);`);
    });
    writer.writeLine('}');
    writer.writeLine('');

    // Complete transformation
    writer.writeLine('/**');
    writer.writeLine(' * Complete transformation from DB to API');
    writer.writeLine(' */');
    writer.writeLine(`export function ${model.name.toLowerCase()}DBToAPI(data: ${model.name}DB): ${model.name}API {`);
    writer.indent(() => {
      writer.writeLine(`const runtime = ${model.name.toLowerCase()}DBToRuntime(data);`);
      writer.writeLine(`return ${model.name.toLowerCase()}RuntimeToAPI(runtime);`);
    });
    writer.writeLine('}');
  }

  private async generateTransformUtils(): Promise<void> {
    const writer = new CodeBlockWriter();

    writer.writeLine('/**');
    writer.writeLine(' * Transformation Utilities');
    writer.writeLine(' * ');
    writer.writeLine(' * Helper functions for transforming between schema layers.');
    writer.writeLine(' */');
    writer.writeLine('');
    writer.writeLine('import { z } from "zod/v4";');
    writer.writeLine('');

    // Transform helpers
    writer.writeLine('/**');
    writer.writeLine(' * SQLite boolean transformer (0/1 to boolean)');
    writer.writeLine(' */');
    writer.writeLine('export const sqliteBoolean = z');
    writer.writeLine('  .number()');
    writer.writeLine('  .transform((val) => val === 1)');
    writer.writeLine('  .pipe(z.boolean());');
    writer.writeLine('');

    writer.writeLine('/**');
    writer.writeLine(' * SQLite datetime transformer (string to Date)');
    writer.writeLine(' */');
    writer.writeLine('export const sqliteDateTime = z');
    writer.writeLine('  .string()');
    writer.writeLine('  .transform((val) => new Date(val))');
    writer.writeLine('  .pipe(z.date());');
    writer.writeLine('');

    writer.writeLine('/**');
    writer.writeLine(' * API datetime transformer (Date to ISO string)');
    writer.writeLine(' */');
    writer.writeLine('export const apiDateTime = z');
    writer.writeLine('  .date()');
    writer.writeLine('  .transform((val) => val.toISOString())');
    writer.writeLine('  .pipe(z.string().datetime());');

    const outputPath = path.join(this.outputDir, 'transform-utils.ts');
    await writeFile(outputPath, writer.toString());
  }
  
  private async generateIndexFile(): Promise<void> {
    const writer = new CodeBlockWriter();
    
    writer.writeLine('/**');
    writer.writeLine(' * Three-Layer Schemas Index');
    writer.writeLine(' * ');
    writer.writeLine(' * Re-exports all three-layer schemas and transformation functions.');
    writer.writeLine(' */');
    writer.writeLine('');
    
    // Sort models for consistent output
    const sortedModels = Array.from(this.generatedSchemas.keys()).sort();
    
    for (const modelName of sortedModels) {
      writer.writeLine(`export * from './${modelName.toLowerCase()}.schemas';`);
    }
    
    // Export utilities
    writer.writeLine(`export * from './transform-utils';`);
    
    const indexPath = path.join(this.outputDir, 'index.ts');
    await writeFile(indexPath, writer.toString());
  }
}