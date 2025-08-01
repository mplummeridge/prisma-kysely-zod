/**
 * Phase 5: CRUD Schema Generator
 * 
 * Generates CRUD operation schemas (Create, Update, List, Get, Delete) for each model.
 * Builds on top of the three-layer architecture and uses the brand registry for typed IDs.
 * 
 * Features:
 * - Automatic field omission for Create (id, timestamps)
 * - Partial updates with at least one field requirement
 * - List operations with filtering, sorting, and pagination
 * - Type-safe ID fields using brands
 * - Configurable per-model and per-operation
 */

import { DMMF } from "@prisma/generator-helper";
import CodeBlockWriter from "code-block-writer";
import path from "path";
import { writeFile, ensureDir, emptyDir } from "fs-extra";
import { Config } from "../utils/validateConfig";
import { normalizeCase } from "../utils/normalizeCase";

// Default fields to omit in create operations
const DEFAULT_CREATE_OMIT_FIELDS = ['id', 'createdAt', 'updatedAt', 'created_at', 'updated_at'];

// Default fields that can be used for sorting
const DEFAULT_SORTABLE_FIELDS = ['createdAt', 'updatedAt', 'name', 'title'];

interface CrudConfig {
  outputDir?: string;
  includeModels?: string[];
  excludeModels?: string[];
  paginationStrategy?: 'offset' | 'cursor' | 'both';
  maxPageSize?: number;
  generateIndex?: boolean;
}

// Annotation types for business logic
interface CrudAnnotations {
  model?: {
    create?: {
      omit?: string[];
      defaults?: Record<string, any>;
      validations?: Record<string, any>;
      refine?: string;
    };
    update?: {
      omit?: string[];
      immutable?: string[];
      refine?: string;
    };
    list?: {
      filters?: {
        standard?: string[];
        custom?: string[];
        json?: Record<string, string>[];
        customTypes?: Record<string, string>; // Add custom filter type definitions
      };
      orderBy?: string[];
      defaultOrder?: string;
      maxPageSize?: number;
      pagination?: 'offset' | 'cursor' | 'both';
    };
    enums?: Record<string, string[]>;
    orgScoped?: boolean; // Add organization scoping flag
  };
  fields?: Record<string, {
    default?: any;
    min?: number;
    max?: number;
    pattern?: string;
    describe?: string;
    omitFrom?: string[];
  }>;
}

export class CrudSchemaGenerator {
  private config: CrudConfig;
  private generatedSchemas: Map<string, string[]> = new Map();
  private modelAnnotations: Map<string, CrudAnnotations> = new Map();

  constructor(
    private dmmf: DMMF.Document,
    private outputDir: string,
    private baseConfig?: Config,
    crudConfig?: CrudConfig
  ) {
    this.config = {
      outputDir: 'crud',
      paginationStrategy: 'offset',
      maxPageSize: 100,
      generateIndex: true,
      ...crudConfig
    };
  }

  async generate(): Promise<void> {
    // Parse annotations from all models first
    this.parseAllAnnotations();
    
    // Clean the output directory to remove stale files
    await ensureDir(this.outputDir);
    await emptyDir(this.outputDir);

    // Generate schemas for each model
    for (const model of this.dmmf.datamodel.models) {
      // Skip if model is excluded
      if (this.shouldSkipModel(model.name)) {
        continue;
      }

      await this.generateModelCrudSchemas(model);
    }

    // Generate index file if configured
    if (this.config.generateIndex) {
      await this.generateIndexFile();
    }
  }

  private parseAllAnnotations(): void {
    for (const model of this.dmmf.datamodel.models) {
      const annotations = this.parseModelAnnotations(model);
      if (annotations) {
        this.modelAnnotations.set(model.name, annotations);
        
        // Debug logging for Persona model
        if (model.name === 'Persona') {
          console.log('DEBUG: Persona annotations:', JSON.stringify(annotations, null, 2));
        }
      }
    }
  }

  private parseModelAnnotations(model: DMMF.Model): CrudAnnotations {
    const annotations: CrudAnnotations = {
      model: {},
      fields: {}
    };

    // Parse model-level documentation for @crud annotations
    if (model.documentation) {
      const modelDoc = model.documentation;
      
      // Parse @crud.create.* annotations
      const createOmit = this.parseAnnotation(modelDoc, '@crud.create.omit', 'array');
      const createDefaults = this.parseAnnotation(modelDoc, '@crud.create.defaults', 'json');
      const createRefine = this.parseAnnotation(modelDoc, '@crud.create.refine', 'string');
      
      if (createOmit || createDefaults || createRefine) {
        annotations.model!.create = {
          omit: createOmit,
          defaults: createDefaults,
          refine: createRefine
        };
      }

      // Parse @crud.update.* annotations
      const updateOmit = this.parseAnnotation(modelDoc, '@crud.update.omit', 'array');
      const updateImmutable = this.parseAnnotation(modelDoc, '@crud.update.immutable', 'array');
      const updateRefine = this.parseAnnotation(modelDoc, '@crud.update.refine', 'string');
      
      if (updateOmit || updateImmutable || updateRefine) {
        annotations.model!.update = {
          omit: updateOmit,
          immutable: updateImmutable,
          refine: updateRefine
        };
      }

      // Parse @crud.list.* annotations
      const listFilters = this.parseListFilters(modelDoc);
      const listOrderBy = this.parseAnnotation(modelDoc, '@crud.list.orderBy', 'array');
      const listDefaultOrder = this.parseAnnotation(modelDoc, '@crud.list.defaultOrder', 'string');
      const listMaxPageSize = this.parseAnnotation(modelDoc, '@crud.list.maxPageSize', 'number');
      const listPagination = this.parseAnnotation(modelDoc, '@crud.list.pagination', 'string');
      
      if (listFilters || listOrderBy || listDefaultOrder || listMaxPageSize || listPagination) {
        annotations.model!.list = {
          filters: listFilters,
          orderBy: listOrderBy,
          defaultOrder: listDefaultOrder,
          maxPageSize: listMaxPageSize,
          pagination: listPagination as any
        };
      }

      // Parse @crud.enum.* annotations for custom enums
      const enumAnnotations = this.parseEnumAnnotations(modelDoc);
      if (enumAnnotations) {
        annotations.model!.enums = enumAnnotations;
      }
      
      // Parse @crud.orgScoped annotation
      const orgScoped = this.parseAnnotation(modelDoc, '@crud.orgScoped', 'string');
      if (orgScoped === 'true') {
        annotations.model!.orgScoped = true;
      }
    }

    // Parse field-level annotations
    for (const field of model.fields) {
      if (field.documentation) {
        const fieldAnnotations = this.parseFieldAnnotations(field.documentation);
        if (fieldAnnotations) {
          annotations.fields![field.name] = fieldAnnotations;
        }
      }
    }

    return annotations;
  }

  private parseAnnotation(doc: string, key: string, type: 'string' | 'number' | 'array' | 'json'): any {
    // For JSON type, we need to handle nested parentheses and quotes
    if (type === 'json') {
      // Find the start of the annotation
      const startIndex = doc.indexOf(`${key}(`);
      if (startIndex === -1) return null;
      
      // Find the matching closing parenthesis
      let depth = 0;
      let inString: string | false = false;
      let escapeNext = false;
      let i = startIndex + key.length + 1;
      const endIndex = doc.length;
      
      for (; i < endIndex; i++) {
        const char = doc[i];
        
        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        
        if (char === '\\') {
          escapeNext = true;
          continue;
        }
        
        if ((char === '"' || char === "'") && !inString) {
          inString = char;
        } else if (char === inString) {
          inString = false;
        }
        
        if (!inString) {
          if (char === '(') depth++;
          else if (char === ')') {
            if (depth === 0) break;
            depth--;
          }
        }
      }
      
      const value = doc.substring(startIndex + key.length + 1, i);
      
      if (key === '@crud.list.customFilterTypes') {
        console.log('DEBUG: Found customFilterTypes raw value:', value);
      }
      
      try {
        return JSON.parse(value);
      } catch (e) {
        console.error('Failed to parse JSON:', value, e);
        return null;
      }
    }
    
    const regex = new RegExp(`${key}\\((.+?)\\)`, 'g');
    const match = regex.exec(doc);
    if (!match) return null;

    const value = match[1];
    
    if (key === '@crud.list.customFilterTypes') {
      console.log('DEBUG: Found customFilterTypes raw value:', value);
    }
    
    switch (type) {
      case 'string':
        return value.replace(/["']/g, '');
      case 'number':
        return parseInt(value, 10);
      case 'array':
        // Handle arrays with brackets like ["a", "b", "c"]
        const cleaned = value.replace(/^\[|\]$/g, '').trim();
        return cleaned.split(',').map(s => s.trim().replace(/["']/g, ''));
    }
  }

  private parseListFilters(doc: string): any {
    const filters: any = {};
    
    const standard = this.parseAnnotation(doc, '@crud.list.filters', 'array');
    if (standard) filters.standard = standard;
    
    const custom = this.parseAnnotation(doc, '@crud.list.customFilters', 'array');
    if (custom) filters.custom = custom;
    
    // Parse JSON filters
    const jsonFilterRegex = /@crud\.list\.jsonFilter\((.+?)\)/g;
    let match;
    const jsonFilters = [];
    while ((match = jsonFilterRegex.exec(doc)) !== null) {
      try {
        jsonFilters.push(JSON.parse(match[1]));
      } catch {}
    }
    if (jsonFilters.length > 0) filters.json = jsonFilters;
    
    // Parse custom filter types
    const customTypes = this.parseAnnotation(doc, '@crud.list.customFilterTypes', 'json');
    if (customTypes) filters.customTypes = customTypes;
    
    return Object.keys(filters).length > 0 ? filters : null;
  }

  private parseEnumAnnotations(doc: string): Record<string, string[]> | null {
    const enums: Record<string, string[]> = {};
    const enumRegex = /@crud\.enum\.([\w]+)\((.+?)\)/g;
    let match;
    
    while ((match = enumRegex.exec(doc)) !== null) {
      const enumName = match[1];
      // Parse the enum values as an array, handling JSON array format
      try {
        const parsedValues = JSON.parse(match[2]);
        if (Array.isArray(parsedValues)) {
          enums[enumName] = parsedValues;
        }
      } catch {
        // Fallback to simple comma-separated parsing
        const values = match[2].split(',').map(s => s.trim().replace(/["']/g, ''));
        enums[enumName] = values;
      }
    }
    
    return Object.keys(enums).length > 0 ? enums : null;
  }

  private parseFieldAnnotations(doc: string): any {
    const annotations: any = {};
    
    const defaultValue = this.parseAnnotation(doc, '@crud.default', 'json');
    if (defaultValue !== null) annotations.default = defaultValue;
    
    const min = this.parseAnnotation(doc, '@crud.min', 'number');
    if (min !== null) annotations.min = min;
    
    const max = this.parseAnnotation(doc, '@crud.max', 'number');
    if (max !== null) annotations.max = max;
    
    const pattern = this.parseAnnotation(doc, '@crud.pattern', 'string');
    if (pattern) annotations.pattern = pattern;
    
    const describe = this.parseAnnotation(doc, '@crud.describe', 'string');
    if (describe) annotations.describe = describe;
    
    const omitFrom = this.parseAnnotation(doc, '@crud.omit', 'array');
    if (omitFrom) annotations.omitFrom = omitFrom;
    
    return Object.keys(annotations).length > 0 ? annotations : null;
  }

  private shouldSkipModel(modelName: string): boolean {
    const { includeModels, excludeModels } = this.config;
    
    if (includeModels && includeModels.length > 0) {
      return !includeModels.includes(modelName);
    }
    
    if (excludeModels && excludeModels.length > 0) {
      return excludeModels.includes(modelName);
    }
    
    return false;
  }

  private async generateModelCrudSchemas(model: DMMF.Model): Promise<void> {
    const writer = new CodeBlockWriter();
    const schemas: string[] = [];
    const annotations = this.modelAnnotations.get(model.name) || { model: {}, fields: {} };

    // File header
    writer.writeLine('/**');
    writer.writeLine(` * CRUD Schemas for ${model.name}`);
    writer.writeLine(' * ');
    writer.writeLine(' * Auto-generated schemas for Create, Update, List, Get, and Delete operations.');
    writer.writeLine(' */');
    writer.writeLine('');
    writer.writeLine('import { z } from "zod/v4";');
    
    // Import brands if available
    if (this.baseConfig?.generateBrandRegistry) {
      writer.writeLine(`import * as brands from '../brands';`);
    }
    
    // Always import base schema for composition
    writer.writeLine(`import { ${model.name}Schema } from '../schemas';`);
    
    // Import any custom JSON schemas if needed
    const hasJsonFields = model.fields.some(f => f.type === 'Json');
    if (hasJsonFields) {
      writer.writeLine('// Import JSON field schemas as needed');
      writer.writeLine('// TODO: Configure JSON schema imports via annotations');
    }
    
    writer.writeLine('');
    
    // Generate enums if defined in annotations
    if (annotations.model?.enums || annotations.model?.list?.filters?.customTypes) {
      this.generateEnums(writer, annotations.model.enums || {}, annotations);
      writer.writeLine('');
    }

    // Generate each CRUD schema
    this.generateCreateSchema(writer, model, schemas);
    writer.writeLine('');
    
    this.generateUpdateSchema(writer, model, schemas);
    writer.writeLine('');
    
    this.generateListSchema(writer, model, schemas);
    writer.writeLine('');
    
    this.generateGetSchema(writer, model, schemas);
    writer.writeLine('');
    
    this.generateDeleteSchema(writer, model, schemas);

    // Write file
    const fileName = `${model.name}.schema.ts`;
    const filePath = path.join(this.outputDir, fileName);
    await writeFile(filePath, writer.toString());

    // Store for index generation
    this.generatedSchemas.set(model.name, schemas);
  }

  private shouldOmitFieldInCreate(field: DMMF.Field, model: DMMF.Model): boolean {
    const annotations = this.modelAnnotations.get(model.name);
    
    // Check field-level @crud.omit annotation
    if (annotations?.fields?.[field.name]?.omitFrom?.includes('create')) {
      return true;
    }
    
    // Check model-level @crud.create.omit annotation
    if (annotations?.model?.create?.omit?.includes(field.name)) {
      return true;
    }
    
    // Default omission rules
    // Omit relation fields (not scalar foreign keys)
    if (field.kind === 'object') return true;
    
    // Omit ID fields (usually auto-generated)
    if (field.isId && field.hasDefaultValue) return true;
    
    // Omit fields marked with @updatedAt
    if (field.isUpdatedAt) return true;
    
    // Omit timestamp fields with @default(now())
    if (field.hasDefaultValue && field.default && 
        typeof field.default === 'object' && 
        'name' in field.default && 
        field.default.name === 'now') {
      return true;
    }
    
    // Check common timestamp field names as fallback
    const timestampFields = ['created_at', 'createdAt', 'updated_at', 'updatedAt'];
    const fieldName = normalizeCase(field.dbName || field.name, this.baseConfig!);
    if (timestampFields.includes(fieldName) && field.hasDefaultValue) {
      return true;
    }
    
    return false;
  }
  
  private generateEnums(writer: CodeBlockWriter, enums: Record<string, string[]>, annotations: CrudAnnotations): void {
    writer.writeLine('// Enum options exported for frontend use');
    writer.writeLine('// These match the validation in the base schema');
    for (const [enumName, values] of Object.entries(enums)) {
      // Export as const array for frontend dropdowns/selects
      const optionsName = enumName.replace(/Enum$/, 'Options');
      writer.writeLine(`export const ${optionsName} = [`);
      writer.indent(() => {
        values.forEach((value, index) => {
          writer.write(`"${value}"`);
          if (index < values.length - 1) writer.write(',');
          writer.writeLine('');
        });
      });
      writer.writeLine('] as const;');
      writer.writeLine('');
      
      // Also export the type
      writer.writeLine(`export type ${enumName.replace(/Enum$/, '')} = typeof ${optionsName}[number];`);
      writer.writeLine('');
    }
    
    // Export custom filter enums
    const customFilterTypes = annotations.model?.list?.filters?.customTypes;
    if (customFilterTypes) {
      for (const [filterName, typeDefinition] of Object.entries(customFilterTypes)) {
        // Extract enum values from type definition like "enum(['owned', 'subscribed', 'public', 'all'])"
        const enumMatch = typeDefinition.match(/enum\(\[([^\]]+)\]\)/);
        if (enumMatch) {
          const values = enumMatch[1].split(',').map(v => v.trim().replace(/['"]/g, ''));
          const optionsName = `${filterName.charAt(0).toUpperCase() + filterName.slice(1)}Options`;
          
          writer.writeLine(`// Custom filter options for ${filterName}`);
          writer.writeLine(`export const ${optionsName} = [`);
          writer.indent(() => {
            values.forEach((value, index) => {
              writer.write(`"${value}"`);
              if (index < values.length - 1) writer.write(',');
              writer.writeLine('');
            });
          });
          writer.writeLine('] as const;');
          writer.writeLine('');
          writer.writeLine(`export type ${filterName.charAt(0).toUpperCase() + filterName.slice(1)} = typeof ${optionsName}[number];`);
          writer.writeLine('');
        }
      }
    }
  }

  private generateCreateSchema(writer: CodeBlockWriter, model: DMMF.Model, schemas: string[]): void {
    const schemaName = `Create${model.name}ArgsSchema`;
    schemas.push(schemaName);

    writer.writeLine('/**');
    writer.writeLine(` * Schema for creating a new ${model.name}`);
    writer.writeLine(' * ');
    writer.writeLine(' * Omits auto-generated fields: id, created_at, updated_at');
    writer.writeLine(' */');
    
    // If we have the runtime schema, use composition
    if (this.baseConfig?.generateThreeLayers) {
      // Determine which fields to omit
      // Only consider scalar fields since Kysely schemas don't include relation fields
      const fieldsToOmit: string[] = [];
      
      // Debug: Log all fields for Persona model
      if (model.name === 'Persona') {
        console.log(`DEBUG: Processing ${model.name} model with ${model.fields.length} fields:`);
        model.fields.forEach(field => {
          console.log(`  - ${field.name}: kind=${field.kind}, shouldOmit=${this.shouldOmitFieldInCreate(field, model)}`);
        });
      }
      
      for (const field of model.fields) {
        // Skip relation fields entirely - they don't exist in Kysely schemas
        if (field.kind === 'object') {
          if (model.name === 'Persona') {
            console.log(`  DEBUG: Skipping relation field: ${field.name}`);
          }
          continue;
        }
        
        if (this.shouldOmitFieldInCreate(field, model)) {
          if (model.name === 'Persona') {
            console.log(`  DEBUG: Adding scalar field to omit: ${field.name}`);
          }
          // Use the database column name if it has a @map directive, otherwise use field name
          const fieldName = field.dbName || field.name;
          fieldsToOmit.push(fieldName);
        }
      }
      
      if (model.name === 'Persona') {
        console.log(`DEBUG: Final fieldsToOmit for ${model.name}:`, fieldsToOmit);
      }
      
      const annotations = this.modelAnnotations.get(model.name);
      let baseSchema = model.name + 'Schema';
      
      // Start building the schema
      if (fieldsToOmit.length > 0) {
        writer.writeLine(`export const ${schemaName} = ${baseSchema}`);
        writer.indent(() => {
          writer.writeLine('.omit({');
          writer.indent(() => {
            fieldsToOmit.forEach(fieldName => {
              writer.writeLine(`${fieldName}: true,`);
            });
          });
          writer.writeLine('})');          
        });
      } else {
        writer.writeLine(`export const ${schemaName} = ${baseSchema}`);
      }
      
      // Apply field defaults from annotations
      const fieldsWithDefaults = model.fields.filter(f => 
        !this.shouldOmitFieldInCreate(f, model) && 
        (annotations?.fields?.[f.name]?.default !== undefined ||
         annotations?.model?.create?.defaults?.[f.name] !== undefined)
      );
      
      if (fieldsWithDefaults.length > 0 || annotations?.model?.create?.defaults) {
        writer.indent(() => {
          writer.writeLine('.extend({');
          writer.indent(() => {
            // Apply field-level defaults
            fieldsWithDefaults.forEach(field => {
              const fieldDefault = annotations?.fields?.[field.name]?.default ?? 
                                 annotations?.model?.create?.defaults?.[field.name];
              if (fieldDefault !== undefined) {
                const fieldName = normalizeCase(field.dbName || field.name, this.baseConfig!);
                writer.write(`${fieldName}: ${model.name}Schema.shape.${fieldName}`);
                if (typeof fieldDefault === 'string') {
                  writer.write(`.default("${fieldDefault}")`);
                } else if (typeof fieldDefault === 'number') {
                  writer.write(`.default(${fieldDefault})`);
                } else if (typeof fieldDefault === 'boolean') {
                  writer.write(`.default(${fieldDefault})`);
                } else if (fieldDefault === null) {
                  writer.write(`.nullable().default(null)`);
                } else {
                  writer.write(`.default(${JSON.stringify(fieldDefault)})`);
                }
                writer.writeLine(',');
              }
            });
            
            // Apply any global defaults from create.defaults
            const globalDefaults = annotations?.model?.create?.defaults || {};
            Object.entries(globalDefaults).forEach(([annotationFieldName, defaultValue]) => {
              if (!fieldsWithDefaults.find(f => f.name === annotationFieldName)) {
                const field = model.fields.find(f => f.name === annotationFieldName);
                if (field && !this.shouldOmitFieldInCreate(field, model)) {
                  const fieldName = normalizeCase(field.dbName || field.name, this.baseConfig!);
                  writer.write(`${fieldName}: ${model.name}Schema.shape.${fieldName}`);
                  if (typeof defaultValue === 'string') {
                    // Handle special cases like "now()"
                    if (defaultValue === 'now()') {
                      writer.write(`.default(() => new Date())`);
                    } else {
                      writer.write(`.default("${defaultValue}")`);
                    }
                  } else if (typeof defaultValue === 'boolean') {
                    writer.write(`.default(${defaultValue})`);
                  } else {
                    writer.write(`.default(${JSON.stringify(defaultValue)})`);
                  }
                  writer.writeLine(',');
                }
              }
            });
          });
          writer.writeLine('})');          
        });
      }
      
      // Apply create refine from annotations
      if (annotations?.model?.create?.refine) {
        writer.indent(() => {
          writer.writeLine(`.refine(`);
          writer.indent(() => {
            writer.writeLine(`(data) => {`);
            writer.indent(() => {
              writer.writeLine(`// Custom validation logic`);
              writer.writeLine(`// ${annotations.model!.create!.refine}`);
              writer.writeLine(`return true; // TODO: Implement validation`);
            });
            writer.writeLine(`},`);
            writer.writeLine(`{ message: "${annotations.model!.create!.refine}" }`);
          });
          writer.writeLine(`)`);
        });
      }
      
      writer.writeLine(';');
    } else {
      // Fallback to field-by-field generation if three-layer schemas aren't available
      writer.writeLine(`export const ${schemaName} = z.object({`);
      
      for (const field of model.fields) {
        if (this.shouldOmitFieldInCreate(field, model)) {
          continue;
        }
        
        writer.indent(() => {
          if (this.isForeignKeyField(field, model)) {
            const relationField = this.getRelationFieldForForeignKey(field, model);
            if (relationField) {
              writer.writeLine(`// Foreign key to ${relationField.type}`);
            }
          }
          
          this.generateFieldSchema(writer, field, model);
          writer.writeLine(',');
        });
      }
      
      writer.writeLine('});');
    }
    
    writer.writeLine('');
    writer.writeLine(`export type ${schemaName} = z.infer<typeof ${schemaName}>;`);
  }

  private generateUpdateSchema(writer: CodeBlockWriter, model: DMMF.Model, schemas: string[]): void {
    const schemaName = `Update${model.name}ArgsSchema`;
    schemas.push(schemaName);

    writer.writeLine('/**');
    writer.writeLine(` * Schema for updating a ${model.name}`);
    writer.writeLine(' * ');
    writer.writeLine(' * All fields are optional, but at least one must be provided');
    writer.writeLine(' */');
    
    const idField = model.fields.find(f => f.isId);
    
    if (this.baseConfig?.generateThreeLayers && idField) {
      const annotations = this.modelAnnotations.get(model.name);
      
      // Build list of fields to omit - only include fields that actually exist in the model
      const fieldsToOmit: string[] = [];
      
      // Check for timestamp fields (both naming conventions) that actually exist
      const timestampFields = ['created_at', 'createdAt', 'updated_at', 'updatedAt'];
      model.fields.forEach(field => {
        const fieldName = normalizeCase(field.dbName || field.name, this.baseConfig!);
        if (timestampFields.includes(fieldName)) {
          fieldsToOmit.push(fieldName);
        }
      });
      
      // Add annotation-defined omissions
      if (annotations?.model?.update?.omit) {
        fieldsToOmit.push(...annotations.model.update.omit);
      }
      
      // Add immutable fields from annotations
      if (annotations?.model?.update?.immutable) {
        fieldsToOmit.push(...annotations.model.update.immutable);
      }
      
      // Add field-level omissions
      model.fields.forEach(field => {
        if (annotations?.fields?.[field.name]?.omitFrom?.includes('update')) {
          const fieldName = normalizeCase(field.dbName || field.name, this.baseConfig!);
          fieldsToOmit.push(fieldName);
        }
      });
      
      // Remove duplicates
      const uniqueOmissions = [...new Set(fieldsToOmit)];
      
      writer.writeLine(`export const ${schemaName} = ${model.name}Schema`);
      writer.indent(() => {
        writer.writeLine(`.omit({`);
        writer.indent(() => {
          uniqueOmissions.forEach(fieldName => {
            writer.writeLine(`${fieldName}: true,`);
          });
        });
        writer.writeLine(`})`);
        writer.writeLine(`.partial()`);
        writer.writeLine(`.extend({`);
        writer.indent(() => {
          const idFieldName = normalizeCase(idField.dbName || idField.name, this.baseConfig!);
          writer.write(`${idFieldName}: `);
          const brandName = this.getBrandNameForField(idField, model);
          if (brandName && this.baseConfig?.generateBrandRegistry) {
            writer.write(`brands.${brandName}`);
          } else {
            writer.write(`${model.name}Schema.shape.${idFieldName}`);
          }
          writer.writeLine(',');
        });
        writer.writeLine(`})`);
        
        // Apply custom refine or use default
        const refineMessage = annotations?.model?.update?.refine || 
                            "At least one field must be provided for update";
        
        writer.writeLine(`.refine(`);
        writer.indent(() => {
          writer.writeLine(`(data) => {`);
          writer.indent(() => {
            const idFieldName = normalizeCase(idField.dbName || idField.name, this.baseConfig!);
            writer.writeLine(`const { ${idFieldName}, ...updateData } = data;`);
            writer.writeLine(`return Object.keys(updateData).length > 0;`);
          });
          writer.writeLine(`},`);
          writer.writeLine(`{ message: "${refineMessage}" }`);
        });
        writer.writeLine(`);`);
      });
    } else {
      // Fallback to field-by-field generation
      // Fallback without three-layer schemas
      const annotations = this.modelAnnotations.get(model.name);
      
      writer.writeLine(`export const ${schemaName} = z.object({`);
    
    // First, add the ID field as required
    const idField = model.fields.find(f => f.isId);
    if (idField) {
      writer.indent(() => {
        const idFieldName = normalizeCase(idField.dbName || idField.name, this.baseConfig!);
        writer.write(`${idFieldName}: `);
        const brandName = this.getBrandNameForField(idField, model);
        if (brandName && this.baseConfig?.generateBrandRegistry) {
          writer.write(`brands.${brandName}`);
        } else {
          writer.write('z.cuid2()');
        }
        writer.writeLine(',');
      });
    }
    
    // Generate optional fields for update
    for (const field of model.fields) {
      // Skip ID field (already added)
      if (field.isId) {
        continue;
      }
      
      // Skip auto-updated fields
      const fieldName = normalizeCase(field.dbName || field.name, this.baseConfig!);
      if (field.isUpdatedAt || fieldName === 'updated_at') {
        continue;
      }
      
      // Skip relation fields
      if (field.kind === 'object') {
        continue;
      }
      
      // Skip created timestamp
      if (fieldName === 'created_at' || fieldName === 'createdAt') {
        continue;
      }
      
      writer.indent(() => {
        this.generateFieldSchema(writer, field, model);
        // Force optional for updates
        if (field.isRequired) {
          writer.write('.optional()');
        }
        writer.writeLine(',');
      });
    }
    
      writer.writeLine('}).refine(');
      writer.writeLine('  (data) => {');
      if (idField) {
        const idFieldName = normalizeCase(idField.dbName || idField.name, this.baseConfig!);
        writer.writeLine(`    const { ${idFieldName}, ...updateData } = data;`);
        writer.writeLine('    return Object.keys(updateData).length > 0;');
      } else {
        // For models without a single ID field (composite keys), just check that at least one field is provided
        writer.writeLine('    return Object.keys(data).length > 0;');
      }
      writer.writeLine('  },');
      writer.writeLine('  { message: "At least one field must be provided for update" }');
      writer.writeLine(');');
    }
    writer.writeLine('');
    writer.writeLine(`export type ${schemaName} = z.infer<typeof ${schemaName}>;`);
  }

  private generateListSchema(writer: CodeBlockWriter, model: DMMF.Model, schemas: string[]): void {
    const schemaName = `List${model.name}sArgsSchema`;
    schemas.push(schemaName);
    const annotations = this.modelAnnotations.get(model.name);

    writer.writeLine('/**');
    writer.writeLine(` * Schema for listing ${model.name}s with filtering, sorting, and pagination`);
    writer.writeLine(' */');
    
    // Generate where schema if custom filters are defined
    if (annotations?.model?.list?.filters) {
      const whereSchemaName = `List${model.name}sWhereArgsSchema`;
      writer.writeLine(`export const ${whereSchemaName} = z.object({`);
      writer.indent(() => {
        // Standard filters from base schema
        const standardFilters = annotations.model!.list!.filters!.standard || [];
        standardFilters.forEach(fieldName => {
          const field = model.fields.find(f => f.name === fieldName);
          if (field) {
            // For filter fields, we need to handle nullable fields specially
            // A nullable field in a filter should accept the base type, null, or undefined
            const dbFieldName = normalizeCase(field.dbName || field.name, this.baseConfig!);
            if (!field.isRequired && field.kind === 'scalar') {
              // Field is nullable - for filters, null and undefined both mean "not filtered"
              // So we make the entire field optional (can be omitted from filter object)
              writer.writeLine(`${dbFieldName}: ${model.name}Schema.shape.${dbFieldName}.optional(),`);
            } else {
              // Required field - just make it optional for filtering
              writer.writeLine(`${dbFieldName}: ${model.name}Schema.shape.${dbFieldName}.optional(),`);
            }
          }
        });
        
        // Custom filters
        const customFilters = annotations.model!.list!.filters!.custom || [];
        const customTypes = annotations.model!.list!.filters!.customTypes || {};
        
        customFilters.forEach(filterName => {
          // Check if we have a custom type definition for this filter
          if (customTypes[filterName]) {
            // Custom type is a full Zod expression, use it directly
            writer.writeLine(`${filterName}: ${customTypes[filterName]},`);
          } 
          // Handle common patterns
          else if (filterName.endsWith('_contains')) {
            const fieldName = filterName.replace('_contains', '');
            writer.writeLine(`${filterName}: z.string().optional().describe("Filter by ${fieldName} containing text"),`);
          } else if (filterName.endsWith('_gte') || filterName.endsWith('_lte') || filterName.endsWith('_gt') || filterName.endsWith('_lt')) {
            // For timestamp filters, use string to allow ISO date strings
            writer.writeLine(`${filterName}: z.string().optional().describe("ISO date string for filtering"),`);
          } else {
            // Default to string if no custom type specified
            writer.writeLine(`${filterName}: z.string().optional(),`);
          }
        });
        
        // JSON filters
        if (annotations.model!.list!.filters!.json) {
          writer.writeLine('// JSON field filters');
          annotations.model!.list!.filters!.json!.forEach(jsonFilter => {
            writer.writeLine(`// TODO: Implement JSON filter for ${JSON.stringify(jsonFilter)}`);
          });
        }
      });
      writer.writeLine('}).optional();');
      writer.writeLine('');
    }
    
    writer.writeLine(`export const ${schemaName} = z.object({`);
    writer.indent(() => {
      // Use annotation-defined pagination or fall back to config
      const paginationStrategy = annotations?.model?.list?.pagination || this.config.paginationStrategy;
      const maxPageSize = annotations?.model?.list?.maxPageSize || this.config.maxPageSize;
      
      // Pagination based on strategy
      if (paginationStrategy === 'offset' || paginationStrategy === 'both') {
        writer.writeLine('// Offset-based pagination');
        writer.writeLine('offset: z.number().int().nonnegative().optional(),');
        writer.writeLine(`limit: z.number().int().positive().max(${maxPageSize}).optional(),`);
      }
      
      if (paginationStrategy === 'cursor' || paginationStrategy === 'both') {
        writer.writeLine('// Cursor-based pagination');
        writer.writeLine('cursor: z.cuid2().optional(),');
        writer.writeLine(`take: z.number().int().positive().max(${maxPageSize}).optional(),`);
      }
      
      // Sorting with annotation support
      writer.writeLine('// Sorting');
      if (annotations?.model?.list?.orderBy && annotations.model.list.orderBy.length > 0) {
        const sortOptions: string[] = [];
        annotations.model.list.orderBy.forEach(field => {
          sortOptions.push(`"${field}_asc"`, `"${field}_desc"`);
        });
        writer.writeLine(`orderBy: z.enum([${sortOptions.join(', ')}])`);
        if (annotations.model.list.defaultOrder) {
          writer.write(`.default("${annotations.model.list.defaultOrder}")`);
        }
        writer.writeLine('.optional(),');
      } else {
        writer.writeLine('sortBy: z.string().optional(),');
        writer.writeLine('sortOrder: z.enum(["asc", "desc"]).optional(),');
      }
      
      // Filtering
      writer.writeLine('// Filtering');
      if (annotations?.model?.list?.filters) {
        writer.writeLine(`where: List${model.name}sWhereArgsSchema,`);
      } else {
        writer.writeLine(`filters: ${model.name}Schema.partial().optional(),`);
      }
      
      // Organization scoping
      if (annotations?.model?.orgScoped) {
        writer.writeLine('// Organization scoping is enabled for this model');
        writer.writeLine('// Actions should filter by organization_id based on user context');
      }
    });
    
    writer.writeLine('});');
    writer.writeLine('');
    writer.writeLine(`export type ${schemaName} = z.infer<typeof ${schemaName}>;`);
  }

  private generateGetSchema(writer: CodeBlockWriter, model: DMMF.Model, schemas: string[]): void {
    const schemaName = `Get${model.name}ArgsSchema`;
    schemas.push(schemaName);

    writer.writeLine('/**');
    writer.writeLine(` * Schema for getting a single ${model.name} by ID`);
    writer.writeLine(' */');
    
    const idField = model.fields.find(f => f.isId);
    
    if (idField) {
      // Use schema composition
      const idFieldName = normalizeCase(idField.dbName || idField.name, this.baseConfig!);
      writer.writeLine(`export const ${schemaName} = ${model.name}Schema.pick({`);
      writer.writeLine(`  ${idFieldName}: true,`);
      writer.writeLine('});');
    } else {
      // No ID field found - create empty schema
      writer.writeLine(`export const ${schemaName} = z.object({});`);
    }
    
    writer.writeLine('');
    writer.writeLine(`export type ${schemaName} = z.infer<typeof ${schemaName}>;`);
  }

  private generateDeleteSchema(writer: CodeBlockWriter, model: DMMF.Model, schemas: string[]): void {
    const schemaName = `Delete${model.name}ArgsSchema`;
    schemas.push(schemaName);

    writer.writeLine('/**');
    writer.writeLine(` * Schema for deleting a ${model.name} by ID`);
    writer.writeLine(' */');
    
    const idField = model.fields.find(f => f.isId);
    
    if (idField) {
      // Use schema composition - same as Get
      const idFieldName = normalizeCase(idField.dbName || idField.name, this.baseConfig!);
      writer.writeLine(`export const ${schemaName} = ${model.name}Schema.pick({`);
      writer.writeLine(`  ${idFieldName}: true,`);
      writer.writeLine('});');
    } else {
      // No ID field found - create empty schema
      writer.writeLine(`export const ${schemaName} = z.object({});`);
    }
    
    writer.writeLine('');
    writer.writeLine(`export type ${schemaName} = z.infer<typeof ${schemaName}>;`);
  }

  private async generateIndexFile(): Promise<void> {
    const writer = new CodeBlockWriter();
    
    writer.writeLine('/**');
    writer.writeLine(' * CRUD Schemas Index');
    writer.writeLine(' * ');
    writer.writeLine(' * Re-exports all CRUD schemas for convenient access.');
    writer.writeLine(' */');
    writer.writeLine('');
    
    // Sort models for consistent output
    const sortedModels = Array.from(this.generatedSchemas.keys()).sort();
    
    for (const modelName of sortedModels) {
      writer.writeLine(`export * from './${modelName}.schema';`);
    }
    
    const indexPath = path.join(this.outputDir, 'index.ts');
    await writeFile(indexPath, writer.toString());
  }

  private generateFieldSchema(writer: CodeBlockWriter, field: DMMF.Field, model: DMMF.Model): void {
    const fieldName = normalizeCase(field.dbName || field.name, this.baseConfig!);
    writer.write(`${fieldName}: `);
    
    // Check if this field should use a branded type
    const brandName = this.getBrandNameForField(field, model);
    if (brandName && this.baseConfig?.generateBrandRegistry) {
      writer.write(`brands.${brandName}`);
    } else {
      // Generate base Zod type
      const zodType = this.getZodTypeForField(field);
      writer.write(zodType);
    }
    
    // Add optional modifier if field is not required
    if (!field.isRequired) {
      writer.write('.optional()');
    }
  }

  private isForeignKeyField(field: DMMF.Field, model: DMMF.Model): boolean {
    if (field.kind !== 'scalar') return false;
    
    return model.fields.some(f => 
      f.kind === 'object' && 
      f.relationFromFields?.includes(field.name)
    );
  }

  private getRelationFieldForForeignKey(field: DMMF.Field, model: DMMF.Model): DMMF.Field | null {
    if (field.kind !== 'scalar') return null;
    
    return model.fields.find(f => 
      f.kind === 'object' && 
      f.relationFromFields?.includes(field.name)
    ) || null;
  }

  private getBrandNameForField(field: DMMF.Field, model: DMMF.Model): string | null {
    // Check if field is an ID field
    if (field.isId) {
      return `${model.name}Id`;
    }
    
    // For scalar fields, check if they're foreign keys by finding the relation that uses them
    if (field.kind === 'scalar') {
      // Find any relation field that references this field in relationFromFields
      const relationField = model.fields.find(f => 
        f.kind === 'object' && 
        f.relationFromFields?.includes(field.name)
      );
      
      if (relationField) {
        // Use the type of the relation field to determine the brand
        return `${relationField.type}Id`;
      }
    }
    
    // Check documentation for explicit @zod.brand annotation
    if (field.documentation) {
      const brandMatch = field.documentation.match(/@zod\..*\.brand\(["']([^"']+)["']\)/);
      if (brandMatch) {
        return brandMatch[1];
      }
    }
    
    return null;
  }

  private getZodTypeForField(field: DMMF.Field): string {
    // Map Prisma types to Zod types
    const typeMap: Record<string, string> = {
      'String': 'z.string()',
      'Int': 'z.number().int()',
      'Float': 'z.number()',
      'Boolean': 'z.boolean()',
      'DateTime': 'z.string().datetime()',
      'Json': 'z.any()',
      'Bytes': 'z.instanceof(Buffer)',
      'Decimal': 'z.number()',
      'BigInt': 'z.bigint()',
    };
    
    let zodType = typeMap[field.type] || 'z.unknown()';
    
    // Add validators based on field name or documentation
    if (field.documentation) {
      // Check for @zod annotations
      const zodMatch = field.documentation.match(/@zod\.(.+?)(?:\s|$)/);
      if (zodMatch) {
        const validators = zodMatch[1];
        // Parse validators and apply them
        if (validators.includes('email()')) {
          zodType = 'z.string().email()';
        } else if (validators.includes('url()')) {
          zodType = 'z.string().url()';
        } else if (validators.includes('uuid()')) {
          zodType = 'z.string().uuid()';
        } else if (validators.includes('cuid()')) {
          zodType = 'z.cuid2()';
        }
      }
    }
    
    // Apply list modifier if needed
    if (field.isList) {
      zodType = `z.array(${zodType})`;
    }
    
    return zodType;
  }
}