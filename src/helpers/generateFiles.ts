import path from "node:path";
import type { TypeAliasDeclaration } from "typescript";
import ts from "typescript";
import CodeBlockWriter from "code-block-writer";

import { generateFile } from "~/helpers/generateFile";
import { capitalize } from "~/utils/words";

import type { EnumType } from "./generateEnumType";
import type { ModelType } from "./generateModel";
import type { ZodSchemaType } from "./generateZodSchema";

type File = { filepath: string; content: ReturnType<typeof generateFile> | string };

export function generateFiles(opts: {
  typesOutfile: string;
  enums: EnumType[];
  models: ModelType[];
  enumNames: string[];
  enumsOutfile: string;
  databaseType: TypeAliasDeclaration;
  groupBySchema: boolean;
  defaultSchema: string;
  importExtension: string;
  generateZodSchemas?: boolean;
  zodSchemas?: ZodSchemaType[];
  zodSchemasFileName?: string;
}) {
  // Don't generate a separate file for enums if there are no enums
  if (opts.enumsOutfile === opts.typesOutfile || opts.enums.length === 0) {
    let statements: Iterable<ts.Statement>;

    if (!opts.groupBySchema) {
      statements = [
        ...opts.enums.flatMap((e) => [e.objectDeclaration, e.typeDeclaration]),
        ...opts.models.map((m) => m.definition),
      ];
    } else {
      statements = groupModelsAndEnum(
        opts.enums,
        opts.models,
        opts.defaultSchema
      );
    }

    const typesFileWithEnums: File = {
      filepath: opts.typesOutfile,
      content: generateFile([...statements, opts.databaseType], {
        withEnumImport: false,
        withLeader: true,
      }),
    };

    // Generate Zod schemas if enabled
    if (opts.generateZodSchemas && opts.zodSchemas) {
      const zodFile = generateZodFile(opts);
      return [typesFileWithEnums, zodFile];
    }

    return [typesFileWithEnums];
  }

  const typesFileWithoutEnums: File = {
    filepath: opts.typesOutfile,
    content: generateFile(
      [...opts.models.map((m) => m.definition), opts.databaseType],
      {
        withEnumImport: {
          importPath: `./${path.parse(opts.enumsOutfile).name}${opts.importExtension}`,
          names: opts.enumNames,
        },
        withLeader: true,
      }
    ),
  };

  if (opts.enums.length === 0) return [typesFileWithoutEnums];

  const enumFile: File = {
    filepath: opts.enumsOutfile,
    content: generateFile(
      opts.enums.flatMap((e) => [e.objectDeclaration, e.typeDeclaration]),
      {
        withEnumImport: false,
        withLeader: false,
      }
    ),
  };

  // Generate Zod schemas if enabled
  if (opts.generateZodSchemas && opts.zodSchemas) {
    const zodFile = generateZodFile(opts);
    return [typesFileWithoutEnums, enumFile, zodFile];
  }

  return [typesFileWithoutEnums, enumFile];
}

function generateZodFile(opts: {
  zodSchemas?: ZodSchemaType[];
  zodSchemasFileName?: string;
  typesOutfile: string;
  enumsOutfile: string;
  importExtension: string;
}): File {
  const writer = new CodeBlockWriter({
    indentNumberOfSpaces: 2,
    useSingleQuote: false,
  });
  
  // Combine all imports
  const allImports = new Set<string>();
  opts.zodSchemas?.forEach(schema => {
    schema.imports.forEach(imp => allImports.add(imp));
  });
  
  // Handle enum imports separately when enums are in a different file
  const handledEnumImports = new Set<string>();
  if (opts.enumsOutfile !== opts.typesOutfile) {
    const enumImportPath = `./${path.parse(opts.enumsOutfile).name}${opts.importExtension}`;
    // We'll need to collect enum names from zodSchemas
    const enumNames = new Set<string>();
    opts.zodSchemas?.forEach(schema => {
      // Extract enum names from imports
      schema.imports.forEach(imp => {
        const match = imp.match(/import { (\w+) } from "\.\/enums"/);
        if (match) {
          enumNames.add(match[1]);
          handledEnumImports.add(imp); // Track which imports we're consolidating
        }
      });
    });
    
    if (enumNames.size > 0) {
      const consolidatedImport = `import { ${Array.from(enumNames).join(", ")} } from "${enumImportPath}";`;
      allImports.add(consolidatedImport);
      // Don't add consolidatedImport to handledEnumImports - it's already in allImports
    }
  }
  
  // Write imports
  allImports.forEach(imp => {
    // Skip only the specific enum imports that we've already consolidated
    if (!handledEnumImports.has(imp)) {
      writer.writeLine(imp);
    }
  });
  
  if (allImports.size > 0) {
    writer.newLine();
  }
  
  // Write all schemas
  opts.zodSchemas?.forEach((schema, index) => {
    if (index > 0) writer.newLine();
    writer.write(schema.content);
  });
  
  return {
    filepath: opts.zodSchemasFileName || "schemas.ts",
    content: writer.toString(),
  };
}

export function* groupModelsAndEnum(
  enums: EnumType[],
  models: ModelType[],
  defaultSchema: string
): Generator<ts.Statement, void, void> {
  const groupsMap = new Map<string, ts.Statement[]>();

  for (const enumType of enums) {
    if (!enumType.schema || enumType.schema === defaultSchema) {
      yield enumType.objectDeclaration;
      yield enumType.typeDeclaration;
      continue;
    }

    const group = groupsMap.get(enumType.schema);

    if (!group) {
      groupsMap.set(enumType.schema, [
        enumType.objectDeclaration,
        enumType.typeDeclaration,
      ]);
    } else {
      group.push(enumType.objectDeclaration, enumType.typeDeclaration);
    }
  }

  for (const model of models) {
    if (!model.schema || model.schema === defaultSchema) {
      yield model.definition;
      continue;
    }

    const group = groupsMap.get(model.schema);

    if (!group) {
      groupsMap.set(model.schema, [model.definition]);
    } else {
      group.push(model.definition);
    }
  }

  for (const [schema, group] of groupsMap) {
    yield ts.factory.createModuleDeclaration(
      [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      ts.factory.createIdentifier(capitalize(schema)),
      ts.factory.createModuleBlock(group),
      ts.NodeFlags.Namespace
    );
  }
}
