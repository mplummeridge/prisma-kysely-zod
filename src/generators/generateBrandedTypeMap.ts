/**
 * Generator for Branded Type Mapping
 * 
 * This generator creates a type mapping between Kysely's Selectable types
 * and the Zod schema types that include branded IDs.
 */

import { DMMF } from "@prisma/generator-helper";
import { promises as fs } from "fs";
import path from "path";
import ts from "typescript";
import { generateFile } from "../helpers/generateFile";

export class BrandedTypeMapGenerator {
  constructor(
    private dmmf: DMMF.Document,
    private outputDir: string
  ) {}

  async generate(): Promise<void> {
    await fs.mkdir(this.outputDir, { recursive: true });

    const typeMapContent = this.generateTypeMap();
    const typeMapPath = path.join(this.outputDir, "type-map.ts");
    
    await fs.writeFile(typeMapPath, typeMapContent);
  }

  private generateTypeMap(): string {
    const statements: ts.Statement[] = [];

    // Import statements
    const importDeclarations = [
      // Import Kysely types
      ts.factory.createImportDeclaration(
        undefined,
        ts.factory.createImportClause(
          true,
          undefined,
          ts.factory.createNamedImports([
            ts.factory.createImportSpecifier(
              false,
              undefined,
              ts.factory.createIdentifier("Selectable")
            ),
          ])
        ),
        ts.factory.createStringLiteral("kysely")
      ),
      // Import DB type
      ts.factory.createImportDeclaration(
        undefined,
        ts.factory.createImportClause(
          true,
          undefined,
          ts.factory.createNamedImports([
            ts.factory.createImportSpecifier(
              false,
              undefined,
              ts.factory.createIdentifier("DB")
            ),
          ])
        ),
        ts.factory.createStringLiteral("./types")
      ),
      // Import all types from types.ts as namespace
      ts.factory.createImportDeclaration(
        undefined,
        ts.factory.createImportClause(
          true,
          undefined,
          ts.factory.createNamespaceImport(
            ts.factory.createIdentifier("Types")
          )
        ),
        ts.factory.createStringLiteral("./types")
      ),
    ];

    statements.push(...importDeclarations);

    // Generate the type mapping
    const modelMappings = this.dmmf.datamodel.models.map((model) => {
      // Get the table name (respecting @@map if present)
      const tableName = model.dbName || model.name;
      
      return ts.factory.createPropertySignature(
        undefined,
        ts.factory.createStringLiteral(tableName),
        undefined,
        ts.factory.createTypeReferenceNode(
          ts.factory.createQualifiedName(
            ts.factory.createIdentifier("Types"),
            ts.factory.createIdentifier(model.name)
          ),
          undefined
        )
      );
    });

    // Create the BrandedTypeMap type alias
    const brandedTypeMap = ts.factory.createTypeAliasDeclaration(
      [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      ts.factory.createIdentifier("BrandedTypeMap"),
      undefined,
      ts.factory.createTypeLiteralNode(modelMappings)
    );

    statements.push(brandedTypeMap);

    // Create the BrandedSelectable type helper
    const brandedSelectable = ts.factory.createTypeAliasDeclaration(
      [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      ts.factory.createIdentifier("BrandedSelectable"),
      [
        ts.factory.createTypeParameterDeclaration(
          undefined,
          ts.factory.createIdentifier("TableName"),
          ts.factory.createTypeOperatorNode(
            ts.SyntaxKind.KeyOfKeyword,
            ts.factory.createTypeReferenceNode(
              ts.factory.createIdentifier("DB"),
              undefined
            )
          )
        ),
      ],
      ts.factory.createConditionalTypeNode(
        ts.factory.createTypeReferenceNode(
          ts.factory.createIdentifier("TableName"),
          undefined
        ),
        ts.factory.createTypeOperatorNode(
          ts.SyntaxKind.KeyOfKeyword,
          ts.factory.createTypeReferenceNode(
            ts.factory.createIdentifier("BrandedTypeMap"),
            undefined
          )
        ),
        ts.factory.createIndexedAccessTypeNode(
          ts.factory.createTypeReferenceNode(
            ts.factory.createIdentifier("BrandedTypeMap"),
            undefined
          ),
          ts.factory.createTypeReferenceNode(
            ts.factory.createIdentifier("TableName"),
            undefined
          )
        ),
        ts.factory.createTypeReferenceNode(
          ts.factory.createIdentifier("Selectable"),
          [
            ts.factory.createIndexedAccessTypeNode(
              ts.factory.createTypeReferenceNode(
                ts.factory.createIdentifier("DB"),
                undefined
              ),
              ts.factory.createTypeReferenceNode(
                ts.factory.createIdentifier("TableName"),
                undefined
              )
            ),
          ]
        )
      )
    );

    statements.push(brandedSelectable);

    return generateFile(statements, {
      withEnumImport: false,
      withLeader: false
    });
  }
}