import type { DMMF } from "@prisma/generator-helper";
import path from "node:path";
import { formatFile } from "~/utils/formatFile";
import { writeFileSafely } from "~/utils/writeFileSafely";

export class SQLiteBooleanPluginGenerator {
  constructor(
    private dmmf: DMMF.Document,
    private outputPath: string,
  ) {}

  async generate(): Promise<void> {
    const booleanFieldMap = this.extractBooleanFields();
    const content = this.generatePluginContent(booleanFieldMap);
    const formattedContent = await formatFile(content);
    
    const filePath = path.join(this.outputPath, "sqlite-boolean-plugin.ts");
    await writeFileSafely(filePath, formattedContent);
  }

  private extractBooleanFields(): Record<string, string[]> {
    const booleanFieldMap: Record<string, string[]> = {};
    
    for (const model of this.dmmf.datamodel.models) {
      const booleanFields = model.fields
        .filter(field => field.type === "Boolean" && field.kind === "scalar")
        .map(field => field.name);
      
      if (booleanFields.length > 0) {
        // Convert PascalCase to snake_case for table names
        const tableName = this.camelToSnakeCase(model.name);
        booleanFieldMap[tableName] = booleanFields;
      }
    }
    
    return booleanFieldMap;
  }

  private camelToSnakeCase(str: string): string {
    return str
      // Handle consecutive capitals (e.g., LLM -> llm, not l_l_m)
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      // Handle normal case transitions
      .replace(/([a-z\d])([A-Z])/g, '$1_$2')
      .toLowerCase();
  }

  private generatePluginContent(booleanFieldMap: Record<string, string[]>): string {
    const booleanFieldsJson = JSON.stringify(booleanFieldMap, null, 2)
      .split('\n')
      .map((line, index) => index === 0 ? line : `  ${line}`)
      .join('\n');

    return `/**
 * SQLite Boolean Plugin for Kysely
 * 
 * This plugin automatically transforms boolean values between JavaScript (true/false)
 * and SQLite (1/0) representations. Generated from Prisma schema.
 * 
 * DO NOT EDIT MANUALLY - This file is auto-generated.
 */

import type {
  KyselyPlugin,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  RootOperationNode,
  QueryResult,
  UnknownRow,
} from 'kysely';
import {
  OperationNodeTransformer,
  ValueListNode,
  ValueNode,
  PrimitiveValueListNode,
  InsertQueryNode,
  UpdateQueryNode,
  ReturningNode,
  SelectQueryNode,
  DeleteQueryNode,
} from 'kysely';

/**
 * Map of table names to their boolean field names
 * Auto-generated from Prisma schema Boolean fields
 */
const BOOLEAN_FIELDS: Record<string, string[]> = ${booleanFieldsJson};

/**
 * SQLite Boolean Plugin
 * 
 * Automatically transforms boolean values:
 * - On insert/update: true → 1, false → 0
 * - On select: 1 → true, 0 → false
 */
export class SQLiteBooleanPlugin implements KyselyPlugin {
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return new BooleanTransformer().transformNode(args.node);
  }

  async transformResult(
    args: PluginTransformResultArgs,
  ): Promise<QueryResult<UnknownRow>> {
    const { result, queryId } = args;
    
    if (!result.rows || result.rows.length === 0) {
      return result;
    }

    // Get the table name from the query to know which fields to transform
    // This is a simplified approach - in production you might want to
    // track this in transformQuery using a WeakMap
    const transformedRows = result.rows.map(row => {
      const transformedRow = { ...row };
      
      // Check each table's boolean fields
      for (const [tableName, fields] of Object.entries(BOOLEAN_FIELDS)) {
        for (const field of fields) {
          if (field in transformedRow && typeof transformedRow[field] === 'number') {
            transformedRow[field] = transformedRow[field] === 1;
          }
        }
      }
      
      return transformedRow;
    });

    return {
      ...result,
      rows: transformedRows,
    };
  }
}

/**
 * Transformer for boolean values in queries
 */
class BooleanTransformer extends OperationNodeTransformer {
  protected transformValue(node: ValueNode): ValueNode {
    // Only transform boolean values in contexts where we know the field
    if (typeof node.value === 'boolean') {
      return {
        ...node,
        value: node.value ? 1 : 0,
      };
    }
    return node;
  }

  protected transformValueList(node: ValueListNode): ValueListNode {
    return {
      ...node,
      values: node.values.map(value => 
        typeof value === 'boolean' ? (value ? 1 : 0) : value
      ),
    };
  }

  protected transformPrimitiveValueList(
    node: PrimitiveValueListNode
  ): PrimitiveValueListNode {
    return {
      ...node,
      values: node.values.map(value =>
        typeof value === 'boolean' ? (value ? 1 : 0) : value
      ),
    };
  }

  protected transformInsertQuery(node: InsertQueryNode): InsertQueryNode {
    // Get table name
    const tableName = node.into?.table?.identifier?.name;
    
    if (tableName && BOOLEAN_FIELDS[tableName]) {
      // Transform boolean values in the values
      const transformed = super.transformInsertQuery(node);
      return transformed;
    }
    
    return super.transformInsertQuery(node);
  }

  protected transformUpdateQuery(node: UpdateQueryNode): UpdateQueryNode {
    // Get table name
    const tableName = node.table?.table?.identifier?.name;
    
    if (tableName && BOOLEAN_FIELDS[tableName]) {
      // Transform boolean values in the updates
      const transformed = super.transformUpdateQuery(node);
      return transformed;
    }
    
    return super.transformUpdateQuery(node);
  }
}

/**
 * Helper function to check if a field is a boolean field for a given table
 */
export function isBooleanField(tableName: string, fieldName: string): boolean {
  const fields = BOOLEAN_FIELDS[tableName];
  return fields ? fields.includes(fieldName) : false;
}

/**
 * Get all boolean fields for a table
 */
export function getBooleanFields(tableName: string): string[] {
  return BOOLEAN_FIELDS[tableName] || [];
}
`;
  }
}