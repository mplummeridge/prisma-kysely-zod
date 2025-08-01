/**
 * Phase 3: Brand Registry Generator
 * 
 * Generates a registry of branded types from Prisma schema annotations.
 * This creates a central registry that maps brand names to their types.
 * 
 * Example input:
 *   /// @zod.cuid().brand("UserId")
 *   id String @id @default(cuid())
 * 
 * Example output:
 *   export const UserId = z.string().cuid().brand("UserId");
 *   export type UserId = z.infer<typeof UserId>;
 */

import { DMMF } from "@prisma/generator-helper";
import path from "path";
import { writeFile, ensureDir, emptyDir } from "fs-extra";

interface BrandedType {
  brandName: string;
  baseType: string;
  validators: string[];
  modelName: string;
  fieldName: string;
}

export class BrandRegistryGenerator {
  private brands = new Map<string, BrandedType>();

  constructor(
    private dmmf: DMMF.Document,
    private outputDir: string
  ) {}

  async generate(): Promise<void> {
    // Clean the output directory to remove stale files
    await ensureDir(this.outputDir);
    await emptyDir(this.outputDir);
    
    // Step 1: Collect all branded types from models
    this.collectBrandedTypes();

    // Step 2: Generate the registry file
    await this.writeRegistryFile();

    // Step 3: Generate the re-export index
    await this.writeIndexFile();
  }

  private collectBrandedTypes(): void {
    for (const model of this.dmmf.datamodel.models) {
      for (const field of model.fields) {
        const brandInfo = this.extractBrandInfo(field.documentation);
        if (brandInfo) {
          this.brands.set(brandInfo.brandName, {
            ...brandInfo,
            modelName: model.name,
            fieldName: field.name,
          });
        }
      }
    }
  }

  private extractBrandInfo(documentation?: string): Omit<BrandedType, 'modelName' | 'fieldName'> | null {
    if (!documentation) return null;

    // Match @zod.xxx().yyy().brand("BrandName")
    const brandMatch = documentation.match(/@zod\.(.+?)\.brand\(["']([^"']+)["']\)/);
    if (!brandMatch) return null;

    const [, validatorChain, brandName] = brandMatch;
    
    // Parse the validator chain
    const validators = this.parseValidatorChain(validatorChain);
    const baseType = this.determineBaseType(validators[0]);

    return {
      brandName,
      baseType,
      validators,
    };
  }

  private parseValidatorChain(chain: string): string[] {
    const validators: string[] = [];
    let current = '';
    let parenDepth = 0;
    let inArgs = false;

    for (let i = 0; i < chain.length; i++) {
      const char = chain[i];
      
      if (char === '(') {
        parenDepth++;
        if (parenDepth === 1 && current) {
          inArgs = true;
        }
        current += char;
      } else if (char === ')') {
        parenDepth--;
        current += char;
        if (parenDepth === 0 && inArgs) {
          validators.push(current);
          current = '';
          inArgs = false;
        }
      } else if (char === '.' && parenDepth === 0) {
        if (current) {
          validators.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      validators.push(current);
    }

    return validators;
  }

  private determineBaseType(firstValidator: string): string {
    // Handle method calls with parentheses
    const baseMethod = firstValidator.split('(')[0];
    
    // Map validator names to base Zod types
    const typeMap: Record<string, string> = {
      'string': 'z.string()',
      'number': 'z.number()',
      'cuid': 'z.cuid2()',
      'cuid2': 'z.cuid2()',
      'uuid': 'z.string()',
      'email': 'z.string()',
      'url': 'z.string()',
      'int': 'z.number()',
      'positive': 'z.number()',
      'nonnegative': 'z.number()',
    };

    return typeMap[baseMethod] || 'z.string()';
  }

  private getBaseTypeForField(field: DMMF.Field): string {
    switch (field.type) {
      case 'String':
        return field.default?.toString().includes('cuid()') ? 'z.cuid2()' : 'z.string()';
      case 'Int':
        return 'z.number().int()';
      case 'BigInt':
        return 'z.bigint()';
      case 'Float':
        return 'z.number()';
      case 'Boolean':
        return 'z.boolean()';
      case 'DateTime':
        return 'z.date()';
      default:
        return 'z.string()';
    }
  }

  private getValidatorsForField(field: DMMF.Field): string[] {
    const validators: string[] = [];
    
    // Add validators based on field attributes
    if (field.type === 'Int' && field.documentation?.includes('nonnegative')) {
      validators.push('nonnegative');
    }
    
    return validators;
  }

  private async writeRegistryFile(): Promise<void> {
    const lines: string[] = [
      '/**',
      ' * Generated Brand Registry',
      ' * ',
      ' * This file contains all branded types used in the Prisma schema.',
      ' * Branded types provide nominal typing for IDs and other values.',
      ' */',
      '',
      'import { z } from "zod/v4";',
      '',
      '// Brand Registry',
      '',
    ];

    // Sort brands by name for consistent output
    const sortedBrands = Array.from(this.brands.entries())
      .sort(([a], [b]) => a.localeCompare(b));

    for (const [brandName, brand] of sortedBrands) {
      // Add JSDoc
      lines.push(`/**`);
      lines.push(` * Brand: ${brandName}`);
      lines.push(` * Used in: ${brand.modelName}.${brand.fieldName}`);
      lines.push(` */`);

      // Build validator chain
      let validatorChain = brand.baseType;
      
      // Handle special cases for compound validators
      if (brand.validators[0] === 'number' && brand.validators[1] === 'int()') {
        validatorChain = 'z.number().int()';
        // Add remaining validators after int()
        for (let i = 2; i < brand.validators.length; i++) {
          const validator = brand.validators[i];
          if (!validator.includes('(')) {
            validatorChain += `.${validator}()`;
          } else {
            validatorChain += `.${validator}`;
          }
        }
      } else {
        // Normal case: add all validators except the base type
        for (const validator of brand.validators) {
          const baseValidator = validator.split('(')[0];
          if (baseValidator !== 'string' && baseValidator !== 'number' && baseValidator !== 'cuid' && baseValidator !== 'cuid2') {
            // Validator already has parentheses
            if (validator.includes('(')) {
              validatorChain += `.${validator}`;
            } else {
              validatorChain += `.${validator}()`;
            }
          }
        }
      }
      
      validatorChain += `.brand("${brandName}")`;

      // Export schema
      lines.push(`export const ${brandName} = ${validatorChain};`);
      
      // Export type
      lines.push(`export type ${brandName} = z.infer<typeof ${brandName}>;`);
      lines.push('');
    }

    // Add utility types
    lines.push('// Utility Types');
    lines.push('');
    lines.push('/**');
    lines.push(' * Extract brand from a branded type');
    lines.push(' * Note: This utility type is not available in Zod v4');
    lines.push(' */');
    lines.push('// export type Brand<T> = T extends z.ZodBranded<any, infer B> ? B : never;');
    lines.push('');
    lines.push('/**');
    lines.push(' * Union of all brand names');
    lines.push(' */');
    lines.push(`export type BrandName = ${sortedBrands.map(([name]) => `"${name}"`).join(' | ') || 'never'};`);

    const outputPath = path.join(this.outputDir, 'branded.ts');
    await ensureDir(this.outputDir);
    await writeFile(outputPath, lines.join('\n'));
  }

  private async writeIndexFile(): Promise<void> {
    const lines: string[] = [
      '/**',
      ' * Branded Types Index',
      ' * ',
      ' * Re-exports all branded types for convenient access.',
      ' */',
      '',
      `export * from './branded';`,
    ];

    const outputPath = path.join(this.outputDir, 'index.ts');
    await writeFile(outputPath, lines.join('\n'));
  }
}